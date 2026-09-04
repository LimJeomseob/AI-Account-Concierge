/**
 * 계정·금고 운영 (PRD R21·R23·R25, §7-2 계정)
 */
import 'server-only'
import { db } from '@/lib/db'
import { decrypt, encrypt } from '@/lib/crypto'
import { todayKST } from '@/lib/date'
import { assignedDaysOf } from '@/lib/assign'
import { generatePassword } from '@/lib/password'
import { getSettings } from '@/lib/settings'
import { log, transitionAccount } from '@/lib/state'
import type { Service } from '@/lib/types'

/**
 * R21: 회수중 계정에 신규 비밀번호 생성.
 * 이미 「변경대기」이거나 해당 배정의 chk_password_changed 가 true 면 재생성하지 않는다(멱등).
 */
export async function generateNewPassword(
  accountId: string,
  actor: string,
  opts: { force?: boolean } = {},
): Promise<boolean> {
  const s = await getSettings()
  const { data: sec } = await db()
    .from('account_secrets')
    .select('account_id, password_status, new_password_enc')
    .eq('account_id', accountId)
    .maybeSingle()
  if (!sec) return false
  if (!opts.force && sec.password_status === '변경대기') return false

  const pw = generatePassword(s.password_length)
  const { error } = await db()
    .from('account_secrets')
    .update({
      new_password_enc: encrypt(pw),
      password_status: '변경대기',
      updated_at: new Date().toISOString(),
    })
    .eq('account_id', accountId)
  if (error) throw new Error(error.message)

  await log(actor, 'account.password.generate', accountId, {})
  return true
}

/** R23: 「비밀번호 변경 완료」 — password ← new_password */
export async function markPasswordChanged(accountId: string, actor: string): Promise<void> {
  const { data: sec } = await db()
    .from('account_secrets')
    .select('new_password_enc, password_status')
    .eq('account_id', accountId)
    .single()
  if (!sec) throw new Error(`계정 ${accountId} 금고 없음`)
  if (!sec.new_password_enc) throw new Error('생성된 신규 비밀번호가 없습니다.')

  const { error } = await db()
    .from('account_secrets')
    .update({
      password_enc: sec.new_password_enc,
      new_password_enc: null,
      password_status: '정상',
      password_changed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('account_id', accountId)
  if (error) throw new Error(error.message)

  // 이 계정에 연결된 회수 대상 배정의 체크 항목 갱신.
  // 미인수 건은 current_assignment_id 가 해제되어 있으므로(R19) 계정ID로도 찾는다.
  const { data: acc } = await db()
    .from('accounts')
    .select('current_assignment_id')
    .eq('id', accountId)
    .single()
  let targetId = acc?.current_assignment_id ?? null
  if (!targetId) {
    const { data: pending } = await db()
      .from('assignments')
      .select('id')
      .eq('account_id', accountId)
      .in('status', ['회수중', '인수기한초과'])
      .order('updated_at', { ascending: false })
      .limit(1)
    targetId = pending?.[0]?.id ?? null
  }
  if (targetId) {
    await db()
      .from('assignments')
      .update({ chk_password_changed: true, updated_at: new Date().toISOString() })
      .eq('id', targetId)
  }
  await log(actor, 'account.password.applied', accountId, { assignment_id: targetId })
}

/** 금고 열람 (복호화 + 열람 로그) */
export async function viewVault(accountId: string, actor: string) {
  const { data: sec } = await db()
    .from('account_secrets')
    .select('*')
    .eq('account_id', accountId)
    .single()
  if (!sec) throw new Error(`계정 ${accountId} 금고 없음`)
  await log(actor, 'account.vault.view', accountId, {})
  return {
    account_id: sec.account_id,
    login_email: sec.login_email as string | null,
    password: decrypt(sec.password_enc),
    new_password: decrypt(sec.new_password_enc),
    password_status: sec.password_status as string,
    password_changed_at: sec.password_changed_at as string | null,
    owns_registered_email: sec.owns_registered_email as boolean,
    two_fa: sec.two_fa as string | null,
    note: sec.note as string | null,
  }
}

export interface AccountImportRow {
  id: string
  service: Service
  kind?: '운영' | '예비'
  login_email?: string
  password?: string
  activated_on?: string
  expires_on?: string
  owns_registered_email?: boolean
  two_fa?: string
}

/** CSV 가져오기 (계정 + 금고 동시 upsert) */
export async function importAccounts(rows: AccountImportRow[], actor: string): Promise<number> {
  let n = 0
  for (const r of rows) {
    const { error } = await db().from('accounts').upsert(
      {
        id: r.id,
        service: r.service,
        kind: r.kind ?? '운영',
        activated_on: r.activated_on || null,
        expires_on: r.expires_on || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'id' },
    )
    if (error) throw new Error(`${r.id}: ${error.message}`)

    const { error: sErr } = await db().from('account_secrets').upsert(
      {
        account_id: r.id,
        login_email: r.login_email ?? null,
        password_enc: r.password ? encrypt(r.password) : null,
        owns_registered_email: r.owns_registered_email ?? false,
        two_fa: r.two_fa ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'account_id' },
    )
    if (sErr) throw new Error(`${r.id} 금고: ${sErr.message}`)
    n += 1
  }
  await log(actor, 'account.import', null, { count: n })
  return n
}

/** CSV 텍스트 → 행 (헤더: 계정ID,서비스,구분,로그인이메일,비밀번호,활성화일,만료일,등록이메일소유,2FA) */
export function parseAccountCsv(text: string): AccountImportRow[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  if (lines.length === 0) return []
  const head = splitCsvLine(lines[0])
  const idx = (name: string) => head.findIndex((h) => h.replace(/\s/g, '') === name)
  const cId = idx('계정ID')
  const cService = idx('서비스')
  const cKind = idx('구분')
  const cEmail = idx('로그인이메일')
  const cPw = idx('비밀번호')
  const cAct = idx('활성화일')
  const cExp = idx('만료일')
  const cOwn = idx('등록이메일소유')
  const c2fa = idx('2FA')
  if (cId < 0 || cService < 0) throw new Error('CSV 헤더에 「계정ID」·「서비스」가 필요합니다.')

  const out: AccountImportRow[] = []
  for (const line of lines.slice(1)) {
    const c = splitCsvLine(line)
    const id = c[cId]?.trim()
    if (!id) continue
    const svc = (c[cService] ?? '').trim()
    out.push({
      id,
      service: svc === 'Claude' || svc === 'CL' ? 'Claude' : 'GPT',
      kind: (c[cKind] ?? '').trim() === '예비' ? '예비' : '운영',
      login_email: cEmail >= 0 ? c[cEmail]?.trim() : undefined,
      password: cPw >= 0 ? c[cPw]?.trim() : undefined,
      activated_on: cAct >= 0 ? normalizeDate(c[cAct]) : undefined,
      expires_on: cExp >= 0 ? normalizeDate(c[cExp]) : undefined,
      owns_registered_email: cOwn >= 0 ? /^(true|Y|y|1|예|O|o)$/.test((c[cOwn] ?? '').trim()) : false,
      two_fa: c2fa >= 0 ? c[c2fa]?.trim() : undefined,
    })
  }
  return out
}

function normalizeDate(v: string | undefined): string | undefined {
  const s = (v ?? '').trim()
  if (!s) return undefined
  const m = s.match(/^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/)
  if (!m) return undefined
  return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
}

export function splitCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"'
          i++
        } else quoted = false
      } else cur += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  out.push(cur)
  return out
}

/** R25: 계정 배정일수·횟수 갱신 (일일 작업) */
export async function refreshAccountStats(today: string = todayKST()): Promise<number> {
  const { data: accs } = await db().from('accounts').select('id, assigned_days, assigned_count')
  const { data: rows } = await db()
    .from('assignments')
    .select('account_id, status, assigned_on, rent_start, rent_end, returned_at')
    .not('account_id', 'is', null)

  const byAccount = new Map<string, typeof rows>()
  for (const r of rows ?? []) {
    const list = byAccount.get(r.account_id!) ?? []
    list.push(r)
    byAccount.set(r.account_id!, list as typeof rows)
  }

  let changed = 0
  for (const acc of accs ?? []) {
    const list = (byAccount.get(acc.id) ?? []) as NonNullable<typeof rows>
    const days = assignedDaysOf(list, today)
    const count = list.filter((r) => r.status !== '취소' && r.status !== '반려' && r.assigned_on).length
    if (acc.assigned_days !== days || acc.assigned_count !== count) {
      await db()
        .from('accounts')
        .update({ assigned_days: days, assigned_count: count, updated_at: new Date().toISOString() })
        .eq('id', acc.id)
      changed += 1
    }
  }
  return changed
}

/** 구독 만료 처리 + D-N 임박 목록 (일일 작업 7단계) */
export async function processExpiries(
  alertDays: number,
  today: string = todayKST(),
): Promise<{ expired: string[]; soon: Array<{ id: string; expires_on: string }> }> {
  const { data: accs } = await db()
    .from('accounts')
    .select('id, status, expires_on')
    .not('expires_on', 'is', null)

  const expired: string[] = []
  const soon: Array<{ id: string; expires_on: string }> = []
  const limit = new Date(`${today}T00:00:00Z`)
  limit.setUTCDate(limit.getUTCDate() + alertDays)
  const limitStr = limit.toISOString().slice(0, 10)

  for (const a of accs ?? []) {
    if (!a.expires_on) continue
    if (a.expires_on < today) {
      if (a.status !== '만료') {
        await transitionAccount({
          id: a.id,
          to: '만료',
          actor: 'system',
          action: 'account.expire',
          detail: { expires_on: a.expires_on },
        })
        expired.push(a.id)
      }
    } else if (a.expires_on <= limitStr && a.status !== '만료') {
      soon.push({ id: a.id, expires_on: a.expires_on })
    }
  }
  return { expired, soon }
}

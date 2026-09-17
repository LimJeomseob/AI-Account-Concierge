/**
 * 계정(팀 좌석) 운영 (PRD R25, §7-2 계정)
 * 좌석마다 고정 접속 링크(access_url)를 등록해 두고 배정안내 메일에 실어 보낸다(R16).
 */
import 'server-only'
import { db } from '@/lib/db'
import { todayKST } from '@/lib/date'
import { assignedDaysOf } from '@/lib/assign'
import { log, transitionAccount } from '@/lib/state'
import type { Service } from '@/lib/types'

/**
 * 접속 링크 정규화 (순수 함수).
 * 트림 후 비어 있으면 null(= 미등록). 값이 있으면 http(s) 여야 한다.
 */
export function normalizeUrl(v: string | null | undefined): string | null {
  const t = (v ?? '').trim()
  if (!t) return null
  if (!/^https?:\/\//i.test(t)) throw new Error('접속 링크는 http:// 또는 https:// 로 시작해야 합니다.')
  return t
}

/** 좌석 접속 링크 등록·수정 (링크 값 자체는 로그에 남기지 않는다) */
export async function setAccessUrl(accountId: string, url: string, actor: string): Promise<void> {
  const next = normalizeUrl(url)
  const { error } = await db()
    .from('account_secrets')
    .upsert(
      { account_id: accountId, access_url: next, updated_at: new Date().toISOString() },
      { onConflict: 'account_id' },
    )
  if (error) throw new Error(error.message)
  await log(actor, 'account.access_url.set', accountId, { registered: next !== null })
}

export interface AccountImportRow {
  id: string
  service: Service
  kind?: '운영' | '예비'
  login_email?: string
  access_url?: string
  activated_on?: string
  expires_on?: string
}

/** CSV 가져오기 (계정 + 접속 정보 동시 upsert) */
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
        access_url: normalizeUrl(r.access_url),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'account_id' },
    )
    if (sErr) throw new Error(`${r.id} 접속 정보: ${sErr.message}`)
    n += 1
  }
  await log(actor, 'account.import', null, { count: n })
  return n
}

/** CSV 텍스트 → 행 (헤더: 계정ID,서비스,구분,로그인이메일,접속링크,활성화일,만료일) */
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
  const cUrl = idx('접속링크')
  const cAct = idx('활성화일')
  const cExp = idx('만료일')
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
      access_url: cUrl >= 0 ? c[cUrl]?.trim() : undefined,
      activated_on: cAct >= 0 ? normalizeDate(c[cAct]) : undefined,
      expires_on: cExp >= 0 ? normalizeDate(c[cExp]) : undefined,
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

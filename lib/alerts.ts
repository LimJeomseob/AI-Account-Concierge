/**
 * 회수 대상 알림 (PRD R22)
 * 일일 작업이 alerts 테이블을 전체 재생성하고 accounts.alert 문구를 갱신한다.
 */
import 'server-only'
import { db } from '@/lib/db'
import { decrypt } from '@/lib/crypto'
import { diffDays, todayKST } from '@/lib/date'

export type AlertCategory = '대여기간 만료' | '인수기한 초과'

export interface AlertRow {
  category: AlertCategory
  account_id: string | null
  login_email: string | null
  assignment_id: string
  name: string
  program_name: string
  rent_end: string | null
  elapsed_days: number
  password_status: string | null
  guide: string
}

/** 계정 목록에 표시할 알림 문구 (순수 함수) */
export function alertText(input: {
  category: AlertCategory
  rentEnd: string | null
  elapsedDays: number
  passwordChanged: boolean
}): string {
  if (input.passwordChanged) return '비밀번호 변경 완료 — 회수 완료 처리 필요'
  if (input.category === '인수기한 초과') return '⚠ 인수기한 초과 — 회수 필요'
  return `⚠ 대여기간 만료(${input.rentEnd ?? '-'}, D+${input.elapsedDays}) — 비밀번호 변경 필요(신규비밀번호 생성됨)`
}

/** alerts 전체 재생성 + accounts.alert 갱신. 멱등(R32). */
export async function rebuildAlerts(today: string = todayKST()): Promise<number> {
  const { data: rows, error } = await db()
    .from('assignments')
    .select(
      'id, name, status, account_id, rent_end, chk_password_changed, notified_at, programs(name)',
    )
    .in('status', ['회수중', '인수기한초과'])
  if (error) throw new Error(error.message)

  const accountIds = (rows ?? []).map((r) => r.account_id).filter((v): v is string => !!v)
  const secrets = new Map<string, { login_email: string | null; password_status: string }>()
  if (accountIds.length > 0) {
    const { data: secs } = await db()
      .from('account_secrets')
      .select('account_id, login_email, password_status')
      .in('account_id', accountIds)
    for (const s of secs ?? []) {
      secrets.set(s.account_id, { login_email: s.login_email, password_status: s.password_status })
    }
  }

  const alerts: AlertRow[] = []
  const accountAlert = new Map<string, string>()

  for (const r of rows ?? []) {
    const category: AlertCategory = r.status === '인수기한초과' ? '인수기한 초과' : '대여기간 만료'
    const elapsed = r.rent_end ? Math.max(0, diffDays(r.rent_end, today)) : 0
    const text = alertText({
      category,
      rentEnd: r.rent_end,
      elapsedDays: elapsed,
      passwordChanged: r.chk_password_changed,
    })
    const sec = r.account_id ? secrets.get(r.account_id) : undefined
    alerts.push({
      category,
      account_id: r.account_id,
      login_email: sec?.login_email ?? null,
      assignment_id: r.id,
      name: r.name,
      program_name: (r as unknown as { programs: { name: string } | null }).programs?.name ?? '',
      rent_end: r.rent_end,
      elapsed_days: elapsed,
      password_status: sec?.password_status ?? null,
      guide: text,
    })
    if (r.account_id) accountAlert.set(r.account_id, text)
  }

  // 전체 재생성 (멱등)
  await db().from('alerts').delete().neq('id', -1)
  if (alerts.length > 0) {
    const { error: insErr } = await db()
      .from('alerts')
      .insert(alerts.map((a) => ({ ...a, generated_at: new Date().toISOString() })))
    if (insErr) throw new Error(insErr.message)
  }

  // accounts.alert 재설정: 대상 계정만 문구, 나머지는 비움
  const { data: accs } = await db().from('accounts').select('id, alert')
  for (const acc of accs ?? []) {
    const next = accountAlert.get(acc.id) ?? null
    if ((acc.alert ?? null) !== next) {
      await db().from('accounts').update({ alert: next, updated_at: new Date().toISOString() }).eq('id', acc.id)
    }
  }
  return alerts.length
}

/** 관리자 화면·메일용 알림 조회 */
export async function listAlerts(): Promise<AlertRow[]> {
  const { data } = await db().from('alerts').select('*').order('category').order('rent_end')
  return (data ?? []) as unknown as AlertRow[]
}

/** 금고 열람(R? §7-2 계정 「보기」) — 복호화 + 열람 로그는 호출부에서 기록 */
export function decryptSecret(enc: string | null): string | null {
  return decrypt(enc)
}

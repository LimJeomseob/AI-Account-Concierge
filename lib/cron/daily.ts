/**
 * 일일 작업 (PRD §11) — 매일 09:00 KST.
 * 순서는 멱등(R32): 같은 날 두 번 실행해도 결과가 같다.
 */
import 'server-only'
import { db } from '@/lib/db'
import { todayKST } from '@/lib/date'
import { DEFAULT_SETTINGS, getSettings } from '@/lib/settings'
import { markOk, withLock } from '@/lib/lock'
import { rebuildAlerts, listAlerts } from '@/lib/alerts'
import { dispatchQueue, type DispatchResult } from '@/lib/mail/dispatch'
import { queueAdminMail } from '@/lib/mail/queue'
import { log } from '@/lib/state'
import { autoAssignAll, endExpiredRentals, type AssignScope } from '@/lib/ops/assignments'
import { processExpiries, refreshAccountStats, type ExpiryResult } from '@/lib/ops/accounts'
import { suspensionRate } from '@/lib/ops/incidents'

export interface DailyError {
  step: string
  message: string
}

export interface DailyResult {
  today: string
  rent_ended: string[]
  assigned: string[]
  alerts: number
  mail: DispatchResult
  stats_updated: number
  expired_accounts: string[]
  expiring_soon: Array<{ id: string; expires_on: string }>
  expired_in_use: Array<{ id: string; expires_on: string; status: string }>
  suspension_rate: number
  digest_recipients: number
  /** 실패한 단계. 비어 있지 않으면 cron 응답이 500 이 되고 점검 메일 맨 위에 표시된다 */
  errors: DailyError[]
  /** 다른 실행이 잠금을 쥐고 있어 건너뜀 (cron 과 「지금 실행」 버튼 동시 실행) */
  skipped?: 'locked'
}

/** 일일 작업 잠금 TTL — 정상 실행은 수 분 이내. 비정상 종료로 남은 잠금은 이 시간 뒤 인수된다 */
const DAILY_LOCK_TTL_MS = 15 * 60 * 1000

function emptyResult(today: string): DailyResult {
  return {
    today,
    rent_ended: [],
    assigned: [],
    alerts: 0,
    mail: { sent: 0, failed: 0, remaining: 0 },
    stats_updated: 0,
    expired_accounts: [],
    expiring_soon: [],
    expired_in_use: [],
    suspension_rate: 0,
    digest_recipients: 0,
    errors: [],
  }
}

/** 메일 발송 중단 사유 표시 (순수 함수) */
export function mailStopNote(stopped: DispatchResult['stopped']): string {
  if (stopped === 'auth') return ' ⚠ 인증 실패로 발송 중단 — GMAIL_USER·GMAIL_APP_PASSWORD 를 확인하세요'
  if (stopped === 'limit') return ' ⚠ Gmail 일일 한도로 발송 중단 — 내일 재시도'
  return ''
}

/** 점검 메일 맨 위에 붙일 오류 요약 (순수 함수) */
export function digestErrorLines(errors: DailyError[]): string[] {
  if (errors.length === 0) return []
  return [
    `■ 일일 작업 오류 ${errors.length}건 — 아래 단계가 실패해 처리되지 않았습니다. 관리자 화면 「로그」에서 cron.daily.error 를 확인하세요.`,
    ...errors.map((e) => `  - [${e.step}] ${e.message}`),
    '',
  ]
}

/** `scope` 는 통합 테스트 격리용(자동 배정 범위 제한). 운영 호출은 넘기지 않는다. */
export async function runDaily(actor = 'system', today: string = todayKST(), scope?: AssignScope): Promise<DailyResult> {
  const r = await withLock('cron.daily', DAILY_LOCK_TTL_MS, () => runDailyUnlocked(actor, today, scope))
  if (r.locked) {
    await log(actor, 'cron.daily.skip', null, { today, reason: 'locked' })
    return { ...emptyResult(today), skipped: 'locked' }
  }
  return r.value
}

async function runDailyUnlocked(actor: string, today: string, scope?: AssignScope): Promise<DailyResult> {
  await log(actor, 'cron.daily.start', null, { today })
  const errors: DailyError[] = []

  /** 단계 실행: 실패해도 다음 단계로 넘어가고 오류를 모은다(한 단계 실패로 점검 메일까지 멈추지 않게) */
  async function step<T>(name: string, fn: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await fn()
    } catch (e) {
      const message = ((e as Error)?.message ?? String(e)).slice(0, 500)
      errors.push({ step: name, message })
      console.error(`[cron.daily] ${name} 실패:`, message)
      await log(actor, 'cron.daily.error', null, { today, step: name, message })
      return fallback
    }
  }

  const s = await step('설정 읽기', () => getSettings(), DEFAULT_SETTINGS)

  // 1. (폐지) 프로그램 자동 종료 — 상태 전환은 관리자 드롭다운 수동 (구 R4)

  // 2. (폐지) 미인수 자동 취소 — 인수 확인 단계가 없어졌다 (구 R19, 2026-10-28)

  // 3. 대여 종료 → 회수중 (R20). 접근 차단은 관리자 회수 체크리스트(R24)
  const rentEnded = await step('대여 종료', () => endExpiredRentals(today), [] as string[])

  // 3-1. alerts·accounts.alert 재생성 (R22)
  const alertCount = await step('회수 알림 재생성', () => rebuildAlerts(today), 0)

  // 4. 승인 대기 자동 배정 (R14)
  const assigned = await step('자동 배정', () => autoAssignAll(actor, today, scope), [] as string[])

  // 4-1. 배정으로 알림 대상이 바뀌었을 수 있으므로 다시 계산
  await step('회수 알림 재계산', () => rebuildAlerts(today), 0)

  // 5. 메일 대기열 발송
  const mail = await step('메일 발송', () => dispatchQueue(), { sent: 0, failed: 0, remaining: 0 })

  // 6. 계정 통계 갱신 (R25)
  const statsUpdated = await step('계정 통계', () => refreshAccountStats(today), 0)

  // 7. 구독 만료 처리 / D-N 임박
  const { expired, soon, overdueInUse } = await step(
    '구독 만료',
    () => processExpiries(s.account_expiry_alert_days, today),
    { expired: [], soon: [], overdueInUse: [] } as ExpiryResult,
  )

  // 8. 관리자 일일 점검 메일 — 앞 단계 오류도 함께 알린다
  const rate = await step('정지율', () => suspensionRate(), 0)
  const digest = await step(
    '점검 메일',
    () => sendDigest({ today, rentEnded, assigned, mail, soon, overdueInUse, rate, errors: [...errors] }),
    0,
  )

  // 점검 메일까지 당일 발송 (대기열에 남기지 않는다)
  if (digest > 0) {
    const extra = await step('점검 메일 발송', () => dispatchQueue(digest + 10), null)
    if (extra) {
      mail.sent += extra.sent
      mail.failed += extra.failed
      mail.remaining = extra.remaining
      if (extra.stopped && extra.stopped !== 'locked') mail.stopped = extra.stopped
    }
  }

  const result: DailyResult = {
    today,
    rent_ended: rentEnded,
    assigned,
    alerts: alertCount,
    mail,
    stats_updated: statsUpdated,
    expired_accounts: expired,
    expiring_soon: soon,
    expired_in_use: overdueInUse,
    suspension_rate: rate,
    digest_recipients: digest,
    errors,
  }
  await log(actor, 'cron.daily.done', null, result as unknown as Record<string, unknown>)
  // 모든 단계가 성공했을 때만 「마지막 성공」 갱신 → /api/health 가 오래되면 503 (외부 감시 알림 근거)
  if (errors.length === 0) await markOk('cron.daily')
  return result
}

async function sendDigest(input: {
  today: string
  rentEnded: string[]
  assigned: string[]
  mail: DispatchResult
  soon: Array<{ id: string; expires_on: string }>
  overdueInUse: ExpiryResult['overdueInUse']
  rate: number
  errors: DailyError[]
}): Promise<number> {
  const s = await getSettings()

  // R32 멱등: 같은 날 점검 메일을 두 번 만들지 않는다.
  const { count: already } = await db()
    .from('mail_queue')
    .select('id', { count: 'exact', head: true })
    .eq('kind', 'digest')
    .eq('ref_id', input.today)
  if ((already ?? 0) > 0) return 0

  const { count: pendingApproval } = await db()
    .from('assignments')
    .select('id', { count: 'exact', head: true })
    .eq('status', '신청')
  const { count: waiting } = await db()
    .from('assignments')
    .select('id', { count: 'exact', head: true })
    .eq('status', '승인')
  const { count: openIncidents } = await db()
    .from('incidents')
    .select('id', { count: 'exact', head: true })
    .in('status', ['접수', '처리중'])

  const alerts = await listAlerts()

  const lines: string[] = [
    `AI 유료계정 관리시스템 일일 점검 (${input.today})`,
    '',
    ...digestErrorLines(input.errors),
    `· 승인 대기: ${pendingApproval ?? 0}건`,
    `· 배정 대기(승인·미배정): ${waiting ?? 0}건`,
    `· 오늘 자동 배정: ${input.assigned.length}건`,
    `· 오늘 대여 종료(회수중 전환): ${input.rentEnded.length}건`,
    `· 장애 미처리: ${openIncidents ?? 0}건`,
    `· 정지율: ${input.rate}%${input.rate > s.suspension_rate_warn ? ' ⚠ 업체 협의 필요' : ''}`,
    `· 메일 발송: 성공 ${input.mail.sent} / 실패 ${input.mail.failed} / 대기 ${input.mail.remaining}${mailStopNote(input.mail.stopped)}`,
  ]

  if (input.overdueInUse.length > 0) {
    lines.push('', '■ 만료일 경과·사용중 좌석 — 자동 만료하지 않았습니다. 회수를 완료하면 다음 일일 작업에서 만료 처리됩니다')
    for (const a of input.overdueInUse) lines.push(`  - ${a.id} : 만료일 ${a.expires_on} (현재 ${a.status})`)
  }

  if (input.soon.length > 0) {
    lines.push('', `■ 구독 만료 임박(D-${s.account_expiry_alert_days})`)
    for (const a of input.soon) lines.push(`  - ${a.id} : ${a.expires_on}`)
  }

  if (alerts.length > 0) {
    lines.push('', '■ 회수 대상')
    for (const a of alerts) {
      lines.push(
        `  - [${a.category}] ${a.account_id ?? '-'} (${a.login_email ?? '-'}) / ${a.name} / ${a.program_name} / 종료 ${a.rent_end ?? '-'} (D+${a.elapsed_days}) — ${a.guide}`,
      )
    }
  }

  lines.push('', `관리자 화면: ${process.env.NEXT_PUBLIC_APP_URL ?? ''}/admin`)

  return queueAdminMail({
    subject: `[AI융합원] 일일 점검 (${input.today})`,
    text: lines.join('\n'),
    kind: 'digest',
    refId: input.today,
  })
}

/**
 * 일일 작업 (PRD §11) — 매일 09:00 KST.
 * 순서는 멱등(R32): 같은 날 두 번 실행해도 결과가 같다.
 */
import 'server-only'
import { db } from '@/lib/db'
import { todayKST } from '@/lib/date'
import { getSettings } from '@/lib/settings'
import { rebuildAlerts, listAlerts } from '@/lib/alerts'
import { dispatchQueue } from '@/lib/mail/dispatch'
import { queueAdminMail } from '@/lib/mail/queue'
import { decrypt } from '@/lib/crypto'
import { log } from '@/lib/state'
import {
  autoAssignAll,
  closeFinishedPrograms,
  endExpiredRentals,
  expireUnacknowledged,
} from '@/lib/ops/assignments'
import { processExpiries, refreshAccountStats } from '@/lib/ops/accounts'
import { suspensionRate } from '@/lib/ops/incidents'

export interface DailyResult {
  today: string
  closed_programs: string[]
  ack_overdue: string[]
  rent_ended: string[]
  assigned: string[]
  alerts: number
  mail: { sent: number; failed: number; remaining: number }
  stats_updated: number
  expired_accounts: string[]
  expiring_soon: Array<{ id: string; expires_on: string }>
  suspension_rate: number
  digest_recipients: number
}

export async function runDaily(actor = 'system', today: string = todayKST()): Promise<DailyResult> {
  const s = await getSettings()
  await log(actor, 'cron.daily.start', null, { today })

  // 1. 고정기간 프로그램 자동 종료 (R4)
  const closed = await closeFinishedPrograms(today)

  // 2. 미인수 자동 취소 (R19)
  const ackOverdue = await expireUnacknowledged(s.ack_due_days, today)

  // 3. 대여 종료 → 회수중 + 신규 비밀번호 (R20·R21)
  const rentEnded = await endExpiredRentals(today)

  // 3-1. alerts·accounts.alert 재생성 (R22)
  const alertCount = await rebuildAlerts(today)

  // 4. 승인 대기 자동 배정 (R14)
  const assigned = await autoAssignAll(actor, today)

  // 4-1. 배정으로 알림 대상이 바뀌었을 수 있으므로 다시 계산
  await rebuildAlerts(today)

  // 5. 메일 대기열 발송
  const mail = await dispatchQueue()

  // 6. 계정 통계 갱신 (R25)
  const statsUpdated = await refreshAccountStats(today)

  // 7. 구독 만료 처리 / D-N 임박
  const { expired, soon } = await processExpiries(s.account_expiry_alert_days, today)

  // 8. 관리자 일일 점검 메일
  const rate = await suspensionRate()
  const digest = await sendDigest({ today, ackOverdue, rentEnded, assigned, mail, soon, rate })

  // 점검 메일까지 당일 발송 (대기열에 남기지 않는다)
  if (digest > 0) {
    const extra = await dispatchQueue(digest + 10)
    mail.sent += extra.sent
    mail.failed += extra.failed
    mail.remaining = extra.remaining
  }

  const result: DailyResult = {
    today,
    closed_programs: closed,
    ack_overdue: ackOverdue,
    rent_ended: rentEnded,
    assigned,
    alerts: alertCount,
    mail,
    stats_updated: statsUpdated,
    expired_accounts: expired,
    expiring_soon: soon,
    suspension_rate: rate,
    digest_recipients: digest,
  }
  await log(actor, 'cron.daily.done', null, result as unknown as Record<string, unknown>)
  return result
}

async function sendDigest(input: {
  today: string
  ackOverdue: string[]
  rentEnded: string[]
  assigned: string[]
  mail: { sent: number; failed: number; remaining: number }
  soon: Array<{ id: string; expires_on: string }>
  rate: number
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
    `· 승인 대기: ${pendingApproval ?? 0}건`,
    `· 배정 대기(승인·미배정): ${waiting ?? 0}건`,
    `· 오늘 자동 배정: ${input.assigned.length}건`,
    `· 오늘 대여 종료(회수중 전환): ${input.rentEnded.length}건`,
    `· 미인수 회수: ${input.ackOverdue.length}건`,
    `· 장애 미처리: ${openIncidents ?? 0}건`,
    `· 정지율: ${input.rate}%${input.rate > s.suspension_rate_warn ? ' ⚠ 업체 협의 필요' : ''}`,
    `· 메일 발송: 성공 ${input.mail.sent} / 실패 ${input.mail.failed} / 대기 ${input.mail.remaining}`,
  ]

  if (input.soon.length > 0) {
    lines.push('', `■ 구독 만료 임박(D-${s.account_expiry_alert_days})`)
    for (const a of input.soon) lines.push(`  - ${a.id} : ${a.expires_on}`)
  }

  if (alerts.length > 0) {
    lines.push('', '■ 회수 대상')
    for (const a of alerts) {
      let line = `  - [${a.category}] ${a.account_id ?? '-'} (${a.login_email ?? '-'}) / ${a.name} / ${a.program_name} / 종료 ${a.rent_end ?? '-'} (D+${a.elapsed_days}) — ${a.guide}`
      if (s.show_new_password_in_digest && a.account_id) {
        const { data: sec } = await db()
          .from('account_secrets')
          .select('new_password_enc')
          .eq('account_id', a.account_id)
          .maybeSingle()
        const pw = decrypt(sec?.new_password_enc ?? null)
        if (pw) line += ` / 신규 비밀번호: ${pw}`
      }
      lines.push(line)
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

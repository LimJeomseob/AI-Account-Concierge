/**
 * 월간 실적 스냅샷 (PRD R29, §11)
 */
import 'server-only'
import { db } from '@/lib/db'
import { monthKST, nowKSTText } from '@/lib/date'
import { programCsv, programReport, summaryCsv, summaryReport } from '@/lib/report'
import { queueAdminMail } from '@/lib/mail/queue'
import { dispatchQueue } from '@/lib/mail/dispatch'
import { log } from '@/lib/state'

export interface SnapshotResult {
  month: string
  used_total: number
  recipients: number
}

/** 스냅샷 생성·저장·메일. 같은 달은 갱신(upsert)하여 멱등. */
export async function runMonthly(actor = 'system', month: string = monthKST()): Promise<SnapshotResult> {
  const programs = await programReport()
  const summary = await summaryReport()

  const csvProgram = programCsv(programs)
  const csvSummary = summaryCsv(summary)

  const { error } = await db().from('report_snapshots').upsert(
    {
      month,
      generated_at: new Date().toISOString(),
      metrics: { summary, programs },
      csv_program: csvProgram,
      csv_summary: csvSummary,
    },
    { onConflict: 'month' },
  )
  if (error) throw new Error(error.message)

  const text = [
    `AI 유료계정 관리시스템 월간 실적 스냅샷 (${month})`,
    `생성 시각: ${nowKSTText()}`,
    '',
    `· 누계 사용 인원: ${summary.used_total}명 / 목표 ${summary.target_headcount}명 (달성률 ${summary.achievement_rate}%)`,
    `· 대상별: 교원 ${summary.used_faculty} · 직원 ${summary.used_staff} · 학생 ${summary.used_student} · 지역민 ${summary.used_local}`,
    `· 서비스별: GPT ${summary.used_gpt} · Claude ${summary.used_claude}`,
    `· 계정·월 환산: ${summary.account_months} / 평균 유휴율 ${summary.idle_rate ?? '-'}% / 평균 회전율 ${summary.turnover_avg}회`,
    `· 대기 인원 ${summary.waiting_cnt}명 (평균 ${summary.waiting_days_avg ?? '-'}일) / 미인수율 ${summary.no_ack_rate ?? '-'}%`,
    `· 정지율 ${summary.suspension_rate}% / 계정 가용 ${summary.acc_available} · 배정 ${summary.acc_assigned} · 회수중 ${summary.acc_returning} · 정지 ${summary.acc_suspended} · 만료 ${summary.acc_expired}`,
    '',
    '■ 프로그램별 사용 인원',
    ...programs
      .filter((p) => p.applied_cnt > 0)
      .map((p) => `  - ${p.program_name}: 신청 ${p.applied_cnt} / 배정 ${p.assigned_cnt} / 사용 ${p.used_cnt}`),
    '',
    `CSV 는 관리자 화면 「실적 > 월별 스냅샷」에서 내려받을 수 있습니다.`,
    `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/admin/reports`,
  ].join('\n')

  const recipients = await queueAdminMail({
    subject: `[AI융합원] 월간 실적 스냅샷 (${month})`,
    text,
    kind: 'snapshot',
    refId: month,
  })
  if (recipients > 0) await dispatchQueue(recipients + 10)

  await log(actor, 'cron.monthly', month, { used_total: summary.used_total })
  return { month, used_total: summary.used_total, recipients }
}

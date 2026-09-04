/**
 * 실적 지표 (PRD §10, R29)
 * 화면·CSV·스냅샷이 모두 같은 뷰(v_report_program, v_report_summary)를 사용한다.
 */
import 'server-only'
import { db } from '@/lib/db'
import { getSettings } from '@/lib/settings'

export interface ProgramReportRow {
  program_id: string
  program_name: string
  target: string
  applied_cnt: number
  approved_cnt: number
  assigned_cnt: number
  used_cnt: number
  returned_cnt: number
  used_gpt: number
  used_claude: number
  ack_overdue_cnt: number
  return_rate: number | null
  waiting_cnt: number
  wait_days_avg: number | null
  wait_days_max: number | null
}

export interface SummaryReport {
  used_total: number
  used_faculty: number
  used_staff: number
  used_student: number
  used_local: number
  used_gpt: number
  used_claude: number
  account_months: number
  turnover_avg: number
  idle_rate: number | null
  waiting_cnt: number
  waiting_days_avg: number | null
  no_ack_rate: number | null
  suspension_rate: number
  acc_available: number
  acc_assigned: number
  acc_returning: number
  acc_suspended: number
  acc_expired: number
  acc_total: number
  inc_suspend: number
  inc_login: number
  inc_etc: number
  /** settings.target_headcount */
  target_headcount: number
  /** 달성률(%) */
  achievement_rate: number
}

export async function programReport(): Promise<ProgramReportRow[]> {
  const { data, error } = await db().from('v_report_program').select('*').order('program_id')
  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as ProgramReportRow[]
}

export async function summaryReport(): Promise<SummaryReport> {
  const { data, error } = await db().from('v_report_summary').select('*').single()
  if (error) throw new Error(error.message)
  const s = await getSettings()
  const row = data as unknown as Omit<SummaryReport, 'target_headcount' | 'achievement_rate'>
  const target = s.target_headcount || 0
  return {
    ...row,
    target_headcount: target,
    achievement_rate: target > 0 ? Math.round((row.used_total / target) * 1000) / 10 : 0,
  }
}

// --- CSV --------------------------------------------------------------------

export function toCsv(headers: string[], rows: Array<Array<string | number | null>>): string {
  const esc = (v: string | number | null) => {
    const s = v === null || v === undefined ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  // Excel 한글 깨짐 방지용 BOM
  return '﻿' + [headers.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n')
}

export function programCsv(rows: ProgramReportRow[]): string {
  return toCsv(
    [
      '프로그램ID', '프로그램명', '대상', '신청', '승인', '배정', '사용 인원', '회수완료',
      'GPT 사용', 'Claude 사용', '인수기한초과', '회수 완료율(%)', '대기 인원',
      '승인→배정 평균(일)', '승인→배정 최대(일)',
    ],
    rows.map((r) => [
      r.program_id, r.program_name, r.target, r.applied_cnt, r.approved_cnt, r.assigned_cnt,
      r.used_cnt, r.returned_cnt, r.used_gpt, r.used_claude, r.ack_overdue_cnt, r.return_rate,
      r.waiting_cnt, r.wait_days_avg, r.wait_days_max,
    ]),
  )
}

export function summaryCsv(s: SummaryReport): string {
  return toCsv(
    ['지표', '값'],
    [
      ['누계 사용 인원', s.used_total],
      ['목표 연인원', s.target_headcount],
      ['달성률(%)', s.achievement_rate],
      ['교원 사용 인원', s.used_faculty],
      ['직원 사용 인원', s.used_staff],
      ['학생 사용 인원', s.used_student],
      ['지역민 사용 인원', s.used_local],
      ['GPT 사용 인원', s.used_gpt],
      ['Claude 사용 인원', s.used_claude],
      ['계정·월 환산', s.account_months],
      ['평균 유휴율(%)', s.idle_rate],
      ['평균 회전율(회)', s.turnover_avg],
      ['현재 대기 인원', s.waiting_cnt],
      ['평균 대기일수', s.waiting_days_avg],
      ['미인수율(%)', s.no_ack_rate],
      ['정지율(%)', s.suspension_rate],
      ['계정 가용', s.acc_available],
      ['계정 배정', s.acc_assigned],
      ['계정 회수중', s.acc_returning],
      ['계정 정지', s.acc_suspended],
      ['계정 만료', s.acc_expired],
      ['계정 전체', s.acc_total],
      ['장애 정지', s.inc_suspend],
      ['장애 로그인불가', s.inc_login],
      ['장애 기타', s.inc_etc],
    ],
  )
}

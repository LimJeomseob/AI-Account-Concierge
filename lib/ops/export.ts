/**
 * 신청자 목록 내려받기 (관리자 전용) — 메일 발송 명단·보고용.
 * 2026-10-28: 신청자 자동 메일(R11·R16) 폐지로 담당자가 직접 안내하므로, 신청·배정 화면의
 * 필터 결과를 그대로 CSV 로 내려받거나 이메일만 복사할 수 있게 한다.
 * 접속 링크(account_secrets.access_url)는 포함하지 않는다.
 */
import { toKSTDate } from '@/lib/date'
import { toCsv } from '@/lib/report'

export interface ApplicantRow {
  id: string
  name: string
  email: string
  program_id: string
  service_wish: string
  account_id: string | null
  service: string | null
  status: string
  applied_at: string
  rent_start: string | null
  rent_end: string | null
  programs?: { name: string } | null
  users?: { affiliation: string | null; type: string } | null
}

/** 신청·배정 화면과 동일한 필터 (assignments/page.tsx) */
export interface ApplicantFilter {
  status?: string
  program?: string
  q?: string
}

export const APPLICANT_SELECT =
  'id, name, email, program_id, service_wish, account_id, service, status, applied_at, rent_start, rent_end, programs(name), users(affiliation, type)'

export const APPLICANT_CSV_HEADERS = [
  '접수번호',
  '프로그램',
  '이름',
  '이메일',
  '소속',
  '구분',
  '희망',
  '계정',
  '상태',
  '대여시작',
  '대여종료',
  '신청일',
] as const

export function applicantCsv(rows: ApplicantRow[]): string {
  return toCsv(
    [...APPLICANT_CSV_HEADERS],
    rows.map((r) => [
      r.id,
      r.programs?.name ?? r.program_id,
      r.name,
      r.email,
      r.users?.affiliation ?? '',
      r.users?.type ?? '',
      r.service_wish,
      r.account_id ? `${r.account_id} (${r.service ?? '-'})` : '',
      r.status,
      r.rent_start ?? '',
      r.rent_end ?? '',
      toKSTDate(r.applied_at) ?? '',
    ]),
  )
}

/** 메일 수신자란에 붙여 넣을 이메일 목록 — 중복·파기 계정 제외, 소문자 */
export function applicantEmails(rows: Array<Pick<ApplicantRow, 'email'>>): string[] {
  const seen = new Set<string>()
  for (const r of rows) {
    const e = (r.email ?? '').trim().toLowerCase()
    if (!e || e.endsWith('@purged.local')) continue
    seen.add(e)
  }
  return [...seen]
}

/** 필터 → 내려받기 URL 쿼리 (빈 값은 생략) */
export function exportQuery(f: ApplicantFilter): string {
  const p = new URLSearchParams()
  if (f.status) p.set('status', f.status)
  if (f.program) p.set('program', f.program)
  if (f.q) p.set('q', f.q)
  const s = p.toString()
  return s ? `?${s}` : ''
}

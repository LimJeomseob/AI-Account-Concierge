/**
 * 유료계정 사용현황 CSV 내려받기 (관리자 전용) — 사용현황 보고·메일 발송 명단용.
 * 2026-10-29: 사용현황 화면 개편에 맞춰 플랫폼·계정번호·사용 개시 열을 추가했다.
 * 2026-10-28: 신청자 자동 메일(R11·R16) 폐지로 담당자가 직접 안내하므로, 신청·배정 화면의
 * 필터 결과를 그대로 CSV 로 내려받거나 이메일만 복사할 수 있게 한다.
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
  acknowledged_at?: string | null
  programs?: { name: string } | null
  /** type 은 기관관리자 등록 건이면 공란(0007) */
  users?: { affiliation: string | null; type: string | null } | null
}

export { FILTER_KEYS, applyFilter, exportQuery, likePattern, parseFilter, type ApplicantFilter } from '@/lib/filter'

export const APPLICANT_SELECT =
  'id, name, email, program_id, service_wish, account_id, service, status, applied_at, rent_start, rent_end, acknowledged_at, programs(name), users(affiliation, type)'

export const APPLICANT_CSV_HEADERS = [
  '접수번호',
  '프로그램',
  '이름',
  '이메일',
  '소속',
  '구분',
  '플랫폼',
  '계정번호',
  '상태',
  '희망',
  '신청일',
  '사용개시',
  '대여시작',
  '대여종료',
] as const

const PLATFORM_LABEL: Record<string, string> = { GPT: 'ChatGPT', Claude: 'Claude' }

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
      r.service ? PLATFORM_LABEL[r.service] ?? r.service : '',
      r.account_id ?? '',
      r.status,
      r.service_wish,
      toKSTDate(r.applied_at) ?? '',
      toKSTDate(r.acknowledged_at ?? null) ?? '',
      r.rent_start ?? '',
      r.rent_end ?? '',
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

/** 「승인 건 배정 + 메일 내려받기」 결과 CSV — 이름·이메일·계정번호 (팀 워크스페이스 초대용).
 *  계정번호가 없으면(가용 계정 부족으로 승인 대기) 「(대기)」로 적는다 */
export function assignedCsv(rows: Array<{ name: string; email: string; account_id: string | null }>): string {
  return toCsv(['이름', '이메일', '계정번호'], rows.map((r) => [r.name, r.email, r.account_id ?? '(대기)']))
}

/** 「선택 승인 + 배정 + 이메일 내려받기」 결과 문구 (순수 함수) */
export function approveAssignMessage(approved: number, assigned: number, waiting: number): string {
  if (approved === 0 && assigned === 0) return '선택한 건 중 승인할 「신청」 건이 없습니다.'
  const parts = [`${approved}명 승인`, `${assigned}명 배정`]
  if (waiting > 0) parts.push(`${waiting}명 계정 대기(「승인」으로 남음)`)
  return `${parts.join(' · ')} — 내려받은 이메일을 팀 워크스페이스에 초대해 주세요.`
}

/** 배정 결과 안내 문구 (순수 함수) */
export function assignExportMessage(assigned: number, noPeriod: number, shortage: number): string {
  const parts: string[] = []
  if (assigned > 0) parts.push(`${assigned}명 배정 — 내려받은 이메일을 팀 워크스페이스에 초대해 주세요.`)
  if (shortage > 0) parts.push(`${shortage}명은 가용 계정이 없거나 배정상한에 걸려 「승인」 대기로 남았습니다.`)
  if (noPeriod > 0) parts.push(`${noPeriod}명은 프로그램이 진행중이 아니거나 대여기간이 없어 배정하지 않았습니다.`)
  if (parts.length === 0) parts.push('현재 목록에 배정할 「승인」 건이 없습니다.')
  return parts.join(' ')
}

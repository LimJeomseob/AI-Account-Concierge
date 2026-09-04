/** 도메인 타입 (PRD §4·§5) */

export type Service = 'GPT' | 'Claude'
export type ServiceWish = Service | '무관'
export type AccountKind = '운영' | '예비'
export type AccountStatus = '가용' | '배정' | '회수중' | '정지' | '만료'
export type PasswordStatus = '정상' | '변경대기'
export type ProgramTarget = '교원' | '직원' | '학생' | '지역민' | '혼합'
export type ProgramMode = '고정기간' | '배정일기준'
export type ProgramStatus = '진행' | '종료'
export type UserType = '교원' | '직원' | '학생' | '지역민'
export type AssignmentStatus =
  | '신청' | '승인' | '배정' | '사용중' | '회수중' | '회수완료' | '반려' | '취소' | '인수기한초과'
export type IncidentType = '정지' | '로그인불가' | '기타'
export type IncidentStatus = '접수' | '처리중' | '완료'
export type MailKind = 'assignment' | 'intake' | 'digest' | 'incident' | 'snapshot'
export type MailStatus = 'pending' | 'sent' | 'failed'

export interface Program {
  id: string
  name: string
  target: ProgramTarget
  mode: ProgramMode
  days: number
  start_on: string | null
  end_on: string | null
  cap: number
  status: ProgramStatus
  note: string | null
  created_at?: string
}

export interface Account {
  id: string
  service: Service
  kind: AccountKind
  activated_on: string | null
  expires_on: string | null
  status: AccountStatus
  current_assignment_id: string | null
  assigned_days: number
  assigned_count: number
  note: string | null
  alert: string | null
  updated_at?: string
}

export interface AccountSecret {
  account_id: string
  login_email: string | null
  password_enc: string | null
  new_password_enc: string | null
  password_status: PasswordStatus
  password_changed_at: string | null
  owns_registered_email: boolean
  two_fa: string | null
  note: string | null
}

export interface Assignment {
  id: string
  program_id: string
  user_id: string
  name: string
  email: string
  service_wish: ServiceWish
  account_id: string | null
  service: Service | null
  status: AssignmentStatus
  applied_at: string
  edu_watched_at: string | null
  approved_on: string | null
  approved_by: string | null
  assigned_on: string | null
  rent_start: string | null
  rent_end: string | null
  notified_at: string | null
  acknowledged_at: string | null
  returned_at: string | null
  chk_delete_chats: boolean
  chk_delete_memory: boolean
  chk_logout_all: boolean
  chk_history_review: boolean
  chk_password_changed: boolean
  note: string | null
  updated_at?: string
}

export interface AppUser {
  id: string
  name: string
  affiliation: string | null
  type: UserType
  email: string
  phone: string | null
  has_paid: boolean
  privacy_consented_at: string | null
  first_applied_at: string | null
  purged_at: string | null
}

/** 대여기간 */
export interface Period {
  start: string
  end: string
}

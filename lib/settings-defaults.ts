/**
 * 운영 설정의 타입과 기본값 (PRD §4-1 settings)
 *
 * 이 파일에는 'server-only' 를 두지 않는다.
 * scripts/seed.ts 처럼 Next.js 밖(tsx·node)에서도 불러오기 때문이다.
 * DB 접근이 필요한 함수는 lib/settings.ts 에 있다.
 */

export interface Settings {
  ack_due_days: number
  account_expiry_alert_days: number
  suspension_rate_warn: number
  admin_emails: string[]
  reply_to: string
  from_name: string
  from_email: string
  edu_url: string
  rules_url: string
  pledge_url: string
  privacy_items: string
  privacy_purpose: string
  privacy_period: string
  auto_assign_on_approve: boolean
  target_headcount: number
  program_id_prefix: string
  signup_origins: string[]
}

export const DEFAULT_SETTINGS: Settings = {
  ack_due_days: 2,
  account_expiry_alert_days: 14,
  suspension_rate_warn: 5,
  admin_emails: [],
  reply_to: '',
  from_name: '경상국립대학교 AI융합원',
  from_email: 'noreply@example.ac.kr',
  edu_url: 'https://www.youtube.com/watch?v=XzMC4jGM_P0&t=2s',
  rules_url: '',
  pledge_url: '',
  privacy_items: '이름, 소속, 구분, 이메일, 연락처',
  privacy_purpose: 'AI 유료계정 배정·안내 및 실적 관리',
  privacy_period: '사업 종료 후 1년',
  auto_assign_on_approve: true,
  target_headcount: 600,
  program_id_prefix: 'P26',
  signup_origins: [],
}

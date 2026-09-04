/**
 * 운영 설정 (PRD §4-1 settings)
 */
import 'server-only'
import { db } from '@/lib/db'

export interface Settings {
  ack_due_days: number
  account_expiry_alert_days: number
  password_length: number
  show_new_password_in_digest: boolean
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
  password_length: 10,
  show_new_password_in_digest: false,
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

/** settings 테이블 전체를 읽어 기본값과 병합 */
export async function getSettings(): Promise<Settings> {
  const { data, error } = await db().from('settings').select('key, value')
  if (error) throw new Error(error.message)
  const merged: Record<string, unknown> = { ...DEFAULT_SETTINGS }
  for (const row of data ?? []) {
    if (row.key in DEFAULT_SETTINGS) merged[row.key] = row.value
  }
  return merged as unknown as Settings
}

export async function setSetting(key: keyof Settings, value: unknown): Promise<void> {
  const { error } = await db()
    .from('settings')
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' })
  if (error) throw new Error(error.message)
}

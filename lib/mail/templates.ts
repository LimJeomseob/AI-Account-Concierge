/**
 * 기본 메일 문구 (PRD §8) — 시드 값.
 * 2026-10-28: 신청자 메일(배정안내·접수안내) 폐지로 시드 템플릿이 없다.
 * mail_templates 테이블과 이 타입은 관리자 메일 문구를 나중에 편집 가능하게 할 때를 위해 남겨 둔다.
 */

export interface MailTemplate {
  key: string
  subject: string
  body: string
  placeholders: string
}

export const DEFAULT_TEMPLATES: MailTemplate[] = []

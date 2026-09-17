/**
 * 메일 발송 (PRD §4-1 mail_queue, R? 일일 작업 5단계)
 * - Resend 일일 한도(Free 100통)를 넘지 않도록 대기열에서 순차 발송
 * - 실패는 다음 일일 작업에서 재시도, 5회 초과 시 failed
 * - 발송 완료 시 본문 삭제(§13: 접속 링크 잔존 방지)
 */
import 'server-only'
import { Resend } from 'resend'
import { db } from '@/lib/db'
import { getSettings } from '@/lib/settings'
import { log } from '@/lib/state'

const MAX_ATTEMPTS = 5
/** 1회 실행당 기본 발송 상한 (Resend Free 일일 100통 대비 여유분) */
export const DEFAULT_BATCH = 90

export interface DispatchResult {
  sent: number
  failed: number
  remaining: number
}

export async function dispatchQueue(limit = DEFAULT_BATCH): Promise<DispatchResult> {
  const s = await getSettings()
  const apiKey = process.env.RESEND_API_KEY

  const { data: rows, error } = await db()
    .from('mail_queue')
    .select('id, to_email, subject, body_text, body_html, kind, ref_id, attempts')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(limit)
  if (error) throw new Error(error.message)

  let sent = 0
  let failed = 0

  if (rows && rows.length > 0) {
    if (!apiKey) {
      // 개발 환경: 발송하지 않고 대기열에 남긴다.
      await log('system', 'mail.dispatch.skip', null, { reason: 'RESEND_API_KEY 없음', count: rows.length })
    } else {
      const resend = new Resend(apiKey)
      for (const row of rows) {
        try {
          const res = await resend.emails.send({
            from: `${s.from_name} <${s.from_email}>`,
            to: row.to_email,
            subject: row.subject,
            text: row.body_text ?? '',
            html: row.body_html ?? undefined,
            ...(s.reply_to ? { replyTo: s.reply_to } : {}),
          })
          if (res.error) throw new Error(res.error.message)
          await db()
            .from('mail_queue')
            .update({
              status: 'sent',
              sent_at: new Date().toISOString(),
              // 본문(접속 링크 포함 가능)은 발송 후 삭제
              body_text: null,
              body_html: null,
              last_error: null,
            })
            .eq('id', row.id)
          sent += 1
        } catch (e) {
          const attempts = row.attempts + 1
          const status = attempts >= MAX_ATTEMPTS ? 'failed' : 'pending'
          if (status === 'failed') failed += 1
          await db()
            .from('mail_queue')
            .update({ attempts, status, last_error: (e as Error).message.slice(0, 500) })
            .eq('id', row.id)
        }
      }
    }
  }

  const { count } = await db()
    .from('mail_queue')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending')

  await log('system', 'mail.dispatch', null, { sent, failed, remaining: count ?? 0 })
  return { sent, failed, remaining: count ?? 0 }
}

/** 설정 화면의 「발신 테스트 메일」 */
export async function sendTestMail(to: string): Promise<void> {
  const s = await getSettings()
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) throw new Error('RESEND_API_KEY 환경변수가 없습니다.')
  const resend = new Resend(apiKey)
  const res = await resend.emails.send({
    from: `${s.from_name} <${s.from_email}>`,
    to,
    subject: '[AI융합원] 발신 테스트 메일',
    text: 'AI 유료계정 관리시스템 발신 설정이 정상입니다.',
    ...(s.reply_to ? { replyTo: s.reply_to } : {}),
  })
  if (res.error) throw new Error(res.error.message)
}

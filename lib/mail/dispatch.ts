/**
 * 메일 발송 (PRD §4-1 mail_queue, 일일 작업 5단계)
 * - Gmail SMTP(앱 비밀번호)로 대기열에서 순차 발송. 개인 Gmail 일일 한도(약 500통)를 넘지 않도록 배치 상한을 둔다
 * - 실패는 다음 일일 작업에서 재시도, 5회 초과 시 failed
 * - Gmail 일일 한도 오류가 나면 그 자리에서 중단해 나머지 행의 재시도 횟수를 소모하지 않는다
 * - 발송 완료 시 본문 삭제(§13: 접속 링크 잔존 방지)
 * - From 은 Gmail 이 인증 계정(GMAIL_USER)으로 강제하므로 settings.from_email 은 쓰지 않는다
 */
import 'server-only'
import nodemailer from 'nodemailer'
import type { Transporter } from 'nodemailer'
import { db } from '@/lib/db'
import { getSettings } from '@/lib/settings'
import { log } from '@/lib/state'

const MAX_ATTEMPTS = 5
/** 1회 실행당 기본 발송 상한 (Gmail 일일 약 500통 대비 여유분 + 순차 SMTP 실행 시간 고려) */
export const DEFAULT_BATCH = 200

/** Gmail 이 일일 한도 초과를 알리는 응답 (550 5.4.5 Daily user sending limit exceeded / 421 임시 차단) */
const GMAIL_LIMIT_RE = /5\.4\.5|Daily user sending limit|^421|too many/i

export interface DispatchResult {
  sent: number
  failed: number
  remaining: number
}

function gmailCredentials(): { user: string; pass: string } | null {
  const user = process.env.GMAIL_USER?.trim()
  // Google 이 보여주는 앱 비밀번호는 4자리씩 띄어 쓰므로 공백을 지워 쓴다
  const pass = process.env.GMAIL_APP_PASSWORD?.replace(/\s+/g, '')
  return user && pass ? { user, pass } : null
}

function createTransporter(auth: { user: string; pass: string }): Transporter {
  return nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    pool: true,
    auth,
  })
}

export async function dispatchQueue(limit = DEFAULT_BATCH): Promise<DispatchResult> {
  const s = await getSettings()
  const cred = gmailCredentials()

  const { data: rows, error } = await db()
    .from('mail_queue')
    .select('id, to_email, subject, body_text, body_html, kind, ref_id, attempts')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(limit)
  if (error) throw new Error(error.message)

  let sent = 0
  let failed = 0
  let stopped: string | undefined

  if (rows && rows.length > 0) {
    if (!cred) {
      // 개발 환경·통합 테스트: 발송하지 않고 대기열에 남긴다.
      await log('system', 'mail.dispatch.skip', null, { reason: 'GMAIL_APP_PASSWORD 없음', count: rows.length })
    } else {
      const transporter = createTransporter(cred)
      try {
        for (const row of rows) {
          try {
            await transporter.sendMail({
              from: `${s.from_name} <${cred.user}>`,
              to: row.to_email,
              subject: row.subject,
              text: row.body_text ?? '',
              html: row.body_html ?? undefined,
              ...(s.reply_to ? { replyTo: s.reply_to } : {}),
            })
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
            const message = (e as Error).message ?? String(e)
            if (GMAIL_LIMIT_RE.test(message)) {
              // 한도 초과: 이 행은 그대로 두고 오늘은 여기서 멈춘다 (다음 일일 작업에서 재시도)
              await db().from('mail_queue').update({ last_error: message.slice(0, 500) }).eq('id', row.id)
              stopped = 'gmail-limit'
              break
            }
            const attempts = row.attempts + 1
            const status = attempts >= MAX_ATTEMPTS ? 'failed' : 'pending'
            if (status === 'failed') failed += 1
            await db()
              .from('mail_queue')
              .update({ attempts, status, last_error: message.slice(0, 500) })
              .eq('id', row.id)
          }
        }
      } finally {
        transporter.close()
      }
    }
  }

  const { count } = await db()
    .from('mail_queue')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending')

  await log('system', 'mail.dispatch', null, { sent, failed, remaining: count ?? 0, ...(stopped ? { stopped } : {}) })
  return { sent, failed, remaining: count ?? 0 }
}

/** 설정 화면의 「발신 테스트 메일」 */
export async function sendTestMail(to: string): Promise<void> {
  const s = await getSettings()
  const cred = gmailCredentials()
  if (!cred) throw new Error('GMAIL_USER / GMAIL_APP_PASSWORD 환경변수가 없습니다.')
  const transporter = createTransporter(cred)
  try {
    await transporter.sendMail({
      from: `${s.from_name} <${cred.user}>`,
      to,
      subject: '[AI융합원] 발신 테스트 메일',
      text: 'AI 유료계정 관리시스템 발신 설정이 정상입니다.',
      ...(s.reply_to ? { replyTo: s.reply_to } : {}),
    })
  } finally {
    transporter.close()
  }
}

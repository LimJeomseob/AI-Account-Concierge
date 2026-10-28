/**
 * 메일 발송 (PRD §4-1 mail_queue, 일일 작업 5단계)
 * - Gmail SMTP(앱 비밀번호)로 대기열에서 순차 발송. 개인 Gmail 일일 한도(약 500통)를 넘지 않도록 배치 상한을 둔다
 * - 실패는 다음 일일 작업에서 재시도, 5회 초과 시 failed(본문 삭제)
 * - Gmail 일일 한도·인증 오류는 그 자리에서 중단해 나머지 행의 재시도 횟수를 소모하지 않는다
 *   (앱 비밀번호가 틀리면 모든 행이 5일 만에 failed 가 되던 문제)
 * - 실행 잠금(lib/lock.ts) — 일일 작업·월간 스냅샷이 동시에 발송해 같은 행을 두 번 보내지 않게
 * - 발송 완료 시 본문 삭제(§13: 접속 링크 잔존 방지)
 * - From 은 Gmail 이 인증 계정(GMAIL_USER)으로 강제하므로 settings.from_email 은 쓰지 않는다
 */
import 'server-only'
import nodemailer from 'nodemailer'
import type { Transporter } from 'nodemailer'
import { db } from '@/lib/db'
import { getSettings } from '@/lib/settings'
import { log } from '@/lib/state'
import { withLock } from '@/lib/lock'

const MAX_ATTEMPTS = 5
/** 1회 실행당 기본 발송 상한 (Gmail 일일 약 500통 대비 여유분 + 순차 SMTP 실행 시간 고려) */
export const DEFAULT_BATCH = 200

export type MailErrorKind = 'auth' | 'limit' | 'retry'

/**
 * SMTP 오류 분류 (순수 함수).
 *  - auth : 계정·앱 비밀번호 문제(EAUTH, 535, 5.7.8) — 재시도해도 같은 결과. 즉시 중단
 *  - limit: Gmail 일일 한도(550 5.4.5) 또는 임시 차단(421 4.7.x) — 오늘은 중단, 내일 재시도
 *  - retry: 그 밖의 개별 실패 — 행마다 재시도 횟수 소모
 * 「too many」 처럼 막연한 문구는 인증 오류(Too many login attempts)와 겹쳐 쓰지 않는다.
 */
export function classifyMailError(err: { message?: string; code?: string; responseCode?: number } | string): MailErrorKind {
  const e = typeof err === 'string' ? { message: err } : err
  const msg = e.message ?? ''
  if (e.code === 'EAUTH' || e.responseCode === 535 || /\b535\b|5\.7\.8|Username and Password not accepted|Application-specific password required/i.test(msg)) {
    return 'auth'
  }
  if (/5\.4\.5|Daily user sending limit|\b421[ -]4\.7\.\d/i.test(msg) || (e.responseCode === 421 && /4\.7\.\d/.test(msg))) {
    return 'limit'
  }
  return 'retry'
}

export interface DispatchResult {
  sent: number
  failed: number
  remaining: number
  /** 발송을 중간에 멈춘 이유 — 점검 메일·대시보드에 표시 */
  stopped?: 'auth' | 'limit' | 'locked'
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

/** 발송 잠금 TTL — 배치 200통 순차 SMTP 기준 넉넉히 */
const DISPATCH_LOCK_TTL_MS = 10 * 60 * 1000

async function pendingCount(): Promise<number> {
  const { count } = await db().from('mail_queue').select('id', { count: 'exact', head: true }).eq('status', 'pending')
  return count ?? 0
}

export async function dispatchQueue(limit = DEFAULT_BATCH): Promise<DispatchResult> {
  const r = await withLock('mail.dispatch', DISPATCH_LOCK_TTL_MS, () => dispatchUnlocked(limit))
  if (r.locked) {
    await log('system', 'mail.dispatch.skip', null, { reason: 'locked' })
    return { sent: 0, failed: 0, remaining: await pendingCount(), stopped: 'locked' }
  }
  return r.value
}

async function dispatchUnlocked(limit: number): Promise<DispatchResult> {
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
  let stopped: DispatchResult['stopped']

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
            sent += 1
            const { error: upErr } = await db()
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
            if (upErr) {
              // 발송은 됐는데 「sent」 기록에 실패 → 다음 실행에서 다시 보낼 수 있으므로 남겨 둔다
              console.error('[mail.dispatch] 발송 후 상태 갱신 실패:', row.id, upErr.message)
              await log('system', 'mail.dispatch.update_failed', String(row.id), { message: upErr.message })
            }
          } catch (e) {
            const err = e as { message?: string; code?: string; responseCode?: number }
            const message = (err.message ?? String(e)).slice(0, 500)
            const kind = classifyMailError(err)
            if (kind !== 'retry') {
              // 한도 초과·인증 실패: 이 행은 그대로 두고 여기서 멈춘다 (재시도 횟수 소모 없음)
              await db().from('mail_queue').update({ last_error: message }).eq('id', row.id)
              stopped = kind
              break
            }
            const attempts = row.attempts + 1
            const status = attempts >= MAX_ATTEMPTS ? 'failed' : 'pending'
            if (status === 'failed') failed += 1
            await db()
              .from('mail_queue')
              .update({
                attempts,
                status,
                last_error: message,
                // 최종 실패 행은 본문을 남기지 않는다(§13 — 신고자 이름·이메일 등 잔존 방지)
                ...(status === 'failed' ? { body_text: null, body_html: null } : {}),
              })
              .eq('id', row.id)
          }
        }
      } finally {
        transporter.close()
      }
    }
  }

  const remaining = await pendingCount()
  await log('system', 'mail.dispatch', null, { sent, failed, remaining, ...(stopped ? { stopped } : {}) })
  return { sent, failed, remaining, ...(stopped ? { stopped } : {}) }
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

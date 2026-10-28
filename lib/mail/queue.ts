/**
 * 메일 대기열 (PRD §4-1 mail_queue)
 * 직접 발송 금지 — 여기서 대기열에 넣고 lib/mail/dispatch.ts 가 발송한다.
 * 2026-10-28: 신청자 메일(접수안내 R11·배정안내 R16) 폐지 — 관리자 메일(점검·장애·스냅샷)만 남는다.
 */
import 'server-only'
import { db } from '@/lib/db'
import { getSettings } from '@/lib/settings'
import { textToHtml } from '@/lib/mail/render'
import type { MailKind } from '@/lib/types'

export async function enqueue(opts: {
  to: string
  subject: string
  text: string
  kind: MailKind
  refId?: string | null
}): Promise<void> {
  const { error } = await db().from('mail_queue').insert({
    to_email: opts.to,
    subject: opts.subject,
    body_text: opts.text,
    body_html: textToHtml(opts.text),
    kind: opts.kind,
    ref_id: opts.refId ?? null,
  })
  if (error) throw new Error(`메일 대기열 등록 실패: ${error.message}`)
}

/** 관리자 전원에게 보내는 메일(점검·장애·스냅샷) */
export async function queueAdminMail(opts: {
  subject: string
  text: string
  kind: MailKind
  refId?: string | null
}): Promise<number> {
  const s = await getSettings()
  const recipients = new Set<string>(s.admin_emails.filter(Boolean))
  if (recipients.size === 0) {
    const { data } = await db().from('admins').select('email')
    for (const r of data ?? []) recipients.add(r.email)
  }
  for (const to of recipients) {
    await enqueue({ to, subject: opts.subject, text: opts.text, kind: opts.kind, refId: opts.refId })
  }
  return recipients.size
}

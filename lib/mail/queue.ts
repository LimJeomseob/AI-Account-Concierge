/**
 * 메일 대기열 (PRD §4-1 mail_queue, R11·R16)
 * 직접 발송 금지 — 여기서 대기열에 넣고 lib/mail/dispatch.ts 가 발송한다.
 */
import 'server-only'
import { db } from '@/lib/db'
import { decrypt } from '@/lib/crypto'
import { formatKorean } from '@/lib/date'
import { SERVICE_INFO } from '@/lib/labels'
import { getSettings } from '@/lib/settings'
import { ackUrl, incidentUrl } from '@/lib/token'
import { renderTemplate, textToHtml, type MailVars } from '@/lib/mail/render'
import { ASSIGNMENT_TEMPLATE, INTAKE_TEMPLATE } from '@/lib/mail/templates'
import { log } from '@/lib/state'
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

async function template(key: string, fallback: { subject: string; body: string }) {
  const { data } = await db().from('mail_templates').select('subject, body').eq('key', key).maybeSingle()
  return { subject: data?.subject ?? fallback.subject, body: data?.body ?? fallback.body }
}

/** 접수안내 메일 (R11) */
export async function queueIntakeMail(assignmentId: string): Promise<void> {
  const s = await getSettings()
  const { data: a } = await db()
    .from('assignments')
    .select('id, name, email, rent_start, rent_end, programs(name)')
    .eq('id', assignmentId)
    .single()
  if (!a) throw new Error(`배정 ${assignmentId} 없음`)

  const programName = (a as unknown as { programs: { name: string } | null }).programs?.name ?? ''
  const period =
    a.rent_start && a.rent_end
      ? `${formatKorean(a.rent_start)} ~ ${formatKorean(a.rent_end)}`
      : '승인 시 안내'
  const vars: MailVars = {
    이름: a.name,
    프로그램명: programName,
    접수번호: a.id,
    대여기간: period,
    대여시작일: formatKorean(a.rent_start),
    대여종료일: formatKorean(a.rent_end),
    윤리가이드라인URL: s.edu_url,
  }
  const t = await template('접수안내', INTAKE_TEMPLATE)
  await enqueue({
    to: a.email,
    subject: renderTemplate(t.subject, vars),
    text: renderTemplate(t.body, vars),
    kind: 'intake',
    refId: a.id,
  })
}

/**
 * 배정안내 메일 (R16).
 * password_status 가 「변경대기」인 계정은 발송 보류(false 반환).
 */
export async function queueAssignmentMail(assignmentId: string): Promise<boolean> {
  const s = await getSettings()
  const base = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

  const { data: a } = await db()
    .from('assignments')
    .select('id, name, email, account_id, service, rent_start, rent_end, programs(name)')
    .eq('id', assignmentId)
    .single()
  if (!a || !a.account_id || !a.service) return false

  const { data: sec } = await db()
    .from('account_secrets')
    .select('login_email, password_enc, password_status')
    .eq('account_id', a.account_id)
    .single()
  if (!sec) return false
  if (sec.password_status === '변경대기') {
    await log('system', 'mail.assignment.hold', a.id, {
      account_id: a.account_id,
      reason: '비밀번호 변경대기',
    })
    return false
  }

  const info = SERVICE_INFO[a.service as 'GPT' | 'Claude']
  const programName = (a as unknown as { programs: { name: string } | null }).programs?.name ?? ''
  const vars: MailVars = {
    이름: a.name,
    프로그램명: programName,
    서비스명: info.name,
    로그인URL: info.loginUrl,
    계정ID: a.account_id,
    계정명: sec.login_email ?? '',
    비밀번호: decrypt(sec.password_enc) ?? '',
    대여시작일: formatKorean(a.rent_start),
    대여종료일: formatKorean(a.rent_end),
    인수확인링크: ackUrl(base, a.id),
    장애신고링크: incidentUrl(base, a.id),
    인수기한: s.ack_due_days,
    학습데이터OFF절차: info.optOut,
    회수절차: info.returnSteps,
    이용수칙URL: s.rules_url,
    서약문URL: s.pledge_url,
    접수번호: a.id,
  }
  const t = await template('배정안내', ASSIGNMENT_TEMPLATE)
  await enqueue({
    to: a.email,
    subject: renderTemplate(t.subject, vars),
    text: renderTemplate(t.body, vars),
    kind: 'assignment',
    refId: a.id,
  })
  return true
}

/** 배정안내 메일 미리보기(발송하지 않음) */
export async function previewAssignmentMail(
  assignmentId: string,
): Promise<{ subject: string; text: string } | null> {
  const s = await getSettings()
  const base = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  const { data: a } = await db()
    .from('assignments')
    .select('id, name, email, account_id, service, rent_start, rent_end, programs(name)')
    .eq('id', assignmentId)
    .single()
  if (!a) return null
  const info = a.service ? SERVICE_INFO[a.service as 'GPT' | 'Claude'] : null
  const programName = (a as unknown as { programs: { name: string } | null }).programs?.name ?? ''
  const vars: MailVars = {
    이름: a.name,
    프로그램명: programName,
    서비스명: info?.name ?? '(미배정)',
    로그인URL: info?.loginUrl ?? '',
    계정ID: a.account_id ?? '(미배정)',
    계정명: '(발송 시 삽입)',
    비밀번호: '(발송 시 삽입)',
    대여시작일: formatKorean(a.rent_start),
    대여종료일: formatKorean(a.rent_end),
    인수확인링크: ackUrl(base, a.id),
    장애신고링크: incidentUrl(base, a.id),
    인수기한: s.ack_due_days,
    학습데이터OFF절차: info?.optOut ?? '',
    회수절차: info?.returnSteps ?? '',
    이용수칙URL: s.rules_url,
    서약문URL: s.pledge_url,
    접수번호: a.id,
  }
  const t = await template('배정안내', ASSIGNMENT_TEMPLATE)
  return { subject: renderTemplate(t.subject, vars), text: renderTemplate(t.body, vars) }
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

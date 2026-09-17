'use server'

/**
 * 관리자 Server Actions (PRD §12-2)
 * 모든 액션은 세션 + admins 검사를 먼저 통과해야 한다.
 */
import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { requireAdminAction } from '@/lib/auth'
import { todayKST } from '@/lib/date'
import { log } from '@/lib/state'
import { nextProgramId } from '@/lib/ids'
import { getSettings, setSetting, type Settings } from '@/lib/settings'
import { CHECKLIST_FIELDS, PROGRAM_STATUSES } from '@/lib/labels'
import type { ProgramStatus } from '@/lib/types'
import {
  acknowledge,
  approveAssignments,
  autoAssignAll,
  cancelAssignment,
  completeReturn,
  manualAssign,
  rejectAssignments,
  resendAssignmentMail,
  setChecklist,
} from '@/lib/ops/assignments'
import { importAccounts, parseAccountCsv, setAccessUrl } from '@/lib/ops/accounts'
import { replaceAccount } from '@/lib/ops/incidents'
import { purgeUsers } from '@/lib/ops/privacy'
import { runDaily } from '@/lib/cron/daily'
import { runMonthly } from '@/lib/cron/monthly'
import { sendTestMail } from '@/lib/mail/dispatch'
import { transitionAccount } from '@/lib/state'
import { ACCOUNT_TRANSITIONS, canTransitionAccount } from '@/lib/transitions'
import { PROGRAM_SEED } from '@/lib/seed-data'
import type { AccountStatus, IncidentStatus } from '@/lib/types'

const ids = (fd: FormData) => fd.getAll('ids').map(String).filter(Boolean)
const str = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim()
const num = (fd: FormData, k: string) => Number(str(fd, k) || 0)
const bool = (fd: FormData, k: string) => fd.get(k) === 'on' || fd.get(k) === 'true'

// --- 신청·배정 --------------------------------------------------------------

export async function approveAction(fd: FormData) {
  const actor = await requireAdminAction()
  await approveAssignments(ids(fd), actor)
  revalidatePath('/admin/assignments')
  revalidatePath('/admin/dashboard')
}

export async function rejectAction(fd: FormData) {
  const actor = await requireAdminAction()
  await rejectAssignments(ids(fd), actor, str(fd, 'reason') || '반려')
  revalidatePath('/admin/assignments')
}

export async function cancelAction(fd: FormData) {
  const actor = await requireAdminAction()
  await cancelAssignment(str(fd, 'id'), actor, str(fd, 'reason'))
  revalidatePath('/admin/assignments')
}

export async function ackAction(fd: FormData) {
  const actor = await requireAdminAction()
  await acknowledge(str(fd, 'id'), actor)
  revalidatePath('/admin/assignments')
}

export async function checklistAction(fd: FormData) {
  const actor = await requireAdminAction()
  const field = str(fd, 'field') as (typeof CHECKLIST_FIELDS)[number]
  await setChecklist(str(fd, 'id'), field, bool(fd, 'value'), actor)
  revalidatePath('/admin/assignments')
}

export async function completeReturnAction(fd: FormData) {
  const actor = await requireAdminAction()
  await completeReturn(str(fd, 'id'), actor)
  revalidatePath('/admin/assignments')
  revalidatePath('/admin/accounts')
  revalidatePath('/admin/dashboard')
}

export async function resendMailAction(fd: FormData) {
  const actor = await requireAdminAction()
  await resendAssignmentMail(str(fd, 'id'), actor)
  revalidatePath('/admin/assignments')
}

export async function manualAssignAction(fd: FormData) {
  const actor = await requireAdminAction()
  await manualAssign(str(fd, 'id'), str(fd, 'accountId'), actor)
  revalidatePath('/admin/assignments')
}

export async function autoAssignAction() {
  const actor = await requireAdminAction()
  await autoAssignAll(actor)
  revalidatePath('/admin/assignments')
  revalidatePath('/admin/dashboard')
}

// --- 프로그램 ---------------------------------------------------------------

export async function programSaveAction(fd: FormData) {
  const actor = await requireAdminAction()
  const s = await getSettings()
  const id = str(fd, 'id') || (await nextProgramId(s.program_id_prefix))
  const row = {
    id,
    name: str(fd, 'name'),
    target: str(fd, 'target') || '혼합',
    mode: str(fd, 'mode') || '고정기간',
    days: num(fd, 'days'),
    start_on: str(fd, 'start_on') || null,
    end_on: str(fd, 'end_on') || null,
    cap: num(fd, 'cap'),
    status: parseProgramStatus(str(fd, 'status')) ?? '시작전',
    note: str(fd, 'note') || null,
  }
  const { error } = await db().from('programs').upsert(row, { onConflict: 'id' })
  if (error) throw new Error(error.message)
  await log(actor, 'program.save', id, row)
  revalidatePath('/admin/programs')
}

export async function programSeedAction() {
  const actor = await requireAdminAction()
  const s = await getSettings()
  const { data: existing } = await db().from('programs').select('name')
  const names = new Set((existing ?? []).map((p) => p.name))
  let n = 0
  for (const p of PROGRAM_SEED) {
    if (names.has(p.name)) continue // R6: 이름 중복 시 생략
    const id = await nextProgramId(s.program_id_prefix)
    const { error } = await db().from('programs').insert({
      id,
      name: p.name,
      target: p.target,
      mode: '고정기간',
      days: 0,
      cap: 0,
      status: '시작전',
      note: `${p.group} / ${p.season} / 대여기간 입력 필요`,
    })
    if (error) throw new Error(error.message)
    n += 1
  }
  await log(actor, 'program.seed', null, { inserted: n })
  revalidatePath('/admin/programs')
}

function parseProgramStatus(v: string): ProgramStatus | null {
  return (PROGRAM_STATUSES as readonly string[]).includes(v) ? (v as ProgramStatus) : null
}

/** 프로그램 상태 전환 (시작전·진행중·완료) — 목록 드롭다운에서 즉시 저장. 모든 전환은 관리자 수동 */
export async function programStatusAction(fd: FormData) {
  const actor = await requireAdminAction()
  const id = str(fd, 'id')
  const status = parseProgramStatus(str(fd, 'status'))
  if (!id || !status) throw new Error('잘못된 상태 값입니다.')
  const { data: before } = await db().from('programs').select('status').eq('id', id).maybeSingle()
  const { error } = await db().from('programs').update({ status }).eq('id', id)
  if (error) throw new Error(error.message)
  await log(actor, 'program.status', id, { from: before?.status ?? null, to: status })
  revalidatePath('/admin/programs')
  revalidatePath('/admin/dashboard')
  revalidatePath('/apply')
}

// --- 계정 -------------------------------------------------------------------

export async function accountSaveAction(fd: FormData) {
  const actor = await requireAdminAction()
  const rows = parseAccountCsv(
    [
      '계정ID,서비스,구분,로그인이메일,접속링크,활성화일,만료일',
      [
        str(fd, 'id'),
        str(fd, 'service'),
        str(fd, 'kind'),
        str(fd, 'login_email'),
        str(fd, 'access_url'),
        str(fd, 'activated_on'),
        str(fd, 'expires_on'),
      ]
        .map((v) => `"${v.replace(/"/g, '""')}"`)
        .join(','),
    ].join('\n'),
  )
  await importAccounts(rows, actor)
  revalidatePath('/admin/accounts')
}

export async function accountImportAction(fd: FormData) {
  const actor = await requireAdminAction()
  const csv = str(fd, 'csv')
  if (!csv) throw new Error('CSV 내용이 비어 있습니다.')
  await importAccounts(parseAccountCsv(csv), actor)
  revalidatePath('/admin/accounts')
}

/** 좌석 접속 링크 등록·수정 (R14-2) — 잘못된 형식은 예외 대신 메시지로 돌려준다 */
export async function accountAccessUrlAction(fd: FormData): Promise<{ ok: boolean; msg: string }> {
  const actor = await requireAdminAction()
  const id = str(fd, 'id')
  if (!id) return { ok: false, msg: '계정을 선택해 주세요.' }
  try {
    await setAccessUrl(id, str(fd, 'access_url'), actor)
  } catch (e) {
    return { ok: false, msg: (e as Error).message }
  }
  revalidatePath('/admin/accounts')
  revalidatePath('/admin/dashboard')
  return { ok: true, msg: str(fd, 'access_url').trim() ? `${id}: 접속 링크를 저장했습니다.` : `${id}: 접속 링크를 비웠습니다.` }
}

/**
 * 계정 상태 수동 변경.
 * 허용되지 않는 전이(PRD §5-2)는 예외 대신 메시지로 돌려준다 —
 * Server Action 에서 예외를 던지면 화면 전체가 오류 페이지가 되기 때문.
 */
export async function accountStatusAction(
  fd: FormData,
): Promise<{ ok: boolean; msg: string }> {
  const actor = await requireAdminAction()
  const id = str(fd, 'id')
  const to = str(fd, 'status') as AccountStatus
  if (!id) return { ok: false, msg: '계정을 선택해 주세요.' }

  const { data: row } = await db().from('accounts').select('status').eq('id', id).maybeSingle()
  if (!row) return { ok: false, msg: `계정 ${id} 을(를) 찾을 수 없습니다.` }

  const from = row.status as AccountStatus
  if (from === to) return { ok: true, msg: `${id} 은(는) 이미 「${to}」 입니다.` }
  if (!canTransitionAccount(from, to)) {
    return {
      ok: false,
      msg: `「${from}」 → 「${to}」 로는 바꿀 수 없습니다. ${id} 에서 가능한 상태: ${ACCOUNT_TRANSITIONS[from].join('·')}`,
    }
  }

  try {
    await transitionAccount({ id, to, actor, action: 'account.status', detail: { manual: true } })
  } catch (e) {
    return { ok: false, msg: (e as Error).message }
  }
  revalidatePath('/admin/accounts')
  return { ok: true, msg: `${id}: 「${from}」 → 「${to}」 로 변경했습니다.` }
}

// --- 장애 -------------------------------------------------------------------

export async function incidentReplaceAction(fd: FormData) {
  const actor = await requireAdminAction()
  await replaceAccount(Number(str(fd, 'id')), actor)
  revalidatePath('/admin/incidents')
  revalidatePath('/admin/assignments')
}

export async function incidentStatusAction(fd: FormData) {
  const actor = await requireAdminAction()
  const id = Number(str(fd, 'id'))
  const status = str(fd, 'status') as IncidentStatus
  await db().from('incidents').update({ status }).eq('id', id)
  await log(actor, 'incident.status', String(id), { status })
  revalidatePath('/admin/incidents')
}

// --- 실적·배치 --------------------------------------------------------------

export async function snapshotNowAction() {
  await requireAdminAction()
  const actor = await requireAdminAction()
  await runMonthly(actor)
  revalidatePath('/admin/reports')
}

export async function runDailyAction() {
  const actor = await requireAdminAction()
  await runDaily(actor, todayKST())
  revalidatePath('/admin/dashboard')
  revalidatePath('/admin/assignments')
  revalidatePath('/admin/accounts')
}

// --- 사용자·개인정보 --------------------------------------------------------

export async function purgeAction(fd: FormData) {
  const actor = await requireAdminAction()
  const targets = ids(fd)
  await purgeUsers(targets.length > 0 ? targets : null, actor)
  revalidatePath('/admin/users')
}

// --- 설정 -------------------------------------------------------------------

export async function settingsSaveAction(fd: FormData) {
  const actor = await requireAdminAction()
  const numeric: Array<keyof Settings> = [
    'ack_due_days',
    'account_expiry_alert_days',
    'suspension_rate_warn',
    'target_headcount',
  ]
  const text: Array<keyof Settings> = [
    'reply_to',
    'from_name',
    'from_email',
    'edu_url',
    'rules_url',
    'pledge_url',
    'privacy_items',
    'privacy_purpose',
    'privacy_period',
    'program_id_prefix',
  ]
  for (const k of numeric) await setSetting(k, num(fd, k))
  for (const k of text) await setSetting(k, str(fd, k))
  await setSetting('auto_assign_on_approve', bool(fd, 'auto_assign_on_approve'))
  await setSetting(
    'admin_emails',
    str(fd, 'admin_emails')
      .split(/[\n,]/)
      .map((v) => v.trim().toLowerCase())
      .filter(Boolean),
  )
  await setSetting(
    'signup_origins',
    str(fd, 'signup_origins')
      .split(/[\n,]/)
      .map((v) => v.trim().replace(/\/$/, ''))
      .filter(Boolean),
  )
  await log(actor, 'settings.save', null, {})
  revalidatePath('/admin/settings')
}

export async function templateSaveAction(fd: FormData) {
  const actor = await requireAdminAction()
  const key = str(fd, 'key')
  const { error } = await db()
    .from('mail_templates')
    .upsert(
      { key, subject: str(fd, 'subject'), body: str(fd, 'body'), updated_at: new Date().toISOString() },
      { onConflict: 'key' },
    )
  if (error) throw new Error(error.message)
  await log(actor, 'mail_template.save', key, {})
  revalidatePath('/admin/settings')
}

export async function adminAddAction(fd: FormData) {
  const actor = await requireAdminAction()
  const email = str(fd, 'email').toLowerCase()
  if (!email) throw new Error('이메일을 입력해 주세요.')
  const { error } = await db()
    .from('admins')
    .upsert({ email, name: str(fd, 'name') || null, created_by: actor }, { onConflict: 'email' })
  if (error) throw new Error(error.message)
  await log(actor, 'admin.add', email, {})
  revalidatePath('/admin/settings')
}

export async function adminRemoveAction(fd: FormData) {
  const actor = await requireAdminAction()
  const email = str(fd, 'email').toLowerCase()
  if (email === actor) throw new Error('본인 계정은 삭제할 수 없습니다.')
  const { count } = await db().from('admins').select('email', { count: 'exact', head: true })
  if ((count ?? 0) <= 1) throw new Error('관리자는 최소 1명 이상이어야 합니다.')
  await db().from('admins').delete().eq('email', email)
  await log(actor, 'admin.remove', email, {})
  revalidatePath('/admin/settings')
}

export async function testMailAction(fd: FormData) {
  const actor = await requireAdminAction()
  await sendTestMail(str(fd, 'to') || actor)
  await log(actor, 'mail.test', null, { to: str(fd, 'to') || actor })
  revalidatePath('/admin/settings')
}

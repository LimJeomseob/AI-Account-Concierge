'use server'

/**
 * 관리자 Server Actions (PRD §12-2)
 * 모든 액션은 세션 + admins 검사를 먼저 통과해야 한다.
 */
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { requireAdminAction } from '@/lib/auth'
import { todayKST } from '@/lib/date'
import { log } from '@/lib/state'
import { nextProgramId } from '@/lib/ids'
import { getSettings, setSetting, type Settings } from '@/lib/settings'
import { CHECKLIST_FIELDS, PROGRAM_STATUSES } from '@/lib/labels'
import type { ProgramStatus } from '@/lib/types'
import {
  approveAssignments,
  assignApprovedForExport,
  cancelAssignment,
  cancelMany,
  completeReturn,
  completeReturns,
  startReturns,
  manualAssign,
  setChecklist,
} from '@/lib/ops/assignments'
import { importAccounts, parseAccountCsv } from '@/lib/ops/accounts'
import { approveAssignMessage, assignExportMessage, assignedCsv, bulkMessage, exportQuery, parseFilter } from '@/lib/ops/export'
import { replaceAccount } from '@/lib/ops/incidents'
import { buildPlan, commitPlan } from '@/lib/ops/usage-import'
import { parseUsageCsv, planSummary, type ImportMode, type PlanItem } from '@/lib/usage-import'
import { runDaily } from '@/lib/cron/daily'
import { runMonthly } from '@/lib/cron/monthly'
import { sendTestMail } from '@/lib/mail/dispatch'
import { transitionAccount } from '@/lib/state'
import { MANUAL_ACCOUNT_TRANSITIONS, canManuallySetAccount } from '@/lib/transitions'
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

/**
 * 선택 승인 + 배정 + 이메일 내려받기 (유료계정 사용현황, 2026-10-29)
 * 고른 「신청」 건을 승인(R13)하고 바로 계정을 배정(R12·R14)한 뒤, 고른 사람의 이름·이메일·계정번호 CSV 를 돌려준다.
 * 가용 계정이 모자라 배정되지 못한 건은 「승인」으로 남고 CSV 계정번호 칸은 「(대기)」.
 */
export async function approveAssignExportAction(
  fd: FormData,
): Promise<{ ok: boolean; msg: string; csv?: string; filename?: string }> {
  const actor = await requireAdminAction()
  const selected = ids(fd)
  if (selected.length === 0) return { ok: false, msg: '목록에서 「신청」 건을 하나 이상 선택해 주세요.' }
  try {
    const today = todayKST()
    // 선택 중 「신청」·「승인」 건만 대상 — 이미 사용중인 건을 같이 골라도 CSV 에 섞이지 않게
    const { data: before } = await db().from('assignments').select('id, status').in('id', selected)
    const targets = (before ?? []).filter((x) => ['신청', '승인'].includes(x.status)).map((x) => x.id as string)
    if (targets.length === 0) return { ok: false, msg: '선택한 건 중 「신청」·「승인」 건이 없습니다.' }
    const { approved } = await approveAssignments(targets, actor, today)
    const r = await assignApprovedForExport({}, actor, today, { assignmentIds: targets })
    const { data } = await db()
      .from('assignments')
      .select('id, name, email, account_id, status, applied_at')
      .in('id', targets)
      .in('status', ['승인', '사용중'])
      .order('applied_at', { ascending: true })
    const rows = data ?? []
    const waiting = rows.filter((x) => x.status === '승인').length
    revalidatePath('/admin/assignments')
    revalidatePath('/admin/dashboard')
    revalidatePath('/admin/accounts')
    const msg = approveAssignMessage(approved, r.assigned.length, waiting)
    if (rows.length === 0) return { ok: false, msg }
    return { ok: true, msg, csv: assignedCsv(rows), filename: `approved-${today.replace(/-/g, '')}.csv` }
  } catch (e) {
    return { ok: false, msg: (e as Error).message }
  }
}

/** 사용현황 목록 일괄 처리 후 같은 조회 조건으로 돌아가 결과를 알린다 (back = 현재 조회 쿼리) */
function backWithNotice(fd: FormData, notice: string): never {
  const back = new URLSearchParams(str(fd, 'back').replace(/^\?/, ''))
  const q = exportQuery(parseFilter((k) => back.get(k)))
  revalidatePath('/admin/assignments')
  revalidatePath('/admin/accounts')
  revalidatePath('/admin/dashboard')
  redirect(`/admin/assignments${q}${q ? '&' : '?'}notice=${encodeURIComponent(notice.slice(0, 300))}`)
}

/** 「승인만」 — 선택한 「신청」 건 승인(R13), 배정은 하지 않는다 */
export async function bulkApproveAction(fd: FormData) {
  const actor = await requireAdminAction()
  const { approved } = await approveAssignments(ids(fd), actor)
  backWithNotice(fd, `승인 ${approved}건 (배정은 「승인 대기 일괄 배정」으로)`)
}

/** 선택 회수 시작 — 배정·사용중 → 회수중 */
export async function bulkReturnStartAction(fd: FormData) {
  const actor = await requireAdminAction()
  const r = await startReturns(ids(fd), actor)
  backWithNotice(fd, bulkMessage('회수 시작', r))
}

/** 선택 회수 완료 — 확인창에서 체크 2개(대화·메모리 삭제·팀에서 제거) 완료를 확인한 뒤 호출(R24) */
export async function bulkReturnCompleteAction(fd: FormData) {
  const actor = await requireAdminAction()
  const r = await completeReturns(ids(fd), actor)
  backWithNotice(fd, bulkMessage('회수 완료', r))
}

/** 선택 취소 (R17) */
export async function bulkCancelAction(fd: FormData) {
  const actor = await requireAdminAction()
  const r = await cancelMany(ids(fd), actor, str(fd, 'reason'))
  backWithNotice(fd, bulkMessage('취소', r))
}

// --- 사용현황 CSV 일괄 등록 ---------------------------------------------------

function importInput(fd: FormData): { text: string; mode: ImportMode; program: string | null } {
  const text = String(fd.get('csv') ?? '')
  if (text.length > 1_000_000) throw new Error('파일이 너무 큽니다(1MB 이하).')
  const mode: ImportMode = str(fd, 'mode') === '회수완료' ? '회수완료' : '사용중'
  return { text, mode, program: str(fd, 'program') || null }
}

/** 미리보기 — DB 를 바꾸지 않는다 */
export async function usageImportPreviewAction(
  fd: FormData,
): Promise<{ ok: boolean; msg: string; items?: PlanItem[] }> {
  await requireAdminAction()
  try {
    const { text, mode, program } = importInput(fd)
    const parsed = parseUsageCsv(text)
    if (parsed.error) return { ok: false, msg: parsed.error }
    const items = await buildPlan(parsed.rows, mode, program)
    return { ok: true, msg: planSummary(items), items }
  } catch (e) {
    return { ok: false, msg: (e as Error).message }
  }
}

/** 확정 — 같은 파일로 계획을 다시 세워(그사이 바뀐 DB 반영) 「등록」 행만 처리 */
export async function usageImportCommitAction(fd: FormData): Promise<{ ok: boolean; msg: string }> {
  const actor = await requireAdminAction()
  try {
    const { text, mode, program } = importInput(fd)
    const parsed = parseUsageCsv(text)
    if (parsed.error) return { ok: false, msg: parsed.error }
    const items = await buildPlan(parsed.rows, mode, program)
    const r = await commitPlan(items, mode, actor)
    revalidatePath('/admin/assignments')
    revalidatePath('/admin/accounts')
    revalidatePath('/admin/dashboard')
    revalidatePath('/admin/users')
    const skipped = items.filter((x) => x.action !== 'new').length
    const msg = `${mode} ${r.done}건 등록 · 건너뜀/오류 행 ${skipped}건${r.errors.length > 0 ? ` · 등록 실패 ${r.errors.length}건 (${r.errors.slice(0, 3).join(' / ')})` : ''}`
    return { ok: r.errors.length === 0, msg }
  } catch (e) {
    return { ok: false, msg: (e as Error).message }
  }
}

export async function cancelAction(fd: FormData) {
  const actor = await requireAdminAction()
  await cancelAssignment(str(fd, 'id'), actor, str(fd, 'reason'))
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

export async function manualAssignAction(fd: FormData) {
  const actor = await requireAdminAction()
  await manualAssign(str(fd, 'id'), str(fd, 'accountId'), actor)
  revalidatePath('/admin/assignments')
}

/**
 * R14: 「승인 건 배정 + 메일 내려받기」 — 화면 필터에 걸린 「승인」 건에 계정을 배정하고,
 * 방금 배정된 사람의 이름·이메일·계정번호 CSV 를 돌려준다(브라우저가 파일로 저장).
 * 관리자는 받은 이메일을 팀 워크스페이스(ChatGPT·Claude)에 초대한다.
 */
export async function assignExportAction(
  fd: FormData,
): Promise<{ ok: boolean; msg: string; csv?: string; filename?: string }> {
  const actor = await requireAdminAction()
  try {
    const r = await assignApprovedForExport(parseFilter((k) => str(fd, k)), actor)
    revalidatePath('/admin/assignments')
    revalidatePath('/admin/dashboard')
    revalidatePath('/admin/accounts')
    const msg = assignExportMessage(r.assigned.length, r.noPeriod, r.shortage)
    if (r.assigned.length === 0) return { ok: false, msg }
    return { ok: true, msg, csv: assignedCsv(r.assigned), filename: `assigned-${todayKST().replace(/-/g, '')}.csv` }
  } catch (e) {
    return { ok: false, msg: (e as Error).message }
  }
}

// --- 프로그램 ---------------------------------------------------------------

/**
 * 프로그램 등록·수정. id 가 비어 있으면 신규로 보고 자동 채번(R1).
 * 오류는 예외 대신 메시지로 돌려준다(화면 전체 오류 페이지 방지).
 */
export async function programSaveAction(
  fd: FormData,
): Promise<{ ok: boolean; msg: string; id?: string }> {
  const actor = await requireAdminAction()
  const name = str(fd, 'name')
  if (!name) return { ok: false, msg: '프로그램명을 입력해 주세요.' }

  const s = await getSettings()
  const given = str(fd, 'id')
  const created = !given
  const id = given || (await nextProgramId(s.program_id_prefix))
  const row = {
    id,
    name,
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
  if (error) {
    const msg = /programs_name_key|unique/i.test(error.message)
      ? `같은 이름의 프로그램이 이미 있습니다: ${name}`
      : error.message
    return { ok: false, msg }
  }
  await log(actor, 'program.save', id, { ...row, created })
  revalidatePath('/admin/programs')
  revalidatePath('/apply')
  return { ok: true, id, msg: created ? `${id} 로 등록했습니다.` : `${id} 을(를) 수정했습니다.` }
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
      '계정번호,서비스,구분,로그인이메일,활성화일,만료일',
      [
        str(fd, 'id'),
        str(fd, 'service'),
        str(fd, 'kind'),
        str(fd, 'login_email'),
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
  if (!canManuallySetAccount(from, to)) {
    const allowed = MANUAL_ACCOUNT_TRANSITIONS[from]
    return {
      ok: false,
      msg: `「${from}」 → 「${to}」 는 직접 바꿀 수 없습니다(배정·회수는 유료계정 사용현황 화면에서 처리). ${id} 에서 가능한 상태: ${allowed.length > 0 ? allowed.join('·') : '없음'}`,
    }
  }

  // 정지 → 가용: 이 계정을 아직 쥐고 있는 활성 배정(회수 미완료)이 있으면 먼저 회수를 끝내야 한다 (R24)
  if (to === '가용') {
    const { data: holders } = await db()
      .from('assignments')
      .select('id, status')
      .eq('account_id', id)
      .in('status', ['배정', '사용중', '회수중', '인수기한초과'])
    if (holders && holders.length > 0) {
      const list = holders.map((h) => `${h.id}(${h.status})`).join(', ')
      return { ok: false, msg: `${id} 을(를) 쥔 신청 건이 있어 가용으로 바꿀 수 없습니다: ${list}. 회수 체크리스트를 완료한 뒤 다시 시도해 주세요.` }
    }
  }

  try {
    const ok = await transitionAccount({ id, to, actor, action: 'account.status', expect: [from], detail: { manual: true } })
    if (!ok) return { ok: false, msg: `${id} 의 상태가 그사이 바뀌었습니다. 새로고침 후 다시 시도해 주세요.` }
  } catch (e) {
    return { ok: false, msg: (e as Error).message }
  }
  revalidatePath('/admin/accounts')
  const hint = from === '배정' && to === '정지' ? ' 연결돼 있던 신청 건은 「장애」 메뉴에서 대체 배정해 주세요.' : ''
  return { ok: true, msg: `${id}: 「${from}」 → 「${to}」 로 변경했습니다.${hint}` }
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

// --- 설정 -------------------------------------------------------------------

export async function settingsSaveAction(fd: FormData) {
  const actor = await requireAdminAction()
  const numeric: Array<keyof Settings> = [
    'target_headcount',
    'contract_gpt',
    'contract_claude',
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

/** 발신 테스트 메일 — SMTP 오류는 예외 대신 메시지로 돌려준다(오류 페이지로 넘어가지 않게) */
export async function testMailAction(fd: FormData): Promise<{ ok: boolean; msg: string }> {
  const actor = await requireAdminAction()
  const to = str(fd, 'to').trim() || actor
  try {
    await sendTestMail(to)
  } catch (e) {
    const msg = (e as Error).message ?? String(e)
    await log(actor, 'mail.test.fail', null, { to, error: msg.slice(0, 300) })
    return { ok: false, msg: `발송 실패: ${msg}` }
  }
  await log(actor, 'mail.test', null, { to })
  return { ok: true, msg: `${to} 로 테스트 메일을 보냈습니다.` }
}

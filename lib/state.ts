/**
 * 상태 전이 (PRD §5) — 모든 상태 변경은 이 파일의 transition* 을 통해서만 하고,
 * 항상 logs 에 기록한다 (R31).
 */
import 'server-only'
import { db } from '@/lib/db'
import { canTransitionAccount, canTransitionAssignment } from '@/lib/transitions'
import type { AccountStatus, AssignmentStatus } from '@/lib/types'

// --- 전이표 --------------------------------------------------------------
// 순수 데이터는 lib/transitions.ts 에 있다(클라이언트 컴포넌트도 써야 하므로).
export {
  ACCOUNT_TRANSITIONS,
  ASSIGNMENT_TRANSITIONS,
  accountStatusOptions,
  canTransitionAccount,
  canTransitionAssignment,
} from '@/lib/transitions'

// --- 로그 -------------------------------------------------------------------

export async function log(
  actor: string,
  action: string,
  targetId: string | null,
  detail?: Record<string, unknown>,
): Promise<void> {
  const { error } = await db()
    .from('logs')
    .insert({ actor, action, target_id: targetId, detail: detail ?? null })
  if (error) console.error('[logs] 기록 실패:', error.message)
}

// --- 전이 실행 --------------------------------------------------------------

export async function transitionAssignment(opts: {
  id: string
  to: AssignmentStatus
  actor: string
  action: string
  patch?: Record<string, unknown>
  detail?: Record<string, unknown>
  /** 기대 현재 상태(멱등성 확인용). 다르면 아무것도 하지 않고 false */
  expect?: AssignmentStatus[]
}): Promise<boolean> {
  const { data: row, error } = await db()
    .from('assignments')
    .select('status')
    .eq('id', opts.id)
    .single()
  if (error || !row) throw new Error(`배정 ${opts.id} 없음`)

  const from = row.status as AssignmentStatus
  if (opts.expect && !opts.expect.includes(from)) return false
  if (!canTransitionAssignment(from, opts.to)) {
    throw new Error(`허용되지 않는 상태 전이: ${from} → ${opts.to} (${opts.id})`)
  }

  const patch = { ...(opts.patch ?? {}), status: opts.to, updated_at: new Date().toISOString() }
  // 조건부 갱신(낙관적 잠금): 읽은 뒤 다른 처리가 먼저 상태를 바꿨으면 0행 → false.
  // 동시 자동 배정·장애 대체가 같은 건을 두 번 처리해 계정이 고아가 되는 것을 막는다.
  const { data: updated, error: upErr } = await db()
    .from('assignments')
    .update(patch)
    .eq('id', opts.id)
    .eq('status', from)
    .select('id')
  if (upErr) throw new Error(upErr.message)
  if (!updated || updated.length === 0) return false

  await log(opts.actor, opts.action, opts.id, { from, to: opts.to, ...(opts.detail ?? {}) })
  return true
}

export async function transitionAccount(opts: {
  id: string
  to: AccountStatus
  actor: string
  action: string
  patch?: Record<string, unknown>
  detail?: Record<string, unknown>
  /** 기대 현재 상태. 다르면 아무것도 하지 않고 false */
  expect?: AccountStatus[]
}): Promise<boolean> {
  const { data: row, error } = await db().from('accounts').select('status').eq('id', opts.id).single()
  if (error || !row) throw new Error(`계정 ${opts.id} 없음`)

  const from = row.status as AccountStatus
  if (opts.expect && !opts.expect.includes(from)) return false
  if (!canTransitionAccount(from, opts.to)) {
    throw new Error(`허용되지 않는 계정 상태 전이: ${from} → ${opts.to} (${opts.id})`)
  }
  // PRD §4-2: current_assignment_id 는 배정·회수중일 때만 값이 있다(DB check 제약).
  // 정지·만료·가용으로 갈 때 호출자가 따로 지정하지 않으면 연결을 푼다.
  const keepsLink = opts.to === '배정' || opts.to === '회수중'
  const patch = {
    ...(keepsLink ? {} : { current_assignment_id: null }),
    ...(opts.patch ?? {}),
    status: opts.to,
    updated_at: new Date().toISOString(),
  }
  const { data: updated, error: upErr } = await db()
    .from('accounts')
    .update(patch)
    .eq('id', opts.id)
    .eq('status', from)
    .select('id')
  if (upErr) throw new Error(upErr.message)
  if (!updated || updated.length === 0) return false

  await log(opts.actor, opts.action, opts.id, { from, to: opts.to, ...(opts.detail ?? {}) })
  return true
}

// --- 계정 선점 (R14·R27) ------------------------------------------------------

/**
 * 계정 선점: 「가용」이고 아무 배정에도 연결되지 않은 계정만 「배정」으로 바꾸고 배정ID 를 건다.
 * 한 번의 조건부 UPDATE 라 동시에 두 처리가 같은 계정을 잡을 수 없다. 성공 시에만 로그.
 */
export async function claimAccount(opts: {
  id: string
  assignmentId: string
  actor: string
  action: string
  detail?: Record<string, unknown>
}): Promise<boolean> {
  const { data, error } = await db()
    .from('accounts')
    .update({ status: '배정', current_assignment_id: opts.assignmentId, updated_at: new Date().toISOString() })
    .eq('id', opts.id)
    .eq('status', '가용')
    .is('current_assignment_id', null)
    .select('id')
  if (error) throw new Error(error.message)
  if (!data || data.length === 0) return false
  await log(opts.actor, opts.action, opts.id, {
    from: '가용',
    to: '배정',
    assignment_id: opts.assignmentId,
    ...(opts.detail ?? {}),
  })
  return true
}

/** 선점 해제: 이 배정이 잡아 둔 「배정」 계정만 「가용」으로 되돌린다(다른 배정의 계정은 건드리지 않음). */
export async function releaseClaim(opts: { id: string; assignmentId: string; actor: string; reason: string }): Promise<boolean> {
  const { data, error } = await db()
    .from('accounts')
    .update({ status: '가용', current_assignment_id: null, updated_at: new Date().toISOString() })
    .eq('id', opts.id)
    .eq('status', '배정')
    .eq('current_assignment_id', opts.assignmentId)
    .select('id')
  if (error) throw new Error(error.message)
  if (!data || data.length === 0) return false
  await log(opts.actor, 'account.claim.release', opts.id, {
    from: '배정',
    to: '가용',
    assignment_id: opts.assignmentId,
    reason: opts.reason,
  })
  return true
}

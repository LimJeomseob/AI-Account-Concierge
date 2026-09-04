/**
 * 상태 전이 (PRD §5) — 모든 상태 변경은 이 파일의 transition* 을 통해서만 하고,
 * 항상 logs 에 기록한다 (R31).
 */
import 'server-only'
import { db } from '@/lib/db'
import type { AccountStatus, AssignmentStatus } from '@/lib/types'

// --- 전이표 (순수 데이터, 테스트 대상) --------------------------------------

export const ASSIGNMENT_TRANSITIONS: Record<AssignmentStatus, AssignmentStatus[]> = {
  신청: ['승인', '반려', '취소'],
  승인: ['배정', '취소', '반려'],
  배정: ['사용중', '인수기한초과', '회수중', '취소'],
  사용중: ['회수중', '취소'],
  회수중: ['회수완료', '취소'],
  회수완료: [],
  반려: [],
  취소: [],
  인수기한초과: ['회수중', '회수완료'],
}

export const ACCOUNT_TRANSITIONS: Record<AccountStatus, AccountStatus[]> = {
  가용: ['배정', '정지', '만료'],
  배정: ['회수중', '정지', '만료'],
  회수중: ['가용', '정지', '만료'],
  정지: ['가용', '회수중', '만료'],
  만료: ['가용'],
}

export function canTransitionAssignment(from: AssignmentStatus, to: AssignmentStatus): boolean {
  return from === to || ASSIGNMENT_TRANSITIONS[from].includes(to)
}

export function canTransitionAccount(from: AccountStatus, to: AccountStatus): boolean {
  return from === to || ACCOUNT_TRANSITIONS[from].includes(to)
}

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
  const { error: upErr } = await db().from('assignments').update(patch).eq('id', opts.id)
  if (upErr) throw new Error(upErr.message)

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
}): Promise<boolean> {
  const { data: row, error } = await db().from('accounts').select('status').eq('id', opts.id).single()
  if (error || !row) throw new Error(`계정 ${opts.id} 없음`)

  const from = row.status as AccountStatus
  if (!canTransitionAccount(from, opts.to)) {
    throw new Error(`허용되지 않는 계정 상태 전이: ${from} → ${opts.to} (${opts.id})`)
  }
  const patch = { ...(opts.patch ?? {}), status: opts.to, updated_at: new Date().toISOString() }
  const { error: upErr } = await db().from('accounts').update(patch).eq('id', opts.id)
  if (upErr) throw new Error(upErr.message)

  await log(opts.actor, opts.action, opts.id, { from, to: opts.to, ...(opts.detail ?? {}) })
  return true
}

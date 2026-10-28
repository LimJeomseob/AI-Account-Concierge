/**
 * 신청·승인·배정·회수 운영 (PRD R13~R17, R20, R24)
 * 2026-10-28: 신청자 자동 메일(R16)·인수 확인(R18)·미인수 자동 취소(R19) 폐지 — 배정 즉시 「사용중」
 */
import 'server-only'
import { db } from '@/lib/db'
import { todayKST } from '@/lib/date'
import { capRemaining, isAssignable, periodFor, planAllocations, type PoolAccount, type QueueItem } from '@/lib/assign'
import { getSettings } from '@/lib/settings'
import { claimAccount, log, releaseClaim, transitionAccount, transitionAssignment } from '@/lib/state'
import { CHECKLIST_FIELDS } from '@/lib/labels'
import type { Program, Service } from '@/lib/types'

const ACTIVE_OCCUPYING = ['배정', '사용중', '회수중', '회수완료'] as const

/**
 * 배정 범위 제한 — 통합 테스트 격리용. 운영 코드는 넘기지 않는다(= 전체).
 * 자동 배정은 가용 좌석 전체에서 고르므로, 테스트가 만든 신청이 실제 운영 좌석을 잡거나
 * 회수 후 재배정이 실제 프로그램 대기자에게 테스트 좌석을 주는 일을 막는다.
 */
export interface AssignScope {
  /** 이 좌석들만 배정 풀에 넣는다 */
  accountIds?: string[]
  /** 이 프로그램들만 자동 배정 대상으로 본다 (autoAssignAll·completeReturn 재배정) */
  programIds?: string[]
}

/** 배정 가능한 계정 풀 (가용 ∧ 운영 ∧ 접속 링크 등록) — R14-2 */
export async function availablePool(scope?: AssignScope): Promise<PoolAccount[]> {
  let q = db().from('accounts').select('id, service, kind, expires_on').eq('status', '가용').eq('kind', '운영')
  if (scope?.accountIds) q = q.in('id', scope.accountIds)
  const { data: accs, error } = await q
  if (error) throw new Error(error.message)
  const ids = (accs ?? []).map((a) => a.id)
  if (ids.length === 0) return []
  const { data: secs } = await db()
    .from('account_secrets')
    .select('account_id')
    .in('account_id', ids)
    .not('access_url', 'is', null)
  const ok = new Set((secs ?? []).map((s) => s.account_id))
  return (accs ?? []).filter((a) => ok.has(a.id)) as PoolAccount[]
}

/**
 * 좌석 1개를 승인 건 1개에 배정한다 (R14·R14-2).
 * ① 좌석 선점(조건부, lib/state.ts:claimAccount) → ② 배정 「승인 → 사용중」 전이(조건부).
 * ②가 false 이거나 예외면 ①을 되돌린다 — 좌석이 「배정」인 채로 아무 건에도 연결되지 않는 고아 상태 방지.
 */
async function assignSeat(opts: {
  assignmentId: string
  accountId: string
  actor: string
  action: string
  patch: Record<string, unknown>
  detail?: Record<string, unknown>
}): Promise<boolean> {
  const claimed = await claimAccount({
    id: opts.accountId,
    assignmentId: opts.assignmentId,
    actor: opts.actor,
    action: 'account.assign',
  })
  if (!claimed) return false

  let ok = false
  try {
    ok = await transitionAssignment({
      id: opts.assignmentId,
      to: '사용중',
      actor: opts.actor,
      action: opts.action,
      expect: ['승인'],
      patch: {
        ...opts.patch,
        account_id: opts.accountId,
        acknowledged_at: new Date().toISOString(), // 배정 즉시 사용 개시 (인수 확인 폐지)
      },
      detail: { account_id: opts.accountId, ...(opts.detail ?? {}) },
    })
  } finally {
    if (!ok) {
      await releaseClaim({ id: opts.accountId, assignmentId: opts.assignmentId, actor: opts.actor, reason: 'assign_failed' })
    }
  }
  return ok
}

/**
 * R14: 프로그램 1개에 대한 자동 배정.
 * 반환: 실제로 배정된 배정ID 목록.
 */
export async function autoAssignProgram(
  programId: string,
  actor: string,
  today: string = todayKST(),
  scope?: AssignScope,
): Promise<string[]> {
  if (scope?.programIds && !scope.programIds.includes(programId)) return []
  const { data: program } = await db().from('programs').select('*').eq('id', programId).single()
  if (!program) return []
  const p = program as Program
  if (!isAssignable(p, today)) return []
  const period = periodFor(p, today)
  if (!period) return []

  const { count: occupied } = await db()
    .from('assignments')
    .select('id', { count: 'exact', head: true })
    .eq('program_id', programId)
    .in('status', ACTIVE_OCCUPYING as unknown as string[])

  const left = capRemaining(p.cap, occupied ?? 0)
  if (left <= 0) return []

  const { data: queueRows } = await db()
    .from('assignments')
    .select('id, service_wish, applied_at')
    .eq('program_id', programId)
    .eq('status', '승인')
    .is('account_id', null)
    .order('applied_at', { ascending: true })

  const queue = (queueRows ?? []) as QueueItem[]
  if (queue.length === 0) return []

  const pool = await availablePool(scope)
  const plan = planAllocations({ period, queue, pool, capRemaining: left })

  const assigned: string[] = []
  for (const alloc of plan) {
    const ok = await assignSeat({
      assignmentId: alloc.assignment_id,
      accountId: alloc.account_id,
      actor,
      action: 'assignment.assign',
      patch: {
        service: alloc.service satisfies Service,
        assigned_on: today,
        rent_start: alloc.rent_start,
        rent_end: alloc.rent_end,
      },
      detail: { service: alloc.service, period },
    })
    if (!ok) continue // 좌석을 다른 처리가 먼저 가져갔거나 대기열 상태가 바뀜

    assigned.push(alloc.assignment_id)
  }
  return assigned
}

/** 진행 중인 모든 프로그램에 대해 자동 배정 (일일 작업 4단계) */
export async function autoAssignAll(actor: string, today: string = todayKST(), scope?: AssignScope): Promise<string[]> {
  let q = db().from('programs').select('id').eq('status', '진행중')
  if (scope?.programIds) q = q.in('id', scope.programIds)
  const { data: programs } = await q
  const out: string[] = []
  for (const p of programs ?? []) {
    out.push(...(await autoAssignProgram(p.id, actor, today, scope)))
  }
  return out
}

/** R13: 승인 (+ 설정에 따라 즉시 자동 배정) */
export async function approveAssignments(
  ids: string[],
  actor: string,
  today: string = todayKST(),
  scope?: AssignScope,
): Promise<{ approved: number; assigned: string[] }> {
  const s = await getSettings()
  let approved = 0
  const programIds = new Set<string>()

  for (const id of ids) {
    const { data: row } = await db().from('assignments').select('program_id, status').eq('id', id).single()
    if (!row || row.status !== '신청') continue
    const ok = await transitionAssignment({
      id,
      to: '승인',
      actor,
      action: 'assignment.approve',
      expect: ['신청'],
      patch: { approved_on: today, approved_by: actor },
    })
    if (ok) {
      approved += 1
      programIds.add(row.program_id)
    }
  }

  const assigned: string[] = []
  if (s.auto_assign_on_approve) {
    for (const pid of programIds) assigned.push(...(await autoAssignProgram(pid, actor, today, scope)))
  }
  return { approved, assigned }
}

/** R17: 반려 */
export async function rejectAssignments(ids: string[], actor: string, reason: string): Promise<number> {
  let n = 0
  for (const id of ids) {
    const ok = await transitionAssignment({
      id,
      to: '반려',
      actor,
      action: 'assignment.reject',
      expect: ['신청', '승인'],
      patch: { note: reason },
      detail: { reason },
    })
    if (ok) n += 1
  }
  return n
}

/**
 * R17: 취소. 좌석을 쥐고 있던 건은 「회수중」(회수 체크리스트 R24 를 거쳐야 좌석이 풀림), 아니면 「취소」.
 * 배정 전이를 먼저 하고(조건부), 좌석은 이 건에 연결돼 있을 때만 회수중으로 옮긴다.
 * cancelled_at 을 남겨 실적(R29)에서 제외한다(0005).
 */
export async function cancelAssignment(id: string, actor: string, reason = ''): Promise<void> {
  const { data: a } = await db().from('assignments').select('status, account_id').eq('id', id).single()
  if (!a) throw new Error(`배정 ${id} 없음`)
  if (['회수완료', '반려', '취소'].includes(a.status)) throw new Error(`「${a.status}」 상태인 건은 취소할 수 없습니다.`)

  const note = reason || '관리자 취소'
  const patch = { note, cancelled_at: new Date().toISOString() }
  const holdsSeat = !!a.account_id && !['신청', '승인'].includes(a.status)

  const ok = await transitionAssignment({
    id,
    to: holdsSeat ? '회수중' : '취소',
    actor,
    action: 'assignment.cancel',
    expect: holdsSeat ? ['배정', '사용중', '회수중', '인수기한초과'] : ['신청', '승인'],
    patch,
    detail: { reason: note, ...(holdsSeat ? { account_id: a.account_id } : {}) },
  })
  if (!ok) throw new Error('신청 건 상태가 바뀌었습니다. 새로고침 후 다시 시도해 주세요.')
  if (holdsSeat) await moveAccountToReturning(a.account_id!, id, actor)
}

/**
 * 계정을 회수중으로 옮긴다 (R20).
 * 접근 차단(좌석을 팀에서 제거)은 관리자가 회수 체크리스트 ②로 처리한다(R24).
 */
export async function moveAccountToReturning(
  accountId: string,
  assignmentId: string,
  actor: string,
): Promise<void> {
  const { data: acc } = await db()
    .from('accounts')
    .select('status, current_assignment_id')
    .eq('id', accountId)
    .single()
  if (!acc) return
  // 이 배정이 쥔 좌석이거나, 연결이 풀린 정지 좌석일 때만 옮긴다 — 다른 사람에게 이미 넘어간 좌석을 빼앗지 않는다
  const mine = acc.current_assignment_id === assignmentId
  const orphanSuspended = acc.status === '정지' && acc.current_assignment_id === null
  if (!mine && !orphanSuspended) {
    await log(actor, 'account.returning.skip', accountId, { assignment_id: assignmentId, current: acc.current_assignment_id })
    return
  }
  if (acc.status !== '회수중') {
    await transitionAccount({
      id: accountId,
      to: '회수중',
      actor,
      action: 'account.returning',
      patch: { current_assignment_id: assignmentId },
      detail: { assignment_id: assignmentId },
    })
  }
}

/** R20: 대여 종료 → 회수중 (일일 작업 3단계) */
export async function endExpiredRentals(today: string = todayKST()): Promise<string[]> {
  const { data: rows } = await db()
    .from('assignments')
    .select('id, account_id, rent_end')
    .eq('status', '사용중')
    .not('rent_end', 'is', null)
    .lte('rent_end', today)

  const out: string[] = []
  for (const r of rows ?? []) {
    const ok = await transitionAssignment({
      id: r.id,
      to: '회수중',
      actor: 'system',
      action: 'assignment.rent_end',
      expect: ['사용중'],
      detail: { rent_end: r.rent_end },
    })
    if (!ok) continue // 그사이 다른 처리(취소·장애 대체)가 상태를 바꿈
    if (r.account_id) await moveAccountToReturning(r.account_id, r.id, 'system')
    out.push(r.id)
  }
  return out
}

/** 회수 체크리스트 토글 (R24) */
export async function setChecklist(
  id: string,
  field: (typeof CHECKLIST_FIELDS)[number],
  value: boolean,
  actor: string,
): Promise<void> {
  if (!CHECKLIST_FIELDS.includes(field)) throw new Error('알 수 없는 체크 항목')
  const { data, error } = await db()
    .from('assignments')
    .update({ [field]: value, updated_at: new Date().toISOString() })
    .eq('id', id)
    .in('status', ['회수중', '인수기한초과'])
    .select('id')
  if (error) throw new Error(error.message)
  if (!data || data.length === 0) throw new Error('회수중 상태인 건만 회수 체크리스트를 바꿀 수 있습니다.')
  await log(actor, 'assignment.checklist', id, { field, value })
}

/** R24: 회수 완료 (2개 체크 필수) → 계정 가용 → 즉시 재배정 시도 */
export async function completeReturn(
  id: string,
  actor: string,
  today: string = todayKST(),
  scope?: AssignScope,
): Promise<{ reassigned: string[] }> {
  const { data: a } = await db()
    .from('assignments')
    .select('status, account_id, program_id, chk_delete_chats, chk_team_removed')
    .eq('id', id)
    .single()
  if (!a) throw new Error(`배정 ${id} 없음`)
  const missing = CHECKLIST_FIELDS.filter((f) => !(a as Record<string, unknown>)[f])
  if (missing.length > 0) {
    throw new Error('회수 체크리스트 2개 항목(대화·메모리 삭제, 팀에서 제거)을 모두 완료해야 합니다.')
  }

  const ok = await transitionAssignment({
    id,
    to: '회수완료',
    actor,
    action: 'assignment.return_complete',
    expect: ['회수중', '인수기한초과'],
    patch: { returned_at: new Date().toISOString() },
  })
  if (!ok) throw new Error('이미 회수 완료됐거나 상태가 바뀌었습니다. 새로고침 후 확인해 주세요.')

  if (a.account_id) {
    // 이 건이 쥔 좌석만 가용으로 푼다. 정지 좌석은 정지 유지(장애 처리), 다른 건에 연결된 좌석은 건드리지 않음
    const { data: acc } = await db()
      .from('accounts')
      .select('status, current_assignment_id')
      .eq('id', a.account_id)
      .single()
    if (acc && acc.current_assignment_id === id && ['회수중', '배정'].includes(acc.status)) {
      await transitionAccount({
        id: a.account_id,
        to: '가용',
        actor,
        action: 'account.release',
        expect: ['회수중', '배정'],
        patch: { current_assignment_id: null },
        detail: { assignment_id: id },
      })
    } else {
      await log(actor, 'account.release.skip', a.account_id, {
        assignment_id: id,
        status: acc?.status ?? null,
        current: acc?.current_assignment_id ?? null,
      })
    }
  }

  // 회수 즉시 재배정 (해당 프로그램 우선 → 나머지 진행 프로그램)
  const reassigned = await autoAssignProgram(a.program_id, actor, today, scope)
  let othersQ = db().from('programs').select('id').eq('status', '진행중').neq('id', a.program_id)
  if (scope?.programIds) othersQ = othersQ.in('id', scope.programIds)
  const { data: others } = await othersQ
  for (const p of others ?? []) reassigned.push(...(await autoAssignProgram(p.id, actor, today, scope)))
  return { reassigned }
}

/** 관리자 수동 배정 (계정 지정) */
export async function manualAssign(
  assignmentId: string,
  accountId: string,
  actor: string,
  today: string = todayKST(),
): Promise<void> {
  const { data: a } = await db()
    .from('assignments')
    .select('status, program_id')
    .eq('id', assignmentId)
    .single()
  if (!a) throw new Error(`배정 ${assignmentId} 없음`)
  if (a.status !== '승인') throw new Error('승인 상태의 신청만 수동 배정할 수 있습니다.')

  const { data: program } = await db().from('programs').select('*').eq('id', a.program_id).single()
  const period = periodFor(program as Program, today)
  if (!period) throw new Error('프로그램 대여기간이 설정되지 않았습니다.')

  // R14-2: 접속 링크가 없는 좌석은 자동·수동 모두 배정 대상이 아니다.
  const { data: sec } = await db()
    .from('account_secrets')
    .select('access_url')
    .eq('account_id', accountId)
    .maybeSingle()
  if (!sec?.access_url) throw new Error('접속 링크가 등록되지 않은 계정은 배정할 수 없습니다.')

  const { data: acc } = await db().from('accounts').select('service').eq('id', accountId).maybeSingle()
  if (!acc) throw new Error(`계정 ${accountId} 없음`)

  const ok = await assignSeat({
    assignmentId,
    accountId,
    actor,
    action: 'assignment.assign.manual',
    patch: { service: acc.service, assigned_on: today, rent_start: period.start, rent_end: period.end },
  })
  if (!ok) throw new Error('해당 계정이 가용 상태가 아니거나, 신청 건 상태가 바뀌었습니다. 새로고침 후 다시 시도해 주세요.')
}

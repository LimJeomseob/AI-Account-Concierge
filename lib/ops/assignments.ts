/**
 * 신청·승인·배정·회수 운영 (PRD R13~R17, R20, R24)
 * 2026-10-28: 신청자 자동 메일(R16)·인수 확인(R18)·미인수 자동 취소(R19) 폐지 — 배정 즉시 「사용중」
 */
import 'server-only'
import { db } from '@/lib/db'
import { todayKST } from '@/lib/date'
import { capRemaining, chunk, isAssignable, periodFor, planAllocations, type PoolAccount, type QueueItem } from '@/lib/assign'
import { claimAccount, log, releaseClaim, transitionAccount, transitionAssignment } from '@/lib/state'
import { CHECKLIST_FIELDS } from '@/lib/labels'
import type { Program, Service } from '@/lib/types'

const ACTIVE_OCCUPYING = ['배정', '사용중', '회수중', '회수완료'] as const

/**
 * 배정 범위 제한.
 *  - accountIds·programIds: 통합 테스트 격리용(운영 코드는 넘기지 않음) — 테스트 신청이 실제 운영 계정을 잡지 않게
 *  - assignmentIds: 「승인 건 배정 + 메일 내려받기」가 화면 필터에 걸린 승인 건만 배정하도록
 */
export interface AssignScope {
  /** 이 계정들만 배정 풀에 넣는다 */
  accountIds?: string[]
  /** 이 프로그램들만 배정 대상으로 본다 */
  programIds?: string[]
  /** 이 신청 건들만 대기열에 넣는다 */
  assignmentIds?: string[]
}

/** 배정 가능한 계정 풀 (가용 ∧ 운영). 접속 링크 조건(R14-2)은 2026-10-29 폐지 */
export async function availablePool(scope?: AssignScope): Promise<PoolAccount[]> {
  let q = db().from('accounts').select('id, service, kind, expires_on').eq('status', '가용').eq('kind', '운영')
  if (scope?.accountIds) q = q.in('id', scope.accountIds)
  const { data: accs, error } = await q
  if (error) throw new Error(error.message)
  return (accs ?? []) as PoolAccount[]
}

/**
 * 계정 1개를 승인 건 1개에 배정한다 (R14).
 * ① 계정 선점(조건부, lib/state.ts:claimAccount) → ② 배정 「승인 → 사용중」 전이(조건부).
 * ②가 false 이거나 예외면 ①을 되돌린다 — 계정이 「배정」인 채로 아무 건에도 연결되지 않는 고아 상태 방지.
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

  let queueQ = db()
    .from('assignments')
    .select('id, service_wish, applied_at')
    .eq('program_id', programId)
    .eq('status', '승인')
    .is('account_id', null)
  if (scope?.assignmentIds) queueQ = queueQ.in('id', scope.assignmentIds)
  const { data: queueRows } = await queueQ.order('applied_at', { ascending: true })

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
    if (!ok) continue // 계정을 다른 처리가 먼저 가져갔거나 대기열 상태가 바뀜

    assigned.push(alloc.assignment_id)
  }
  return assigned
}

/**
 * R13: 승인만 한다. 배정은 관리자가 「승인 건 배정 + 메일 내려받기」를 누를 때 일어난다(R14, 2026-10-29).
 */
export async function approveAssignments(
  ids: string[],
  actor: string,
  today: string = todayKST(),
): Promise<{ approved: number }> {
  if (ids.length === 0) return { approved: 0 }
  // 대상 건을 한 번에 읽고(건별 조회 제거), 상태 전이는 10건씩 동시에 보낸다.
  // 전이는 조건부 갱신(신청일 때만)이라 동시에 보내도 중복 승인되지 않는다(R13).
  const { data: rows } = await db().from('assignments').select('id, status').in('id', ids)
  const targets = (rows ?? []).filter((r) => r.status === '신청').map((r) => r.id as string)

  let approved = 0
  for (const batch of chunk(targets, 10)) {
    const results = await Promise.all(
      batch.map((id) =>
        transitionAssignment({
          id,
          to: '승인',
          actor,
          action: 'assignment.approve',
          expect: ['신청'],
          patch: { approved_on: today, approved_by: actor },
        }),
      ),
    )
    approved += results.filter(Boolean).length
  }
  return { approved }
}

export interface ExportAssignResult {
  /** 이번에 배정된 신청자 — 관리자가 이 이메일들을 팀 워크스페이스에 초대한다 */
  assigned: Array<{ id: string; name: string; email: string; account_id: string }>
  /** 대상 승인 건 중 대여기간이 없거나 진행중이 아닌 프로그램이라 배정하지 못한 수 */
  noPeriod: number
  /** 대상 승인 건 중 가용 계정·배정상한이 모자라 대기로 남은 수 */
  shortage: number
}

/**
 * R14: 「승인 건 배정 + 메일 내려받기」 — 화면 필터(프로그램·검색어)에 걸린 「승인」 건을 신청 순으로
 * 가용 계정에 배정한다. 프로그램별로 autoAssignProgram 을 그대로 써서 상한(R5)·대여기간(R15)·
 * 희망 서비스·조건부 선점을 지킨다.
 */
export async function assignApprovedForExport(
  filter: { program?: string; q?: string },
  actor: string,
  today: string = todayKST(),
  scope?: AssignScope,
): Promise<ExportAssignResult> {
  let q = db().from('assignments').select('id, program_id').eq('status', '승인').is('account_id', null)
  if (filter.program) q = q.eq('program_id', filter.program)
  if (filter.q) q = q.or(`name.ilike.%${filter.q}%,email.ilike.%${filter.q}%,id.ilike.%${filter.q}%`)
  if (scope?.programIds) q = q.in('program_id', scope.programIds)
  const { data: targets, error } = await q.order('applied_at', { ascending: true })
  if (error) throw new Error(error.message)
  const rows = targets ?? []
  const ids = rows.map((r) => r.id)
  if (ids.length === 0) return { assigned: [], noPeriod: 0, shortage: 0 }

  const byProgram = new Map<string, number>()
  for (const r of rows) byProgram.set(r.program_id, (byProgram.get(r.program_id) ?? 0) + 1)

  const assignedIds: string[] = []
  let noPeriod = 0
  for (const [pid, count] of byProgram) {
    const { data: program } = await db().from('programs').select('*').eq('id', pid).maybeSingle()
    if (!program || !isAssignable(program as Program, today)) {
      noPeriod += count
      continue
    }
    assignedIds.push(...(await autoAssignProgram(pid, actor, today, { ...scope, assignmentIds: ids })))
  }

  let assigned: ExportAssignResult['assigned'] = []
  if (assignedIds.length > 0) {
    const { data } = await db()
      .from('assignments')
      .select('id, name, email, account_id, applied_at')
      .in('id', assignedIds)
      .order('applied_at', { ascending: true })
    assigned = (data ?? []).map((r) => ({ id: r.id, name: r.name, email: r.email, account_id: r.account_id as string }))
  }
  const shortage = ids.length - noPeriod - assigned.length
  // R31: 건수만 기록 — 이메일 등 개인정보는 남기지 않는다
  await log(actor, 'assignments.assign_export', null, {
    targets: ids.length,
    assigned: assigned.length,
    no_period: noPeriod,
    shortage,
    program: filter.program ?? '',
  })
  return { assigned, noPeriod, shortage }
}

/**
 * R17: 취소. 계정을 쥐고 있던 건은 「회수중」(회수 체크리스트 R24 를 거쳐야 계정이 풀림), 아니면 「취소」.
 * 배정 전이를 먼저 하고(조건부), 계정은 이 건에 연결돼 있을 때만 회수중으로 옮긴다.
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
 * 접근 차단(계정을 팀에서 제거)은 관리자가 회수 체크리스트 ②로 처리한다(R24).
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
  // 이 배정이 쥔 계정이거나, 연결이 풀린 정지 계정일 때만 옮긴다 — 다른 사람에게 이미 넘어간 계정을 빼앗지 않는다
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

/** R24: 회수 완료 (2개 체크 필수) → 계정 가용 */
export async function completeReturn(
  id: string,
  actor: string,
  today: string = todayKST(),
): Promise<void> {
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
    // 이 건이 쥔 계정만 가용으로 푼다. 정지 계정은 정지 유지(장애 처리), 다른 건에 연결된 계정은 건드리지 않음
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

  // 회수 직후 대기자 자동 재배정은 2026-10-29 폐지 — 배정은 「승인 건 배정 + 메일 내려받기」로만
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

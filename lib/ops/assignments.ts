/**
 * 신청·승인·배정·인수·회수 운영 (PRD R13~R20, R24)
 */
import 'server-only'
import { db } from '@/lib/db'
import { todayKST } from '@/lib/date'
import { capRemaining, isAssignable, periodFor, planAllocations, type PoolAccount, type QueueItem } from '@/lib/assign'
import { getSettings } from '@/lib/settings'
import { log, transitionAccount, transitionAssignment } from '@/lib/state'
import { queueAssignmentMail } from '@/lib/mail/queue'
import { generateNewPassword } from '@/lib/ops/accounts'
import { CHECKLIST_FIELDS } from '@/lib/labels'
import type { Program, Service } from '@/lib/types'

const ACTIVE_OCCUPYING = ['배정', '사용중', '회수중', '회수완료'] as const

/** 배정 가능한 계정 풀 (가용 ∧ 운영 ∧ 비밀번호 정상) — R14-2 */
export async function availablePool(): Promise<PoolAccount[]> {
  const { data: accs, error } = await db()
    .from('accounts')
    .select('id, service, kind, expires_on')
    .eq('status', '가용')
    .eq('kind', '운영')
  if (error) throw new Error(error.message)
  const ids = (accs ?? []).map((a) => a.id)
  if (ids.length === 0) return []
  const { data: secs } = await db()
    .from('account_secrets')
    .select('account_id')
    .in('account_id', ids)
    .eq('password_status', '정상')
  const ok = new Set((secs ?? []).map((s) => s.account_id))
  return (accs ?? []).filter((a) => ok.has(a.id)) as PoolAccount[]
}

/**
 * R14: 프로그램 1개에 대한 자동 배정.
 * 반환: 실제로 배정된 배정ID 목록.
 */
export async function autoAssignProgram(
  programId: string,
  actor: string,
  today: string = todayKST(),
): Promise<string[]> {
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

  const pool = await availablePool()
  const plan = planAllocations({ period, queue, pool, capRemaining: left })

  const assigned: string[] = []
  for (const alloc of plan) {
    // 계정 선점(경합 방지): 상태가 여전히 「가용」일 때만 갱신
    const { data: claimed, error: claimErr } = await db()
      .from('accounts')
      .update({
        status: '배정',
        current_assignment_id: alloc.assignment_id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', alloc.account_id)
      .eq('status', '가용')
      .select('id')
    if (claimErr) throw new Error(claimErr.message)
    if (!claimed || claimed.length === 0) continue // 다른 처리에서 이미 가져감

    const ok = await transitionAssignment({
      id: alloc.assignment_id,
      to: '배정',
      actor,
      action: 'assignment.assign',
      expect: ['승인'],
      patch: {
        account_id: alloc.account_id,
        service: alloc.service satisfies Service,
        assigned_on: today,
        rent_start: alloc.rent_start,
        rent_end: alloc.rent_end,
      },
      detail: { account_id: alloc.account_id, service: alloc.service, period },
    })
    if (!ok) {
      // 대기열 상태가 바뀐 경우 계정 선점 해제
      await db()
        .from('accounts')
        .update({ status: '가용', current_assignment_id: null, updated_at: new Date().toISOString() })
        .eq('id', alloc.account_id)
      continue
    }

    const sent = await queueAssignmentMail(alloc.assignment_id)
    if (sent) {
      await db()
        .from('assignments')
        .update({ notified_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', alloc.assignment_id)
    }
    assigned.push(alloc.assignment_id)
  }
  return assigned
}

/** 진행 중인 모든 프로그램에 대해 자동 배정 (일일 작업 4단계) */
export async function autoAssignAll(actor: string, today: string = todayKST()): Promise<string[]> {
  const { data: programs } = await db().from('programs').select('id').eq('status', '진행')
  const out: string[] = []
  for (const p of programs ?? []) {
    out.push(...(await autoAssignProgram(p.id, actor, today)))
  }
  return out
}

/** R13: 승인 (+ 설정에 따라 즉시 자동 배정) */
export async function approveAssignments(
  ids: string[],
  actor: string,
  today: string = todayKST(),
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
    for (const pid of programIds) assigned.push(...(await autoAssignProgram(pid, actor, today)))
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

/** R17: 취소 (계정이 연결돼 있으면 회수중으로) */
export async function cancelAssignment(id: string, actor: string, reason = ''): Promise<void> {
  const { data: a } = await db().from('assignments').select('status, account_id').eq('id', id).single()
  if (!a) throw new Error(`배정 ${id} 없음`)

  if (a.account_id) {
    await moveAccountToReturning(a.account_id, id, actor)
    await transitionAssignment({
      id,
      to: '회수중',
      actor,
      action: 'assignment.cancel',
      patch: { note: reason || '관리자 취소' },
      detail: { reason: reason || '관리자 취소', account_id: a.account_id },
    })
    return
  }
  await transitionAssignment({
    id,
    to: '취소',
    actor,
    action: 'assignment.cancel',
    patch: { note: reason || '관리자 취소' },
    detail: { reason },
  })
}

/** 계정을 회수중으로 옮기고 신규 비밀번호 생성 (R20·R21) */
export async function moveAccountToReturning(
  accountId: string,
  assignmentId: string,
  actor: string,
): Promise<void> {
  const { data: acc } = await db().from('accounts').select('status').eq('id', accountId).single()
  if (!acc) return
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
  const { data: asg } = await db()
    .from('assignments')
    .select('chk_password_changed')
    .eq('id', assignmentId)
    .maybeSingle()
  if (!asg?.chk_password_changed) await generateNewPassword(accountId, actor)
}

/** R18: 인수 확인 */
export type AckResult = 'ok' | 'already' | 'invalid-state' | 'not-found'

export async function acknowledge(id: string, actor: string): Promise<AckResult> {
  const { data: a } = await db()
    .from('assignments')
    .select('status, acknowledged_at')
    .eq('id', id)
    .maybeSingle()
  if (!a) return 'not-found'
  if (a.acknowledged_at) return 'already'
  if (a.status !== '배정') return 'invalid-state'

  await transitionAssignment({
    id,
    to: '사용중',
    actor,
    action: 'assignment.acknowledge',
    expect: ['배정'],
    patch: { acknowledged_at: new Date().toISOString() },
  })
  return 'ok'
}

/** R19: 미인수 자동 취소 (일일 작업 2단계) */
export async function expireUnacknowledged(
  ackDueDays: number,
  today: string = todayKST(),
): Promise<string[]> {
  const cutoff = new Date()
  cutoff.setUTCDate(cutoff.getUTCDate() - ackDueDays)

  const { data: rows } = await db()
    .from('assignments')
    .select('id, account_id, notified_at')
    .eq('status', '배정')
    .not('notified_at', 'is', null)
    .is('acknowledged_at', null)
    .lte('notified_at', cutoff.toISOString())

  const out: string[] = []
  for (const r of rows ?? []) {
    await transitionAssignment({
      id: r.id,
      to: '인수기한초과',
      actor: 'system',
      action: 'assignment.ack_overdue',
      expect: ['배정'],
      patch: { note: `인수기한(${ackDueDays}일) 초과로 자동 취소 — ${today}` },
      detail: { notified_at: r.notified_at, ack_due_days: ackDueDays },
    })
    if (r.account_id) {
      await moveAccountToReturning(r.account_id, r.id, 'system')
      // R19: 미인수 건은 계정의 current_assignment_id 를 해제한다.
      await db()
        .from('accounts')
        .update({ current_assignment_id: null, updated_at: new Date().toISOString() })
        .eq('id', r.account_id)
    }
    out.push(r.id)
  }
  return out
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
    await transitionAssignment({
      id: r.id,
      to: '회수중',
      actor: 'system',
      action: 'assignment.rent_end',
      expect: ['사용중'],
      detail: { rent_end: r.rent_end },
    })
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
  const { error } = await db()
    .from('assignments')
    .update({ [field]: value, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw new Error(error.message)
  await log(actor, 'assignment.checklist', id, { field, value })
}

/** R24: 회수 완료 (5개 체크 필수) → 계정 가용 → 즉시 재배정 시도 */
export async function completeReturn(
  id: string,
  actor: string,
  today: string = todayKST(),
): Promise<{ reassigned: string[] }> {
  const { data: a } = await db()
    .from('assignments')
    .select(
      'status, account_id, program_id, chk_delete_chats, chk_delete_memory, chk_logout_all, chk_history_review, chk_password_changed',
    )
    .eq('id', id)
    .single()
  if (!a) throw new Error(`배정 ${id} 없음`)
  const missing = CHECKLIST_FIELDS.filter((f) => !(a as Record<string, unknown>)[f])
  if (missing.length > 0) throw new Error('회수 체크리스트 5개 항목을 모두 완료해야 합니다.')

  await transitionAssignment({
    id,
    to: '회수완료',
    actor,
    action: 'assignment.return_complete',
    expect: ['회수중', '인수기한초과'],
    patch: { returned_at: new Date().toISOString() },
  })

  if (a.account_id) {
    await transitionAccount({
      id: a.account_id,
      to: '가용',
      actor,
      action: 'account.release',
      patch: { current_assignment_id: null },
      detail: { assignment_id: id },
    })
  }

  // 회수 즉시 재배정 (해당 프로그램 우선 → 나머지 진행 프로그램)
  const reassigned = await autoAssignProgram(a.program_id, actor, today)
  const { data: others } = await db().from('programs').select('id').eq('status', '진행').neq('id', a.program_id)
  for (const p of others ?? []) reassigned.push(...(await autoAssignProgram(p.id, actor, today)))
  return { reassigned }
}

/** 안내 메일 재발송 */
export async function resendAssignmentMail(id: string, actor: string): Promise<boolean> {
  const sent = await queueAssignmentMail(id)
  if (sent) {
    await db()
      .from('assignments')
      .update({ notified_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', id)
    await log(actor, 'assignment.mail.resend', id, {})
  }
  return sent
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

  const { data: claimed } = await db()
    .from('accounts')
    .update({ status: '배정', current_assignment_id: assignmentId, updated_at: new Date().toISOString() })
    .eq('id', accountId)
    .eq('status', '가용')
    .select('id, service')
  if (!claimed || claimed.length === 0) throw new Error('해당 계정은 가용 상태가 아닙니다.')

  await transitionAssignment({
    id: assignmentId,
    to: '배정',
    actor,
    action: 'assignment.assign.manual',
    expect: ['승인'],
    patch: {
      account_id: accountId,
      service: claimed[0].service,
      assigned_on: today,
      rent_start: period.start,
      rent_end: period.end,
    },
    detail: { account_id: accountId },
  })
  const sent = await queueAssignmentMail(assignmentId)
  if (sent) {
    await db()
      .from('assignments')
      .update({ notified_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', assignmentId)
  }
}

/** R4: 고정기간 프로그램 자동 종료 (일일 작업 1단계) */
export async function closeFinishedPrograms(today: string = todayKST()): Promise<string[]> {
  const { data: rows } = await db()
    .from('programs')
    .select('id, end_on')
    .eq('status', '진행')
    .eq('mode', '고정기간')
    .not('end_on', 'is', null)
    .lt('end_on', today)

  const out: string[] = []
  for (const p of rows ?? []) {
    await db().from('programs').update({ status: '종료' }).eq('id', p.id)
    await log('system', 'program.close', p.id, { end_on: p.end_on })
    out.push(p.id)
  }
  return out
}

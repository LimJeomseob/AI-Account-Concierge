/**
 * 장애 (PRD R26~R28)
 */
import 'server-only'
import { db } from '@/lib/db'
import { todayKST } from '@/lib/date'
import { periodFor } from '@/lib/assign'
import { nextAssignmentId } from '@/lib/ids'
import { queueAdminMail } from '@/lib/mail/queue'
import { claimAccount, log, transitionAccount, transitionAssignment } from '@/lib/state'
import { moveAccountToReturning } from '@/lib/ops/assignments'
import type { IncidentType, Program } from '@/lib/types'

/** R26: 장애 신고 접수 */
export async function reportIncident(input: {
  assignmentId: string
  type: IncidentType
  symptom: string
  reporter?: string
}): Promise<number> {
  const { data: a } = await db()
    .from('assignments')
    .select('id, account_id, name, email, programs(name)')
    .eq('id', input.assignmentId)
    .single()
  if (!a) throw new Error(`배정 ${input.assignmentId} 없음`)

  const { data: inc, error } = await db()
    .from('incidents')
    .insert({
      account_id: a.account_id,
      assignment_id: a.id,
      type: input.type,
      symptom: input.symptom,
      reporter: input.reporter ?? a.name,
      status: '접수',
    })
    .select('id')
    .single()
  if (error) throw new Error(error.message)

  // 정지 유형이면 계정 상태를 정지로
  if (input.type === '정지' && a.account_id) {
    const { data: acc } = await db().from('accounts').select('status').eq('id', a.account_id).single()
    if (acc && acc.status !== '정지') {
      await transitionAccount({
        id: a.account_id,
        to: '정지',
        actor: 'public',
        action: 'account.suspend',
        detail: { incident_id: inc.id },
      })
    }
  }

  const programName = (a as unknown as { programs: { name: string } | null }).programs?.name ?? ''
  await queueAdminMail({
    subject: `[AI융합원] 장애 신고 접수 — ${a.account_id ?? '계정미상'} (${input.type})`,
    text: [
      'AI 유료계정 장애 신고가 접수되었습니다.',
      '',
      `· 접수번호: ${a.id}`,
      `· 프로그램: ${programName}`,
      `· 신고자: ${input.reporter ?? a.name} (${a.email})`,
      `· 계정: ${a.account_id ?? '-'}`,
      `· 유형: ${input.type}`,
      `· 증상: ${input.symptom}`,
      '',
      '관리자 화면 「장애」 메뉴에서 대체 계정을 배정할 수 있습니다.',
    ].join('\n'),
    kind: 'incident',
    refId: String(inc.id),
  })

  await log('public', 'incident.report', String(inc.id), {
    assignment_id: a.id,
    account_id: a.account_id,
    type: input.type,
  })
  return inc.id as number
}

/**
 * R27: 대체 계정 배정.
 * 예비(kind 예비) 우선 → 없으면 가용 운영 계정 중 같은 서비스.
 * 기존 배정은 회수중, 새 배정 건을 만들어 대여기간을 승계한다.
 */
export async function replaceAccount(
  incidentId: number,
  actor: string,
  today: string = todayKST(),
): Promise<string> {
  const { data: inc } = await db().from('incidents').select('*').eq('id', incidentId).single()
  if (!inc) throw new Error('장애 건이 없습니다.')
  if (!inc.assignment_id) throw new Error('연결된 배정이 없습니다.')
  // 멱등: 이미 대체한 장애를 다시 실행하면 새 배정이 또 생기므로 막는다
  if (inc.status === '완료' || inc.replacement_account_id) throw new Error('이미 처리된 장애입니다.')

  const { data: old } = await db().from('assignments').select('*').eq('id', inc.assignment_id).single()
  if (!old) throw new Error('배정 정보를 찾을 수 없습니다.')
  if (!['사용중', '배정'].includes(old.status)) {
    throw new Error(`원 배정이 「${old.status}」 상태라 대체할 수 없습니다(사용중 건만 대체).`)
  }
  const service = old.service
  if (!service) throw new Error('서비스가 지정되지 않은 배정입니다.')

  // 대여기간 승계 (없으면 프로그램 기준으로 재계산)
  let rentStart = old.rent_start
  let rentEnd = old.rent_end
  if (!rentStart || !rentEnd) {
    const { data: program } = await db().from('programs').select('*').eq('id', old.program_id).single()
    const period = periodFor(program as Program, today)
    rentStart = period?.start ?? today
    rentEnd = period?.end ?? today
  }

  // 대체 후보: 가용 ∧ 같은 서비스 ∧ 접속 링크 등록(R14-2·R27) ∧ 대여종료일까지 구독 유지. 예비 우선
  const { data: candidates } = await db()
    .from('accounts')
    .select('id, kind, expires_on')
    .eq('status', '가용')
    .is('current_assignment_id', null)
    .eq('service', service)
  const { data: okSecrets } = await db()
    .from('account_secrets')
    .select('account_id')
    .not('access_url', 'is', null)
  const okIds = new Set((okSecrets ?? []).map((s) => s.account_id))
  const ordered = (candidates ?? [])
    .filter((c) => okIds.has(c.id) && (c.expires_on === null || c.expires_on >= rentEnd))
    .sort((a, b) => (a.kind === b.kind ? a.id.localeCompare(b.id) : a.kind === '예비' ? -1 : 1))
  if (ordered.length === 0) throw new Error(`대체할 ${service} 가용 계정이 없습니다.`)

  // 새 배정을 만든 뒤 좌석을 조건부로 선점한다. 선점에 실패하면(다른 처리가 먼저 가져감) 새 배정을 지우고 다음 후보.
  let newId = ''
  let pick: { id: string } | null = null
  for (const c of ordered) {
    const id = await nextAssignmentId()
    const { error: insErr } = await db().from('assignments').insert({
      id,
      program_id: old.program_id,
      user_id: old.user_id,
      name: old.name,
      email: old.email,
      service_wish: old.service_wish,
      account_id: c.id,
      service,
      status: '사용중', // 배정 즉시 사용 개시 (인수 확인 폐지)
      acknowledged_at: new Date().toISOString(),
      applied_at: old.applied_at,
      edu_watched_at: old.edu_watched_at,
      approved_on: old.approved_on,
      approved_by: old.approved_by,
      assigned_on: today,
      rent_start: rentStart,
      rent_end: rentEnd,
      note: `장애 대체 (원 배정 ${old.id})`,
    })
    if (insErr) {
      // 좌석 유일 인덱스(0004) 위반 = 이 좌석이 이미 다른 활성 배정에 있음 → 다음 후보
      if (/assignments_active_account_uq/.test(insErr.message)) continue
      throw new Error(insErr.message)
    }
    const claimed = await claimAccount({
      id: c.id,
      assignmentId: id,
      actor,
      action: 'account.assign.replace',
      detail: { incident_id: incidentId, from_assignment: old.id },
    })
    if (claimed) {
      newId = id
      pick = c
      break
    }
    await db().from('assignments').delete().eq('id', id)
  }
  if (!pick) throw new Error(`대체할 ${service} 가용 계정을 잡지 못했습니다. 잠시 후 다시 시도해 주세요.`)

  // 기존 배정 종료 처리 (새 좌석을 확보한 뒤에 한다 — 실패 시 원 배정이 그대로 남도록)
  if (old.account_id) {
    const { data: acc } = await db().from('accounts').select('status').eq('id', old.account_id).single()
    if (acc?.status !== '정지') await moveAccountToReturning(old.account_id, old.id, actor)
  }
  await transitionAssignment({
    id: old.id,
    to: '회수중',
    actor,
    action: 'assignment.incident.replace',
    expect: ['사용중', '배정'],
    patch: { note: `장애(${inc.type})로 대체 배정 — ${today}` },
    detail: { incident_id: incidentId, new_assignment: newId },
  })

  await db()
    .from('incidents')
    .update({
      status: '완료',
      replacement_account_id: pick.id,
      action: `대체 계정 ${pick.id} 배정 (새 접수번호 ${newId})`,
    })
    .eq('id', incidentId)

  await log(actor, 'incident.replace', String(incidentId), {
    old_assignment: old.id,
    new_assignment: newId,
    account_id: pick.id,
  })
  return newId
}

/** R28: 정지율(%) */
export async function suspensionRate(): Promise<number> {
  const { count: total } = await db().from('accounts').select('id', { count: 'exact', head: true })
  if (!total) return 0
  const { count: susp } = await db()
    .from('accounts')
    .select('id', { count: 'exact', head: true })
    .eq('status', '정지')
  return Math.round(((susp ?? 0) / total) * 1000) / 10
}

/**
 * 공개 신청 접수 (PRD R7~R12)
 */
import 'server-only'
import { db } from '@/lib/db'
import { todayKST } from '@/lib/date'
import { periodFor } from '@/lib/assign'
import { nextAssignmentId, nextUserId } from '@/lib/ids'
import { queueIntakeMail } from '@/lib/mail/queue'
import { log } from '@/lib/state'
import type { Program, ServiceWish, UserType } from '@/lib/types'

export interface ApplyInput {
  programId?: string
  programName?: string
  name: string
  affiliation: string
  type: UserType
  email: string
  phone?: string
  service?: ServiceWish
  hasPaid?: boolean
  eduWatchedAt?: string
}

export type ApplyResult =
  | { ok: true; id: string; period: string }
  | { ok: false; msg: string }

const ACTIVE = ['신청', '승인', '배정', '사용중', '회수중', '회수완료']

export async function applyForAccount(input: ApplyInput, today: string = todayKST()): Promise<ApplyResult> {
  // R8: 프로그램 매칭
  let program: Program | null = null
  if (input.programId) {
    const { data } = await db().from('programs').select('*').eq('id', input.programId).maybeSingle()
    program = (data as Program) ?? null
  }
  if (!program && input.programName) {
    const { data } = await db().from('programs').select('*').eq('name', input.programName).maybeSingle()
    program = (data as Program) ?? null
  }
  if (!program) return { ok: false, msg: '아직 등록되지 않은 프로그램입니다. 담당자에게 문의해 주세요.' }
  if (program.status === '종료') return { ok: false, msg: '종료된 프로그램입니다.' }

  const period = periodFor(program, today)
  if (!period) return { ok: false, msg: '접수 준비 중(대여기간 미설정)인 프로그램입니다.' }

  // R9: 이메일 소문자 정규화 + 같은 프로그램 활성 중복 거부
  const email = input.email.trim().toLowerCase()
  const { data: dup } = await db()
    .from('assignments')
    .select('id')
    .eq('program_id', program.id)
    .eq('email', email)
    .in('status', ACTIVE)
    .maybeSingle()
  if (dup) return { ok: false, msg: '이미 같은 프로그램에 신청하셨습니다. (접수번호 ' + dup.id + ')' }

  // R10: users upsert
  const nowIso = new Date().toISOString()
  const { data: existing } = await db()
    .from('users')
    .select('id, first_applied_at')
    .eq('email', email)
    .maybeSingle()

  let userId: string
  if (existing) {
    userId = existing.id
    const { error } = await db()
      .from('users')
      .update({
        name: input.name,
        affiliation: input.affiliation,
        type: input.type,
        phone: input.phone ?? null,
        has_paid: input.hasPaid ?? false,
        privacy_consented_at: nowIso,
        first_applied_at: existing.first_applied_at ?? nowIso,
        purged_at: null,
      })
      .eq('id', userId)
    if (error) return { ok: false, msg: '신청자 정보 저장에 실패했습니다.' }
  } else {
    userId = await nextUserId()
    const { error } = await db().from('users').insert({
      id: userId,
      name: input.name,
      affiliation: input.affiliation,
      type: input.type,
      email,
      phone: input.phone ?? null,
      has_paid: input.hasPaid ?? false,
      privacy_consented_at: nowIso,
      first_applied_at: nowIso,
    })
    if (error) return { ok: false, msg: '신청자 정보 저장에 실패했습니다.' }
  }

  // R11: 배정 1건 생성 + 접수안내 메일 대기열
  const id = await nextAssignmentId()
  const { error: aErr } = await db().from('assignments').insert({
    id,
    program_id: program.id,
    user_id: userId,
    name: input.name,
    email,
    service_wish: input.service ?? '무관',
    status: '신청',
    applied_at: nowIso,
    edu_watched_at: input.eduWatchedAt ?? nowIso,
    rent_start: program.mode === '고정기간' ? period.start : null,
    rent_end: program.mode === '고정기간' ? period.end : null,
  })
  if (aErr) {
    if (/assignments_active_unique/.test(aErr.message)) {
      return { ok: false, msg: '이미 같은 프로그램에 신청하셨습니다.' }
    }
    return { ok: false, msg: '접수 처리에 실패했습니다. 잠시 후 다시 시도해 주세요.' }
  }

  await log('public', 'assignment.apply', id, { program_id: program.id, email })
  try {
    await queueIntakeMail(id)
  } catch (e) {
    await log('system', 'mail.intake.error', id, { message: (e as Error).message })
  }

  const periodText =
    program.mode === '고정기간'
      ? `${period.start} ~ ${period.end}`
      : `배정일부터 ${program.days}일`
  return { ok: true, id, period: periodText }
}

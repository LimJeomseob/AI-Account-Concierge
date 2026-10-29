/**
 * 사용현황 CSV 일괄 등록 — 서버 실행부 (2026-10-29)
 * 계획(lib/usage-import.ts:planImport)을 DB 현재 상태로 만들고, 확정하면 행마다 등록한다.
 * 계정번호는 CSV 로 받지 않는다 — 「사용중」은 계획 단계에서 가용 계정을 번호 순으로 자동 부여한다.
 *  · 사용중: 사용자 생성(없으면, 구분 공란) → 「승인」 건 생성 → 계정 선점(claimAccount) → 「사용중」 전이
 *            가용 계정이 없거나 선점에 실패하면 계정 없이 「사용중」 기록으로 저장한다(가용 계정 수와 무관)
 *            전이가 실패하면 만든 건을 지우고 계정을 되돌린다
 *  · 회수완료: 지난 사용 이력으로 「회수완료」 건만 만든다(계정 상태는 건드리지 않음, 회수 체크 2개 완료 표시)
 * 로그에는 이메일을 남기지 않는다(R31).
 */
import 'server-only'
import { db } from '@/lib/db'
import { todayKST } from '@/lib/date'
import { nextAssignmentId, nextUserId } from '@/lib/ids'
import { claimAccount, log, releaseClaim, transitionAssignment } from '@/lib/state'
import { planImport, type ImportMode, type ImportRow, type PlanItem } from '@/lib/usage-import'

const PROGRAM_KEY_STATUSES = ['신청', '승인', '배정', '사용중', '회수중', '회수완료']
const ACTIVE = ['배정', '사용중', '회수중']

export async function buildPlan(
  rows: ImportRow[],
  mode: ImportMode,
  defaultProgramId: string | null,
  today: string = todayKST(),
): Promise<PlanItem[]> {
  const emails = [...new Set(rows.map((r) => r.email).filter(Boolean))]
  const [{ data: programs }, { data: accounts }, { data: existing }] = await Promise.all([
    db().from('programs').select('id, name, mode, end_on'),
    db().from('accounts').select('id, service, status, kind'),
    emails.length > 0
      ? db().from('assignments').select('program_id, email, service, service_wish, status, replaced_at').in('email', emails)
      : Promise.resolve({
          data: [] as Array<{ program_id: string; email: string; service: string | null; service_wish: string; status: string; replaced_at: string | null }>,
        }),
  ])
  const activeKeys = new Set<string>()
  const programEmailKeys = new Set<string>()
  for (const a of existing ?? []) {
    if (ACTIVE.includes(a.status) && a.service) activeKeys.add(`${a.email}|${a.service}`)
    // 0008: 같은 프로그램이라도 플랫폼이 다르면 함께 둘 수 있다 — 플랫폼 = 배정 서비스, 없으면 희망
    if (PROGRAM_KEY_STATUSES.includes(a.status) && !a.replaced_at)
      programEmailKeys.add(`${a.program_id}|${a.email}|${a.service ?? a.service_wish}`)
  }
  return planImport(rows, {
    mode,
    today,
    defaultProgramId,
    programs: programs ?? [],
    accounts: accounts ?? [],
    activeKeys,
    programEmailKeys,
  })
}

async function ensureUser(name: string, email: string): Promise<string> {
  const { data } = await db().from('users').select('id').eq('email', email).maybeSingle()
  if (data) return data.id as string
  const id = await nextUserId()
  // 구분(type)은 알 수 없어 공란 — 0007 필요
  const { error } = await db().from('users').insert({ id, name, type: null, email })
  if (error) throw new Error(`사용자 생성 실패: ${error.message}`)
  return id
}

const kstMidnight = (d: string) => `${d}T00:00:00+09:00`

export async function commitPlan(
  items: PlanItem[],
  mode: ImportMode,
  actor: string,
  today: string = todayKST(),
): Promise<{ done: number; errors: string[] }> {
  let done = 0
  const errors: string[] = []
  for (const it of items) {
    if (it.action !== 'new' || !it.programId || !it.service) continue
    try {
      const userId = await ensureUser(it.name, it.email)
      const id = await nextAssignmentId()
      const note = `사용현황 CSV 일괄 등록(${today}) — ${mode}`
      if (mode === '회수완료') {
        const { error } = await db()
          .from('assignments')
          .insert({
            id,
            program_id: it.programId,
            user_id: userId,
            name: it.name,
            email: it.email,
            service_wish: it.service,
            account_id: it.accountId,
            service: it.service,
            status: '회수완료',
            approved_on: it.start ?? it.end ?? today,
            approved_by: actor,
            assigned_on: it.start,
            rent_start: it.start,
            rent_end: it.end,
            acknowledged_at: it.start ? kstMidnight(it.start) : null,
            returned_at: kstMidnight(it.end ?? today),
            chk_delete_chats: true,
            chk_team_removed: true,
            note,
          })
        if (error) throw new Error(error.message)
        await log(actor, 'assignment.import', id, { mode, program: it.programId, service: it.service, account_id: it.accountId })
        done += 1
        continue
      }

      // 사용중: 승인 건 → 계정 선점 → 사용중
      const { error } = await db().from('assignments').insert({
        id,
        program_id: it.programId,
        user_id: userId,
        name: it.name,
        email: it.email,
        service_wish: it.service,
        status: '승인',
        approved_on: today,
        approved_by: actor,
        note,
      })
      if (error) throw new Error(error.message)
      // 가용 계정이 있으면 선점, 없거나 그사이 선점에 실패하면 계정 없이 기록으로 저장(가용 계정 수와 무관)
      let accountId: string | null = it.accountId
      if (accountId) {
        const claimed = await claimAccount({ id: accountId, assignmentId: id, actor, action: 'account.assign' })
        if (!claimed) accountId = null
      }
      const start = it.start ?? today
      const ok = await transitionAssignment({
        id,
        to: '사용중',
        actor,
        action: 'assignment.import',
        expect: ['승인'],
        patch: {
          account_id: accountId,
          service: it.service,
          assigned_on: start,
          rent_start: start,
          rent_end: it.end,
          acknowledged_at: kstMidnight(start),
        },
        detail: { mode, program: it.programId, account_id: accountId, ...(accountId ? {} : { no_account: true }) },
      })
      if (!ok) {
        if (accountId) await releaseClaim({ id: accountId, assignmentId: id, actor, reason: 'import_failed' })
        await db().from('assignments').delete().eq('id', id).eq('status', '승인')
        throw new Error('등록 중 상태가 바뀜')
      }
      done += 1
    } catch (e) {
      errors.push(`${it.line}행: ${(e as Error).message}`)
    }
  }
  await log(actor, 'assignments.import_csv', null, { mode, done, errors: errors.length })
  return { done, errors }
}

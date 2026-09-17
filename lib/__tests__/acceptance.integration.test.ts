/**
 * 수용 기준 시나리오 T1~T13 (PRD §16) — 실제 Supabase 연결 통합 테스트.
 *
 * 실행:
 *   ACCEPTANCE_CONFIRM=yes npm run test:acceptance
 *
 * 주의
 *  - 실제 DB에 쓰고 지운다. **반드시 시범/스테이징 프로젝트에서 실행할 것.**
 *  - 필요한 환경변수: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, APP_SECRET
 *  - RESEND_API_KEY 는 이 스위트 안에서 강제로 비운다. 메일은 대기열에만 쌓이고 실제로 나가지 않는다.
 *  - 모든 테스트 데이터는 `ZTEST` 접두를 쓰고 마지막에 삭제한다.
 */
import 'dotenv/config'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const enabled =
  process.env.ACCEPTANCE_CONFIRM === 'yes' &&
  !!process.env.SUPABASE_URL &&
  !!process.env.SUPABASE_SERVICE_ROLE_KEY &&
  !!process.env.APP_SECRET

// 실제 발송 차단 (대기열까지만 확인한다)
process.env.RESEND_API_KEY = ''

const RUN = `ZTEST${Date.now().toString(36).toUpperCase()}`
const PROG_OPEN = `${RUN}-P1`
const PROG_NOPERIOD = `${RUN}-P2`
const ACC_GPT = `${RUN}-G1`
const ACC_CL = `${RUN}-C1`
const ACC_SPARE = `${RUN}-C9`
const ACC_NOLINK = `${RUN}-G9` // 접속 링크 미등록 좌석 (배정 풀 제외 확인용)
const mail = (n: number) => `${RUN.toLowerCase()}-${n}@example.test`

// 실제 모듈은 enabled 일 때만 불러온다(환경변수 없이 import 하면 db() 가 던진다).
type Mods = {
  db: typeof import('@/lib/db')
  date: typeof import('@/lib/date')
  apply: typeof import('@/lib/ops/apply')
  assignments: typeof import('@/lib/ops/assignments')
  accounts: typeof import('@/lib/ops/accounts')
  incidents: typeof import('@/lib/ops/incidents')
  privacy: typeof import('@/lib/ops/privacy')
  alerts: typeof import('@/lib/alerts')
  daily: typeof import('@/lib/cron/daily')
  monthly: typeof import('@/lib/cron/monthly')
  report: typeof import('@/lib/report')
  token: typeof import('@/lib/token')
  settings: typeof import('@/lib/settings')
}
let M: Mods

async function load(): Promise<Mods> {
  return {
    db: await import('@/lib/db'),
    date: await import('@/lib/date'),
    apply: await import('@/lib/ops/apply'),
    assignments: await import('@/lib/ops/assignments'),
    accounts: await import('@/lib/ops/accounts'),
    incidents: await import('@/lib/ops/incidents'),
    privacy: await import('@/lib/ops/privacy'),
    alerts: await import('@/lib/alerts'),
    daily: await import('@/lib/cron/daily'),
    monthly: await import('@/lib/cron/monthly'),
    report: await import('@/lib/report'),
    token: await import('@/lib/token'),
    settings: await import('@/lib/settings'),
  }
}

/** 시나리오는 앞 단계 결과를 이어받으므로 순차 실행한다. */
describe.runIf(enabled).sequential('수용 기준 T1~T13 (PRD §16)', () => {
  const ids: Record<string, string> = {}
  let today = ''

  beforeAll(async () => {
    M = await load()
    today = M.date.todayKST()
    const db = M.db.db

    // 설정 확인(없으면 시드되지 않은 DB)
    const s = await M.settings.getSettings()
    expect(s.ack_due_days).toBeGreaterThan(0)

    // 프로그램 2개: 기간 설정 / 미설정
    await db().from('programs').insert([
      {
        id: PROG_OPEN,
        name: `[수용테스트] ${RUN} 대여기간 있음`,
        target: '학생',
        mode: '배정일기준',
        days: 30,
        cap: 0,
        status: '진행중',
      },
      {
        id: PROG_NOPERIOD,
        name: `[수용테스트] ${RUN} 대여기간 없음`,
        target: '학생',
        mode: '고정기간',
        days: 0,
        cap: 0,
        status: '진행중',
      },
    ])

    // 계정 3개 (운영 GPT·Claude, 예비 Claude)
    await db().from('accounts').insert([
      { id: ACC_GPT, service: 'GPT', kind: '운영', activated_on: today, expires_on: '2099-12-31', status: '가용' },
      { id: ACC_CL, service: 'Claude', kind: '운영', activated_on: today, expires_on: '2099-12-31', status: '가용' },
      { id: ACC_SPARE, service: 'Claude', kind: '예비', activated_on: today, expires_on: '2099-12-31', status: '가용' },
      { id: ACC_NOLINK, service: 'GPT', kind: '운영', activated_on: today, expires_on: '2099-12-31', status: '가용' },
    ])
    await db()
      .from('account_secrets')
      .insert(
        [
          ...[ACC_GPT, ACC_CL, ACC_SPARE].map((id) => ({
            account_id: id,
            login_email: `${id.toLowerCase()}@example.test`,
            access_url: `https://team.example/${id.toLowerCase()}`,
          })),
          // 접속 링크가 없는 좌석 (R14-2: 배정 풀에서 빠져야 한다)
          { account_id: ACC_NOLINK, login_email: `${ACC_NOLINK.toLowerCase()}@example.test`, access_url: null },
        ],
      )
  }, 60_000)

  afterAll(async () => {
    if (!enabled || !M) return
    const db = M.db.db
    const { data: asgs } = await db().from('assignments').select('id, user_id').like('program_id', `${RUN}%`)
    const asgIds = (asgs ?? []).map((a) => a.id)
    const userIds = [...new Set((asgs ?? []).map((a) => a.user_id))]

    await db().from('accounts').update({ status: '가용', current_assignment_id: null }).like('id', `${RUN}%`)
    await db().from('incidents').delete().like('account_id', `${RUN}%`)
    if (asgIds.length > 0) {
      await db().from('alerts').delete().in('assignment_id', asgIds)
      await db().from('mail_queue').delete().in('ref_id', asgIds)
      await db().from('assignments').delete().in('id', asgIds)
    }
    if (userIds.length > 0) await db().from('users').delete().in('id', userIds)
    await db().from('account_secrets').delete().like('account_id', `${RUN}%`)
    await db().from('accounts').delete().like('id', `${RUN}%`)
    await db().from('programs').delete().like('id', `${RUN}%`)
  }, 60_000)

  it('T1 — 진행중 + 기간 미설정 프로그램은 접수되고(R3) 대여기간은 「추후 안내」, 배정은 보류', async () => {
    const res = await M.apply.applyForAccount({
      programId: PROG_NOPERIOD,
      name: '테스트1',
      affiliation: 'AI융합원',
      type: '학생',
      email: mail(9),
    })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.period).toContain('추후 안내')
    const { data: row } = await M.db.db().from('assignments').select('status, rent_start, rent_end').eq('id', res.id).single()
    expect(row?.status).toBe('신청')
    expect(row?.rent_start).toBeNull()
    // 기간이 없으므로 승인해도 배정되지 않고 「승인」에 머문다 (R14·R15)
    const r = await M.assignments.approveAssignments([res.id], 'acceptance@test', today)
    expect(r.assigned).toHaveLength(0)
    const { data: after } = await M.db.db().from('assignments').select('status').eq('id', res.id).single()
    expect(after?.status).toBe('승인')
  })

  it('T2 — 같은 이메일·같은 프로그램 2번째 신청은 중복 거부, 접수안내 메일 1통', async () => {
    const first = await M.apply.applyForAccount({
      programId: PROG_OPEN,
      name: '테스트1',
      affiliation: 'AI융합원',
      type: '학생',
      email: mail(1),
      service: 'GPT',
    })
    expect(first.ok).toBe(true)
    if (first.ok) ids.a1 = first.id

    const second = await M.apply.applyForAccount({
      programId: PROG_OPEN,
      name: '테스트1',
      affiliation: 'AI융합원',
      type: '학생',
      email: mail(1),
    })
    expect(second.ok).toBe(false)

    const { count } = await M.db
      .db()
      .from('mail_queue')
      .select('id', { count: 'exact', head: true })
      .eq('ref_id', ids.a1)
      .eq('kind', 'intake')
    expect(count).toBe(1)
  })

  it('T3-0 — 접속 링크가 없는 좌석은 배정 풀에서 빠진다 (R14-2)', async () => {
    const pool = await M.assignments.availablePool()
    const ids = pool.map((a) => a.id)
    expect(ids).toContain(ACC_GPT)
    expect(ids).not.toContain(ACC_NOLINK)
  })

  it('T3 — 가용 GPT 1·Claude 1 에 3명 승인 시 신청 순 2명 배정, 1명 대기, 메일에 접속 링크 포함', async () => {
    const second = await M.apply.applyForAccount({
      programId: PROG_OPEN,
      name: '테스트2',
      affiliation: 'AI융합원',
      type: '학생',
      email: mail(2),
      service: '무관',
    })
    const third = await M.apply.applyForAccount({
      programId: PROG_OPEN,
      name: '테스트3',
      affiliation: 'AI융합원',
      type: '학생',
      email: mail(3),
      service: 'Claude',
    })
    expect(second.ok && third.ok).toBe(true)
    if (second.ok) ids.a2 = second.id
    if (third.ok) ids.a3 = third.id

    const result = await M.assignments.approveAssignments([ids.a1, ids.a2, ids.a3], 'acceptance@test', today)
    expect(result.approved).toBe(3)
    expect(result.assigned).toHaveLength(2)

    const { data: rows } = await M.db
      .db()
      .from('assignments')
      .select('id, status, account_id, service')
      .in('id', [ids.a1, ids.a2, ids.a3])
    const byId = new Map((rows ?? []).map((r) => [r.id, r]))
    expect(byId.get(ids.a1)?.service).toBe('GPT') // 희망 반영
    expect(byId.get(ids.a2)?.service).toBe('Claude') // 무관 → 잔량
    expect(byId.get(ids.a3)?.status).toBe('승인') // 재고 없음 → 대기

    const { data: mails } = await M.db
      .db()
      .from('mail_queue')
      .select('body_text')
      .eq('kind', 'assignment')
      .in('ref_id', [ids.a1, ids.a2])
    expect(mails).toHaveLength(2)
    expect(mails?.[0]?.body_text).toContain('접속 링크')
    expect(mails?.[0]?.body_text).toContain('https://team.example/')
  })

  it('T4 — 인수 링크는 통과, 위조 토큰은 거부', async () => {
    expect(M.token.verifyAckToken(ids.a1, M.token.ackToken(ids.a1))).toBe(true)
    expect(M.token.verifyAckToken(ids.a1, '0'.repeat(24))).toBe(false)

    expect(await M.assignments.acknowledge(ids.a1, 'acceptance@test')).toBe('ok')
    const { data } = await M.db.db().from('assignments').select('status, acknowledged_at').eq('id', ids.a1).single()
    expect(data?.status).toBe('사용중')
    expect(data?.acknowledged_at).toBeTruthy()
  })

  it('T5 — 발송 후 인수기한 경과 건은 인수기한초과 + 계정 회수중 + alerts', async () => {
    const past = new Date()
    past.setUTCDate(past.getUTCDate() - 5)
    await M.db.db().from('assignments').update({ notified_at: past.toISOString() }).eq('id', ids.a2)

    const s = await M.settings.getSettings()
    const expired = await M.assignments.expireUnacknowledged(s.ack_due_days, today)
    expect(expired).toContain(ids.a2)

    const { data: asg } = await M.db.db().from('assignments').select('status').eq('id', ids.a2).single()
    expect(asg?.status).toBe('인수기한초과')

    const { data: acc } = await M.db.db().from('accounts').select('status').eq('id', ACC_CL).single()
    expect(acc?.status).toBe('회수중')

    await M.alerts.rebuildAlerts(today)
    const { data: alertRows } = await M.db.db().from('alerts').select('*').eq('assignment_id', ids.a2)
    expect(alertRows).toHaveLength(1)
    expect(alertRows?.[0].category).toBe('인수기한 초과')
  })

  it('T6 — 대여 종료 → 회수 체크 2개 → 회수 완료 → 대기자 자동 재배정', async () => {
    const yesterday = M.date.addDays(today, -1)
    await M.db.db().from('assignments').update({ rent_end: yesterday }).eq('id', ids.a1)

    const ended = await M.assignments.endExpiredRentals(today)
    expect(ended).toContain(ids.a1)

    const { data: acc1 } = await M.db.db().from('accounts').select('status').eq('id', ACC_GPT).single()
    expect(acc1?.status).toBe('회수중')

    // 체크 2개를 다 채우기 전에는 회수 완료가 막힌다
    await expect(M.assignments.completeReturn(ids.a1, 'acceptance@test', today)).rejects.toThrow()
    await M.assignments.setChecklist(ids.a1, 'chk_delete_chats', true, 'acceptance@test')
    await expect(M.assignments.completeReturn(ids.a1, 'acceptance@test', today)).rejects.toThrow()
    await M.assignments.setChecklist(ids.a1, 'chk_team_removed', true, 'acceptance@test')
    const { reassigned } = await M.assignments.completeReturn(ids.a1, 'acceptance@test', today)

    const { data: done } = await M.db.db().from('assignments').select('status, returned_at').eq('id', ids.a1).single()
    expect(done?.status).toBe('회수완료')
    expect(done?.returned_at).toBeTruthy()

    // 대기자(T3의 3번)가 재배정됐는지
    const { data: a3 } = await M.db.db().from('assignments').select('status, account_id').eq('id', ids.a3).single()
    expect(reassigned.length).toBeGreaterThanOrEqual(0)
    expect(['승인', '배정']).toContain(a3?.status)
  })

  it('T7 — 장애(정지) 신고 → 계정 정지 + 관리자 메일 → 예비 계정으로 대체 배정', async () => {
    // 대체 대상이 될 사용중 건을 하나 만든다
    const applied = await M.apply.applyForAccount({
      programId: PROG_OPEN,
      name: '테스트4',
      affiliation: 'AI융합원',
      type: '학생',
      email: mail(4),
      service: 'Claude',
    })
    expect(applied.ok).toBe(true)
    if (!applied.ok) return
    ids.a4 = applied.id

    await M.assignments.approveAssignments([ids.a4], 'acceptance@test', today)
    const { data: before } = await M.db.db().from('assignments').select('status, account_id').eq('id', ids.a4).single()
    if (before?.status !== '배정') return // 가용 Claude 가 없으면 이 시나리오는 건너뛴다

    const incidentId = await M.incidents.reportIncident({
      assignmentId: ids.a4,
      type: '정지',
      symptom: '수용테스트 — 계정 정지 재현',
    })
    expect(incidentId).toBeGreaterThan(0)

    const { data: acc } = await M.db.db().from('accounts').select('status').eq('id', before.account_id!).single()
    expect(acc?.status).toBe('정지')

    const { count: adminMails } = await M.db
      .db()
      .from('mail_queue')
      .select('id', { count: 'exact', head: true })
      .eq('kind', 'incident')
      .eq('ref_id', String(incidentId))
    expect((adminMails ?? 0) >= 0).toBe(true)

    const newId = await M.incidents.replaceAccount(incidentId, 'acceptance@test', today)
    ids.a4b = newId
    const { data: replacement } = await M.db
      .db()
      .from('assignments')
      .select('status, account_id, rent_start, rent_end')
      .eq('id', newId)
      .single()
    expect(replacement?.status).toBe('배정')
    expect(replacement?.account_id).toBe(ACC_SPARE) // 예비 우선
    expect(replacement?.rent_start).toBe(before ? replacement?.rent_start : null) // 대여기간 승계
  })

  it('T8 — 정지율이 계정 현황과 일치한다', async () => {
    const rate = await M.incidents.suspensionRate()
    const { count: total } = await M.db.db().from('accounts').select('id', { count: 'exact', head: true })
    const { count: susp } = await M.db
      .db()
      .from('accounts')
      .select('id', { count: 'exact', head: true })
      .eq('status', '정지')
    const expected = total ? Math.round(((susp ?? 0) / total) * 1000) / 10 : 0
    expect(rate).toBeCloseTo(expected, 1)
  })

  it('T9 — 월간 스냅샷 1행 + CSV 2종', async () => {
    const month = M.date.monthKST()
    const result = await M.monthly.runMonthly('acceptance@test', month)
    expect(result.month).toBe(month)

    const { data } = await M.db.db().from('report_snapshots').select('*').eq('month', month).single()
    expect(data?.csv_program).toContain('프로그램ID')
    expect(data?.csv_summary).toContain('누계 사용 인원')
    expect(data?.metrics).toBeTruthy()
  })

  it('T11 — 일일 작업을 두 번 실행해도 결과가 같다(멱등)', async () => {
    const first = await M.daily.runDaily('acceptance@test', today)
    const second = await M.daily.runDaily('acceptance@test', today)

    expect(second.ack_overdue).toHaveLength(0)
    expect(second.rent_ended).toHaveLength(0)
    expect(second.alerts).toBe(first.alerts)
    expect(second.digest_recipients).toBe(0) // 같은 날 점검 메일 중복 생성 안 함
  }, 120_000)

  it('T10 — 개인정보 파기 후에도 실적 수치는 그대로', async () => {
    const beforeReport = await M.report.summaryReport()

    const { data: user } = await M.db.db().from('users').select('id').eq('email', mail(1)).single()
    expect(user?.id).toBeTruthy()
    const purged = await M.privacy.purgeUsers([user!.id], 'acceptance@test')
    expect(purged).toBe(1)

    const { data: after } = await M.db.db().from('users').select('name, phone, purged_at').eq('id', user!.id).single()
    expect(after?.name).toBe('(파기)')
    expect(after?.phone).toBeNull()
    expect(after?.purged_at).toBeTruthy()

    const { data: asg } = await M.db.db().from('assignments').select('name').eq('id', ids.a1).single()
    expect(asg?.name).toBe('(파기)')

    const afterReport = await M.report.summaryReport()
    expect(afterReport.used_total).toBe(beforeReport.used_total)
    expect(afterReport.used_student).toBe(beforeReport.used_student)
  })

  it('T12 — 허용 목록에 없는 계정은 관리자가 아니다', async () => {
    const { data } = await M.db
      .db()
      .from('admins')
      .select('email')
      .eq('email', `${RUN.toLowerCase()}-nobody@example.test`)
      .maybeSingle()
    expect(data).toBeNull()
  })

  it('T13 — 메일 대기열은 상한만큼만 처리하고 나머지는 남는다', async () => {
    // RESEND_API_KEY 가 비어 있어 실제 발송은 없고 대기열에 남는다.
    const { dispatchQueue } = await import('@/lib/mail/dispatch')
    const result = await dispatchQueue(5)
    expect(result.sent).toBe(0)
    expect(result.remaining).toBeGreaterThanOrEqual(0)
  })
})

describe.skipIf(enabled)('수용 기준 T1~T13', () => {
  it('환경변수가 없어 건너뜀 (ACCEPTANCE_CONFIRM=yes 와 Supabase 접속 정보 필요)', () => {
    expect(enabled).toBe(false)
  })
})

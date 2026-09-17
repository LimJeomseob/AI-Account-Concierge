/**
 * 신청 → 접수 → 승인·배정 → 인수 → 대여 종료 → 회수 → 재배정 생애주기 검수 (가상 시뮬레이션).
 * 각 단계의 DB 상태·메일 본문·로그를 출력해 사람이 검수할 수 있게 한다.
 *
 * 실행:
 *   ACCEPTANCE_CONFIRM=yes SIM_EMAIL=eros4424@gmail.com npm run test:acceptance -- lifecycle
 *
 *  - 실제 DB 에 쓰고 마지막에 지운다. 시범/스테이징 프로젝트에서만 실행할 것.
 *  - RESEND_API_KEY 는 강제로 비운다(메일은 대기열까지만, 실제 발송 없음).
 *  - 접속 링크가 있는 좌석 1개 + 없는 좌석 1개를 만들어 R14-2·R16 보류 동작까지 확인한다.
 */
import 'dotenv/config'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const enabled =
  process.env.ACCEPTANCE_CONFIRM === 'yes' &&
  !!process.env.SUPABASE_URL &&
  !!process.env.SUPABASE_SERVICE_ROLE_KEY &&
  !!process.env.APP_SECRET

process.env.RESEND_API_KEY = ''

const APPLICANT = (process.env.SIM_EMAIL ?? 'eros4424@gmail.com').toLowerCase()
const RUN = `ZSIM${Date.now().toString(36).toUpperCase()}`
const PROG = `${RUN}-P1`
const SEAT_OK = `${RUN}-G1` // 접속 링크 있음
const SEAT_NOLINK = `${RUN}-G2` // 접속 링크 없음 → 배정 제외
const WAITER = `${RUN.toLowerCase()}-waiter@example.test` // 재배정을 받을 대기자
const ACCESS_URL = 'https://chatgpt.com/g/team-gnuxai/seat-01'

type Mods = {
  db: typeof import('@/lib/db')
  date: typeof import('@/lib/date')
  apply: typeof import('@/lib/ops/apply')
  assignments: typeof import('@/lib/ops/assignments')
  accounts: typeof import('@/lib/ops/accounts')
  alerts: typeof import('@/lib/alerts')
  daily: typeof import('@/lib/cron/daily')
  token: typeof import('@/lib/token')
}
let M: Mods
let today = ''
const ids = { a1: '', waiter: '' }
const report: string[] = []
const step = (title: string, lines: Array<string | null | undefined> = []) => {
  report.push(`\n■ ${title}`)
  for (const l of lines) if (l) report.push(`   ${l}`)
}

describe.skipIf(!enabled)(`생애주기 검수 — 신청자 ${APPLICANT}`, () => {
  beforeAll(async () => {
    M = {
      db: await import('@/lib/db'),
      date: await import('@/lib/date'),
      apply: await import('@/lib/ops/apply'),
      assignments: await import('@/lib/ops/assignments'),
      accounts: await import('@/lib/ops/accounts'),
      alerts: await import('@/lib/alerts'),
      daily: await import('@/lib/cron/daily'),
      token: await import('@/lib/token'),
    }
    today = M.date.todayKST()
    const db = M.db.db

    // 이전에 남은 같은 신청자 활성 건이 있으면 이 시뮬레이션이 중복 거부에 걸리므로 알려 준다.
    const { data: prior } = await db()
      .from('assignments')
      .select('id, status, program_id')
      .eq('email', APPLICANT)
      .in('status', ['신청', '승인', '배정', '사용중', '회수중', '회수완료'])
    if (prior && prior.length > 0) {
      report.push(`(참고) ${APPLICANT} 의 기존 활성 배정 ${prior.length}건 — 다른 프로그램이므로 이 시뮬레이션과 충돌하지 않음`)
    }

    // 프로그램: 진행중, 배정일기준 7일
    await db().from('programs').insert({
      id: PROG,
      name: `[검수] ${RUN} 초·중급 AI 활용 특강`,
      target: '학생',
      mode: '배정일기준',
      days: 7,
      cap: 0,
      status: '진행중',
    })
    // 좌석 2개: 링크 있음 / 없음
    await M.accounts.importAccounts(
      [
        { id: SEAT_OK, service: 'GPT', kind: '운영', login_email: 'seat01@gnuxai.ac.kr', access_url: ACCESS_URL, expires_on: '2099-12-31' },
        { id: SEAT_NOLINK, service: 'GPT', kind: '운영', login_email: 'seat02@gnuxai.ac.kr', access_url: '', expires_on: '2099-12-31' },
      ],
      'sim',
    )
    step('0. 준비', [
      `프로그램 ${PROG} — 진행중 · 배정일기준 7일`,
      `좌석 ${SEAT_OK} — 접속 링크 등록(${ACCESS_URL})`,
      `좌석 ${SEAT_NOLINK} — 접속 링크 없음(배정 제외 대상)`,
    ])
  }, 60_000)

  afterAll(async () => {
    console.log(['', '='.repeat(72), ` 생애주기 검수 결과 (${today})`, '='.repeat(72), ...report, ''].join('\n'))
    if (!enabled || !M) return
    const db = M.db.db
    const { data: asgs } = await db().from('assignments').select('id, user_id').eq('program_id', PROG)
    const asgIds = (asgs ?? []).map((a) => a.id)
    const userIds = [...new Set((asgs ?? []).map((a) => a.user_id))]
    await db().from('accounts').update({ status: '가용', current_assignment_id: null }).like('id', `${RUN}%`)
    if (asgIds.length > 0) {
      await db().from('alerts').delete().in('assignment_id', asgIds)
      await db().from('mail_queue').delete().in('ref_id', asgIds)
      await db().from('incidents').delete().in('assignment_id', asgIds)
      await db().from('assignments').delete().in('id', asgIds)
    }
    // 신청자 users 행은 다른 프로그램 신청과 공유될 수 있으므로 이 시뮬레이션이 만든 경우에만 지운다
    for (const uid of userIds) {
      const { count } = await db().from('assignments').select('id', { count: 'exact', head: true }).eq('user_id', uid)
      if ((count ?? 0) === 0) await db().from('users').delete().eq('id', uid)
    }
    await db().from('account_secrets').delete().like('account_id', `${RUN}%`)
    await db().from('accounts').delete().like('id', `${RUN}%`)
    await db().from('programs').delete().eq('id', PROG)
    await db().from('mail_queue').delete().eq('ref_id', today).eq('kind', 'digest')
  }, 60_000)

  it('1. 신청 — 접수번호 발급, 접수안내 메일 대기열, 중복 신청 거부 (R7~R11)', async () => {
    const res = await M.apply.applyForAccount({
      programId: PROG,
      name: '검수 신청자',
      affiliation: 'AI융합원',
      type: '교원',
      email: APPLICANT,
      phone: '010-0000-0000',
      service: 'GPT',
    })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    ids.a1 = res.id

    const { data: row } = await M.db.db().from('assignments').select('status, name, email, service_wish, rent_start, rent_end').eq('id', res.id).single()
    const { data: mail } = await M.db.db().from('mail_queue').select('to_email, subject, body_text, status').eq('ref_id', res.id).eq('kind', 'intake').single()
    expect(row?.status).toBe('신청')
    expect(mail?.to_email).toBe(APPLICANT)

    const dup = await M.apply.applyForAccount({ programId: PROG, name: '검수 신청자', affiliation: 'AI융합원', type: '교원', email: APPLICANT.toUpperCase() })
    expect(dup.ok).toBe(false)

    step('1. 신청 접수', [
      `접수번호 ${res.id} · 상태 ${row?.status} · 희망 ${row?.service_wish} · 대여기간 표시 「${res.period}」`,
      `접수안내 메일 → ${mail?.to_email} (대기열 ${mail?.status}) 제목: ${mail?.subject}`,
      `중복 신청(대문자 이메일) → 거부: ${!dup.ok ? dup.msg : ''}`,
    ])
  })

  it('2. 승인 → 자동 배정 — 링크 있는 좌석만 배정, 배정안내 메일에 접속 링크 (R13·R14·R16)', async () => {
    const pool = await M.assignments.availablePool()
    expect(pool.map((p) => p.id)).toContain(SEAT_OK)
    expect(pool.map((p) => p.id)).not.toContain(SEAT_NOLINK)

    const r = await M.assignments.approveAssignments([ids.a1], 'admin@gnuxai.ac.kr', today)
    expect(r.assigned).toContain(ids.a1)

    const { data: row } = await M.db.db().from('assignments').select('status, account_id, service, rent_start, rent_end, notified_at').eq('id', ids.a1).single()
    const { data: acc } = await M.db.db().from('accounts').select('status, current_assignment_id').eq('id', SEAT_OK).single()
    const { data: mail } = await M.db.db().from('mail_queue').select('to_email, subject, body_text').eq('ref_id', ids.a1).eq('kind', 'assignment').single()
    expect(row?.status).toBe('배정')
    expect(row?.account_id).toBe(SEAT_OK)
    expect(acc?.status).toBe('배정')
    expect(mail?.body_text).toContain(ACCESS_URL)
    expect(mail?.body_text).not.toContain('비밀번호:')

    step('2. 승인·자동 배정', [
      `배정 풀: ${pool.map((p) => p.id).join(', ')}  (${SEAT_NOLINK} 는 링크 없어 제외)`,
      `${ids.a1} → 좌석 ${row?.account_id} (${row?.service}) · 상태 ${row?.status} · 대여 ${row?.rent_start} ~ ${row?.rent_end}`,
      `좌석 ${SEAT_OK}: ${acc?.status}, current=${acc?.current_assignment_id}`,
      `배정안내 메일 → ${mail?.to_email} · 발송기록 notified_at=${row?.notified_at ? '기록됨' : '없음'}`,
      '--- 메일 본문 ---',
      ...String(mail?.body_text ?? '').split('\n').map((l: string) => `   ${l}`),
      '--- 끝 ---',
    ])
  })

  it('2-1. 대기자 — 좌석이 없으면 「승인」 대기, 링크 없는 좌석에 링크를 넣으면 즉시 배정 (R14-2)', async () => {
    const w = await M.apply.applyForAccount({ programId: PROG, name: '대기자', affiliation: 'AI융합원', type: '학생', email: WAITER, service: 'GPT' })
    expect(w.ok).toBe(true)
    if (!w.ok) return
    ids.waiter = w.id
    const r = await M.assignments.approveAssignments([w.id], 'admin@gnuxai.ac.kr', today)
    expect(r.assigned).toHaveLength(0)
    const { data: before } = await M.db.db().from('assignments').select('status').eq('id', w.id).single()
    expect(before?.status).toBe('승인')

    // 관리자가 두 번째 좌석에 링크 등록 → 자동 배정 실행 → 대기자 배정
    await M.accounts.setAccessUrl(SEAT_NOLINK, 'https://chatgpt.com/g/team-gnuxai/seat-02', 'admin@gnuxai.ac.kr')
    const assigned = await M.assignments.autoAssignAll('admin@gnuxai.ac.kr', today)
    expect(assigned).toContain(w.id)
    const { data: after } = await M.db.db().from('assignments').select('status, account_id').eq('id', w.id).single()
    expect(after?.account_id).toBe(SEAT_NOLINK)

    step('2-1. 대기자 처리', [
      `대기자 ${w.id} 승인 시 가용 좌석 없음 → 상태 「${before?.status}」 유지`,
      `좌석 ${SEAT_NOLINK} 에 링크 등록 → 자동 배정 → ${after?.status}, 좌석 ${after?.account_id}`,
    ])
  })

  it('3. 인수 확인 — 서명 링크 검증, 위조 거부, 사용중 전환 (R18)', async () => {
    const url = M.token.ackUrl('http://localhost:3000', ids.a1)
    const t = new URL(url).searchParams.get('t')
    expect(M.token.verifyAckToken(ids.a1, t)).toBe(true)
    expect(M.token.verifyAckToken(ids.a1, '0'.repeat(24))).toBe(false)
    expect(await M.assignments.acknowledge(ids.a1, 'public')).toBe('ok')
    expect(await M.assignments.acknowledge(ids.a1, 'public')).toBe('already')
    const { data: row } = await M.db.db().from('assignments').select('status, acknowledged_at').eq('id', ids.a1).single()
    expect(row?.status).toBe('사용중')
    step('3. 인수 확인', [
      `인수 링크 ${url}`,
      `토큰 검증 통과 · 위조 토큰 거부 · 두 번째 클릭 → already`,
      `상태 ${row?.status}, acknowledged_at ${row?.acknowledged_at}`,
    ])
  })

  it('4. 대여 종료(일일 작업) — 회수중 전환, 알림, 점검 메일 (R20·R22·R32)', async () => {
    const yesterday = M.date.addDays(today, -1)
    await M.db.db().from('assignments').update({ rent_end: yesterday }).eq('id', ids.a1)

    const d1 = await M.daily.runDaily('system', today)
    expect(d1.rent_ended).toContain(ids.a1)
    const d2 = await M.daily.runDaily('system', today) // 멱등
    expect(d2.rent_ended).toHaveLength(0)

    const { data: row } = await M.db.db().from('assignments').select('status').eq('id', ids.a1).single()
    const { data: acc } = await M.db.db().from('accounts').select('status, alert, current_assignment_id').eq('id', SEAT_OK).single()
    const alerts = (await M.alerts.listAlerts()).filter((a) => a.assignment_id === ids.a1)
    const { data: digest } = await M.db.db().from('mail_queue').select('body_text').eq('kind', 'digest').eq('ref_id', today).maybeSingle()
    expect(row?.status).toBe('회수중')
    expect(acc?.status).toBe('회수중')
    expect(alerts).toHaveLength(1)

    step('4. 대여 종료 → 회수중', [
      `rent_end 를 ${yesterday} 로 두고 일일 작업 실행 → 종료 처리 ${d1.rent_ended.length}건, 2회째 ${d2.rent_ended.length}건(멱등)`,
      `배정 ${ids.a1}: ${row?.status} · 좌석 ${SEAT_OK}: ${acc?.status}, current=${acc?.current_assignment_id}`,
      `계정 알림: ${acc?.alert}`,
      `alerts: [${alerts[0]?.category}] ${alerts[0]?.guide}`,
      digest ? `점검 메일 「회수 대상」 포함 여부: ${digest.body_text?.includes(ids.a1) ? '포함' : '미포함(수신 관리자 미설정 시 생략)'}` : '점검 메일: 수신 관리자(admin_emails) 미설정으로 생성 안 됨',
    ])
  })

  it('5. 회수 — 체크 2개 전 거부, 완료 후 좌석 가용, 대기자 재배정 (R24)', async () => {
    // 재배정을 받을 대기자를 하나 더 만든다 (좌석 2개가 모두 사용 중이므로 승인 상태로 대기)
    const w2 = await M.apply.applyForAccount({ programId: PROG, name: '대기자2', affiliation: 'AI융합원', type: '학생', email: `${RUN.toLowerCase()}-w2@example.test`, service: 'GPT' })
    expect(w2.ok).toBe(true)
    if (!w2.ok) return
    await M.assignments.approveAssignments([w2.id], 'admin@gnuxai.ac.kr', today)

    await expect(M.assignments.completeReturn(ids.a1, 'admin@gnuxai.ac.kr', today)).rejects.toThrow('2개')
    await M.assignments.setChecklist(ids.a1, 'chk_delete_chats', true, 'admin@gnuxai.ac.kr')
    await expect(M.assignments.completeReturn(ids.a1, 'admin@gnuxai.ac.kr', today)).rejects.toThrow('2개')
    await M.assignments.setChecklist(ids.a1, 'chk_team_removed', true, 'admin@gnuxai.ac.kr')
    const { reassigned } = await M.assignments.completeReturn(ids.a1, 'admin@gnuxai.ac.kr', today)

    const { data: row } = await M.db.db().from('assignments').select('status, returned_at').eq('id', ids.a1).single()
    const { data: acc } = await M.db.db().from('accounts').select('status, current_assignment_id, assigned_count').eq('id', SEAT_OK).single()
    const { data: next } = await M.db.db().from('assignments').select('status, account_id').eq('id', w2.id).single()
    expect(row?.status).toBe('회수완료')
    expect(reassigned).toContain(w2.id)
    expect(next?.account_id).toBe(SEAT_OK)
    expect(acc?.status).toBe('배정') // 재배정으로 곧바로 다시 배정됨

    step('5. 회수 → 재배정', [
      `체크 0개·1개 상태에서 「회수 완료」 → 거부(2개 항목 필요)`,
      `① 대화·메모리 삭제 ② 팀에서 제거 체크 후 회수 완료 → ${row?.status}, returned_at ${row?.returned_at}`,
      `좌석 ${SEAT_OK} → 대기자2 ${w2.id} 에게 즉시 재배정 (좌석 상태 ${acc?.status}, current=${acc?.current_assignment_id})`,
    ])
  })

  it('6. 로그 — 모든 상태 변경이 actor 와 함께 기록됨 (R31)', async () => {
    const { data: logs } = await M.db.db().from('logs').select('actor, action, target_id').eq('target_id', ids.a1).order('id')
    const actions = (logs ?? []).map((l) => `${l.action}(${l.actor})`)
    expect(actions.some((a) => a.startsWith('assignment.apply'))).toBe(true)
    expect(actions.some((a) => a.startsWith('assignment.return_complete'))).toBe(true)
    step('6. 로그', [`${ids.a1}: ${actions.join(' → ')}`])
  })
})

describe.skipIf(enabled)('생애주기 검수', () => {
  it('환경변수가 없어 건너뜀 (ACCEPTANCE_CONFIRM=yes 와 Supabase 접속 정보 필요)', () => {
    expect(enabled).toBe(false)
  })
})

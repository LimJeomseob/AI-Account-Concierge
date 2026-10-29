import { beforeAll, describe, expect, it } from 'vitest'
import { addDays, diffDays, formatKorean, inclusiveDays, monthKST, prevMonthKST, todayKST, yymmddKST } from '@/lib/date'
import { renderTemplate, extractPlaceholders, textToHtml } from '@/lib/mail/render'
import { formatAccountId, formatAssignmentId, formatProgramId, formatUserId } from '@/lib/ids'
import { alertText } from '@/lib/alerts'
import { canTransitionAccount, canTransitionAssignment } from '@/lib/state'
import { supportStatus, toCsv } from '@/lib/report'
import { applicantCsv, applicantEmails, assignExportMessage, assignedCsv, exportQuery } from '@/lib/ops/export'
import { acceptanceEnabled } from './integration-guard'
import { classifyMailError } from '@/lib/mail/dispatch'
import { assignedDaysOf } from '@/lib/assign'
import { accountStatusOptions, canManuallySetAccount } from '@/lib/transitions'
import { incidentToken, verifyIncidentToken } from '@/lib/token'
import { sign, verify } from '@/lib/token'
import { parseAccountCsv, splitCsvLine } from '@/lib/ops/accounts'

beforeAll(() => {
  process.env.APP_SECRET = 'test-secret'
})

describe('date (R33)', () => {
  it('Asia/Seoul 기준 오늘을 쓴다 — UTC 자정 직후는 이미 다음 날', () => {
    expect(todayKST(new Date('2026-09-03T15:30:00Z'))).toBe('2026-09-04')
    expect(todayKST(new Date('2026-09-03T14:30:00Z'))).toBe('2026-09-03')
  })
  it('yymmdd / month 유틸', () => {
    expect(yymmddKST(new Date('2026-09-03T15:30:00Z'))).toBe('260904')
    expect(monthKST(new Date('2026-09-03T15:30:00Z'))).toBe('2026-09')
    expect(prevMonthKST(new Date('2026-01-03T15:30:00Z'))).toBe('2025-12')
  })
  it('날짜 연산', () => {
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01')
    expect(diffDays('2026-09-01', '2026-09-30')).toBe(29)
    expect(inclusiveDays('2026-09-01', '2026-09-30')).toBe(30)
    expect(inclusiveDays('2026-09-30', '2026-09-01')).toBe(0)
    expect(formatKorean('2026-09-04')).toBe('2026. 9. 4.')
  })
})

describe('mail render (§8)', () => {
  it('{치환자}를 값으로 바꾸고 모르는 치환자는 남긴다', () => {
    expect(renderTemplate('{이름} 님 {없는것}', { 이름: '홍길동' })).toBe('홍길동 님 {없는것}')
  })
  it('null 값은 빈 문자열', () => {
    expect(renderTemplate('[{접속링크}]', { 접속링크: null })).toBe('[]')
  })
  it('치환자 목록 추출', () => {
    expect(extractPlaceholders('{이름}{프로그램명}{이름}')).toEqual(['이름', '프로그램명'])
  })
  it('HTML 변환 시 태그를 이스케이프하고 링크를 만든다', () => {
    const html = textToHtml('<b>x</b> https://example.com/a')
    expect(html).toContain('&lt;b&gt;')
    expect(html).toContain('<a href="https://example.com/a"')
  })
})

describe('ids (§4-2)', () => {
  it('형식을 지킨다', () => {
    expect(formatProgramId('P26', 1)).toBe('P26-01')
    expect(formatUserId(1)).toBe('U-0001')
    expect(formatAssignmentId('260904', 1)).toBe('A260904-0001')
    expect(formatAccountId('Claude', 1)).toBe('CL-001')
  })
})

describe('token (§8)', () => {
  it('서명은 24자 hex 이고 검증에 통과한다', () => {
    const t = sign('A260904-0001', 'k')
    expect(t).toMatch(/^[0-9a-f]{24}$/)
    expect(verify('A260904-0001', t, 'k')).toBe(true)
  })
  it('위조 토큰은 거부한다 (T4)', () => {
    expect(verify('A260904-0001', '0'.repeat(24), 'k')).toBe(false)
    expect(verify('A260904-0001', null, 'k')).toBe(false)
    expect(verify('A260904-0002', sign('A260904-0001', 'k'), 'k')).toBe(false)
  })
})

describe('alertText (R22)', () => {
  it('만료·체크완료 문구 (미인수 문구는 인수 확인 폐지로 제거)', () => {
    expect(alertText({ category: '대여기간 만료', rentEnd: '2026-09-01', elapsedDays: 3, checklistDone: false })).toBe(
      '⚠ 대여기간 만료(2026-09-01, D+3) — 대화·메모리 삭제 후 팀에서 제거 필요',
    )
    expect(alertText({ category: '대여기간 만료', rentEnd: '2026-09-01', elapsedDays: 3, checklistDone: true })).toBe(
      '회수 체크리스트 완료 — 회수 완료 처리 필요',
    )
  })
})

describe('state (§5)', () => {
  it('허용된 전이만 통과한다', () => {
    expect(canTransitionAssignment('신청', '승인')).toBe(true)
    expect(canTransitionAssignment('승인', '사용중')).toBe(true) // 배정 즉시 사용중 (인수 확인 폐지)
    expect(canTransitionAssignment('배정', '사용중')).toBe(true) // 구 데이터 호환
    expect(canTransitionAssignment('회수완료', '배정')).toBe(false)
    expect(canTransitionAssignment('신청', '사용중')).toBe(false)
    expect(canTransitionAccount('가용', '배정')).toBe(true)
    expect(canTransitionAccount('회수중', '배정')).toBe(false)
  })
  it('같은 상태로의 전이는 멱등 허용 (R32)', () => {
    expect(canTransitionAssignment('회수중', '회수중')).toBe(true)
  })
})

describe('csv (§10)', () => {
  it('쉼표·따옴표를 이스케이프하고 BOM 을 붙인다', () => {
    const csv = toCsv(['a', 'b'], [['1,2', 'x"y']])
    expect(csv.startsWith('﻿')).toBe(true)
    expect(csv).toContain('"1,2"')
    expect(csv).toContain('"x""y"')
  })
})

describe('계정 CSV 파싱 (§7-2)', () => {
  it('헤더 순서와 무관하게 읽고 날짜를 정규화한다', () => {
    const rows = parseAccountCsv(
      [
        '계정번호,서비스,구분,로그인이메일,접속링크,활성화일,만료일',
        'GPT-001,GPT,운영,a@b.ac.kr,https://t.example/g1,2026.09.01,2027-03-31',
        'CL-001,Claude,예비,c@d.ac.kr,,,',
      ].join('\n'),
    )
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      id: 'GPT-001',
      service: 'GPT',
      kind: '운영',
      login_email: 'a@b.ac.kr',
      activated_on: '2026-09-01',
      expires_on: '2027-03-31',
    })
    expect(rows[1]).toMatchObject({ service: 'Claude', kind: '예비' })
    expect(rows[0]).not.toHaveProperty('access_url') // 접속링크 열은 무시(R14-2 폐지)
  })

  it('예전 헤더 「계정ID」도 읽고, 로그인이메일 열이 없으면 건드리지 않는다', () => {
    const rows = parseAccountCsv(['계정ID,서비스', 'CL-071,Claude'].join('\n'))
    expect(rows[0]).toMatchObject({ id: 'CL-071', service: 'Claude', kind: '운영' })
    expect(rows[0].login_email).toBeUndefined()
  })

  it('따옴표 안의 쉼표를 지킨다', () => {
    expect(splitCsvLine('a,"b,c",d')).toEqual(['a', 'b,c', 'd'])
  })
})


describe('신청자 목록 내려받기 (R7·R30)', () => {
  const rows = [
    {
      id: 'A261028-0001', name: '홍길동', email: 'Hong@Example.com', program_id: 'P26-01', service_wish: 'GPT',
      account_id: 'GPT-001', service: 'GPT', status: '사용중', applied_at: '2026-10-27T15:30:00Z',
      rent_start: '2026-10-28', rent_end: '2026-11-26', programs: { name: '특강' }, users: { affiliation: 'AI융합원', type: '교원' },
    },
    {
      id: 'A261028-0002', name: '(파기)', email: 'u-0002@purged.local', program_id: 'P26-01', service_wish: '무관',
      account_id: null, service: null, status: '회수완료', applied_at: '2026-10-27T10:00:00Z',
      rent_start: null, rent_end: null, programs: null, users: null,
    },
    { id: 'A261028-0003', name: '홍길동', email: 'hong@example.com', program_id: 'P26-02', service_wish: '무관',
      account_id: null, service: null, status: '신청', applied_at: '2026-10-28T01:00:00Z', rent_start: null, rent_end: null },
  ]

  it('CSV — BOM·헤더·KST 신청일·프로그램명 대체', () => {
    const csv = applicantCsv(rows)
    const lines = csv.split('\n')
    expect(lines[0].startsWith('﻿접수번호,프로그램,이름,이메일')).toBe(true)
    expect(lines[1]).toBe('A261028-0001,특강,홍길동,Hong@Example.com,AI융합원,교원,GPT,GPT-001 (GPT),사용중,2026-10-28,2026-11-26,2026-10-28')
    expect(lines[2]).toContain(',P26-01,(파기),u-0002@purged.local,,,')
    expect(csv).not.toContain('https://') // 접속 링크는 포함하지 않는다
  })

  it('이메일 목록 — 소문자·중복 제거·파기 계정 제외', () => {
    expect(applicantEmails(rows)).toEqual(['hong@example.com'])
  })

  it('내려받기 쿼리는 빈 필터를 생략한다', () => {
    expect(exportQuery({})).toBe('')
    expect(exportQuery({ status: '신청', program: '', name: '홍' })).toBe('?status=%EC%8B%A0%EC%B2%AD&name=%ED%99%8D')
    expect(exportQuery({ account: 'CL-001', email: 'a@b' })).toBe('?email=a%40b&account=CL-001')
  })
})

describe('통합 테스트 실행 가드 (운영 DB 오실행 방지)', () => {
  const base = { ACCEPTANCE_CONFIRM: 'yes', SUPABASE_URL: 'https://abcd.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k', APP_SECRET: 's' }
  it('호스트를 명시하고 일치할 때만 켜진다', () => {
    expect(acceptanceEnabled({ ...base, ACCEPTANCE_DB_HOST: 'abcd.supabase.co' })).toBe(true)
    expect(acceptanceEnabled({ ...base, ACCEPTANCE_DB_HOST: 'ABCD.supabase.co ' })).toBe(true)
  })
  it('호스트 미지정·불일치·확인 누락이면 꺼진다', () => {
    expect(acceptanceEnabled({ ...base })).toBe(false)
    expect(acceptanceEnabled({ ...base, ACCEPTANCE_DB_HOST: 'prod.supabase.co' })).toBe(false)
    expect(acceptanceEnabled({ ...base, ACCEPTANCE_DB_HOST: 'abcd.supabase.co', ACCEPTANCE_CONFIRM: 'no' })).toBe(false)
  })
})

describe('메일 오류 분류 (§8 Gmail SMTP)', () => {
  it('인증 실패는 auth — 즉시 중단', () => {
    expect(classifyMailError({ code: 'EAUTH', message: 'Invalid login' })).toBe('auth')
    expect(classifyMailError('535-5.7.8 Username and Password not accepted')).toBe('auth')
    expect(classifyMailError({ message: '454-4.7.0 Too many login attempts, please try again later', code: 'EAUTH' })).toBe('auth')
  })
  it('일일 한도·임시 차단은 limit', () => {
    expect(classifyMailError('550 5.4.5 Daily user sending limit exceeded')).toBe('limit')
    expect(classifyMailError('421 4.7.0 Temporary System Problem')).toBe('limit')
  })
  it('그 밖의 오류와 막연한 too many 는 retry', () => {
    expect(classifyMailError('550 5.1.1 The email account that you tried to reach does not exist')).toBe('retry')
    expect(classifyMailError('too many recipients in this message')).toBe('retry')
    expect(classifyMailError({ code: 'ETIMEDOUT', message: 'Connection timeout' })).toBe('retry')
  })
})

describe('2단계 보완 (R24·R25·R33·R26)', () => {
  it('배정일수 — returned_at 은 KST 날짜로 자른다', () => {
    // 2026-10-27T16:00Z = KST 10-28 01:00 회수 → 10-26~10-28 = 3일 (UTC 로 자르면 2일)
    const rows = [{ status: '회수완료', assigned_on: '2026-10-26', rent_start: '2026-10-26', rent_end: '2026-11-30', returned_at: '2026-10-27T16:00:00Z' }]
    expect(assignedDaysOf(rows, '2026-10-29')).toBe(3)
  })
  it('수동 계정 상태 변경 — 배정·회수중 만들기와 회수 체크리스트 우회 금지', () => {
    expect(canManuallySetAccount('가용', '배정')).toBe(false)
    expect(canManuallySetAccount('정지', '회수중')).toBe(false)
    expect(canManuallySetAccount('회수중', '가용')).toBe(false)
    expect(canManuallySetAccount('배정', '만료')).toBe(false)
    expect(canManuallySetAccount('배정', '정지')).toBe(true)
    expect(canManuallySetAccount('정지', '가용')).toBe(true)
    expect(accountStatusOptions('회수중')).toEqual(['회수중', '정지'])
  })
  it('토큰 검증 — 문자 수가 같은 멀티바이트 입력도 예외 없이 거부', () => {
    const t = incidentToken('A261028-0001')
    expect(verifyIncidentToken('A261028-0001', t)).toBe(true)
    expect(verifyIncidentToken('A261028-0001', '가'.repeat(t.length))).toBe(false)
  })
})

describe('승인 건 배정 + 메일 내려받기 (R14, 2026-10-29)', () => {
  it('CSV — BOM·이름·이메일·계정번호 3열', () => {
    const csv = assignedCsv([
      { name: '홍길동', email: 'hong@x.kr', account_id: 'GPT-001' },
      { name: '김, 철수', email: 'kim@x.kr', account_id: 'CL-071' },
    ])
    const lines = csv.split('\n')
    expect(lines[0]).toBe('﻿이름,이메일,계정번호')
    expect(lines[1]).toBe('홍길동,hong@x.kr,GPT-001')
    expect(lines[2]).toBe('"김, 철수",kim@x.kr,CL-071')
  })
  it('결과 안내 문구', () => {
    expect(assignExportMessage(0, 0, 0)).toContain('배정할 「승인」 건이 없습니다')
    const m = assignExportMessage(3, 1, 2)
    expect(m).toContain('3명 배정')
    expect(m).toContain('2명은 가용 계정이 없거나')
    expect(m).toContain('1명은 프로그램이 진행중이 아니거나')
  })
  it('반려 전이 없음 (R17 폐지)', () => {
    expect(canTransitionAssignment('신청', '반려')).toBe(false)
    expect(canTransitionAssignment('승인', '반려')).toBe(false)
    expect(canTransitionAssignment('신청', '승인')).toBe(true)
  })
})

describe('유료계정 지원현황', () => {
  it('서비스별 계약 대비 등록(만료 제외)·사용중·회수중·가용·정지', () => {
    const accounts = [
      { service: 'GPT', status: '배정' },
      { service: 'GPT', status: '가용' },
      { service: 'GPT', status: '정지' },
      { service: 'GPT', status: '만료' },
      { service: 'Claude', status: '회수중' },
      { service: 'Claude', status: '가용' },
    ]
    const [gpt, claude] = supportStatus(accounts, { GPT: 45, Claude: 71 })
    expect(gpt).toMatchObject({ label: 'ChatGPT Business Standard', contract: 45, registered: 3, inUse: 1, available: 1, suspended: 1 })
    expect(claude).toMatchObject({ label: 'Claude Team', contract: 71, registered: 2, returning: 1, available: 1 })
  })
})

describe('APP_SECRET 미설정 방어 (신청·배정 화면 서버 오류)', () => {
  it('비밀 값이 없으면 tryIncidentUrl 은 null, verify 는 false (예외 없음)', async () => {
    const { tryIncidentUrl, verify: v } = await import('@/lib/token')
    const saved = process.env.APP_SECRET
    delete process.env.APP_SECRET
    try {
      expect(tryIncidentUrl('https://x.test', 'A-1')).toBeNull()
      expect(v('msg', 'deadbeef')).toBe(false)
    } finally {
      process.env.APP_SECRET = saved
    }
    expect(tryIncidentUrl('https://x.test', 'A-1')).toMatch(/^https:\/\/x\.test\/incident\?/)
  })
})

describe('로그인 콜백 주소 (두 번 로그인 방지)', () => {
  const h = (m: Record<string, string>) => ({ get: (k: string) => m[k] ?? null })
  it('safeNext: 내부 경로만 허용', async () => {
    const { safeNext } = await import('@/lib/redirect')
    expect(safeNext('/admin/assignments')).toBe('/admin/assignments')
    expect(safeNext('//evil.com')).toBe('/admin/dashboard')
    expect(safeNext('https://evil.com')).toBe('/admin/dashboard')
    expect(safeNext('/\\evil.com')).toBe('/admin/dashboard')
    expect(safeNext(null)).toBe('/admin/dashboard')
  })
  it('appBase: 요청이 들어온 주소를 NEXT_PUBLIC_APP_URL 보다 먼저 쓴다', async () => {
    const { appBase } = await import('@/lib/redirect')
    expect(appBase(h({ 'x-forwarded-host': 'a.example.kr', 'x-forwarded-proto': 'https' }), 'http://localhost/x', 'https://b.example.kr')).toBe('https://a.example.kr')
    expect(appBase(h({}), 'https://c.example.kr/auth/callback', 'https://b.example.kr')).toBe('https://c.example.kr')
  })
})

describe('Google 계정 선택 생략 힌트', () => {
  it('loginHint: 이메일 형식만 통과, 소문자', async () => {
    const { loginHint } = await import('@/lib/redirect')
    expect(loginHint(' Admin@Example.KR ')).toBe('admin@example.kr')
    expect(loginHint('not-an-email')).toBeNull()
    expect(loginHint('a@b.c"><script>')).toBeNull()
    expect(loginHint(undefined)).toBeNull()
  })
})

describe('일괄 처리 묶음 (승인 속도 개선)', () => {
  it('chunk: n개씩 나누고 순서를 유지한다', async () => {
    const { chunk } = await import('@/lib/assign')
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
    expect(chunk([], 10)).toEqual([])
    expect(chunk([1, 2], 0)).toEqual([[1], [2]])
  })
})

describe('로그인 확인 — JWT 클레임에서 이메일 (getClaims)', () => {
  it('emailFromClaims: 문자열 이메일만 소문자로', async () => {
    const { emailFromClaims } = await import('@/lib/auth-cookie')
    expect(emailFromClaims({ email: 'Eros@Example.com' })).toBe('eros@example.com')
    expect(emailFromClaims({ email: '' })).toBeNull()
    expect(emailFromClaims({ email: 123 })).toBeNull()
    expect(emailFromClaims(null)).toBeNull()
  })
})

describe('유료계정 사용현황 필터', () => {
  it('parseFilter: 빈 값 제거·공백 정리·100자 제한, 모르는 키 무시', async () => {
    const { parseFilter } = await import('@/lib/filter')
    const m: Record<string, string> = { status: '사용중', program: '', name: ' 홍 ', q: 'old', account: 'x'.repeat(150), service: 'Claude' }
    const f = parseFilter((k) => m[k])
    expect(f).toEqual({ status: '사용중', service: 'Claude', name: '홍', account: 'x'.repeat(100) })
    expect(parseFilter((k) => (k === 'service' ? 'Gemini' : ''))).toEqual({})
  })
  it('likePattern: % _ \\ 는 글자 그대로', async () => {
    const { likePattern } = await import('@/lib/filter')
    expect(likePattern('CL-0')).toBe('%CL-0%')
    expect(likePattern('50%_a')).toBe('%50\\%\\_a%')
  })
  it('applyFilter: 조건별로 eq/ilike 를 걸고 skipStatus 면 상태를 뺀다', async () => {
    const { applyFilter } = await import('@/lib/filter')
    const calls: string[] = []
    const b = {
      eq(c: string, v: string) { calls.push(`eq:${c}=${v}`); return b },
      ilike(c: string, v: string) { calls.push(`ilike:${c}=${v}`); return b },
      or(v: string) { calls.push(`or:${v}`); return b },
    }
    applyFilter(b, { status: '승인', program: 'P26-01', service: 'GPT', name: '홍', email: 'gnu', account: 'CL' })
    expect(calls).toEqual([
      'eq:status=승인',
      'eq:program_id=P26-01',
      'or:service.eq.GPT,and(service.is.null,service_wish.eq.GPT)',
      'ilike:name=%홍%',
      'ilike:email=%gnu%',
      'ilike:account_id=%CL%',
    ])
    calls.length = 0
    applyFilter(b, { status: '승인', name: '홍' }, { skipStatus: true })
    expect(calls).toEqual(['ilike:name=%홍%'])
  })
})

describe('선택 승인 + 배정 + 이메일 내려받기', () => {
  it('assignedCsv: 계정이 없으면 (대기)', () => {
    const csv = assignedCsv([
      { name: '홍길동', email: 'a@gnu.ac.kr', account_id: 'CL-001' },
      { name: '김대기', email: 'b@gnu.ac.kr', account_id: null },
    ])
    expect(csv).toContain('홍길동,a@gnu.ac.kr,CL-001')
    expect(csv).toContain('김대기,b@gnu.ac.kr,(대기)')
  })
  it('approveAssignMessage: 승인·배정·대기 건수', async () => {
    const { approveAssignMessage } = await import('@/lib/ops/export')
    expect(approveAssignMessage(0, 0, 0)).toBe('선택한 건 중 승인할 「신청」 건이 없습니다.')
    expect(approveAssignMessage(3, 3, 0)).toBe('3명 승인 · 3명 배정 — 내려받은 이메일을 팀 워크스페이스에 초대해 주세요.')
    expect(approveAssignMessage(3, 2, 1)).toBe('3명 승인 · 2명 배정 · 1명 계정 대기(「승인」으로 남음) — 내려받은 이메일을 팀 워크스페이스에 초대해 주세요.')
  })
})

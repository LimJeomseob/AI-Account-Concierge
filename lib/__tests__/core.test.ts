import { beforeAll, describe, expect, it } from 'vitest'
import { addDays, diffDays, formatKorean, inclusiveDays, monthKST, prevMonthKST, todayKST, yymmddKST } from '@/lib/date'
import { renderTemplate, extractPlaceholders, textToHtml } from '@/lib/mail/render'
import { formatAccountId, formatAssignmentId, formatProgramId, formatUserId } from '@/lib/ids'
import { alertText } from '@/lib/alerts'
import { canTransitionAccount, canTransitionAssignment } from '@/lib/state'
import { toCsv } from '@/lib/report'
import { sign, verify } from '@/lib/token'
import { normalizeUrl, parseAccountCsv, splitCsvLine } from '@/lib/ops/accounts'

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
  it('만료·미인수·체크완료 문구', () => {
    expect(alertText({ category: '대여기간 만료', rentEnd: '2026-09-01', elapsedDays: 3, checklistDone: false })).toBe(
      '⚠ 대여기간 만료(2026-09-01, D+3) — 대화·메모리 삭제 후 팀에서 제거 필요',
    )
    expect(alertText({ category: '인수기한 초과', rentEnd: null, elapsedDays: 0, checklistDone: false })).toBe(
      '⚠ 인수기한 초과 — 회수 필요',
    )
    expect(alertText({ category: '대여기간 만료', rentEnd: '2026-09-01', elapsedDays: 3, checklistDone: true })).toBe(
      '회수 체크리스트 완료 — 회수 완료 처리 필요',
    )
  })
})

describe('state (§5)', () => {
  it('허용된 전이만 통과한다', () => {
    expect(canTransitionAssignment('신청', '승인')).toBe(true)
    expect(canTransitionAssignment('배정', '사용중')).toBe(true)
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
        '계정ID,서비스,구분,로그인이메일,접속링크,활성화일,만료일',
        'GPT-001,GPT,운영,a@b.ac.kr,https://t.example/g1,2026.09.01,2027-03-31',
        'CL-001,Claude,예비,c@d.ac.kr,,,',
      ].join('\n'),
    )
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      id: 'GPT-001',
      service: 'GPT',
      kind: '운영',
      access_url: 'https://t.example/g1',
      activated_on: '2026-09-01',
      expires_on: '2027-03-31',
    })
    expect(rows[1]).toMatchObject({ service: 'Claude', kind: '예비', access_url: '' })
  })

  it('따옴표 안의 쉼표를 지킨다', () => {
    expect(splitCsvLine('a,"b,c",d')).toEqual(['a', 'b,c', 'd'])
  })
})

describe('접속 링크 정규화 (R14-2)', () => {
  it('빈 값·공백은 미등록(null)', () => {
    expect(normalizeUrl('')).toBeNull()
    expect(normalizeUrl('   ')).toBeNull()
    expect(normalizeUrl(undefined)).toBeNull()
  })
  it('http(s) 만 허용하고 앞뒤 공백을 지운다', () => {
    expect(normalizeUrl('  https://team.example/seat/1  ')).toBe('https://team.example/seat/1')
    expect(() => normalizeUrl('team.example/seat/1')).toThrow()
  })
})

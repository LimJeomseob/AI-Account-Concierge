import { describe, expect, it } from 'vitest'
import {
  assignedDaysOf,
  capRemaining,
  isAccountEligible,
  isAssignable,
  isOpenForApply,
  periodFor,
  planAllocations,
  type PoolAccount,
  type QueueItem,
} from '@/lib/assign'

const fixed = { mode: '고정기간' as const, days: 0, start_on: '2026-09-01', end_on: '2026-09-30', status: '진행' as const }
const rolling = { mode: '배정일기준' as const, days: 30, start_on: null, end_on: null, status: '진행' as const }

describe('periodFor (R2·R15)', () => {
  it('고정기간은 프로그램 시작·종료일을 그대로 쓴다', () => {
    expect(periodFor(fixed, '2026-09-04')).toEqual({ start: '2026-09-01', end: '2026-09-30' })
  })

  it('배정일기준은 기준일부터 days−1 일', () => {
    expect(periodFor(rolling, '2026-09-04')).toEqual({ start: '2026-09-04', end: '2026-10-03' })
  })

  it('기간 미설정이면 null (R3 접수 준비 중)', () => {
    expect(periodFor({ ...fixed, start_on: null }, '2026-09-04')).toBeNull()
    expect(periodFor({ ...rolling, days: 0 }, '2026-09-04')).toBeNull()
  })
})

describe('isOpenForApply / isAssignable (R3·R15)', () => {
  it('종료된 프로그램은 접수·배정 대상이 아니다', () => {
    const closed = { ...fixed, status: '종료' as const }
    expect(isOpenForApply(closed, '2026-09-04')).toBe(false)
    expect(isAssignable(closed, '2026-09-04')).toBe(false)
  })

  it('고정기간 프로그램은 종료일이 지나면 배정 대상에서 빠진다', () => {
    expect(isOpenForApply(fixed, '2026-10-05')).toBe(true)
    expect(isAssignable(fixed, '2026-10-05')).toBe(false)
  })
})

describe('isAccountEligible (R14-2)', () => {
  const acc = (expires: string | null, kind: '운영' | '예비' = '운영'): PoolAccount => ({
    id: 'GPT-001',
    service: 'GPT',
    kind,
    expires_on: expires,
  })

  it('대여종료일까지 구독이 남아야 배정 가능', () => {
    expect(isAccountEligible(acc('2026-09-30'), '2026-09-30')).toBe(true)
    expect(isAccountEligible(acc('2026-09-29'), '2026-09-30')).toBe(false)
    expect(isAccountEligible(acc(null), '2026-09-30')).toBe(true)
  })

  it('예비 계정은 자동 배정 풀에서 제외', () => {
    expect(isAccountEligible(acc(null, '예비'), '2026-09-30')).toBe(false)
  })
})

describe('capRemaining (R5)', () => {
  it('cap 0 은 무제한', () => {
    expect(capRemaining(0, 100)).toBe(Number.POSITIVE_INFINITY)
  })
  it('상한에 도달하면 0', () => {
    expect(capRemaining(10, 10)).toBe(0)
    expect(capRemaining(10, 4)).toBe(6)
  })
})

describe('planAllocations (R12·R14) — T3 시나리오', () => {
  const period = { start: '2026-09-01', end: '2026-09-30' }
  const pool: PoolAccount[] = [
    { id: 'GPT-001', service: 'GPT', kind: '운영', expires_on: '2027-03-31' },
    { id: 'CL-001', service: 'Claude', kind: '운영', expires_on: '2027-03-31' },
  ]
  const queue: QueueItem[] = [
    { id: 'A-1', service_wish: 'GPT', applied_at: '2026-09-01T09:00:00Z' },
    { id: 'A-2', service_wish: '무관', applied_at: '2026-09-01T10:00:00Z' },
    { id: 'A-3', service_wish: 'Claude', applied_at: '2026-09-01T11:00:00Z' },
  ]

  it('가용 GPT 1·Claude 1 에 3명이면 신청 순으로 2명만 배정된다', () => {
    const plan = planAllocations({ period, queue, pool, capRemaining: Infinity })
    expect(plan).toHaveLength(2)
    expect(plan[0]).toMatchObject({ assignment_id: 'A-1', account_id: 'GPT-001', service: 'GPT' })
    expect(plan[1]).toMatchObject({ assignment_id: 'A-2', account_id: 'CL-001', service: 'Claude' })
  })

  it('신청 순서(applied_at)를 지킨다', () => {
    const shuffled = [queue[2], queue[0], queue[1]]
    const plan = planAllocations({ period, queue: shuffled, pool, capRemaining: Infinity })
    expect(plan[0].assignment_id).toBe('A-1')
  })

  it('cap 잔여만큼만 배정한다', () => {
    const plan = planAllocations({ period, queue, pool, capRemaining: 1 })
    expect(plan).toHaveLength(1)
  })

  it('희망 서비스 재고가 없으면 그 사람은 건너뛰고 대기한다', () => {
    const onlyClaude = [pool[1]]
    const plan = planAllocations({ period, queue, pool: onlyClaude, capRemaining: Infinity })
    expect(plan).toHaveLength(1)
    expect(plan[0].assignment_id).toBe('A-2') // 무관 신청자가 받는다
  })

  it('만료일이 대여종료일보다 이른 계정은 쓰지 않는다', () => {
    const expiring: PoolAccount[] = [{ id: 'GPT-009', service: 'GPT', kind: '운영', expires_on: '2026-09-15' }]
    expect(planAllocations({ period, queue, pool: expiring, capRemaining: Infinity })).toHaveLength(0)
  })
})

describe('assignedDaysOf (R25)', () => {
  const today = '2026-09-10'

  it('회수된 건은 회수일까지, 진행 건은 오늘까지 센다', () => {
    const days = assignedDaysOf(
      [
        { status: '회수완료', assigned_on: '2026-09-01', rent_start: '2026-09-01', rent_end: '2026-09-30', returned_at: '2026-09-05T00:00:00Z' },
        { status: '사용중', assigned_on: '2026-09-08', rent_start: '2026-09-08', rent_end: '2026-09-30', returned_at: null },
      ],
      today,
    )
    expect(days).toBe(5 + 3)
  })

  it('취소·반려 건은 제외한다', () => {
    expect(
      assignedDaysOf(
        [{ status: '취소', assigned_on: '2026-09-01', rent_start: '2026-09-01', rent_end: '2026-09-30', returned_at: null }],
        today,
      ),
    ).toBe(0)
  })
})

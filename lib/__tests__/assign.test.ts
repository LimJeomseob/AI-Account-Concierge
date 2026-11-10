import { describe, expect, it } from 'vitest'
import {
  APPLY_BLOCK_LABEL,
  RENT_PERIOD_TEXT,
  applyAvailability,
  assignedDaysOf,
  isAccountEligible,
  isAssignable,
  isOpenForApply,
  planAllocations,
  type PoolAccount,
  type QueueItem,
} from '@/lib/assign'
import type { Program } from '@/lib/types'

/** 옛 열(대여방식·기간·상한·내부 여부)이 어떤 값이어도 판정은 상태만 본다 (2026-11-10) */
const legacy: Omit<Program, 'id' | 'name' | 'status'> = {
  target: '혼합',
  mode: '고정기간',
  days: 0,
  start_on: '2026-11-05',
  end_on: '2026-11-06', // 이미 지난 종료일
  cap: 1,
  note: null,
  internal: true,
}
const prog = (status: Program['status']) => ({ id: 'P26-99', name: '테스트', status, ...legacy })

describe('applyAvailability (R3·R8: 상태 하나로 신청 가능 여부 결정)', () => {
  it('시작전 → 접수 준비 중(선택 불가)', () => {
    expect(applyAvailability(prog('시작전'))).toEqual({
      open: false,
      reason: '시작전',
      label: '접수 준비 중',
      period: APPLY_BLOCK_LABEL.시작전,
    })
  })

  it('진행중 → 접수중, 대여기간은 고정 문구 — 종료일이 지났거나 내부 프로그램이어도 접수', () => {
    expect(applyAvailability(prog('진행중'))).toEqual({
      open: true,
      reason: null,
      label: '접수중',
      period: RENT_PERIOD_TEXT,
    })
  })

  it('진행완료(DB 값 완료) → 접수 종료(선택 불가)', () => {
    expect(applyAvailability(prog('완료'))).toMatchObject({ open: false, reason: '완료', label: '접수 종료' })
  })

  it('내부 프로그램(기관관리자)도 같은 규칙 — 숨김 규칙 폐지', () => {
    const internalOpen: Program = { ...prog('진행중'), internal: true }
    const internalClosed: Program = { ...prog('시작전'), internal: true }
    expect(isOpenForApply(internalOpen)).toBe(true)
    expect(isOpenForApply(internalClosed)).toBe(false)
  })
})

describe('isAssignable (R14: 진행중이면 배정)', () => {
  it('진행중이면 기간·상한과 무관하게 배정 대상', () => {
    expect(isAssignable(prog('진행중'))).toBe(true)
  })
  it('시작전·진행완료는 배정 대상이 아니다', () => {
    expect(isAssignable(prog('시작전'))).toBe(false)
    expect(isAssignable(prog('완료'))).toBe(false)
  })
  it('표시(접수 가능)와 배정 가능 판정이 어긋나지 않는다', () => {
    for (const s of ['시작전', '진행중', '완료'] as const) {
      expect(isOpenForApply(prog(s))).toBe(isAssignable(prog(s)))
    }
  })
})

describe('isAccountEligible (R14)', () => {
  const acc = (expires: string | null, kind: '운영' | '예비' = '운영'): PoolAccount => ({
    id: 'GPT-001',
    service: 'GPT',
    kind,
    expires_on: expires,
  })

  it('오늘 기준으로 구독이 끝나지 않은 운영 계정만 배정 가능', () => {
    expect(isAccountEligible(acc('2026-11-10'), '2026-11-10')).toBe(true)
    expect(isAccountEligible(acc('2026-11-09'), '2026-11-10')).toBe(false)
    expect(isAccountEligible(acc(null), '2026-11-10')).toBe(true)
  })

  it('예비 계정은 배정 풀에서 제외', () => {
    expect(isAccountEligible(acc(null, '예비'), '2026-11-10')).toBe(false)
  })
})

describe('planAllocations (R12·R14) — T3 시나리오', () => {
  const today = '2026-09-01'
  const pool: PoolAccount[] = [
    { id: 'GPT-001', service: 'GPT', kind: '운영', expires_on: '2027-03-31' },
    { id: 'CL-001', service: 'Claude', kind: '운영', expires_on: '2027-03-31' },
  ]
  const queue: QueueItem[] = [
    { id: 'A-1', service_wish: 'GPT', applied_at: '2026-09-01T09:00:00Z' },
    { id: 'A-2', service_wish: '무관', applied_at: '2026-09-01T10:00:00Z' },
    { id: 'A-3', service_wish: 'Claude', applied_at: '2026-09-01T11:00:00Z' },
  ]

  it('가용 GPT 1·Claude 1 에 3명이면 신청 순으로 2명만 배정되고 사용 시작일은 배정일', () => {
    const plan = planAllocations({ today, queue, pool })
    expect(plan).toHaveLength(2)
    expect(plan[0]).toEqual({ assignment_id: 'A-1', account_id: 'GPT-001', service: 'GPT', rent_start: today })
    expect(plan[1]).toMatchObject({ assignment_id: 'A-2', account_id: 'CL-001', service: 'Claude' })
  })

  it('신청 순서(applied_at)를 지킨다', () => {
    const shuffled = [queue[2], queue[0], queue[1]]
    const plan = planAllocations({ today, queue: shuffled, pool })
    expect(plan[0].assignment_id).toBe('A-1')
  })

  it('희망 서비스 재고가 없으면 그 사람은 건너뛰고 대기한다', () => {
    const onlyClaude = [pool[1]]
    const plan = planAllocations({ today, queue, pool: onlyClaude })
    expect(plan).toHaveLength(1)
    expect(plan[0].assignment_id).toBe('A-2') // 무관 신청자가 받는다
  })

  it('이미 구독이 만료된 계정은 쓰지 않는다', () => {
    const expired: PoolAccount[] = [{ id: 'GPT-009', service: 'GPT', kind: '운영', expires_on: '2026-08-31' }]
    expect(planAllocations({ today, queue, pool: expired })).toHaveLength(0)
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

/**
 * 접수·배정 판정과 자동 배정 알고리즘 — 순수 함수 (PRD R3·R12·R14)
 * DB 접근은 lib/ops/* 가 담당하고, 판단 로직은 모두 여기에 둔다.
 *
 * 2026-11-10: 프로그램은 관리자가 고른 상태(시작전·진행중·진행완료) 하나로만 운영한다.
 * 대여방식·기간·배정상한·내부 여부는 더 이상 접수·배정 판정에 쓰지 않는다(열은 DB 에 남아 있음).
 */
import { toKSTDate, todayKST } from '@/lib/date'
import type { Program, Service, ServiceWish } from '@/lib/types'

/** 배정 가능한 계정(풀 원소) */
export interface PoolAccount {
  id: string
  service: Service
  kind: '운영' | '예비'
  expires_on: string | null
}

/** 대기열 원소(상태 승인, applied_at 오름차순으로 정렬해서 넘길 것) */
export interface QueueItem {
  id: string
  service_wish: ServiceWish
  applied_at: string
}

export interface Allocation {
  assignment_id: string
  account_id: string
  service: Service
  /** 사용 시작일 = 배정일. 종료일은 두지 않는다 — 진행완료·회수 시작 때 끝난다 */
  rent_start: string
}

/** R3: 접수 불가 사유 (DB 값 「완료」 = 화면 표시 「진행완료」) */
export type ApplyBlockReason = '시작전' | '완료'

export interface ApplyAvailability {
  open: boolean
  reason: ApplyBlockReason | null
  /** 신청 페이지 드롭다운에 붙일 문구 (접수중 / 접수 준비 중 / 접수 종료) */
  label: string
  /** 대여기간 표시 문구 */
  period: string
}

export const APPLY_BLOCK_LABEL: Record<ApplyBlockReason, string> = {
  시작전: '접수 준비 중',
  완료: '접수 종료',
}

export const APPLY_OPEN_LABEL = '접수중'
/** 신청 화면·접수 완료 안내의 대여기간 문구 — 프로그램이 진행완료되면 회수한다 */
export const RENT_PERIOD_TEXT = '프로그램 진행 기간 동안 사용(진행완료 시 회수)'

/**
 * R3·R8: 프로그램 상태 ↔ 신청 가능 여부를 한 곳에서 결정한다.
 * /apply 페이지·공개 API·접수 검증(lib/ops/apply.ts)이 모두 이 함수를 쓴다 — 표시와 실제 접수가 어긋나지 않게.
 * - 시작전   → 접수 준비 중 (선택 불가)
 * - 진행중   → 접수중 (선택 가능)
 * - 진행완료 → 접수 종료 (선택 불가)
 * 내부 프로그램(기관관리자, 0007)도 같은 규칙을 따른다(2026-11-10, 숨김 규칙 폐지).
 */
export function applyAvailability(program: Pick<Program, 'status'>): ApplyAvailability {
  if (program.status !== '진행중') {
    const reason: ApplyBlockReason = program.status === '완료' ? '완료' : '시작전'
    return { open: false, reason, label: APPLY_BLOCK_LABEL[reason], period: APPLY_BLOCK_LABEL[reason] }
  }
  return { open: true, reason: null, label: APPLY_OPEN_LABEL, period: RENT_PERIOD_TEXT }
}

/** R3: 공개 신청 페이지에서 선택할 수 있는 프로그램인가 (상태 「진행중」) */
export function isOpenForApply(program: Pick<Program, 'status'>): boolean {
  return applyAvailability(program).open
}

/** R14: 배정 대상 프로그램인가 — 상태 「진행중」이면 된다(기간·상한 조건 없음) */
export function isAssignable(program: Pick<Program, 'status'>): boolean {
  return program.status === '진행중'
}

/** R14: 운영 계정이고 구독이 오늘 기준으로 끝나지 않았으면 배정 가능 */
export function isAccountEligible(account: PoolAccount, today: string = todayKST()): boolean {
  if (account.kind !== '운영') return false
  return account.expires_on === null || account.expires_on >= today
}

/**
 * R14: 프로그램 단위 배정 계획을 만든다(부수효과 없음).
 * 1) 가용 풀을 서비스별로 나눔 (만료된 계정 제외)
 * 2) 대기열을 신청 순(applied_at)으로 순회
 * 3) 희망 서비스가 있으면 해당 풀, 「무관」이면 잔량이 많은 쪽
 * 4) 풀 소진 시 중단
 */
export function planAllocations(input: {
  today: string
  queue: QueueItem[]
  pool: PoolAccount[]
}): Allocation[] {
  const { today } = input
  const eligible = input.pool.filter((a) => isAccountEligible(a, today))
  const byService: Record<Service, PoolAccount[]> = {
    GPT: eligible.filter((a) => a.service === 'GPT'),
    Claude: eligible.filter((a) => a.service === 'Claude'),
  }
  // 안정적인 결과를 위해 계정ID 오름차순
  byService.GPT.sort((a, b) => a.id.localeCompare(b.id))
  byService.Claude.sort((a, b) => a.id.localeCompare(b.id))

  const queue = [...input.queue].sort((a, b) =>
    a.applied_at === b.applied_at ? a.id.localeCompare(b.id) : a.applied_at < b.applied_at ? -1 : 1,
  )

  const out: Allocation[] = []

  for (const item of queue) {
    if (byService.GPT.length === 0 && byService.Claude.length === 0) break

    let service: Service | null = null
    if (item.service_wish === 'GPT' || item.service_wish === 'Claude') {
      if (byService[item.service_wish].length > 0) service = item.service_wish
    } else {
      // 무관: 잔량이 많은 서비스에서 (동수면 GPT)
      service = byService.GPT.length >= byService.Claude.length ? 'GPT' : 'Claude'
      if (byService[service].length === 0) service = null
    }
    if (!service) continue // 희망 서비스 재고 없음 → 승인 상태로 대기

    const account = byService[service].shift()!
    out.push({
      assignment_id: item.id,
      account_id: account.id,
      service,
      rent_start: today,
    })
  }
  return out
}

/**
 * R25: 계정 배정일수 계산.
 * 각 배정의 (rent_start 또는 assigned_on) ~ (returned_at 또는 rent_end 또는 오늘),
 * 오늘을 넘으면 오늘까지. 취소·반려는 제외.
 */
export function assignedDaysOf(
  rows: Array<{
    status: string
    assigned_on: string | null
    rent_start: string | null
    rent_end: string | null
    returned_at: string | null
  }>,
  today: string = todayKST(),
): number {
  let total = 0
  for (const r of rows) {
    if (r.status === '취소' || r.status === '반려') continue
    const start = r.rent_start ?? r.assigned_on
    if (!start) continue
    // returned_at 은 timestamptz — UTC 문자열을 자르면 KST 00~09시 회수가 하루 앞당겨진다(R33)
    let end = toKSTDate(r.returned_at) ?? r.rent_end ?? today
    if (end > today) end = today
    if (end < start) continue
    const days =
      Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1
    total += days
  }
  return total
}

/** 배열을 n개씩 나눈다 — 일괄 처리를 묶음 단위로 동시에 보낼 때 쓴다 */
export function chunk<T>(list: T[], n: number): T[][] {
  const size = Math.max(1, Math.floor(n))
  const out: T[][] = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

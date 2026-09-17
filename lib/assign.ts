/**
 * 자동 배정 알고리즘 — 순수 함수 (PRD R5·R12·R14·R15)
 * DB 접근은 lib/actions/assign-db.ts 가 담당하고, 판단 로직은 모두 여기에 둔다.
 */
import { addDays, todayKST } from '@/lib/date'
import type { Period, Program, Service, ServiceWish } from '@/lib/types'

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
  rent_start: string
  rent_end: string
}

/**
 * R2·R15: 프로그램의 대여기간.
 * - 고정기간: start_on ~ end_on (전원 동일)
 * - 배정일기준: 기준일 ~ 기준일 + (days − 1)
 * 기간이 설정되지 않았으면 null (R3: 「접수 준비 중」).
 */
export function periodFor(
  program: Pick<Program, 'mode' | 'days' | 'start_on' | 'end_on'>,
  baseDate: string = todayKST(),
): Period | null {
  if (program.mode === '고정기간') {
    if (!program.start_on || !program.end_on) return null
    return { start: program.start_on, end: program.end_on }
  }
  if (!program.days || program.days <= 0) return null
  return { start: baseDate, end: addDays(baseDate, program.days - 1) }
}

/** R3: 접수 불가 사유 */
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
/** 대여기간을 아직 입력하지 않은 「진행중」 프로그램의 기간 표시 */
export const PERIOD_TBD = '대여기간 추후 안내(배정 시 확정)'

/**
 * R3: 프로그램 상태 ↔ 신청 페이지 표시를 한 곳에서 결정한다.
 * 공개 API·/apply 페이지·접수 검증(lib/ops/apply.ts)이 모두 이 함수를 쓴다.
 * - 시작전 → 접수 준비 중 (선택 불가)
 * - 진행중 → 접수중 (선택 가능). 대여기간이 아직 없으면 「추후 안내」로 표시하고 접수는 받는다.
 * - 완료   → 접수 종료 (선택 불가)
 */
export function applyAvailability(
  program: Pick<Program, 'mode' | 'days' | 'start_on' | 'end_on' | 'status'>,
  today: string = todayKST(),
): ApplyAvailability {
  if (program.status !== '진행중') {
    const reason: ApplyBlockReason = program.status === '완료' ? '완료' : '시작전'
    return { open: false, reason, label: APPLY_BLOCK_LABEL[reason], period: APPLY_BLOCK_LABEL[reason] }
  }
  const period = periodFor(program, today)
  return {
    open: true,
    reason: null,
    label: APPLY_OPEN_LABEL,
    period: !period
      ? PERIOD_TBD
      : program.mode === '고정기간'
        ? `${period.start} ~ ${period.end}`
        : `배정일부터 ${program.days}일`,
  }
}

/** R3: 공개 신청 페이지에서 선택할 수 있는 프로그램인가 (상태 「진행중」) */
export function isOpenForApply(
  program: Pick<Program, 'mode' | 'days' | 'start_on' | 'end_on' | 'status'>,
  today: string = todayKST(),
): boolean {
  return applyAvailability(program, today).open
}

/** R15: 자동 배정 대상 프로그램인가 (진행중만, 고정기간은 end_on ≤ 오늘이면 제외) */
export function isAssignable(
  program: Pick<Program, 'mode' | 'days' | 'start_on' | 'end_on' | 'status'>,
  today: string = todayKST(),
): boolean {
  if (program.status !== '진행중') return false
  const period = periodFor(program, today)
  if (!period) return false
  if (program.mode === '고정기간' && period.end <= today) return false
  return true
}

/** R14-2: 대여종료일까지 구독이 유지되는 계정만 사용 */
export function isAccountEligible(account: PoolAccount, rentEnd: string): boolean {
  if (account.kind !== '운영') return false
  return account.expires_on === null || account.expires_on >= rentEnd
}

/** R5: cap 잔여 = cap − (배정·사용중·회수중·회수완료 건수). cap 0 이면 무제한 */
export function capRemaining(cap: number, occupied: number): number {
  if (!cap || cap <= 0) return Number.POSITIVE_INFINITY
  return Math.max(0, cap - occupied)
}

/**
 * R14: 프로그램 단위 자동 배정 계획을 만든다(부수효과 없음).
 * 1) 가용 풀을 서비스별로 나눔
 * 2) 대기열을 신청 순(applied_at)으로 순회
 * 3) 희망 서비스가 있으면 해당 풀, 「무관」이면 잔량이 많은 쪽
 * 4) cap 잔여 소진 또는 풀 소진 시 중단
 */
export function planAllocations(input: {
  period: Period
  queue: QueueItem[]
  pool: PoolAccount[]
  capRemaining: number
}): Allocation[] {
  const { period, capRemaining: capLeft } = input
  const eligible = input.pool.filter((a) => isAccountEligible(a, period.end))
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
  let left = capLeft

  for (const item of queue) {
    if (left <= 0) break
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
      rent_start: period.start,
      rent_end: period.end,
    })
    left -= 1
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
    let end = r.returned_at?.slice(0, 10) ?? r.rent_end ?? today
    if (end > today) end = today
    if (end < start) continue
    const days =
      Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1
    total += days
  }
  return total
}

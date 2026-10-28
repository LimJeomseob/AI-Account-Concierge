/**
 * 상태 전이표 (PRD §5) — 순수 데이터.
 * 서버(`lib/state.ts`)와 관리자 화면(클라이언트 컴포넌트)이 같은 표를 쓰도록
 * `server-only` 없는 모듈로 분리했다. 실제 전이 실행은 `lib/state.ts` 가 담당한다.
 */
import type { AccountStatus, AssignmentStatus } from '@/lib/types'

export const ASSIGNMENT_TRANSITIONS: Record<AssignmentStatus, AssignmentStatus[]> = {
  신청: ['승인', '반려', '취소'],
  승인: ['사용중', '배정', '취소', '반려'], // 배정 즉시 사용중 (인수 확인 단계 폐지, 2026-10-28). '배정' 은 구 데이터 호환용
  배정: ['사용중', '인수기한초과', '회수중', '취소'], // 구 상태 — 신규 전이 없음
  사용중: ['회수중', '취소'],
  회수중: ['회수완료', '취소'],
  회수완료: [],
  반려: [],
  취소: [],
  인수기한초과: ['회수중', '회수완료'],
}

export const ACCOUNT_TRANSITIONS: Record<AccountStatus, AccountStatus[]> = {
  가용: ['배정', '정지', '만료'],
  배정: ['회수중', '정지', '만료'],
  회수중: ['가용', '정지', '만료'],
  정지: ['가용', '회수중', '만료'],
  만료: ['가용'],
}

export function canTransitionAssignment(from: AssignmentStatus, to: AssignmentStatus): boolean {
  return from === to || ASSIGNMENT_TRANSITIONS[from].includes(to)
}

export function canTransitionAccount(from: AccountStatus, to: AccountStatus): boolean {
  return from === to || ACCOUNT_TRANSITIONS[from].includes(to)
}

/**
 * 관리자가 「계정 상태 변경」으로 직접 고를 수 있는 전이 (ACCOUNT_TRANSITIONS 의 부분집합).
 * 「배정」·「회수중」은 배정·대여 종료·취소가 만드는 시스템 상태라 손으로 만들지 않는다
 * (연결된 신청 건 없이 「배정」이 되거나, 회수 체크리스트(R24) 없이 「회수중 → 가용」이 되는 것 방지).
 * 배정·회수중 좌석의 구독 만료는 회수를 끝낸 뒤 처리한다.
 */
export const MANUAL_ACCOUNT_TRANSITIONS: Record<AccountStatus, AccountStatus[]> = {
  가용: ['정지', '만료'],
  배정: ['정지'], // 장애로 접속 불가 — 연결된 건은 장애 메뉴에서 대체 배정
  회수중: ['정지'],
  정지: ['가용', '만료'], // 가용은 이 좌석을 쥔 활성 배정이 없을 때만 (app/admin/actions.ts)
  만료: ['가용'],
}

export function canManuallySetAccount(from: AccountStatus, to: AccountStatus): boolean {
  return MANUAL_ACCOUNT_TRANSITIONS[from].includes(to)
}

/** 현재 상태에서 관리자가 고를 수 있는 계정 상태(현재 상태 포함, PRD §5-2 순서 유지) */
export function accountStatusOptions(from: AccountStatus): AccountStatus[] {
  return [from, ...MANUAL_ACCOUNT_TRANSITIONS[from]]
}

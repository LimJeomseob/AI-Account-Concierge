/**
 * 상태 전이표 (PRD §5) — 순수 데이터.
 * 서버(`lib/state.ts`)와 관리자 화면(클라이언트 컴포넌트)이 같은 표를 쓰도록
 * `server-only` 없는 모듈로 분리했다. 실제 전이 실행은 `lib/state.ts` 가 담당한다.
 */
import type { AccountStatus, AssignmentStatus } from '@/lib/types'

export const ASSIGNMENT_TRANSITIONS: Record<AssignmentStatus, AssignmentStatus[]> = {
  신청: ['승인', '반려', '취소'],
  승인: ['배정', '취소', '반려'],
  배정: ['사용중', '인수기한초과', '회수중', '취소'],
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

/** 현재 상태에서 관리자가 고를 수 있는 계정 상태(현재 상태 포함, PRD §5-2 순서 유지) */
export function accountStatusOptions(from: AccountStatus): AccountStatus[] {
  return [from, ...ACCOUNT_TRANSITIONS[from]]
}

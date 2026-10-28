/**
 * 링크 서명 토큰 (PRD §8)
 * t = HMAC-SHA256(APP_SECRET, message) 의 hex 앞 24자
 *  - 장애 신고: message = "inc:<배정ID>"
 * 토큰 자체는 만료가 없다. 대신 장애 신고 페이지가 배정이 「사용중」일 때만 접수한다(R26) —
 * 회수가 끝난 옛 사용자가 지금 다른 사람이 쓰는 계정을 정지시키지 못하게.
 * (인수 확인 토큰은 2026-10-28 인수 확인 단계 폐지로 제거)
 */
import { createHmac, timingSafeEqual } from 'node:crypto'

function secret(): string {
  const s = process.env.APP_SECRET
  if (!s) throw new Error('APP_SECRET 환경변수가 없습니다.')
  return s
}

export function sign(message: string, key: string = secret()): string {
  return createHmac('sha256', key).update(message).digest('hex').slice(0, 24)
}

/** APP_SECRET 이 설정돼 있는가 — 없으면 링크를 만들거나 검증할 수 없다 */
export function hasSecret(): boolean {
  return !!process.env.APP_SECRET
}

export function verify(message: string, token: string | null | undefined, key?: string): boolean {
  if (!token) return false
  // 비밀 값이 없으면 예외 대신 「검증 실패」 — 공개 페이지가 서버 오류로 깨지지 않게
  if (key === undefined) {
    if (!hasSecret()) return false
    key = secret()
  }
  const a = Buffer.from(sign(message, key))
  const b = Buffer.from(token)
  // 바이트 길이로 비교 — 문자 수가 같아도 멀티바이트가 섞이면 바이트 길이가 달라 timingSafeEqual 이 예외를 던진다
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export const incidentToken = (assignmentId: string) => sign(`inc:${assignmentId}`)
export const verifyIncidentToken = (assignmentId: string, token?: string | null) =>
  verify(`inc:${assignmentId}`, token)

export function incidentUrl(base: string, assignmentId: string): string {
  return `${base.replace(/\/$/, '')}/incident?id=${encodeURIComponent(assignmentId)}&t=${incidentToken(assignmentId)}`
}

/** APP_SECRET 이 없으면 null — 관리자 화면이 서버 오류로 깨지지 않게(신청·배정 「안내문 복사」) */
export function tryIncidentUrl(base: string, assignmentId: string): string | null {
  return hasSecret() ? incidentUrl(base, assignmentId) : null
}

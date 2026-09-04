/**
 * 링크 서명 토큰 (PRD §8)
 * t = HMAC-SHA256(APP_SECRET, message) 의 hex 앞 24자
 *  - 인수 확인: message = <배정ID>
 *  - 장애 신고: message = "inc:<배정ID>"
 * 만료 없음. 재사용 방지는 상태 검사로 한다(R18).
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

export function verify(message: string, token: string | null | undefined, key: string = secret()): boolean {
  if (!token) return false
  const expected = sign(message, key)
  if (expected.length !== token.length) return false
  return timingSafeEqual(Buffer.from(expected), Buffer.from(token))
}

export const ackToken = (assignmentId: string) => sign(assignmentId)
export const verifyAckToken = (assignmentId: string, token?: string | null) => verify(assignmentId, token)

export const incidentToken = (assignmentId: string) => sign(`inc:${assignmentId}`)
export const verifyIncidentToken = (assignmentId: string, token?: string | null) =>
  verify(`inc:${assignmentId}`, token)

export function ackUrl(base: string, assignmentId: string): string {
  return `${base.replace(/\/$/, '')}/ack?id=${encodeURIComponent(assignmentId)}&t=${ackToken(assignmentId)}`
}

export function incidentUrl(base: string, assignmentId: string): string {
  return `${base.replace(/\/$/, '')}/incident?id=${encodeURIComponent(assignmentId)}&t=${incidentToken(assignmentId)}`
}

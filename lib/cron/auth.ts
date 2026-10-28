/** Cron 엔드포인트 인증 (PRD §12-3) — Authorization: Bearer <CRON_SECRET>, 타이밍 안전 비교 */
import 'server-only'
import { createHash, timingSafeEqual } from 'node:crypto'

const digest = (s: string) => createHash('sha256').update(s).digest()

export function cronAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const got = req.headers.get('authorization') ?? ''
  // 길이가 달라도 예외 없이 비교하도록 해시 후 비교
  return timingSafeEqual(digest(got), digest(`Bearer ${secret}`))
}

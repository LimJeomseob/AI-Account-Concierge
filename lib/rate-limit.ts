/**
 * 공개 API 레이트 리밋 (PRD §12-1: IP당 분당 10회)
 * DB 카운터 기반 — 서버리스 인스턴스가 나뉘어도 동작한다.
 */
import 'server-only'
import { db } from '@/lib/db'

export async function rateLimit(key: string, limit = 10, windowSec = 60): Promise<boolean> {
  const now = new Date()
  const bucket = `${key}:${Math.floor(now.getTime() / (windowSec * 1000))}`
  const expires = new Date(now.getTime() + windowSec * 2000).toISOString()

  const { data } = await db().from('rate_limits').select('count').eq('bucket', bucket).maybeSingle()
  const next = (data?.count ?? 0) + 1
  await db().from('rate_limits').upsert({ bucket, count: next, expires_at: expires }, { onConflict: 'bucket' })

  // 만료된 버킷 정리(가끔)
  if (Math.random() < 0.05) await db().from('rate_limits').delete().lt('expires_at', now.toISOString())

  return next <= limit
}

/** 요청 IP 추출 */
export function clientIp(req: Request): string {
  const h = req.headers
  return (
    h.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    h.get('x-real-ip') ||
    'unknown'
  )
}

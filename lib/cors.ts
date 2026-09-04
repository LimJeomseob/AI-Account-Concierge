/**
 * 공개 API CORS (PRD §12-1: settings.signup_origins 만 허용)
 */
import 'server-only'
import { getSettings } from '@/lib/settings'

export async function corsHeaders(req: Request): Promise<Record<string, string>> {
  const origin = req.headers.get('origin')
  if (!origin) return {}
  const s = await getSettings()
  const allowed = s.signup_origins.map((o) => o.replace(/\/$/, ''))
  if (!allowed.includes(origin.replace(/\/$/, ''))) return {}
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}

export async function jsonWithCors(req: Request, body: unknown, status = 200): Promise<Response> {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...(await corsHeaders(req)) },
  })
}

export async function preflight(req: Request): Promise<Response> {
  return new Response(null, { status: 204, headers: await corsHeaders(req) })
}

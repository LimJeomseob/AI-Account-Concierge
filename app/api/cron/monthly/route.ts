/** POST/GET /api/cron/monthly (PRD §11, R29) */
import { runMonthly } from '@/lib/cron/monthly'
import { cronAuthorized } from '@/lib/cron/auth'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

async function handle(req: Request) {
  if (!cronAuthorized(req)) return Response.json({ ok: false, msg: '인증 실패' }, { status: 401 })
  try {
    const result = await runMonthly('system')
    return Response.json({ ok: true, result })
  } catch (e) {
    console.error('[cron.monthly] 실패:', (e as Error).message)
    return Response.json({ ok: false, msg: '월간 스냅샷 실패 — 서버 로그를 확인하세요.' }, { status: 500 })
  }
}

export const GET = handle
export const POST = handle

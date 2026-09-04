/** POST/GET /api/cron/monthly (PRD §11, R29) */
import { runMonthly } from '@/lib/cron/monthly'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return req.headers.get('authorization') === `Bearer ${secret}`
}

async function handle(req: Request) {
  if (!authorized(req)) return Response.json({ ok: false, msg: '인증 실패' }, { status: 401 })
  try {
    const result = await runMonthly('system')
    return Response.json({ ok: true, result })
  } catch (e) {
    return Response.json({ ok: false, msg: (e as Error).message }, { status: 500 })
  }
}

export const GET = handle
export const POST = handle

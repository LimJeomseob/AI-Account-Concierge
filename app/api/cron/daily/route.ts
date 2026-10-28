/** POST/GET /api/cron/daily (PRD §11, §12-3) */
import { runDaily } from '@/lib/cron/daily'
import { cronAuthorized } from '@/lib/cron/auth'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

async function handle(req: Request) {
  if (!cronAuthorized(req)) return Response.json({ ok: false, msg: '인증 실패' }, { status: 401 })
  try {
    const result = await runDaily('system')
    // 단계 오류가 있으면 500 — Vercel Cron 로그·Docker curl -f 에 실패로 남는다(점검 메일에도 표시됨)
    const ok = result.errors.length === 0
    return Response.json({ ok, result }, { status: ok ? 200 : 500 })
  } catch (e) {
    console.error('[cron.daily] 실패:', (e as Error).message)
    return Response.json({ ok: false, msg: '일일 작업 실패 — 서버 로그를 확인하세요.' }, { status: 500 })
  }
}

export const GET = handle
export const POST = handle

/**
 * GET /api/health (PRD §12-3)
 *  - 기본: DB 연결만 판정(503 = DB 다운).
 *  - `?strict=1`: 외부 업타임 감시(UptimeRobot 등)용. 일일 작업이 26시간 넘게 성공하지 못했으면 503.
 * 내부 오류 문구는 공개 응답에 싣지 않는다(서버 로그에만).
 */
import { db } from '@/lib/db'
import { nowKSTText, todayKST } from '@/lib/date'
import { lastOk } from '@/lib/lock'

export const dynamic = 'force-dynamic'

/** 일일 작업(매일 09:00) + 여유 2시간 */
const CRON_STALE_MS = 26 * 60 * 60 * 1000

export async function GET(req: Request) {
  const today = todayKST()
  const strict = new URL(req.url).searchParams.get('strict') === '1'
  try {
    const { error } = await db().from('settings').select('key').limit(1)
    if (error) throw new Error(error.message)

    const last = await lastOk('cron.daily')
    // 기록이 아직 없으면(배포 직후) 판정하지 않는다
    const stale = last !== null && Date.now() - last > CRON_STALE_MS
    const mailConfigured = !!process.env.GMAIL_USER?.trim() && !!process.env.GMAIL_APP_PASSWORD?.trim()

    const body = {
      ok: !(strict && stale),
      today,
      db: 'up',
      cron: { last_ok_at: last ? nowKSTText(new Date(last)) : null, stale },
      mail_configured: mailConfigured,
    }
    return Response.json(body, { status: strict && stale ? 503 : 200 })
  } catch (e) {
    console.error('[health] DB 확인 실패:', (e as Error).message)
    return Response.json({ ok: false, today, db: 'down' }, { status: 503 })
  }
}

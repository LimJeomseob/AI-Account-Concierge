/** GET /api/health (PRD §12-3) */
import { db } from '@/lib/db'
import { todayKST } from '@/lib/date'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const { error } = await db().from('settings').select('key').limit(1)
    if (error) throw new Error(error.message)
    return Response.json({ ok: true, today: todayKST(), db: 'up' })
  } catch (e) {
    return Response.json({ ok: false, today: todayKST(), db: 'down', msg: (e as Error).message }, { status: 503 })
  }
}

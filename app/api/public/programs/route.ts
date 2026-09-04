/** GET /api/public/programs (PRD §12-1, R3) */
import { db } from '@/lib/db'
import { isOpenForApply, periodFor } from '@/lib/assign'
import { todayKST } from '@/lib/date'
import { getSettings } from '@/lib/settings'
import { jsonWithCors, preflight } from '@/lib/cors'
import type { Program } from '@/lib/types'

export const dynamic = 'force-dynamic'

export async function OPTIONS(req: Request) {
  return preflight(req)
}

export async function GET(req: Request) {
  const today = todayKST()
  const s = await getSettings()
  const { data, error } = await db().from('programs').select('*').order('id')
  if (error) return jsonWithCors(req, { ok: false, msg: '프로그램 조회 실패' }, 500)

  const programs = (data as Program[])
    .filter((p) => isOpenForApply(p, today))
    .map((p) => {
      const period = periodFor(p, today)!
      return {
        id: p.id,
        name: p.name,
        target: p.target,
        mode: p.mode,
        days: p.days,
        start: p.start_on,
        end: p.end_on,
        period:
          p.mode === '고정기간'
            ? `${period.start} ~ ${period.end}`
            : `배정일부터 ${p.days}일`,
      }
    })

  return jsonWithCors(req, {
    ok: true,
    programs,
    eduUrl: s.edu_url,
    privacy: { items: s.privacy_items, purpose: s.privacy_purpose, period: s.privacy_period },
  })
}

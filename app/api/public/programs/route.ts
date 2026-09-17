/**
 * GET /api/public/programs (PRD §12-1, R3)
 * 전체 프로그램을 돌려주고 항목마다 접수 가능 여부(open)·사유(reason)·표시 문구(label)를 붙인다.
 * 신청 페이지는 이 값으로 「접수 준비 중」·「접수 종료」 등을 표시한다.
 */
import { db } from '@/lib/db'
import { applyAvailability } from '@/lib/assign'
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

  const programs = (data as Program[]).map((p) => {
    const a = applyAvailability(p, today)
    return {
      id: p.id,
      name: p.name,
      target: p.target,
      mode: p.mode,
      days: p.days,
      start: p.start_on,
      end: p.end_on,
      status: p.status,
      open: a.open,
      reason: a.reason,
      label: a.label,
      period: a.period,
    }
  })

  return jsonWithCors(req, {
    ok: true,
    programs,
    eduUrl: s.edu_url,
    privacy: { items: s.privacy_items, purpose: s.privacy_purpose, period: s.privacy_period },
  })
}

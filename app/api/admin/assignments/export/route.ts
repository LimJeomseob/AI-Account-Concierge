/** 유료계정 사용현황 CSV 다운로드 (관리자 전용) — 사용현황 화면의 현재 조회 조건을 그대로 적용 */
import { db } from '@/lib/db'
import { requireAdminAction } from '@/lib/auth'
import { todayKST } from '@/lib/date'
import { log } from '@/lib/state'
import { APPLICANT_SELECT, applicantCsv, applyFilter, parseFilter, type ApplicantRow } from '@/lib/ops/export'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  let actor: string
  try {
    actor = await requireAdminAction()
  } catch {
    return new Response('권한이 없습니다.', { status: 403 })
  }

  const url = new URL(req.url)
  const f = parseFilter((k) => url.searchParams.get(k))
  const query = applyFilter(
    db().from('assignments').select(APPLICANT_SELECT).order('applied_at', { ascending: false }).limit(5000),
    f,
  )

  const { data, error } = await query
  if (error) return new Response(error.message, { status: 500 })

  const rows = (data ?? []) as unknown as ApplicantRow[]
  // R31: 건수와 필터만 기록 — 이메일 등 개인정보는 로그에 남기지 않는다
  await log(actor, 'assignments.export', null, {
    count: rows.length,
    status: f.status ?? '',
    program: f.program ?? '',
    service: f.service ?? '',
    search: f.name || f.email || f.account ? '(이름·이메일·계정번호 조건)' : '',
  })

  const name = `usage-${todayKST().replace(/-/g, '')}.csv`
  return new Response(applicantCsv(rows), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${name}"`,
    },
  })
}

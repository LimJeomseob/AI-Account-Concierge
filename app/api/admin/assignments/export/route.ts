/** 신청자 목록 CSV 다운로드 (관리자 전용) — 신청·배정 화면의 현재 필터를 그대로 적용 */
import { db } from '@/lib/db'
import { requireAdminAction } from '@/lib/auth'
import { todayKST } from '@/lib/date'
import { log } from '@/lib/state'
import { APPLICANT_SELECT, applicantCsv, type ApplicantRow } from '@/lib/ops/export'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  let actor: string
  try {
    actor = await requireAdminAction()
  } catch {
    return new Response('권한이 없습니다.', { status: 403 })
  }

  const url = new URL(req.url)
  const status = url.searchParams.get('status') ?? ''
  const program = url.searchParams.get('program') ?? ''
  const q = url.searchParams.get('q') ?? ''

  let query = db().from('assignments').select(APPLICANT_SELECT).order('applied_at', { ascending: false }).limit(5000)
  if (status) query = query.eq('status', status)
  if (program) query = query.eq('program_id', program)
  if (q) query = query.or(`name.ilike.%${q}%,email.ilike.%${q}%,id.ilike.%${q}%`)

  const { data, error } = await query
  if (error) return new Response(error.message, { status: 500 })

  const rows = (data ?? []) as unknown as ApplicantRow[]
  // R31: 건수와 필터만 기록 — 이메일 등 개인정보는 로그에 남기지 않는다
  await log(actor, 'assignments.export', null, { count: rows.length, status, program, q: q ? '(검색어)' : '' })

  const name = `applicants-${todayKST().replace(/-/g, '')}.csv`
  return new Response(applicantCsv(rows), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${name}"`,
    },
  })
}

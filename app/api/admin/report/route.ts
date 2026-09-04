/** 실적 CSV 다운로드 (관리자 전용) */
import { db } from '@/lib/db'
import { requireAdminAction } from '@/lib/auth'
import { monthKST } from '@/lib/date'
import { programCsv, programReport, summaryCsv, summaryReport } from '@/lib/report'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  try {
    await requireAdminAction()
  } catch {
    return new Response('권한이 없습니다.', { status: 403 })
  }

  const url = new URL(req.url)
  const type = url.searchParams.get('type') ?? 'program'
  const month = url.searchParams.get('month')

  let csv: string
  let name: string

  if (month) {
    const { data } = await db().from('report_snapshots').select('*').eq('month', month).maybeSingle()
    if (!data) return new Response('스냅샷이 없습니다.', { status: 404 })
    csv = (type === 'summary' ? data.csv_summary : data.csv_program) ?? ''
    name = `snapshot-${month}-${type}.csv`
  } else if (type === 'summary') {
    csv = summaryCsv(await summaryReport())
    name = `report-summary-${monthKST()}.csv`
  } else {
    csv = programCsv(await programReport())
    name = `report-program-${monthKST()}.csv`
  }

  return new Response(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${name}"`,
    },
  })
}

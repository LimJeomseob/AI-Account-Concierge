/** 장애 (PRD §7-2, R26~R28) */
import { db } from '@/lib/db'
import { getSettings } from '@/lib/settings'
import { suspensionRate } from '@/lib/ops/incidents'
import { Badge, Button, Card, Stat, Table, Td } from '@/components/ui'
import { L } from '@/lib/labels'
import { incidentReplaceAction, incidentStatusAction } from '@/app/admin/actions'

export const dynamic = 'force-dynamic'

export default async function IncidentsPage() {
  const s = await getSettings()
  const { data: incidents } = await db()
    .from('incidents')
    .select('*')
    .order('reported_at', { ascending: false })
    .limit(200)
  const rate = await suspensionRate()

  const byType = { 정지: 0, 로그인불가: 0, 기타: 0 } as Record<string, number>
  for (const i of incidents ?? []) byType[i.type] = (byType[i.type] ?? 0) + 1

  return (
    <>
      <h1 className="text-xl font-bold text-[var(--gnu-navy)]">{L.menu.incidents}</h1>

      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="정지" value={byType['정지']} />
        <Stat label="로그인불가" value={byType['로그인불가']} />
        <Stat label="기타" value={byType['기타']} />
        <Stat label="정지율(%)" value={rate} warn={rate > s.suspension_rate_warn} />
      </div>

      {rate > s.suspension_rate_warn && (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          ⚠ 정지율 {rate}% — 경고 임계값 {s.suspension_rate_warn}% 초과. 업체 협의가 필요합니다.
        </div>
      )}

      <Card title="장애 목록">
        <Table head={['ID', '접수일시', '계정', '배정ID', '유형', '증상', '신고자', '상태', '대체계정', '조치']}>
          {(incidents ?? []).map((i) => (
            <tr key={i.id}>
              <Td className="text-xs">{i.id}</Td>
              <Td className="text-xs">{i.reported_at?.slice(0, 16).replace('T', ' ')}</Td>
              <Td className="text-xs">{i.account_id ?? '-'}</Td>
              <Td className="text-xs">{i.assignment_id ?? '-'}</Td>
              <Td className="text-xs">{i.type}</Td>
              <Td className="max-w-[240px] text-xs">{i.symptom}</Td>
              <Td className="text-xs">{i.reporter ?? '-'}</Td>
              <Td>
                <Badge value={i.status} />
              </Td>
              <Td className="text-xs">{i.replacement_account_id ?? '-'}</Td>
              <Td>
                <div className="flex flex-wrap gap-1">
                  {i.status !== '완료' && (
                    <form action={incidentReplaceAction}>
                      <input type="hidden" name="id" value={i.id} />
                      <Button>대체 계정 배정</Button>
                    </form>
                  )}
                  <form action={incidentStatusAction}>
                    <input type="hidden" name="id" value={i.id} />
                    <select name="status" defaultValue={i.status} className="rounded-md border border-slate-300 p-1 text-xs">
                      <option>접수</option>
                      <option>처리중</option>
                      <option>완료</option>
                    </select>
                    <Button variant="ghost" className="ml-1">
                      상태 변경
                    </Button>
                  </form>
                </div>
              </Td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  )
}

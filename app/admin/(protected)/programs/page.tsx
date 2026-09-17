/** 프로그램 (PRD §7-2, R1~R6) */
import { db } from '@/lib/db'
import { Button, Card, Table, Td } from '@/components/ui'
import { L } from '@/lib/labels'
import { programSeedAction } from '@/app/admin/actions'
import StatusSelect from './StatusSelect'
import ProgramForm from './ProgramForm'
import type { Program } from '@/lib/types'

export const dynamic = 'force-dynamic'

export default async function ProgramsPage() {
  const { data: programs } = await db().from('programs').select('*').order('id')
  const { data: avail } = await db().from('program_availability').select('*')
  const availMap = new Map((avail ?? []).map((a) => [a.program_id, a]))

  const { data: counts } = await db().from('assignments').select('program_id, status')
  const used = new Map<string, number>()
  for (const c of counts ?? []) {
    if (['배정', '사용중', '회수중', '회수완료'].includes(c.status)) {
      used.set(c.program_id, (used.get(c.program_id) ?? 0) + 1)
    }
  }

  return (
    <>
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-[var(--gnu-navy)]">{L.menu.programs}</h1>
        <form action={programSeedAction}>
          <Button variant="ghost">하반기 24개 일괄 등록</Button>
        </form>
      </header>

      <Card title="프로그램 목록">
        <Table
          head={[
            L.program.id, L.program.name, L.program.target, L.program.mode, '대여기간',
            L.program.cap, '배정 현황', '배정가능(GPT/CL)', L.program.status,
          ]}
        >
          {((programs ?? []) as Program[]).map((p) => {
            const a = availMap.get(p.id)
            return (
              <tr key={p.id}>
                <Td className="text-xs">{p.id}</Td>
                <Td>{p.name}</Td>
                <Td className="text-xs">{p.target}</Td>
                <Td className="text-xs">{p.mode}</Td>
                <Td className="text-xs">
                  {(() => {
                    const text =
                      p.mode === '고정기간'
                        ? p.start_on && p.end_on
                          ? `${p.start_on} ~ ${p.end_on}`
                          : null
                        : p.days > 0
                          ? `배정일부터 ${p.days}일`
                          : null
                    if (text) return text
                    // 진행중인데 기간이 없으면 접수는 되지만 자동 배정이 보류된다 (R14·R15)
                    return p.status === '진행중' ? (
                      <span className="text-amber-700">미설정 — 배정 보류</span>
                    ) : (
                      '미설정'
                    )
                  })()}
                </Td>
                <Td className="text-xs">{p.cap === 0 ? '무제한' : p.cap}</Td>
                <Td className="text-xs">{used.get(p.id) ?? 0}</Td>
                <Td className="text-xs">
                  {a ? `${a.avail_gpt} / ${a.avail_claude}` : '-'}
                </Td>
                <Td>
                  {/* 시작전 → 진행중 → 완료: 드롭다운으로 즉시 저장 (모든 전환은 관리자 수동) */}
                  <StatusSelect id={p.id} value={p.status} />
                </Td>
              </tr>
            )
          })}
        </Table>
      </Card>

      <Card title="등록·수정">
        <ProgramForm programs={(programs ?? []) as Program[]} />
      </Card>
    </>
  )
}

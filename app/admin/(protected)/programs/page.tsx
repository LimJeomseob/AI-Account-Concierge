/** 프로그램 (PRD §7-2, R1·R3·R6) — 2026-11-10: 상태(시작전·진행중·진행완료) 하나로 운영 */
import { db } from '@/lib/db'
import { todayKST } from '@/lib/date'
import { Button, Card, Table, Td } from '@/components/ui'
import { L, PROGRAM_STATUSES, PROGRAM_STATUS_HELP, PROGRAM_STATUS_LABEL } from '@/lib/labels'
import { programSeedAction } from '@/app/admin/actions'
import StatusSelect from './StatusSelect'
import ProgramForm from './ProgramForm'
import type { Program } from '@/lib/types'

export const dynamic = 'force-dynamic'

export default async function ProgramsPage() {
  const today = todayKST()
  const [{ data: programs }, { data: counts }, { data: pool }] = await Promise.all([
    db().from('programs').select('*').order('id'),
    db().from('assignments').select('program_id, status'),
    // 배정 가능 좌석 = 가용 ∧ 운영 ∧ 구독 만료 전 — 프로그램과 무관하다
    db().from('accounts').select('service, expires_on').eq('status', '가용').eq('kind', '운영'),
  ])

  const used = new Map<string, number>()
  const inUse = new Map<string, number>()
  for (const c of counts ?? []) {
    if (['배정', '사용중', '회수중', '회수완료'].includes(c.status)) {
      used.set(c.program_id, (used.get(c.program_id) ?? 0) + 1)
    }
    if (['배정', '사용중'].includes(c.status)) {
      inUse.set(c.program_id, (inUse.get(c.program_id) ?? 0) + 1)
    }
  }
  const avail = { GPT: 0, Claude: 0 } as Record<string, number>
  for (const a of pool ?? []) {
    if (a.expires_on === null || a.expires_on >= today) avail[a.service] = (avail[a.service] ?? 0) + 1
  }

  return (
    <>
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-[var(--gnu-navy)]">{L.menu.programs}</h1>
        <form action={programSeedAction}>
          <Button variant="ghost">하반기 24개 일괄 등록</Button>
        </form>
      </header>

      <Card title="상태만 고르면 됩니다">
        <ul className="space-y-1 text-sm text-slate-700">
          {PROGRAM_STATUSES.map((s) => (
            <li key={s}>
              <strong>{PROGRAM_STATUS_LABEL[s]}</strong> — {PROGRAM_STATUS_HELP[s]}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-slate-500">
          배정받은 사람은 배정일부터 사용하고, 진행완료로 바꿀 때 함께 회수 시작하거나 사용현황에서 회수합니다.
          지금 배정 가능한 좌석: ChatGPT {avail.GPT}개 / Claude {avail.Claude}개
        </p>
      </Card>

      <Card title="프로그램 목록">
        <Table head={[L.program.id, L.program.name, '사용중', '누적 배정', L.program.status]}>
          {((programs ?? []) as Program[]).map((p) => (
            <tr key={p.id}>
              <Td className="text-xs">{p.id}</Td>
              <Td>{p.name}</Td>
              <Td className="text-xs">{inUse.get(p.id) ?? 0}</Td>
              <Td className="text-xs">{used.get(p.id) ?? 0}</Td>
              <Td>
                {/* 시작전 → 진행중 → 진행완료: 드롭다운으로 즉시 저장 (모든 전환은 관리자 수동) */}
                <StatusSelect id={p.id} name={p.name} value={p.status} inUse={inUse.get(p.id) ?? 0} />
              </Td>
            </tr>
          ))}
        </Table>
      </Card>

      <Card title="등록·수정">
        <ProgramForm programs={(programs ?? []) as Program[]} />
      </Card>
    </>
  )
}

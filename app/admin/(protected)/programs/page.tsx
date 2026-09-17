/** 프로그램 (PRD §7-2, R1~R6) */
import { db } from '@/lib/db'
import { Button, Card, Table, Td, inputClass } from '@/components/ui'
import { L } from '@/lib/labels'
import { programSaveAction, programSeedAction } from '@/app/admin/actions'
import StatusSelect, { PROGRAM_STATUSES } from './StatusSelect'
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
                  {p.mode === '고정기간'
                    ? p.start_on && p.end_on
                      ? `${p.start_on} ~ ${p.end_on}`
                      : '미설정'
                    : p.days > 0
                      ? `배정일부터 ${p.days}일`
                      : '미설정'}
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
        <form action={programSaveAction} className="grid gap-3 sm:grid-cols-3">
          <label className="text-sm">
            <span className="text-xs text-slate-600">프로그램ID (비우면 자동 채번)</span>
            <input name="id" className={inputClass} placeholder="P26-01" />
          </label>
          <label className="text-sm sm:col-span-2">
            <span className="text-xs text-slate-600">{L.program.name} *</span>
            <input name="name" required className={inputClass} />
          </label>
          <label className="text-sm">
            <span className="text-xs text-slate-600">{L.program.target}</span>
            <select name="target" className={inputClass}>
              <option>혼합</option>
              <option>교원</option>
              <option>직원</option>
              <option>학생</option>
              <option>지역민</option>
            </select>
          </label>
          <label className="text-sm">
            <span className="text-xs text-slate-600">{L.program.mode}</span>
            <select name="mode" className={inputClass}>
              <option>고정기간</option>
              <option>배정일기준</option>
            </select>
          </label>
          <label className="text-sm">
            <span className="text-xs text-slate-600">{L.program.days} (배정일기준)</span>
            <input name="days" type="number" min={0} defaultValue={0} className={inputClass} />
          </label>
          <label className="text-sm">
            <span className="text-xs text-slate-600">{L.program.start_on}</span>
            <input name="start_on" type="date" className={inputClass} />
          </label>
          <label className="text-sm">
            <span className="text-xs text-slate-600">{L.program.end_on}</span>
            <input name="end_on" type="date" className={inputClass} />
          </label>
          <label className="text-sm">
            <span className="text-xs text-slate-600">{L.program.cap} (0=무제한)</span>
            <input name="cap" type="number" min={0} defaultValue={0} className={inputClass} />
          </label>
          <label className="text-sm">
            <span className="text-xs text-slate-600">{L.program.status}</span>
            <select name="status" defaultValue="시작전" className={inputClass}>
              {PROGRAM_STATUSES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label className="text-sm sm:col-span-2">
            <span className="text-xs text-slate-600">비고</span>
            <input name="note" className={inputClass} />
          </label>
          <div className="sm:col-span-3">
            <Button>저장</Button>
          </div>
        </form>
      </Card>
    </>
  )
}

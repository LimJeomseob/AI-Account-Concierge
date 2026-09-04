/** 로그 (PRD §7-2, R31) */
import { db } from '@/lib/db'
import { Button, Card, Table, Td } from '@/components/ui'
import { L } from '@/lib/labels'

export const dynamic = 'force-dynamic'

type Search = Promise<{ actor?: string; action?: string; target?: string }>

export default async function LogsPage({ searchParams }: { searchParams: Search }) {
  const { actor, action, target } = await searchParams

  let query = db().from('logs').select('*').order('at', { ascending: false }).limit(300)
  if (actor) query = query.ilike('actor', `%${actor}%`)
  if (action) query = query.ilike('action', `%${action}%`)
  if (target) query = query.ilike('target_id', `%${target}%`)
  const { data: logs } = await query

  return (
    <>
      <h1 className="text-xl font-bold text-[var(--gnu-navy)]">{L.menu.logs}</h1>

      <Card title="검색">
        <form className="flex flex-wrap items-end gap-3 text-sm">
          <label>
            <span className="block text-xs text-slate-600">실행자</span>
            <input name="actor" defaultValue={actor ?? ''} className="mt-1 rounded-md border border-slate-300 p-2" />
          </label>
          <label>
            <span className="block text-xs text-slate-600">동작</span>
            <input name="action" defaultValue={action ?? ''} className="mt-1 rounded-md border border-slate-300 p-2" />
          </label>
          <label>
            <span className="block text-xs text-slate-600">대상</span>
            <input name="target" defaultValue={target ?? ''} className="mt-1 rounded-md border border-slate-300 p-2" />
          </label>
          <Button>조회</Button>
        </form>
      </Card>

      <Card title={`로그 (${logs?.length ?? 0})`}>
        <Table head={['시각', '실행자', '동작', '대상', '상세']}>
          {(logs ?? []).map((l) => (
            <tr key={l.id}>
              <Td className="whitespace-nowrap text-xs">{l.at?.slice(0, 19).replace('T', ' ')}</Td>
              <Td className="text-xs">{l.actor}</Td>
              <Td className="text-xs">{l.action}</Td>
              <Td className="text-xs">{l.target_id ?? '-'}</Td>
              <Td className="max-w-[420px] truncate font-mono text-[11px] text-slate-500">
                {l.detail ? JSON.stringify(l.detail) : ''}
              </Td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  )
}

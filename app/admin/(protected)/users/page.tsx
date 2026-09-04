/** 사용자·개인정보 (PRD §7-2, R30) */
import { db } from '@/lib/db'
import { getSettings } from '@/lib/settings'
import { Button, Card, Table, Td } from '@/components/ui'
import { L } from '@/lib/labels'
import { purgeAction } from '@/app/admin/actions'

export const dynamic = 'force-dynamic'

type Search = Promise<{ q?: string }>

export default async function UsersPage({ searchParams }: { searchParams: Search }) {
  const { q } = await searchParams
  const s = await getSettings()

  let query = db().from('users').select('*').order('first_applied_at', { ascending: false }).limit(500)
  if (q) query = query.or(`name.ilike.%${q}%,email.ilike.%${q}%,affiliation.ilike.%${q}%`)
  const { data: users } = await query

  return (
    <>
      <h1 className="text-xl font-bold text-[var(--gnu-navy)]">{L.menu.users}</h1>

      <Card title="검색">
        <form className="flex items-end gap-3">
          <input
            name="q"
            defaultValue={q ?? ''}
            placeholder="이름·이메일·소속"
            className="rounded-md border border-slate-300 p-2 text-sm"
          />
          <Button>조회</Button>
        </form>
      </Card>

      <Card title={`참여자 (${users?.length ?? 0})`}>
        <form action={purgeAction} className="space-y-3">
          <p className="text-xs text-slate-500">
            보유기간: {s.privacy_period} · 파기 시 이름·이메일·연락처가 「(파기)」로 바뀌며 실적 수치는 유지됩니다.
          </p>
          <Table head={['선택', '사용자ID', '이름', '구분', '소속', '이메일', '연락처', '동의일시', '최초신청', '파기']}>
            {(users ?? []).map((u) => (
              <tr key={u.id}>
                <Td>
                  <input type="checkbox" name="ids" value={u.id} disabled={!!u.purged_at} />
                </Td>
                <Td className="text-xs">{u.id}</Td>
                <Td>{u.name}</Td>
                <Td className="text-xs">{u.type}</Td>
                <Td className="text-xs">{u.affiliation ?? '-'}</Td>
                <Td className="text-xs">{u.email}</Td>
                <Td className="text-xs">{u.phone ?? '-'}</Td>
                <Td className="text-xs">{u.privacy_consented_at?.slice(0, 10) ?? '-'}</Td>
                <Td className="text-xs">{u.first_applied_at?.slice(0, 10) ?? '-'}</Td>
                <Td className="text-xs">{u.purged_at ? u.purged_at.slice(0, 10) : '-'}</Td>
              </tr>
            ))}
          </Table>
          <Button variant="danger">선택 개인정보 파기 실행</Button>
        </form>
      </Card>
    </>
  )
}

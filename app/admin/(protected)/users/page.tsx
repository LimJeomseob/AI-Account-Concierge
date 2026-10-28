/**
 * 사용자 (PRD §7-2) — 조회 전용.
 * 개인정보 파기(R30)는 시스템 기능으로 제공하지 않는다(2026-10-28). 보유기간 만료 시 운영자가
 * docs/운영매뉴얼.md 의 SQL 절차로 DB 에서 직접 처리한다.
 */
import { db } from '@/lib/db'
import { getSettings } from '@/lib/settings'
import { toKSTDate } from '@/lib/date'
import { Button, Card, Table, Td } from '@/components/ui'
import { L } from '@/lib/labels'

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
        <p className="mb-3 text-xs text-slate-500">
          보유기간: {s.privacy_period} · 보유기간이 지나면 운영매뉴얼의 「개인정보 파기 SQL」 절차로 처리합니다(화면 기능 없음).
        </p>
        <Table head={['사용자ID', '이름', '구분', '소속', '이메일', '연락처', '동의일', '최초신청']}>
          {(users ?? []).map((u) => (
            <tr key={u.id}>
              <Td className="text-xs">{u.id}</Td>
              <Td>{u.name}</Td>
              <Td className="text-xs">{u.type}</Td>
              <Td className="text-xs">{u.affiliation ?? '-'}</Td>
              <Td className="text-xs">{u.email}</Td>
              <Td className="text-xs">{u.phone ?? '-'}</Td>
              <Td className="text-xs">{toKSTDate(u.privacy_consented_at) ?? '-'}</Td>
              <Td className="text-xs">{toKSTDate(u.first_applied_at) ?? '-'}</Td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  )
}

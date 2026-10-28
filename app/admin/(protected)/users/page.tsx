/** 사용자·개인정보 (PRD §7-2, R30) */
import { db } from '@/lib/db'
import { getSettings } from '@/lib/settings'
import { Button, Card } from '@/components/ui'
import { L } from '@/lib/labels'
import PurgeTable, { type UserRow } from './PurgeTable'

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
        <PurgeTable users={(users ?? []) as UserRow[]} privacyPeriod={s.privacy_period} />
      </Card>
    </>
  )
}

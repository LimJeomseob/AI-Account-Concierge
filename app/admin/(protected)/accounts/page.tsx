/** 계정 (PRD §7-2) — 계정번호(GPT-001·CL-001 …) 단위로 관리. 접속 링크 기능은 2026-10-29 폐지 */
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'
import { Badge, Button, Card, Table, Td, inputClass } from '@/components/ui'
import { L } from '@/lib/labels'
import { accountImportAction, accountSaveAction } from '@/app/admin/actions'
import AccountStatusForm from './AccountStatusForm'

export const dynamic = 'force-dynamic'

export default async function AccountsPage() {
  await requireAdmin()

  const { data: accounts } = await db().from('accounts').select('*').order('id')
  const { data: secrets } = await db().from('account_secrets').select('account_id, login_email')
  const secMap = new Map((secrets ?? []).map((s) => [s.account_id, s]))

  return (
    <>
      <h1 className="text-xl font-bold text-[var(--gnu-navy)]">{L.menu.accounts}</h1>

      <Card title="상태 변경">
        <AccountStatusForm
          accounts={(accounts ?? []).map((a) => ({
            id: a.id,
            service: a.service,
            kind: a.kind,
            status: a.status,
          }))}
        />
      </Card>

      <Card title={`계정 목록 (${accounts?.length ?? 0})`}>
        <Table
          head={[
            L.account.id, L.account.service, L.account.kind, L.account.status,
            L.account.login_email, L.account.current, L.account.expires_on,
            L.account.assigned_days, L.account.assigned_count, L.account.alert,
          ]}
        >
          {(accounts ?? []).map((a) => {
            const s = secMap.get(a.id)
            return (
              <tr key={a.id}>
                <Td className="text-xs">{a.id}</Td>
                <Td className="text-xs">{a.service}</Td>
                <Td className="text-xs">{a.kind}</Td>
                <Td>
                  <Badge value={a.status} />
                </Td>
                <Td className="text-xs">{s?.login_email ?? '-'}</Td>
                <Td className="text-xs">{a.current_assignment_id ?? '-'}</Td>
                <Td className="text-xs">{a.expires_on ?? '-'}</Td>
                <Td className="text-xs">{a.assigned_days}</Td>
                <Td className="text-xs">{a.assigned_count}</Td>
                <Td className="text-xs text-orange-700">{a.alert ?? ''}</Td>
              </tr>
            )
          })}
        </Table>
      </Card>

      <Card title="계정 등록">
        <form action={accountSaveAction} className="grid gap-3 sm:grid-cols-3">
          <label className="text-sm">
            <span className="text-xs text-slate-600">{L.account.id} *</span>
            <input name="id" required placeholder="GPT-001" className={inputClass} />
          </label>
          <label className="text-sm">
            <span className="text-xs text-slate-600">{L.account.service}</span>
            <select name="service" className={inputClass}>
              <option>GPT</option>
              <option>Claude</option>
            </select>
          </label>
          <label className="text-sm">
            <span className="text-xs text-slate-600">{L.account.kind}</span>
            <select name="kind" className={inputClass}>
              <option>운영</option>
              <option>예비</option>
            </select>
          </label>
          <label className="text-sm">
            <span className="text-xs text-slate-600">{L.account.login_email}</span>
            <input name="login_email" className={inputClass} />
          </label>
          <label className="text-sm">
            <span className="text-xs text-slate-600">{L.account.activated_on}</span>
            <input name="activated_on" type="date" className={inputClass} />
          </label>
          <label className="text-sm">
            <span className="text-xs text-slate-600">{L.account.expires_on}</span>
            <input name="expires_on" type="date" className={inputClass} />
          </label>
          <div className="sm:col-span-3">
            <Button>저장</Button>
          </div>
        </form>
      </Card>

      <Card title="CSV 가져오기">
        <form action={accountImportAction} className="space-y-2">
          <p className="text-xs text-slate-500">
            헤더: 계정번호,서비스,구분,로그인이메일,활성화일,만료일 (「접속링크」 열이 있어도 무시합니다)
          </p>
          <textarea name="csv" rows={8} className={`${inputClass} font-mono text-xs`} />
          <Button>가져오기</Button>
        </form>
      </Card>
    </>
  )
}

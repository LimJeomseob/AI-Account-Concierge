/** 계정(팀 좌석) (PRD §7-2) */
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'
import { Badge, Button, Card, Table, Td, inputClass } from '@/components/ui'
import { L } from '@/lib/labels'
import { accountImportAction, accountSaveAction } from '@/app/admin/actions'
import AccountStatusForm from './AccountStatusForm'
import AccessUrlForm from './AccessUrlForm'

export const dynamic = 'force-dynamic'

export default async function AccountsPage() {
  await requireAdmin()

  const { data: accounts } = await db().from('accounts').select('*').order('id')
  const { data: secrets } = await db().from('account_secrets').select('account_id, login_email, access_url')
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
            L.account.login_email, L.account.access_url, L.account.current, L.account.expires_on,
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
                <Td className="text-xs">
                  {/* 링크가 없는 좌석은 배정되지 않는다 (R14-2) */}
                  {s?.access_url ? (
                    <a
                      href={s.access_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-blue-700 underline"
                      title={s.access_url}
                    >
                      {s.access_url.length > 32 ? `${s.access_url.slice(0, 32)}…` : s.access_url}
                    </a>
                  ) : (
                    <Badge value="미등록" />
                  )}
                </Td>
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

      <Card title="접속 링크 등록·수정">
        <p className="mb-3 text-xs text-slate-600">
          팀 콘솔에서 좌석마다 발급한 고정 접속 링크를 넣어 주세요. 링크가 없는 좌석은 배정 대상에서 제외되고
          배정안내 메일도 보류됩니다.
        </p>
        <div className="space-y-2">
          {(accounts ?? []).map((a) => (
            <div key={a.id} className="flex flex-wrap items-center gap-3">
              <span className="w-40 text-xs text-slate-600">
                {a.id} · {a.service} · {a.kind}
              </span>
              <AccessUrlForm id={a.id} value={secMap.get(a.id)?.access_url ?? null} />
            </div>
          ))}
        </div>
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
          <label className="text-sm sm:col-span-2">
            <span className="text-xs text-slate-600">{L.account.access_url}</span>
            <input name="access_url" type="url" placeholder="https://…" className={inputClass} />
            <span className="mt-1 block text-xs text-slate-500">
              접속 링크가 없으면 배정 대상에서 제외됩니다.
            </span>
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
            헤더: 계정ID,서비스,구분,로그인이메일,접속링크,활성화일,만료일
          </p>
          <textarea name="csv" rows={8} className={`${inputClass} font-mono text-xs`} />
          <Button>가져오기</Button>
        </form>
      </Card>
    </>
  )
}

/** 계정·금고 (PRD §7-2) */
import Link from 'next/link'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'
import { viewVault } from '@/lib/ops/accounts'
import { Badge, Button, Card, Table, Td, inputClass } from '@/components/ui'
import { L } from '@/lib/labels'
import {
  accountGeneratePasswordAction,
  accountImportAction,
  accountSaveAction,
  accountStatusAction,
} from '@/app/admin/actions'

export const dynamic = 'force-dynamic'

type Search = Promise<{ reveal?: string }>

export default async function AccountsPage({ searchParams }: { searchParams: Search }) {
  const admin = await requireAdmin()
  const { reveal } = await searchParams

  const { data: accounts } = await db().from('accounts').select('*').order('id')
  const { data: secrets } = await db()
    .from('account_secrets')
    .select('account_id, login_email, password_status, password_changed_at, owns_registered_email, two_fa')
  const secMap = new Map((secrets ?? []).map((s) => [s.account_id, s]))

  // 금고 「보기」 — 복호화 + 열람 로그 (PRD §4-1)
  const vault = reveal ? await viewVault(reveal, admin) : null

  return (
    <>
      <h1 className="text-xl font-bold text-[var(--gnu-navy)]">{L.menu.accounts}</h1>

      {vault && (
        <Card title={`금고 열람 — ${vault.account_id}`}>
          <p className="text-xs text-slate-500">열람 기록이 로그에 남았습니다.</p>
          <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs text-slate-500">{L.account.login_email}</dt>
              <dd className="font-mono">{vault.login_email ?? '-'}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">{L.account.password}</dt>
              <dd className="font-mono">{vault.password ?? '-'}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">{L.account.new_password}</dt>
              <dd className="font-mono">{vault.new_password ?? '-'}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">{L.account.password_status}</dt>
              <dd>
                <Badge value={vault.password_status} />
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">{L.account.two_fa}</dt>
              <dd className="font-mono">{vault.two_fa ?? '-'}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">{L.account.owns_registered_email}</dt>
              <dd>{vault.owns_registered_email ? '예' : '아니오'}</dd>
            </div>
          </dl>
          <Link href="/admin/accounts" className="mt-3 inline-block text-xs text-blue-700">
            닫기
          </Link>
        </Card>
      )}

      <Card title="상태 변경">
        <form action={accountStatusAction} className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="text-xs text-slate-600">{L.account.id}</span>
            <input name="id" required className={inputClass} />
          </label>
          <label className="text-sm">
            <span className="text-xs text-slate-600">{L.account.status}</span>
            <select name="status" className={inputClass}>
              <option>가용</option>
              <option>배정</option>
              <option>회수중</option>
              <option>정지</option>
              <option>만료</option>
            </select>
          </label>
          <Button variant="ghost">변경</Button>
        </form>
      </Card>

      <Card title={`계정 목록 (${accounts?.length ?? 0})`}>
        <form action={accountGeneratePasswordAction} className="space-y-2">
          <Table
            head={[
              '선택', L.account.id, L.account.service, L.account.kind, L.account.status,
              L.account.current, L.account.expires_on, L.account.assigned_days, L.account.assigned_count,
              L.account.password_status, L.account.alert, '',
            ]}
          >
            {(accounts ?? []).map((a) => {
              const s = secMap.get(a.id)
              return (
                <tr key={a.id}>
                  <Td>
                    <input type="checkbox" name="ids" value={a.id} />
                  </Td>
                  <Td className="text-xs">{a.id}</Td>
                  <Td className="text-xs">{a.service}</Td>
                  <Td className="text-xs">{a.kind}</Td>
                  <Td>
                    <Badge value={a.status} />
                  </Td>
                  <Td className="text-xs">{a.current_assignment_id ?? '-'}</Td>
                  <Td className="text-xs">{a.expires_on ?? '-'}</Td>
                  <Td className="text-xs">{a.assigned_days}</Td>
                  <Td className="text-xs">{a.assigned_count}</Td>
                  <Td>
                    <Badge value={s?.password_status} />
                  </Td>
                  <Td className="text-xs text-orange-700">{a.alert ?? ''}</Td>
                  <Td>
                    <Link href={`/admin/accounts?reveal=${a.id}`} className="text-xs text-blue-700">
                      금고 보기
                    </Link>
                  </Td>
                </tr>
              )
            })}
          </Table>
          <Button variant="ghost">선택 계정 신규 비밀번호 생성</Button>
        </form>
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
            <span className="text-xs text-slate-600">{L.account.password}</span>
            <input name="password" className={inputClass} />
          </label>
          <label className="text-sm">
            <span className="text-xs text-slate-600">{L.account.two_fa}</span>
            <input name="two_fa" className={inputClass} />
          </label>
          <label className="text-sm">
            <span className="text-xs text-slate-600">{L.account.activated_on}</span>
            <input name="activated_on" type="date" className={inputClass} />
          </label>
          <label className="text-sm">
            <span className="text-xs text-slate-600">{L.account.expires_on}</span>
            <input name="expires_on" type="date" className={inputClass} />
          </label>
          <label className="flex items-end gap-2 text-sm">
            <input type="checkbox" name="owns_registered_email" />
            <span className="text-xs text-slate-600">{L.account.owns_registered_email}</span>
          </label>
          <div className="sm:col-span-3">
            <Button>저장</Button>
          </div>
        </form>
      </Card>

      <Card title="CSV 가져오기">
        <form action={accountImportAction} className="space-y-2">
          <p className="text-xs text-slate-500">
            헤더: 계정ID,서비스,구분,로그인이메일,비밀번호,활성화일,만료일,등록이메일소유,2FA
          </p>
          <textarea name="csv" rows={8} className={`${inputClass} font-mono text-xs`} />
          <Button>가져오기</Button>
        </form>
      </Card>
    </>
  )
}

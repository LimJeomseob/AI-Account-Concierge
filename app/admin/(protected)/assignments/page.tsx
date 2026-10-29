/**
 * 유료계정 사용현황 (PRD §7-2, 2026-10-29 개편 — 구 「신청·배정」)
 * 서비스별 계정 현황 + 신청·배정·회수 처리를 한 화면(사용현황 목록)에서 한다.
 * 목록에서 고른 건을 일괄 처리: 선택 승인+배정+이메일 내려받기 · 승인만 · 회수 시작 · 회수 완료 · 취소.
 * 행마다: 안내문 복사(사용중), 회수 체크 2개(회수중). 사용현황 CSV 일괄 등록(사용중·회수완료).
 * 필터: 전체보기 · 상태별 · 프로그램별 · 플랫폼(ChatGPT·Claude) · 이름 · 이메일 · 계정번호 (lib/filter.ts — 목록·CSV·「승인 건 배정」 공통)
 */
import Link from 'next/link'
import { db } from '@/lib/db'
import { toKSTDate } from '@/lib/date'
import type { ReactNode } from 'react'
import { Badge, Button, Card, Td } from '@/components/ui'
import CopyButton from '@/components/CopyButton'
import { CHECKLIST_FIELDS, L } from '@/lib/labels'
import { applicantEmails } from '@/lib/ops/export'
import { applyFilter, exportQuery, parseFilter, type ApplicantFilter } from '@/lib/filter'
import { getSettings } from '@/lib/settings'
import { supportStatus } from '@/lib/report'
import { hasSecret, tryIncidentUrl } from '@/lib/token'
import {
  bulkApproveAction,
  bulkCancelAction,
  bulkReturnCompleteAction,
  bulkReturnStartAction,
  checklistAction,
} from '@/app/admin/actions'
import AssignExportButton from './AssignExportButton'
import ApproveAssignButton from './ApproveAssignButton'
import UsageImport from './UsageImport'
import { ConfirmSubmit, SelectAll } from './BulkControls'

export const dynamic = 'force-dynamic'

/** 상태 버튼 순서 — 현재 쓰는 상태. 반려·배정·인수기한초과는 폐지된 구 상태라 건수가 있을 때만 보인다 */
const MAIN_STATUSES = ['신청', '승인', '사용중', '회수중', '회수완료', '취소']
const OLD_STATUSES = ['반려', '배정', '인수기한초과']
/** 목록에서 선택할 수 있는 상태 — 각 일괄 처리는 서버에서 상태를 다시 확인해 맞지 않는 건은 건너뛴다 */
const SELECTABLE = ['신청', '승인', '배정', '사용중', '회수중', '인수기한초과']

type Search = Promise<Record<string, string | undefined>>

export default async function UsagePage({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams
  const f = parseFilter((k) => sp[k])

  const listQuery = applyFilter(
    db()
      .from('assignments')
      .select(
        'id, name, email, program_id, service_wish, account_id, service, status, applied_at, approved_on, assigned_on, rent_start, rent_end, acknowledged_at, note, chk_delete_chats, chk_team_removed, programs(name)',
      )
      .order('applied_at', { ascending: false })
      .limit(500),
    f,
  )
  // 상태별 건수 — 상태를 뺀 나머지 조건(프로그램·이름·이메일·계정번호)을 그대로 적용
  const countQuery = applyFilter(db().from('assignments').select('status').limit(10000), f, { skipStatus: true })

  const [{ data: rows, error: rowsError }, { data: programs }, { data: statusRows }, { data: accRows }, s] =
    await Promise.all([
      listQuery,
      db().from('programs').select('id, name').order('id'),
      countQuery,
      db().from('accounts').select('service, status'),
      getSettings(),
    ])

  const list = rows ?? []
  const byStatus = new Map<string, number>()
  for (const r of statusRows ?? []) byStatus.set(r.status, (byStatus.get(r.status) ?? 0) + 1)
  const totalAll = (statusRows ?? []).length
  const support = supportStatus(accRows ?? [], { GPT: s.contract_gpt, Claude: s.contract_claude })

  // 계정의 로그인 이메일(계정명) — 안내문에 쓴다
  const accountIds = [...new Set(list.map((r) => r.account_id).filter((v): v is string => !!v))]
  const loginEmails = new Map<string, string | null>()
  if (accountIds.length > 0) {
    const { data: secs } = await db().from('account_secrets').select('account_id, login_email').in('account_id', accountIds)
    for (const x of secs ?? []) loginEmails.set(x.account_id, x.login_email)
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
  const secretMissing = !hasSecret()
  const emails = applicantEmails(list)
  const exportHref = `/api/admin/assignments/export${exportQuery(f)}`
  const hasFilter = Object.keys(f).length > 0
  const statusHref = (status?: string) => `/admin/assignments${exportQuery({ ...f, status })}`
  const visibleStatuses = [...MAIN_STATUSES, ...OLD_STATUSES.filter((x) => (byStatus.get(x) ?? 0) > 0)]
  const notice = (sp.notice ?? '').slice(0, 300)
  const guide = (r: { id: string; name: string; email: string; account_id: string | null; service: string | null; rent_start: string | null; rent_end: string | null }) =>
    `[AI융합원] ${r.name}님 AI 유료계정 안내
계정번호: ${r.account_id} (${r.service})${loginEmails.get(r.account_id ?? '') ? `\n계정명: ${loginEmails.get(r.account_id ?? '')}` : ''}
팀 워크스페이스 초대 메일(${r.email})을 확인해 주세요.
대여기간: ${r.rent_start ?? '-'} ~ ${r.rent_end ?? '-'}
장애 신고(정지·로그인 불가): ${tryIncidentUrl(appUrl, r.id) ?? '(APP_SECRET 미설정 — 담당자에게 문의)'}`

  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold text-[var(--gnu-navy)]">{L.menu.assignments}</h1>
          <p className="text-sm text-slate-500">서비스별 계정 현황과 신청·승인·배정·회수를 한 화면에서 처리합니다.</p>
        </div>
        <div className="flex items-center gap-3">
          <p className="text-sm text-slate-500">
            {hasFilter ? '조건에 맞는' : '전체'} {list.length}건{list.length >= 500 ? ' (최근 500건까지 표시)' : ''}
          </p>
          {/* 현재 조회 조건 그대로 내려받는다(화면 표시 500건 제한 없이 최대 5000건) */}
          <a
            href={exportHref}
            className="rounded-md bg-gnu-navy px-3 py-2 text-sm font-semibold text-white hover:bg-gnu-navy-dark"
          >
            {L.assignment.export_csv}
          </a>
        </div>
      </header>

      {notice && (
        <div role="status" className="rounded-md border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900">
          {notice}
        </div>
      )}
      {rowsError && (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          ⚠ 목록을 불러오지 못했습니다: {rowsError.message}
        </div>
      )}
      {secretMissing && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          ⚠ Vercel 환경변수 <code>APP_SECRET</code> 이 없어 안내문에 장애 신고 링크를 넣을 수 없습니다. 값을 등록하고 재배포해 주세요(
          <code>openssl rand -hex 32</code>).
        </div>
      )}

      {/* 서비스별 계정 현황 */}
      <section className="grid gap-4 md:grid-cols-2">
        {support.map((x) => (
          <Card
            key={x.service}
            title={x.label}
            right={
              <Link
                href={`/admin/assignments${exportQuery({ service: x.service })}`}
                className="text-xs text-gnu-blue underline-offset-2 hover:underline"
              >
                이 플랫폼만 보기 →
              </Link>
            }
          >
            <dl className="grid grid-cols-5 gap-2">
              <Tile label="계약" value={x.contract} />
              <Tile label="사용중" value={x.inUse} />
              <Tile label="회수중" value={x.returning} />
              <Tile label="가용" value={x.available} />
              <Tile label="정지" value={x.suspended} warn={x.suspended > 0} />
            </dl>
            <p className="mt-2 text-xs text-slate-500">
              등록 {x.registered}개 · 사용률 {x.contract > 0 ? Math.round((x.inUse / x.contract) * 1000) / 10 : 0}%
            </p>
          </Card>
        ))}
      </section>

      {/* 필터 — 전체보기 · 상태별 · 프로그램별 · 이름 · 이메일 · 계정번호 */}
      <Card title="현황 조회">
        <nav className="flex flex-wrap gap-2 text-sm" aria-label="상태별 보기">
          <StatusChip href={statusHref(undefined)} active={!f.status} label="전체보기" count={totalAll} />
          {visibleStatuses.map((st) => (
            <StatusChip key={st} href={statusHref(st)} active={f.status === st} label={st} count={byStatus.get(st) ?? 0} />
          ))}
        </nav>

        <form className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-7">
          <label className="lg:col-span-1">
            <span className="block text-xs text-slate-600">상태</span>
            <select name="status" defaultValue={f.status ?? ''} className="mt-1 w-full rounded-md border border-slate-300 p-2">
              <option value="">전체</option>
              {[...MAIN_STATUSES, ...OLD_STATUSES].map((st) => (
                <option key={st}>{st}</option>
              ))}
            </select>
          </label>
          <label className="lg:col-span-1">
            <span className="block text-xs text-slate-600">플랫폼</span>
            <select name="service" defaultValue={f.service ?? ''} className="mt-1 w-full rounded-md border border-slate-300 p-2">
              <option value="">전체</option>
              <option value="GPT">ChatGPT</option>
              <option value="Claude">Claude</option>
            </select>
          </label>
          <label className="lg:col-span-2">
            <span className="block text-xs text-slate-600">프로그램</span>
            <select name="program" defaultValue={f.program ?? ''} className="mt-1 w-full rounded-md border border-slate-300 p-2">
              <option value="">전체</option>
              {(programs ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <TextFilter name="name" label="이름" value={f.name} />
          <TextFilter name="email" label="이메일" value={f.email} />
          <TextFilter name="account" label="계정번호" value={f.account} placeholder="예: CL-001" />
          <div className="flex items-end gap-3 sm:col-span-2 lg:col-span-7">
            <Button>조회</Button>
            <Link href="/admin/assignments" className="text-sm text-slate-500 underline-offset-2 hover:underline">
              전체보기(조건 초기화)
            </Link>
          </div>
        </form>

        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-gnu-line pt-3 text-sm">
          <span className="text-xs text-slate-600">
            현재 목록 {list.length}건 · 이메일 {emails.length}개
          </span>
          <a
            href={exportHref}
            className="rounded-md border border-slate-300 bg-white px-2 py-1 text-[13px] text-slate-700 hover:bg-slate-50"
          >
            {L.assignment.export_csv}
          </a>
          {emails.length > 0 && <CopyButton value={emails.join(', ')} label={L.assignment.copy_emails} />}
          <span className="text-xs text-slate-400">(조회용 — 배정되지 않음)</span>
        </div>
      </Card>

      <Card title="승인 대기 일괄 배정">
        <AssignExportButton filter={f} />
        <p className="mt-1 text-xs text-slate-500">
          「승인만」 했거나 계정 대기로 남은 「승인」 건 중 현재 조회 조건(프로그램·플랫폼·이름·이메일)에 걸린 건에 신청 순으로 계정을 배정하고,
          배정된 사람의 이름·이메일·계정번호를 내려받습니다.
        </p>
      </Card>

      <Card title={`사용현황 목록 (${list.length}건)`}>
        <form className="space-y-3">
          {/* 입력칸에서 Enter 를 눌러도 일괄 처리가 실행되지 않게 — 비활성 기본 버튼이 묵시적 제출을 막는다 */}
          <button type="submit" disabled hidden aria-hidden tabIndex={-1} />
          <input type="hidden" name="back" value={exportQuery(f)} />
          {/* 일괄 처리 — 고른 건 중 상태가 맞는 건만 처리하고 나머지는 건너뛴다 */}
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-gnu-line bg-slate-50 p-3">
            <span className="text-xs font-medium text-slate-600">신청 →</span>
            <ApproveAssignButton />
            <ConfirmSubmit action={bulkApproveAction} label="승인만" confirm="선택한 {n}건 중 「신청」 건을 승인합니다(배정은 하지 않음)." />
            <span className="mx-1 h-5 w-px bg-slate-300" aria-hidden />
            <span className="text-xs font-medium text-slate-600">회수 →</span>
            <ConfirmSubmit
              action={bulkReturnStartAction}
              label="선택 회수 시작"
              confirm="선택한 {n}건 중 「사용중」 건을 「회수중」으로 바꿉니다. 계정도 회수중이 됩니다. 계속할까요?"
            />
            <ConfirmSubmit
              action={bulkReturnCompleteAction}
              label="선택 회수 완료"
              variant="primary"
              confirm={'선택한 {n}건 중 「회수중」 건의\n① 계정 대화·메모리 삭제\n② 팀 워크스페이스에서 멤버 제거\n를 모두 마쳤습니까?\n\n확인하면 체크 2개를 표시하고 회수 완료합니다(계정은 가용으로 돌아감).'}
            />
            <span className="mx-1 h-5 w-px bg-slate-300" aria-hidden />
            <input name="reason" placeholder="취소 사유" maxLength={200} className="rounded-md border border-slate-300 px-2 py-1 text-xs" />
            <ConfirmSubmit
              action={bulkCancelAction}
              label="선택 취소"
              variant="danger"
              confirm="선택한 {n}건을 취소합니다. 계정이 붙은 건은 「회수중」이 되고 실적에서 빠집니다. 계속할까요?"
            />
          </div>

          <UsageTable
            rows={list}
            manage={(r) => {
              if (['배정', '사용중'].includes(r.status) && r.account_id) {
                return <CopyButton value={guide(r)} label="안내문 복사" />
              }
              if (['회수중', '인수기한초과'].includes(r.status)) {
                return (
                  <div className="flex flex-wrap gap-1">
                    {CHECKLIST_FIELDS.map((fld) => {
                      const checked = Boolean((r as unknown as Record<string, boolean>)[fld])
                      return (
                        // 목록 폼 밖의 작은 폼(아래 checkForms)을 form 속성으로 제출 — 서버 액션 버튼은 name/value 를 쓸 수 없다
                        <button
                          key={fld}
                          type="submit"
                          form={`chk-${r.id}-${fld}`}
                          className={`whitespace-nowrap rounded-full border px-2 py-0.5 text-[12px] ${
                            checked ? 'border-green-300 bg-green-100 text-green-800' : 'border-slate-300 bg-white text-slate-600'
                          }`}
                        >
                          {checked ? '✓ ' : ''}
                          {L.checklist[fld]}
                        </button>
                      )
                    })}
                  </div>
                )
              }
              return <span className="text-slate-300">-</span>
            }}
          />
          <p className="text-xs text-slate-500">
            「선택 승인 + 배정 + 이메일 내려받기」: 고른 「신청」·「승인」 건을 승인하고 바로 계정을 배정한 뒤 이름·이메일·계정번호 CSV 를
            내려받습니다(가용 계정이 모자라면 「승인」으로 남고 「(대기)」 표시). 회수는 「선택 회수 시작」 → 행의 체크 2개 또는 「선택 회수 완료」.
          </p>
        </form>
      </Card>

      {/* 행의 회수 체크 토글용 폼 — 목록 폼 안에 폼을 둘 수 없어 밖에 두고 버튼의 form 속성으로 연결 */}
      <div hidden>
        {list
          .filter((r) => ['회수중', '인수기한초과'].includes(r.status))
          .flatMap((r) =>
            CHECKLIST_FIELDS.map((fld) => (
              <form key={`${r.id}-${fld}`} id={`chk-${r.id}-${fld}`} action={checklistAction}>
                <input type="hidden" name="id" value={r.id} />
                <input type="hidden" name="field" value={fld} />
                <input type="hidden" name="value" value={(r as unknown as Record<string, boolean>)[fld] ? 'false' : 'true'} />
              </form>
            )),
          )}
      </div>

      <Card title="사용현황 CSV 일괄 등록">
        <UsageImport programs={programs ?? []} />
      </Card>
    </>
  )
}

function Tile({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className={`rounded-lg border px-2 py-2 text-center ${warn ? 'border-red-200 bg-red-50' : 'border-gnu-line bg-white'}`}>
      <dt className={`whitespace-nowrap text-xs ${warn ? 'text-red-700' : 'text-gnu-muted'}`}>{label}</dt>
      <dd className={`mt-0.5 text-2xl font-bold ${warn ? 'text-red-700' : 'text-gnu-navy'}`}>{value}</dd>
    </div>
  )
}

function StatusChip({ href, active, label, count }: { href: string; active: boolean; label: string; count: number }) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={`rounded-full border px-3 py-1 ${
        active ? 'border-gnu-navy bg-gnu-navy text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
      }`}
    >
      {label} <span className={active ? 'opacity-80' : 'text-slate-400'}>{count}</span>
    </Link>
  )
}

function TextFilter({ name, label, value, placeholder }: { name: keyof ApplicantFilter; label: string; value?: string; placeholder?: string }) {
  return (
    <label>
      <span className="block text-xs text-slate-600">{label}</span>
      <input
        name={name}
        defaultValue={value ?? ''}
        placeholder={placeholder ?? '일부만 입력해도 됩니다'}
        maxLength={100}
        className="mt-1 w-full rounded-md border border-slate-300 p-2"
      />
    </label>
  )
}

type UsageRow = {
  id: string
  name: string
  email: string
  service_wish: string
  account_id: string | null
  service: string | null
  status: string
  rent_start: string | null
  rent_end: string | null
  acknowledged_at: string | null
  programs: { name: string } | null
}

const HEAD = ['접수번호', '이름', '이메일', '프로그램', L.account.id, '상태', '관리', '대여기간', '사용 개시', '희망']

function UsageTable({ rows, manage }: { rows: Array<Record<string, unknown>>; manage: (r: UsageRow) => ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-gnu-line">
      <table className="w-full min-w-[960px] border-collapse text-[15px] [&_tbody_tr]:odd:bg-white [&_tbody_tr]:even:bg-slate-50/60 [&_tbody_tr]:hover:bg-gnu-sky/50">
        <thead className="bg-gnu-sky/60 text-left text-[13px] text-gnu-navy">
          <tr>
            <th className="border-b border-gnu-line px-3 py-2.5">
              <SelectAll />
            </th>
            {HEAD.map((h) => (
              <th key={h} className="whitespace-nowrap border-b border-gnu-line px-3 py-2.5 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const row = r as UsageRow
            return (
              <tr key={row.id}>
                <Td>
                  <input
                    type="checkbox"
                    name="ids"
                    value={row.id}
                    disabled={!SELECTABLE.includes(row.status)}
                    aria-label={`${row.id} 선택`}
                  />
                </Td>
                <Td className="whitespace-nowrap text-xs">{row.id}</Td>
                <Td className="whitespace-nowrap">{row.name}</Td>
                <Td className="text-xs">{row.email}</Td>
                <Td className="text-xs">{row.programs?.name ?? '-'}</Td>
                <Td className="whitespace-nowrap text-xs">{row.account_id ? `${row.account_id} (${row.service})` : '-'}</Td>
                <Td className="whitespace-nowrap">
                  <Badge value={row.status} />
                </Td>
                <Td className="text-xs">{manage(row)}</Td>
                <Td className="whitespace-nowrap text-xs">
                  {row.rent_start ?? '-'} ~ {row.rent_end ?? '-'}
                </Td>
                <Td className="whitespace-nowrap text-xs">{toKSTDate(row.acknowledged_at) ?? '-'}</Td>
                <Td className="text-xs">{row.service_wish}</Td>
              </tr>
            )
          })}
          {rows.length === 0 && (
            <tr>
              <td colSpan={HEAD.length + 1} className="px-3 py-6 text-center text-sm text-slate-500">
                조건에 맞는 건이 없습니다.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

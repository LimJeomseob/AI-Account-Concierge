/** 신청·배정 (PRD §7-2) */
import Link from 'next/link'
import { db } from '@/lib/db'
import { toKSTDate } from '@/lib/date'
import { Badge, Button, Card, Table, Td } from '@/components/ui'
import CopyButton from '@/components/CopyButton'
import { CHECKLIST_FIELDS, L } from '@/lib/labels'
import { applicantEmails, exportQuery } from '@/lib/ops/export'
import { hasSecret, tryIncidentUrl } from '@/lib/token'
import { approveAction, cancelAction, checklistAction, completeReturnAction } from '@/app/admin/actions'
import AssignExportButton from './AssignExportButton'

export const dynamic = 'force-dynamic'

const STATUSES = ['신청', '승인', '사용중', '회수중', '회수완료', '취소', '반려', '배정', '인수기한초과'] // 반려·배정·인수기한초과는 구 상태(조회용)

type Search = Promise<{ status?: string; program?: string; q?: string }>

export default async function AssignmentsPage({ searchParams }: { searchParams: Search }) {
  const { status, program, q } = await searchParams

  let query = db()
    .from('assignments')
    .select(
      'id, name, email, program_id, service_wish, account_id, service, status, applied_at, approved_on, assigned_on, rent_start, rent_end, acknowledged_at, note, chk_delete_chats, chk_team_removed, programs(name)',
    )
    .order('applied_at', { ascending: false })
    .limit(300)

  if (status) query = query.eq('status', status)
  if (program) query = query.eq('program_id', program)
  if (q) query = query.or(`name.ilike.%${q}%,email.ilike.%${q}%,id.ilike.%${q}%`)

  const { data: rows, error: rowsError } = await query
  const { data: programs } = await db().from('programs').select('id, name').order('id')

  // 안내문의 장애 신고 링크(R26) — 신청자 자동 메일이 없으므로 안내문에 담아 직접 전달한다
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
  // 신청자 메일 발송 명단 — 자동 메일 폐지(R11·R16)로 담당자가 직접 보내므로 화면에서 바로 내려받는다
  const emails = applicantEmails(rows ?? [])
  const exportHref = `/api/admin/assignments/export${exportQuery({ status, program, q })}`

  // 계정의 로그인 이메일(계정명) — 안내문에 쓴다. 접속 링크 기능은 2026-10-29 폐지(R14-2)
  const accountIds = [...new Set((rows ?? []).map((r) => r.account_id).filter((v): v is string => !!v))]
  const loginEmails = new Map<string, string | null>()
  if (accountIds.length > 0) {
    const { data: secs } = await db().from('account_secrets').select('account_id, login_email').in('account_id', accountIds)
    for (const x of secs ?? []) loginEmails.set(x.account_id, x.login_email)
  }

  // APP_SECRET 이 없으면 장애 신고 링크를 만들 수 없다 — 예외로 페이지 전체가 깨지지 않게 경고만 띄운다
  const secretMissing = !hasSecret()

  return (
    <>
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-[var(--gnu-navy)]">{L.menu.assignments}</h1>
        <p className="text-sm text-slate-500">{rows?.length ?? 0}건</p>
      </header>

      {rowsError && (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          ⚠ 신청 목록을 불러오지 못했습니다: {rowsError.message}
        </div>
      )}
      {secretMissing && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          ⚠ Vercel 환경변수 <code>APP_SECRET</code> 이 없어 안내문에 장애 신고 링크를 넣을 수 없습니다. 값을 등록하고 재배포해 주세요(<code>openssl rand -hex 32</code>).
        </div>
      )}

      <Card title="필터">
        <form className="flex flex-wrap items-end gap-3 text-sm">
          <label>
            <span className="block text-xs text-slate-600">상태</span>
            <select name="status" defaultValue={status ?? ''} className="mt-1 rounded-md border border-slate-300 p-2">
              <option value="">전체</option>
              {STATUSES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label>
            <span className="block text-xs text-slate-600">프로그램</span>
            <select name="program" defaultValue={program ?? ''} className="mt-1 rounded-md border border-slate-300 p-2">
              <option value="">전체</option>
              {(programs ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="block text-xs text-slate-600">검색(이름·이메일·접수번호)</span>
            <input name="q" defaultValue={q ?? ''} className="mt-1 rounded-md border border-slate-300 p-2" />
          </label>
          <Button>조회</Button>
          <Link href="/admin/assignments" className="text-xs text-slate-500">
            초기화
          </Link>
        </form>
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-gnu-line pt-3 text-sm">
          <span className="text-xs text-slate-600">현재 목록 {rows?.length ?? 0}건 · 이메일 {emails.length}개</span>
          <a
            href={exportHref}
            className="rounded-md border border-slate-300 bg-white px-2 py-1 text-[13px] text-slate-700 hover:bg-slate-50"
          >
            {L.assignment.export_csv}
          </a>
          {emails.length > 0 && <CopyButton value={emails.join(', ')} label={L.assignment.copy_emails} />}
          <span className="text-xs text-slate-400">(조회용 — 배정되지 않음)</span>
        </div>
        <div className="mt-3 border-t border-gnu-line pt-3">
          <AssignExportButton program={program} q={q} />
          <p className="mt-1 text-xs text-slate-500">
            현재 목록 조건(프로그램·검색어)에 걸린 「승인」 건에 신청 순으로 계정을 배정하고, 배정된 사람의 이름·이메일·계정번호를 내려받습니다.
            받은 이메일을 ChatGPT·Claude 팀 워크스페이스에 초대해 주세요.
          </p>
        </div>
      </Card>

      <Card title="일괄 처리">
        <form action={approveAction} className="space-y-2">
          <p className="text-xs text-slate-500">
            ① 아래 표에서 선택한 건을 승인합니다(승인만 하고 배정은 하지 않음) → ② 위 「승인 건 배정 + 메일 내려받기」로 계정 배정 → ③ 받은 이메일을 팀 워크스페이스에 초대.
          </p>
          <ListTable rows={rows ?? []} />
          <div className="flex flex-wrap items-center gap-2 pt-2">
            <Button>선택 승인</Button>
          </div>
        </form>
      </Card>

      {(rows ?? [])
        .filter((r) => ['배정', '사용중', '회수중', '인수기한초과'].includes(r.status))
        .map((r) => (
          <Card key={r.id} title={`${r.id} · ${r.name} · ${r.status}`}>
            <p className="text-sm text-slate-600">
              {(r as unknown as { programs: { name: string } | null }).programs?.name} · 계정{' '}
              {r.account_id ?? '-'} ({r.service ?? '-'}) · 대여 {r.rent_start ?? '-'} ~ {r.rent_end ?? '-'} · 사용 개시{' '}
              {toKSTDate(r.acknowledged_at) ?? '-'}
            </p>
            {r.account_id && (
              <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md bg-gnu-sky/60 px-3 py-2 text-sm">
                <span className="font-medium text-gnu-navy">신청자에게 전달할 정보</span>
                <span>이메일 {r.email}</span>
                <span>· 계정번호 {r.account_id} ({r.service})</span>
                <span>· 계정명 {loginEmails.get(r.account_id) ?? '-'}</span>
                <CopyButton
                  value={`[AI융합원] ${r.name}님 AI 유료계정 안내
계정번호: ${r.account_id} (${r.service})
팀 워크스페이스 초대 메일(${r.email})을 확인해 주세요.
대여기간: ${r.rent_start ?? '-'} ~ ${r.rent_end ?? '-'}
장애 신고(정지·로그인 불가): ${tryIncidentUrl(appUrl, r.id) ?? '(APP_SECRET 미설정 — 담당자에게 문의)'}`}
                  label="안내문 복사"
                />
              </div>
            )}

            <div className="mt-3 flex flex-wrap gap-2">
              <form action={cancelAction}>
                <input type="hidden" name="id" value={r.id} />
                <input
                  name="reason"
                  placeholder="취소 사유"
                  className="mr-1 rounded-md border border-slate-300 px-2 py-1 text-xs"
                />
                <Button variant="danger">취소</Button>
              </form>
            </div>

            {(r.status === '회수중' || r.status === '인수기한초과') && (
              <div className="mt-4 rounded-md border border-orange-200 bg-orange-50 p-3">
                <p className="text-xs font-medium text-orange-800">회수 체크리스트 (2개 모두 완료해야 회수 완료)</p>
                <p className="mt-1 text-xs text-orange-700">
                  ① 계정의 대화·메모리 삭제 → ② 팀 콘솔에서 멤버 제거(접속 차단)
                </p>
                <div className="mt-2 flex flex-wrap gap-3">
                  {CHECKLIST_FIELDS.map((f) => {
                    const checked = Boolean((r as unknown as Record<string, boolean>)[f])
                    return (
                      <form key={f} action={checklistAction}>
                        <input type="hidden" name="id" value={r.id} />
                        <input type="hidden" name="field" value={f} />
                        <input type="hidden" name="value" value={checked ? 'false' : 'true'} />
                        <button
                          className={`rounded-full border px-3 py-1 text-xs ${
                            checked
                              ? 'border-green-300 bg-green-100 text-green-800'
                              : 'border-slate-300 bg-white text-slate-600'
                          }`}
                        >
                          {checked ? '✓ ' : ''}
                          {L.checklist[f]}
                        </button>
                      </form>
                    )
                  })}
                </div>
                <form action={completeReturnAction} className="mt-3">
                  <input type="hidden" name="id" value={r.id} />
                  <Button>회수 완료</Button>
                </form>
              </div>
            )}
          </Card>
        ))}
    </>
  )
}

function ListTable({ rows }: { rows: Array<Record<string, unknown>> }) {
  return (
    <Table head={['선택', '접수번호', '프로그램', '이름', '이메일', '희망', L.account.id, '상태', '대여기간']}>
      {rows.map((r) => {
        const row = r as {
          id: string
          name: string
          email: string
          service_wish: string
          account_id: string | null
          service: string | null
          status: string
          rent_start: string | null
          rent_end: string | null
          programs: { name: string } | null
        }
        return (
          <tr key={row.id}>
            <Td>
              <input type="checkbox" name="ids" value={row.id} disabled={row.status !== '신청'} />
            </Td>
            <Td className="text-xs">{row.id}</Td>
            <Td className="text-xs">{row.programs?.name ?? '-'}</Td>
            <Td>{row.name}</Td>
            <Td className="text-xs">{row.email}</Td>
            <Td className="text-xs">{row.service_wish}</Td>
            <Td className="text-xs">{row.account_id ? `${row.account_id} (${row.service})` : '-'}</Td>
            <Td>
              <Badge value={row.status} />
            </Td>
            <Td className="text-xs">
              {row.rent_start ?? '-'} ~ {row.rent_end ?? '-'}
            </Td>
          </tr>
        )
      })}
    </Table>
  )
}

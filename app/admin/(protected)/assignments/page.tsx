/** 신청·배정 (PRD §7-2) */
import Link from 'next/link'
import { db } from '@/lib/db'
import { Badge, Button, Card, Table, Td } from '@/components/ui'
import { CHECKLIST_FIELDS, L } from '@/lib/labels'
import {
  ackAction,
  approveAction,
  cancelAction,
  checklistAction,
  completeReturnAction,
  rejectAction,
  resendMailAction,
} from '@/app/admin/actions'

export const dynamic = 'force-dynamic'

const STATUSES = ['신청', '승인', '배정', '사용중', '회수중', '회수완료', '반려', '취소', '인수기한초과']

type Search = Promise<{ status?: string; program?: string; q?: string }>

export default async function AssignmentsPage({ searchParams }: { searchParams: Search }) {
  const { status, program, q } = await searchParams

  let query = db()
    .from('assignments')
    .select(
      'id, name, email, program_id, service_wish, account_id, service, status, applied_at, approved_on, assigned_on, rent_start, rent_end, notified_at, acknowledged_at, note, chk_delete_chats, chk_team_removed, programs(name)',
    )
    .order('applied_at', { ascending: false })
    .limit(300)

  if (status) query = query.eq('status', status)
  if (program) query = query.eq('program_id', program)
  if (q) query = query.or(`name.ilike.%${q}%,email.ilike.%${q}%,id.ilike.%${q}%`)

  const { data: rows } = await query
  const { data: programs } = await db().from('programs').select('id, name').order('id')

  return (
    <>
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-[var(--gnu-navy)]">{L.menu.assignments}</h1>
        <p className="text-sm text-slate-500">{rows?.length ?? 0}건</p>
      </header>

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
      </Card>

      <Card title="일괄 처리">
        <form action={approveAction} className="space-y-2">
          <p className="text-xs text-slate-500">
            아래 표에서 선택한 건을 승인합니다. 설정의 「승인 즉시 배정」이 켜져 있으면 자동 배정·메일 발송까지 진행됩니다.
          </p>
          <ListTable rows={rows ?? []} />
          <div className="flex flex-wrap items-center gap-2 pt-2">
            <Button>선택 승인</Button>
            <Button variant="danger" formAction={rejectAction}>
              선택 반려
            </Button>
            <input
              name="reason"
              placeholder="반려 사유"
              className="rounded-md border border-slate-300 px-2 py-1.5 text-xs"
            />
          </div>
        </form>
      </Card>

      {(rows ?? [])
        .filter((r) => ['배정', '사용중', '회수중', '인수기한초과'].includes(r.status))
        .map((r) => (
          <Card key={r.id} title={`${r.id} · ${r.name} · ${r.status}`}>
            <p className="text-xs text-slate-500">
              {(r as unknown as { programs: { name: string } | null }).programs?.name} · 계정{' '}
              {r.account_id ?? '-'} ({r.service ?? '-'}) · 대여 {r.rent_start ?? '-'} ~ {r.rent_end ?? '-'} · 인수{' '}
              {r.acknowledged_at ? '완료' : '대기'}
            </p>

            <div className="mt-3 flex flex-wrap gap-2">
              {r.status === '배정' && !r.acknowledged_at && (
                <form action={ackAction}>
                  <input type="hidden" name="id" value={r.id} />
                  <Button variant="ghost">인수 확인 처리</Button>
                </form>
              )}
              <form action={resendMailAction}>
                <input type="hidden" name="id" value={r.id} />
                <Button variant="ghost">안내 메일 재발송</Button>
              </form>
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
                  ① 좌석에 로그인해 대화·메모리 삭제 → ② 팀 콘솔에서 좌석 제거(접속 차단)
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
    <Table
      head={['선택', '접수번호', '프로그램', '이름', '이메일', '희망', '계정', '상태', '대여기간', '발송', '인수']}
    >
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
          notified_at: string | null
          acknowledged_at: string | null
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
            <Td className="text-xs">{row.notified_at ? '○' : '-'}</Td>
            <Td className="text-xs">{row.acknowledged_at ? '○' : '-'}</Td>
          </tr>
        )
      })}
    </Table>
  )
}

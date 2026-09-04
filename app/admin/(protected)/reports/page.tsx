/** 실적 (PRD §7-2, §10, R29) */
import { db } from '@/lib/db'
import { programReport, summaryReport } from '@/lib/report'
import { Button, Card, Stat, Table, Td } from '@/components/ui'
import { L } from '@/lib/labels'
import { snapshotNowAction } from '@/app/admin/actions'

export const dynamic = 'force-dynamic'

export default async function ReportsPage() {
  const programs = await programReport()
  const s = await summaryReport()
  const { data: snapshots } = await db()
    .from('report_snapshots')
    .select('id, month, generated_at')
    .order('month', { ascending: false })

  return (
    <>
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-[var(--gnu-navy)]">{L.menu.reports}</h1>
        <form action={snapshotNowAction}>
          <Button>월간 스냅샷 지금 생성</Button>
        </form>
      </header>

      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label={`누계 사용 인원 / 목표 ${s.target_headcount}`} value={`${s.used_total}명`} />
        <Stat label="달성률(%)" value={s.achievement_rate} />
        <Stat label="평균 유휴율(%)" value={s.idle_rate ?? '-'} />
        <Stat label="평균 회전율(회)" value={s.turnover_avg} />
        <Stat label="현재 대기 인원" value={s.waiting_cnt} />
        <Stat label="평균 대기일수" value={s.waiting_days_avg ?? '-'} />
        <Stat label="미인수율(%)" value={s.no_ack_rate ?? '-'} />
        <Stat label="정지율(%)" value={s.suspension_rate} />
      </div>

      <Card
        title="요약"
        right={
          <a href="/api/admin/report?type=summary" className="text-xs text-blue-700">
            CSV 내려받기
          </a>
        }
      >
        <dl className="grid gap-3 text-sm sm:grid-cols-4">
          <Item label="교원" value={s.used_faculty} />
          <Item label="직원" value={s.used_staff} />
          <Item label="학생" value={s.used_student} />
          <Item label="지역민" value={s.used_local} />
          <Item label="GPT 사용" value={s.used_gpt} />
          <Item label="Claude 사용" value={s.used_claude} />
          <Item label="계정·월 환산" value={s.account_months} />
          <Item label="계정 합계" value={s.acc_total} />
          <Item label="가용" value={s.acc_available} />
          <Item label="배정" value={s.acc_assigned} />
          <Item label="회수중" value={s.acc_returning} />
          <Item label="정지/만료" value={`${s.acc_suspended} / ${s.acc_expired}`} />
        </dl>
      </Card>

      <Card
        title="프로그램별 실적"
        right={
          <a href="/api/admin/report?type=program" className="text-xs text-blue-700">
            CSV 내려받기
          </a>
        }
      >
        <Table
          head={[
            '프로그램', '대상', '신청', '승인', '배정', '사용 인원', '회수완료', 'GPT', 'Claude',
            '인수기한초과', '회수 완료율', '대기', '승인→배정(평균/최대)',
          ]}
        >
          {programs.map((p) => (
            <tr key={p.program_id}>
              <Td className="text-xs">{p.program_name}</Td>
              <Td className="text-xs">{p.target}</Td>
              <Td>{p.applied_cnt}</Td>
              <Td>{p.approved_cnt}</Td>
              <Td>{p.assigned_cnt}</Td>
              <Td className="font-semibold text-[var(--gnu-navy)]">{p.used_cnt}</Td>
              <Td>{p.returned_cnt}</Td>
              <Td>{p.used_gpt}</Td>
              <Td>{p.used_claude}</Td>
              <Td>{p.ack_overdue_cnt}</Td>
              <Td>{p.return_rate ?? '-'}</Td>
              <Td>{p.waiting_cnt}</Td>
              <Td className="text-xs">
                {p.wait_days_avg ?? '-'} / {p.wait_days_max ?? '-'}
              </Td>
            </tr>
          ))}
        </Table>
      </Card>

      <Card title="월별 스냅샷">
        <Table head={['월', '생성 시각', 'CSV']}>
          {(snapshots ?? []).map((s2) => (
            <tr key={s2.id}>
              <Td>{s2.month}</Td>
              <Td className="text-xs">{s2.generated_at?.slice(0, 16).replace('T', ' ')}</Td>
              <Td className="space-x-3 text-xs">
                <a href={`/api/admin/report?month=${s2.month}&type=program`} className="text-blue-700">
                  프로그램별
                </a>
                <a href={`/api/admin/report?month=${s2.month}&type=summary`} className="text-blue-700">
                  요약
                </a>
              </Td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  )
}

function Item({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-md bg-slate-50 p-3">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-1 font-semibold">{value}</dd>
    </div>
  )
}

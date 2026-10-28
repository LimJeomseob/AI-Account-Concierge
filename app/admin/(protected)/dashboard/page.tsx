/** 대시보드 (PRD §7-2) */
import Link from 'next/link'
import { db } from '@/lib/db'
import { nowKSTText, todayKST } from '@/lib/date'
import { lastOk } from '@/lib/lock'
import type { DailyError } from '@/lib/cron/daily'
import { getSettings } from '@/lib/settings'
import { listAlerts } from '@/lib/alerts'
import { suspensionRate } from '@/lib/ops/incidents'
import { Badge, Button, Card, Stat, Table, Td } from '@/components/ui'
import { runDailyAction } from '@/app/admin/actions'
import { supportStatus } from '@/lib/report'

export const dynamic = 'force-dynamic'

async function countBy(table: string, column: string, values: string[]): Promise<number> {
  const { count } = await db()
    .from(table)
    .select('id', { count: 'exact', head: true })
    .in(column, values)
  return count ?? 0
}

export default async function DashboardPage() {
  const today = todayKST()
  const s = await getSettings()

  const pendingApproval = await countBy('assignments', 'status', ['신청'])
  const waiting = await countBy('assignments', 'status', ['승인'])
  const inUse = await countBy('assignments', 'status', ['사용중'])
  const openIncidents = await countBy('incidents', 'status', ['접수', '처리중'])
  const mailPending = await countBy('mail_queue', 'status', ['pending'])
  const mailFailed = await countBy('mail_queue', 'status', ['failed'])

  // 유료계정 지원현황 — 서비스별 계약 수 대비 등록·사용 (설정 contract_gpt·contract_claude)
  const { data: accRows } = await db().from('accounts').select('service, status')
  const support = supportStatus(accRows ?? [], { GPT: s.contract_gpt, Claude: s.contract_claude })

  const alerts = await listAlerts()
  const rate = await suspensionRate()

  // 일일 작업 상태 (R32) — 마지막 실행 결과의 오류, 마지막 성공 시각
  const { data: lastRun } = await db()
    .from('logs')
    .select('at, detail')
    .eq('action', 'cron.daily.done')
    .order('at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const lastRunErrors = ((lastRun?.detail as { errors?: DailyError[] } | null)?.errors ?? []) as DailyError[]
  const lastOkAt = await lastOk('cron.daily')
  const { data: lastMail } = await db()
    .from('logs')
    .select('at, detail')
    .eq('action', 'mail.dispatch')
    .order('at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const mailStopped = (lastMail?.detail as { stopped?: string } | null)?.stopped
  const cronStale = lastOkAt !== null && Date.now() - lastOkAt > 26 * 60 * 60 * 1000

  return (
    <>
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-[var(--gnu-navy)]">오늘 할 일 ({today})</h1>
          <p className="text-sm text-slate-500">
            매일 09:00(KST) 자동 작업이 아래 항목을 처리합니다. 마지막 실행{' '}
            {lastRun ? nowKSTText(new Date(lastRun.at)) : '기록 없음'} · 마지막 성공{' '}
            {lastOkAt ? nowKSTText(new Date(lastOkAt)) : '기록 없음'}
          </p>
        </div>
        <div className="flex gap-2">
          <form action={runDailyAction}>
            <Button>일일 작업 지금 실행</Button>
          </form>
        </div>
      </header>

      {(mailStopped === 'auth' || mailStopped === 'limit') && (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {mailStopped === 'auth'
            ? '⚠ 마지막 메일 발송이 Gmail 인증 실패로 중단됐습니다. GMAIL_USER·GMAIL_APP_PASSWORD 환경변수를 확인해 주세요(설정 화면 「발신 테스트」).'
            : '⚠ 마지막 메일 발송이 Gmail 일일 한도로 중단됐습니다. 남은 메일은 다음 일일 작업에서 보냅니다.'}
        </div>
      )}

      {(lastRunErrors.length > 0 || cronStale) && (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {cronStale && <p>⚠ 일일 작업이 26시간 넘게 성공하지 못했습니다. Vercel Cron 설정·실행 로그를 확인해 주세요.</p>}
          {lastRunErrors.length > 0 && (
            <>
              <p>⚠ 마지막 일일 작업에서 {lastRunErrors.length}개 단계가 실패했습니다. 「일일 작업 지금 실행」으로 다시 시도할 수 있습니다.</p>
              <ul className="mt-1 list-disc pl-5 text-xs">
                {lastRunErrors.map((e) => (
                  <li key={e.step}>
                    [{e.step}] {e.message}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      <Card title="유료계정 지원현황">
        <Table head={['서비스', '계약', '등록(만료 제외)', '사용중', '회수중', '가용', '정지']}>
          {support.map((r) => (
            <tr key={r.service}>
              <Td>{r.label}</Td>
              <Td className="font-semibold">{r.contract}</Td>
              <Td className={r.registered !== r.contract ? 'font-semibold text-red-700' : ''}>
                {r.registered}
                {r.registered !== r.contract && ' (계약 수와 다름)'}
              </Td>
              <Td>{r.inUse}</Td>
              <Td>{r.returning}</Td>
              <Td>{r.available}</Td>
              <Td>{r.suspended}</Td>
            </tr>
          ))}
        </Table>
      </Card>

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label="승인 대기" value={pendingApproval} warn={pendingApproval > 0} />
        <Stat label="미배정(승인)" value={waiting} />
        <Stat label="사용중" value={inUse} />
        <Stat label="회수 대상" value={alerts.length} warn={alerts.length > 0} />
        <Stat label="장애 미처리" value={openIncidents} warn={openIncidents > 0} />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="정지율(%)" value={rate} />
        <Stat label="메일 대기" value={mailPending} />
        <Stat label="메일 실패" value={mailFailed} warn={mailFailed > 0} />
      </div>


      <Card
        title={`회수 대상 (${alerts.length})`}
        right={
          <Link href="/admin/assignments?status=회수중" className="text-xs text-blue-700">
            신청·배정에서 처리 →
          </Link>
        }
      >
        {alerts.length === 0 ? (
          <p className="text-sm text-slate-500">회수 대상이 없습니다.</p>
        ) : (
          <Table head={['구분', '계정ID', '로그인 이메일', '배정ID', '이름', '프로그램', '대여종료일', '경과', '조치']}>
            {alerts.map((a) => (
              <tr key={a.assignment_id}>
                <Td>{a.category}</Td>
                <Td>{a.account_id ?? '-'}</Td>
                <Td className="text-xs">{a.login_email ?? '-'}</Td>
                <Td className="text-xs">{a.assignment_id}</Td>
                <Td>{a.name}</Td>
                <Td className="text-xs">{a.program_name}</Td>
                <Td>{a.rent_end ?? '-'}</Td>
                <Td>D+{a.elapsed_days}</Td>
                <Td className="text-xs">{a.guide}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

    </>
  )
}

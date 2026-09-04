/** 인수 확인 페이지 (PRD R18, §7-1) */
import { acknowledge } from '@/lib/ops/assignments'
import { verifyAckToken } from '@/lib/token'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

type Search = Promise<{ id?: string; t?: string }>

export default async function AckPage({ searchParams }: { searchParams: Search }) {
  const { id, t } = await searchParams

  if (!id || !verifyAckToken(id, t)) {
    return <Result tone="error" title="링크가 올바르지 않습니다." desc="메일의 인수 확인 링크를 다시 확인해 주세요." />
  }

  const result = await acknowledge(id, 'public')

  if (result === 'ok') {
    const { data } = await db()
      .from('assignments')
      .select('rent_start, rent_end, account_id, service')
      .eq('id', id)
      .maybeSingle()
    return (
      <Result
        tone="ok"
        title="인수 확인이 완료되었습니다."
        desc={`접수번호 ${id} · ${data?.service ?? ''} ${data?.account_id ?? ''} · 대여기간 ${data?.rent_start ?? '-'} ~ ${data?.rent_end ?? '-'}`}
      />
    )
  }
  if (result === 'already') {
    return <Result tone="ok" title="이미 인수 확인이 처리되었습니다." desc={`접수번호 ${id}`} />
  }
  if (result === 'not-found') {
    return <Result tone="error" title="접수 내역을 찾을 수 없습니다." desc="AI융합원(055-772-4857)으로 문의해 주세요." />
  }
  return (
    <Result
      tone="warn"
      title="지금은 인수 확인을 할 수 없는 상태입니다."
      desc="배정이 취소되었거나 이미 종료된 건일 수 있습니다. AI융합원(055-772-4857)으로 문의해 주세요."
    />
  )
}

function Result({ tone, title, desc }: { tone: 'ok' | 'warn' | 'error'; title: string; desc: string }) {
  const color =
    tone === 'ok' ? 'text-green-700' : tone === 'warn' ? 'text-amber-700' : 'text-red-700'
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-3 p-8">
      <p className="text-sm text-slate-500">경상국립대학교 AI융합원</p>
      <h1 className={`text-xl font-bold ${color}`}>{title}</h1>
      <p className="text-sm text-slate-600">{desc}</p>
      <p className="mt-4 text-xs text-slate-400">
        첫 로그인 후 학습데이터 사용 설정을 끄고, 대여 종료일까지 산출물을 백업해 주세요.
      </p>
    </main>
  )
}

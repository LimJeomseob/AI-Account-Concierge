/** 장애 신고 페이지 (PRD R26, §7-1) */
import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { reportIncident } from '@/lib/ops/incidents'
import { verifyIncidentToken } from '@/lib/token'
import type { IncidentType } from '@/lib/types'

export const dynamic = 'force-dynamic'

type Search = Promise<{ id?: string; t?: string; done?: string }>

async function submit(formData: FormData) {
  'use server'
  const id = String(formData.get('id') ?? '')
  const t = String(formData.get('t') ?? '')
  if (!id || !verifyIncidentToken(id, t)) throw new Error('링크가 올바르지 않습니다.')

  const type = String(formData.get('type') ?? '기타') as IncidentType
  const symptom = String(formData.get('symptom') ?? '').slice(0, 1000)
  await reportIncident({ assignmentId: id, type, symptom })
  redirect(`/incident?id=${encodeURIComponent(id)}&t=${t}&done=1`)
}

export default async function IncidentPage({ searchParams }: { searchParams: Search }) {
  const { id, t, done } = await searchParams

  if (!id || !verifyIncidentToken(id, t)) {
    return (
      <Shell title="링크가 올바르지 않습니다.">
        <p className="text-sm text-slate-600">메일의 장애 신고 링크를 다시 확인해 주세요.</p>
      </Shell>
    )
  }

  if (done) {
    return (
      <Shell title="장애 신고가 접수되었습니다.">
        <p className="text-sm text-slate-600">
          접수번호 {id} · 담당자가 확인 후 대체 계정을 안내드립니다. (문의 055-772-4857)
        </p>
      </Shell>
    )
  }

  const { data: a } = await db()
    .from('assignments')
    .select('id, name, account_id, service')
    .eq('id', id)
    .maybeSingle()

  return (
    <Shell title="AI 유료계정 장애 신고">
      <p className="text-sm text-slate-600">
        접수번호 {id}
        {a?.account_id ? ` · 계정 ${a.account_id} (${a.service ?? ''})` : ''}
      </p>
      <form action={submit} className="mt-4 space-y-4">
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="t" value={t} />
        <div>
          <label className="block text-sm font-medium">유형</label>
          <select name="type" className="mt-1 w-full rounded-md border border-slate-300 p-2 text-sm">
            <option value="정지">계정 정지</option>
            <option value="로그인불가">로그인 불가</option>
            <option value="기타">기타</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium">증상</label>
          <textarea
            name="symptom"
            rows={5}
            required
            placeholder="발생 시각, 화면에 표시된 메시지 등을 적어 주세요."
            className="mt-1 w-full rounded-md border border-slate-300 p-2 text-sm"
          />
        </div>
        <button className="rounded-md bg-[var(--gnu-navy)] px-4 py-2 text-sm font-medium text-white">
          신고하기
        </button>
      </form>
    </Shell>
  )
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-lg p-8">
      <p className="text-sm text-slate-500">경상국립대학교 AI융합원</p>
      <h1 className="mt-1 text-xl font-bold text-[var(--gnu-navy)]">{title}</h1>
      <div className="mt-3">{children}</div>
    </main>
  )
}

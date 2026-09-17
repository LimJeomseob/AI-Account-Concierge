/** 자체 신청 페이지 (PRD §7-1 /apply — GitHub Pages 장애 시 대체) */
import ApplyForm from './ApplyForm'
import { db } from '@/lib/db'
import { applyAvailability } from '@/lib/assign'
import { todayKST } from '@/lib/date'
import { getSettings } from '@/lib/settings'
import type { Program } from '@/lib/types'

export const dynamic = 'force-dynamic'

export default async function ApplyPage() {
  const today = todayKST()
  const s = await getSettings()
  const { data } = await db().from('programs').select('*').order('id')
  // R3: 프로그램 상태(시작전·진행중·완료) ↔ 드롭다운 표시는 applyAvailability 가 결정
  const programs = ((data ?? []) as Program[]).map((p) => {
    const a = applyAvailability(p, today)
    return { id: p.id, name: p.name, open: a.open, label: a.label, period: a.period }
  })

  return (
    <main className="mx-auto max-w-2xl p-6">
      <p className="text-sm text-slate-500">경상국립대학교 AI융합원</p>
      <h1 className="mt-1 text-2xl font-bold text-[var(--gnu-navy)]">AI 유료계정 신청</h1>
      <ApplyForm
        programs={programs}
        eduUrl={s.edu_url}
        privacy={{ items: s.privacy_items, purpose: s.privacy_purpose, period: s.privacy_period }}
        ackDueDays={s.ack_due_days}
      />
    </main>
  )
}

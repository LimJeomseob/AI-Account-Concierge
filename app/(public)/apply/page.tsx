/** 자체 신청 페이지 (PRD §7-1 /apply — GitHub Pages 장애 시 대체) */
import ApplyForm from './ApplyForm'
import { db } from '@/lib/db'
import { applyAvailability } from '@/lib/assign'
import { getSettings } from '@/lib/settings'
import type { Program } from '@/lib/types'

export const dynamic = 'force-dynamic'

export default async function ApplyPage() {
  const s = await getSettings()
  const { data } = await db().from('programs').select('id, name, status').order('id')
  // R3: 프로그램 상태(시작전·진행중·진행완료) ↔ 드롭다운 표시는 applyAvailability 가 결정 — 접수 검증과 같은 함수
  const programs = ((data ?? []) as Pick<Program, 'id' | 'name' | 'status'>[]).map((p) => {
    const a = applyAvailability(p)
    return { id: p.id, name: p.name, open: a.open, label: a.label, period: a.period }
  })

  return (
    <>
      <h1 className="text-3xl font-bold">AI 유료계정 신청</h1>
      <ApplyForm
        programs={programs}
        eduUrl={s.edu_url}
        privacy={{ items: s.privacy_items, purpose: s.privacy_purpose, period: s.privacy_period }}
      />
    </>
  )
}

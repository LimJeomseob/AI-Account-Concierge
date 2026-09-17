'use client'

/**
 * 프로그램 상태 드롭다운 (PRD §4-1: 시작전 → 진행중 → 완료)
 * 값을 바꾸면 곧바로 programStatusAction 으로 저장한다. 모든 전환은 관리자 수동.
 */
import { useTransition } from 'react'
import { programStatusAction } from '@/app/admin/actions'
import { STATUS_BADGE } from '@/lib/labels'
import type { ProgramStatus } from '@/lib/types'

export const PROGRAM_STATUSES: ProgramStatus[] = ['시작전', '진행중', '완료']

export default function StatusSelect({ id, value }: { id: string; value: ProgramStatus }) {
  const [pending, start] = useTransition()
  const color = STATUS_BADGE[value] ?? 'bg-slate-100 text-slate-700 border-slate-200'

  return (
    <select
      value={value}
      disabled={pending}
      aria-label="프로그램 상태"
      onChange={(e) => {
        const fd = new FormData()
        fd.set('id', id)
        fd.set('status', e.target.value)
        start(() => programStatusAction(fd))
      }}
      className={`rounded-full border px-2 py-0.5 text-xs font-medium disabled:opacity-50 ${color}`}
    >
      {PROGRAM_STATUSES.map((s) => (
        <option key={s} value={s}>
          {s}
        </option>
      ))}
    </select>
  )
}

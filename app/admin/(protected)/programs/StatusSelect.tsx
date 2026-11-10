'use client'

/**
 * 프로그램 상태 드롭다운 (PRD §4-1: 시작전 → 진행중 → 진행완료)
 * 값을 바꾸면 곧바로 programStatusAction 으로 저장한다. 모든 전환은 관리자 수동.
 * 진행완료로 바꿀 때 사용중 건이 있으면 확인창으로 「함께 회수 시작」 여부를 묻는다(2026-11-10).
 */
import { useState, useTransition } from 'react'
import { programStatusAction } from '@/app/admin/actions'
import { PROGRAM_STATUSES, PROGRAM_STATUS_LABEL, STATUS_BADGE } from '@/lib/labels'
import type { ProgramStatus } from '@/lib/types'

export default function StatusSelect({
  id,
  name,
  value,
  inUse,
}: {
  id: string
  name: string
  value: ProgramStatus
  /** 이 프로그램의 배정·사용중 건 수 */
  inUse: number
}) {
  const [pending, start] = useTransition()
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const color = STATUS_BADGE[value] ?? 'bg-slate-100 text-slate-700 border-slate-200'

  return (
    <div>
      <select
        value={value}
        disabled={pending}
        aria-label="프로그램 상태"
        onChange={(e) => {
          const next = e.target.value as ProgramStatus
          const fd = new FormData()
          fd.set('id', id)
          fd.set('status', next)
          if (next === '완료' && inUse > 0) {
            const withReturns = window.confirm(
              `「${name}」을(를) 진행완료로 바꿉니다.\n\n` +
                `이 프로그램의 사용중 ${inUse}건도 함께 회수 시작(회수중)할까요?\n` +
                `· 확인: 함께 회수 시작 — 사용현황에서 체크 2개 후 회수 완료\n` +
                `· 취소: 상태만 진행완료로 바꾸고 좌석은 그대로 둠`,
            )
            if (withReturns) fd.set('startReturns', 'true')
          }
          setResult(null)
          start(async () => setResult(await programStatusAction(fd)))
        }}
        className={`rounded-full border px-2 py-0.5 text-xs font-medium disabled:opacity-50 ${color}`}
      >
        {PROGRAM_STATUSES.map((s) => (
          <option key={s} value={s}>
            {PROGRAM_STATUS_LABEL[s]}
          </option>
        ))}
      </select>
      {result && (
        <p className={`mt-1 max-w-xs text-xs ${result.ok ? 'text-green-700' : 'text-red-700'}`}>{result.msg}</p>
      )}
    </div>
  )
}

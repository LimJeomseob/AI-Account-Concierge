'use client'

/**
 * 프로그램 등록·수정 폼 (PRD §7-2, R1)
 * - 입력은 프로그램명·상태·비고뿐이다(2026-11-10). 상태 하나로 신청·배정이 정해진다.
 * - 프로그램ID 드롭다운: 기본은 「새 프로그램」(저장 시 자동 채번). 기존 프로그램을 고르면 값이 채워진다.
 * - 결과·오류는 화면 안에 표시한다(오류 페이지로 넘어가지 않게).
 */
import { useState, useTransition } from 'react'
import { programSaveAction } from '@/app/admin/actions'
import { Button, inputClass } from '@/components/ui'
import { L, PROGRAM_STATUSES, PROGRAM_STATUS_HELP, PROGRAM_STATUS_LABEL } from '@/lib/labels'
import type { Program, ProgramStatus } from '@/lib/types'

interface FormValues {
  name: string
  status: ProgramStatus
  note: string
}

const EMPTY: FormValues = { name: '', status: '시작전', note: '' }

function fromProgram(p: Program): FormValues {
  return { name: p.name, status: p.status, note: p.note ?? '' }
}

export default function ProgramForm({ programs }: { programs: Program[] }) {
  const [id, setId] = useState('')
  const [v, setV] = useState<FormValues>(EMPTY)
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const [pending, start] = useTransition()

  function pick(nextId: string) {
    setId(nextId)
    setResult(null)
    const p = programs.find((x) => x.id === nextId)
    setV(p ? fromProgram(p) : EMPTY)
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-600">
        기존 프로그램을 고르면 값이 채워집니다. 새 프로그램은 저장할 때 ID 가 자동으로 붙습니다.
        진행완료로 바꿀 때 사용중 좌석을 함께 회수하려면 위 목록의 상태 드롭다운을 쓰세요.
      </p>
      <form
        className="grid gap-3 sm:grid-cols-3"
        onSubmit={(e) => {
          e.preventDefault()
          const fd = new FormData()
          fd.set('id', id)
          fd.set('name', v.name)
          fd.set('status', v.status)
          fd.set('note', v.note)
          setResult(null)
          start(async () => {
            const r = await programSaveAction(fd)
            setResult(r)
            // 신규 등록이면 방금 채번된 ID 로 옮겨 이어서 수정할 수 있게 한다
            if (r.ok && r.id && !id) setId(r.id)
          })
        }}
      >
        <label className="text-sm">
          <span className="text-xs text-slate-600">{L.program.id}</span>
          <select value={id} onChange={(e) => pick(e.target.value)} className={inputClass}>
            <option value="">새 프로그램 (저장 시 ID 자동 채번)</option>
            {programs.map((p) => (
              <option key={p.id} value={p.id}>
                {`${p.id} · ${p.name}`}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm sm:col-span-2">
          <span className="text-xs text-slate-600">{L.program.name} *</span>
          <input
            value={v.name}
            onChange={(e) => setV((s) => ({ ...s, name: e.target.value }))}
            required
            className={inputClass}
          />
        </label>
        <label className="text-sm">
          <span className="text-xs text-slate-600">{L.program.status}</span>
          <select
            value={v.status}
            onChange={(e) => setV((s) => ({ ...s, status: e.target.value as ProgramStatus }))}
            className={inputClass}
          >
            {PROGRAM_STATUSES.map((s) => (
              <option key={s} value={s}>
                {PROGRAM_STATUS_LABEL[s]}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-xs text-slate-500">{PROGRAM_STATUS_HELP[v.status]}</span>
        </label>
        <label className="text-sm sm:col-span-2">
          <span className="text-xs text-slate-600">비고</span>
          <input
            value={v.note}
            onChange={(e) => setV((s) => ({ ...s, note: e.target.value }))}
            className={inputClass}
          />
        </label>
        <div className="flex items-center gap-3 sm:col-span-3">
          <Button disabled={pending}>{pending ? '저장 중…' : id ? `${id} 수정 저장` : '새 프로그램 등록'}</Button>
          {result && (
            <span className={`text-sm ${result.ok ? 'text-green-700' : 'text-red-700'}`}>{result.msg}</span>
          )}
        </div>
      </form>
    </div>
  )
}

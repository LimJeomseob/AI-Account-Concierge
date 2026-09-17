'use client'

/**
 * 프로그램 등록·수정 폼 (PRD §7-2, R1)
 * - 프로그램ID 드롭다운: 기본은 「새 프로그램」(저장 시 자동 채번). 기존 프로그램을 고르면 값이 채워진다.
 * - 결과·오류는 화면 안에 표시한다(오류 페이지로 넘어가지 않게).
 */
import { useState, useTransition } from 'react'
import { programSaveAction } from '@/app/admin/actions'
import { Button, inputClass } from '@/components/ui'
import { L, PROGRAM_STATUSES } from '@/lib/labels'
import type { Program } from '@/lib/types'

interface FormValues {
  name: string
  target: string
  mode: string
  days: string
  start_on: string
  end_on: string
  cap: string
  status: string
  note: string
}

const EMPTY: FormValues = {
  name: '',
  target: '혼합',
  mode: '고정기간',
  days: '0',
  start_on: '',
  end_on: '',
  cap: '0',
  status: '시작전',
  note: '',
}

function fromProgram(p: Program): FormValues {
  return {
    name: p.name,
    target: p.target,
    mode: p.mode,
    days: String(p.days ?? 0),
    start_on: p.start_on ?? '',
    end_on: p.end_on ?? '',
    cap: String(p.cap ?? 0),
    status: p.status,
    note: p.note ?? '',
  }
}

export default function ProgramForm({ programs }: { programs: Program[] }) {
  const [id, setId] = useState('')
  const [v, setV] = useState<FormValues>(EMPTY)
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const [pending, start] = useTransition()

  const set = (k: keyof FormValues) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setV((s) => ({ ...s, [k]: e.target.value }))

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
      </p>
      <form
        className="grid gap-3 sm:grid-cols-3"
        onSubmit={(e) => {
          e.preventDefault()
          const fd = new FormData()
          fd.set('id', id)
          for (const [k, val] of Object.entries(v)) fd.set(k, val)
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
          <input value={v.name} onChange={set('name')} required className={inputClass} />
        </label>
        <label className="text-sm">
          <span className="text-xs text-slate-600">{L.program.target}</span>
          <select value={v.target} onChange={set('target')} className={inputClass}>
            <option>혼합</option>
            <option>교원</option>
            <option>직원</option>
            <option>학생</option>
            <option>지역민</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="text-xs text-slate-600">{L.program.mode}</span>
          <select value={v.mode} onChange={set('mode')} className={inputClass}>
            <option>고정기간</option>
            <option>배정일기준</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="text-xs text-slate-600">{L.program.days} (배정일기준)</span>
          <input value={v.days} onChange={set('days')} type="number" min={0} className={inputClass} />
        </label>
        <label className="text-sm">
          <span className="text-xs text-slate-600">{L.program.start_on}</span>
          <input value={v.start_on} onChange={set('start_on')} type="date" className={inputClass} />
        </label>
        <label className="text-sm">
          <span className="text-xs text-slate-600">{L.program.end_on}</span>
          <input value={v.end_on} onChange={set('end_on')} type="date" className={inputClass} />
        </label>
        <label className="text-sm">
          <span className="text-xs text-slate-600">{L.program.cap} (0=무제한)</span>
          <input value={v.cap} onChange={set('cap')} type="number" min={0} className={inputClass} />
        </label>
        <label className="text-sm">
          <span className="text-xs text-slate-600">{L.program.status}</span>
          <select value={v.status} onChange={set('status')} className={inputClass}>
            {PROGRAM_STATUSES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label className="text-sm sm:col-span-2">
          <span className="text-xs text-slate-600">비고</span>
          <input value={v.note} onChange={set('note')} className={inputClass} />
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

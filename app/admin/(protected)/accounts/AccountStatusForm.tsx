'use client'

/**
 * 계정 상태 수동 변경 (PRD §5-2)
 * - 계정ID·상태 모두 드롭다운
 * - 상태 목록은 선택한 계정의 현재 상태에서 갈 수 있는 값만 보여 준다
 * - 결과·오류는 화면 안에 표시한다 (오류 페이지로 넘어가지 않게)
 */
import { useState, useTransition } from 'react'
import { accountStatusAction } from '@/app/admin/actions'
import { Button, inputClass } from '@/components/ui'
import { L } from '@/lib/labels'
import { accountStatusOptions } from '@/lib/transitions'
import type { AccountStatus } from '@/lib/types'

export interface AccountOption {
  id: string
  service: string
  kind: string
  status: AccountStatus
}

export default function AccountStatusForm({ accounts }: { accounts: AccountOption[] }) {
  const [id, setId] = useState('')
  const [status, setStatus] = useState<string>('')
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const [pending, start] = useTransition()

  const selected = accounts.find((a) => a.id === id)
  const options = selected ? accountStatusOptions(selected.status) : []

  return (
    <div className="space-y-2">
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          const fd = new FormData()
          fd.set('id', id)
          fd.set('status', status)
          setResult(null)
          start(async () => setResult(await accountStatusAction(fd)))
        }}
      >
        <label className="text-sm">
          <span className="text-xs text-slate-600">{L.account.id}</span>
          <select
            required
            value={id}
            onChange={(e) => {
              setId(e.target.value)
              setStatus('')
              setResult(null)
            }}
            className={inputClass}
          >
            <option value="" disabled>
              계정을 선택하세요
            </option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {`${a.id} · ${a.service} · ${a.kind} · 현재 ${a.status}`}
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm">
          <span className="text-xs text-slate-600">{L.account.status}</span>
          <select
            required
            value={status}
            disabled={!selected}
            onChange={(e) => setStatus(e.target.value)}
            className={inputClass}
          >
            <option value="" disabled>
              {selected ? '바꿀 상태' : '계정을 먼저 선택'}
            </option>
            {options.map((s) => (
              <option key={s} value={s}>
                {s === selected?.status ? `${s} (현재)` : s}
              </option>
            ))}
          </select>
        </label>

        <Button variant="ghost" disabled={pending || !id || !status}>
          {pending ? '변경 중…' : '변경'}
        </Button>
      </form>

      {result && (
        <p className={`text-sm ${result.ok ? 'text-green-700' : 'text-red-700'}`}>{result.msg}</p>
      )}
      <p className="text-xs text-slate-500">
        허용 전이 — 가용→배정·정지·만료 / 배정→회수중·정지·만료 / 회수중→가용·정지·만료 / 정지→가용·회수중·만료 /
        만료→가용
      </p>
    </div>
  )
}

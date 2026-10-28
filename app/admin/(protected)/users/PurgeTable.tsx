'use client'

/**
 * 개인정보 파기 (R30)
 * - 「선택 파기」는 체크한 사용자만. 선택이 없으면 서버가 거부하고 메시지를 띄운다.
 * - 「전체 파기」는 별도 버튼 + 확인 문구 입력. 되돌릴 수 없어 두 단계로 막는다.
 */
import { useState, useTransition } from 'react'
import { purgeAction, purgeAllAction } from '@/app/admin/actions'
import { Button, Table, Td, inputClass } from '@/components/ui'
import { PURGE_ALL_CONFIRM } from '@/lib/labels'

export interface UserRow {
  id: string
  name: string
  type: string
  affiliation: string | null
  email: string
  phone: string | null
  privacy_consented_at: string | null
  first_applied_at: string | null
  purged_at: string | null
}

export default function PurgeTable({ users, privacyPeriod }: { users: UserRow[]; privacyPeriod: string }) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirm, setConfirm] = useState('')
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const [pending, start] = useTransition()
  const candidates = users.filter((u) => !u.purged_at).length

  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">
        보유기간: {privacyPeriod} · 파기 시 이름·이메일·연락처가 「(파기)」로 바뀌며 실적 수치는 유지됩니다. 파기는 되돌릴 수 없습니다.
      </p>
      <Table head={['선택', '사용자ID', '이름', '구분', '소속', '이메일', '연락처', '동의일시', '최초신청', '파기']}>
        {users.map((u) => (
          <tr key={u.id}>
            <Td>
              <input
                type="checkbox"
                checked={selected.has(u.id)}
                disabled={!!u.purged_at || pending}
                onChange={(e) => toggle(u.id, e.target.checked)}
              />
            </Td>
            <Td className="text-xs">{u.id}</Td>
            <Td>{u.name}</Td>
            <Td className="text-xs">{u.type}</Td>
            <Td className="text-xs">{u.affiliation ?? '-'}</Td>
            <Td className="text-xs">{u.email}</Td>
            <Td className="text-xs">{u.phone ?? '-'}</Td>
            <Td className="text-xs">{u.privacy_consented_at?.slice(0, 10) ?? '-'}</Td>
            <Td className="text-xs">{u.first_applied_at?.slice(0, 10) ?? '-'}</Td>
            <Td className="text-xs">{u.purged_at ? u.purged_at.slice(0, 10) : '-'}</Td>
          </tr>
        ))}
      </Table>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="danger"
          disabled={pending || selected.size === 0}
          onClick={() => {
            if (!window.confirm(`선택한 ${selected.size}명의 개인정보를 파기합니다. 되돌릴 수 없습니다. 계속할까요?`)) return
            const fd = new FormData()
            for (const id of selected) fd.append('ids', id)
            setResult(null)
            start(async () => {
              const r = await purgeAction(fd)
              setResult(r)
              if (r.ok) setSelected(new Set())
            })
          }}
        >
          {pending ? '처리 중…' : `선택 ${selected.size}명 파기`}
        </Button>
      </div>

      <details className="rounded-md border border-red-200 bg-red-50 p-3">
        <summary className="cursor-pointer text-xs font-medium text-red-800">
          미파기 사용자 전체 파기 ({candidates}명) — 사업 종료 후 보유기간 만료 시에만
        </summary>
        <div className="mt-2 flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="text-xs text-red-800">확인을 위해 「{PURGE_ALL_CONFIRM}」 를 입력</span>
            <input value={confirm} onChange={(e) => setConfirm(e.target.value)} className={inputClass} autoComplete="off" />
          </label>
          <Button
            variant="danger"
            disabled={pending || confirm.trim() !== PURGE_ALL_CONFIRM || candidates === 0}
            onClick={() => {
              if (!window.confirm(`미파기 사용자 ${candidates}명 전체의 개인정보를 파기합니다. 되돌릴 수 없습니다. 계속할까요?`)) return
              const fd = new FormData()
              fd.set('confirm', confirm)
              setResult(null)
              start(async () => {
                const r = await purgeAllAction(fd)
                setResult(r)
                if (r.ok) setConfirm('')
              })
            }}
          >
            전체 파기 실행
          </Button>
        </div>
      </details>

      {result && <p className={`text-xs ${result.ok ? 'text-green-700' : 'text-red-700'}`}>{result.msg}</p>}
    </div>
  )
}

'use client'

/**
 * 「선택 승인 + 배정 + 이메일 내려받기」 (유료계정 사용현황, 2026-10-29)
 * 같은 <form> 안에서 체크한 「신청」 건(name="ids")을 승인(R13)하고 바로 계정을 배정(R12·R14)한 뒤,
 * 고른 사람의 이름·이메일·계정번호 CSV 를 내려받는다. 관리자는 이 이메일을 팀 워크스페이스에 초대한다.
 */
import { useState, useTransition } from 'react'
import { approveAssignExportAction } from '@/app/admin/actions'
import { Button } from '@/components/ui'

export default function ApproveAssignButton() {
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const [pending, start] = useTransition()

  return (
    <>
      <Button
        type="button"
        disabled={pending}
        onClick={(e) => {
          const form = e.currentTarget.form
          if (!form) return
          const fd = new FormData(form)
          const n = fd.getAll('ids').length
          if (n === 0) {
            setResult({ ok: false, msg: '목록에서 「신청」 건을 하나 이상 선택해 주세요.' })
            return
          }
          if (!window.confirm(`선택한 ${n}건을 승인하고 바로 계정을 배정한 뒤 이메일 명단을 내려받습니다. 계속할까요?`)) return
          setResult(null)
          start(async () => {
            const r = await approveAssignExportAction(fd)
            setResult({ ok: r.ok, msg: r.msg })
            if (r.ok && r.csv && r.filename) {
              const url = URL.createObjectURL(new Blob([r.csv], { type: 'text/csv;charset=utf-8' }))
              const a = document.createElement('a')
              a.href = url
              a.download = r.filename
              a.click()
              URL.revokeObjectURL(url)
            }
          })
        }}
      >
        {pending ? '처리 중…' : '선택 승인 + 배정 + 이메일 내려받기'}
      </Button>
      {result && (
        <span role="status" className={`text-xs ${result.ok ? 'text-green-700' : 'text-red-700'}`}>
          {result.msg}
        </span>
      )}
    </>
  )
}

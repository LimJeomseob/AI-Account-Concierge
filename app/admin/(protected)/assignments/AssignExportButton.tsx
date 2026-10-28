'use client'

/**
 * 「승인 건 배정 + 메일 내려받기」 (R14, 2026-10-29)
 * 현재 필터(프로그램·검색어)에 걸린 「승인」 건에 계정을 배정하고, 방금 배정된 사람의
 * 이름·이메일·계정번호 CSV 를 내려받는다. 관리자는 이 이메일을 팀 워크스페이스에 초대한다.
 */
import { useState, useTransition } from 'react'
import { assignExportAction } from '@/app/admin/actions'
import { Button } from '@/components/ui'

export default function AssignExportButton({ program, q }: { program?: string; q?: string }) {
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const [pending, start] = useTransition()

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        disabled={pending}
        onClick={() => {
          if (!window.confirm('현재 목록의 「승인」 건에 계정을 배정하고 이메일 명단을 내려받습니다. 계속할까요?')) return
          const fd = new FormData()
          if (program) fd.set('program', program)
          if (q) fd.set('q', q)
          setResult(null)
          start(async () => {
            const r = await assignExportAction(fd)
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
        {pending ? '배정 중…' : '승인 건 배정 + 메일 내려받기'}
      </Button>
      {result && <span className={`text-xs ${result.ok ? 'text-green-700' : 'text-red-700'}`}>{result.msg}</span>}
    </div>
  )
}

'use client'

/**
 * 발신 테스트 메일 (Gmail SMTP)
 * 인증 실패·한도 초과 같은 SMTP 오류를 화면 안에 표시한다(오류 페이지로 넘어가지 않게).
 */
import { useState, useTransition } from 'react'
import { testMailAction } from '@/app/admin/actions'
import { Button, inputClass } from '@/components/ui'

export default function TestMailForm() {
  const [to, setTo] = useState('')
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const [pending, start] = useTransition()

  return (
    <div>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          const fd = new FormData()
          fd.set('to', to)
          setResult(null)
          start(async () => setResult(await testMailAction(fd)))
        }}
      >
        <label className="text-sm">
          <span className="text-xs text-slate-600">받는 주소 (비우면 본인)</span>
          <input name="to" type="email" value={to} onChange={(e) => setTo(e.target.value)} className={inputClass} />
        </label>
        <Button variant="ghost" disabled={pending}>
          {pending ? '발송 중…' : '테스트 발송'}
        </Button>
      </form>
      {result && (
        <p className={`mt-2 text-xs break-all ${result.ok ? 'text-green-700' : 'text-red-700'}`}>{result.msg}</p>
      )}
    </div>
  )
}

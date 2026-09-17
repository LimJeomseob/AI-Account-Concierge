'use client'

/**
 * 좌석 접속 링크 등록·수정 (PRD R14-2)
 * 링크가 없는 좌석은 배정되지 않으므로 목록에서 바로 고칠 수 있어야 한다.
 * 형식 오류는 화면 안에 표시한다(오류 페이지로 넘어가지 않게).
 */
import { useState, useTransition } from 'react'
import { accountAccessUrlAction } from '@/app/admin/actions'
import { Button } from '@/components/ui'

export default function AccessUrlForm({ id, value }: { id: string; value: string | null }) {
  const [url, setUrl] = useState(value ?? '')
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const [pending, start] = useTransition()

  return (
    <div>
      <form
        className="flex items-center gap-1"
        onSubmit={(e) => {
          e.preventDefault()
          const fd = new FormData()
          fd.set('id', id)
          fd.set('access_url', url)
          setResult(null)
          start(async () => setResult(await accountAccessUrlAction(fd)))
        }}
      >
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://…"
          aria-label={`${id} 접속 링크`}
          className="w-52 rounded-md border border-slate-300 px-2 py-1 text-xs"
        />
        <Button variant="ghost" disabled={pending}>
          {pending ? '저장 중…' : '링크 저장'}
        </Button>
      </form>
      {result && (
        <p className={`mt-1 text-xs ${result.ok ? 'text-green-700' : 'text-red-700'}`}>{result.msg}</p>
      )}
    </div>
  )
}

'use client'

/** 안내문·이메일 목록 등 짧은 값을 클립보드에 복사하는 버튼 — 관리자가 신청자에게 직접 전달할 때 쓴다 */
import { useState } from 'react'

export default function CopyButton({ value, label = '복사' }: { value: string; label?: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value)
          setDone(true)
          setTimeout(() => setDone(false), 1500)
        } catch {
          window.prompt('아래 값을 복사해 주세요.', value)
        }
      }}
      className="rounded-md border border-slate-300 bg-white px-2 py-1 text-[13px] text-slate-700 hover:bg-slate-50"
    >
      {done ? '복사됨 ✓' : label}
    </button>
  )
}

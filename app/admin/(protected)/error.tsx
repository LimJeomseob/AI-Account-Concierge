'use client'

/** 관리자 화면 오류 경계 — 서버 오류가 나도 메뉴를 유지하고 다시 시도·대시보드 이동을 제공한다 */
import Link from 'next/link'
import { useEffect } from 'react'

export default function AdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[admin] 화면 오류', error.digest ?? '', error.message)
  }, [error])

  return (
    <div className="rounded-md border border-red-200 bg-red-50 p-6 text-sm text-red-800">
      <p className="font-semibold">이 화면을 불러오는 중 오류가 발생했습니다.</p>
      <p className="mt-2 text-red-700">
        잠시 후 다시 시도해 주세요. 계속되면 오류 번호를 담당자에게 알려 주세요{error.digest ? ` (오류 번호 ${error.digest})` : ''}.
      </p>
      <div className="mt-4 flex gap-2">
        <button type="button" onClick={reset} className="rounded-md bg-gnu-navy px-4 py-2 font-semibold text-white">
          다시 시도
        </button>
        <Link href="/admin/dashboard" className="rounded-md border border-slate-300 bg-white px-4 py-2 text-slate-700">
          대시보드로
        </Link>
      </div>
    </div>
  )
}

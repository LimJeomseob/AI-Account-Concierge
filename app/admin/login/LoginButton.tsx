'use client'

import { useState } from 'react'
import { browserAuth } from '@/lib/supabase-browser'

export default function LoginButton({ hint }: { hint?: string | null }) {
  const [busy, setBusy] = useState(false)

  async function signIn() {
    setBusy(true)
    const supabase = browserAuth()
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=/admin/dashboard`,
        // 지난번 관리자 계정을 Google 에 알려 계정 선택 화면을 건너뛴다 (lib/redirect.ts LOGIN_HINT_COOKIE)
        ...(hint ? { queryParams: { login_hint: hint } } : {}),
      },
    })
  }

  return (
    <button
      onClick={signIn}
      disabled={busy}
      className="w-full rounded-md bg-gnu-navy px-6 py-3 text-base font-semibold text-white transition hover:bg-gnu-navy-dark focus-visible:ring-2 focus-visible:ring-gnu-blue/40 disabled:opacity-50"
    >
      {busy ? '이동 중…' : 'Google 계정으로 로그인'}
    </button>
  )
}

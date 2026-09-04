'use client'

import { useState } from 'react'
import { browserAuth } from '@/lib/supabase-browser'

export default function LoginButton() {
  const [busy, setBusy] = useState(false)

  async function signIn() {
    setBusy(true)
    const supabase = browserAuth()
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback?next=/admin` },
    })
  }

  return (
    <button
      onClick={signIn}
      disabled={busy}
      className="rounded-md bg-[var(--gnu-navy)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
    >
      {busy ? '이동 중…' : 'Google 계정으로 로그인'}
    </button>
  )
}

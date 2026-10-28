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
      className="w-full rounded-md bg-gnu-navy px-6 py-3 text-base font-semibold text-white transition hover:bg-gnu-navy-dark focus-visible:ring-2 focus-visible:ring-gnu-blue/40 disabled:opacity-50"
    >
      {busy ? '이동 중…' : 'Google 계정으로 로그인'}
    </button>
  )
}

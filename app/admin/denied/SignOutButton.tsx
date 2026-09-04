'use client'

import { browserAuth } from '@/lib/supabase-browser'

export default function SignOutButton() {
  return (
    <button
      onClick={async () => {
        await browserAuth().auth.signOut()
        window.location.href = '/admin/login'
      }}
      className="w-fit rounded-md border border-slate-300 px-4 py-2 text-sm"
    >
      다른 계정으로 로그인
    </button>
  )
}

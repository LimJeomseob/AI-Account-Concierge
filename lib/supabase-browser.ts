'use client'

/** 브라우저용 Supabase Auth 클라이언트 (로그인 전용 — 데이터 접근 불가, RLS 전면 거부) */
import { createBrowserClient } from '@supabase/ssr'

export function browserAuth() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )
}

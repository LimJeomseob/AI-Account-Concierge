/**
 * Supabase Auth 세션 쿠키 갱신 (PRD §13)
 * 권한 판정(admins 허용 목록)은 서버 컴포넌트·Server Action 에서 다시 확인한다.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { AUTH_COOKIE_NAME } from '@/lib/auth-cookie'

export async function middleware(req: NextRequest) {
  let res = NextResponse.next({ request: req })

  // 서버에서는 내부망 주소로 접근한다 (Docker: http://kong:8000).
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) return res

  const supabase = createServerClient(url, key, {
    cookieOptions: { name: AUTH_COOKIE_NAME },
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value } of list) req.cookies.set(name, value)
        res = NextResponse.next({ request: req })
        for (const { name, value, options } of list) res.cookies.set(name, value, options)
      },
    },
  })
  // 세션 쿠키 갱신. Supabase 에 닿지 못해도 요청을 막지 않는다.
  try {
    await supabase.auth.getUser()
  } catch {
    // 무시 — 권한 판정은 서버 컴포넌트에서 다시 한다.
  }
  return res
}

export const config = {
  matcher: ['/admin/:path*'],
}

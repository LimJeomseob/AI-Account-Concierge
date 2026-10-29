/**
 * 1) 고정 접속 주소로 이동 (lib/site.ts — 운영 배포에서만, /api 제외)
 * 2) Supabase Auth 세션 쿠키 갱신 (PRD §13, /admin 만)
 * 권한 판정(admins 허용 목록)은 서버 컴포넌트·Server Action 에서 다시 확인한다.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { AUTH_COOKIE_NAME } from '@/lib/auth-cookie'
import { canonicalRedirect } from '@/lib/site'

export async function middleware(req: NextRequest) {
  const target = canonicalRedirect(
    req.headers.get('x-forwarded-host') ?? req.headers.get('host'),
    req.nextUrl.pathname + req.nextUrl.search,
    process.env.VERCEL_ENV,
  )
  if (target) return NextResponse.redirect(target, 308)

  let res = NextResponse.next({ request: req })
  if (!req.nextUrl.pathname.startsWith('/admin')) return res

  // 서버 전용 주소(SUPABASE_URL)가 있으면 쓰고, 없으면 공개 주소. Vercel 에서는 보통 같은 값이다.
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
  // 세션 쿠키 갱신(만료 시 refresh). getClaims 는 비대칭 서명 키면 로컬 검증이라 매 요청 왕복이 없다.
  // Supabase 에 닿지 못해도 요청을 막지 않는다.
  try {
    await supabase.auth.getClaims()
  } catch {
    // 무시 — 권한 판정은 서버 컴포넌트에서 다시 한다.
  }
  return res
}

export const config = {
  // 정적 파일·이미지 최적화·API 를 뺀 모든 화면 (API 는 고정 주소 이동 대상이 아니다)
  matcher: ['/((?!api/|_next/static|_next/image|favicon.ico|.*\\.[a-zA-Z0-9]+$).*)'],
}

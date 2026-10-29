/** Google 로그인 콜백 — 코드를 세션 쿠키로 교환 */
import { NextResponse } from 'next/server'
import { authClient, isAdmin } from '@/lib/auth'
import { LOGIN_HINT_COOKIE, LOGIN_HINT_MAX_AGE, appBase as resolveBase, landingFor, loginHint, safeNext } from '@/lib/redirect'

export const dynamic = 'force-dynamic'

/** 로그인을 시작한 주소로 돌아간다 — 세션 쿠키가 그 주소에 저장되므로(lib/redirect.ts) */
function appBase(req: Request): string {
  return resolveBase(req.headers, req.url, process.env.NEXT_PUBLIC_APP_URL)
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const next = safeNext(url.searchParams.get('next'))
  const base = appBase(req)

  // Supabase 가 오류를 붙여 돌려보낸 경우 (예: 공급자 설정 오류, 사용자 취소)
  const providerError = url.searchParams.get('error_description') ?? url.searchParams.get('error')
  if (providerError) {
    console.error('[auth.callback] 공급자 오류:', providerError)
    return NextResponse.redirect(new URL(`/admin/login?error=${encodeURIComponent(providerError)}`, base))
  }

  if (!code) {
    // code 없이 도착 = Supabase 가 redirectTo 를 허용하지 않아 Site URL 로 되돌렸거나 잘못된 접근.
    // 조용히 /admin 으로 보내면 원인을 알 수 없어 로그인 화면에 안내를 띄운다.
    console.error('[auth.callback] code 없음 — Supabase Redirect URLs 에 이 주소가 등록됐는지 확인')
    return NextResponse.redirect(new URL('/admin/login?error=no_code', base))
  }

  const supabase = await authClient()
  const { error } = await supabase.auth.exchangeCodeForSession(code)
  if (error) {
    // 실패 원인을 로그로 남긴다 (비밀 값은 남기지 않는다)
    console.error('[auth.callback] 코드 교환 실패:', error.message)
    return NextResponse.redirect(new URL(`/admin/login?error=${encodeURIComponent(error.message)}`, base))
  }
  // 설정 > 관리자(admins)에 등록된 계정은 관리자 페이지로 바로, 아니면 권한 없음 화면으로 (PRD §13)
  const { data } = await supabase.auth.getUser()
  const email = loginHint(data.user?.email)
  const admin = !!email && (await isAdmin(email))
  const res = NextResponse.redirect(new URL(landingFor(email, admin, next), base))
  // 관리자 이메일을 기억해 다음 로그인 때 Google 계정 선택 화면을 건너뛴다 (이메일은 로그에 남기지 않는다)
  if (email && admin) {
    res.cookies.set(LOGIN_HINT_COOKIE, email, {
      httpOnly: true,
      secure: base.startsWith('https://'),
      sameSite: 'lax',
      path: '/admin/login',
      maxAge: LOGIN_HINT_MAX_AGE,
    })
  }
  return res
}

/** Google 로그인 콜백 — 코드를 세션 쿠키로 교환 */
import { NextResponse } from 'next/server'
import { authClient } from '@/lib/auth'

export const dynamic = 'force-dynamic'

/**
 * 리다이렉트 기준 주소.
 * 컨테이너 안에서는 요청 URL 의 호스트가 0.0.0.0 으로 잡힐 수 있어
 * (ERR_ADDRESS_INVALID) 브라우저가 실제로 쓰는 주소를 쓴다.
 */
function appBase(req: Request): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL
  if (configured) return configured.replace(/\/$/, '')
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host')
  const proto = req.headers.get('x-forwarded-proto') ?? 'http'
  if (host && !host.startsWith('0.0.0.0')) return `${proto}://${host}`
  return new URL(req.url).origin
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const next = url.searchParams.get('next') ?? '/admin'
  const base = appBase(req)

  if (code) {
    const supabase = await authClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (error) {
      // 실패 원인을 로그로 남긴다 (비밀 값은 남기지 않는다)
      console.error('[auth.callback] 코드 교환 실패:', error.message)
      return NextResponse.redirect(
        new URL(`/admin/login?error=${encodeURIComponent(error.message)}`, base),
      )
    }
  }
  return NextResponse.redirect(new URL(next, base))
}

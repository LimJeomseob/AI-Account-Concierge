/** Google 로그인 콜백 — 코드를 세션 쿠키로 교환 */
import { NextResponse } from 'next/server'
import { authClient } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const next = url.searchParams.get('next') ?? '/admin'

  if (code) {
    const supabase = await authClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (error) return NextResponse.redirect(new URL('/admin/login?error=1', url.origin))
  }
  return NextResponse.redirect(new URL(next, url.origin))
}

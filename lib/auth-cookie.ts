/**
 * 인증 쿠키 이름 (브라우저·서버 공통)
 *
 * @supabase/ssr 은 기본적으로 Supabase URL 에서 쿠키 이름을 유도한다.
 * 서버가 SUPABASE_URL(서버 전용 주소)로, 브라우저가 NEXT_PUBLIC_SUPABASE_URL 로 접근할 때
 * 두 값이 다르면 쿠키 이름이 어긋나 로그인이 유지되지 않으므로 이름을 고정한다.
 *
 * 이 파일에는 'server-only' 를 두지 않는다 — 미들웨어·브라우저 클라이언트도 쓴다.
 */
export const AUTH_COOKIE_NAME = 'sb-ai-account-auth'

/**
 * 서버에서 Supabase 에 접근할 주소. SUPABASE_URL 이 없으면 공개 주소를 쓴다
 * (Vercel + Supabase 클라우드에서는 두 값이 같다). 브라우저용은 NEXT_PUBLIC_SUPABASE_URL.
 */
export function serverSupabaseUrl(): string {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!url) throw new Error('SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL 환경변수가 없습니다.')
  return url
}

/** 검증된 JWT 클레임 → 로그인 이메일(소문자). 이메일이 없으면 null (순수 함수) */
export function emailFromClaims(claims: { email?: unknown } | null | undefined): string | null {
  const email = claims?.email
  return typeof email === 'string' && email.includes('@') ? email.trim().toLowerCase() : null
}

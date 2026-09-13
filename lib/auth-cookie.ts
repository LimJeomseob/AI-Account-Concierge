/**
 * 인증 쿠키 이름 (브라우저·서버 공통)
 *
 * @supabase/ssr 은 기본적으로 Supabase URL 에서 쿠키 이름을 유도한다.
 * 이 시스템은 브라우저와 서버가 **서로 다른 주소**로 Supabase 에 접근하므로
 * (브라우저: http://localhost:8000 / 서버 컨테이너: http://kong:8000)
 * 이름을 고정하지 않으면 양쪽 쿠키 이름이 어긋나 로그인이 유지되지 않는다.
 *
 * 이 파일에는 'server-only' 를 두지 않는다 — 미들웨어·브라우저 클라이언트도 쓴다.
 */
export const AUTH_COOKIE_NAME = 'sb-ai-account-auth'

/**
 * 서버(컨테이너) 안에서 Supabase 에 접근할 주소.
 * Docker 배포에서는 내부망 주소(http://kong:8000)를, Vercel/클라우드에서는
 * 공개 주소를 쓴다. 브라우저용은 NEXT_PUBLIC_SUPABASE_URL 을 그대로 쓴다.
 */
export function serverSupabaseUrl(): string {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!url) throw new Error('SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL 환경변수가 없습니다.')
  return url
}

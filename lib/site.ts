/**
 * 서비스 접속 주소 (2026-10-29 고정)
 *
 * 로컬 실행 없이 Vercel 클라우드에서만 운영하고, 접속 주소는 아래 한 곳으로 고정한다.
 * 안내문·스냅샷 메일 링크는 이 주소를 쓰고, 운영 배포(VERCEL_ENV=production)에 다른 호스트
 * (배포별 *.vercel.app 주소 등)로 들어오면 미들웨어가 이 주소로 보낸다 — 로그인 쿠키가 한 주소에만 쌓이게.
 *
 * 이 파일에는 'server-only' 를 두지 않는다 — 미들웨어도 쓴다. (순수 함수 — 테스트 대상)
 */
export const CANONICAL_HOST = 'ai-account-concierge.vercel.app'
export const APP_URL = `https://${CANONICAL_HOST}`

/**
 * 고정 주소로 보내야 하면 이동할 전체 URL, 아니면 null.
 * - 운영 배포에서만 적용 (미리보기·개발 환경은 그대로)
 * - /api 는 제외: 신청 블록의 CORS 요청과 Vercel Cron 호출이 리다이렉트로 깨지지 않게
 */
export function canonicalRedirect(
  host: string | null | undefined,
  pathAndQuery: string,
  vercelEnv: string | null | undefined,
): string | null {
  if (vercelEnv !== 'production') return null
  const h = (host ?? '').trim().toLowerCase().replace(/:\d+$/, '')
  if (!h || h === CANONICAL_HOST) return null
  if (pathAndQuery === '/api' || pathAndQuery.startsWith('/api/') || pathAndQuery.startsWith('/api?')) return null
  return `${APP_URL}${pathAndQuery.startsWith('/') ? pathAndQuery : `/${pathAndQuery}`}`
}

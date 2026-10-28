/**
 * 로그인 콜백 리다이렉트 보조 (순수 함수 — 테스트 대상)
 */

export const DEFAULT_AFTER_LOGIN = '/admin/dashboard'

/**
 * 콜백 뒤 이동할 기준 주소.
 * 로그인을 시작한 주소(= 세션 쿠키가 저장되는 주소)로 돌아가야 한다. NEXT_PUBLIC_APP_URL 을 먼저 쓰면
 * 접속 주소와 다를 때(미리보기·별칭 도메인·www 유무) 쿠키가 없는 주소로 보내져 다시 로그인해야 했다.
 */
export function appBase(
  headers: { get(name: string): string | null },
  requestUrl: string,
  configured?: string,
): string {
  const host = headers.get('x-forwarded-host') ?? headers.get('host')
  if (host) {
    const proto = headers.get('x-forwarded-proto') ?? new URL(requestUrl).protocol.replace(':', '')
    return `${proto}://${host}`
  }
  try {
    return new URL(requestUrl).origin
  } catch {
    return (configured ?? '').replace(/\/$/, '')
  }
}

/** next 파라미터는 같은 사이트 안의 경로만 허용 (오픈 리다이렉트 방지) */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return DEFAULT_AFTER_LOGIN
  return next
}

/**
 * 로그인 콜백 리다이렉트 보조 (순수 함수 — 테스트 대상)
 */

export const DEFAULT_AFTER_LOGIN = '/admin/dashboard'

/**
 * 콜백 뒤 이동할 기준 주소.
 * 로그인을 시작한 주소(= 세션 쿠키가 저장되는 주소)로 돌아가야 한다. 고정 주소(lib/site.ts)를 먼저 쓰면
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

/**
 * 세션·허용 여부에 따른 착지 경로 (순수 함수, PRD §7-2·§13)
 * 로그인 화면·권한 없음 화면·로그인 콜백이 같은 규칙을 쓴다.
 *  - 미로그인 → 로그인 화면
 *  - 설정 > 관리자(admins 표)에 등록된 계정 → 관리자 페이지(next, 기본 대시보드)
 *  - 그 외 → 권한 없음
 */
export function landingFor(email: string | null | undefined, admin: boolean, next?: string | null): string {
  if (!email) return '/admin/login'
  return admin ? safeNext(next) : '/admin/denied'
}

/**
 * Google 계정 선택 화면 생략용 힌트 쿠키 — 관리자로 로그인에 성공한 이메일만 저장한다.
 * 브라우저에 Google 계정이 여러 개 로그인돼 있으면 Google 이 계정 선택 화면을 띄우는데,
 * login_hint 를 주면 해당 세션을 바로 고른다.
 */
export const LOGIN_HINT_COOKIE = 'ai-account-login-hint'
export const LOGIN_HINT_MAX_AGE = 60 * 60 * 24 * 180

/** 힌트 값 검증 — 이메일 형식만 통과 (순수 함수) */
export function loginHint(value: string | null | undefined): string | null {
  const v = (value ?? '').trim().toLowerCase()
  return /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(v) && v.length <= 254 ? v : null
}

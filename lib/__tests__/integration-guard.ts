/**
 * 통합 테스트 실행 가드 — 실제 DB 에 쓰고 지우므로 운영 DB 에서 돌면 안 된다.
 *
 * 켜지는 조건(모두 충족):
 *  - ACCEPTANCE_CONFIRM=yes
 *  - SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, APP_SECRET 존재
 *  - ACCEPTANCE_DB_HOST 가 SUPABASE_URL 의 호스트와 같음 — 어느 DB 를 쓰는지 **이름을 써서** 확인시킨다.
 *    (예: ACCEPTANCE_DB_HOST=abcd1234.supabase.co, 로컬 Docker 는 localhost)
 */
export function acceptanceEnabled(env: Record<string, string | undefined> = process.env): boolean {
  if (env.ACCEPTANCE_CONFIRM !== 'yes') return false
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY || !env.APP_SECRET) return false
  const expected = (env.ACCEPTANCE_DB_HOST ?? '').trim().toLowerCase()
  if (!expected) {
    console.warn('[integration] ACCEPTANCE_DB_HOST 가 없어 통합 테스트를 건너뜁니다 (시범 DB 호스트를 명시하세요).')
    return false
  }
  let host = ''
  try {
    host = new URL(env.SUPABASE_URL).hostname.toLowerCase()
  } catch {
    return false
  }
  if (host !== expected) {
    console.warn(`[integration] SUPABASE_URL 호스트(${host})가 ACCEPTANCE_DB_HOST(${expected})와 달라 건너뜁니다.`)
    return false
  }
  return true
}

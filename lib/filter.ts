/** 유료계정 사용현황 필터 — 순수 함수 (서버·브라우저 공용, server-only 금지) */

/**
 * 유료계정 사용현황 화면 필터 (assignments/page.tsx) — 목록·CSV 내려받기·「승인 건 배정」이 같은 조건을 쓴다.
 * 이름·이메일·계정번호는 부분 일치(대소문자 무시), 상태·프로그램·플랫폼은 정확히 일치.
 * 플랫폼(service): 배정된 건은 service 열, 배정 전(신청·승인) 건은 service_wish 열로 판정한다. 「무관」 희망 건은 걸리지 않는다.
 */
export interface ApplicantFilter {
  status?: string
  program?: string
  /** 'GPT' | 'Claude' */
  service?: string
  name?: string
  email?: string
  account?: string
}

export const FILTER_KEYS = ['status', 'program', 'service', 'name', 'email', 'account'] as const
export const SERVICES = ['GPT', 'Claude'] as const

/** 쿼리 문자열 → 필터 (빈 값 제거, 100자 제한) — 순수 함수 */
export function parseFilter(get: (key: string) => string | null | undefined): ApplicantFilter {
  const f: ApplicantFilter = {}
  for (const k of FILTER_KEYS) {
    const v = (get(k) ?? '').trim().slice(0, 100)
    if (!v) continue
    if (k === 'service' && !(SERVICES as readonly string[]).includes(v)) continue
    f[k] = v
  }
  return f
}

/** ilike 부분 일치 패턴 — 사용자가 넣은 % _ \ 는 글자 그대로 찾는다 (순수 함수) */
export function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
}

interface Filterable {
  eq(column: string, value: string): Filterable
  ilike(column: string, pattern: string): Filterable
  or(filters: string): Filterable
}

/**
 * Supabase 조회에 필터를 건다. skipStatus: 상태별 건수를 셀 때처럼 상태 조건만 빼고 싶을 때.
 * (Supabase 조회 빌더의 제네릭 타입이 너무 깊어 내부에서는 최소 인터페이스로 다룬다)
 */
export function applyFilter<Q>(query: Q, f: ApplicantFilter, opts: { skipStatus?: boolean } = {}): Q {
  let q = query as unknown as Filterable
  if (f.status && !opts.skipStatus) q = q.eq('status', f.status)
  if (f.program) q = q.eq('program_id', f.program)
  if (f.service) q = q.or(`service.eq.${f.service},and(service.is.null,service_wish.eq.${f.service})`)
  if (f.name) q = q.ilike('name', likePattern(f.name))
  if (f.email) q = q.ilike('email', likePattern(f.email))
  if (f.account) q = q.ilike('account_id', likePattern(f.account))
  return q as unknown as Q
}

/** 필터 → URL 쿼리 (빈 값은 생략) — 내려받기 링크·상태 버튼에 쓴다 */
export function exportQuery(f: ApplicantFilter): string {
  const p = new URLSearchParams()
  for (const k of FILTER_KEYS) if (f[k]) p.set(k, f[k] as string)
  const s = p.toString()
  return s ? `?${s}` : ''
}

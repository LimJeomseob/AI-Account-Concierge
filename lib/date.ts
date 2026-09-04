/**
 * 날짜 유틸 (PRD R33: 모든 시간 판단은 Asia/Seoul 기준 「오늘」)
 * 날짜 계산은 반드시 이 파일의 함수만 사용한다.
 */

const KST = 'Asia/Seoul'

/** Asia/Seoul 기준 오늘 (YYYY-MM-DD) */
export function todayKST(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: KST,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

/** Asia/Seoul 기준 현재 시각 표시 (YYYY-MM-DD HH:mm) */
export function nowKSTText(now: Date = new Date()): string {
  const d = new Intl.DateTimeFormat('en-CA', {
    timeZone: KST,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(now)
  return d.replace(',', '')
}

/** YYMMDD (배정ID 채번용) */
export function yymmddKST(now: Date = new Date()): string {
  return todayKST(now).slice(2).replace(/-/g, '')
}

/** YYYY-MM (스냅샷 월) */
export function monthKST(now: Date = new Date()): string {
  return todayKST(now).slice(0, 7)
}

/** 전월 YYYY-MM */
export function prevMonthKST(now: Date = new Date()): string {
  const [y, m] = monthKST(now).split('-').map(Number)
  const py = m === 1 ? y - 1 : y
  const pm = m === 1 ? 12 : m - 1
  return `${py}-${String(pm).padStart(2, '0')}`
}

/** 'YYYY-MM-DD' + n일 */
export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** b − a (일수). 같은 날이면 0 */
export function diffDays(a: string, b: string): number {
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)
  return Math.round(ms / 86_400_000)
}

/** 두 날짜를 양끝 포함해서 센 일수 (a~b, a>b면 0) */
export function inclusiveDays(a: string, b: string): number {
  const d = diffDays(a, b)
  return d < 0 ? 0 : d + 1
}

/** timestamptz → Asia/Seoul 날짜 문자열 */
export function toKSTDate(ts: string | Date | null | undefined): string | null {
  if (!ts) return null
  const d = typeof ts === 'string' ? new Date(ts) : ts
  if (Number.isNaN(d.getTime())) return null
  return todayKST(d)
}

/** 날짜 표시(한글) 2026-09-04 → 2026. 9. 4. */
export function formatKorean(date: string | null | undefined): string {
  if (!date) return '-'
  const [y, m, d] = date.split('-')
  return `${y}. ${Number(m)}. ${Number(d)}.`
}

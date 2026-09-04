/**
 * ID 채번 (PRD §4-2: counters 테이블로 경합 방지)
 *  - 프로그램: <prefix>-NN            (R1)
 *  - 참여자:   U-0001
 *  - 배정:     A + YYMMDD + 4자리 일련
 */
import 'server-only'
import { db } from '@/lib/db'
import { yymmddKST } from '@/lib/date'

async function next(key: string): Promise<number> {
  const { data, error } = await db().rpc('next_counter', { p_key: key })
  if (error) throw new Error(`채번 실패(${key}): ${error.message}`)
  return Number(data)
}

/** P26-01 … (순수 포맷 함수는 formatProgramId) */
export async function nextProgramId(prefix: string): Promise<string> {
  return formatProgramId(prefix, await next(`program:${prefix}`))
}

/** U-0001 … */
export async function nextUserId(): Promise<string> {
  return formatUserId(await next('user'))
}

/** A260904-0001 … (날짜별 일련) */
export async function nextAssignmentId(today: string = yymmddKST()): Promise<string> {
  return formatAssignmentId(today, await next(`assignment:${today}`))
}

// --- 순수 포맷 함수 (테스트 대상) -------------------------------------------

export function formatProgramId(prefix: string, n: number): string {
  return `${prefix}-${String(n).padStart(2, '0')}`
}

export function formatUserId(n: number): string {
  return `U-${String(n).padStart(4, '0')}`
}

export function formatAssignmentId(yymmdd: string, n: number): string {
  return `A${yymmdd}-${String(n).padStart(4, '0')}`
}

/** GPT-001 / CL-001 (계정 CSV 가져오기 보조) */
export function formatAccountId(service: 'GPT' | 'Claude', n: number): string {
  return `${service === 'GPT' ? 'GPT' : 'CL'}-${String(n).padStart(3, '0')}`
}

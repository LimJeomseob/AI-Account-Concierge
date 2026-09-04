/**
 * 비밀번호 생성 (PRD R21)
 * 대문자·소문자·숫자·기호 각 1자 이상, 길이 password_length, 혼동 문자 제외.
 * 순수 함수 — Vitest 단위 테스트 대상.
 */
import { randomInt } from 'node:crypto'

// 혼동 문자(O/0, I/l/1 등) 제외
export const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
export const LOWER = 'abcdefghijkmnopqrstuvwxyz'
export const DIGIT = '23456789'
export const SYMBOL = '!@#$%^&*?-_+='
export const ALL = UPPER + LOWER + DIGIT + SYMBOL

export type RandomInt = (maxExclusive: number) => number

const defaultRandom: RandomInt = (max) => randomInt(max)

/**
 * 비밀번호 생성.
 * @param length 길이(최소 8로 보정)
 * @param rnd    테스트 주입용 난수 함수
 */
export function generatePassword(length = 10, rnd: RandomInt = defaultRandom): string {
  const len = Math.max(8, Math.floor(length) || 10)
  const pick = (set: string) => set[rnd(set.length)]

  const chars = [pick(UPPER), pick(LOWER), pick(DIGIT), pick(SYMBOL)]
  while (chars.length < len) chars.push(pick(ALL))

  // Fisher–Yates 셔플 (선두 4자 고정 방지)
  for (let i = chars.length - 1; i > 0; i--) {
    const j = rnd(i + 1)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }
  return chars.join('')
}

/** 생성 규칙 충족 여부 검증 */
export function isValidPassword(pw: string, length = 10): boolean {
  if (pw.length !== Math.max(8, Math.floor(length) || 10)) return false
  const has = (set: string) => [...pw].some((c) => set.includes(c))
  const onlyAllowed = [...pw].every((c) => ALL.includes(c))
  return onlyAllowed && has(UPPER) && has(LOWER) && has(DIGIT) && has(SYMBOL)
}

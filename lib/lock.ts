/**
 * 실행 잠금 (R32) — 일일 작업·메일 발송이 동시에 두 번 돌지 않게 한다.
 * counters 표(key/value)를 그대로 쓴다: key = 'lock.<이름>', value = 잠근 시각(ms).
 *  - 잠금: insert 성공(아무도 없음) 또는 TTL 이 지난 값을 조건부 갱신(죽은 잠금 인수)
 *  - 해제: 내가 넣은 값일 때만 삭제(남의 잠금을 지우지 않음)
 * 서버리스 인스턴스가 여러 개여도 DB 한 곳에서 판정하므로 안전하다.
 */
import 'server-only'
import { db } from '@/lib/db'

const PREFIX = 'lock.'

async function acquire(name: string, ttlMs: number): Promise<number | null> {
  const key = PREFIX + name
  const now = Date.now()

  const { error } = await db().from('counters').insert({ key, value: now })
  if (!error) return now
  if (error.code !== '23505') throw new Error(`잠금 실패(${name}): ${error.message}`)

  // 이미 있음 → TTL 이 지났으면 인수 (조건부: 그사이 다른 처리가 인수했다면 0행)
  const { data, error: upErr } = await db()
    .from('counters')
    .update({ value: now })
    .eq('key', key)
    .lt('value', now - ttlMs)
    .select('key')
  if (upErr) throw new Error(`잠금 실패(${name}): ${upErr.message}`)
  return data && data.length > 0 ? now : null
}

async function release(name: string, token: number): Promise<void> {
  await db().from('counters').delete().eq('key', PREFIX + name).eq('value', token)
}

/**
 * 잠금을 잡고 fn 실행. 다른 실행이 잠금을 쥐고 있으면 fn 을 실행하지 않고 `{ locked: true }`.
 * ttlMs 는 작업 최대 소요 시간보다 넉넉히 — 비정상 종료로 남은 잠금은 그 뒤에 인수된다.
 */
export async function withLock<T>(
  name: string,
  ttlMs: number,
  fn: () => Promise<T>,
): Promise<{ locked: true } | { locked: false; value: T }> {
  const token = await acquire(name, ttlMs)
  if (token === null) return { locked: true }
  try {
    return { locked: false, value: await fn() }
  } finally {
    await release(name, token)
  }
}

/** 마지막 성공 시각 기록·조회 (counters 재사용, key = 'last_ok.<이름>') */
export async function markOk(name: string, at: number = Date.now()): Promise<void> {
  await db().from('counters').upsert({ key: `last_ok.${name}`, value: at }, { onConflict: 'key' })
}

export async function lastOk(name: string): Promise<number | null> {
  const { data } = await db().from('counters').select('value').eq('key', `last_ok.${name}`).maybeSingle()
  return data ? Number(data.value) : null
}

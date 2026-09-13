/**
 * 운영 설정 (PRD §4-1 settings)
 * 타입·기본값은 lib/settings-defaults.ts (서버 전용 표시 없음) 에 있다.
 */
import 'server-only'
import { db } from '@/lib/db'
import { DEFAULT_SETTINGS, type Settings } from '@/lib/settings-defaults'

export { DEFAULT_SETTINGS }
export type { Settings }

/** settings 테이블 전체를 읽어 기본값과 병합 */
export async function getSettings(): Promise<Settings> {
  const { data, error } = await db().from('settings').select('key, value')
  if (error) throw new Error(error.message)
  const merged: Record<string, unknown> = { ...DEFAULT_SETTINGS }
  for (const row of data ?? []) {
    if (row.key in DEFAULT_SETTINGS) merged[row.key] = row.value
  }
  return merged as unknown as Settings
}

export async function setSetting(key: keyof Settings, value: unknown): Promise<void> {
  const { error } = await db()
    .from('settings')
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' })
  if (error) throw new Error(error.message)
}

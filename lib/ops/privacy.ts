/**
 * 개인정보 파기 (PRD R30)
 * users 의 이름·이메일·연락처, assignments 의 이름·이메일을 「(파기)」로 치환.
 * 유형·소속·ID 는 실적 산출을 위해 유지한다.
 */
import 'server-only'
import { db } from '@/lib/db'
import { log } from '@/lib/state'

export const PURGED = '(파기)'

/** 파기 대상 후보: 아직 파기되지 않은 사용자 */
export async function purgeCandidates() {
  const { data } = await db()
    .from('users')
    .select('id, name, email, type, affiliation, first_applied_at, privacy_consented_at')
    .is('purged_at', null)
    .order('first_applied_at')
  return data ?? []
}

/** 지정한 사용자(미지정 시 전체 미파기 사용자)를 파기 */
export async function purgeUsers(userIds: string[] | null, actor: string): Promise<number> {
  const targets = userIds ?? (await purgeCandidates()).map((u) => u.id)
  let n = 0
  for (const id of targets) {
    const { data: user } = await db().from('users').select('id, email').eq('id', id).maybeSingle()
    if (!user) continue

    // users.email 은 소문자 제약(users_email_lower)이 있어 ID 를 소문자로 쓴다
    const purgedEmail = `${id.toLowerCase()}@purged.local`
    const { error: aErr } = await db()
      .from('assignments')
      .update({ name: PURGED, email: purgedEmail, updated_at: new Date().toISOString() })
      .eq('user_id', id)
    if (aErr) throw new Error(aErr.message)

    const { error } = await db()
      .from('users')
      .update({
        name: PURGED,
        email: purgedEmail,
        phone: null,
        purged_at: new Date().toISOString(),
      })
      .eq('id', id)
    if (error) throw new Error(error.message)

    await log(actor, 'privacy.purge', id, {})
    n += 1
  }
  return n
}

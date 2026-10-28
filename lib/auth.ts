/**
 * 관리자 인증 (PRD §13)
 * Supabase Auth Google Provider 세션 + admins 허용 목록 이중 확인.
 */
import 'server-only'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { createServerClient } from '@supabase/ssr'
import { db } from '@/lib/db'
import { log } from '@/lib/state'
import { AUTH_COOKIE_NAME, serverSupabaseUrl } from '@/lib/auth-cookie'

export function authEnv() {
  // 서버 전용 주소(SUPABASE_URL)가 있으면 그 주소로 Supabase 에 접근한다.
  const url = serverSupabaseUrl()
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!key) throw new Error('NEXT_PUBLIC_SUPABASE_ANON_KEY 환경변수가 없습니다.')
  return { url, key }
}

/** 쿠키 기반 Auth 클라이언트(세션 확인 전용, 데이터 접근에 쓰지 말 것) */
export async function authClient() {
  const { url, key } = authEnv()
  const store = await cookies()
  return createServerClient(url, key, {
    // 브라우저 클라이언트와 쿠키 이름을 맞춘다 (lib/auth-cookie.ts 참고)
    cookieOptions: { name: AUTH_COOKIE_NAME },
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options)
        } catch {
          // Server Component 에서는 쿠키를 쓸 수 없다. 미들웨어가 갱신한다.
        }
      },
    },
  })
}

/** 로그인한 사용자의 이메일(소문자). 미로그인 시 null */
export async function sessionEmail(): Promise<string | null> {
  try {
    const supabase = await authClient()
    const { data } = await supabase.auth.getUser()
    const email = data.user?.email
    return email ? email.toLowerCase() : null
  } catch {
    return null
  }
}

/** admins 허용 목록 확인 (+ 최초 관리자 부트스트랩) */
export async function isAdmin(email: string | null): Promise<boolean> {
  if (!email) return false
  const { data, error } = await db().from('admins').select('email').eq('email', email).maybeSingle()
  if (error) return false
  if (data) return true
  return bootstrapFirstAdmin(email)
}

/**
 * 최초 관리자 부트스트랩 — admins 표가 비어 있고 로그인 이메일이 INITIAL_ADMIN_EMAIL 과 같으면
 * 자동 등록한다. 시드 스크립트(scripts/seed.ts)를 돌리지 못한 배포에서도 첫 로그인이 가능하게 한다.
 * 관리자가 1명이라도 있으면 아무 효과가 없다(허용 목록은 설정 화면에서만 관리).
 */
async function bootstrapFirstAdmin(email: string): Promise<boolean> {
  const initial = process.env.INITIAL_ADMIN_EMAIL?.trim().toLowerCase()
  if (!initial || initial !== email) return false
  const { count, error: cErr } = await db().from('admins').select('email', { count: 'exact', head: true })
  if (cErr || (count ?? 0) > 0) return false
  const { error } = await db()
    .from('admins')
    .upsert({ email, created_by: 'bootstrap' }, { onConflict: 'email', ignoreDuplicates: true })
  if (error) return false
  await log('system', 'admin.bootstrap', email, {})
  return true
}

/** 현재 관리자 이메일. 미로그인 → /admin/login, 비허용 → /admin/denied */
export async function requireAdmin(): Promise<string> {
  const email = await sessionEmail()
  if (!email) redirect('/admin/login')
  if (!(await isAdmin(email))) redirect('/admin/denied')
  return email
}

/** Server Action 용: 리다이렉트 대신 예외 */
export async function requireAdminAction(): Promise<string> {
  const email = await sessionEmail()
  if (!email) throw new Error('로그인이 필요합니다.')
  if (!(await isAdmin(email))) throw new Error('권한이 없습니다.')
  return email
}

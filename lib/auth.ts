/**
 * 관리자 인증 (PRD §13)
 * Supabase Auth Google Provider 세션 + admins 허용 목록 이중 확인.
 */
import 'server-only'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { createServerClient } from '@supabase/ssr'
import { db } from '@/lib/db'

export function authEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL / ANON_KEY 환경변수가 없습니다.')
  return { url, key }
}

/** 쿠키 기반 Auth 클라이언트(세션 확인 전용, 데이터 접근에 쓰지 말 것) */
export async function authClient() {
  const { url, key } = authEnv()
  const store = await cookies()
  return createServerClient(url, key, {
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

/** admins 허용 목록 확인 */
export async function isAdmin(email: string | null): Promise<boolean> {
  if (!email) return false
  const { data, error } = await db().from('admins').select('email').eq('email', email).maybeSingle()
  if (error) return false
  return !!data
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

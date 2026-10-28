import LoginButton from './LoginButton'
import { Card } from '@/components/ui'
import SiteHeader from '@/components/SiteHeader'
import SiteFooter from '@/components/SiteFooter'

export const dynamic = 'force-dynamic'

/** 콜백이 넘겨준 오류 코드 → 담당자가 조치할 수 있는 안내 문구 */
function describeError(code: string): string {
  if (code === 'no_code') {
    return 'Google 로그인 뒤 인증 코드 없이 되돌아왔습니다. Supabase > Authentication > URL Configuration 의 Redirect URLs 에 「<이 사이트 주소>/auth/callback」 이 등록돼 있는지, Site URL 이 이 사이트 주소인지 확인해 주세요.'
  }
  if (/pkce|code verifier/i.test(code)) {
    return '로그인 세션 쿠키를 찾지 못했습니다. 로그인을 시작한 브라우저·주소(www 유무, http/https)와 같은 곳으로 돌아왔는지 확인하고 다시 시도해 주세요.'
  }
  return `로그인에 실패했습니다: ${code}`
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 py-12">
        <Card>
          <div className="flex flex-col gap-4">
            <h1 className="text-2xl font-bold">관리자 로그인</h1>
            <p className="text-slate-600">허용된 관리자 계정으로 로그인해 주세요.</p>
            {error && (
              <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm leading-6 text-red-800">
                {describeError(error)}
              </p>
            )}
            <LoginButton />
          </div>
        </Card>
      </main>
      <SiteFooter />
    </div>
  )
}

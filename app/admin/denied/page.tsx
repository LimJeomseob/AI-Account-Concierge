import { redirect } from 'next/navigation'
import { isAdmin, sessionEmail } from '@/lib/auth'
import { landingFor } from '@/lib/redirect'
import SignOutButton from './SignOutButton'
import { Card } from '@/components/ui'
import SiteHeader from '@/components/SiteHeader'
import SiteFooter from '@/components/SiteFooter'

export const dynamic = 'force-dynamic'

export default async function DeniedPage() {
  // 허용 목록을 다시 확인한다 — 설정 > 관리자에 등록된 계정은 재로그인 없이 관리자 페이지로,
  // 미로그인은 로그인 화면으로. 권한 없는 계정만 이 화면에 남는다.
  const email = await sessionEmail()
  const target = landingFor(email, await isAdmin(email))
  if (target !== '/admin/denied') redirect(target)

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 py-12">
        <Card>
          <div className="flex flex-col gap-4">
            <h1 className="text-2xl font-bold text-red-700!">권한 없음</h1>
            <p className="text-slate-700">관리자 권한이 없습니다. 관리자에게 문의하세요!</p>
            <p className="break-all text-xs text-slate-500">로그인 계정: {email}</p>
            <SignOutButton />
          </div>
        </Card>
      </main>
      <SiteFooter />
    </div>
  )
}

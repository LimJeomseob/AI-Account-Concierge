import { sessionEmail } from '@/lib/auth'
import SignOutButton from './SignOutButton'
import { Card } from '@/components/ui'
import SiteHeader from '@/components/SiteHeader'
import SiteFooter from '@/components/SiteFooter'

export const dynamic = 'force-dynamic'

export default async function DeniedPage() {
  const email = await sessionEmail()
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 py-12">
        <Card>
          <div className="flex flex-col gap-4">
            <h1 className="text-2xl font-bold text-red-700!">권한 없음</h1>
            <p className="text-slate-600">
              {email ?? '이 계정'} 은(는) 관리자 목록에 없습니다. AI융합원 담당자에게 등록을 요청해 주세요.
            </p>
            <SignOutButton />
          </div>
        </Card>
      </main>
      <SiteFooter />
    </div>
  )
}

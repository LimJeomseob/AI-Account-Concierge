import LoginButton from './LoginButton'
import { Card } from '@/components/ui'
import SiteHeader from '@/components/SiteHeader'
import SiteFooter from '@/components/SiteFooter'

export const dynamic = 'force-dynamic'

export default function LoginPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 py-12">
        <Card>
          <div className="flex flex-col gap-4">
            <h1 className="text-2xl font-bold">관리자 로그인</h1>
            <p className="text-slate-600">허용된 관리자 계정으로 로그인해 주세요.</p>
            <LoginButton />
          </div>
        </Card>
      </main>
      <SiteFooter />
    </div>
  )
}

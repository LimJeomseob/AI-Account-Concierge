import { sessionEmail } from '@/lib/auth'
import SignOutButton from './SignOutButton'

export const dynamic = 'force-dynamic'

export default async function DeniedPage() {
  const email = await sessionEmail()
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-3 p-8">
      <h1 className="text-xl font-bold text-red-700">권한 없음</h1>
      <p className="text-sm text-slate-600">
        {email ?? '이 계정'} 은(는) 관리자 목록에 없습니다. AI융합원 담당자에게 등록을 요청해 주세요.
      </p>
      <SignOutButton />
    </main>
  )
}

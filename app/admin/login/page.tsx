import LoginButton from './LoginButton'

export const dynamic = 'force-dynamic'

export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-8">
      <p className="text-sm text-slate-500">경상국립대학교 AI융합원</p>
      <h1 className="text-xl font-bold text-[var(--gnu-navy)]">AI 유료계정 관리시스템</h1>
      <p className="text-sm text-slate-600">허용된 관리자 계정으로 로그인해 주세요.</p>
      <LoginButton />
    </main>
  )
}

import Link from 'next/link'

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 p-8">
      <div>
        <p className="text-sm text-slate-500">경상국립대학교 AI융합원</p>
        <h1 className="mt-1 text-2xl font-bold text-[var(--gnu-navy)]">AI 유료계정 관리시스템</h1>
        <p className="mt-2 text-sm text-slate-600">
          2026학년도 하반기 「AI 유료계정 지원 계획(안)」 운영 시스템입니다.
        </p>
      </div>
      <div className="flex gap-3">
        <Link
          href="/apply"
          className="rounded-md bg-[var(--gnu-navy)] px-4 py-2 text-sm font-medium text-white"
        >
          신청하기
        </Link>
        <Link href="/admin" className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm">
          관리자
        </Link>
      </div>
    </main>
  )
}

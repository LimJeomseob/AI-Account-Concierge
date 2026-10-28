import Link from 'next/link'
import SiteHeader from '@/components/SiteHeader'
import SiteFooter from '@/components/SiteFooter'

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-8 px-6 py-16">
        <div>
          <h1 className="text-3xl font-bold">AI 유료계정 관리시스템</h1>
          <p className="mt-3 text-lg text-gnu-muted">
            2026학년도 하반기 「AI 유료계정 지원 계획(안)」 운영 시스템입니다.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link
            href="/apply"
            className="rounded-md bg-gnu-navy px-6 py-3 text-base font-semibold text-white transition hover:bg-gnu-navy-dark"
          >
            신청하기
          </Link>
          <Link
            href="/admin"
            className="rounded-md border border-slate-300 bg-white px-6 py-3 text-base font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            관리자
          </Link>
        </div>
      </main>
      <SiteFooter />
    </div>
  )
}

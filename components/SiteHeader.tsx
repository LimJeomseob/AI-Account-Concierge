/** 공통 상단 바 — gnu.ac.kr 톤의 남색 풀폭 헤더 (서버 컴포넌트) */
import Link from 'next/link'
import type { ReactNode } from 'react'
import { L } from '@/lib/labels'

export default function SiteHeader({ children }: { children?: ReactNode }) {
  return (
    <header className="w-full bg-gnu-navy text-white">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
        <Link href="/" className="block leading-tight">
          <span className="block text-[13px] opacity-80">{L.org}</span>
          <span className="block text-lg font-bold">{L.app}</span>
        </Link>
        <div className="flex items-center gap-4">
          {children}
          <a
            href="https://www.gnu.ac.kr"
            target="_blank"
            rel="noopener noreferrer"
            className="whitespace-nowrap text-sm opacity-80 transition hover:opacity-100"
          >
            경상국립대학교 홈
          </a>
        </div>
      </div>
    </header>
  )
}

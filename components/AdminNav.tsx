'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { L } from '@/lib/labels'

const NAV: Array<[string, string]> = [
  ['/admin/dashboard', L.menu.dashboard],
  ['/admin/assignments', L.menu.assignments],
  ['/admin/programs', L.menu.programs],
  ['/admin/accounts', L.menu.accounts],
  ['/admin/users', L.menu.users],
  ['/admin/incidents', L.menu.incidents],
  ['/admin/reports', L.menu.reports],
  ['/admin/settings', L.menu.settings],
  ['/admin/logs', L.menu.logs],
]

/** 관리자 메뉴 — `horizontal` 이면 소형 화면용 가로 스크롤 바 */
export default function AdminNav({ horizontal = false }: { horizontal?: boolean }) {
  const pathname = usePathname()

  if (horizontal) {
    return (
      <nav className="flex gap-1 overflow-x-auto border-b border-gnu-line bg-white px-4 md:hidden" aria-label="관리자 메뉴">
        {NAV.map(([href, label]) => {
          const active = pathname === href || pathname.startsWith(href + '/')
          return (
            <Link
              key={href}
              href={href}
              className={`shrink-0 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm ${
                active
                  ? 'border-gnu-blue font-semibold text-gnu-navy'
                  : 'border-transparent text-slate-700 hover:bg-slate-50'
              }`}
            >
              {label}
            </Link>
          )
        })}
      </nav>
    )
  }

  return (
    <nav className="space-y-1 py-4 pr-3" aria-label="관리자 메뉴">
      {NAV.map(([href, label]) => {
        const active = pathname === href || pathname.startsWith(href + '/')
        return (
          <Link
            key={href}
            href={href}
            className={`block rounded-r-md px-4 py-2.5 text-[15px] ${
              active
                ? 'border-l-4 border-gnu-blue bg-gnu-sky font-semibold text-gnu-navy'
                : 'border-l-4 border-transparent text-slate-700 hover:bg-slate-50'
            }`}
          >
            {label}
          </Link>
        )
      })}
    </nav>
  )
}

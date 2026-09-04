import Link from 'next/link'
import { requireAdmin } from '@/lib/auth'
import { L } from '@/lib/labels'

export const dynamic = 'force-dynamic'

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

export default async function ProtectedAdminLayout({ children }: { children: React.ReactNode }) {
  const email = await requireAdmin()

  return (
    <div className="flex min-h-screen">
      <aside className="w-52 shrink-0 border-r border-slate-200 bg-white p-4">
        <p className="text-xs text-slate-500">{L.org}</p>
        <p className="mt-1 text-sm font-bold text-[var(--gnu-navy)]">{L.app}</p>
        <nav className="mt-5 space-y-1">
          {NAV.map(([href, label]) => (
            <Link
              key={href}
              href={href}
              className="block rounded-md px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
            >
              {label}
            </Link>
          ))}
        </nav>
        <p className="mt-6 break-all text-xs text-slate-400">{email}</p>
      </aside>
      <main className="flex-1 space-y-5 p-6">{children}</main>
    </div>
  )
}

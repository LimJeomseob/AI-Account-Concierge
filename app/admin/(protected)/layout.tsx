import { requireAdmin } from '@/lib/auth'
import AdminNav from '@/components/AdminNav'
import SiteHeader from '@/components/SiteHeader'
import SiteFooter from '@/components/SiteFooter'

export const dynamic = 'force-dynamic'

export default async function ProtectedAdminLayout({ children }: { children: React.ReactNode }) {
  const email = await requireAdmin()

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader>
        <span className="hidden max-w-[260px] truncate text-sm opacity-80 sm:block" title={email}>
          {email}
        </span>
      </SiteHeader>
      <AdminNav horizontal />
      <div className="flex flex-1">
        <aside className="hidden w-56 shrink-0 border-r border-gnu-line bg-white md:block">
          <AdminNav />
        </aside>
        <main className="min-w-0 flex-1 space-y-6 p-6 lg:p-8">{children}</main>
      </div>
      <SiteFooter />
    </div>
  )
}

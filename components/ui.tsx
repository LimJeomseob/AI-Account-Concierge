/** 관리자 UI 프리미티브 (shadcn/ui 스타일의 최소 구현) */
import type { ReactNode } from 'react'
import { STATUS_BADGE } from '@/lib/labels'

export function Card({ title, right, children }: { title?: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      {(title || right) && (
        <header className="mb-3 flex items-center justify-between">
          {title && <h2 className="font-semibold text-[var(--gnu-navy)]">{title}</h2>}
          {right}
        </header>
      )}
      {children}
    </section>
  )
}

export function Badge({ value }: { value: string | null | undefined }) {
  if (!value) return <span className="text-slate-400">-</span>
  const cls = STATUS_BADGE[value] ?? 'bg-slate-100 text-slate-700 border-slate-200'
  return <span className={`inline-block rounded-full border px-2 py-0.5 text-xs ${cls}`}>{value}</span>
}

export function Stat({ label, value, warn }: { label: string; value: ReactNode; warn?: boolean }) {
  return (
    <div className={`rounded-lg border p-4 ${warn ? 'border-red-200 bg-red-50' : 'border-slate-200 bg-white'}`}>
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${warn ? 'text-red-700' : 'text-[var(--gnu-navy)]'}`}>{value}</p>
    </div>
  )
}

export function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-500">
            {head.map((h) => (
              <th key={h} className="whitespace-nowrap px-3 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

export function Td({ children, className = '' }: { children?: ReactNode; className?: string }) {
  return <td className={`border-b border-slate-100 px-3 py-2 align-middle ${className}`}>{children}</td>
}

export function Button({
  children,
  variant = 'primary',
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' }) {
  const base = 'rounded-md px-3 py-1.5 text-xs font-medium disabled:opacity-50'
  const style =
    variant === 'primary'
      ? 'bg-[var(--gnu-navy)] text-white'
      : variant === 'danger'
        ? 'border border-red-300 bg-white text-red-700'
        : 'border border-slate-300 bg-white text-slate-700'
  return (
    <button {...rest} className={`${base} ${style} ${rest.className ?? ''}`}>
      {children}
    </button>
  )
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-slate-600">{label}</span>
      {children}
    </label>
  )
}

export const inputClass = 'mt-1 w-full rounded-md border border-slate-300 p-2 text-sm'

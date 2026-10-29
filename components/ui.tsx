/** 관리자 UI 프리미티브 (shadcn/ui 스타일의 최소 구현) — gnu.ac.kr 톤 */
import type { ReactNode } from 'react'
import { STATUS_BADGE } from '@/lib/labels'

export function Card({ title, right, children }: { title?: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-gnu-line bg-white p-6 shadow-sm">
      {(title || right) && (
        <header className="mb-4 flex items-center justify-between gap-4">
          {title && <h2 className="text-lg font-bold text-gnu-navy">{title}</h2>}
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
  return (
    <span className={`inline-block whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[13px] font-medium ${cls}`}>{value}</span>
  )
}

export function Stat({ label, value, warn }: { label: string; value: ReactNode; warn?: boolean }) {
  return (
    <div className={`rounded-xl border p-5 ${warn ? 'border-red-200 bg-red-50' : 'border-gnu-line bg-white'}`}>
      <p className={`text-sm ${warn ? 'text-red-700' : 'text-gnu-muted'}`}>{label}</p>
      <p className={`mt-1 text-3xl font-bold ${warn ? 'text-red-700' : 'text-gnu-navy'}`}>{value}</p>
    </div>
  )
}

export function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-gnu-line">
      <table className="w-full min-w-[720px] border-collapse text-[15px] [&_tbody_tr]:odd:bg-white [&_tbody_tr]:even:bg-slate-50/60 [&_tbody_tr]:hover:bg-gnu-sky/50 [&_tbody_tr]:transition-colors">
        <thead>
          <tr className="border-b border-gnu-line bg-gnu-sky text-left text-sm font-semibold text-gnu-navy">
            {head.map((h) => (
              <th key={h} className="whitespace-nowrap px-3 py-2.5 font-semibold">
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
  return <td className={`border-b border-gnu-line px-3 py-2.5 align-middle ${className}`}>{children}</td>
}

// 버튼은 폼 처리 중 표시가 필요해 클라이언트 컴포넌트로 분리했다
export { Button } from './Button'

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      {children}
    </label>
  )
}

export const inputClass =
  'mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-[15px] focus:border-gnu-blue focus:outline-none focus:ring-2 focus:ring-gnu-blue/30'

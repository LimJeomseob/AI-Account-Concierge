'use client'
/**
 * 관리자 버튼 — 서버 액션 폼 안에서 누르면 응답이 올 때까지 「처리 중…」으로 바뀌고 다시 누를 수 없다.
 * (반응 속도 개선: 누른 직후 화면 변화가 없어 느리게 느껴지고 두 번 누르는 일을 막는다)
 */
import { useFormStatus } from 'react-dom'

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost' | 'danger'
  size?: 'sm' | 'md'
}) {
  const { pending } = useFormStatus()
  const busy = pending && rest.type !== 'button'
  const base =
    'inline-flex items-center justify-center rounded-md font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gnu-blue/40'
  const sizing = size === 'sm' ? 'px-3 py-1.5 text-[13px]' : 'px-4 py-2 text-sm'
  const style =
    variant === 'primary'
      ? 'bg-gnu-navy text-white hover:bg-gnu-navy-dark'
      : variant === 'danger'
        ? 'border border-red-300 bg-white text-red-700 hover:bg-red-50'
        : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
  return (
    <button
      {...rest}
      disabled={rest.disabled || busy}
      aria-busy={busy || undefined}
      className={`${base} ${sizing} ${style} ${rest.className ?? ''}`}
    >
      {busy ? '처리 중…' : children}
    </button>
  )
}

'use client'

/** 사용현황 목록 일괄 처리용 작은 클라이언트 컴포넌트 */
import { Button } from '@/components/ui'

/** 확인창을 띄운 뒤 같은 폼을 지정한 서버 액션으로 제출한다. 선택이 없으면 막는다 */
export function ConfirmSubmit({
  action,
  label,
  confirm,
  variant = 'ghost',
}: {
  action: (fd: FormData) => Promise<void>
  label: string
  confirm: string
  variant?: 'primary' | 'ghost' | 'danger'
}) {
  return (
    <Button
      formAction={action}
      variant={variant}
      onClick={(e) => {
        const form = e.currentTarget.form
        const n = form ? new FormData(form).getAll('ids').length : 0
        if (n === 0) {
          e.preventDefault()
          window.alert('목록에서 처리할 건을 먼저 선택해 주세요.')
          return
        }
        if (!window.confirm(confirm.replace('{n}', String(n)))) e.preventDefault()
      }}
    >
      {label}
    </Button>
  )
}

/** 표 머리글의 전체 선택 — 같은 폼 안에서 선택 가능한(비활성 아닌) 체크박스만 */
export function SelectAll() {
  return (
    <input
      type="checkbox"
      aria-label="전체 선택"
      onChange={(e) => {
        const form = e.currentTarget.form
        if (!form) return
        form.querySelectorAll<HTMLInputElement>('input[name="ids"]:not(:disabled)').forEach((c) => {
          c.checked = e.currentTarget.checked
        })
      }}
    />
  )
}

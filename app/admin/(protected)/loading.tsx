/** 관리자 화면 이동 중 표시 — 서버 응답을 기다리는 동안 바로 보여 준다 */
export default function Loading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      <p className="text-sm text-slate-500">불러오는 중…</p>
      <div className="h-7 w-48 animate-pulse rounded bg-slate-200" />
      <div className="h-32 animate-pulse rounded-lg bg-slate-100" />
      <div className="h-64 animate-pulse rounded-lg bg-slate-100" />
    </div>
  )
}

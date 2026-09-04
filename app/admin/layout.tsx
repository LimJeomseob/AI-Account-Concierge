/** /admin 공통 래퍼 — 인증이 필요한 화면은 (protected) 그룹의 레이아웃이 담당한다. */
export default function AdminRootLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}

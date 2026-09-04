import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'AI 유료계정 관리시스템 · 경상국립대학교 AI융합원',
  description: '2026학년도 하반기 AI 유료계정 지원 계획 운영 시스템',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  )
}

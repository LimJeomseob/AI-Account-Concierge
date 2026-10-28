/** 공통 하단 푸터 — 진회색 배경 */
import { L } from '@/lib/labels'

export default function SiteFooter() {
  return (
    <footer className="w-full bg-gnu-ink text-sm text-slate-300">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-6 py-8 md:flex-row md:items-center md:justify-between">
        <div className="space-y-1">
          <p className="font-medium text-white">
            {L.org} · {L.app}
          </p>
          <p className="text-slate-400">© 2026 Gyeongsang National University. All rights reserved.</p>
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-slate-400">
          <a
            href="https://www.gnu.ac.kr"
            target="_blank"
            rel="noopener noreferrer"
            className="transition hover:text-white"
          >
            경상국립대학교
          </a>
          <span>AI융합원 문의: 관리자에게 문의</span>
        </div>
      </div>
    </footer>
  )
}

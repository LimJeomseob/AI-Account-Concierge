'use client'

/**
 * 사용현황 목록 스크롤 창 (2026-11-18)
 * 표를 「머리글 + visibleRows 건」 높이의 창에 넣고, 그 안에서 한 건(행) 단위로 맞물려 스크롤한다.
 * 행 높이가 일정하지 않아(재신청 표시·회수 체크 단추) 실제 높이를 재서 max-height 를 정한다.
 * 창은 화면 높이를 넘지 않는다(SCREEN_CAP) — 화면이 작으면 visibleRows 건보다 적게 보이고 나머지는 스크롤. 모든 행은 DOM 에 그대로 있다(전체 선택·일괄 처리 동작 불변).
 */
import { useLayoutEffect, useRef, type ReactNode } from 'react'

/** 창 높이 상한 — 화면 높이에서 위아래 여백을 뺀 값(창 전체가 한 화면에 들어오게) */
const SCREEN_CAP = 'calc(100dvh - 6rem)'

export default function ScrollWindow({ visibleRows = 30, children }: { visibleRows?: number; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const box = ref.current
    if (!box) return
    const measure = () => {
      const head = box.querySelector('thead')
      const rows = box.querySelectorAll<HTMLTableRowElement>('tbody > tr')
      const headH = head?.getBoundingClientRect().height ?? 0
      box.style.scrollPaddingTop = `${headH}px`
      // 창이 화면보다 길어지지 않게 화면 높이로도 막는다 — 작은 화면에서는 30건보다 적게 보인다
      if (rows.length <= visibleRows) {
        box.style.maxHeight = SCREEN_CAP
        return
      }
      const bodyH = rows[visibleRows].getBoundingClientRect().top - rows[0].getBoundingClientRect().top
      // 가로 스크롤바가 생기면 그 높이만큼 더해 30건이 가려지지 않게 한다
      const barH = box.offsetHeight - box.clientHeight
      box.style.maxHeight = `min(${Math.ceil(headH + bodyH + barH)}px, ${SCREEN_CAP})`
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(box)
    const table = box.querySelector('table')
    if (table) ro.observe(table) // 조회 조건이 바뀌어 행이 달라지거나 줄바꿈으로 높이가 변할 때
    return () => ro.disconnect()
  }, [visibleRows, children])

  return (
    <div ref={ref} className="snap-y snap-mandatory overflow-auto overscroll-contain rounded-lg border border-gnu-line">
      {children}
    </div>
  )
}

/**
 * 시드 데이터 (PRD §9-1)
 * 출처: 하반기 교육계획 담당자지정표 2026.8.26. 회의 결과.
 * 재직자교육의 대상 「지역민」은 제안값 — 관리자가 변경 가능.
 */
import type { ProgramTarget } from '@/lib/types'

export interface ProgramSeed {
  group: string
  name: string
  target: ProgramTarget
  season: string
}

export const PROGRAM_SEED: ProgramSeed[] = [
  { group: '학생교육', name: '초·중급 온라인 특강 2차', target: '학생', season: '2026. 8.' },
  { group: '학생교육', name: '초·중급 온라인 특강 3차', target: '학생', season: '2026. 11.' },
  { group: '학생교육', name: '초·중급 온라인 특강 4차', target: '학생', season: '2027. 1.' },
  { group: '학생교육', name: '중·고급 GNU AI Pioneer', target: '학생', season: '2026. 9.~11.' },
  { group: '학생교육', name: '중급 프로젝트 중심 AI 활용 캠프', target: '학생', season: '2026. 11.' },
  { group: '학생교육', name: '고급 프로젝트 중심 AI 활용 캠프', target: '학생', season: '2027. 1.' },
  { group: '학생교육', name: '중·고급 워크숍 2차', target: '학생', season: '2026. 9.~10.' },
  { group: '학생교육', name: '중·고급 워크숍 3차', target: '학생', season: '2026. 12.~2027. 1.' },
  { group: '교원교육', name: '초·중·고급 AI활용 연구모임 운영', target: '교원', season: '2026. 9.~11.' },
  { group: '교원교육', name: 'AXIS 인증 교수법 워크숍', target: '교원', season: '2026. 10.' },
  { group: '직원교육', name: '초급 업무 효율화 기초 외 교육 2차', target: '직원', season: '2026. 9.~10.' },
  { group: '직원교육', name: '중급 교육과정', target: '직원', season: '2026. 10.~11.' },
  { group: '직원교육', name: '고급 교육과정', target: '직원', season: '2026. 12.~2027. 1.' },
  { group: '직원교육', name: '초급 온라인 교육과정', target: '직원', season: '2026. 9.~12.' },
  { group: '직원교육', name: '중·고급 워크숍(2회~3회)', target: '직원', season: '2026. 12.~2027. 2.' },
  { group: '윤리교육', name: 'AI 윤리교육(인증)', target: '혼합', season: '2026. 9.' },
  { group: '윤리교육', name: 'AI활용 윤리', target: '혼합', season: '미정' },
  { group: '재직자교육', name: '중·고급 GNU AI 노바투스 아카데미아 프로그램', target: '지역민', season: '2026. 9.~2027. 1.' },
  { group: '재직자교육', name: '초·중급 RAG 기반 리더십 AI 활용 교육', target: '지역민', season: '2026. 10.~2027. 1.' },
  { group: '재직자교육', name: '초급 산업체 재직자 AI 교육(TP 협업)', target: '지역민', season: '2026. 10.' },
  { group: '재직자교육', name: '공공기관 대상 AI활용 교육', target: '지역민', season: '2026. 9.~2027. 1.' },
  { group: '지역민교육', name: '초·중급 생성형 AI 활용 교육 서비스를 위한 강사 양성', target: '지역민', season: '2026. 10.~12.' },
  { group: '지역민교육', name: '초·중급 교육청 연계 ROBLOX 기반 AI 활용 교육', target: '지역민', season: '2026. 11.~2027. 1.' },
  { group: '지역민교육', name: '초·중급 정보 소외 계층 대상 맞춤형 AI 활용 교육', target: '지역민', season: '2026. 11.~2027. 1.' },
]

/** 한글 UI 라벨·배지 색상 (PRD §7 UI 원칙) */

export const L = {
  app: 'AI 유료계정 관리시스템',
  org: '경상국립대학교 AI융합원',
  menu: {
    dashboard: '대시보드',
    assignments: '신청·배정',
    programs: '프로그램',
    accounts: '계정',
    users: '사용자',
    incidents: '장애',
    reports: '실적',
    settings: '설정',
    logs: '로그',
  },
  assignment: {
    id: '배정ID',
    program: '프로그램',
    name: '이름',
    email: '이메일',
    wish: '희망 서비스',
    account: '계정',
    service: '서비스',
    status: '상태',
    applied_at: '신청일시',
    approved_on: '승인일',
    assigned_on: '배정일',
    rent: '대여기간',
    notified_at: '발송일시',
    acknowledged_at: '인수확인',
    returned_at: '회수완료',
    note: '비고',
  },
  checklist: {
    chk_delete_chats: '대화·메모리 삭제',
    chk_team_removed: '팀에서 제거(접속 차단)',
  },
  account: {
    id: '계정ID',
    service: '서비스',
    kind: '구분',
    activated_on: '활성화일',
    expires_on: '만료일',
    status: '상태',
    current: '현재 배정',
    assigned_days: '배정일수',
    assigned_count: '배정횟수',
    alert: '알림',
    login_email: '로그인 이메일',
    access_url: '접속 링크',
  },
  program: {
    id: '프로그램ID',
    name: '프로그램명',
    target: '대상',
    mode: '대여방식',
    days: '대여일수',
    start_on: '시작일',
    end_on: '종료일',
    cap: '배정상한',
    status: '상태',
    avail: '배정가능',
  },
} as const

/** 프로그램 상태 순서 (PRD §4-1: 시작전 → 진행중 → 완료) */
export const PROGRAM_STATUSES = ['시작전', '진행중', '완료'] as const

/** 상태 배지 색상 (PRD §7) */
export const STATUS_BADGE: Record<string, string> = {
  신청: 'bg-slate-100 text-slate-700 border-slate-200',
  승인: 'bg-blue-100 text-blue-700 border-blue-200',
  배정: 'bg-indigo-100 text-indigo-700 border-indigo-200',
  사용중: 'bg-green-100 text-green-700 border-green-200',
  회수중: 'bg-orange-100 text-orange-700 border-orange-200',
  회수완료: 'bg-slate-100 text-slate-500 border-slate-200',
  반려: 'bg-red-100 text-red-700 border-red-200',
  취소: 'bg-red-100 text-red-700 border-red-200',
  인수기한초과: 'bg-red-100 text-red-700 border-red-200',
  // 계정
  가용: 'bg-green-100 text-green-700 border-green-200',
  정지: 'bg-red-100 text-red-700 border-red-200',
  만료: 'bg-slate-100 text-slate-500 border-slate-200',
  // 프로그램 (시작전 → 진행중 → 완료)
  시작전: 'bg-amber-100 text-amber-800 border-amber-200',
  진행중: 'bg-green-100 text-green-700 border-green-200',
  // 좌석 접속 링크
  등록: 'bg-green-100 text-green-700 border-green-200',
  미등록: 'bg-red-100 text-red-700 border-red-200',
  // 기타
  접수: 'bg-blue-100 text-blue-700 border-blue-200',
  처리중: 'bg-amber-100 text-amber-800 border-amber-200',
  완료: 'bg-slate-100 text-slate-500 border-slate-200',
  pending: 'bg-amber-100 text-amber-800 border-amber-200',
  sent: 'bg-green-100 text-green-700 border-green-200',
  failed: 'bg-red-100 text-red-700 border-red-200',
}

/** 회수 체크리스트 (R24) — ① 대화·메모리 삭제 ② 팀에서 제거 */
export const CHECKLIST_FIELDS = ['chk_delete_chats', 'chk_team_removed'] as const

/** 서비스별 안내 문구 (PRD §8) */
export const SERVICE_INFO = {
  GPT: {
    name: 'ChatGPT Team',
    loginUrl: 'https://chatgpt.com',
    optOut: '설정 > 데이터 제어 > "모두를 위한 모델 개선" 끄기',
    returnSteps:
      '설정 > 데이터 제어 > 모든 채팅 삭제, 개인 맞춤 설정 > 메모리 모두 삭제, 보안 > 모든 기기에서 로그아웃',
  },
  Claude: {
    name: 'Claude Team',
    loginUrl: 'https://claude.ai',
    optOut: '설정 > 개인정보 > "Claude 개선에 도움" 끄기',
    returnSteps: '모든 대화 삭제, 메모리·프로젝트 삭제, 모든 기기 로그아웃',
  },
} as const

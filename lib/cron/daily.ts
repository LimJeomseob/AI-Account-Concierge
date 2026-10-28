/**
 * 일일 작업 (PRD §11) — 매일 09:00 KST.
 * 순서는 멱등(R32): 같은 날 두 번 실행해도 결과가 같다.
 * 2026-10-29: 관리자 일일 점검 메일·구독 만료 처리·정지율 경고 폐지 — 실패는 대시보드 배너와
 * /api/health?strict=1 로 알린다.
 */
import 'server-only'
import { db } from '@/lib/db'
import { todayKST } from '@/lib/date'
import { markOk, withLock } from '@/lib/lock'
import { rebuildAlerts } from '@/lib/alerts'
import { dispatchQueue, type DispatchResult } from '@/lib/mail/dispatch'
import { log } from '@/lib/state'
import { endExpiredRentals } from '@/lib/ops/assignments'
import { refreshAccountStats } from '@/lib/ops/accounts'

export interface DailyError {
  step: string
  message: string
}

export interface DailyResult {
  today: string
  rent_ended: string[]
  alerts: number
  mail: DispatchResult
  stats_updated: number
  /** 실패한 단계. 비어 있지 않으면 cron 응답이 500 이 되고 대시보드에 경고가 뜬다 */
  errors: DailyError[]
  /** 다른 실행이 잠금을 쥐고 있어 건너뜀 (cron 과 「지금 실행」 버튼 동시 실행) */
  skipped?: 'locked'
}

/** 일일 작업 잠금 TTL — 정상 실행은 수 분 이내. 비정상 종료로 남은 잠금은 이 시간 뒤 인수된다 */
const DAILY_LOCK_TTL_MS = 15 * 60 * 1000

function emptyResult(today: string): DailyResult {
  return {
    today,
    rent_ended: [],
    alerts: 0,
    mail: { sent: 0, failed: 0, remaining: 0 },
    stats_updated: 0,
    errors: [],
  }
}

export async function runDaily(actor = 'system', today: string = todayKST()): Promise<DailyResult> {
  const r = await withLock('cron.daily', DAILY_LOCK_TTL_MS, () => runDailyUnlocked(actor, today))
  if (r.locked) {
    await log(actor, 'cron.daily.skip', null, { today, reason: 'locked' })
    return { ...emptyResult(today), skipped: 'locked' }
  }
  return r.value
}

async function runDailyUnlocked(actor: string, today: string): Promise<DailyResult> {
  await log(actor, 'cron.daily.start', null, { today })
  const errors: DailyError[] = []

  /** 단계 실행: 실패해도 다음 단계로 넘어가고 오류를 모은다(한 단계 실패로 나머지가 멈추지 않게) */
  async function step<T>(name: string, fn: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await fn()
    } catch (e) {
      const message = ((e as Error)?.message ?? String(e)).slice(0, 500)
      errors.push({ step: name, message })
      console.error(`[cron.daily] ${name} 실패:`, message)
      await log(actor, 'cron.daily.error', null, { today, step: name, message })
      return fallback
    }
  }

  // 1. (폐지) 프로그램 자동 종료 — 상태 전환은 관리자 드롭다운 수동 (구 R4)

  // 2. (폐지) 미인수 자동 취소 — 인수 확인 단계가 없어졌다 (구 R19, 2026-10-28)

  // 3. 대여 종료 → 회수중 (R20). 접근 차단은 관리자 회수 체크리스트(R24)
  const rentEnded = await step('대여 종료', () => endExpiredRentals(today), [] as string[])

  // 3-1. alerts·accounts.alert 재생성 (R22)
  const alertCount = await step('회수 알림 재생성', () => rebuildAlerts(today), 0)

  // 4. (폐지 2026-10-29) 승인 대기 자동 배정 — 배정은 「승인 건 배정 + 메일 내려받기」로만(R14)

  // 5. 메일 대기열 발송
  const mail = await step('메일 발송', () => dispatchQueue(), { sent: 0, failed: 0, remaining: 0 })

  // 6. 계정 통계 갱신 (R25)
  const statsUpdated = await step('계정 통계', () => refreshAccountStats(today), 0)

  // 7. (폐지) 구독 만료 처리 — 2026-10-29. 만료는 계정 화면에서 수동 전환
  // 8. (폐지) 관리자 일일 점검 메일 — 2026-10-29

  const result: DailyResult = {
    today,
    rent_ended: rentEnded,
    alerts: alertCount,
    mail,
    stats_updated: statsUpdated,
    errors,
  }
  await log(actor, 'cron.daily.done', null, result as unknown as Record<string, unknown>)
  // 모든 단계가 성공했을 때만 「마지막 성공」 갱신 → /api/health 가 오래되면 503 (외부 감시 알림 근거)
  if (errors.length === 0) await markOk('cron.daily')
  return result
}

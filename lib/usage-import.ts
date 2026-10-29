/**
 * 사용현황 CSV 일괄 등록 — 순수 함수 (서버·브라우저 공용, server-only 금지)
 * 2026-10-29: 팀 워크스페이스 실사용자 반영을 SQL 대신 화면에서 한다.
 *
 * CSV 열(머리글 이름으로 찾는다, 순서 무관):
 *   필수  이름 · 이메일 · 플랫폼(ChatGPT/GPT/Claude)
 *   선택  프로그램(이름 또는 번호) · 계정번호 · 사용시작 · 사용종료 (또는 사용기간 「2026-10-01~2026-12-31」)
 * 등록 상태는 화면에서 고른다: 「사용중」(계정 배정) 또는 「회수완료」(지난 사용 이력)
 */

export type ImportMode = '사용중' | '회수완료'
export type Platform = 'GPT' | 'Claude'

export interface ImportRow {
  line: number
  name: string
  email: string
  service: Platform | null
  program: string
  account: string
  start: string | null
  end: string | null
  errors: string[]
}

export const MAX_IMPORT_ROWS = 1000

export const IMPORT_TEMPLATE =
  '﻿이름,이메일,플랫폼,프로그램,계정번호,사용시작,사용종료\n홍길동,hong@gnu.ac.kr,Claude,연구모임(Claude),,2026-10-01,\n'

const HEADER_ALIASES: Record<string, string[]> = {
  name: ['이름', '성명', 'name'],
  email: ['이메일', '메일', 'email', 'e-mail'],
  service: ['플랫폼', '서비스', 'platform', 'service'],
  program: ['프로그램', '프로그램명', 'program'],
  account: ['계정번호', '계정', 'account', 'account_id'],
  start: ['사용시작', '시작일', '대여시작', '사용개시', 'start'],
  end: ['사용종료', '종료일', '대여종료', 'end'],
  period: ['사용기간', '대여기간', 'period'],
}

/** 쉼표 구분 + 큰따옴표 묶음("a,b", "" → ") — 한 줄 단위 */
export function splitLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"'
        i++
      } else if (c === '"') quoted = false
      else cur += c
    } else if (c === '"') quoted = true
    else if (c === ',') {
      out.push(cur)
      cur = ''
    } else cur += c
  }
  out.push(cur)
  return out.map((s) => s.trim())
}

/** ChatGPT·GPT·OpenAI → GPT, Claude → Claude, 그 외 null */
export function parsePlatform(v: string): Platform | null {
  const s = v.trim().toLowerCase().replace(/\s+/g, '')
  if (!s) return null
  if (['gpt', 'chatgpt', 'openai', 'chatgptbusiness', 'chatgptbusinessstandard'].includes(s) || s.startsWith('chatgpt')) return 'GPT'
  if (s === 'claude' || s.startsWith('claude')) return 'Claude'
  return null
}

/** 2026-10-29 · 2026.10.29 · 2026/10/29 · 20261029 · 「2026. 10. 29.」 → 2026-10-29. 빈 값 null, 잘못된 값 'invalid' */
export function parseYmd(v: string | null | undefined): string | null | 'invalid' {
  const s = (v ?? '').trim().replace(/\.$/, '')
  if (!s) return null
  const m = s.match(/^(\d{4})\s*[-./]\s*(\d{1,2})\s*[-./]\s*(\d{1,2})$/) ?? s.match(/^(\d{4})(\d{2})(\d{2})$/)
  if (!m) return 'invalid'
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const dt = new Date(Date.UTC(y, mo - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return 'invalid'
  return `${m[1]}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

const EMAIL_RE = /^[^\s@,;<>"']+@[^\s@,;<>"']+\.[^\s@,;<>"']+$/

/** CSV 텍스트 → 행 (머리글 필수). 행별 형식 오류는 errors 에 담는다 */
export function parseUsageCsv(text: string): { rows: ImportRow[]; error?: string } {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/)
  const headerIdx = lines.findIndex((l) => l.trim() !== '')
  if (headerIdx < 0) return { rows: [], error: '빈 파일입니다.' }
  const header = splitLine(lines[headerIdx]).map((h) => h.replace(/^﻿/, '').trim().toLowerCase())
  const col: Record<string, number> = {}
  for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
    const i = header.findIndex((h) => aliases.map((a) => a.toLowerCase()).includes(h))
    if (i >= 0) col[key] = i
  }
  const missing = ['name', 'email', 'service'].filter((k) => col[k] === undefined)
  if (missing.length > 0) {
    const label: Record<string, string> = { name: '이름', email: '이메일', service: '플랫폼' }
    return { rows: [], error: `머리글에 필수 열이 없습니다: ${missing.map((k) => label[k]).join(', ')}` }
  }

  const rows: ImportRow[] = []
  for (let i = headerIdx + 1; i < lines.length; i++) {
    if (lines[i].trim() === '') continue
    const cells = splitLine(lines[i])
    const get = (k: string) => (col[k] === undefined ? '' : (cells[col[k]] ?? '').trim())
    const errors: string[] = []
    const name = get('name')
    const email = get('email').toLowerCase()
    const rawService = get('service')
    const service = parsePlatform(rawService)
    if (!name) errors.push('이름 없음')
    if (!email) errors.push('이메일 없음')
    else if (!EMAIL_RE.test(email)) errors.push('이메일 형식 오류')
    if (!service) errors.push(rawService ? `플랫폼 「${rawService}」 인식 불가(ChatGPT·Claude)` : '플랫폼 없음')

    let startRaw = get('start')
    let endRaw = get('end')
    const period = get('period')
    if (period && !startRaw && !endRaw) {
      const [a, b] = period.split(/\s*[~∼]\s*/)
      startRaw = a ?? ''
      endRaw = b ?? ''
    }
    const start = parseYmd(startRaw)
    const end = parseYmd(endRaw)
    if (start === 'invalid') errors.push(`사용시작 「${startRaw}」 날짜 형식 오류`)
    if (end === 'invalid') errors.push(`사용종료 「${endRaw}」 날짜 형식 오류`)
    if (start && end && start !== 'invalid' && end !== 'invalid' && start > end) errors.push('사용시작이 사용종료보다 늦음')

    rows.push({
      line: i + 1,
      name,
      email,
      service,
      program: get('program'),
      account: get('account').toUpperCase(),
      start: start === 'invalid' ? null : start,
      end: end === 'invalid' ? null : end,
      errors,
    })
    if (rows.length > MAX_IMPORT_ROWS) return { rows: [], error: `한 번에 ${MAX_IMPORT_ROWS}행까지 올릴 수 있습니다.` }
  }
  if (rows.length === 0) return { rows: [], error: '데이터 행이 없습니다.' }
  return { rows }
}

export interface PlanContext {
  mode: ImportMode
  today: string
  /** CSV 에 프로그램이 비어 있을 때 쓸 프로그램 번호 */
  defaultProgramId: string | null
  programs: Array<{ id: string; name: string }>
  accounts: Array<{ id: string; service: string; status: string; kind: string }>
  /** 「이메일|플랫폼」 — 이미 배정·사용중·회수중인 조합 */
  activeKeys: Set<string>
  /** 「프로그램|이메일」 — 같은 프로그램에 신청~회수완료 건이 이미 있는 조합(R9 중복 방지 인덱스) */
  programEmailKeys: Set<string>
}

export interface PlanItem {
  line: number
  name: string
  email: string
  service: Platform | null
  programId: string | null
  programName: string
  accountId: string | null
  start: string | null
  end: string | null
  action: 'new' | 'skip' | 'error'
  msg: string
}

/** 행 → 등록 계획 (계정 자동 선택 포함). DB 를 바꾸지 않는다 */
export function planImport(rows: ImportRow[], ctx: PlanContext): PlanItem[] {
  const byId = new Map(ctx.programs.map((p) => [p.id.toUpperCase(), p]))
  const byName = new Map(ctx.programs.map((p) => [p.name.trim().toLowerCase(), p]))
  const accounts = new Map(ctx.accounts.map((a) => [a.id.toUpperCase(), a]))
  const reserved = new Set<string>()
  const seenActive = new Set<string>()
  const seenProgram = new Set<string>()
  const pool = (service: string) =>
    ctx.accounts
      .filter((a) => a.service === service && a.status === '가용' && a.kind === '운영')
      .map((a) => a.id)
      .sort()

  // 계정번호를 직접 적은 행이 먼저 그 계정을 쓰도록 미리 예약
  if (ctx.mode === '사용중') for (const r of rows) if (r.account && r.errors.length === 0) reserved.add(r.account)

  return rows.map((r) => {
    const program = r.program ? byId.get(r.program.toUpperCase()) ?? byName.get(r.program.trim().toLowerCase()) : undefined
    const programId = program?.id ?? (r.program ? null : ctx.defaultProgramId)
    const programName = program?.name ?? (r.program || ctx.programs.find((p) => p.id === ctx.defaultProgramId)?.name || '')
    const base = {
      line: r.line,
      name: r.name,
      email: r.email,
      service: r.service,
      programId,
      programName,
      accountId: null as string | null,
      start: ctx.mode === '사용중' ? r.start ?? ctx.today : r.start,
      end: ctx.mode === '회수완료' ? r.end ?? ctx.today : r.end,
    }
    const fail = (msg: string): PlanItem => ({ ...base, action: 'error', msg })
    if (r.errors.length > 0) return fail(r.errors.join(' · '))
    if (!programId) return fail(r.program ? `프로그램 「${r.program}」 없음` : '프로그램 없음 — 기본 프로그램을 고르거나 CSV 에 적어 주세요')
    // 「…(Claude)」「…(ChatGPT)」처럼 플랫폼별 프로그램이면 행의 플랫폼과 맞아야 한다(기본 프로그램 실수 방지)
    const tag = programName.match(/\((ChatGPT|Claude)\)\s*$/)?.[1]
    if (tag && (tag === 'ChatGPT' ? 'GPT' : 'Claude') !== r.service) {
      return fail(`프로그램 「${programName}」 는 ${tag} 전용 — 플랫폼이 다름`)
    }

    const activeKey = `${r.email}|${r.service}`
    const programKey = `${programId}|${r.email}`
    if (ctx.mode === '사용중' && (ctx.activeKeys.has(activeKey) || seenActive.has(activeKey))) {
      return { ...base, action: 'skip', msg: seenActive.has(activeKey) ? '파일 안에서 같은 이메일·플랫폼 중복' : '이미 사용중 — 건너뜀' }
    }
    if (ctx.programEmailKeys.has(programKey)) return fail('같은 프로그램에 이 이메일의 신청~회수완료 건이 이미 있음(R9)')
    if (seenProgram.has(programKey)) return fail('파일 안에서 같은 프로그램·이메일 중복')

    let accountId: string | null = null
    if (r.account) {
      const acc = accounts.get(r.account)
      if (!acc) return fail(`계정번호 「${r.account}」 없음`)
      if (acc.service !== r.service) return fail(`계정번호 ${r.account} 는 ${acc.service} 계정`)
      if (ctx.mode === '사용중') {
        if (acc.status !== '가용') return fail(`계정번호 ${r.account} 상태 「${acc.status}」 — 가용 계정만 배정`)
        if (seenActive.has(`acc:${acc.id}`)) return fail(`계정번호 ${r.account} 를 파일 안에서 두 번 사용`)
        seenActive.add(`acc:${acc.id}`)
      }
      accountId = acc.id
    } else if (ctx.mode === '사용중') {
      accountId = pool(r.service as string).find((id) => !reserved.has(id)) ?? null
      if (!accountId) return fail(`${r.service === 'GPT' ? 'ChatGPT' : 'Claude'} 가용 계정 부족`)
      reserved.add(accountId)
    }

    seenActive.add(activeKey)
    seenProgram.add(programKey)
    return { ...base, accountId, action: 'new', msg: ctx.mode === '사용중' ? '사용중 등록' : '회수완료 이력 등록' }
  })
}

/** 미리보기 요약 문구 (순수 함수) */
export function planSummary(items: PlanItem[]): string {
  const n = (a: PlanItem['action']) => items.filter((x) => x.action === a).length
  return `전체 ${items.length}행 · 등록 ${n('new')} · 건너뜀 ${n('skip')} · 오류 ${n('error')}`
}

/**
 * 사용현황 CSV 일괄 등록 — 순수 함수 (서버·브라우저 공용, server-only 금지)
 * 2026-10-29: 팀 워크스페이스 실사용자 반영을 SQL 대신 화면에서 한다.
 *
 * CSV 열(머리글 이름으로 찾는다, 순서 무관):
 *   필수  이름 · 이메일 · 플랫폼(ChatGPT/GPT/Claude)
 *   선택  프로그램(이름 또는 번호) · 사용시작 · 사용종료 (또는 사용기간 「2026-10-01~2026-12-31」)
 * 계정번호 열은 양식에 없다(2026-10-29). 열이 있어도 무시하고, 「사용중」은 업로드 후 가용 계정을 번호 순으로 자동 부여한다(R14).
 * 가용 계정 수와 상관없이 기록은 저장한다 — 가용 계정이 없으면 「사용중」을 계정 없이 저장(회수완료는 원래 계정 없음).
 * 등록 상태는 화면에서 고른다: 「사용중」(계정 배정) 또는 「회수완료」(지난 사용 이력)
 * 2026-11-18: 프로그램 칸은 느슨하게 찾는다(resolveProgram — 「직원 중급 교육과정」 = 「중급 교육과정」),
 *   양식 예시 행(홍길동)은 오류, 「사용중」으로 올려도 사용종료가 지난 행은 「회수완료」로 등록한다.
 */

export type ImportMode = '사용중' | '회수완료'
export type Platform = 'GPT' | 'Claude'

export interface ImportRow {
  line: number
  name: string
  email: string
  service: Platform | null
  program: string
  start: string | null
  end: string | null
  errors: string[]
}

export const MAX_IMPORT_ROWS = 1000

export const IMPORT_TEMPLATE =
  '﻿이름,이메일,플랫폼,프로그램,사용시작,사용종료\n홍길동,hong@gnu.ac.kr,Claude,초·중·고급 AI활용 연구모임 운영,2026-10-01,\n'

const HEADER_ALIASES: Record<string, string[]> = {
  name: ['이름', '성명', 'name'],
  email: ['이메일', '메일', 'email', 'e-mail'],
  service: ['플랫폼', '서비스', 'platform', 'service'],
  program: ['프로그램', '프로그램명', 'program'],
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
      start: start === 'invalid' ? null : start,
      end: end === 'invalid' ? null : end,
      errors,
    })
    if (rows.length > MAX_IMPORT_ROWS) return { rows: [], error: `한 번에 ${MAX_IMPORT_ROWS}행까지 올릴 수 있습니다.` }
  }
  if (rows.length === 0) return { rows: [], error: '데이터 행이 없습니다.' }
  return { rows }
}

export interface ProgramRef {
  id: string
  name: string
  /** 대상(교원·직원·학생·지역민·혼합) — 있으면 「직원 중급 교육과정」 같은 접두어 대조에 쓴다 */
  target?: string | null
}

export type ProgramMatch =
  | { program: ProgramRef; loose: boolean }
  | { program: null; reason: 'none' | 'ambiguous'; similar: ProgramRef[] }

/** 이름 비교용 — 공백·가운뎃점·괄호·하이픈·물결·대소문자 차이를 없앤다 */
export function normProgram(s: string): string {
  return s
    .normalize('NFC')
    .toLowerCase()
    .replace(/[\s·ㆍ・･.,\-_~∼()（）[\]「」]/g, '')
}

const TARGET_WORDS = ['교원', '직원', '학생', '지역민']
/** 프로그램 이름 앞에 흔히 붙여 쓰는 대상·분류 낱말 (「직원 중급 교육과정」「직원교육 중급 교육과정」) */
const PREFIX_WORDS = [...TARGET_WORDS, '재직자', '윤리']

/**
 * CSV 의 프로그램 칸 → 등록된 프로그램 (2026-11-18)
 * 번호 → 이름 → 정규화한 이름 → 대상·분류 접두어를 뗀 이름 순서로 찾고, 후보가 하나일 때만 채택한다.
 * 번호·이름이 글자 그대로 맞지 않으면 loose = true (미리보기 메모에 알린다).
 */
export function resolveProgram(input: string, programs: ProgramRef[]): ProgramMatch {
  const raw = input.trim()
  const exact =
    programs.find((p) => p.id.toUpperCase() === raw.toUpperCase()) ??
    programs.find((p) => p.name.trim().toLowerCase() === raw.toLowerCase())
  if (exact) return { program: exact, loose: false }

  const key = normProgram(raw)
  const similar = () =>
    key.length < 2
      ? []
      : programs
          .filter((p) => {
            const n = normProgram(p.name)
            return n.length >= 2 && (n.includes(key) || key.includes(n))
          })
          .slice(0, 3)
  if (!key) return { program: null, reason: 'none', similar: [] }

  const pick = (c: ProgramRef[]): ProgramMatch | null =>
    c.length === 1 ? { program: c[0], loose: true } : c.length > 1 ? { program: null, reason: 'ambiguous', similar: c.slice(0, 3) } : null

  const byNorm = pick(programs.filter((p) => normProgram(p.name) === key))
  if (byNorm) return byNorm

  const byPrefix = pick(
    programs.filter((p) =>
      PREFIX_WORDS.some((w) => {
        if (key !== w + normProgram(p.name) && key !== `${w}교육${normProgram(p.name)}`) return false
        // 대상 낱말이면 그 프로그램의 대상과 맞아야 한다(대상을 모르거나 혼합이면 통과)
        return !TARGET_WORDS.includes(w) || !p.target || p.target === '혼합' || p.target === w
      }),
    ),
  )
  if (byPrefix) return byPrefix
  return { program: null, reason: 'none', similar: similar() }
}

const quoteNames = (ps: ProgramRef[]) => ps.map((p) => `「${p.name}」`).join(', ')

/** 못 찾은 프로그램의 오류 문구 */
export function programErrorMsg(input: string, m: Extract<ProgramMatch, { program: null }>): string {
  if (m.reason === 'ambiguous') return `프로그램 「${input}」 이 여러 프로그램과 겹침 — ${quoteNames(m.similar)} 중 정확한 이름으로 적어 주세요`
  return m.similar.length > 0
    ? `프로그램 「${input}」 없음 — 비슷한 이름: ${quoteNames(m.similar)}`
    : `프로그램 「${input}」 없음 — 등록된 프로그램 이름(안내창 목록)으로 적어 주세요`
}

/** 양식 예시 행(홍길동 · hong@gnu.ac.kr)을 지우지 않고 올린 경우 */
export function isExampleRow(r: { name: string; email: string }): boolean {
  return r.name.trim() === '홍길동' && r.email.trim().toLowerCase() === 'hong@gnu.ac.kr'
}

export interface PlanContext {
  mode: ImportMode
  today: string
  /** CSV 에 프로그램이 비어 있을 때 쓸 프로그램 번호 */
  defaultProgramId: string | null
  /** 사용종료 기본값은 없다 — CSV 에 적은 값만 쓴다(프로그램 기간 폐지, 2026-11-10) */
  programs: ProgramRef[]
  accounts: Array<{ id: string; service: string; status: string; kind: string }>
  /** 「이메일|플랫폼」 — 이미 배정·사용중·회수중인 조합 */
  activeKeys: Set<string>
  /**
   * 「프로그램|이메일|플랫폼」 — 같은 프로그램·플랫폼에 진행 중(신청·승인·배정·사용중) 건이 이미 있는 조합
   * (R9 중복 방지 인덱스 0009, lib/assign.ts:DUPLICATE_BLOCK_STATUSES). 「사용중」 등록에만 쓴다.
   */
  programEmailKeys: Set<string>
  /**
   * 「프로그램|이메일|플랫폼|사용시작」 — 이미 등록된 회수완료 이력(같은 파일을 두 번 올리는 것 방지).
   * DB 인덱스가 회수완료를 보지 않으므로(0009) 앱에서 막는다. 「회수완료」 등록에만 쓴다.
   */
  returnedKeys?: Set<string>
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
  /** 이 행이 실제로 등록될 상태 — 「사용중」으로 올려도 사용종료가 지난 행은 「회수완료」(2026-11-18) */
  mode: ImportMode
  action: 'new' | 'skip' | 'error'
  msg: string
}

/** 행 → 등록 계획 (계정 자동 선택 포함). DB 를 바꾸지 않는다 */
export function planImport(rows: ImportRow[], ctx: PlanContext): PlanItem[] {
  const reserved = new Set<string>()
  const seenActive = new Set<string>()
  const seenProgram = new Set<string>()
  const pool = (service: string) =>
    ctx.accounts
      .filter((a) => a.service === service && a.status === '가용' && a.kind === '운영')
      .map((a) => a.id)
      .sort()

  return rows.map((r) => {
    const found = r.program ? resolveProgram(r.program, ctx.programs) : null
    const program = found?.program ?? undefined
    const programId = program?.id ?? (r.program ? null : ctx.defaultProgramId)
    const programName = program?.name ?? (r.program || ctx.programs.find((p) => p.id === ctx.defaultProgramId)?.name || '')
    // 「사용중」으로 올려도 사용종료가 이미 지난 행은 「회수완료」 이력으로 등록한다(2026-11-18 운영자 결정)
    const mode: ImportMode = ctx.mode === '사용중' && r.end && r.end < ctx.today ? '회수완료' : ctx.mode
    const notes: string[] = []
    if (found?.program && found.loose) notes.push(`프로그램 「${r.program}」 → 「${found.program.name}」 로 인식`)
    if (mode !== ctx.mode) notes.push('사용종료가 지나 「회수완료」 이력으로 등록')
    else if (mode === '사용중' && r.end === ctx.today) notes.push('사용종료가 오늘 — 일일 작업 때 바로 회수중이 됩니다')
    const withNotes = (msg: string) => [msg, ...notes].join(' · ')
    const base = {
      line: r.line,
      name: r.name,
      email: r.email,
      service: r.service,
      programId,
      programName,
      accountId: null as string | null,
      start: mode === '사용중' ? r.start ?? ctx.today : r.start,
      end: mode === '회수완료' ? r.end ?? ctx.today : r.end,
      mode,
    }
    const fail = (msg: string): PlanItem => ({ ...base, action: 'error', msg })
    if (r.errors.length > 0) return fail(r.errors.join(' · '))
    if (isExampleRow(r)) return fail('양식 예시 행(홍길동) — 지우고 올려 주세요')
    if (!programId) {
      return fail(
        found && !found.program ? programErrorMsg(r.program, found) : '프로그램 없음 — 기본 프로그램을 고르거나 CSV 에 적어 주세요',
      )
    }
    // 「…(Claude)」「…(ChatGPT)」처럼 플랫폼별 프로그램이면 행의 플랫폼과 맞아야 한다(기본 프로그램 실수 방지)
    const tag = programName.match(/\((ChatGPT|Claude)\)\s*$/)?.[1]
    if (tag && (tag === 'ChatGPT' ? 'GPT' : 'Claude') !== r.service) {
      return fail(`프로그램 「${programName}」 는 ${tag} 전용 — 플랫폼이 다름`)
    }

    const activeKey = `${r.email}|${r.service}`
    const programKey = `${programId}|${r.email}|${r.service}`
    if (mode === '사용중' && (ctx.activeKeys.has(activeKey) || seenActive.has(activeKey))) {
      return {
        ...base,
        action: 'skip',
        msg: withNotes(seenActive.has(activeKey) ? '파일 안에서 같은 이메일·플랫폼 중복' : '이미 사용중 — 건너뜀'),
      }
    }
    // R9(2026-11-17): 회수중·회수완료 이력이 있어도 같은 프로그램에 다시 등록할 수 있다.
    //  · 사용중: 같은 프로그램·플랫폼에 진행 중 건이 있으면 오류
    //  · 회수완료: 같은 사용시작의 회수완료 이력이 이미 있으면 오류(다른 날짜의 지난 사용은 따로 남길 수 있다)
    const dupKey = mode === '회수완료' ? `${programKey}|${base.start ?? ''}` : programKey
    if (mode === '사용중' && ctx.programEmailKeys.has(programKey)) {
      return fail('같은 프로그램·플랫폼에 이 이메일의 진행 중(신청~사용중) 건이 이미 있음(R9)')
    }
    if (mode === '회수완료' && ctx.returnedKeys?.has(dupKey)) return fail('같은 사용시작의 회수완료 이력이 이미 있음')
    if (seenProgram.has(dupKey)) return fail('파일 안에서 같은 프로그램·이메일·플랫폼 중복')

    // 계정은 CSV 로 받지 않고 업로드 후 자동 부여 — 「사용중」만, 가용·운영 계정을 번호 순으로(R14)
    // 가용 계정이 모자라도 오류로 막지 않고 계정 없이 기록으로 저장한다(2026-10-29 운영자 결정)
    let accountId: string | null = null
    let msg = '회수완료 이력 등록'
    if (mode === '사용중') {
      accountId = pool(r.service as string).find((id) => !reserved.has(id)) ?? null
      if (accountId) {
        reserved.add(accountId)
        msg = '사용중 등록'
      } else msg = `사용중 기록 저장 — ${r.service === 'GPT' ? 'ChatGPT' : 'Claude'} 가용 계정이 없어 계정 미배정`
    }

    seenActive.add(activeKey)
    seenProgram.add(dupKey)
    return { ...base, accountId, action: 'new', msg: withNotes(msg) }
  })
}

/** 가장 많은 오류 사유 한 가지 — 표를 내리지 않아도 원인이 보이게 요약 옆에 붙인다 */
export function topError(items: PlanItem[]): string | null {
  const count = new Map<string, number>()
  for (const x of items) if (x.action === 'error') count.set(x.msg, (count.get(x.msg) ?? 0) + 1)
  const top = [...count.entries()].sort((a, b) => b[1] - a[1])[0]
  return top ? `${top[0]} (${top[1]}행)` : null
}

export interface PrecheckNote {
  level: 'error' | 'info'
  text: string
}

/**
 * 파일을 고른 직후 브라우저에서 보여 줄 사전 검사 (DB 없음) — 프로그램 이름·예시 행·형식 오류
 * 계정·중복 검사는 서버 미리보기(planImport)가 한다.
 */
export function importPrecheck(text: string, programs: ProgramRef[], today?: string): PrecheckNote[] {
  if (!text.trim()) return []
  const parsed = parseUsageCsv(text)
  if (parsed.error) return [{ level: 'error', text: parsed.error }]
  const notes: PrecheckNote[] = []
  const byProgram = new Map<string, number>()
  for (const r of parsed.rows) if (r.program) byProgram.set(r.program, (byProgram.get(r.program) ?? 0) + 1)
  for (const [name, n] of byProgram) {
    const m = resolveProgram(name, programs)
    if (!m.program) notes.push({ level: 'error', text: `${programErrorMsg(name, m)} (${n}행)` })
    else if (m.loose) notes.push({ level: 'info', text: `프로그램 「${name}」 → 「${m.program.name}」 로 인식 (${n}행)` })
  }
  const examples = parsed.rows.filter(isExampleRow)
  if (examples.length > 0) notes.push({ level: 'error', text: `${examples[0].line}행은 양식 예시 행(홍길동)입니다 — 지우고 올려 주세요` })
  const bad = parsed.rows.filter((r) => r.errors.length > 0)
  if (bad.length > 0) notes.push({ level: 'error', text: `형식 오류 ${bad.length}행 — 예: ${bad[0].line}행 ${bad[0].errors[0]}` })
  if (today) {
    const past = parsed.rows.filter((r) => r.end && r.end < today).length
    if (past > 0) notes.push({ level: 'info', text: `사용종료가 지난 ${past}행은 「사용중」으로 올려도 「회수완료」 이력으로 등록됩니다` })
  }
  return notes
}

/**
 * 「업로드」 단추 준비 판정 (브라우저에서 호출, DB 없음)
 * 파일이 읽혔고 머리글이 맞으며, 모든 행의 프로그램이 정해질 수 있을 때만 ready
 */
export function importReadiness(text: string, defaultProgramId: string): { ready: boolean; msg: string } {
  if (!text.trim()) return { ready: false, msg: 'CSV 파일을 고르세요' }
  const parsed = parseUsageCsv(text)
  if (parsed.error) return { ready: false, msg: parsed.error }
  const blank = parsed.rows.filter((r) => !r.program).length
  if (!defaultProgramId && blank > 0) {
    return { ready: false, msg: `프로그램이 빈 행 ${blank}건 — 기본 프로그램을 고르거나 CSV 에 프로그램을 적어 주세요` }
  }
  return { ready: true, msg: `준비 완료 · ${parsed.rows.length}행` }
}

/** 미리보기 요약 문구 (순수 함수) */
export function planSummary(items: PlanItem[]): string {
  const n = (a: PlanItem['action']) => items.filter((x) => x.action === a).length
  return `전체 ${items.length}행 · 등록 ${n('new')} · 건너뜀 ${n('skip')} · 오류 ${n('error')}`
}

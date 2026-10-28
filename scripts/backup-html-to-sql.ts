/**
 * 운영 화면 백업(HTML) → CSV·SQL 변환
 * 관리자 「신청·배정」 화면(/aic/admin/assignments)을 브라우저에서 저장한 HTML 을 읽어
 * users·programs·accounts·assignments 가져오기 파일을 만든다. DB 에는 접속하지 않는다.
 *
 * 사용법: npx tsx scripts/backup-html-to-sql.ts <신청·배정.html> [--users <사용자.html>] [--out 출력폴더=data/import]
 *
 * 화면에 없는 값은 다음처럼 채우며, 모든 행의 note 에 「[백업복원]」을 남긴다.
 *  - 사용자ID: 접수번호 순서대로 첫 등장 시 채번(U-0001…). 파기 행의 u-NNNN 과 일치하는지 검증한다.
 *    --users 를 주면 사용자 화면의 ID·이메일과 대조하고 구분·소속·연락처·동의일시·최초신청·파기일을 쓴다.
 *  - 사용자 구분: --users 가 없으면 '교원' 임시값
 *  - 신청일: 접수번호 날짜(KST 00:00), 배정·발송·인수 일시: 대여 시작일(KST 00:00)로 추정
 *  - 회수완료: 회수 체크 2개를 완료로 표기 (R24)
 *  - 파기 사용자: purged_at = 사용자 화면의 파기일, 없으면 가져오기 시각 (R30)
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const args = process.argv.slice(2)
const opt = (name: string) => {
  const i = args.indexOf(name)
  return i >= 0 ? args.splice(i, 2)[1] : undefined
}
const usersFile = opt('--users')
const outDir = opt('--out') ?? 'data/import'
const file = args[0]
if (!file) {
  console.error('저장한 HTML 파일 경로를 지정해 주세요.')
  process.exit(1)
}

const html = readFileSync(file, 'utf8')
const PURGED = '(파기)'
const NOTE = '[백업복원]'

const strip = (s: string) =>
  s
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .trim()

// --- 프로그램: 필터 드롭다운 ---
const programs: { id: string; name: string }[] = []
for (const m of html.matchAll(/<option value="(P\d{2}-\d{2})"\s*>([^<]+)<\/option>/g)) {
  programs.push({ id: m[1], name: strip(m[2]) })
}
const programIdByName = new Map(programs.map((p) => [p.name, p.id]))

// --- 신청·배정 표 ---
const tbody = html.match(/<table class="tbl">[\s\S]*?<tbody>([\s\S]*?)<\/tbody>/)?.[1]
if (!tbody) {
  console.error('신청·배정 표를 찾지 못했습니다. 관리자 「신청·배정」 화면을 저장한 파일인지 확인해 주세요.')
  process.exit(1)
}

type Row = {
  id: string
  program: string
  name: string
  email: string
  wish: string
  account: string | null
  service: string | null
  status: string
  rentStart: string | null
  rentEnd: string | null
  notified: boolean
  acked: boolean
}
const rows: Row[] = []
for (const tr of tbody.matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
  const td = [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => strip(m[1]))
  if (td.length < 11) continue
  const [, id, program, name, email, wish, acc, status, period, sent, ack] = td
  const accM = acc.match(/^((?:GPT|CL)-\d{3}) \((GPT|Claude)\)$/)
  const perM = period.match(/^(\d{4}-\d{2}-\d{2}) ~ (\d{4}-\d{2}-\d{2})$/)
  rows.push({
    id,
    program,
    name,
    email: email.toLowerCase(),
    wish,
    account: accM?.[1] ?? null,
    service: accM?.[2] ?? null,
    status,
    rentStart: perM?.[1] ?? null,
    rentEnd: perM?.[2] ?? null,
    notified: sent === '○',
    acked: ack === '○',
  })
}

const declared = Number(html.match(/<p class="sm text-slate">(\d+)건<\/p>/)?.[1] ?? NaN)
if (!Number.isNaN(declared) && declared !== rows.length) {
  console.error(`화면 건수(${declared})와 추출 건수(${rows.length})가 다릅니다. 저장이 잘렸는지 확인해 주세요.`)
  process.exit(1)
}

// 접수번호 A261015-0003 → 2026-10-15
const appliedDate = (id: string) => `20${id.slice(1, 3)}-${id.slice(3, 5)}-${id.slice(5, 7)}`
const kst = (d: string) => `${d}T00:00:00+09:00`

// --- 사용자: 접수번호 순서대로 첫 등장 시 채번 ---
const sorted = [...rows].sort((a, b) => a.id.localeCompare(b.id))
type User = { id: string; name: string; email: string; firstApplied: string; purged: boolean }
const users = new Map<string, User>() // key: email
const userIdOf = new Map<string, string>() // assignment id → user id
let seq = 0
for (const r of sorted) {
  let u = users.get(r.email)
  if (!u) {
    const id = `U-${String(++seq).padStart(4, '0')}`
    const purged = r.name === PURGED
    if (purged && r.email !== `${id.toLowerCase()}@purged.local`) {
      console.error(`사용자ID 추정이 어긋났습니다: ${r.id} 는 ${r.email} 인데 ${id} 로 채번됨`)
      process.exit(1)
    }
    u = { id, name: r.name, email: r.email, firstApplied: appliedDate(r.id), purged }
    users.set(r.email, u)
  }
  userIdOf.set(r.id, u.id)
}

// --- 사용자 화면(선택): 추정 ID 를 대조하고 화면에 있는 값으로 보정 ---
type UserDetail = { type: string; affiliation: string | null; phone: string | null; consented: string | null; firstApplied: string | null; purgedOn: string | null }
const userDetail = new Map<string, UserDetail>() // key: user id
if (usersFile) {
  const uhtml = readFileSync(usersFile, 'utf8')
  const ubody = uhtml.match(/<table class="tbl">[\s\S]*?<tbody>([\s\S]*?)<\/tbody>/)?.[1]
  if (!ubody) {
    console.error('사용자 표를 찾지 못했습니다. 관리자 「사용자」 화면을 저장한 파일인지 확인해 주세요.')
    process.exit(1)
  }
  const dash = (s: string) => (s === '-' || s === '' ? null : s)
  for (const tr of ubody.matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
    const td = [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => strip(m[1]))
    if (td.length < 10) continue
    const [, id, , type, affiliation, email, phone, consented, firstApplied, purgedOn] = td
    const u = [...users.values()].find((x) => x.id === id)
    if (!u || u.email !== email.toLowerCase()) {
      console.error(`사용자 화면 ${id} (${email}) 가 신청·배정에서 추정한 사용자와 맞지 않습니다.`)
      process.exit(1)
    }
    if (!['교원', '직원', '학생', '지역민'].includes(type)) {
      console.error(`사용자 ${id} 의 구분 「${type}」 을 알 수 없습니다.`)
      process.exit(1)
    }
    userDetail.set(id, {
      type,
      affiliation: dash(affiliation),
      phone: dash(phone),
      consented: dash(consented),
      firstApplied: dash(firstApplied),
      purgedOn: dash(purgedOn),
    })
  }
  const missing = [...users.values()].filter((u) => !userDetail.has(u.id))
  if (missing.length) {
    console.error(`사용자 화면에 없는 사용자: ${missing.map((u) => u.id).join(', ')}`)
    process.exit(1)
  }
}

// --- 계정: 화면에 나온 좌석만. 사용중 건이 있으면 배정 상태로 ---
const accounts = new Map<string, { service: string; current: string | null }>()
for (const r of sorted) {
  if (!r.account || !r.service) continue
  const a = accounts.get(r.account) ?? { service: r.service, current: null }
  if (['배정', '사용중', '회수중'].includes(r.status)) {
    if (a.current) {
      console.error(`계정 ${r.account} 에 진행 중 배정이 2건입니다: ${a.current}, ${r.id}`)
      process.exit(1)
    }
    a.current = r.id
  }
  accounts.set(r.account, a)
}

for (const r of rows) {
  if (!programIdByName.has(r.program)) {
    console.error(`프로그램 「${r.program}」 의 ID 를 드롭다운에서 찾지 못했습니다.`)
    process.exit(1)
  }
}

// --- 출력 ---
const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
const csv = (header: string[], data: unknown[][]) =>
  '﻿' + [header, ...data].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n'
const q = (v: string | null | boolean | number) =>
  v === null ? 'null' : typeof v === 'boolean' || typeof v === 'number' ? String(v) : `'${v.replace(/'/g, "''")}'`

mkdirSync(outDir, { recursive: true })

writeFileSync(
  join(outDir, 'programs.csv'),
  csv(['프로그램ID', '프로그램명'], programs.map((p) => [p.id, p.name])),
)
writeFileSync(
  join(outDir, 'users.csv'),
  csv(
    ['사용자ID', '이름', '구분', '소속', '이메일', '연락처', '동의일', '최초신청일', '파기일'],
    [...users.values()].map((u) => {
      const d = userDetail.get(u.id)
      return [
        u.id, u.name, d?.type ?? '(확인필요)', d?.affiliation, u.email, d?.phone,
        d?.consented ?? u.firstApplied, d?.firstApplied ?? u.firstApplied, d?.purgedOn ?? (u.purged ? '(파기)' : ''),
      ]
    }),
  ),
)
writeFileSync(
  join(outDir, 'accounts.csv'),
  csv(
    ['계정ID', '서비스', '상태', '현재배정'],
    [...accounts.entries()].sort().map(([id, a]) => [id, a.service, a.current ? '배정' : '가용', a.current]),
  ),
)
writeFileSync(
  join(outDir, 'assignments.csv'),
  csv(
    ['접수번호', '프로그램ID', '프로그램', '사용자ID', '이름', '이메일', '희망', '계정', '서비스', '상태', '대여시작', '대여종료', '발송', '인수'],
    sorted.map((r) => [
      r.id, programIdByName.get(r.program), r.program, userIdOf.get(r.id), r.name, r.email, r.wish,
      r.account, r.service, r.status, r.rentStart, r.rentEnd, r.notified ? 'Y' : '', r.acked ? 'Y' : '',
    ]),
  ),
)

const sql: string[] = [
  `-- 운영 화면 백업 복원 (${file.split(/[\\/]/).pop()}) — scripts/backup-html-to-sql.ts 로 생성`,
  `-- 0001→0002→0003 마이그레이션 적용 후 실행. 한 트랜잭션으로 실행되며 기존 행은 덮어쓰지 않는다(계정 상태 제외).`,
  usersFile
    ? `-- 사용자 구분·소속·연락처·동의일시·파기일은 사용자 화면 백업(${usersFile.split(/[\\/]/).pop()}) 기준.`
    : `-- 사용자 구분은 '교원' 임시값 — 사용자 화면 백업(--users)으로 보정할 것.`,
  'begin;',
  '',
  '-- 프로그램 (ID·이름만. 대상·방식·기간·정원은 프로그램 화면에서 보정)',
  ...programs.map(
    (p) => `insert into programs (id, name, status, note) values (${q(p.id)}, ${q(p.name)}, '진행중', ${q(NOTE)}) on conflict (id) do nothing;`,
  ),
  '',
  '-- 사용자',
  ...[...users.values()].map((u) => {
    const d = userDetail.get(u.id)
    const purgedAt = d?.purgedOn ? q(kst(d.purgedOn)) : u.purged ? 'now()' : 'null'
    return (
      `insert into users (id, name, affiliation, type, email, phone, privacy_consented_at, first_applied_at, purged_at) values (` +
      `${q(u.id)}, ${q(u.name)}, ${q(d?.affiliation ?? null)}, ${q(d?.type ?? '교원')}, ${q(u.email)}, ${q(d?.phone ?? null)}, ` +
      `${q(kst(d?.consented ?? u.firstApplied))}, ${q(kst(d?.firstApplied ?? u.firstApplied))}, ${purgedAt}) on conflict (id) do nothing;`
    )
  }),
  '',
  '-- 계정 (화면에 나온 좌석만. 접속 링크·로그인 이메일은 계정 CSV 가져오기로 등록)',
  ...[...accounts.entries()].sort().map(
    ([id, a]) =>
      `insert into accounts (id, service, status, note) values (${q(id)}, ${q(a.service)}, '가용', ${q(NOTE)}) on conflict (id) do nothing;`,
  ),
  '',
  '-- 신청·배정',
  ...sorted.map((r) => {
    const start = r.rentStart ? kst(r.rentStart) : null
    const returned = r.status === '회수완료'
    return (
      `insert into assignments (id, program_id, user_id, name, email, service_wish, account_id, service, status, applied_at, ` +
      `assigned_on, rent_start, rent_end, notified_at, acknowledged_at, chk_delete_chats, chk_team_removed, note) values (` +
      [
        q(r.id), q(programIdByName.get(r.program)!), q(userIdOf.get(r.id)!), q(r.name), q(r.email), q(r.wish),
        q(r.account), q(r.service), q(r.status), q(kst(appliedDate(r.id))),
        q(r.account ? r.rentStart : null), q(r.rentStart), q(r.rentEnd),
        q(r.notified ? start : null), q(r.acked ? start : null), returned, returned,
        q(`${NOTE} 발송·인수 일시는 대여 시작일로 추정`),
      ].join(', ') +
      `) on conflict (id) do nothing;`
    )
  }),
  '',
  '-- 진행 중 배정이 있는 좌석은 배정 상태로 (accounts_current_assignment_status)',
  ...[...accounts.entries()]
    .filter(([, a]) => a.current)
    .sort()
    .map(([id, a]) => `update accounts set status = '배정', current_assignment_id = ${q(a.current)}, updated_at = now() where id = ${q(id)};`),
  '',
  '-- 채번 카운터 보정: 고정 ID 로 넣은 사용자 수만큼 올려 다음 신청자가 U-0001 로 채번되지 않게 (lib/ids.ts:nextUserId)',
  `insert into counters (key, value) values ('user', ${users.size}) on conflict (key) do update set value = greatest(counters.value, excluded.value);`,
  '',
  'commit;',
  '',
]
writeFileSync(join(outDir, 'import.sql'), sql.join('\n'))

const byStatus = rows.reduce<Record<string, number>>((m, r) => ((m[r.status] = (m[r.status] ?? 0) + 1), m), {})
console.log(`출력: ${outDir}`)
console.log(`  프로그램 ${programs.length} · 사용자 ${users.size}(파기 ${[...users.values()].filter((u) => u.purged).length}) · 계정 ${accounts.size} · 신청·배정 ${rows.length}`)
if (usersFile) {
  const byType = [...userDetail.values()].reduce<Record<string, number>>((m, d) => ((m[d.type] = (m[d.type] ?? 0) + 1), m), {})
  console.log(`  사용자 화면 대조 ${userDetail.size}명 일치 · 구분: ${Object.entries(byType).map(([k, v]) => `${k} ${v}`).join(', ')}`)
}
console.log(`  상태별:${Object.entries(byStatus).map(([k, v]) => `${k} ${v}`).join(', ')}`)

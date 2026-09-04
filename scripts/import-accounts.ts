/**
 * 계정 CSV 가져오기 (PRD §7-2 계정)
 * 사용법: npx tsx scripts/import-accounts.ts accounts.csv
 * 헤더: 계정ID,서비스,구분,로그인이메일,비밀번호,활성화일,만료일,등록이메일소유,2FA
 */
import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { createCipheriv, randomBytes } from 'node:crypto'

const file = process.argv[2]
if (!file) {
  console.error('CSV 파일 경로를 지정해 주세요.')
  process.exit(1)
}

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 환경변수가 필요합니다.')
  process.exit(1)
}
const db = createClient(url, key, { auth: { persistSession: false } })

function encrypt(plain: string): string {
  const raw = process.env.VAULT_KEY
  if (!raw) throw new Error('VAULT_KEY 환경변수가 없습니다.')
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(raw, 'base64'), iv)
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), enc.toString('base64')].join(':')
}

function splitCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"'
          i++
        } else quoted = false
      } else cur += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  out.push(cur)
  return out
}

function normalizeDate(v: string | undefined): string | null {
  const s = (v ?? '').trim()
  const m = s.match(/^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/)
  return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : null
}

async function main() {
  const text = readFileSync(file, 'utf8').replace(/^﻿/, '')
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const head = splitCsvLine(lines[0]).map((h) => h.replace(/\s/g, ''))
  const at = (name: string) => head.indexOf(name)

  let n = 0
  for (const line of lines.slice(1)) {
    const c = splitCsvLine(line)
    const id = c[at('계정ID')]?.trim()
    if (!id) continue
    const svc = (c[at('서비스')] ?? '').trim()
    const service = svc === 'Claude' || svc === 'CL' ? 'Claude' : 'GPT'
    const pw = at('비밀번호') >= 0 ? c[at('비밀번호')]?.trim() : ''

    const { error } = await db.from('accounts').upsert(
      {
        id,
        service,
        kind: (c[at('구분')] ?? '').trim() === '예비' ? '예비' : '운영',
        activated_on: normalizeDate(c[at('활성화일')]),
        expires_on: normalizeDate(c[at('만료일')]),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'id' },
    )
    if (error) throw new Error(`${id}: ${error.message}`)

    const { error: sErr } = await db.from('account_secrets').upsert(
      {
        account_id: id,
        login_email: c[at('로그인이메일')]?.trim() || null,
        password_enc: pw ? encrypt(pw) : null,
        owns_registered_email: /^(true|Y|y|1|예|O|o)$/.test((c[at('등록이메일소유')] ?? '').trim()),
        two_fa: at('2FA') >= 0 ? c[at('2FA')]?.trim() || null : null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'account_id' },
    )
    if (sErr) throw new Error(`${id} 금고: ${sErr.message}`)
    n += 1
  }
  console.log(`계정 ${n}건 가져오기 완료`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

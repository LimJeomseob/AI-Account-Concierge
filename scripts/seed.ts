/**
 * 시드 스크립트 (PRD §9)
 *  - settings 기본값
 *  - mail_templates 기본 문구
 *  - admins 최초 관리자 (INITIAL_ADMIN_EMAIL)
 *  - programs 24개 (--programs)
 *  - 개발용 샘플 계정 GPT-001~003 / CL-001~003 (--sample-accounts)
 *
 * 사용법: npx tsx scripts/seed.ts [--programs] [--sample-accounts]
 */
// .env.local 을 우선 읽고, 없는 값은 .env 로 보충한다 (Next.js 규칙과 맞춤)
import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })
loadEnv()
import { createClient } from '@supabase/supabase-js'
import { createCipheriv, randomBytes } from 'node:crypto'
import { DEFAULT_SETTINGS } from '../lib/settings-defaults'
import { DEFAULT_TEMPLATES } from '../lib/mail/templates'
import { PROGRAM_SEED } from '../lib/seed-data'

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

async function main() {
  const args = new Set(process.argv.slice(2))

  // 1. settings
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
    const { error } = await db.from('settings').upsert({ key: k, value: v }, { onConflict: 'key' })
    if (error) throw new Error(`settings.${k}: ${error.message}`)
  }
  console.log(`settings ${Object.keys(DEFAULT_SETTINGS).length}건 시드 완료`)

  // 2. mail_templates
  for (const t of DEFAULT_TEMPLATES) {
    const { error } = await db
      .from('mail_templates')
      .upsert({ key: t.key, subject: t.subject, body: t.body, placeholders: t.placeholders }, { onConflict: 'key' })
    if (error) throw new Error(`mail_templates.${t.key}: ${error.message}`)
  }
  console.log(`mail_templates ${DEFAULT_TEMPLATES.length}건 시드 완료`)

  // 3. 최초 관리자
  const admin = process.env.INITIAL_ADMIN_EMAIL?.toLowerCase()
  if (admin) {
    const { error } = await db.from('admins').upsert({ email: admin, created_by: 'seed' }, { onConflict: 'email' })
    if (error) throw new Error(`admins: ${error.message}`)
    console.log(`최초 관리자 등록: ${admin}`)
  } else {
    console.warn('INITIAL_ADMIN_EMAIL 이 없어 관리자를 등록하지 않았습니다.')
  }

  // 4. 프로그램 24개
  if (args.has('--programs')) {
    const prefix = DEFAULT_SETTINGS.program_id_prefix
    const { data: existing } = await db.from('programs').select('name')
    const names = new Set((existing ?? []).map((p) => p.name))
    let n = 0
    for (const p of PROGRAM_SEED) {
      if (names.has(p.name)) continue
      const { data: seq, error: seqErr } = await db.rpc('next_counter', { p_key: `program:${prefix}` })
      if (seqErr) throw new Error(seqErr.message)
      const id = `${prefix}-${String(seq).padStart(2, '0')}`
      const { error } = await db.from('programs').insert({
        id,
        name: p.name,
        target: p.target,
        mode: '고정기간',
        days: 0,
        cap: 0,
        status: '진행',
        note: `${p.group} / ${p.season} / 대여기간 입력 필요`,
      })
      if (error) throw new Error(`programs.${p.name}: ${error.message}`)
      n += 1
    }
    console.log(`프로그램 ${n}건 등록 (중복 ${PROGRAM_SEED.length - n}건 생략)`)
  }

  // 5. 개발용 샘플 계정
  if (args.has('--sample-accounts')) {
    const samples = [
      ...[1, 2, 3].map((i) => ({ id: `GPT-00${i}`, service: 'GPT' as const })),
      ...[1, 2, 3].map((i) => ({ id: `CL-00${i}`, service: 'Claude' as const })),
    ]
    for (const s of samples) {
      const { error } = await db.from('accounts').upsert(
        {
          id: s.id,
          service: s.service,
          kind: '운영',
          activated_on: new Date().toISOString().slice(0, 10),
          expires_on: '2027-03-31',
          status: '가용',
        },
        { onConflict: 'id' },
      )
      if (error) throw new Error(`accounts.${s.id}: ${error.message}`)
      const { error: sErr } = await db.from('account_secrets').upsert(
        {
          account_id: s.id,
          login_email: `${s.id.toLowerCase()}@example.ac.kr`,
          password_enc: encrypt(`Sample!${s.id}`),
          password_status: '정상',
        },
        { onConflict: 'account_id' },
      )
      if (sErr) throw new Error(`account_secrets.${s.id}: ${sErr.message}`)
    }
    console.log(`샘플 계정 ${samples.length}건 등록`)
  }

  console.log('시드 완료.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

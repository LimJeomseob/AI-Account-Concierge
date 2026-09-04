/**
 * 계정 금고 암호화 (PRD §4-1 account_secrets, §13)
 * AES-256-GCM. 키 = 환경변수 VAULT_KEY (32바이트 base64).
 * 서버 전용 — 브라우저 번들에 절대 포함하지 말 것.
 */
import 'server-only'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const IV_LEN = 12
const PREFIX = 'v1'

function key(): Buffer {
  const raw = process.env.VAULT_KEY
  if (!raw) throw new Error('VAULT_KEY 환경변수가 없습니다.')
  const buf = Buffer.from(raw, 'base64')
  if (buf.length !== 32) throw new Error('VAULT_KEY 는 32바이트 base64 이어야 합니다.')
  return buf
}

/** 평문 → "v1:<iv>:<tag>:<ciphertext>" (모두 base64) */
export function encrypt(plain: string | null | undefined): string | null {
  if (plain === null || plain === undefined || plain === '') return null
  const iv = randomBytes(IV_LEN)
  const cipher = createCipheriv('aes-256-gcm', key(), iv)
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [PREFIX, iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join(':')
}

/** 암호문 → 평문. 형식이 어긋나거나 복호화 실패 시 null */
export function decrypt(payload: string | null | undefined): string | null {
  if (!payload) return null
  const parts = payload.split(':')
  if (parts.length !== 4 || parts[0] !== PREFIX) return null
  try {
    const [, ivB64, tagB64, dataB64] = parts
    const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(ivB64, 'base64'))
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, 'base64')),
      decipher.final(),
    ]).toString('utf8')
  } catch {
    return null
  }
}

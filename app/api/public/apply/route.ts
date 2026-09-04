/** POST /api/public/apply (PRD §12-1, R7~R11) */
import { z } from 'zod'
import { applyForAccount } from '@/lib/ops/apply'
import { jsonWithCors, preflight } from '@/lib/cors'
import { clientIp, rateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

const schema = z
  .object({
    programId: z.string().trim().optional(),
    programName: z.string().trim().optional(),
    name: z.string().trim().min(1, '이름을 입력해 주세요.'),
    affiliation: z.string().trim().min(1, '소속을 입력해 주세요.'),
    type: z.enum(['교원', '직원', '학생', '지역민'], { message: '구분을 선택해 주세요.' }),
    email: z.string().trim().email('이메일 형식이 올바르지 않습니다.'),
    phone: z.string().trim().optional(),
    service: z.enum(['GPT', 'Claude', '무관']).optional(),
    hasPaid: z.boolean().optional(),
    eduWatched: z.literal(true, { message: '윤리가이드라인 시청 확인이 필요합니다.' }),
    privacy: z.literal(true, { message: '개인정보 수집·이용 동의가 필요합니다.' }),
    pledge: z.literal(true, { message: '이용 서약 동의가 필요합니다.' }),
    eduWatchedAt: z.string().optional(),
    // 스팸 차단용 honeypot — 값이 있으면 봇
    website: z.string().max(0).optional(),
  })
  .refine((v) => !!(v.programId || v.programName), {
    message: '프로그램을 선택해 주세요.',
  })

export async function OPTIONS(req: Request) {
  return preflight(req)
}

export async function POST(req: Request) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return jsonWithCors(req, { ok: false, msg: '요청 형식이 올바르지 않습니다.' }, 400)
  }

  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? '입력값을 확인해 주세요.'
    return jsonWithCors(req, { ok: false, msg }, 400)
  }

  const ok = await rateLimit(`apply:${clientIp(req)}`, 10, 60)
  if (!ok) return jsonWithCors(req, { ok: false, msg: '요청이 많습니다. 잠시 후 다시 시도해 주세요.' }, 429)

  const d = parsed.data
  const result = await applyForAccount({
    programId: d.programId,
    programName: d.programName,
    name: d.name,
    affiliation: d.affiliation,
    type: d.type,
    email: d.email,
    phone: d.phone,
    service: d.service,
    hasPaid: d.hasPaid,
    eduWatchedAt: d.eduWatchedAt,
  })

  return jsonWithCors(req, result, result.ok ? 200 : 400)
}

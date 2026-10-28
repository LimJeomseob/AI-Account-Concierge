/** 설정 (PRD §7-2) */
import { db } from '@/lib/db'
import { toKSTDate } from '@/lib/date'
import { getSettings } from '@/lib/settings'
import { Button, Card, Table, Td, inputClass } from '@/components/ui'
import { L } from '@/lib/labels'
import {
  adminAddAction,
  adminRemoveAction,
  settingsSaveAction,
} from '@/app/admin/actions'
import TestMailForm from './TestMailForm'

export const dynamic = 'force-dynamic'

export default async function SettingsPage() {
  const s = await getSettings()
  const { data: admins } = await db().from('admins').select('*').order('email')

  return (
    <>
      <h1 className="text-xl font-bold text-[var(--gnu-navy)]">{L.menu.settings}</h1>

      <Card title="운영 설정">
        <form action={settingsSaveAction} className="grid gap-3 sm:grid-cols-3">
          <Num name="target_headcount" label="목표 연인원" value={s.target_headcount} />
          <Num name="contract_gpt" label="계약 계정 수 — ChatGPT Business Standard" value={s.contract_gpt} />
          <Num name="contract_claude" label="계약 계정 수 — Claude Team" value={s.contract_claude} />
          <Txt name="program_id_prefix" label="프로그램ID 접두" value={s.program_id_prefix} />
          <Txt name="from_name" label="발신자 표시명" value={s.from_name} />
          <Txt name="from_email" label="발신 주소 (미사용 — Gmail 발송은 GMAIL_USER 로 고정)" value={s.from_email} />
          <Txt name="reply_to" label="회신 주소" value={s.reply_to} />
          <Txt name="edu_url" label="윤리가이드라인 영상 URL" value={s.edu_url} />
          <Txt name="rules_url" label="이용수칙 URL" value={s.rules_url} />
          <Txt name="pledge_url" label="서약 문서 URL" value={s.pledge_url} />
          <Txt name="privacy_items" label="개인정보 수집 항목" value={s.privacy_items} />
          <Txt name="privacy_purpose" label="이용 목적" value={s.privacy_purpose} />
          <Txt name="privacy_period" label="보유 기간" value={s.privacy_period} />
          <label className="text-sm sm:col-span-3">
            <span className="text-xs text-slate-600">관리자 메일 수신자 — 장애 신고·월간 스냅샷 (줄바꿈·쉼표 구분)</span>
            <textarea name="admin_emails" rows={2} defaultValue={s.admin_emails.join('\n')} className={inputClass} />
          </label>
          <label className="text-sm sm:col-span-3">
            <span className="text-xs text-slate-600">CORS 허용 오리진 (신청 페이지 주소)</span>
            <textarea name="signup_origins" rows={2} defaultValue={s.signup_origins.join('\n')} className={inputClass} />
          </label>
          <div className="sm:col-span-3">
            <Button>설정 저장</Button>
          </div>
        </form>
      </Card>

      <Card title="관리자">
        <Table head={['이메일', '이름', '등록일', '']}>
          {(admins ?? []).map((a) => (
            <tr key={a.email}>
              <Td className="text-xs">{a.email}</Td>
              <Td className="text-xs">{a.name ?? '-'}</Td>
              <Td className="text-xs">{toKSTDate(a.created_at) ?? '-'}</Td>
              <Td>
                <form action={adminRemoveAction}>
                  <input type="hidden" name="email" value={a.email} />
                  <Button variant="danger">삭제</Button>
                </form>
              </Td>
            </tr>
          ))}
        </Table>
        <form action={adminAddAction} className="mt-4 flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="text-xs text-slate-600">이메일</span>
            <input name="email" type="email" required className={inputClass} />
          </label>
          <label className="text-sm">
            <span className="text-xs text-slate-600">이름</span>
            <input name="name" className={inputClass} />
          </label>
          <Button>관리자 추가</Button>
        </form>
      </Card>

      <Card title="발신 테스트 메일">
        <TestMailForm />
      </Card>
    </>
  )
}

function Num({ name, label, value }: { name: string; label: string; value: number }) {
  return (
    <label className="text-sm">
      <span className="text-xs text-slate-600">{label}</span>
      <input name={name} type="number" defaultValue={value} className={inputClass} />
    </label>
  )
}

function Txt({ name, label, value }: { name: string; label: string; value: string }) {
  return (
    <label className="text-sm">
      <span className="text-xs text-slate-600">{label}</span>
      <input name={name} defaultValue={value} className={inputClass} />
    </label>
  )
}

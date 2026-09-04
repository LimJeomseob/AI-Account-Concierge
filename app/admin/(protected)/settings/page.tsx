/** 설정 (PRD §7-2) */
import { db } from '@/lib/db'
import { getSettings } from '@/lib/settings'
import { extractPlaceholders } from '@/lib/mail/render'
import { ASSIGNMENT_TEMPLATE, INTAKE_TEMPLATE } from '@/lib/mail/templates'
import { Button, Card, Table, Td, inputClass } from '@/components/ui'
import { L } from '@/lib/labels'
import {
  adminAddAction,
  adminRemoveAction,
  settingsSaveAction,
  templateSaveAction,
  testMailAction,
} from '@/app/admin/actions'

export const dynamic = 'force-dynamic'

export default async function SettingsPage() {
  const s = await getSettings()
  const { data: admins } = await db().from('admins').select('*').order('email')
  const { data: templates } = await db().from('mail_templates').select('*')
  const tmap = new Map((templates ?? []).map((t) => [t.key, t]))
  const defaults = [ASSIGNMENT_TEMPLATE, INTAKE_TEMPLATE]

  return (
    <>
      <h1 className="text-xl font-bold text-[var(--gnu-navy)]">{L.menu.settings}</h1>

      <Card title="운영 설정">
        <form action={settingsSaveAction} className="grid gap-3 sm:grid-cols-3">
          <Num name="ack_due_days" label="인수 확인 기한(일)" value={s.ack_due_days} />
          <Num name="account_expiry_alert_days" label="구독 만료 D-N 알림" value={s.account_expiry_alert_days} />
          <Num name="password_length" label="비밀번호 길이" value={s.password_length} />
          <Num name="suspension_rate_warn" label="정지율 경고(%)" value={s.suspension_rate_warn} />
          <Num name="target_headcount" label="목표 연인원" value={s.target_headcount} />
          <Txt name="program_id_prefix" label="프로그램ID 접두" value={s.program_id_prefix} />
          <Txt name="from_name" label="발신자 표시명" value={s.from_name} />
          <Txt name="from_email" label="발신 주소" value={s.from_email} />
          <Txt name="reply_to" label="회신 주소" value={s.reply_to} />
          <Txt name="edu_url" label="윤리가이드라인 영상 URL" value={s.edu_url} />
          <Txt name="rules_url" label="이용수칙 URL" value={s.rules_url} />
          <Txt name="pledge_url" label="서약 문서 URL" value={s.pledge_url} />
          <Txt name="privacy_items" label="개인정보 수집 항목" value={s.privacy_items} />
          <Txt name="privacy_purpose" label="이용 목적" value={s.privacy_purpose} />
          <Txt name="privacy_period" label="보유 기간" value={s.privacy_period} />
          <label className="text-sm sm:col-span-3">
            <span className="text-xs text-slate-600">점검 메일 수신 관리자 (줄바꿈·쉼표 구분)</span>
            <textarea name="admin_emails" rows={2} defaultValue={s.admin_emails.join('\n')} className={inputClass} />
          </label>
          <label className="text-sm sm:col-span-3">
            <span className="text-xs text-slate-600">CORS 허용 오리진 (신청 페이지 주소)</span>
            <textarea name="signup_origins" rows={2} defaultValue={s.signup_origins.join('\n')} className={inputClass} />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="auto_assign_on_approve" defaultChecked={s.auto_assign_on_approve} />
            <span className="text-xs text-slate-600">승인 즉시 배정·발송</span>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="show_new_password_in_digest"
              defaultChecked={s.show_new_password_in_digest}
            />
            <span className="text-xs text-slate-600">점검 메일에 신규 비밀번호 표시</span>
          </label>
          <div className="sm:col-span-3">
            <Button>설정 저장</Button>
          </div>
        </form>
      </Card>

      <Card title="메일 템플릿">
        {defaults.map((d) => {
          const t = tmap.get(d.key)
          const subject = t?.subject ?? d.subject
          const body = t?.body ?? d.body
          return (
            <form key={d.key} action={templateSaveAction} className="mb-6 space-y-2 border-b border-slate-100 pb-6">
              <input type="hidden" name="key" value={d.key} />
              <p className="text-sm font-medium">{d.key}</p>
              <p className="text-xs text-slate-500">치환자: {d.placeholders}</p>
              <input name="subject" defaultValue={subject} className={inputClass} />
              <textarea name="body" rows={14} defaultValue={body} className={`${inputClass} font-mono text-xs`} />
              <p className="text-xs text-slate-400">
                현재 본문 사용 치환자: {extractPlaceholders(body).map((p) => `{${p}}`).join(' ')}
              </p>
              <Button>템플릿 저장</Button>
            </form>
          )
        })}
      </Card>

      <Card title="관리자">
        <Table head={['이메일', '이름', '등록일', '']}>
          {(admins ?? []).map((a) => (
            <tr key={a.email}>
              <Td className="text-xs">{a.email}</Td>
              <Td className="text-xs">{a.name ?? '-'}</Td>
              <Td className="text-xs">{a.created_at?.slice(0, 10)}</Td>
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
        <form action={testMailAction} className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="text-xs text-slate-600">받는 주소 (비우면 본인)</span>
            <input name="to" type="email" className={inputClass} />
          </label>
          <Button variant="ghost">테스트 발송</Button>
        </form>
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

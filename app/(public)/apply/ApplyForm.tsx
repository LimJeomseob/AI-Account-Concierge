'use client'

import { useState } from 'react'

interface ProgramOption {
  id: string
  name: string
  open: boolean
  period: string
}

export default function ApplyForm({
  programs,
  eduUrl,
  privacy,
  ackDueDays,
}: {
  programs: ProgramOption[]
  eduUrl: string
  privacy: { items: string; purpose: string; period: string }
  ackDueDays: number
}) {
  const [watched, setWatched] = useState(false)
  const [programId, setProgramId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState<{ id: string; period: string; email: string } | null>(null)

  const selected = programs.find((p) => p.id === programId)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')
    const form = e.currentTarget
    const fd = new FormData(form)
    const email = String(fd.get('email') ?? '')

    const payload = {
      programId,
      name: String(fd.get('name') ?? '').trim(),
      affiliation: String(fd.get('affiliation') ?? '').trim(),
      type: String(fd.get('type') ?? ''),
      email: email.trim(),
      phone: String(fd.get('phone') ?? '').trim(),
      service: String(fd.get('service') ?? '무관'),
      hasPaid: fd.get('hasPaid') === 'true',
      eduWatched: watched,
      privacy: fd.get('privacy') === 'on',
      pledge: fd.get('pledge') === 'on',
      eduWatchedAt: new Date().toISOString(),
      website: String(fd.get('website') ?? ''),
    }

    setBusy(true)
    try {
      const res = await fetch('/api/public/apply', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!data.ok) {
        setError(data.msg ?? '접수에 실패했습니다.')
        return
      }
      form.reset()
      setProgramId('')
      setWatched(false)
      setDone({ id: data.id, period: data.period, email })
    } catch {
      setError('네트워크 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <div className="mt-6 rounded-lg border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-bold text-[var(--gnu-navy)]">신청이 접수되었습니다.</h2>
        <p className="mt-3 text-sm leading-7 text-slate-700">
          입력하신 이메일 <strong>{done.email}</strong> 로 계정과 비밀번호를 보내드릴 예정입니다.
          <br />
          접수번호: <strong>{done.id}</strong>
          <br />
          대여기간: {done.period}
        </p>
        <p className="mt-3 text-sm text-slate-600">
          안내 메일 수신 후 <strong>{ackDueDays}일 이내</strong> 인수 확인 링크를 눌러 주세요. 기한이 지나면
          배정이 자동 취소되어 대기자에게 재배정됩니다.
        </p>
        <button
          onClick={() => setDone(null)}
          className="mt-4 rounded-md border border-slate-300 px-4 py-2 text-sm"
        >
          다른 프로그램 신청
        </button>
      </div>
    )
  }

  return (
    <div className="mt-6 space-y-4">
      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="font-semibold text-[var(--gnu-navy)]">STEP 1. GNU AI 윤리가이드라인 시청 (필수)</h2>
        <p className="mt-1 text-sm text-slate-600">
          신청 전 반드시 윤리가이드라인 영상을 시청해 주세요. 「영상 보기」를 누르면 새 창으로 연결됩니다.
        </p>
        <a
          href={eduUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-block rounded-md border border-[var(--gnu-navy)] px-4 py-2 text-sm text-[var(--gnu-navy)]"
        >
          영상 보기
        </a>
        <label className="mt-3 flex items-start gap-2 text-sm">
          <input type="checkbox" checked={watched} onChange={(e) => setWatched(e.target.checked)} />
          <span>윤리가이드라인 영상 시청을 완료했습니다.</span>
        </label>
      </section>

      <section className={`rounded-lg border border-slate-200 bg-white p-5 ${watched ? '' : 'pointer-events-none opacity-40'}`}>
        <h2 className="font-semibold text-[var(--gnu-navy)]">STEP 2. AI 유료계정 신청</h2>
        <form onSubmit={onSubmit} className="mt-3 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="text-sm font-medium">프로그램 *</label>
              <select
                value={programId}
                onChange={(e) => setProgramId(e.target.value)}
                required
                className="mt-1 w-full rounded-md border border-slate-300 p-2 text-sm"
              >
                <option value="">프로그램을 선택하세요</option>
                {programs.map((p) => (
                  <option key={p.id} value={p.id} disabled={!p.open}>
                    {p.open ? p.name : `${p.name} — 접수 준비 중`}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-slate-500">대여기간: {selected?.period ?? '-'}</p>
            </div>
            <div>
              <label className="text-sm font-medium">구분 *</label>
              <select name="type" required className="mt-1 w-full rounded-md border border-slate-300 p-2 text-sm">
                <option value="">선택</option>
                <option>교원</option>
                <option>직원</option>
                <option>학생</option>
                <option>지역민</option>
              </select>
            </div>
            <div>
              <label className="text-sm font-medium">이름 *</label>
              <input name="name" required className="mt-1 w-full rounded-md border border-slate-300 p-2 text-sm" />
            </div>
            <div>
              <label className="text-sm font-medium">소속 *</label>
              <input name="affiliation" required className="mt-1 w-full rounded-md border border-slate-300 p-2 text-sm" />
            </div>
            <div>
              <label className="text-sm font-medium">이메일 *</label>
              <input
                name="email"
                type="email"
                required
                placeholder="계정 정보를 받을 주소"
                className="mt-1 w-full rounded-md border border-slate-300 p-2 text-sm"
              />
            </div>
            <div>
              <label className="text-sm font-medium">연락처</label>
              <input name="phone" className="mt-1 w-full rounded-md border border-slate-300 p-2 text-sm" />
            </div>
            <div>
              <label className="text-sm font-medium">희망 서비스</label>
              <select name="service" className="mt-1 w-full rounded-md border border-slate-300 p-2 text-sm">
                <option value="무관">무관</option>
                <option value="GPT">ChatGPT Plus</option>
                <option value="Claude">Claude Pro</option>
              </select>
            </div>
            <div>
              <label className="text-sm font-medium">기존 유료계정 보유</label>
              <select name="hasPaid" className="mt-1 w-full rounded-md border border-slate-300 p-2 text-sm">
                <option value="false">미보유</option>
                <option value="true">보유</option>
              </select>
            </div>
          </div>

          <div>
            <label className="text-sm font-medium">개인정보 수집·이용 동의 *</label>
            <div className="mt-1 rounded-md bg-slate-100 p-3 text-xs leading-6 text-slate-600">
              · 수집 항목: {privacy.items}
              <br />· 이용 목적: {privacy.purpose}
              <br />· 보유 기간: {privacy.period}
              <br />· 동의를 거부할 수 있으나, 거부 시 계정 배정이 제한됩니다.
            </div>
            <label className="mt-2 flex items-start gap-2 text-sm">
              <input type="checkbox" name="privacy" required />
              <span>위 내용에 동의합니다.</span>
            </label>
          </div>

          <div>
            <label className="text-sm font-medium">이용 서약 *</label>
            <div className="mt-1 rounded-md bg-slate-100 p-3 text-xs leading-6 text-slate-600">
              · 배정받은 계정은 본인만 사용하며 타인에게 공유하지 않습니다.
              <br />· 개인정보·미공개 연구자료·내부 문서를 입력하지 않습니다.
              <br />· GNU AI 윤리가이드라인을 준수하며, 대여 종료 시 회수 절차에 협조합니다.
            </div>
            <label className="mt-2 flex items-start gap-2 text-sm">
              <input type="checkbox" name="pledge" required />
              <span>위 서약에 동의합니다.</span>
            </label>
          </div>

          {/* honeypot */}
          <input name="website" tabIndex={-1} autoComplete="off" className="absolute -left-[9999px]" />

          <p className="rounded-md bg-slate-100 p-3 text-xs leading-6 text-slate-600">
            안내 메일 수신 후 <strong>{ackDueDays}일 이내</strong> 「인수 확인」 링크를 눌러야 배정이 유지됩니다.
          </p>

          {error && <p className="text-sm text-red-700">{error}</p>}

          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-[var(--gnu-navy)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy ? '접수 중…' : '신청하기'}
          </button>
        </form>
      </section>
    </div>
  )
}

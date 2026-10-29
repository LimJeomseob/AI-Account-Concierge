'use client'

/**
 * 사용현황 CSV 일괄 등록 (2026-10-29)
 * 파일 선택 → 「업로드」(서버 검사·계정 자동 부여 미리보기, DB 변경 없음) → 「확정」. 등록 상태는 「사용중」 또는 「회수완료」.
 * 「업로드」는 파일이 읽혔고 머리글이 맞으며 프로그램이 정해질 때만 활성(importReadiness).
 * 계정번호는 양식에 없다 — 「사용중」은 업로드 후 가용 계정을 번호 순으로 자동 부여한다.
 * 엑셀에서 저장한 CSV(UTF-8 또는 CP949) 모두 읽는다.
 */
import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { usageImportCommitAction, usageImportPreviewAction } from '@/app/admin/actions'
import { Button } from '@/components/ui'
import { IMPORT_TEMPLATE, importReadiness, type ImportMode, type PlanItem } from '@/lib/usage-import'

async function readText(file: File): Promise<string> {
  const buf = await file.arrayBuffer()
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf)
  } catch {
    return new TextDecoder('euc-kr').decode(buf) // 엑셀 「CSV(쉼표로 분리)」 저장본
  }
}

const ACTION_LABEL: Record<PlanItem['action'], string> = { new: '등록', skip: '건너뜀', error: '오류' }
const ACTION_CLASS: Record<PlanItem['action'], string> = {
  new: 'text-green-700',
  skip: 'text-slate-500',
  error: 'text-red-700',
}

export default function UsageImport({ programs }: { programs: Array<{ id: string; name: string }> }) {
  const router = useRouter()
  const [mode, setMode] = useState<ImportMode>('사용중')
  const [program, setProgram] = useState('')
  const [text, setText] = useState('')
  const [fileName, setFileName] = useState('')
  const [fileKey, setFileKey] = useState(0) // 확정 후 파일 입력 초기화용
  const [items, setItems] = useState<PlanItem[] | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [pending, start] = useTransition()

  const form = () => {
    const fd = new FormData()
    fd.set('csv', text)
    fd.set('mode', mode)
    fd.set('program', program)
    return fd
  }
  const reset = () => {
    setItems(null)
    setMsg(null)
  }
  const newCount = items?.filter((x) => x.action === 'new').length ?? 0
  const readiness = useMemo(() => importReadiness(text, program), [text, program])

  return (
    <div className="space-y-3 text-sm">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <fieldset>
          <legend className="text-xs text-slate-600">등록 상태</legend>
          <div className="mt-2 flex gap-4">
            {(['사용중', '회수완료'] as const).map((m) => (
              <label key={m} className="flex items-center gap-1">
                <input
                  type="radio"
                  name="import-mode"
                  checked={mode === m}
                  onChange={() => {
                    setMode(m)
                    reset()
                  }}
                />
                {m}
              </label>
            ))}
          </div>
        </fieldset>
        <label>
          <span className="block text-xs text-slate-600">기본 프로그램 (CSV 「프로그램」 칸이 비었을 때)</span>
          <select
            value={program}
            onChange={(e) => {
              setProgram(e.target.value)
              reset()
            }}
            className="mt-1 w-full rounded-md border border-slate-300 p-2"
          >
            <option value="">선택 안 함</option>
            {programs.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="lg:col-span-2">
          <span className="block text-xs text-slate-600">CSV 파일</span>
          <input
            key={fileKey}
            type="file"
            accept=".csv,text/csv"
            className="mt-1 block w-full text-sm"
            onChange={async (e) => {
              const f = e.target.files?.[0]
              reset()
              setText('')
              setFileName('')
              if (!f) return
              if (f.size > 1_000_000) {
                setMsg({ ok: false, text: '파일이 너무 큽니다(1MB 이하).' })
                return
              }
              setFileName(f.name)
              setText(await readText(f))
            }}
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            const url = URL.createObjectURL(new Blob([IMPORT_TEMPLATE], { type: 'text/csv;charset=utf-8' }))
            const a = document.createElement('a')
            a.href = url
            a.download = 'usage-import-template.csv'
            a.click()
            URL.revokeObjectURL(url)
          }}
        >
          양식 내려받기
        </Button>
        <Button
          type="button"
          disabled={pending || !readiness.ready}
          title={readiness.ready ? '서버에서 검사하고 배정될 계정을 미리 보여 줍니다(DB 변경 없음)' : readiness.msg}
          onClick={() =>
            start(async () => {
              const r = await usageImportPreviewAction(form())
              setItems(r.items ?? null)
              setMsg({ ok: r.ok, text: r.msg })
            })
          }
        >
          {pending && !items ? '업로드 중…' : '업로드'}
        </Button>
        <Button
          type="button"
          disabled={pending || newCount === 0}
          onClick={() => {
            if (!window.confirm(`「${mode}」으로 ${newCount}건을 등록합니다. 계속할까요?`)) return
            start(async () => {
              const r = await usageImportCommitAction(form())
              setMsg({ ok: r.ok, text: r.msg })
              setItems(null)
              // 같은 파일을 두 번 올리지 않게 파일 선택을 비운다
              setText('')
              setFileName('')
              setFileKey((k) => k + 1)
              router.refresh()
            })
          }}
        >
          {pending && items ? '등록 중…' : `확정 (${newCount}건 등록)`}
        </Button>
        {fileName && <span className="text-xs text-slate-500">{fileName}</span>}
        {!items && !msg && (
          <span className={`text-xs ${readiness.ready ? 'text-green-700' : text ? 'text-red-700' : 'text-slate-500'}`}>
            {readiness.msg}
          </span>
        )}
        {msg && (
          <span role="status" className={`text-xs ${msg.ok ? 'text-green-700' : 'text-red-700'}`}>
            {msg.text}
          </span>
        )}
      </div>

      {items && items.length > 0 && (
        <div className="max-h-96 overflow-auto rounded-lg border border-gnu-line">
          <table className="w-full min-w-[820px] border-collapse text-xs">
            <thead className="sticky top-0 bg-slate-50">
              <tr>
                {['행', '결과', '이름', '이메일', '플랫폼', '프로그램', '배정 계정', '사용기간', '메모'].map((h) => (
                  <th key={h} className="border-b border-gnu-line px-2 py-1.5 text-left font-medium text-slate-600">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((x) => (
                <tr key={x.line} className="odd:bg-white even:bg-slate-50/60">
                  <td className="px-2 py-1">{x.line}</td>
                  <td className={`whitespace-nowrap px-2 py-1 font-medium ${ACTION_CLASS[x.action]}`}>{ACTION_LABEL[x.action]}</td>
                  <td className="whitespace-nowrap px-2 py-1">{x.name}</td>
                  <td className="px-2 py-1">{x.email}</td>
                  <td className="px-2 py-1">{x.service === 'GPT' ? 'ChatGPT' : (x.service ?? '-')}</td>
                  <td className="px-2 py-1">{x.programName || '-'}</td>
                  <td className="whitespace-nowrap px-2 py-1">{x.accountId ?? '-'}</td>
                  <td className="whitespace-nowrap px-2 py-1">
                    {x.start ?? '-'} ~ {x.end ?? '-'}
                  </td>
                  <td className="px-2 py-1 text-slate-600">{x.msg}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-slate-500">
        파일 선택 → 「업로드」(검사·미리보기, DB 변경 없음) → 「확정」 순서입니다. 필수 열: 이름 · 이메일 · 플랫폼(ChatGPT·Claude).
        선택 열: 프로그램(이름 또는 번호) · 사용시작 · 사용종료(또는 「사용기간」 2026-10-01~2026-12-31). 계정번호는 적지 않습니다 —
        「사용중」은 업로드 후 가용 계정을 번호 순으로 자동 배정하고, 이미 사용중인 이메일·플랫폼은 건너뜁니다. 파일에 계정번호 열이 있어도
        무시합니다. 가용 계정이 모자라도 막지 않고 계정 없이 「사용중」 기록으로 저장합니다. 「회수완료」는 지난 사용 이력만 남기고 계정 상태는 바꾸지 않습니다. 사용현황 CSV 내려받기 파일도 그대로 올릴 수 있습니다.
      </p>
    </div>
  )
}

'use client'

/**
 * 사용현황 CSV 일괄 등록 (2026-10-29)
 * 「CSV 파일 올리기」(안내창: 양식·작성 규칙·프로그램 이름 목록·파일 선택·사전 검사, 2026-11-18)
 *   → 「검사·미리보기」/「업로드」(서버 검사·계정 자동 부여 미리보기, DB 변경 없음) → 「확정」.
 * 등록 상태는 「사용중」 또는 「회수완료」. 「사용중」으로 올려도 사용종료가 지난 행은 「회수완료」로 등록된다.
 * 「업로드」는 파일이 읽혔고 머리글이 맞으며 프로그램이 정해질 때만 활성(importReadiness).
 * 계정번호는 양식에 없다 — 「사용중」은 업로드 후 가용 계정을 번호 순으로 자동 부여한다.
 * 엑셀에서 저장한 CSV(UTF-8 또는 CP949) 모두 읽는다.
 */
import { useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { usageImportCommitAction, usageImportPreviewAction } from '@/app/admin/actions'
import { Button } from '@/components/ui'
import { todayKST } from '@/lib/date'
import { IMPORT_TEMPLATE, importPrecheck, importReadiness, type ImportMode, type PlanItem } from '@/lib/usage-import'

async function readText(file: File): Promise<string> {
  const buf = await file.arrayBuffer()
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf)
  } catch {
    return new TextDecoder('euc-kr').decode(buf) // 엑셀 「CSV(쉼표로 분리)」 저장본
  }
}

function downloadTemplate() {
  const url = URL.createObjectURL(new Blob([IMPORT_TEMPLATE], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = 'usage-import-template.csv'
  a.click()
  URL.revokeObjectURL(url)
}

const ACTION_LABEL: Record<PlanItem['action'], string> = { new: '등록', skip: '건너뜀', error: '오류' }
const ACTION_CLASS: Record<PlanItem['action'], string> = {
  new: 'text-green-700',
  skip: 'text-slate-500',
  error: 'text-red-700',
}

/** 안내창의 작성 규칙 표 */
const COLUMN_GUIDE: Array<[string, string, string, string]> = [
  ['이름', '필수', '김서영', ''],
  ['이메일', '필수', 'ksy@gnu.ac.kr', '워크스페이스에 초대한 주소'],
  ['플랫폼', '필수', 'ChatGPT', 'ChatGPT(GPT) 또는 Claude'],
  ['프로그램', '선택', '중급 교육과정', '아래 목록의 이름이나 번호. 비우면 「기본 프로그램」'],
  ['사용시작', '선택', '2026-11-17', '비우면 오늘(사용중)'],
  ['사용종료', '선택', '', '지난 날짜면 「회수완료」 이력으로 등록'],
]

export default function UsageImport({ programs }: { programs: Array<{ id: string; name: string }> }) {
  const router = useRouter()
  const dialog = useRef<HTMLDialogElement>(null)
  const [mode, setMode] = useState<ImportMode>('사용중')
  const [program, setProgram] = useState('')
  const [text, setText] = useState('')
  const [fileName, setFileName] = useState('')
  const [fileKey, setFileKey] = useState(0) // 확정 후 파일 입력 초기화용
  const [items, setItems] = useState<PlanItem[] | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [copied, setCopied] = useState('')
  const [dragging, setDragging] = useState(false)
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
  const newItems = items?.filter((x) => x.action === 'new') ?? []
  const newCount = newItems.length
  const movedCount = mode === '사용중' ? newItems.filter((x) => x.mode === '회수완료').length : 0
  const readiness = useMemo(() => importReadiness(text, program), [text, program])
  const precheck = useMemo(() => (text ? importPrecheck(text, programs, todayKST()) : []), [text, programs])

  const pick = async (f: File | undefined) => {
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
  }
  const preview = () =>
    start(async () => {
      const r = await usageImportPreviewAction(form())
      setItems(r.items ?? null)
      setMsg({ ok: r.ok, text: r.msg })
    })
  const copyName = async (name: string) => {
    try {
      await navigator.clipboard.writeText(name)
      setCopied(name)
    } catch {
      setCopied('')
    }
  }

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
        <div className="lg:col-span-2">
          <span className="block text-xs text-slate-600">CSV 파일</span>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Button type="button" variant="ghost" onClick={() => dialog.current?.showModal()}>
              CSV 파일 올리기
            </Button>
            <span className="text-xs text-slate-500">{fileName || '선택한 파일 없음 — 단추를 누르면 작성 안내가 열립니다'}</span>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="ghost" onClick={downloadTemplate}>
          양식 내려받기
        </Button>
        <Button
          type="button"
          disabled={pending || !readiness.ready}
          title={readiness.ready ? '서버에서 검사하고 배정될 계정을 미리 보여 줍니다(DB 변경 없음)' : readiness.msg}
          onClick={preview}
        >
          {pending && !items ? '업로드 중…' : '업로드'}
        </Button>
        <Button
          type="button"
          disabled={pending || newCount === 0}
          onClick={() => {
            const moved = movedCount > 0 ? ` (그중 사용종료가 지난 ${movedCount}건은 「회수완료」)` : ''
            if (!window.confirm(`「${mode}」으로 ${newCount}건을 등록합니다${moved}. 계속할까요?`)) return
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
        「CSV 파일 올리기」(작성 안내·파일 선택) → 「업로드」(검사·미리보기, DB 변경 없음) → 「확정」 순서입니다. 「사용중」은 가용 계정을 번호
        순으로 자동 배정하고, 사용종료가 지난 행은 「회수완료」 이력으로 등록합니다.
      </p>

      {/* 업로드 안내창 — 닫혀 있어도 파일 입력을 유지하려고 항상 그린다 */}
      <dialog
        ref={dialog}
        aria-labelledby="usage-import-guide-title"
        className="m-auto w-[min(720px,94vw)] rounded-xl border border-gnu-line bg-white p-0 text-sm text-slate-800 shadow-xl backdrop:bg-slate-900/40"
        onClick={(e) => {
          if (e.target === e.currentTarget) e.currentTarget.close() // 바깥(배경) 누르면 닫기
        }}
      >
        <div className="max-h-[85vh] space-y-4 overflow-y-auto p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 id="usage-import-guide-title" className="text-base font-semibold text-gnu-navy">
                CSV 파일 올리기
              </h3>
              <p className="mt-1 text-xs text-slate-500">
                여기서는 파일을 고르고 검사만 합니다. 「확정」을 누르기 전에는 아무것도 등록되지 않습니다.
              </p>
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={() => dialog.current?.close()}>
              닫기
            </Button>
          </div>

          <section className="space-y-2">
            <h4 className="font-semibold">1. 양식에 맞춰 작성</h4>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={downloadTemplate}>
                양식 내려받기
              </Button>
              <span className="text-xs text-slate-500">
                첫 줄(머리글)은 그대로 두고, <b>예시 행(홍길동)은 지운 뒤</b> 명단을 적습니다. 계정번호는 적지 않습니다.
              </span>
            </div>
            <div className="overflow-x-auto rounded-lg border border-gnu-line">
              <table className="w-full min-w-[520px] border-collapse text-xs">
                <thead className="bg-slate-50">
                  <tr>
                    {['열', '필수', '예시', '주의'].map((h) => (
                      <th key={h} className="border-b border-gnu-line px-2 py-1.5 text-left font-medium text-slate-600">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {COLUMN_GUIDE.map(([col, need, ex, note]) => (
                    <tr key={col} className="odd:bg-white even:bg-slate-50/60">
                      <td className="whitespace-nowrap px-2 py-1 font-medium">{col}</td>
                      <td className={`whitespace-nowrap px-2 py-1 ${need === '필수' ? 'text-red-700' : 'text-slate-500'}`}>{need}</td>
                      <td className="whitespace-nowrap px-2 py-1">{ex || '-'}</td>
                      <td className="px-2 py-1 text-slate-600">{note || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="space-y-2">
            <h4 className="font-semibold">2. 프로그램 이름 확인</h4>
            <p className="text-xs text-slate-500">
              「프로그램」 칸에는 아래 이름이나 번호를 적습니다(누르면 복사). 「직원 중급 교육과정」처럼 대상을 앞에 붙여도 알아봅니다.
              {copied && <span className="ml-1 text-green-700">「{copied}」 복사됨</span>}
            </p>
            <ul className="max-h-40 overflow-y-auto rounded-lg border border-gnu-line text-xs">
              {programs.map((p) => (
                <li key={p.id} className="odd:bg-white even:bg-slate-50/60">
                  <button type="button" className="flex w-full gap-2 px-2 py-1 text-left hover:bg-slate-100" onClick={() => copyName(p.name)}>
                    <span className="w-16 shrink-0 text-slate-500">{p.id}</span>
                    <span>{p.name}</span>
                  </button>
                </li>
              ))}
              {programs.length === 0 && <li className="px-2 py-1 text-slate-500">등록된 프로그램이 없습니다.</li>}
            </ul>
          </section>

          <section className="space-y-2">
            <h4 className="font-semibold">3. 파일 선택</h4>
            <label
              className={`block cursor-pointer rounded-lg border-2 border-dashed p-4 text-center text-xs ${
                dragging ? 'border-gnu-blue bg-blue-50' : 'border-slate-300 bg-slate-50'
              }`}
              onDragOver={(e) => {
                e.preventDefault()
                setDragging(true)
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault()
                setDragging(false)
                void pick(e.dataTransfer.files?.[0])
              }}
            >
              <span className="block text-slate-600">CSV 파일을 여기에 끌어다 놓거나 아래에서 고르세요 (1MB 이하, 엑셀 저장본 가능)</span>
              <input
                key={fileKey}
                type="file"
                accept=".csv,text/csv"
                className="mx-auto mt-2 block text-sm"
                onChange={(e) => void pick(e.target.files?.[0])}
              />
              {fileName && <span className="mt-2 block font-medium text-slate-800">{fileName}</span>}
            </label>
            {text && (
              <ul className="space-y-1 text-xs" role="status">
                <li className={readiness.ready ? 'text-green-700' : 'text-red-700'}>{readiness.msg}</li>
                {precheck.map((n) => (
                  <li key={n.text} className={n.level === 'error' ? 'text-red-700' : 'text-slate-600'}>
                    {n.level === 'error' ? '오류: ' : '참고: '}
                    {n.text}
                  </li>
                ))}
              </ul>
            )}
            {msg && !msg.ok && !text && <p className="text-xs text-red-700">{msg.text}</p>}
          </section>

          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-gnu-line pt-3">
            <span className="mr-auto text-xs text-slate-500">
              등록 상태 「{mode}」 · 기본 프로그램 {programs.find((p) => p.id === program)?.name ?? '선택 안 함'}
            </span>
            <Button type="button" variant="ghost" onClick={() => dialog.current?.close()}>
              닫기
            </Button>
            <Button
              type="button"
              disabled={pending || !readiness.ready}
              title={readiness.ready ? '서버에서 검사한 결과를 표로 보여 줍니다(DB 변경 없음)' : readiness.msg}
              onClick={() => {
                dialog.current?.close()
                preview()
              }}
            >
              검사·미리보기
            </Button>
          </div>
        </div>
      </dialog>
    </div>
  )
}

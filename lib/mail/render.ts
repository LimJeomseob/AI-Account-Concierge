/**
 * 메일 치환 (PRD §8) — 순수 함수.
 * 치환자는 `{이름}` 형식. 템플릿 편집 호환을 위해 형식을 바꾸지 않는다.
 */

export type MailVars = Record<string, string | number | null | undefined>

/** 본문·제목의 {치환자} 를 값으로 바꾼다. 값이 없으면 빈 문자열. */
export function renderTemplate(text: string, vars: MailVars): string {
  return text.replace(/\{([^{}\s]+)\}/g, (whole, key: string) => {
    if (Object.prototype.hasOwnProperty.call(vars, key)) {
      const v = vars[key]
      return v === null || v === undefined ? '' : String(v)
    }
    return whole // 모르는 치환자는 그대로 둔다(오탈자 확인용)
  })
}

/** 템플릿에서 사용된 치환자 목록 */
export function extractPlaceholders(text: string): string[] {
  const set = new Set<string>()
  for (const m of text.matchAll(/\{([^{}\s]+)\}/g)) set.add(m[1])
  return [...set]
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** 텍스트 본문 → 간단 HTML (링크 자동 변환) */
export function textToHtml(text: string): string {
  const escaped = escapeHtml(text)
  const linked = escaped.replace(
    /(https?:\/\/[^\s<]+)/g,
    (url) => `<a href="${url}" style="color:#1d4ed8">${url}</a>`,
  )
  return `<div style="font-family:'맑은 고딕',Malgun Gothic,system-ui,sans-serif;font-size:14px;line-height:1.7;color:#111;white-space:pre-wrap">${linked}</div>`
}

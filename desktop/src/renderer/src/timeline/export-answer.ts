// Save an answer as a file of the open folder: a PDF printed from the answer as the window shows it
// (formulas included), or Word or Markdown written by the sidecar.
import { openWorkspaceFile } from '../preview/preview-request'

export type ExportFormat = 'pdf' | 'docx' | 'md'

/** A short title: the first heading, else the first line. */
export function answerTitle(text: string): string {
  const heading = /^#{1,6}\s+(.+)$/m.exec(text)?.[1]
  const line = heading ?? text.split('\n').find((item) => item.trim()) ?? 'answer'
  return line.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_`#>[\]()]/g, '').trim().slice(0, 60)
}

/** The rules the answer's formulas need (KaTeX), with their fonts at absolute addresses. */
export function formulaStyles(): string {
  const parts: string[] = []
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList
    try {
      rules = sheet.cssRules
    } catch {
      continue
    }
    for (const rule of Array.from(rules)) {
      const text = rule.cssText
      if (!/katex/i.test(text)) continue
      const base = sheet.href ?? document.baseURI
      parts.push(text.replace(/url\((['"]?)([^'")]+)\1\)/g, (_match, quote: string, url: string) => {
        try {
          return `url(${quote}${new URL(url, base).href}${quote})`
        } catch {
          return `url(${quote}${url}${quote})`
        }
      }))
    }
  }
  return parts.join('\n').slice(0, 3_500_000)
}

export async function exportAnswer(format: ExportFormat, text: string, rendered: Element | null): Promise<string | null> {
  const title = answerTitle(text)
  const api = window.agentWorkspace
  let path: string | null = null
  if (format === 'pdf') {
    if (!api?.exportPdf || !rendered) return null
    path = await api.exportPdf({ html: rendered.innerHTML, css: formulaStyles(), title })
  } else {
    const response = await api.invoke({ type: 'answer.export', payload: { format, markdown: text, title }, sessionId: null })
    path = response.type === 'answer.export.result' && typeof response.payload.path === 'string' ? response.payload.path : null
  }
  if (path) openWorkspaceFile(path)
  return path
}

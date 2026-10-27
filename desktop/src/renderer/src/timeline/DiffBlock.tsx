import { Columns2, Copy, Rows3 } from 'lucide-react'
import { useState } from 'react'
import { useOptionalI18n } from '../i18n/I18nProvider'

export type DiffRow = { kind: 'context' | 'add' | 'delete'; text: string; oldLine: number | null; newLine: number | null }
export interface ParsedDiff { valid: boolean; rows: DiffRow[]; truncated: boolean }

const MAX_SOURCE_CHARS = 500_000
const MAX_ROWS = 10_000

export function parseUnifiedDiff(source: string): ParsedDiff {
  const bounded = source.slice(0, MAX_SOURCE_CHARS)
  const lines = bounded.split(/\r?\n/)
  if (!lines.some((line) => line.startsWith('@@ '))) return { valid: false, rows: [], truncated: source.length > bounded.length }
  const rows: DiffRow[] = []
  let oldLine = 0
  let newLine = 0
  let inHunk = false
  for (const line of lines) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
    if (hunk) {
      oldLine = Number(hunk[1])
      newLine = Number(hunk[2])
      inHunk = true
      continue
    }
    if (!inHunk || rows.length >= MAX_ROWS) continue
    if (line.startsWith('+') && !line.startsWith('+++')) rows.push({ kind: 'add', text: line.slice(1), oldLine: null, newLine: newLine++ })
    else if (line.startsWith('-') && !line.startsWith('---')) rows.push({ kind: 'delete', text: line.slice(1), oldLine: oldLine++, newLine: null })
    else if (line.startsWith(' ')) rows.push({ kind: 'context', text: line.slice(1), oldLine: oldLine++, newLine: newLine++ })
  }
  return { valid: rows.length > 0, rows, truncated: source.length > bounded.length || rows.length >= MAX_ROWS }
}

export function DiffBlock({ source }: { source: string }) {
  const { t } = useOptionalI18n()
  const [mode, setMode] = useState<'unified' | 'split'>('unified')
  const parsed = parseUnifiedDiff(source)
  if (!parsed.valid) return <pre className="diff-fallback">{source.slice(0, MAX_SOURCE_CHARS)}</pre>
  return (
    <section className="diff-block reading-surface">
      <header>
        <div className="segmented-control diff-mode" aria-label={t('diff.view')}>
          <button type="button" aria-label={t('diff.unifiedView')} className={mode === 'unified' ? 'is-selected' : ''} onClick={() => setMode('unified')}><Rows3 size={13} />{t('diff.unified')}</button>
          <button type="button" aria-label={t('diff.splitView')} className={mode === 'split' ? 'is-selected' : ''} onClick={() => setMode('split')}><Columns2 size={13} />{t('diff.split')}</button>
        </div>
        <button type="button" className="icon-button" aria-label={t('diff.copy')} title={t('diff.copy')} onClick={() => void navigator.clipboard?.writeText(source)}><Copy size={14} /></button>
      </header>
      {mode === 'unified' ? (
        <table aria-label={t('diff.unifiedTable')}><tbody>{parsed.rows.map((row, index) => <tr key={index} data-kind={row.kind}><td>{row.oldLine ?? ''}</td><td>{row.newLine ?? ''}</td><td><code>{row.text}</code></td></tr>)}</tbody></table>
      ) : (
        <table aria-label={t('diff.splitTable')}><tbody>{parsed.rows.map((row, index) => <tr key={index} data-kind={row.kind}><td>{row.kind === 'add' ? '' : row.text}</td><td>{row.kind === 'delete' ? '' : row.text}</td></tr>)}</tbody></table>
      )}
      {parsed.truncated ? <p className="truncation-note">{t('diff.truncated')}</p> : null}
    </section>
  )
}

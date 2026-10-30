import { useEffect, useState } from 'react'

import { useOptionalI18n } from '../i18n/I18nProvider'
import { HighlightedCode } from '../markdown/HighlightedCode'
import { SafeMarkdown } from '../markdown/SafeMarkdown'
import { requestPreview } from './preview-request'

type Text = string | string[]
interface Output {
  output_type: string
  name?: string
  text?: Text
  data?: Record<string, Text>
  ename?: string
  evalue?: string
  traceback?: string[]
  execution_count?: number | null
}
interface Cell { cell_type: string; source: Text; outputs?: Output[]; execution_count?: number | null }
interface Notebook { cells: Cell[]; metadata?: { language_info?: { name?: string }; kernelspec?: { language?: string } } }

const MAX_CELLS = 2000
const MAX_TEXT = 20_000

function joined(value: Text | undefined): string {
  return Array.isArray(value) ? value.join('') : value ?? ''
}

// Tracebacks carry terminal colours.
function plain(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001b\[[0-9;]*m/g, '')
}

function parse(source: string): Notebook | null {
  try {
    const value = JSON.parse(source) as Partial<Notebook>
    return Array.isArray(value.cells) ? value as Notebook : null
  } catch {
    return null
  }
}

function OutputView({ output }: { output: Output }) {
  if (output.output_type === 'stream') {
    return <pre className={`notebook-stream${output.name === 'stderr' ? ' stderr' : ''}`}>{joined(output.text).slice(0, MAX_TEXT)}</pre>
  }
  if (output.output_type === 'error') {
    return <pre className="notebook-stream stderr">{plain((output.traceback ?? [`${output.ename}: ${output.evalue}`]).join('\n')).slice(0, MAX_TEXT)}</pre>
  }
  const data = output.data ?? {}
  for (const kind of ['image/png', 'image/jpeg'] as const) {
    const picture = joined(data[kind]).replace(/\s+/g, '')
    if (picture && /^[A-Za-z0-9+/=]+$/.test(picture)) return <img className="notebook-image" alt="" src={`data:${kind};base64,${picture}`} />
  }
  if (data['text/markdown']) return <div className="preview-markdown"><SafeMarkdown source={joined(data['text/markdown'])} /></div>
  if (data['text/plain']) return <pre className="notebook-stream">{joined(data['text/plain']).slice(0, MAX_TEXT)}</pre>
  return null
}

/** A Jupyter notebook's cells: Markdown, code with its outputs (text, tables as text, pictures). */
export function NotebookView({ path }: { path: string }) {
  const { t } = useOptionalI18n()
  const [notebook, setNotebook] = useState<Notebook | null | 'failed'>(null)

  useEffect(() => {
    let current = true
    void (window.agentWorkspace?.readNotebook?.(path) ?? Promise.resolve(null)).then((text) => {
      if (!current) return
      setNotebook(text ? parse(text) ?? 'failed' : 'failed')
    }, () => { if (current) setNotebook('failed') })
    return () => { current = false }
  }, [path])

  if (notebook === null) return <p className="route-note">{t('preview.loading')}</p>
  if (notebook === 'failed') return <p className="route-error" role="alert">{t('preview.notebookFailed')}</p>
  const language = notebook.metadata?.language_info?.name ?? notebook.metadata?.kernelspec?.language ?? 'python'
  return (
    <div className="notebook" aria-label={t('preview.notebook', { count: notebook.cells.length })}>
      {notebook.cells.slice(0, MAX_CELLS).map((cell, index) => (
        <section key={index} className={`notebook-cell ${cell.cell_type}`}>
          {cell.cell_type === 'markdown' ? (
            <div className="preview-markdown"><SafeMarkdown source={joined(cell.source)} onOpenExternal={(url) => requestPreview({ kind: 'url', url })} /></div>
          ) : cell.cell_type === 'code' ? (
            <>
              <div className="notebook-input">
                <span className="notebook-count">[{cell.execution_count ?? ' '}]</span>
                <HighlightedCode language={language} code={joined(cell.source)} />
              </div>
              {(cell.outputs ?? []).map((output, number) => <OutputView key={number} output={output} />)}
            </>
          ) : <pre className="notebook-stream">{joined(cell.source)}</pre>}
        </section>
      ))}
    </div>
  )
}

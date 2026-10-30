import { ClipboardCopy, FileSpreadsheet, LoaderCircle, X, Zap } from 'lucide-react'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'

import { GatewayCommandError, type WorkbenchBridgeClient } from '../bridge/client'
import { useOptionalI18n } from '../i18n/I18nProvider'
import type { MessageKey } from '../i18n/messages'
import './quick-actions.css'

export type QuickClient = Pick<WorkbenchBridgeClient, 'quickRun' | 'quickTable'>

export interface QuickSettings {
  enabled: boolean
  accelerator: string
}

export const DEFAULT_QUICK_SETTINGS: QuickSettings = { enabled: true, accelerator: 'Control+Alt+Q' }
const SETTINGS_KEY = 'agent-workspace.quick-actions.v1'
const listeners = new Set<() => void>()
let cached: { raw: string | null; value: QuickSettings } | null = null

export function readQuickSettings(): QuickSettings {
  let raw: string | null = null
  try { raw = window.localStorage.getItem(SETTINGS_KEY) } catch { /* Defaults apply. */ }
  if (cached && cached.raw === raw) return cached.value
  let value = DEFAULT_QUICK_SETTINGS
  try {
    const parsed = raw ? JSON.parse(raw) as Partial<QuickSettings> : null
    if (parsed) {
      value = {
        enabled: parsed.enabled !== false,
        accelerator: typeof parsed.accelerator === 'string' && /^[A-Za-z0-9+]{1,40}$/.test(parsed.accelerator)
          ? parsed.accelerator
          : DEFAULT_QUICK_SETTINGS.accelerator,
      }
    }
  } catch { /* A damaged setting falls back to the default. */ }
  cached = { raw, value }
  return value
}

export function writeQuickSettings(value: QuickSettings): void {
  try { window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(value)) } catch { /* Kept for this run only. */ }
  cached = null
  for (const listener of listeners) listener()
}

export function useQuickSettings(): QuickSettings {
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => listeners.delete(listener) },
    readQuickSettings,
    () => DEFAULT_QUICK_SETTINGS,
  )
}

/** "Control+Alt+Q" as the keyboard shows it. */
export function shortcutLabel(accelerator: string): string {
  return accelerator.replace(/Control|CommandOrControl/g, 'Ctrl').replace(/\+/g, ' + ')
}

type TextAction = 'polish' | 'translate' | 'summarize' | 'official' | 'reply'
const TEXT_ACTIONS: readonly TextAction[] = ['polish', 'translate', 'summarize', 'official', 'reply']

function errorKey(error: unknown): MessageKey {
  const code = error instanceof GatewayCommandError ? error.code : ''
  switch (code) {
    case 'provider_unconfigured': return 'quick.error.provider'
    case 'runtime_unconfigured': return 'quick.error.folder'
    case 'no_table': return 'quick.error.noTable'
    case 'recognition_failed': return 'quick.error.recognition'
    case 'quick_action_timeout': return 'quick.error.timeout'
    default: return 'quick.error.failed'
  }
}

/**
 * The quick actions: the system-wide shortcut (registered while the window runs) brings the
 * window forward with what the clipboard holds — text to polish, translate, summarize, rewrite
 * in the official tone or answer, or a table screenshot to turn into a workbook.
 */
export function QuickActions({ client }: { client: QuickClient | null }) {
  const { t } = useOptionalI18n()
  const settings = useQuickSettings()
  const [capture, setCapture] = useState<{ text: string; image: string | null } | null>(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)
  const [table, setTable] = useState<{ path: string; rows: number; preview: string[][] } | null>(null)
  const [error, setError] = useState<MessageKey | null>(null)
  const [copied, setCopied] = useState(false)
  const panel = useRef<HTMLElement>(null)

  useEffect(() => {
    const configure = window.agentWorkspace?.configureQuickActions
    if (!configure) return
    void configure(settings).then((outcome) => {
      window.dispatchEvent(new CustomEvent('agent-workspace:quick-actions-status', { detail: outcome }))
    }).catch(() => undefined)
  }, [settings])

  useEffect(() => {
    const subscribe = window.agentWorkspace?.onQuickActions
    if (!subscribe) return
    return subscribe((next) => {
      setCapture(next)
      setText(next.text)
      setResult(null)
      setTable(null)
      setError(null)
      setCopied(false)
    })
  }, [])

  useEffect(() => {
    if (!capture) return
    panel.current?.focus()
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') { event.stopPropagation(); setCapture(null) }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [capture])

  if (!capture) return null

  const run = async (action: TextAction): Promise<void> => {
    if (!client || !text.trim()) return
    setBusy(action)
    setError(null)
    setCopied(false)
    try {
      const response = await client.quickRun(action, text)
      setResult(String((response.payload as { text?: unknown }).text ?? ''))
    } catch (failure) {
      setError(errorKey(failure))
    } finally {
      setBusy(null)
    }
  }

  const makeTable = async (): Promise<void> => {
    if (!client || !capture.image) return
    setBusy('table')
    setError(null)
    try {
      const response = await client.quickTable(capture.image)
      const payload = response.payload as { path?: string; rows?: number; preview?: string[][] }
      setTable({ path: String(payload.path ?? ''), rows: Number(payload.rows ?? 0), preview: Array.isArray(payload.preview) ? payload.preview : [] })
    } catch (failure) {
      setError(errorKey(failure))
    } finally {
      setBusy(null)
    }
  }

  const copy = async (): Promise<void> => {
    if (!result) return
    const done = window.agentWorkspace?.copyText ? await window.agentWorkspace.copyText(result) : false
    setCopied(done)
  }

  const target = document.querySelector('.workbench') ?? document.body
  return createPortal(
    <div className="command-overlay compare-overlay quick-overlay" role="presentation"
      onMouseDown={(event) => { if (event.target === event.currentTarget) setCapture(null) }}>
      <section ref={panel} tabIndex={-1} className="compare-dialog quick-dialog" role="dialog" aria-modal="true" aria-label={t('quick.title')}>
        <header>
          <Zap size={15} aria-hidden="true" />
          <strong>{t('quick.title')}</strong>
          <span className="quick-shortcut">{shortcutLabel(settings.accelerator)}</span>
          <button type="button" className="icon-button" aria-label={t('compare.close')} title={t('compare.close')} onClick={() => setCapture(null)}><X size={15} /></button>
        </header>
        <div className="quick-body">
          {capture.image ? (
            <div className="quick-image">
              <img src={`data:image/png;base64,${capture.image}`} alt={t('quick.image')} />
              <button type="button" className="provider-primary" disabled={busy !== null || !client} onClick={() => void makeTable()}>
                {busy === 'table' ? <LoaderCircle size={13} className="provider-spinner" aria-hidden="true" /> : <FileSpreadsheet size={13} aria-hidden="true" />}
                {t('quick.table')}
              </button>
            </div>
          ) : null}
          <label className="quick-text">
            <span>{t('quick.text')}</span>
            <textarea value={text} rows={5} maxLength={20_000} placeholder={t('quick.empty')} onChange={(event) => setText(event.target.value)} />
          </label>
          <div className="quick-actions" role="group" aria-label={t('quick.title')}>
            {TEXT_ACTIONS.map((action) => (
              <button key={action} type="button" disabled={busy !== null || !text.trim() || !client} onClick={() => void run(action)}>
                {busy === action ? <LoaderCircle size={13} className="provider-spinner" aria-hidden="true" /> : null}
                {t(`quick.action.${action}` as MessageKey)}
              </button>
            ))}
          </div>
          {error ? <p className="provider-status provider-status-error" role="status">{t(error)}</p> : null}
          {result !== null ? (
            <div className="quick-result">
              <textarea readOnly value={result} rows={8} aria-label={t('quick.result')} />
              <div className="provider-actions">
                <button type="button" className="provider-primary" onClick={() => void copy()}>
                  <ClipboardCopy size={13} aria-hidden="true" />{t(copied ? 'quick.copied' : 'quick.copy')}
                </button>
              </div>
            </div>
          ) : null}
          {table ? (
            <div className="quick-result" role="status">
              <p>{t('quick.tableSaved', { path: table.path, rows: table.rows })}</p>
              <table className="quick-preview">
                <tbody>
                  {table.preview.slice(0, 6).map((row, index) => (
                    <tr key={index}>{row.slice(0, 8).map((cell, column) => <td key={column}>{cell}</td>)}</tr>
                  ))}
                </tbody>
              </table>
              <div className="provider-actions">
                <button type="button" className="provider-primary" onClick={() => void window.agentWorkspace?.openPath(table.path)}>{t('quick.open')}</button>
              </div>
            </div>
          ) : null}
        </div>
      </section>
    </div>,
    target,
  )
}

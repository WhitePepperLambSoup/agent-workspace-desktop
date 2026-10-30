import { ChevronRight, CircleAlert, CircleCheck, FileText, FolderInput, Globe, LoaderCircle, Smartphone, Undo2, Users, Wrench } from 'lucide-react'
import { useContext, useEffect, useMemo, useState } from 'react'

import { stepVerb, type FileBatchUndoView } from '../files/model'
import { requestDocumentPreview } from '../office/preview-request'
import { openWorkspaceFile } from '../preview/preview-request'
import { TimelineActionsContext } from './actions-context'
import type { ToolEntry } from './types'
import { useOptionalI18n } from '../i18n/I18nProvider'
import { localizeKnownStatus, zhCN, type MessageKey } from '../i18n/messages'
import { compactTarget, describeBrowserCall, type BrowserCall } from './browser-tool'
import { TimelineWorkspaceContext } from './workspace-context'

export function toolEntryKey(value: { attemptId?: string; toolCallId?: string }): string {
  return value.attemptId || value.toolCallId || 'tool'
}

function text(value: unknown, unavailable: string): string {
  if (typeof value === 'string') return value.slice(0, 100_000)
  try { return JSON.stringify(value, null, 2).slice(0, 100_000) } catch { return unavailable }
}

const BROWSER_ACTIONS = new Set(['navigate', 'snapshot', 'list_tabs', 'click', 'type', 'fill', 'evaluate', 'screenshot', 'print_pdf'])

function useBrowserAction(): (action: string) => string {
  const { t } = useOptionalI18n()
  return (action) => BROWSER_ACTIONS.has(action) ? t(`tool.browser.action.${action}` as MessageKey) : action
}

function WorkspaceThumbnail({ path }: { path: string }) {
  const { t } = useOptionalI18n()
  const workspace = useContext(TimelineWorkspaceContext)
  const [source, setSource] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const loader = typeof window === 'undefined' ? undefined : window.agentWorkspace?.imageThumbnail
  useEffect(() => {
    setSource(null)
    setFailed(false)
    if (!workspace || !loader) return
    let active = true
    void loader(workspace, path).then(
      (url) => { if (active) { setSource(url); setFailed(url === null) } },
      () => { if (active) setFailed(true) },
    )
    return () => { active = false }
  }, [loader, path, workspace])
  if (!workspace || !loader) return null
  if (failed) return <p className="browser-tool-note">{t('tool.browser.previewUnavailable')}</p>
  return source
    ? <img className="browser-tool-shot" src={source} alt={t('tool.browser.screenshotAlt', { path })} />
    : <div className="browser-tool-shot is-loading" aria-hidden="true" />
}

function BrowserToolDetail({ call }: { call: BrowserCall }) {
  const { t } = useOptionalI18n()
  const actionLabel = useBrowserAction()
  return (
    <div className="browser-tool">
      <dl className="browser-tool-facts">
        <div><dt>{t('tool.browser.action')}</dt><dd>{actionLabel(call.action)}{call.outcome ? <span className="browser-tool-outcome" data-outcome={call.outcome}>{t(call.outcome === 'ok' ? 'tool.browser.succeeded' : 'tool.browser.failed')}</span> : null}</dd></div>
        {call.title ? <div><dt>{t('tool.browser.pageTitle')}</dt><dd>{call.title}</dd></div> : null}
        {call.url ? <div><dt>{t('tool.browser.url')}</dt><dd><code>{call.url}</code></dd></div> : null}
        {call.target && call.action !== 'navigate' ? <div><dt>{t('tool.browser.target')}</dt><dd><code>{call.target}</code></dd></div> : null}
        {call.pdfPath ? <div><dt>{t('tool.browser.savedPdf')}</dt><dd><code>{call.pdfPath}</code> <button type="button" className="secondary-button" onClick={() => openWorkspaceFile(call.pdfPath!)}>{t('turnFiles.openFile')}</button></dd></div> : null}
      </dl>
      {call.imagePath ? <figure className="browser-tool-figure"><WorkspaceThumbnail path={call.imagePath} /><figcaption><code>{call.imagePath}</code> <button type="button" className="secondary-button" onClick={() => openWorkspaceFile(call.imagePath!)}>{t('turnFiles.openFile')}</button></figcaption></figure> : null}
      {call.tabs.length > 0 ? (
        <ul className="browser-tool-tabs" aria-label={t('tool.browser.tabs')}>
          {call.tabs.map((tab, index) => <li key={`${tab.id}:${index}`}><strong>{tab.title || tab.url}</strong>{tab.title ? <small>{tab.url}</small> : null}</li>)}
        </ul>
      ) : null}
      {call.text ? <details className="browser-tool-text"><summary>{t('tool.browser.capturedText')}</summary><pre>{call.text}</pre></details> : null}
    </div>
  )
}

interface PageCheck {
  url: string
  title: string
  loaded: boolean
  error: string
  screenshot: string | null
  problems: Array<{ kind: 'console' | 'exception' | 'request' | 'http' | 'log' | 'note'; text: string }>
}

/** What check_page found on a page, from its result. */
function pageCheck(entry: ToolEntry): PageCheck | null {
  if (entry.name !== 'check_page' || entry.state !== 'settled') return null
  let value: unknown = entry.result
  if (typeof value === 'string') {
    try { value = JSON.parse(value) } catch { return null }
  }
  if (!value || typeof value !== 'object') return null
  const report = value as Record<string, unknown>
  const list = (key: string): unknown[] => Array.isArray(report[key]) ? report[key] as unknown[] : []
  const field = (item: unknown, name: string): string => item && typeof item === 'object' ? String((item as Record<string, unknown>)[name] ?? '') : ''
  return {
    url: String(report.url ?? ''),
    title: String(report.title ?? ''),
    loaded: report.loaded !== false,
    error: String(report.error ?? ''),
    screenshot: typeof report.screenshot === 'string' ? report.screenshot : null,
    problems: [
      ...list('exceptions').map((item) => ({ kind: 'exception' as const, text: String(item) })),
      ...list('console').map((item) => ({ kind: 'console' as const, text: `${field(item, 'level')}: ${field(item, 'text')}` })),
      ...list('failed_requests').map((item) => ({ kind: 'request' as const, text: `${field(item, 'error')} ${field(item, 'url')}` })),
      ...list('http_errors').map((item) => ({ kind: 'http' as const, text: `${field(item, 'status')} ${field(item, 'url')}` })),
      ...list('browser_log').map((item) => ({ kind: 'log' as const, text: `${field(item, 'level')}: ${field(item, 'text')}` })),
      ...list('notes').map((item) => ({ kind: 'note' as const, text: String(item) })),
    ],
  }
}

function PageCheckDetail({ check }: { check: PageCheck }) {
  const { t } = useOptionalI18n()
  return (
    <div className="browser-tool page-check">
      <dl className="browser-tool-facts">
        {check.title ? <div><dt>{t('tool.browser.pageTitle')}</dt><dd>{check.title}</dd></div> : null}
        <div><dt>{t('tool.browser.url')}</dt><dd><code>{check.url}</code></dd></div>
        {!check.loaded ? <div><dt>{t('tool.pageCheck.error')}</dt><dd><code>{check.error}</code></dd></div> : null}
      </dl>
      {check.problems.length > 0 ? (
        <ul className="page-check-problems" aria-label={t('tool.pageCheck.problems')}>
          {check.problems.map((problem, index) => (
            <li key={`${problem.kind}:${index}`} data-kind={problem.kind}>
              <span>{t(`tool.pageCheck.kind.${problem.kind}` as MessageKey)}</span>
              <code>{problem.text}</code>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

/** The workspace file an Office tool made or changed, once it finished. */
function officeFile(entry: ToolEntry): string | null {
  if (!OFFICE_TOOLS.has(entry.name) || entry.state !== 'settled') return null
  const argumentsValue = entry.arguments && typeof entry.arguments === 'object' ? entry.arguments as Record<string, unknown> : null
  const path = argumentsValue?.path
  return typeof path === 'string' && path ? path : null
}

const OFFICE_TOOLS = new Set(['create_docx', 'edit_docx', 'create_xlsx', 'update_xlsx', 'create_pptx'])

/** The digest of the content the call replaced (it names it to change a file), if any. */
function replacedDigest(entry: ToolEntry): string | undefined {
  const argumentsValue = entry.arguments && typeof entry.arguments === 'object' ? entry.arguments as Record<string, unknown> : null
  const digest = argumentsValue?.expected_sha256
  return typeof digest === 'string' && /^[0-9a-f]{64}$/.test(digest) ? digest : undefined
}

/** The digest of the file the call wrote, from its result. */
function resultDigest(entry: ToolEntry): string | undefined {
  let value: unknown = entry.result
  if (typeof value === 'string') {
    try { value = JSON.parse(value) } catch { return undefined }
  }
  const digest = value && typeof value === 'object' ? (value as Record<string, unknown>).sha256 : undefined
  return typeof digest === 'string' && /^[0-9a-f]{64}$/.test(digest) ? digest : undefined
}

interface DelegatedResult {
  title: string
  state: string
  branch: string | null
}

/** What each sub-agent of a finished delegate_tasks call came back with. */
function delegatedResults(entry: ToolEntry): DelegatedResult[] | null {
  if (entry.name !== 'delegate_tasks' || entry.state !== 'settled') return null
  let value: unknown = entry.result
  if (typeof value === 'string') {
    try { value = JSON.parse(value) } catch { return null }
  }
  const results = value && typeof value === 'object' ? (value as Record<string, unknown>).results : undefined
  if (!Array.isArray(results)) return null
  return results.flatMap((item: unknown) => {
    if (!item || typeof item !== 'object') return []
    const record = item as Record<string, unknown>
    if (typeof record.title !== 'string' || typeof record.state !== 'string') return []
    return [{ title: record.title, state: record.state, branch: typeof record.branch === 'string' ? record.branch : null }]
  })
}

const PHONE_JOB_KEYS: Record<string, MessageKey> = {
  waiting: 'phoneJobs.waiting',
  accepted: 'phoneJobs.accepted',
  running: 'phoneJobs.running',
  succeeded: 'phoneJobs.succeeded',
  failed: 'phoneJobs.failed',
  rejected: 'phoneJobs.rejected',
  expired: 'phoneJobs.expired',
  cancelled: 'phoneJobs.cancelled',
}

/** How a finished phone_task call ended on the phone. */
function phoneJobState(entry: ToolEntry): MessageKey | null {
  if (entry.name !== 'phone_task' || entry.state !== 'settled') return null
  let value: unknown = entry.result
  if (typeof value === 'string') {
    try { value = JSON.parse(value) } catch { return null }
  }
  const state = value && typeof value === 'object' ? (value as Record<string, unknown>).state : undefined
  return typeof state === 'string' ? PHONE_JOB_KEYS[state] ?? null : null
}

interface FileBatchResult {
  id: string
  changes: number
  steps: Array<{ action: string; path: string; to: string | null }>
}

/** The batch an organize_files call made, from its result. */
function fileBatch(entry: ToolEntry): FileBatchResult | null {
  if (entry.name !== 'organize_files' || entry.state !== 'settled') return null
  let value: unknown = entry.result
  if (typeof value === 'string') {
    try { value = JSON.parse(value) } catch { return null }
  }
  const result = value && typeof value === 'object' ? value as Record<string, unknown> : null
  if (!result || typeof result.batch_id !== 'string' || typeof result.changes !== 'number') return null
  const steps = Array.isArray(result.steps)
    ? result.steps.flatMap((item: unknown) => {
        const step = item && typeof item === 'object' ? item as Record<string, unknown> : null
        return step && typeof step.action === 'string' && typeof step.path === 'string'
          ? [{ action: step.action, path: step.path, to: typeof step.to === 'string' ? step.to : null }]
          : []
      })
    : []
  return { id: result.batch_id, changes: result.changes, steps }
}

function FileBatchUndo({ batchId }: { batchId: string }) {
  const { t } = useOptionalI18n()
  const { undoFileBatch } = useContext(TimelineActionsContext)
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'failed'>('idle')
  const [outcome, setOutcome] = useState<FileBatchUndoView | null>(null)
  if (!undoFileBatch) return null
  const undo = async (): Promise<void> => {
    setState('busy')
    try {
      setOutcome(await undoFileBatch(batchId))
      setState('done')
    } catch {
      setState('failed')
    }
  }
  return (
    <div className="tool-row-actions">
      {state === 'done' && outcome ? (
        <span className="tool-row-note" role="status">
          {outcome.skipped.length > 0
            ? t('files.batch.partly', { undone: outcome.undone, skipped: outcome.skipped.length })
            : t('files.batch.undone')}
        </span>
      ) : (
        <button type="button" className="secondary-button" disabled={state === 'busy'} onClick={() => void undo()}>
          <Undo2 size={13} />{t(state === 'busy' ? 'files.batch.undoing' : 'files.batch.undo')}
        </button>
      )}
      {state === 'failed' ? <span className="route-error" role="status">{t('files.batch.undoFailed')}</span> : null}
    </div>
  )
}

export function ToolRow({ entry }: { entry: ToolEntry }) {
  const { locale, t } = useOptionalI18n()
  const actionLabel = useBrowserAction()
  const [open, setOpen] = useState(false)
  const terminal = ['settled', 'failed', 'rejected', 'cancelled', 'unknown'].includes(entry.state)
  const Status = entry.state === 'settled' ? CircleCheck : terminal ? CircleAlert : LoaderCircle
  const browser = useMemo(
    () => entry.name === 'browser' ? describeBrowserCall(entry.arguments, entry.result) : null,
    [entry.arguments, entry.name, entry.result],
  )
  const office = officeFile(entry)
  const previousSha256 = office ? replacedDigest(entry) : undefined
  const delegated = useMemo(() => delegatedResults(entry), [entry])
  const batch = useMemo(() => fileBatch(entry), [entry])
  const phoneJob = useMemo(() => phoneJobState(entry), [entry])
  const page = useMemo(() => pageCheck(entry), [entry])
  const summary = browser
    ? [actionLabel(browser.action), compactTarget(browser)].filter(Boolean).join(' · ')
    : page ? (!page.loaded ? t('tool.pageCheck.notLoaded') : page.problems.length ? t('tool.pageCheck.found', { count: page.problems.length }) : t('tool.pageCheck.clean'))
    : office ? office.split(/[\\/]/).at(-1) ?? office
      : delegated ? t('tool.delegate.summary', { done: delegated.filter((item) => item.state === 'succeeded').length, total: delegated.length })
        : batch ? t('files.batch.changes', { count: batch.changes })
          : phoneJob ? t(phoneJob) : null
  const raw = <><h4>{t('tool.arguments')}</h4><pre>{text(entry.arguments, t('tool.unavailable'))}</pre>{entry.result !== undefined ? <><h4>{t('tool.result')}</h4><pre>{text(entry.result, t('tool.unavailable'))}</pre></> : null}</>
  // The same plain-language name the approval shows, with the tool's own name beside it.
  const friendlyKey = `approval.tool.${entry.name}`
  const friendlyName = friendlyKey in zhCN ? t(friendlyKey as MessageKey) : null
  const toolKind = browser || page ? 'browser' : office ? 'office' : entry.name === 'delegate_tasks' ? 'delegate' : entry.name === 'organize_files' ? 'files' : undefined
  return (
    <section className="tool-row reading-surface" data-state={entry.state} data-tool={toolKind}>
      <button type="button" aria-expanded={open} aria-label={t('tool.label', { name: entry.name, state: localizeKnownStatus(locale, entry.state) })} onClick={() => setOpen((value) => !value)}>
        <ChevronRight size={14} className={open ? 'is-open' : ''} />
        {browser || entry.name === 'check_page' ? <Globe size={14} /> : office ? <FileText size={14} /> : entry.name === 'delegate_tasks' ? <Users size={14} /> : entry.name === 'organize_files' ? <FolderInput size={14} /> : entry.name === 'phone_task' ? <Smartphone size={14} /> : <Wrench size={14} />}
        {friendlyName ? <span>{friendlyName}<code className="tool-row-id">{entry.name}</code></span> : <span>{entry.name}</span>}
        {summary ? <span className="tool-row-summary" title={browser?.url ?? browser?.target ?? office ?? undefined}>{summary}</span> : null}
        <Status size={14} />
      </button>
      {delegated && delegated.length > 0 ? (
        <ul className="tool-row-subagents" aria-label={t('tool.delegate.results')}>
          {delegated.map((item, index) => (
            <li key={`${item.title}:${index}`} data-state={item.state}>
              <strong>{item.title}</strong>
              <span>{localizeKnownStatus(locale, item.state)}</span>
              {item.branch ? <code>{item.branch}</code> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {batch ? (
        <>
          <ul className="tool-row-subagents tool-row-files" aria-label={t('files.batch.list')}>
            {batch.steps.slice(0, 12).map((step, index) => (
              <li key={`${step.path}:${index}`}>
                <span>{t(`files.action.${stepVerb(step)}` as MessageKey)}</span>
                <strong title={step.path}>{step.path}</strong>
                {step.to ? <code title={step.to}>→ {step.to}</code> : null}
              </li>
            ))}
            {batch.steps.length > 12 ? <li><span>{t('files.batch.more', { count: batch.changes - 12 })}</span></li> : null}
          </ul>
          <FileBatchUndo batchId={batch.id} />
        </>
      ) : null}
      {page?.screenshot ? (
        <figure className="browser-tool-figure page-check-shot">
          <WorkspaceThumbnail path={page.screenshot} />
          <figcaption><code>{page.screenshot}</code> <button type="button" className="secondary-button" onClick={() => openWorkspaceFile(page.screenshot!)}>{t('turnFiles.openFile')}</button></figcaption>
        </figure>
      ) : null}
      {office ? <div className="tool-row-actions">
        <button type="button" className="secondary-button" onClick={() => requestDocumentPreview({ path: office })}>{t('office.preview')}</button>
        {previousSha256
          ? <button type="button" className="secondary-button" onClick={() => requestDocumentPreview({ path: office, previousSha256, resultSha256: resultDigest(entry) })}>{t('office.previewChange')}</button>
          : null}
      </div> : null}
      {open ? (
        <div className="tool-detail">
          {browser ? <><BrowserToolDetail call={browser} /><details className="tool-raw"><summary>{t('tool.browser.raw')}</summary>{raw}</details></>
            : page ? <><PageCheckDetail check={page} /><details className="tool-raw"><summary>{t('tool.browser.raw')}</summary>{raw}</details></>
              : raw}
        </div>
      ) : null}
    </section>
  )
}

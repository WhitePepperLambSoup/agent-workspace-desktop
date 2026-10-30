import { ArrowLeft, ArrowRight, ExternalLink, FileCode, FolderOpen, Globe, Move, RefreshCw, X } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

import { CLOSED_PREVIEW, isPanelFile, type PreviewState } from '../../../shared/preview'
import type { WorkbenchBridgeClient } from '../bridge/client'
import { useOptionalI18n } from '../i18n/I18nProvider'
import type { MessageKey } from '../i18n/messages'
import { SafeMarkdown } from '../markdown/SafeMarkdown'
import { HunkDiff } from '../changes/HunkDiff'
import { FigurePointsEditor, type FiguresClient } from '../figures/FigurePointsEditor'
import { NotebookView } from './NotebookView'
import { requestEditor, requestPreview, type FileChange, type PreviewRequest } from './preview-request'
import './preview.css'

type ReaderClient = Partial<Pick<WorkbenchBridgeClient, 'readWorkspaceFile' | 'turnFileDiff' | 'undoTurnHunk' | 'startTurn' | 'figurePoints' | 'correctFigure'>>

// Files the system may open (the main process checks again): see OPENABLE_DOCUMENTS.
const SYSTEM_OPENABLE = /\.(pdf|docx|xlsx|pptx|png|jpe?g|gif|webp)$/i

function fileName(path: string): string {
  return path.split(/[\\/]/).at(-1) || path
}

function hostOf(url: string): string {
  try { return new URL(url).host || url } catch { return url }
}

/** Hides the embedded page while another dialog is in front of the sheet. */
function useCovered(own: React.RefObject<HTMLElement | null>): boolean {
  const [covered, setCovered] = useState(false)
  useEffect(() => {
    const check = (): void => {
      const dialogs = [...document.querySelectorAll('[aria-modal="true"]')]
      setCovered(dialogs.some((dialog) => dialog !== own.current))
    }
    check()
    const observer = new MutationObserver(check)
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-modal'] })
    return () => observer.disconnect()
  }, [own])
  return covered
}

function PanelBody({ request, onClose, sheet, figures }: {
  request: Extract<PreviewRequest, { kind: 'url' }> | Extract<PreviewRequest, { kind: 'file' }>
  onClose: () => void
  sheet: React.RefObject<HTMLElement | null>
  /** A figure saved with its point map can have its points dragged. */
  figures?: FiguresClient
}) {
  const { t } = useOptionalI18n()
  const api = window.agentWorkspace?.preview
  const [state, setState] = useState<PreviewState>(CLOSED_PREVIEW)
  const [refused, setRefused] = useState(false)
  const [draggable, setDraggable] = useState(false)
  const [editing, setEditing] = useState(false)
  const figurePath = request.kind === 'file' && /\.(png|jpe?g)$/i.test(request.path) ? request.path : null

  useEffect(() => {
    if (!figures || !figurePath) return undefined
    let current = true
    void figures.figurePoints(figurePath).then((response) => {
      if (current) setDraggable((response.payload as { available?: boolean }).available === true)
    }, () => undefined)
    return () => { current = false }
  }, [figures, figurePath])
  const frame = useRef<HTMLDivElement>(null)
  const covered = useCovered(sheet)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    if (!api) return undefined
    const stop = api.onState((next) => {
      if (next.escape) closeRef.current()
      else setState(next)
    })
    setRefused(false)
    const target = request.kind === 'url'
      ? { kind: 'url' as const, url: request.url }
      : { kind: 'file' as const, path: request.path, ...(request.page ? { page: request.page } : {}) }
    void api.open(target).then((opened) => { if (!opened) setRefused(true) }, () => setRefused(true))
    return () => {
      stop()
      api.setBounds(null)
      void api.act('close')
    }
  }, [api, request])

  // The page sits over this box: it follows the box, and hides while a dialog covers the sheet.
  useLayoutEffect(() => {
    const box = frame.current
    if (!api || !box) return undefined
    let raf = 0
    const place = (): void => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const rect = box.getBoundingClientRect()
        api.setBounds(covered || refused ? null : { x: rect.left, y: rect.top, width: rect.width, height: rect.height })
      })
    }
    place()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place)
    observer?.observe(box)
    window.addEventListener('resize', place)
    return () => {
      cancelAnimationFrame(raf)
      observer?.disconnect()
      window.removeEventListener('resize', place)
    }
  }, [api, covered, refused])

  const notice: MessageKey | null = !api
    ? 'preview.unavailable'
    : refused
      ? 'preview.refused'
      : state.blocked === 'download'
        ? 'preview.blockedDownload'
        : state.blocked === 'navigation'
          ? 'preview.blockedLink'
          : state.failed
            ? 'preview.failed'
            : null
  const path = request.kind === 'file' ? request.path : null
  const title = state.title || (path ? fileName(path) : hostOf(state.location || (request.kind === 'url' ? request.url : '')))
  const location = path ?? (state.location || (request.kind === 'url' ? request.url : ''))
  return <>
    <header className="preview-header">
      <span className="preview-nav">
        <button type="button" className="icon-button" aria-label={t('preview.back')} title={t('preview.back')} disabled={!state.canGoBack} onClick={() => void api?.act('back')}><ArrowLeft size={14} /></button>
        <button type="button" className="icon-button" aria-label={t('preview.forward')} title={t('preview.forward')} disabled={!state.canGoForward} onClick={() => void api?.act('forward')}><ArrowRight size={14} /></button>
        <button type="button" className="icon-button" aria-label={t('preview.reload')} title={t('preview.reload')} disabled={!state.open} onClick={() => void api?.act('reload')}><RefreshCw size={14} className={state.loading ? 'is-spinning' : undefined} /></button>
      </span>
      <span className="preview-title">
        {path ? <FileCode size={14} aria-hidden="true" /> : <Globe size={14} aria-hidden="true" />}
        <strong title={title}>{title}</strong>
        <small title={location}>{location}</small>
      </span>
      {state.external ? <button type="button" className="secondary-button" onClick={() => void api?.act('external')}><ExternalLink size={13} />{t('preview.openInBrowser')}</button> : null}
      {!api && request.kind === 'url' && window.agentWorkspace?.openExternal ? <button type="button" className="secondary-button" onClick={() => void window.agentWorkspace.openExternal(request.url)}><ExternalLink size={13} />{t('preview.openInBrowser')}</button> : null}
      {path && SYSTEM_OPENABLE.test(path) && window.agentWorkspace?.openPath ? <button type="button" className="secondary-button" onClick={() => void window.agentWorkspace.openPath(path)}><ExternalLink size={13} />{t('preview.openWithSystem')}</button> : null}
      {draggable && figurePath ? <button type="button" className="secondary-button" onClick={() => setEditing(true)}><Move size={13} />{t('figures.editor.open')}</button> : null}
      {path && window.agentWorkspace?.revealPath ? <button type="button" className="icon-button" aria-label={t('preview.reveal')} title={t('preview.reveal')} onClick={() => void window.agentWorkspace.revealPath?.(path)}><FolderOpen size={14} /></button> : null}
      <button type="button" className="icon-button" aria-label={t('preview.close')} title={t('preview.close')} onClick={onClose}><X size={15} /></button>
    </header>
    {editing && figures && figurePath ? (
      <FigurePointsEditor client={figures} path={figurePath} onClose={() => { setEditing(false); void api?.act('reload') }} />
    ) : null}
    {notice ? <p className="preview-notice" role="status" data-notice={notice}>{t(notice)}</p> : null}
    <div ref={frame} className="preview-frame" data-testid="preview-frame" data-loading={state.loading || undefined} aria-label={t('preview.page')} role="region" />
  </>
}

const DIFF_NOTES: Record<string, MessageKey> = {
  not_kept: 'preview.diff.notKept',
  binary: 'preview.diff.binary',
  too_large: 'preview.diff.tooLarge',
  unavailable: 'preview.diff.unavailable',
}

type FileText = { content: string; truncated: boolean; binary: boolean }
type FileDiff = { state: string; diff: string; truncated: boolean; changedSince: boolean; missing: boolean; sha256: string | null }

function ReaderBody({ path, change, initialView, client, onClose }: {
  path: string
  change?: FileChange
  initialView?: 'changes'
  client?: ReaderClient
  onClose: () => void
}) {
  const { t } = useOptionalI18n()
  const [view, setView] = useState<'changes' | 'content'>(change && initialView === 'changes' ? 'changes' : 'content')
  const [text, setText] = useState<FileText | null>(null)
  const [diff, setDiff] = useState<FileDiff | null>(null)
  const [error, setError] = useState<MessageKey | null>(null)
  // Read again after a part was put back.
  const [diffVersion, setDiffVersion] = useState(0)
  const [hunkNote, setHunkNote] = useState<MessageKey | null>(null)

  const loadText = useCallback(async (): Promise<void> => {
    if (!client?.readWorkspaceFile) {
      setError('preview.readFailed')
      return
    }
    try {
      const payload = (await client.readWorkspaceFile(path)).payload as Record<string, unknown>
      setText({
        content: typeof payload.content === 'string' ? payload.content : '',
        truncated: payload.truncated === true,
        binary: payload.isBinary === true,
      })
    } catch (reason) {
      const code = reason && typeof reason === 'object' && 'code' in reason ? String(reason.code) : ''
      setError(code === 'file_not_found' ? 'preview.missing' : 'preview.readFailed')
    }
  }, [client, path])

  useEffect(() => { void loadText() }, [loadText])
  useEffect(() => {
    if (!change || !client?.turnFileDiff) return
    let active = true
    void client.turnFileDiff(change.sessionId, change.eventId, path).then((reply) => {
      if (!active) return
      const payload = reply.payload as Record<string, unknown>
      setDiff({
        state: typeof payload.state === 'string' ? payload.state : 'unavailable',
        diff: typeof payload.diff === 'string' ? payload.diff : '',
        truncated: payload.truncated === true,
        changedSince: payload.changedSince === true,
        missing: payload.missing === true,
        sha256: typeof payload.currentSha256 === 'string' ? payload.currentSha256 : null,
      })
    }, () => { if (active) setDiff({ state: 'unavailable', diff: '', truncated: false, changedSince: false, missing: false, sha256: null }) })
    return () => { active = false }
  }, [change, client, path, diffVersion])

  const undoHunk = change && client?.undoTurnHunk && diff?.sha256 && !diff.truncated ? async (index: number): Promise<void> => {
    setHunkNote(null)
    try {
      const payload = (await client.undoTurnHunk!(change.sessionId, change.eventId, path, index, diff.sha256!)).payload as Record<string, unknown>
      if (payload.undone !== true) setHunkNote(payload.reason === 'changed' ? 'preview.diff.hunkChanged' : 'preview.diff.hunkFailed')
    } catch {
      setHunkNote('preview.diff.hunkFailed')
    }
    setDiffVersion((value) => value + 1)
    void loadText()
  } : undefined
  const askHunk = client?.startTurn ? async (hunk: string, comment: string): Promise<boolean> => {
    try {
      await client.startTurn!(t('changes.askAbout', { path, diff: hunk, comment }))
      return true
    } catch {
      return false
    }
  } : undefined

  const markdown = /\.(md|markdown)$/i.test(path)
  const notebook = /\.ipynb$/i.test(path) && Boolean(window.agentWorkspace?.readNotebook)
  const lines = text && !text.binary && !markdown ? text.content.split(/\r?\n/) : []
  return <>
    <header className="preview-header">
      <span className="preview-title">
        <FileCode size={14} aria-hidden="true" />
        <strong title={path}>{fileName(path)}</strong>
        <small title={path}>{path}</small>
      </span>
      {change ? <div className="segmented-control preview-view-switch" role="radiogroup" aria-label={t('preview.view')}>
        {(['changes', 'content'] as const).map((value) => <button key={value} type="button" role="radio" aria-checked={view === value}
          className={view === value ? 'is-selected' : undefined} onClick={() => setView(value)}>{t(value === 'changes' ? 'preview.changes' : 'preview.content')}</button>)}
      </div> : null}
      <button type="button" className="secondary-button" onClick={() => { requestEditor(path); onClose() }}><FileCode size={13} />{t('preview.openInEditor')}</button>
      {window.agentWorkspace?.revealPath ? <button type="button" className="icon-button" aria-label={t('preview.reveal')} title={t('preview.reveal')} onClick={() => void window.agentWorkspace.revealPath?.(path)}><FolderOpen size={14} /></button> : null}
      <button type="button" className="icon-button" aria-label={t('preview.close')} title={t('preview.close')} onClick={onClose}><X size={15} /></button>
    </header>
    <div className="preview-reader">
      {view === 'changes' && change ? (
        diff === null ? <p className="route-note">{t('preview.loading')}</p>
          : diff.state === 'ok' ? <>
            {diff.missing ? <p className="route-note">{t('preview.diff.missing')}</p> : null}
            {diff.changedSince ? <p className="route-note">{t('preview.diff.changedSince')}</p> : null}
            {hunkNote ? <p className="route-error" role="status">{t(hunkNote)}</p> : null}
            {diff.diff.trim() ? <HunkDiff diff={diff.diff} onUndo={undoHunk} onAsk={askHunk} /> : <p className="route-note">{t('preview.diff.same')}</p>}
            {diff.truncated ? <p className="route-note">{t('preview.diff.truncated')}</p> : null}
          </>
            : <p className="route-note" data-state={diff.state}>{t(DIFF_NOTES[diff.state] ?? 'preview.diff.unavailable')}</p>
      ) : notebook ? <NotebookView path={path} />
        : error ? <p className="route-error" role="alert">{t(error)}</p>
        : text === null ? <p className="route-note">{t('preview.loading')}</p>
          : text.binary ? <p className="route-note">{t('preview.binary')}</p>
            : <>
              {text.truncated ? <p className="route-note">{t('preview.truncated')}</p> : null}
              {markdown
                ? <div className="preview-markdown"><SafeMarkdown source={text.content} onOpenExternal={(url) => requestPreview({ kind: 'url', url })} /></div>
                : <ol className="preview-lines" aria-label={t('preview.content')}>{lines.map((line, index) => <li key={index}><code>{line || ' '}</code></li>)}</ol>}
            </>}
    </div>
  </>
}

/** A sheet over the window that shows a web page, a file of the open folder, or one file's change. */
export function PreviewSheet({ request, client, onClose }: {
  request: PreviewRequest
  client?: ReaderClient
  onClose: () => void
}) {
  const { t } = useOptionalI18n()
  const sheet = useRef<HTMLElement>(null)
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    sheet.current?.focus()
    return () => { if (opener?.isConnected) opener.focus() }
  }, [])
  const panel = request.kind === 'url' || (isPanelFile(request.path) && request.view !== 'changes')
  const name = request.kind === 'url' ? hostOf(request.url) : fileName(request.path)
  return <div className="command-overlay preview-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section ref={sheet} tabIndex={-1} className="preview-dialog" data-mode={panel ? 'panel' : 'reader'} role="dialog" aria-modal="true"
      aria-label={t('preview.title', { name })}
      onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose() } }}>
      {panel
        ? <PanelBody request={request} onClose={onClose} sheet={sheet} figures={client?.figurePoints && client.correctFigure ? client as FiguresClient : undefined} />
        : request.kind === 'file' ? <ReaderBody path={request.path} change={request.change} initialView={request.view} client={client} onClose={onClose} /> : null}
    </section>
  </div>
}

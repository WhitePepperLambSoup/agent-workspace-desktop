import { ArrowRight, FileMinus, FilePen, FilePlus, Files, FolderOpen, Undo2 } from 'lucide-react'
import { useContext, useMemo, useState } from 'react'

import { GatewayCommandError } from '../bridge/client'
import { useOptionalI18n } from '../i18n/I18nProvider'
import type { MessageKey } from '../i18n/messages'
import { isOfficePath } from '../office/model'
import { openFileChange, openWorkspaceFile, type FileChange } from '../preview/preview-request'
import { TimelineActionsContext } from './actions-context'
import type { FilesEntry, TurnFile } from './types'
import './turn-files.css'

const ICONS = { created: FilePlus, modified: FilePen, deleted: FileMinus, moved: ArrowRight } as const
const COLLAPSED_ROWS = 8
// Files without a text change to show: documents, pictures, sound, video and archives.
const NOT_TEXT = /\.(pdf|png|jpe?g|gif|webp|bmp|avif|ico|mp3|mp4|wav|ogg|m4a|webm|zip|7z|rar|exe|dll|doc|xls|ppt)$/i
const REASONS: Record<string, MessageKey> = {
  changed: 'turnFiles.reason.changed',
  not_kept: 'turnFiles.reason.notKept',
}

function size(bytes: number | undefined): string | null {
  if (bytes === undefined || bytes < 0) return null
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function undoable(file: TurnFile): boolean {
  return file.undoable === true && (file.change === 'created' || file.change === 'modified')
}

/** An agent's new or edited file, whose change the reader can show. */
function changed(file: TurnFile): boolean {
  return file.by === 'agent' && (file.change === 'created' || file.change === 'modified')
}

/** The files a turn created, changed, moved or deleted, under its answer. */
export function TurnFilesCard({ entry }: { entry: FilesEntry }) {
  const { t } = useOptionalI18n()
  const actions = useContext(TimelineActionsContext)
  // A file put back now (null) or left alone and why; the record's own undo marks come first.
  const [outcomes, setOutcomes] = useState<Record<string, string | null>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<MessageKey | null>(null)
  const [expanded, setExpanded] = useState(false)
  const change: FileChange | undefined = actions.sessionId ? { sessionId: actions.sessionId, eventId: entry.id } : undefined

  const agent = entry.files.filter((file) => file.by === 'agent')
  const others = entry.files.filter((file) => file.by === 'other')
  const undone = useMemo(() => new Set(entry.undone), [entry.undone])
  const isUndone = (path: string): boolean => undone.has(path) || outcomes[path] === null
  const pending = agent.filter((file) => undoable(file) && !isUndone(file.path))
  const counts = (['created', 'modified', 'moved', 'deleted'] as const)
    .map((kind) => [kind, entry.files.filter((file) => file.change === kind).length] as const)
    .filter(([, count]) => count > 0)

  const undo = async (paths: readonly string[] | null): Promise<void> => {
    if (!actions.undoTurnFiles || busy) return
    setBusy(paths?.[0] ?? '*')
    setError(null)
    try {
      const results = await actions.undoTurnFiles(entry.id, paths)
      setOutcomes((current) => ({ ...current, ...Object.fromEntries(results.map((item) => [item.path, item.reason])) }))
    } catch (reason) {
      setError(reason instanceof GatewayCommandError && reason.code === 'runtime_busy' ? 'turnFiles.busy' : 'turnFiles.undoFailed')
    } finally {
      setBusy(null)
      setConfirming(false)
    }
  }

  const row = (file: TurnFile) => {
    const Icon = ICONS[file.change]
    const gone = file.change === 'deleted' || (file.change === 'created' && isUndone(file.path))
    const target = file.change === 'moved' && file.to ? file.to : file.path
    const outcome = outcomes[file.path]
    const state = isUndone(file.path) ? 'undone' : typeof outcome === 'string' ? 'left' : undefined
    const meta = state === 'undone'
      ? t('turnFiles.undone')
      : state === 'left'
        ? t(REASONS[outcome as string] ?? 'turnFiles.reason.failed')
        : [t(`turnFiles.change.${file.change}` as MessageKey), changed(file) || file.by === 'other' ? size(file.bytes) : null].filter(Boolean).join(' · ')
    return (
      <li key={`${file.change}:${file.path}`} className="turn-file" data-change={file.change} data-by={file.by}>
        <Icon size={14} aria-hidden="true" />
        <span className="turn-file-name">
          {gone
            ? <span className="path" title={file.path}>{file.path}</span>
            : <button type="button" title={target} aria-label={t('turnFiles.open', { path: target })} onClick={() => openWorkspaceFile(target, file.by === 'agent' ? change : undefined)}>{file.path}</button>}
          {file.change === 'moved' && file.to ? <code title={file.to}>→ {file.to}</code> : null}
        </span>
        <span className="turn-file-meta" data-state={state}>{meta}</span>
        <span className="turn-file-actions">
          {change && changed(file) && !gone && !isOfficePath(file.path) && !NOT_TEXT.test(file.path) ? (
            <button type="button" aria-label={t('turnFiles.showChangeOf', { path: file.path })} onClick={() => openFileChange(file.path, change)}>{t('turnFiles.showChange')}</button>
          ) : null}
          {actions.undoTurnFiles && undoable(file) && !isUndone(file.path) ? (
            <button type="button" aria-label={t('turnFiles.undoOf', { path: file.path })} disabled={busy !== null} onClick={() => void undo([file.path])}>{t('turnFiles.undo')}</button>
          ) : null}
          {!gone && window.agentWorkspace?.revealPath ? (
            <button type="button" aria-label={t('turnFiles.reveal')} title={t('turnFiles.reveal')} onClick={() => void window.agentWorkspace.revealPath?.(target)}><FolderOpen size={13} /></button>
          ) : null}
        </span>
      </li>
    )
  }

  const shown = expanded ? agent : agent.slice(0, COLLAPSED_ROWS)
  return (
    <section className="turn-files" aria-label={t('turnFiles.label')} data-testid="turn-files">
      <header>
        <Files size={14} aria-hidden="true" />
        <strong>
          {t('turnFiles.title', { count: entry.files.length + entry.omitted })}
          {counts.length > 1 ? <span className="turn-file-meta"> · {counts.map(([kind, count]) => t(`turnFiles.count.${kind}` as MessageKey, { count })).join(' · ')}</span> : null}
        </strong>
        {actions.undoTurnFiles && pending.length > 1 && !confirming ? (
          <button type="button" className="secondary-button" disabled={busy !== null} onClick={() => setConfirming(true)}><Undo2 size={13} />{t('turnFiles.undoAll')}</button>
        ) : null}
      </header>
      {confirming ? (
        <div className="turn-files-confirm" role="alert">
          <span>{t('turnFiles.confirmAll', { count: pending.length })}</span>
          <button type="button" className="secondary-button" disabled={busy !== null} onClick={() => void undo(pending.map((file) => file.path))}>{t('turnFiles.confirm')}</button>
          <button type="button" className="secondary-button" onClick={() => setConfirming(false)}>{t('turnFiles.cancel')}</button>
        </div>
      ) : null}
      {error ? <p className="route-error" role="status">{t(error)}</p> : null}
      {agent.length > 0 ? <ul aria-label={t('turnFiles.agentFiles')}>{shown.map(row)}</ul> : null}
      {agent.length > shown.length ? (
        <button type="button" className="turn-files-more" onClick={() => setExpanded(true)}>{t('turnFiles.showAll', { count: agent.length })}</button>
      ) : null}
      {others.length > 0 ? (
        <details open={agent.length === 0 && others.length <= COLLAPSED_ROWS}>
          <summary>{t('turnFiles.others', { count: others.length })}</summary>
          <ul aria-label={t('turnFiles.otherFiles')}>{others.map(row)}</ul>
        </details>
      ) : null}
      {entry.omitted > 0 ? <p className="turn-files-note">{t('turnFiles.omitted', { count: entry.omitted })}</p> : null}
    </section>
  )
}

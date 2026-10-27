import { Archive, ArchiveRestore, Pin, PinOff } from 'lucide-react'
import { useEffect, useState } from 'react'

import type { WorkbenchBridgeClient } from '../bridge/client'
import { selectPresentedSessions, type WorkbenchState } from '../state/workbench-store'
import { useOptionalI18n } from '../i18n/I18nProvider'
import { localizeKnownStatus } from '../i18n/messages'
import type { MessageKey } from '../i18n/messages'

type SessionClient = Pick<WorkbenchBridgeClient, 'openSession' | 'setSessionPresentation'>

export function SessionList({ state, client, onError }: { state: WorkbenchState; client?: SessionClient; onError?: (message: MessageKey | null) => void }) {
  const { locale, t } = useOptionalI18n()
  const [query, setQuery] = useState('')
  const [viewArchived, setViewArchived] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set())
  const sessions = selectPresentedSessions(state, { query, onlyArchived: viewArchived })
  const visibleSelection = sessions.filter((session) => selected.has(session.id))

  useEffect(() => { setSelected(new Set()) }, [viewArchived])

  const update = async (sessionId: string, values: { pinned?: boolean; archived?: boolean }): Promise<void> => {
    if (!client || busy) return
    onError?.(null)
    setBusy(sessionId)
    try { await client.setSessionPresentation(sessionId, values) } catch { onError?.('workspace.presentationFailed') } finally { setBusy(null) }
  }
  const updateSelected = async (): Promise<void> => {
    if (!client || busy || visibleSelection.length === 0) return
    onError?.(null)
    setBusy('__bulk__')
    try {
      for (const session of visibleSelection) await client.setSessionPresentation(session.id, { archived: !viewArchived })
      setSelected(new Set())
    } catch {
      onError?.('workspace.presentationFailed')
    } finally {
      setBusy(null)
    }
  }
  const toggle = (sessionId: string, checked: boolean): void => {
    setSelected((current) => {
      const next = new Set(current)
      if (checked) next.add(sessionId)
      else next.delete(sessionId)
      return next
    })
  }
  const open = async (sessionId: string): Promise<void> => {
    if (!client) return
    onError?.(null)
    try { await client.openSession(sessionId) } catch { onError?.('workbench.sessionOpenFailed') }
  }
  const allSelected = sessions.length > 0 && visibleSelection.length === sessions.length
  return <>
    <div className="session-view-tabs" role="tablist">
      <button type="button" role="tab" aria-selected={!viewArchived} className={!viewArchived ? 'tab-btn is-active' : 'tab-btn'} onClick={() => setViewArchived(false)}>{t('workspace.tabActive')}</button>
      <button type="button" role="tab" aria-selected={viewArchived} className={viewArchived ? 'tab-btn is-active' : 'tab-btn'} onClick={() => setViewArchived(true)}>{t('workspace.tabArchived')}</button>
    </div>
    <label className="route-search"><input type="search" aria-label={t('workspace.filterSessions')} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('workspace.filterPlaceholder')} /></label>
    {client && sessions.length > 0 ? (
      <div className="session-bulk-bar">
        <label className="session-bulk-select">
          <input type="checkbox" checked={allSelected} aria-label={t('workspace.selectAllSessions')}
            ref={(node) => { if (node) node.indeterminate = visibleSelection.length > 0 && !allSelected }}
            onChange={(event) => setSelected(event.target.checked ? new Set(sessions.map((session) => session.id)) : new Set())} />
          <span>{visibleSelection.length > 0 ? t('workspace.selectedCount', { count: visibleSelection.length }) : t('workspace.selectAllSessions')}</span>
        </label>
        {visibleSelection.length > 0 ? (
          <button type="button" className="session-bulk-action" disabled={busy !== null} aria-busy={busy === '__bulk__'} onClick={() => void updateSelected()}>
            {viewArchived ? <ArchiveRestore size={14} aria-hidden="true" /> : <Archive size={14} aria-hidden="true" />}
            <span>{t(viewArchived ? 'workspace.restoreSelected' : 'workspace.archiveSelected', { count: visibleSelection.length })}</span>
          </button>
        ) : null}
      </div>
    ) : null}
    <div className="route-list" role="list">{sessions.map((session) => {
      const id = session.id
      const title = session.title
      const pinLabel = t(session.pinned ? 'workspace.unpin' : 'workspace.pin')
      return (
        <div className="route-list-row" role="listitem" key={id}>
          {client ? <input type="checkbox" className="session-select" checked={selected.has(id)}
            aria-label={t('workspace.selectSession', { title })} onChange={(event) => toggle(id, event.target.checked)} /> : null}
          <button type="button" className="session-open" aria-label={t('workspace.openSession', { title })} onClick={() => void open(id)}>
            <span className="session-title">
              <strong>{title}</strong>
              <small>{localizeKnownStatus(locale, session.mode)}</small>
            </span>
          </button>
          <div className="row-actions">
            {!session.archived ? (
              <button type="button" className="icon-button" aria-label={`${pinLabel} ${title}`} title={pinLabel} disabled={!client || busy === id} onClick={() => void update(id, { pinned: !session.pinned })}>
                {session.pinned ? <PinOff size={14} /> : <Pin size={14} />}
              </button>
            ) : null}
            {session.archived ? (
              <button type="button" className="icon-button" aria-label={`${t('workspace.unarchive')} ${title}`} title={t('workspace.unarchive')} disabled={!client || busy === id} onClick={() => void update(id, { archived: false })}>
                <ArchiveRestore size={14} />
              </button>
            ) : (
              <button type="button" className="icon-button" aria-label={`${t('workspace.archive')} ${title}`} title={t('workspace.archive')} disabled={!client || busy === id} onClick={() => void update(id, { archived: true })}>
                <Archive size={14} />
              </button>
            )}
          </div>
        </div>
      )
    })}</div>
    {sessions.length === 0 ? <p className="route-note">{t('workspace.noSessions')}</p> : null}
  </>
}

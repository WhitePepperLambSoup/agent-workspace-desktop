import { ChevronDown, Database, Folder, FolderPlus, MessageSquare, Pin, Plus, RefreshCw, Search, Upload, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { WorkbenchBridgeClient } from '../bridge/client'
import { useOptionalI18n, useText } from '../i18n/I18nProvider'
import { localizeKnownStatus, translate, type MessageKey } from '../i18n/messages'
import { selectWorkspaceGroups, workspacePathKey, type PresentedSession, type WorkbenchState } from '../state/workbench-store'
import { droppedFolderPath, hasDroppedFiles, splitDroppedItems } from './folder-drop'
import { SessionActionsMenu } from './SessionActionsMenu'
import { useSendToPhone } from '../devices/SendToPhone'

interface SessionSidebarProps {
  open: boolean
  onClose: () => void
  state: WorkbenchState
  client?: WorkbenchBridgeClient
  drawer?: boolean
  drawerRef?: (element: HTMLElement | null) => void
}

const BUSY_ERRORS: Readonly<Record<string, MessageKey>> = { runtime_busy: 'workspace.switchWhileRunning' }
const CREATE_ERRORS: Readonly<Record<string, MessageKey>> = {
  ...BUSY_ERRORS,
  runtime_start_failed: 'workbench.sessionCreateStartFailed',
  runtime_unconfigured: 'composer.error.unconfigured',
  storage_unavailable: 'workbench.sessionCreateStorageFailed',
  workspace_switch_failed: 'workspace.openFailed',
}

function errorKey(reason: unknown, fallback: MessageKey, known = BUSY_ERRORS): MessageKey {
  const code = reason && typeof reason === 'object' && 'code' in reason && typeof reason.code === 'string' ? reason.code : ''
  return Object.hasOwn(known, code) ? known[code]! : fallback
}

export function SessionSidebar({ open, onClose, state, client, drawer, drawerRef }: SessionSidebarProps) {
  const tx = useText()
  const { locale, t } = useOptionalI18n()
  const [query, setQuery] = useState('')
  const [error, setError] = useState<MessageKey | null>(null)
  const [creating, setCreating] = useState(false)
  const [addingFolder, setAddingFolder] = useState(false)
  const [loadingPage, setLoadingPage] = useState<string | null>(null)
  const [openingSession, setOpeningSession] = useState<string | null>(null)
  const [collapsedProjects, setCollapsedProjects] = useState<Record<string, boolean>>({})
  const [sidebarView, setSidebarView] = useState<'sessions' | 'projects'>('projects')
  const navigationGeneration = useRef(0)
  const refreshGeneration = useRef(0)
  const currentPath = typeof state.workspace?.path === 'string' ? state.workspace.path : ''
  const projectGroups = useMemo(() => selectWorkspaceGroups(state, { query }), [state, query])
  const sessions = useMemo(() => projectGroups.flatMap(group => group.sessions), [projectGroups])

  const refreshDirectory = useCallback(async (): Promise<void> => {
    if (!client?.listWorkspaceSessions) return
    const generation = ++refreshGeneration.current
    try {
      await client.listWorkspaceSessions()
    } catch {
      if (generation === refreshGeneration.current) setError('workspace.directoryLoadFailed')
    }
  }, [client])

  useEffect(() => {
    if (!open || !state.runtime.epoch || state.runtime.stale) return
    void refreshDirectory()
  }, [open, state.runtime.epoch, state.runtime.stale, state.bootstrapVersion, state.selectedSession?.id, currentPath, refreshDirectory])

  const createSession = async (path = currentPath): Promise<void> => {
    if (!client || creating) return
    setCreating(true)
    setError(null)
    try {
      if (path && workspacePathKey(path) !== workspacePathKey(currentPath)) {
        await client.openWorkspacePath(path)
      }
      await client.createSession()
    } catch (reason) {
      setError(errorKey(reason, 'workbench.sessionCreateFailed', CREATE_ERRORS))
    } finally {
      setCreating(false)
    }
  }

  const openSession = async (session: PresentedSession): Promise<void> => {
    if (!client) return
    const generation = ++navigationGeneration.current
    setOpeningSession(session.id)
    setError(null)
    try {
      if (client.openWorkspaceSession && session.workspace) {
        await client.openWorkspaceSession(session.workspace, session.id)
      } else {
        if (session.workspace && workspacePathKey(session.workspace) !== workspacePathKey(currentPath)) {
          await client.openWorkspacePath(session.workspace)
        }
        await client.openSession(session.id)
      }
    } catch (reason) {
      if (generation === navigationGeneration.current) setError(errorKey(reason, 'workbench.sessionOpenFailed'))
    } finally {
      if (generation === navigationGeneration.current) setOpeningSession(null)
    }
  }

  const loadMore = async (path?: string, offset?: number): Promise<void> => {
    if (!client?.listWorkspaceSessions || loadingPage) return
    setLoadingPage(path ?? '__folders__')
    setError(null)
    try {
      await client.listWorkspaceSessions(path ? { path, offset } : { workspaceOffset: offset })
    } catch {
      setError('workspace.directoryLoadFailed')
    } finally {
      setLoadingPage(null)
    }
  }

  const addFolder = async (): Promise<void> => {
    if (!client?.openWorkspace || addingFolder) return
    setAddingFolder(true)
    setError(null)
    try {
      const selected = await client.openWorkspace()
      if (selected) await refreshDirectory()
    } catch (reason) {
      setError(errorKey(reason, 'workspace.openFailed'))
    } finally {
      setAddingFolder(false)
    }
  }

  const [dropActive, setDropActive] = useState(false)
  const dropFolders = async (folders: readonly File[]): Promise<void> => {
    if (!client?.openWorkspacePath) return
    const paths = folders.map(droppedFolderPath).filter((path): path is string => path !== null)
    if (paths.length === 0) {
      setError('workspace.dropFolderUnavailable')
      return
    }
    setAddingFolder(true)
    setError(null)
    try {
      for (const path of paths) await client.openWorkspacePath(path)
      await refreshDirectory()
    } catch (reason) {
      setError(errorKey(reason, 'workspace.openFailed'))
    } finally {
      setAddingFolder(false)
    }
  }

  const phoneSend = useSendToPhone(client)
  const [menuSession, setMenuSession] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<{ id: string; draft: string } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const closeMenu = useCallback((open: boolean) => { if (!open) setMenuSession(null) }, [])

  /** Presentation and export commands act on the open folder; switch to the session's folder first. */
  const inSessionWorkspace = async (session: PresentedSession, action: () => Promise<unknown>): Promise<void> => {
    if (!client) return
    setError(null)
    setNotice(null)
    if (session.workspace && workspacePathKey(session.workspace) !== workspacePathKey(currentPath)) {
      await client.openWorkspacePath(session.workspace)
    }
    await action()
  }

  const applyPresentation = (session: PresentedSession, update: { alias?: string | null; pinned?: boolean; archived?: boolean }): void => {
    if (!client) return
    void inSessionWorkspace(session, () => client.setSessionPresentation(session.id, update))
      .catch((reason) => setError(errorKey(reason, 'workspace.presentationFailed')))
  }

  const commitRename = (session: PresentedSession): void => {
    const current = renaming
    setRenaming(null)
    if (!current || current.id !== session.id) return
    const alias = current.draft.trim()
    if (alias === session.title) return
    applyPresentation(session, { alias: alias ? alias.slice(0, 200) : null })
  }

  const exportSession = (session: PresentedSession): void => {
    const select = window.agentWorkspace?.selectSessionExportPath
    if (!client || !select) return
    void (async () => {
      const path = await select(session.title || 'session')
      if (!path) return
      await inSessionWorkspace(session, () => client.exportSession(session.id, path))
      setNotice(t('workspace.sessionExported', { name: path.split(/[\\/]/).at(-1) ?? path }))
    })().catch((reason: unknown) => {
      const code = reason && typeof reason === 'object' && 'code' in reason ? reason.code : null
      setError(code === 'session_export_blocked' ? 'workspace.exportBlocked' : errorKey(reason, 'workspace.exportFailed'))
    })
  }

  const importSession = (): void => {
    const select = window.agentWorkspace?.selectSessionArchive
    if (!client || !select || !currentPath) return
    setError(null)
    setNotice(null)
    void (async () => {
      const path = await select()
      if (!path) return
      const response = await client.importSession(path)
      await refreshDirectory()
      const imported = (response.payload as { session?: { id?: unknown } }).session?.id
      if (typeof imported === 'string') await client.openSession(imported)
      setNotice(t('workspace.sessionImported'))
    })().catch((reason: unknown) => {
      const code = reason && typeof reason === 'object' && 'code' in reason ? reason.code : null
      setError(code === 'invalid_session_archive' ? 'workspace.importInvalid' : errorKey(reason, 'workspace.importFailed'))
    })
  }

  const renderSession = (session: PresentedSession) => {
    const selected = session.id === state.selectedSession?.id &&
      (!session.workspace || workspacePathKey(session.workspace) === workspacePathKey(currentPath))
    const runtime = state.runtime.activeSessions?.[session.id]
    const sameWorkspace = !runtime?.workspace || !session.workspace || workspacePathKey(runtime.workspace) === workspacePathKey(session.workspace)
    const running = sameWorkspace && Boolean(runtime?.activeTurn || runtime?.turnRequested || (runtime?.queuedTurnCount ?? 0) > 0 ||
      (state.runtime.activeTurn && session.id === state.runtime.hostSessionId))
    const title = session.title || tx('New session')
    if (renaming?.id === session.id) {
      return <form className="session-row-item session-rename" key={session.id}
        onSubmit={(event) => { event.preventDefault(); commitRename(session) }}>
        <input aria-label={t('workspace.renameSession')} value={renaming.draft} maxLength={200} autoFocus
          placeholder={title}
          onChange={(event) => setRenaming({ id: session.id, draft: event.target.value })}
          onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); setRenaming(null) } }}
          onBlur={() => commitRename(session)} />
      </form>
    }
    return <div className="session-row-item" key={session.id} data-menu-open={menuSession === session.id ? 'true' : undefined}
      onContextMenu={client ? (event) => { event.preventDefault(); setMenuSession(session.id) } : undefined}>
      <button type="button"
        className={selected ? 'session-row is-active' : 'session-row'} title={title}
        aria-current={selected ? 'page' : undefined} aria-busy={openingSession === session.id}
        disabled={!client} onClick={() => void openSession(session)}>
        <span className="session-row-title"><span className="session-row-dot" data-mode={session.mode} data-running={running ? 'true' : 'false'} />
          <span className="session-row-label">{title}</span>
          {session.pinned ? <Pin size={12} aria-label={t('workspace.pin')} /> : null}
        </span>
        <small><span>{running ? tx('Running') : selected ? tx('Current') : localizeKnownStatus(locale, session.mode)}</span>
          <span className="session-row-autonomy">{session.autonomy === 'yolo' ? 'YOLO' : session.autonomy === 'full_access' ? tx('Full access') : ''}</span>
        </small>
      </button>
      {client ? <SessionActionsMenu title={title} pinned={session.pinned}
        open={menuSession === session.id}
        onOpenChange={(open) => open ? setMenuSession(session.id) : closeMenu(false)}
        actions={{
          onRename: () => setRenaming({ id: session.id, draft: title }),
          onTogglePin: () => applyPresentation(session, { pinned: !session.pinned }),
          onArchive: running ? undefined : () => applyPresentation(session, { archived: true }),
          onExport: window.agentWorkspace?.selectSessionExportPath ? () => exportSession(session) : undefined,
          onContinueOnPhone: phoneSend.available
            ? () => void inSessionWorkspace(session, async () => phoneSend.send({ kind: 'conversation', sessionId: session.id }))
              .catch((reason) => setError(errorKey(reason, 'workspace.openFailed')))
            : undefined,
        }} /> : null}
    </div>
  }

  return <nav id="session-sidebar" ref={drawerRef} className="session-sidebar glass-surface" data-directory="true"
    aria-label={tx('Sessions')} data-open={open ? 'true' : 'false'}
    role={drawer ? 'dialog' : 'navigation'} aria-modal={drawer && open ? 'true' : undefined} tabIndex={drawer ? -1 : undefined}
    data-drop-active={dropActive ? 'true' : undefined}
    onDragOver={(event) => {
      if (!client?.openWorkspacePath || !hasDroppedFiles(event.dataTransfer)) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'link'
      setDropActive(true)
    }}
    onDragLeave={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropActive(false)
    }}
    onDrop={(event) => {
      setDropActive(false)
      if (!client?.openWorkspacePath || !hasDroppedFiles(event.dataTransfer)) return
      event.preventDefault()
      const { folders } = splitDroppedItems(event.dataTransfer)
      if (folders.length > 0) void dropFolders(folders)
      else setError('workspace.dropFolderOnly')
    }}>
    <header className="panel-header sidebar-header" data-testid="workspace-sidebar-header">
      <div className="sidebar-tab-bar" role="tablist" aria-label={tx('Sessions')}>
        <button type="button" role="tab" aria-selected={sidebarView === 'projects'}
          className={sidebarView === 'projects' ? 'sidebar-tab is-active' : 'sidebar-tab'} onClick={() => setSidebarView('projects')}>{tx('Projects')}</button>
        <button type="button" role="tab" aria-selected={sidebarView === 'sessions'}
          className={sidebarView === 'sessions' ? 'sidebar-tab is-active' : 'sidebar-tab'} onClick={() => setSidebarView('sessions')}>{tx('Sessions')}</button>
      </div>
      <div className="panel-actions">
        <button type="button" className="icon-button drawer-close" data-drawer-initial-focus aria-label={tx('Close sessions')} title={tx('Close sessions')} onClick={onClose}><X size={16} /></button>
        <button type="button" className="new-session-button" aria-label={tx('New session')} title={tx('New session')} aria-busy={creating}
          disabled={!client || creating} onClick={() => void createSession()}><Plus size={16} /><span>{tx('New session')}</span></button>
      </div>
    </header>
    <label className="sidebar-search"><Search size={14} />
      <input type="search" aria-label={tx('Search sessions')}
        placeholder={sidebarView === 'projects' ? t('workspace.searchProjects') : tx('Search sessions')}
        value={query} onChange={event => setQuery(event.target.value)} />
    </label>
    <div className="project-tree" data-testid="project-tree">
      {sidebarView === 'sessions' ? <div className="session-list">{sessions.map(renderSession)}</div> : projectGroups.map(group => {
        const collapsed = !query.trim() && collapsedProjects[workspacePathKey(group.path)] === true
        return <section className="project-group" key={group.path} data-workspace-path={group.path} data-current={group.current ? 'true' : 'false'} data-collapsed={collapsed ? 'true' : 'false'}>
          <button type="button" className="project-folder" aria-label={group.name} aria-expanded={!collapsed} title={group.path || group.name}
            onClick={() => setCollapsedProjects(current => ({ ...current, [workspacePathKey(group.path)]: !current[workspacePathKey(group.path)] }))}>
            <ChevronDown size={13} className="project-folder-chevron" aria-hidden="true" /><Folder size={15} aria-hidden="true" />
            <span>{group.name}</span><small>{group.sessions.length}{group.hasMore ? '+' : ''}</small>
          </button>
          {!collapsed ? <div className="project-session-list">
            {group.sessions.map(renderSession)}
            {!group.sessions.length ? <button type="button" className="project-empty-action"
              aria-label={t('workspace.newSessionInFolder', { name: group.name })} disabled={!client || creating}
              onClick={() => void createSession(group.path)}><Plus size={12} /><span>{tx('New session')}</span></button> : null}
            {group.hasMore && group.nextOffset !== null ? <button type="button" className="project-more"
              aria-label={t('workspace.moreConversationsInFolder', { name: group.name })} disabled={!client?.listWorkspaceSessions || loadingPage !== null}
              onClick={() => void loadMore(group.path, group.nextOffset!)}>{t('workspace.showMore')}</button> : null}
          </div> : null}
        </section>
      })}
      {query.trim() && (projectGroups.length === 0 || (sidebarView === 'sessions' && !sessions.length))
        ? <p className="sidebar-empty">{tx('No matching sessions')}</p> : null}
      {!query.trim() && sidebarView === 'projects' && projectGroups.length === 0 ? <div className="sidebar-empty">
        <FolderPlus size={22} aria-hidden="true" />
        <strong>{t('workspace.emptyProjects')}</strong>
        <span>{t('workspace.emptyProjectsHint')}</span>
        <button type="button" className="sidebar-empty-action" disabled={!client?.openWorkspace || addingFolder}
          onClick={() => void addFolder()}><FolderPlus size={14} /><span>{t('workspace.addFolder')}</span></button>
      </div> : null}
      {!query.trim() && sidebarView === 'sessions' && !sessions.length ? <div className="sidebar-empty">
        <MessageSquare size={22} aria-hidden="true" />
        <strong>{tx('No sessions')}</strong>
        <span>{t('workspace.emptySessionsHint')}</span>
        <button type="button" className="sidebar-empty-action" disabled={!client || creating || !currentPath}
          onClick={() => void createSession()}><Plus size={14} /><span>{tx('New session')}</span></button>
      </div> : null}
      {state.workspaceDirectory?.nextWorkspaceOffset != null ? <button type="button" className="project-more project-more-folders"
        disabled={!client?.listWorkspaceSessions || loadingPage !== null} onClick={() => void loadMore(undefined, state.workspaceDirectory!.nextWorkspaceOffset!)}>{t('workspace.moreFolders')}</button> : null}
      {error ? <p role="status" className="route-error">{translate(locale, error)}</p> : null}
      {notice && !error ? <p role="status" className="sidebar-notice">{notice}</p> : null}
      {phoneSend.ui}
    </div>
    <footer className="sidebar-footer">
      <button type="button" className="sidebar-add-folder" aria-label={t('workspace.addFolder')} disabled={!client?.openWorkspace || addingFolder}
        aria-busy={addingFolder} onClick={() => void addFolder()}><FolderPlus size={14} /><span>{t('workspace.addFolder')}</span></button>
      <span className="visually-hidden"><Database size={13} />{tx('Local workspace')}</span>
      {window.agentWorkspace?.selectSessionArchive ? <button type="button" className="icon-button" aria-label={t('workspace.importSession')}
        title={t('workspace.importSession')} disabled={!client || !currentPath} onClick={importSession}><Upload size={14} /></button> : null}
      <button type="button" className="icon-button" aria-label={t('workspace.refreshFolders')} title={t('workspace.refreshFolders')}
        disabled={!client?.listWorkspaceSessions || state.workspaceDirectory?.state === 'loading'}
        onClick={() => { setError(null); void refreshDirectory() }}><RefreshCw size={14} /></button>
    </footer>
  </nav>
}

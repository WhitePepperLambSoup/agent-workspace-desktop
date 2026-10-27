import { Brain, FileCode, FolderInput, FolderOpen, List, Plus, Wrench } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'

import type { WorkbenchBridgeClient } from '../bridge/client'
import { CodeEditor } from '../editor/CodeEditor'
import { FileTree, type WorkspaceFileItem } from '../editor/FileTree'
import { FileBatchList } from '../files/FileBatchList'
import { useOptionalI18n } from '../i18n/I18nProvider'
import { localizeKnownStatus, translate, type MessageKey } from '../i18n/messages'
import { isOfficePath } from '../office/model'
import { requestDocumentPreview } from '../office/preview-request'
import type { WorkbenchState } from '../state/workbench-store'
import { AgentSetup } from './AgentSetup'
import { MemoryManager } from './MemoryManager'
import { SessionList } from './SessionList'
import { editorStoreFor } from './workspace-editor-state'
import { useSendToPhone } from '../devices/SendToPhone'

type WorkspaceClient = Pick<
  WorkbenchBridgeClient,
  | 'openWorkspace'
  | 'createSession'
  | 'openSession'
  | 'setSessionPresentation'
  | 'getWorkspaceSummary'
> &
  Partial<
    Pick<
      WorkbenchBridgeClient,
      'getWorkspaceFilesTree' | 'readWorkspaceFile' | 'writeWorkspaceFile' | 'listMemories' | 'updateMemory' | 'deleteMemory' | 'inspectAgentSetup' | 'listFileBatches' | 'undoFileBatch'
      | 'deviceLinkStatus' | 'sendToPhone'
    >
  >

export function WorkspaceRoute({
  state,
  client,
}: {
  state: WorkbenchState
  client?: WorkspaceClient
}) {
  const { locale, t } = useOptionalI18n()
  const phoneSend = useSendToPhone(client)
  const [opening, setOpening] = useState(false)
  const [creating, setCreating] = useState(false)
  const [title, setTitle] = useState('')
  const [mode, setMode] = useState<'coding' | 'research' | 'task'>('coding')
  const [error, setError] = useState<MessageKey | null>(null)

  // Sub-view: files (explorer + editor) vs sessions
  const [activeTab, setActiveTab] = useState<'files' | 'sessions' | 'memory' | 'setup' | 'batches'>('sessions')

  const workspacePath = typeof state.workspace?.path === 'string' ? state.workspace.path : null
  const editorStore = editorStoreFor(client)
  const editorState = useSyncExternalStore(
    editorStore.subscribe,
    () => editorStore.get(workspacePath),
  )
  const { files, loadingFiles, tabs: editorTabs, activeTabPath } = editorState
  const currentWorkspacePath = useRef(workspacePath)
  const readGeneration = useRef(0)
  if (currentWorkspacePath.current !== workspacePath) {
    currentWorkspacePath.current = workspacePath
    readGeneration.current++
  }

  useEffect(() => () => { readGeneration.current++ }, [])

  useEffect(() => {
    let current = true
    void client?.getWorkspaceSummary().catch(() => {
      if (current) setError('workspace.summaryFailed')
    })
    return () => {
      current = false
    }
  }, [client])

  const loadFiles = useCallback(async (): Promise<void> => {
    if (!client?.getWorkspaceFilesTree || !workspacePath) return
    const requestId = editorStore.beginFilesLoad(workspacePath)
    try {
      const res = await client.getWorkspaceFilesTree('', 8, 2000)
      const list = (res.payload as { files?: WorkspaceFileItem[] }).files
      editorStore.finishFilesLoad(workspacePath, requestId, Array.isArray(list) ? list : undefined)
    } catch {
      // workspace might not be ready or git ignored
      editorStore.finishFilesLoad(workspacePath, requestId)
    }
  }, [client, editorStore, workspacePath])

  useEffect(() => {
    void loadFiles()
  }, [loadFiles])

  const handleSelectFile = async (filePath: string): Promise<void> => {
    // Word, Excel and PowerPoint files open as a preview, not as text in the editor.
    if (isOfficePath(filePath)) {
      requestDocumentPreview({ path: filePath })
      return
    }
    const existing = editorTabs.find((tab) => tab.path === filePath)
    if (existing) {
      editorStore.update(workspacePath, (current) => ({ ...current, activeTabPath: filePath }))
      setActiveTab('files')
      return
    }

    if (!client?.readWorkspaceFile || !workspacePath) return
    const generation = readGeneration.current
    try {
      const res = await client.readWorkspaceFile(filePath)
      if (generation !== readGeneration.current || currentWorkspacePath.current !== workspacePath) return
      const data = res.payload as {
        content?: string
        sha256?: string
        lineCount?: number
        truncated?: boolean
        isBinary?: boolean
        editable?: boolean
      }
      const content = data.content ?? ''
      const sha256 = data.sha256 ?? ''
      const lineCount = data.lineCount ?? content.split('\n').length

      const newTab = {
        path: filePath,
        content,
        sha256,
        dirty: false,
        originalContent: content,
        lineCount,
        truncated: data.truncated,
        isBinary: data.isBinary,
        editable: data.editable ?? (!data.truncated && !data.isBinary),
        instanceId: editorStore.allocateTabId(),
      }
      editorStore.update(workspacePath, (current) => current.tabs.some((tab) => tab.path === filePath)
        ? { ...current, activeTabPath: filePath }
        : { ...current, tabs: [...current.tabs, newTab], activeTabPath: filePath })
      setActiveTab('files')
    } catch {
      if (generation === readGeneration.current && currentWorkspacePath.current === workspacePath) {
        setError('changes.inspectFailed')
      }
    }
  }

  const handleCloseTab = (filePath: string): void => {
    const tab = editorTabs.find((t) => t.path === filePath)
    if (tab?.saving) return
    if (tab?.dirty) {
      const confirmDiscard = window.confirm(t('workspace.unsavedChangesConfirm'))
      if (!confirmDiscard) return
    }
    editorStore.update(workspacePath, (current) => {
      const next = current.tabs.filter((item) => item.path !== filePath)
      return {
        ...current,
        tabs: next,
        activeTabPath: current.activeTabPath === filePath
          ? next[next.length - 1]?.path ?? null : current.activeTabPath,
      }
    }, true)
  }

  const handleChangeContent = (filePath: string, newContent: string): void => {
    editorStore.update(workspacePath, (current) => ({
      ...current,
      tabs: current.tabs.map((tab) => tab.path === filePath
        ? { ...tab, content: newContent, dirty: newContent !== tab.originalContent }
        : tab),
    }), true)
  }

  const handleSaveFile = async (filePath: string): Promise<void> => {
    if (!client?.writeWorkspaceFile || !workspacePath) return
    const tab = editorStore.beginWrite(workspacePath, filePath)
    if (!tab) return
    try {
      const res = await client.writeWorkspaceFile(filePath, tab.content, tab.sha256)
      const data = res.payload as { sha256?: string }
      editorStore.finishWrite(workspacePath, filePath, tab, data.sha256 ?? tab.sha256)
    } catch {
      editorStore.finishWrite(workspacePath, filePath, tab)
    }
  }

  const handleOpenPdf = async (filePath: string): Promise<void> => {
    setError(null)
    try {
      if (!await window.agentWorkspace.openPath(filePath)) {
        setError('workspace.openPdfFailed')
      }
    } catch {
      setError('workspace.openPdfFailed')
    }
  }

  const open = async (): Promise<void> => {
    if (!client || opening) return
    setOpening(true)
    setError(null)
    try {
      await client.openWorkspace()
      void loadFiles()
    } catch {
      setError('workspace.openFailed')
    } finally {
      setOpening(false)
    }
  }

  const create = async (): Promise<void> => {
    const trimmed = title.trim()
    if (!client || creating || !trimmed) return
    setCreating(true)
    setError(null)
    try {
      await client.createSession({ title: trimmed, mode })
      setTitle('')
    } catch {
      setError('workbench.sessionCreateFailed')
    } finally {
      setCreating(false)
    }
  }

  const hasFilesSupport = Boolean(client?.getWorkspaceFilesTree)

  return (
    <main className="route-column reading-surface workspace-route" aria-label={t('workbench.workspace')}>
      <header className="route-header">
        <div>
          <p className="section-kicker">{t('workbench.workspace')}</p>
          <h1 tabIndex={-1}>{t('workbench.workspace')}</h1>
        </div>
        <div className="workspace-sub-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'files'}
            className={`sub-tab-btn ${activeTab === 'files' ? 'active' : ''}`}
            onClick={() => setActiveTab('files')}
          >
            <FileCode size={13} />
            <span>{t('workspace.filesTab')}</span>
            {files.length > 0 ? <span className="tab-badge">{files.length}</span> : null}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'sessions'}
            className={`sub-tab-btn ${activeTab === 'sessions' ? 'active' : ''}`}
            onClick={() => setActiveTab('sessions')}
          >
            <List size={13} />
            <span>{t('workbench.sessions')}</span>
            <span className="tab-badge">{state.sessions.length}</span>
          </button>
          {client?.listMemories ? (
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'memory'}
              className={`sub-tab-btn ${activeTab === 'memory' ? 'active' : ''}`}
              onClick={() => setActiveTab('memory')}
            >
              <Brain size={13} />
              <span>{t('memory.tab')}</span>
            </button>
          ) : null}
          {client?.listFileBatches ? (
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'batches'}
              className={`sub-tab-btn ${activeTab === 'batches' ? 'active' : ''}`}
              onClick={() => setActiveTab('batches')}
            >
              <FolderInput size={13} />
              <span>{t('files.batch.tab')}</span>
            </button>
          ) : null}
          {client?.inspectAgentSetup ? (
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'setup'}
              className={`sub-tab-btn ${activeTab === 'setup' ? 'active' : ''}`}
              onClick={() => setActiveTab('setup')}
            >
              <Wrench size={13} />
              <span>{t('agentSetup.tab')}</span>
            </button>
          ) : null}
        </div>
      </header>

      <div className="route-content workspace-route-content" data-view={activeTab}>
        <section className="fact-band">
          <div className="fact-band-icon">
            <FolderOpen size={16} />
          </div>
          <div>
            <strong>{String(state.workspace?.name ?? t('workspace.noSelected'))}</strong>
            <span>{String(state.workspace?.path ?? t('workspace.choose'))}</span>
          </div>
          <button
            type="button"
            className="quiet-action"
            aria-busy={opening}
            disabled={!client || opening}
            onClick={() => void open()}
          >
            <FolderOpen size={14} />
            {t('workspace.open')}
          </button>
        </section>

        {error ? (
          <p role="status" className="route-error">
            {translate(locale, error)}
          </p>
        ) : null}

        {editorState.saveFailed ? (
          <p role="status" className="route-error">{t('workspace.saveFailed')}</p>
        ) : null}
        {editorState.draftBackupFailed && editorTabs.some((tab) => tab.dirty) ? (
          <p role="alert" className="route-error">{t('workspace.draftBackupFailed')}</p>
        ) : null}

        {/* Files Explorer & Code Editor Section */}
        {hasFilesSupport && activeTab === 'files' ? (
          <div className="workspace-editor-layout">
            <FileTree
              files={files}
              selectedPath={activeTabPath ?? undefined}
              loading={loadingFiles}
              onSelectFile={(path) => void handleSelectFile(path)}
              onRefresh={() => void loadFiles()}
            />
            <div className="workspace-editor-main">
              <CodeEditor
                tabs={editorTabs}
                activeTabPath={activeTabPath}
                onSelectTab={(path) => editorStore.update(workspacePath, (current) => ({ ...current, activeTabPath: path }))}
                onCloseTab={handleCloseTab}
                onChangeContent={handleChangeContent}
                onSave={handleSaveFile}
                onOpenPdf={(path) => void handleOpenPdf(path)}
                onSendToPhone={phoneSend.available ? (path) => phoneSend.send({ kind: 'file', path }) : undefined}
              />
            </div>
            {phoneSend.ui}
          </div>
        ) : null}

        {activeTab === 'memory' ? <MemoryManager client={client} workspaceKey={workspacePath} /> : null}
        {activeTab === 'setup' ? <AgentSetup client={client} workspaceKey={workspacePath} /> : null}
        {activeTab === 'batches' ? <FileBatchList client={client} workspaceKey={workspacePath} /> : null}

        {/* Sessions Section - shown when activeTab === 'sessions' or when files support is absent */}
        {(activeTab === 'sessions' || (!hasFilesSupport && activeTab !== 'memory' && activeTab !== 'setup' && activeTab !== 'batches')) ? (
          <section className="route-section">
            <header>
              <div>
                <h2>{t('workbench.sessions')}</h2>
                <span>{t('workspace.sessionsReported', { count: state.sessions.length })}</span>
              </div>
            </header>
            <div className="session-create">
              <input
                type="text"
                aria-label={t('workspace.newSessionTitle')}
                maxLength={200}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder={t('workspace.sessionTitle')}
              />
              <select
                aria-label={t('workspace.newSessionMode')}
                value={mode}
                onChange={(event) => setMode(event.target.value as typeof mode)}
              >
                <option value="coding">{localizeKnownStatus(locale, 'coding')}</option>
                <option value="research">{localizeKnownStatus(locale, 'research')}</option>
                <option value="task">{localizeKnownStatus(locale, 'task')}</option>
              </select>
              <button
                type="button"
                aria-label={t('workspace.createSession')}
                aria-busy={creating}
                disabled={!client || creating || !title.trim()}
                onClick={() => void create()}
              >
                <Plus size={14} />
                {t('workspace.create')}
              </button>
            </div>
            <SessionList state={state} client={client} onError={setError} />
          </section>
        ) : null}
      </div>
    </main>
  )
}

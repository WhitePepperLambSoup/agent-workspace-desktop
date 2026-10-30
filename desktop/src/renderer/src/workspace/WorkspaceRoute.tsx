import { BookMarked, Brain, ClipboardList, Compass, FileCode, FilePlus2, FolderInput, FolderOpen, List, Plus, Wrench } from 'lucide-react'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'

import type { WorkbenchBridgeClient } from '../bridge/client'
import { breakpointStore, useBreakpoints } from '../editor/breakpoints'
import { codeAiOf, codeIntelOf, useCodeCompletion } from '../editor/code-assist'
import { CodeEditor } from '../editor/CodeEditor'
import type { CodeLocation } from '../editor/CodeView'
import { FileTree, type WorkspaceFileItem } from '../editor/FileTree'
import { FileBatchList } from '../files/FileBatchList'
import { useOptionalI18n } from '../i18n/I18nProvider'
import { localizeKnownStatus, translate, type MessageKey } from '../i18n/messages'
import '../latex/latex-new.css'
import { isOfficePath } from '../office/model'
import { requestDocumentPreview } from '../office/preview-request'
import { TemplatePicker, type TemplateClient } from '../office/TemplatePicker'
import { isPanelFile } from '../../../shared/preview'
import { OPEN_IN_EDITOR_EVENT, requestPreview, takeEditorRequest } from '../preview/preview-request'
import type { WorkbenchState } from '../state/workbench-store'
import { AgentSetup } from './AgentSetup'
import { type DebugClient, DebugPanel } from './DebugPanel'
import { RepoTour, type TourClient } from './RepoTour'
import { MemoryManager } from './MemoryManager'
import { SessionList } from './SessionList'
import { type SpecClient, SpecsPanel } from './SpecsPanel'
import { editorStoreFor } from './workspace-editor-state'
import { useSendToPhone } from '../devices/SendToPhone'
import { isLatexPath } from '../latex/latex-language'
import type { LatexClient } from '../latex/LatexWorkbench'
import { ReferenceLibrary, type LibraryClient } from '../references/ReferenceLibrary'
import { TerminalDock, TerminalDockClosed } from '../terminal/TerminalDock'
import type { ShellClient } from '../terminal/TerminalView'

// The LaTeX editor (CodeMirror, pdf.js) loads when a LaTeX file is first opened.
const LatexWorkbench = lazy(() => import('../latex/LatexWorkbench'))
const LATEX_TEMPLATES = ['paper-zh', 'paper-en', 'article-zh', 'report-zh', 'slides-zh', 'blank'] as const

const LATEX_EXPANDED_KEY = 'agent-workspace.latex-expanded.v1'

function readLatexExpanded(): boolean {
  try {
    return window.localStorage.getItem(LATEX_EXPANDED_KEY) !== 'false'
  } catch {
    return true
  }
}

function saveLatexExpanded(expanded: boolean): void {
  try {
    window.localStorage.setItem(LATEX_EXPANDED_KEY, String(expanded))
  } catch {
    // Only a preference.
  }
}

function latexClientOf(client: Partial<LatexClient> | undefined): LatexClient | null {
  const methods = ['latexStatus', 'setLatexSettings', 'compileLatex', 'cancelLatex', 'checkLatex', 'fixLatex', 'latexForward', 'latexInverse', 'installTectonic'] as const
  return client && methods.every((name) => typeof client[name] === 'function') ? client as LatexClient : null
}

function libraryClientOf(client: Partial<LibraryClient> | undefined): LibraryClient | null {
  const methods = ['listReferences', 'searchReferences', 'zoteroReferences', 'addReferences', 'removeReferences', 'importReferences', 'exportReferences', 'checkReferences'] as const
  return client && methods.every((name) => typeof client[name] === 'function') ? client as LibraryClient : null
}

const TERMINAL_OPEN_KEY = 'agent-workspace.terminal.open.v1'

const NO_BREAKPOINTS: readonly number[] = []

function debugClientOf(client: Partial<DebugClient> | undefined): DebugClient | null {
  const methods = ['onDebugEvent', 'debugStatus', 'installDebugpy', 'startDebug', 'debugControl', 'debugStack', 'debugScopes', 'debugVariables', 'debugEvaluate', 'setDebugBreakpoints', 'stopDebug'] as const
  return client && methods.every((name) => typeof client[name] === 'function') ? client as DebugClient : null
}

function tourClientOf(client: Partial<TourClient> | undefined): TourClient | null {
  const methods = ['tourMap', 'tourGet', 'writeTour'] as const
  return client && methods.every((name) => typeof client[name] === 'function') ? client as TourClient : null
}

function specClientOf(client: Partial<SpecClient> | undefined): SpecClient | null {
  const methods = ['listSpecs', 'createSpec', 'getSpec', 'approveSpec', 'reopenSpec', 'specPrompt'] as const
  return client && methods.every((name) => typeof client[name] === 'function') ? client as SpecClient : null
}

function shellClientOf(client: Partial<ShellClient> | undefined): ShellClient | null {
  const methods = ['onShellEvent', 'listShells', 'startShell', 'sendShellInput', 'resizeShell', 'stopShell', 'closeShell', 'replayShell'] as const
  return client && methods.every((name) => typeof client[name] === 'function') ? client as ShellClient : null
}

function templateClientOf(client: Partial<TemplateClient> | undefined): TemplateClient | null {
  const methods = ['listTemplates', 'createFromTemplate', 'openTemplatesFolder'] as const
  return client && methods.every((name) => typeof client[name] === 'function') ? client as TemplateClient : null
}

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
      | 'deviceLinkStatus' | 'sendToPhone' | 'createLatexDocument'
      | 'codeDiagnostics' | 'codeDefinition' | 'codeHover' | 'rewriteCode' | 'completeCode' | 'startTurn'
    >
  > & Partial<LatexClient> & Partial<TemplateClient> & Partial<ShellClient> & Partial<SpecClient> & Partial<DebugClient> & Partial<TourClient>

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
  const [activeTab, setActiveTab] = useState<'files' | 'sessions' | 'library' | 'memory' | 'setup' | 'batches' | 'specs' | 'tour'>('sessions')

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

  // A line to show once a file is open (an inverse search, a problem in another file).
  const [reveal, setReveal] = useState<{ path: string; line: number; serial: number } | null>(null)
  const [latexForm, setLatexForm] = useState<{ template: string; directory: string; busy: boolean; error: string | null } | null>(null)
  const latexClient = latexClientOf(client)
  const libraryClient = libraryClientOf(client)
  const templateClient = templateClientOf(client)
  const shellClient = shellClientOf(client)
  const specClient = specClientOf(client)
  const tourClient = tourClientOf(client)
  const debugClient = debugClientOf(client)
  const [debugOpen, setDebugOpen] = useState(false)
  const [debugStart, setDebugStart] = useState<{ path: string; serial: number } | null>(null)
  const [paused, setPaused] = useState<{ path: string; line: number } | null>(null)
  const fileBreakpoints = useBreakpoints(workspacePath)
  const [terminalOpen, setTerminalOpen] = useState(() => {
    try {
      return window.localStorage.getItem(TERMINAL_OPEN_KEY) === 'true'
    } catch {
      return false
    }
  })
  const showTerminal = useCallback((open: boolean) => {
    setTerminalOpen(open)
    try {
      window.localStorage.setItem(TERMINAL_OPEN_KEY, String(open))
    } catch {
      // Only a preference.
    }
  }, [])
  useEffect(() => {
    if (!shellClient || activeTab !== 'files') return
    const toggle = (event: KeyboardEvent): void => {
      if (!event.ctrlKey || event.altKey || event.metaKey || event.code !== 'Backquote') return
      event.preventDefault()
      showTerminal(!terminalOpen)
    }
    window.addEventListener('keydown', toggle)
    return () => window.removeEventListener('keydown', toggle)
  }, [activeTab, shellClient, showTerminal, terminalOpen])
  const askAboutTerminal = client?.startTurn
    ? async (prompt: string): Promise<boolean> => {
      try {
        await client.startTurn!(prompt)
        return true
      } catch {
        return false
      }
    }
    : undefined
  const [templatesOpen, setTemplatesOpen] = useState(false)
  // A LaTeX file needs room for the source and the PDF: it opens over the whole window.
  const [latexExpanded, setLatexExpanded] = useState(readLatexExpanded)
  const toggleLatexExpanded = (): void => {
    setLatexExpanded((current) => {
      saveLatexExpanded(!current)
      return !current
    })
  }
  const latexActive = Boolean(latexClient && activeTabPath && isLatexPath(activeTabPath))
  const latexLayer = latexActive && latexExpanded && activeTab === 'files'
    ? document.querySelector<HTMLElement>('[data-testid="workbench"]')
    : null
  // Below the window's title bar, whatever its height in this layout.
  const latexLayerTop = latexLayer ? Math.round(document.querySelector('.title-strip')?.getBoundingClientRect().bottom ?? 44) + 6 : 0

  const openAtLine = (filePath: string, line?: number): void => {
    void openInEditor(filePath).then(() => {
      if (line) setReveal((current) => ({ path: filePath, line, serial: (current?.serial ?? 0) + 1 }))
    })
  }

  // The code editor's language server and model help, made once per client.
  const codeIntel = useMemo(() => codeIntelOf(client), [client])
  const codeAi = useMemo(() => codeAiOf(client), [client])
  const completion = useCodeCompletion()
  const [codeReveal, setCodeReveal] = useState<{ path: string; line: number; character: number; serial: number } | null>(null)
  const [outsideDefinition, setOutsideDefinition] = useState<string | null>(null)
  const openLocation = (location: CodeLocation): void => {
    if (!location.inside) {
      setOutsideDefinition(`${location.path}:${location.line + 1}`)
      return
    }
    setOutsideDefinition(null)
    void openInEditor(location.path).then(() => {
      setCodeReveal((current) => ({ path: location.path, line: location.line, character: location.character, serial: (current?.serial ?? 0) + 1 }))
    })
  }

  const createLatexDocument = async (): Promise<void> => {
    if (!latexForm || !client?.createLatexDocument) return
    setLatexForm({ ...latexForm, busy: true, error: null })
    try {
      const response = await client.createLatexDocument(latexForm.template, latexForm.directory.trim())
      const main = (response.payload as { main?: string }).main
      setLatexForm(null)
      await loadFiles()
      if (main) await openInEditor(main)
    } catch (error) {
      const code = error instanceof Error ? error.message : ''
      setLatexForm({ ...latexForm, busy: false, error: code === 'latex_template_exists' ? t('latex.new.exists') : t('latex.new.failed') })
    }
  }

  const handleSelectFile = async (filePath: string): Promise<void> => {
    // Word, Excel and PowerPoint files open as a preview, not as text in the editor; so do pages,
    // PDFs and pictures (in the preview panel), when the window has one.
    if (isOfficePath(filePath)) {
      requestDocumentPreview({ path: filePath })
      return
    }
    if (isPanelFile(filePath) && window.agentWorkspace?.preview) {
      requestPreview({ kind: 'file', path: filePath })
      return
    }
    // A notebook shows its cells and outputs in the reader; its JSON is not for editing by hand.
    if (/\.ipynb$/i.test(filePath) && window.agentWorkspace?.readNotebook) {
      requestPreview({ kind: 'file', path: filePath })
      return
    }
    await openInEditor(filePath)
  }

  const openInEditor = async (filePath: string): Promise<void> => {
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
    let again = false
    try {
      const res = await client.writeWorkspaceFile(filePath, tab.content, tab.sha256)
      const data = res.payload as { sha256?: string }
      again = editorStore.finishWrite(workspacePath, filePath, tab, data.sha256 ?? tab.sha256)
    } catch {
      editorStore.finishWrite(workspacePath, filePath, tab)
    }
    // Saved again while this write was on its way: write the newer text now.
    if (again) await handleSaveFile(filePath)
  }

  // A file the conversation asked to edit (from the preview's "open in editor").
  const editorRequest = useRef(openInEditor)
  editorRequest.current = openInEditor
  useEffect(() => {
    const take = (): void => {
      const path = takeEditorRequest()
      if (path) void editorRequest.current(path)
    }
    take()
    window.addEventListener(OPEN_IN_EDITOR_EVENT, take)
    return () => window.removeEventListener(OPEN_IN_EDITOR_EVENT, take)
  }, [])

  const handleOpenPdf = async (filePath: string): Promise<void> => {
    setError(null)
    if (window.agentWorkspace?.preview) {
      requestPreview({ kind: 'file', path: filePath })
      return
    }
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

  const editorLayout = (
    <div className={`workspace-editor-layout${latexLayer ? ' latex-expanded-layer' : ''}`} style={latexLayer ? { top: latexLayerTop } : undefined}>
      {/* While debugging, the debugger takes the file tree's place: the editor keeps its width. */}
      {debugOpen && debugClient && workspacePath && !latexLayer ? (
        <DebugPanel
          key={workspacePath}
          client={debugClient}
          folder={workspacePath}
          startRequest={debugStart}
          onPaused={(location) => {
            setPaused(location)
            if (location && location.path !== activeTabPath) void handleSelectFile(location.path)
          }}
          onClose={() => {
            setDebugOpen(false)
            setPaused(null)
            // A program left paused behind a closed panel would wait for ever.
            void debugClient.stopDebug().catch(() => undefined)
          }}
        />
      ) : (
        <FileTree
          files={files}
          selectedPath={activeTabPath ?? undefined}
          loading={loadingFiles}
          onSelectFile={(path) => void handleSelectFile(path)}
          onRefresh={() => void loadFiles()}
        />
      )}
      <div className="workspace-editor-main">
        {outsideDefinition ? (
          <p className="code-outside-definition" role="status">
            {t('editor.definitionOutside', { place: outsideDefinition })}
            <button type="button" className="icon-button" aria-label={t('workbench.dismiss')} onClick={() => setOutsideDefinition(null)}>×</button>
          </p>
        ) : null}
        <CodeEditor
          tabs={editorTabs}
          activeTabPath={activeTabPath}
          intel={codeIntel}
          ai={codeAi}
          completion={completion}
          onOpenLocation={openLocation}
          reveal={codeReveal}
          debug={debugClient && workspacePath ? {
            breakpoints: (path) => fileBreakpoints[path] ?? NO_BREAKPOINTS,
            onBreakpointsChange: (path, lines) => breakpointStore.set(workspacePath, path, lines),
            paused,
            onDebug: (path) => {
              setDebugOpen(true)
              setDebugStart({ path, serial: Date.now() })
            },
          } : undefined}
          onSelectTab={(path) => editorStore.update(workspacePath, (current) => ({ ...current, activeTabPath: path }))}
          onCloseTab={handleCloseTab}
          onChangeContent={handleChangeContent}
          onSave={handleSaveFile}
          onOpenPdf={(path) => void handleOpenPdf(path)}
          onSendToPhone={phoneSend.available ? (path) => phoneSend.send({ kind: 'file', path }) : undefined}
          renderBody={latexClient ? (tab) => {
            const current = editorTabs.find((item) => item.path === tab.path)
            if (!current || !isLatexPath(tab.path) || tab.isBinary || tab.truncated) return null
            return (
              <Suspense fallback={<div className="code-editor-empty"><p>{t('latex.loading')}</p></div>}>
                <LatexWorkbench
                  key={current.instanceId}
                  scope={workspacePath ?? ''}
                  client={latexClient}
                  tab={current}
                  reveal={reveal?.path === tab.path ? reveal : null}
                  onChange={(content) => handleChangeContent(tab.path, content)}
                  onSave={() => handleSaveFile(tab.path)}
                  onOpenFile={openAtLine}
                  expanded={latexExpanded}
                  onToggleExpanded={toggleLatexExpanded}
                />
              </Suspense>
            )
          } : undefined}
        />
        {shellClient && !latexLayer ? (
          terminalOpen
            ? <TerminalDock client={shellClient} onHide={() => showTerminal(false)} onAsk={askAboutTerminal} />
            : <TerminalDockClosed onShow={() => showTerminal(true)} />
        ) : null}
      </div>
      {phoneSend.ui}
      </div>
  )

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
          {specClient ? (
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'specs'}
              className={`sub-tab-btn ${activeTab === 'specs' ? 'active' : ''}`}
              onClick={() => setActiveTab('specs')}
            >
              <ClipboardList size={13} />
              <span>{t('specs.tab')}</span>
            </button>
          ) : null}
          {tourClient ? (
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'tour'}
              className={`sub-tab-btn ${activeTab === 'tour' ? 'active' : ''}`}
              onClick={() => setActiveTab('tour')}
            >
              <Compass size={13} />
              <span>{t('tour.tab')}</span>
            </button>
          ) : null}
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
          {libraryClient ? (
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'library'}
              className={`sub-tab-btn ${activeTab === 'library' ? 'active' : ''}`}
              onClick={() => setActiveTab('library')}
            >
              <BookMarked size={13} />
              <span>{t('library.tab')}</span>
            </button>
          ) : null}
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
        {hasFilesSupport && activeTab === 'files' && templateClient && templatesOpen ? (
          <TemplatePicker
            client={templateClient}
            onClose={() => setTemplatesOpen(false)}
            onCreated={(path) => { void loadFiles().then(() => handleSelectFile(path)) }}
          />
        ) : null}
        {hasFilesSupport && activeTab === 'files' && templateClient && !templatesOpen && !(latexClient && client?.createLatexDocument) ? (
          <div className="latex-new">
            <button type="button" className="quiet-action" onClick={() => setTemplatesOpen(true)}>
              <FilePlus2 size={14} />{t('templates.open')}
            </button>
          </div>
        ) : null}
        {hasFilesSupport && activeTab === 'files' && latexClient && client?.createLatexDocument ? (
          <div className="latex-new">
            {templateClient && !templatesOpen && !latexForm ? (
              <button type="button" className="quiet-action" onClick={() => setTemplatesOpen(true)}>
                <FilePlus2 size={14} />{t('templates.open')}
              </button>
            ) : null}
            {latexForm ? (
              <form className="latex-new-form" onSubmit={(event) => { event.preventDefault(); void createLatexDocument() }}>
                <label>
                  <span>{t('latex.new.template')}</span>
                  <select value={latexForm.template} onChange={(event) => setLatexForm({ ...latexForm, template: event.target.value })}>
                    {LATEX_TEMPLATES.map((id) => <option key={id} value={id}>{t(`latex.template.${id}` as MessageKey)}</option>)}
                  </select>
                </label>
                <label>
                  <span>{t('latex.new.folder')}</span>
                  <input type="text" maxLength={200} value={latexForm.directory} placeholder={t('latex.new.folderHint')} onChange={(event) => setLatexForm({ ...latexForm, directory: event.target.value })} />
                </label>
                <button type="submit" className="toolbar-action-btn primary" disabled={latexForm.busy}>{t('latex.new.create')}</button>
                <button type="button" className="toolbar-action-btn" onClick={() => setLatexForm(null)}>{t('latex.new.cancel')}</button>
                {latexForm.error ? <span className="route-error" role="status">{latexForm.error}</span> : null}
              </form>
            ) : (
              <button type="button" className="quiet-action" onClick={() => setLatexForm({ template: 'paper-zh', directory: 'paper', busy: false, error: null })}>
                <FilePlus2 size={14} />{t('latex.new.open')}
              </button>
            )}
          </div>
        ) : null}

        {hasFilesSupport && activeTab === 'files' ? (latexLayer ? createPortal(editorLayout, latexLayer) : editorLayout) : null}

        {activeTab === 'library' && libraryClient ? <ReferenceLibrary client={libraryClient} workspaceKey={workspacePath} /> : null}
        {activeTab === 'specs' && specClient ? (
          <SpecsPanel
            key={workspacePath ?? ''}
            client={specClient}
            onAsk={askAboutTerminal}
            onOpenFile={(path) => {
              setActiveTab('files')
              void handleSelectFile(path)
            }}
            refreshKey={String(state.runtime.activeTurn ?? 'idle')}
          />
        ) : null}
        {activeTab === 'tour' && tourClient ? (
          <RepoTour
            key={workspacePath ?? ''}
            client={tourClient}
            onOpenFile={(path) => {
              setActiveTab('files')
              void handleSelectFile(path)
            }}
          />
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

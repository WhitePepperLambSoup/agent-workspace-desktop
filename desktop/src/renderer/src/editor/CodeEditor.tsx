import { AlertTriangle, Bug, Check, Copy, ExternalLink, Eye, FileEdit, MessageSquarePlus, Save, Smartphone, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import { useOptionalI18n } from '../i18n/I18nProvider'
import { isDebuggable } from './breakpoints'
import { CodeView, type CodeAi, type CodeIntel, type CodeLocation, type CodeViewHandle } from './CodeView'

export interface EditorTab {
  path: string
  content: string
  sha256: string
  dirty: boolean
  originalContent: string
  lineCount: number
  saving?: boolean
  truncated?: boolean
  isBinary?: boolean
  editable?: boolean
}

interface CodeEditorProps {
  tabs: EditorTab[]
  activeTabPath: string | null
  onSelectTab: (path: string) => void
  onCloseTab: (path: string) => void
  onChangeContent: (path: string, newContent: string) => void
  onSave: (path: string) => Promise<void>
  onSendToAgent?: (path: string) => void
  onOpenPdf?: (path: string) => void
  /** Put the open file in a paired phone's inbox. */
  onSendToPhone?: (path: string) => void
  /** An editor of its own for some files (LaTeX); null keeps the plain one. */
  renderBody?: (tab: EditorTab) => ReactNode | null
  /** The language server's problems, definitions and types for the open folder. */
  intel?: CodeIntel
  /** The model's help: Ctrl+K rewrites the selection; completion as you type (Tab accepts). */
  ai?: CodeAi
  completion?: boolean
  /** A definition in another file, or outside the folder. */
  onOpenLocation?: (location: CodeLocation) => void
  /** Where the editor of the active file moves to when it opens (0-based), once. */
  reveal?: { path: string; line: number; character: number } | null
  /** Breakpoints of the folder's files, where the debugger stopped, and starting it. */
  debug?: {
    breakpoints(path: string): readonly number[]
    onBreakpointsChange(path: string, lines: number[]): void
    paused: { path: string; line: number } | null
    onDebug?(path: string): void
  }
}

export function CodeEditor({
  tabs,
  activeTabPath,
  onSelectTab,
  onCloseTab,
  onChangeContent,
  onSave,
  onSendToAgent,
  onOpenPdf,
  onSendToPhone,
  renderBody,
  intel,
  ai,
  completion,
  onOpenLocation,
  reveal,
  debug,
}: CodeEditorProps) {
  const { t } = useOptionalI18n()
  const [editMode, setEditMode] = useState(true)
  const [copied, setCopied] = useState(false)
  const codeView = useRef<CodeViewHandle>(null)

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.path === activeTabPath),
    [tabs, activeTabPath],
  )

  const isReadOnly = useMemo(() => {
    if (!activeTab) return false
    return activeTab.editable === false || activeTab.truncated === true || activeTab.isBinary === true
  }, [activeTab])
  const isPdf = Boolean(activeTab?.isBinary && /\.pdf$/i.test(activeTab.path))

  const lineCount = useMemo(() => {
    if (!activeTab) return 0
    return activeTab.content.split('\n').length
  }, [activeTab])

  // A definition opened in this file: move there once its editor is up.
  useEffect(() => {
    if (!reveal || reveal.path !== activeTab?.path) return
    const timer = window.setTimeout(() => codeView.current?.goTo(reveal.line + 1, reveal.character), 0)
    return () => window.clearTimeout(timer)
  }, [reveal, activeTab?.path])

  const handleCopy = async (): Promise<void> => {
    if (!activeTab) return
    try {
      await navigator.clipboard.writeText(activeTab.content)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    if (copied) {
      const timer = setTimeout(() => setCopied(false), 2000)
      return () => clearTimeout(timer)
    }
    return undefined
  }, [copied])

  if (tabs.length === 0) {
    return (
      <div className="code-editor-empty">
        <p>{t('workspace.selectFilePrompt')}</p>
      </div>
    )
  }
  const customBody = activeTab ? renderBody?.(activeTab) ?? null : null

  return (
    <div className="code-editor-container" aria-label={t('workspace.editor')}>
      {/* Tabs bar */}
      <div className="code-editor-tabs-bar" role="tablist" aria-label={t('workspace.openFiles')}>
        {tabs.map((tab) => {
          const isActive = tab.path === activeTabPath
          const fileName = tab.path.split('/').pop() ?? tab.path
          return (
            <div
              key={tab.path}
              role="tab"
              aria-selected={isActive}
              tabIndex={isActive ? 0 : -1}
              className={`code-editor-tab ${isActive ? 'active' : ''}`}
              onClick={() => onSelectTab(tab.path)}
            >
              {tab.dirty ? <span className="dirty-dot" title={t('workspace.unsavedChanges')}>●</span> : null}
              <span className="tab-title" title={tab.path}>{fileName}</span>
              <button
                type="button"
                className="tab-close"
                aria-label={t('workspace.closeTab', { file: fileName })}
                title={tab.saving ? t('workspace.saving') : t('workspace.closeTab', { file: fileName })}
                disabled={tab.saving}
                onClick={(e) => {
                  e.stopPropagation()
                  onCloseTab(tab.path)
                }}
              >
                <X size={12} />
              </button>
            </div>
          )
        })}
      </div>

      {customBody}
      {activeTab && customBody === null ? (
        <>
          {/* Editor action toolbar */}
          <div className="code-editor-toolbar">
            <div className="toolbar-left">
              {activeTab.isBinary ? <span>{isPdf ? 'PDF' : t('workspace.binaryType')}</span> : (
                <>
                  <button
                    type="button"
                    className={`toolbar-btn ${editMode ? 'active' : ''}`}
                    aria-pressed={editMode}
                    onClick={() => setEditMode(true)}
                  >
                    <FileEdit size={13} />
                    <span>{t('workspace.editMode')}</span>
                  </button>
                  <button
                    type="button"
                    className={`toolbar-btn ${!editMode ? 'active' : ''}`}
                    aria-pressed={!editMode}
                    onClick={() => setEditMode(false)}
                  >
                    <Eye size={13} />
                    <span>{t('workspace.previewMode')}</span>
                  </button>
                </>
              )}
            </div>

            <div className="toolbar-right">
              {!activeTab.isBinary ? (
                <button
                  type="button"
                  className="toolbar-action-btn"
                  aria-label={t('workspace.copyContent')}
                  title={t('workspace.copyContent')}
                  onClick={() => void handleCopy()}
                >
                  {copied ? <Check size={13} /> : <Copy size={13} />}
                  <span>{copied ? t('common.copied') : t('common.copy')}</span>
                </button>
              ) : null}

              {debug?.onDebug && isDebuggable(activeTab.path) ? (
                <button
                  type="button"
                  className="toolbar-action-btn"
                  aria-label={t('debug.start')}
                  title={t('debug.startShortcut')}
                  onClick={() => debug.onDebug!(activeTab.path)}
                >
                  <Bug size={13} />
                  <span>{t('debug.start')}</span>
                </button>
              ) : null}

              {onSendToAgent ? (
                <button
                  type="button"
                  className="toolbar-action-btn"
                  aria-label={t('workspace.sendToAgent')}
                  title={t('workspace.sendToAgent')}
                  onClick={() => onSendToAgent(activeTab.path)}
                >
                  <MessageSquarePlus size={13} />
                  <span>{t('workspace.sendToAgent')}</span>
                </button>
              ) : null}

              {onSendToPhone ? (
                <button
                  type="button"
                  className="toolbar-action-btn"
                  aria-label={t('devices.sendToPhone')}
                  title={t('devices.sendToPhone')}
                  onClick={() => onSendToPhone(activeTab.path)}
                >
                  <Smartphone size={13} />
                  <span>{t('devices.sendToPhone')}</span>
                </button>
              ) : null}

              <button
                type="button"
                className="toolbar-action-btn primary"
                aria-label={t('workspace.save')}
                disabled={!activeTab.dirty || activeTab.saving || isReadOnly}
                onClick={() => void onSave(activeTab.path)}
              >
                <Save size={13} />
                <span>{activeTab.saving ? t('workspace.saving') : t('workspace.save')}</span>
              </button>
            </div>
          </div>

          {isReadOnly ? (
            <div className="editor-readonly-banner" role="alert">
              <AlertTriangle size={14} />
              <span>
                {activeTab.isBinary
                  ? t('workspace.binaryFileWarning')
                  : t('workspace.truncatedFileWarning')}
              </span>
            </div>
          ) : null}

          {/* Editor content area */}
          <div className="code-editor-surface">
            {activeTab.isBinary ? (
              <div className="code-editor-empty">
                {isPdf && onOpenPdf ? (
                  <button
                    type="button"
                    className="toolbar-action-btn primary"
                    onClick={() => onOpenPdf(activeTab.path)}
                  >
                    <ExternalLink size={14} />
                    <span>{t('workspace.openPdf')}</span>
                  </button>
                ) : <p>{t('workspace.binaryFileWarning')}</p>}
              </div>
            ) : editMode ? (
              <CodeView
                key={activeTab.path}
                ref={codeView}
                path={activeTab.path}
                value={activeTab.content}
                readOnly={isReadOnly}
                label={activeTab.path}
                onChange={(value) => {
                  if (!isReadOnly) onChangeContent(activeTab.path, value)
                }}
                onSave={() => {
                  // Also while a save is on its way: the newer text is written once that one is back.
                  if (activeTab.dirty && !isReadOnly) void onSave(activeTab.path)
                }}
                intel={intel}
                ai={ai}
                completion={completion}
                onOpenLocation={onOpenLocation}
                breakpoints={debug && isDebuggable(activeTab.path) ? debug.breakpoints(activeTab.path) : undefined}
                onBreakpointsChange={debug && isDebuggable(activeTab.path) ? (lines) => debug.onBreakpointsChange(activeTab.path, lines) : undefined}
                pausedLine={debug?.paused?.path === activeTab.path ? debug.paused.line : null}
              />
            ) : (
              <div className="editor-preview-wrapper">
                <pre className="editor-preview-pre">
                  <code>{activeTab.content}</code>
                </pre>
              </div>
            )}
          </div>

          {/* Status bar */}
          <div className="code-editor-statusbar">
            <span>{activeTab.path}</span>
            <span className="statusbar-separator">|</span>
            <span>{t('workspace.linesCount', { count: lineCount })}</span>
            <span className="statusbar-separator">|</span>
            <span>{t('workspace.charactersCount', { count: activeTab.content.length })}</span>
            <span className="statusbar-separator">|</span>
            <span>{activeTab.isBinary ? t('workspace.binaryType') : activeTab.truncated ? t('workspace.truncatedEncoding') : 'UTF-8'}</span>
            {activeTab.dirty ? (
              <>
                <span className="statusbar-separator">|</span>
                <span className="statusbar-dirty">{t('workspace.unsaved')}</span>
              </>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  )
}

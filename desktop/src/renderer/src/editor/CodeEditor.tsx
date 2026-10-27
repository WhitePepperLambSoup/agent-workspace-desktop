import { AlertTriangle, Check, Copy, ExternalLink, Eye, FileEdit, MessageSquarePlus, Save, Smartphone, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useOptionalI18n } from '../i18n/I18nProvider'

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
}: CodeEditorProps) {
  const { t } = useOptionalI18n()
  const [editMode, setEditMode] = useState(true)
  const [copied, setCopied] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const lineNumbersRef = useRef<HTMLDivElement>(null)

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

  const lineNumbers = useMemo(() => {
    return Array.from({ length: Math.max(1, lineCount) }, (_, i) => i + 1)
  }, [lineCount])

  // Handle Ctrl+S / Cmd+S save shortcut
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (isReadOnly) return
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        if (activeTab && activeTab.dirty && !activeTab.saving) {
          void onSave(activeTab.path)
        }
      } else if (e.key === 'Tab') {
        e.preventDefault()
        const textarea = e.currentTarget
        const start = textarea.selectionStart
        const end = textarea.selectionEnd
        const val = textarea.value
        const newVal = val.substring(0, start) + '  ' + val.substring(end)
        if (activeTab) {
          onChangeContent(activeTab.path, newVal)
        }
        setTimeout(() => {
          textarea.selectionStart = textarea.selectionEnd = start + 2
        }, 0)
      }
    },
    [activeTab, isReadOnly, onSave, onChangeContent],
  )

  const handleScroll = (): void => {
    if (textareaRef.current && lineNumbersRef.current) {
      lineNumbersRef.current.scrollTop = textareaRef.current.scrollTop
    }
  }

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

      {activeTab ? (
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
              <div className="editor-textarea-wrapper">
                <div ref={lineNumbersRef} className="editor-line-numbers" aria-hidden="true">
                  {lineNumbers.map((num) => (
                    <div key={num} className="line-number">{num}</div>
                  ))}
                </div>
                <textarea
                  ref={textareaRef}
                  className="editor-textarea"
                  aria-label={activeTab.path}
                  value={activeTab.content}
                  readOnly={isReadOnly}
                  onChange={(e) => {
                    if (isReadOnly) return
                    onChangeContent(activeTab.path, e.target.value)
                  }}
                  onKeyDown={handleKeyDown}
                  onScroll={handleScroll}
                  spellCheck={false}
                  autoCapitalize="off"
                  autoComplete="off"
                  autoCorrect="off"
                />
              </div>
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

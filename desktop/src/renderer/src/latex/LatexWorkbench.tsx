import {
  AlertTriangle,
  BookMarked,
  Bot,
  Crosshair,
  Download,
  FileCode2,
  Info,
  ListTree,
  Loader2,
  Maximize2,
  Minimize2,
  PenLine,
  Play,
  Plus,
  Save,
  Settings2,
  Sigma,
  Square,
  Wand2,
  XCircle,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { GatewayCommandError, type WorkbenchBridgeClient } from '../bridge/client'
import { useOptionalI18n } from '../i18n/I18nProvider'
import { zhCN, type MessageKey } from '../i18n/messages'
import type { WorkspaceEditorTab } from '../workspace/workspace-editor-state'
import { countWords, outline, SNIPPETS, SYMBOLS, type LatexCitation, type LatexLabel } from './latex-language'
import { LatexEditor, type EditorProblem, type LatexEditorHandle } from './LatexEditor'
import { PdfView, type PdfHighlight } from './PdfView'
import { ReferencesPanel, type ReferencesClient } from './ReferencesPanel'
import { VisualEditor } from './VisualEditor'
import './latex.css'

const MODE_KEY = 'agent-workspace.latex.mode'

/** Source or visual editing of .tex files, as last chosen. */
function storedMode(): 'source' | 'visual' {
  try {
    return localStorage.getItem(MODE_KEY) === 'visual' ? 'visual' : 'source'
  } catch {
    return 'source'
  }
}

export type LatexClient = Pick<
  WorkbenchBridgeClient,
  | 'latexStatus'
  | 'setLatexSettings'
  | 'compileLatex'
  | 'cancelLatex'
  | 'checkLatex'
  | 'fixLatex'
  | 'latexForward'
  | 'latexInverse'
  | 'installTectonic'
> & Partial<Pick<WorkbenchBridgeClient, 'startTurn'>> & Partial<ReferencesClient>

export interface LatexIssue {
  severity: 'error' | 'warning' | 'info' | 'suggestion'
  code: string
  message: string
  source: 'compile' | 'rule'
  file?: string
  line?: number
  column?: number
  params?: Record<string, unknown>
  raw?: string
  rule?: string
  fixable?: boolean
}

interface LatexStatus {
  available: boolean
  installable: boolean
  engines: { programs: Record<string, string>; tectonic: string | null; distribution: string | null }
  settings: { engine: string; autoCompile: boolean; rules: Record<string, boolean> }
  rules: Array<{ id: string; defaultEnabled: boolean; fixable: boolean }>
}

interface CompileResult {
  ok: boolean
  engine: string
  main: string
  pdf: string | null
  pdfSha256: string | null
  passes: number
  seconds: number
  cancelled: boolean
  timedOut: boolean
  issues: LatexIssue[]
}

interface LatexWorkbenchProps {
  client: LatexClient
  tab: WorkspaceEditorTab
  /** A line to show, asked for from elsewhere (an inverse search into this file). */
  reveal?: { line: number; serial: number } | null
  onChange(content: string): void
  onSave(): Promise<void>
  onOpenFile(path: string, line?: number): void
  /** Whether the editor covers the window; the toolbar switches it. */
  expanded?: boolean
  onToggleExpanded?(): void
  /** The open folder: compile results are kept per folder. */
  scope?: string
}

function errorCode(error: unknown): string {
  return error instanceof GatewayCommandError ? error.code : 'failed'
}

function hasKey(key: string): key is MessageKey {
  return Object.prototype.hasOwnProperty.call(zhCN, key)
}

// The names the messages use; one an issue lacks prints as nothing rather than as "{name}".
const PARAM_NAMES = ['command', 'name', 'key', 'amount', 'env', 'spec', 'number', 'rounded', 'start', 'end', 'count', 'other', 'type', 'fields', 'year', 'field']

function paramsOf(issue: LatexIssue): Record<string, string | number> {
  const params: Record<string, string | number> = { message: issue.message }
  for (const name of PARAM_NAMES) params[name] = ''
  for (const [name, value] of Object.entries(issue.params ?? {})) {
    if (typeof value === 'string' || typeof value === 'number') params[name] = value
    else if (Array.isArray(value)) params[name] = value.join(', ')
  }
  return params
}

/** An issue in the window's language, from its code; the English message when there is none. */
export function issueText(t: (key: MessageKey, variables?: Record<string, string | number>) => string, issue: LatexIssue): string {
  const key = `latex.${issue.source === 'rule' ? 'rule' : 'log'}.${issue.code}`
  return hasKey(key) ? t(key, paramsOf(issue)) : issue.message
}

const EMPTY_LABELS: LatexLabel[] = []
const EMPTY_CITATIONS: LatexCitation[] = []

// The last compile of each document (by its main file), so a chapter opened from a problem shows
// the same results and PDF as the main file.
const lastCompiles = new Map<string, CompileResult>()

export default function LatexWorkbench({ client, tab, reveal, onChange, onSave, onOpenFile, expanded, onToggleExpanded, scope = '' }: LatexWorkbenchProps) {
  const { t } = useOptionalI18n()
  const editor = useRef<LatexEditorHandle>(null)
  const [status, setStatus] = useState<LatexStatus | null>(null)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [ruleIssues, setRuleIssues] = useState<LatexIssue[]>([])
  const [labels, setLabels] = useState<LatexLabel[]>(EMPTY_LABELS)
  const [citations, setCitations] = useState<LatexCitation[]>(EMPTY_CITATIONS)
  const [main, setMain] = useState<string | null>(null)
  const [compiled, setCompiled] = useState<CompileResult | null>(null)
  const [compiling, setCompiling] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'error' | 'info'; text: string } | null>(null)
  const [panel, setPanel] = useState<'compile' | 'rules'>('compile')
  const [showOutline, setShowOutline] = useState(true)
  const [menu, setMenu] = useState<'insert' | 'symbols' | 'rules' | null>(null)
  const [showReferences, setShowReferences] = useState(false)
  const [highlight, setHighlight] = useState<PdfHighlight | null>(null)
  const [cursor, setCursor] = useState(1)
  const [pdfVersion, setPdfVersion] = useState('initial')
  const [mode, setModeState] = useState(storedMode)
  const serial = useRef(0)
  const isBib = /\.bib$/i.test(tab.path)
  const isSource = /\.tex$/i.test(tab.path)
  const visual = isSource && mode === 'visual'
  const setMode = (next: 'source' | 'visual'): void => {
    editor.current?.flush?.()
    setModeState(next)
    try {
      localStorage.setItem(MODE_KEY, next)
    } catch {
      // The choice is not kept; nothing else depends on it.
    }
  }

  const completion = useRef({ labels, citations })
  completion.current = { labels, citations }

  const loadStatus = useCallback(async (refresh = false): Promise<void> => {
    try {
      const response = await client.latexStatus(refresh)
      setStatus(response.payload as unknown as LatexStatus)
      setStatusError(null)
    } catch (error) {
      setStatusError(errorCode(error))
    }
  }, [client])

  useEffect(() => { void loadStatus() }, [loadStatus])

  // The rules run on the unsaved text, a moment after typing stops.
  const content = tab.content
  useEffect(() => {
    if (!isSource && !isBib) return undefined
    let current = true
    const timer = window.setTimeout(() => {
      void client.checkLatex(tab.path, content).then((response) => {
        if (!current) return
        const payload = response.payload as unknown as { issues: LatexIssue[]; labels: LatexLabel[]; citations: LatexCitation[]; main: string }
        setRuleIssues(payload.issues ?? [])
        setLabels(payload.labels ?? EMPTY_LABELS)
        setCitations(payload.citations ?? EMPTY_CITATIONS)
        setMain(payload.main ?? null)
        const earlier = payload.main ? lastCompiles.get(`${scope}|${payload.main}`) : undefined
        if (earlier) {
          setCompiled((current) => current ?? earlier)
          if (earlier.pdfSha256) setPdfVersion((current) => current === 'initial' ? earlier.pdfSha256 ?? current : current)
        }
      }, () => undefined)
    }, 700)
    return () => {
      current = false
      window.clearTimeout(timer)
    }
  }, [client, content, isBib, isSource, tab.path, status?.settings.rules])

  useEffect(() => {
    if (reveal) editor.current?.goTo(reveal.line)
  }, [reveal])

  const pdfPath = compiled?.pdf ?? (main ? main.replace(/\.tex$/i, '.pdf') : isSource ? tab.path.replace(/\.tex$/i, '.pdf') : null)

  const compile = useCallback(async (): Promise<void> => {
    if (compiling || !isSource) return
    setNotice(null)
    const pending = editor.current?.flush?.() ?? false
    if (tab.dirty || pending) await onSave()
    setCompiling(true)
    try {
      const response = await client.compileLatex(tab.path)
      const result = response.payload as unknown as CompileResult
      lastCompiles.set(`${scope}|${result.main}`, result)
      setCompiled(result)
      setPanel('compile')
      if (result.pdfSha256) setPdfVersion(result.pdfSha256)
      if (result.cancelled) setNotice({ kind: 'info', text: t('latex.compile.cancelled') })
    } catch (error) {
      const code = errorCode(error)
      setNotice({ kind: 'error', text: hasKey(`latex.error.${code}`) ? t(`latex.error.${code}` as MessageKey) : t('latex.error.failed') })
      if (code === 'latex_no_engine') void loadStatus(true)
    } finally {
      setCompiling(false)
    }
  }, [client, compiling, isSource, loadStatus, onSave, t, tab.dirty, tab.path])

  const save = useCallback(async (): Promise<void> => {
    editor.current?.flush?.()
    await onSave()
    if (status?.settings.autoCompile && isSource) void compile()
  }, [compile, isSource, onSave, status?.settings.autoCompile])

  const forward = useCallback(async (): Promise<void> => {
    if (!isSource) return
    const line = editor.current?.cursorLine() ?? cursor
    try {
      const response = await client.latexForward(tab.path, line)
      const payload = response.payload as { found?: boolean; page?: number; x?: number; y?: number; width?: number; height?: number }
      if (!payload.found || typeof payload.page !== 'number') {
        setNotice({ kind: 'info', text: t('latex.forward.notFound') })
        return
      }
      serial.current += 1
      setHighlight({ page: payload.page, x: payload.x ?? 0, y: payload.y ?? 0, width: payload.width ?? 0, height: payload.height ?? 0, serial: serial.current })
    } catch {
      setNotice({ kind: 'error', text: t('latex.error.failed') })
    }
  }, [client, cursor, isSource, t, tab.path])

  const inverse = useCallback(async (page: number, x: number, y: number): Promise<void> => {
    if (!pdfPath) return
    try {
      const response = await client.latexInverse(pdfPath, page, x, y)
      const payload = response.payload as { found?: boolean; file?: string; line?: number }
      if (!payload.found || !payload.file || !payload.line) return
      if (payload.file === tab.path) editor.current?.goTo(payload.line)
      else onOpenFile(payload.file, payload.line)
    } catch {
      // Nothing under the point.
    }
  }, [client, onOpenFile, pdfPath, tab.path])

  const goToIssue = (issue: LatexIssue): void => {
    if (!issue.file || issue.params?.outside) return
    if (issue.file === tab.path) editor.current?.goTo(issue.line ?? 1, issue.column)
    else onOpenFile(issue.file, issue.line)
  }

  const fix = async (rule: string): Promise<void> => {
    try {
      const response = await client.fixLatex(rule, tab.content)
      const fixed = (response.payload as { content?: string | null }).content
      if (typeof fixed === 'string') onChange(fixed)
    } catch {
      setNotice({ kind: 'error', text: t('latex.error.failed') })
    }
  }

  const install = async (): Promise<void> => {
    setInstalling(true)
    setNotice({ kind: 'info', text: t('latex.engine.installing') })
    try {
      await client.installTectonic()
      setNotice({ kind: 'info', text: t('latex.engine.installed') })
      await loadStatus(true)
    } catch (error) {
      const code = errorCode(error)
      setNotice({ kind: 'error', text: hasKey(`latex.error.${code}`) ? t(`latex.error.${code}` as MessageKey) : t('latex.error.latex_install_download') })
    } finally {
      setInstalling(false)
    }
  }

  const askAssistant = async (): Promise<void> => {
    if (!client.startTurn || !compiled) return
    const errors = compiled.issues.filter((issue) => issue.severity === 'error').slice(0, 10)
    const list = errors.map((issue) => `- ${issue.file ?? compiled.main}${issue.line ? `:${issue.line}` : ''} ${issue.message}`).join('\n')
    try {
      await client.startTurn(t('latex.ask.prompt', { main: compiled.main, errors: list }))
      setNotice({ kind: 'info', text: t('latex.ask.sent') })
    } catch {
      setNotice({ kind: 'error', text: t('latex.ask.failed') })
    }
  }

  const setRule = async (rule: string, enabled: boolean): Promise<void> => {
    try {
      const response = await client.setLatexSettings({ rules: { [rule]: enabled } })
      setStatus(response.payload as unknown as LatexStatus)
    } catch {
      setNotice({ kind: 'error', text: t('latex.error.failed') })
    }
  }

  const setOption = async (settings: { engine?: string; autoCompile?: boolean }): Promise<void> => {
    try {
      const response = await client.setLatexSettings(settings)
      setStatus(response.payload as unknown as LatexStatus)
    } catch {
      setNotice({ kind: 'error', text: t('latex.error.failed') })
    }
  }

  const compileIssues = useMemo(() => compiled?.issues ?? [], [compiled])
  const fileProblems: EditorProblem[] = useMemo(() => [...compileIssues, ...ruleIssues]
    .filter((issue) => issue.file === tab.path && typeof issue.line === 'number')
    .map((issue) => ({ line: issue.line ?? 1, column: issue.column, severity: issue.severity, message: issueText(t, issue) })), [compileIssues, ruleIssues, t, tab.path])
  const headings = useMemo(() => isSource ? outline(tab.content) : [], [isSource, tab.content])
  const words = useMemo(() => isSource ? countWords(tab.content) : 0, [isSource, tab.content])
  const errors = compileIssues.filter((issue) => issue.severity === 'error')
  const listed = panel === 'compile' ? compileIssues : ruleIssues
  const engines = status ? ['auto', ...Object.keys(status.engines.programs), ...(status.engines.tectonic ? ['tectonic'] : [])] : ['auto']
  const noEngine = status !== null && !status.available
  const referencesClient = client.listReferences && client.searchReferences && client.zoteroReferences && client.addReferences && client.citeReferences
    ? client as ReferencesClient
    : null

  return (
    <div className="latex-workbench" data-testid="latex-workbench">
      <div className="latex-toolbar" role="toolbar" aria-label={t('latex.toolbar')}>
        {isSource ? (
          compiling ? (
            <button type="button" className="toolbar-action-btn primary" onClick={() => void client.cancelLatex()}>
              <Square size={13} /><span>{t('latex.compile.stop')}</span>
            </button>
          ) : (
            <button type="button" className="toolbar-action-btn primary" title={t('latex.compile.shortcut')} disabled={noEngine} onClick={() => void compile()}>
              <Play size={13} /><span>{t('latex.compile.run')}</span>
            </button>
          )
        ) : null}
        {compiling ? <span className="latex-busy" role="status"><Loader2 size={13} className="spin" />{t('latex.compile.running')}</span> : null}
        <button type="button" className="toolbar-action-btn" disabled={!tab.dirty || tab.saving} onClick={() => void save()}>
          <Save size={13} /><span>{tab.saving ? t('workspace.saving') : t('workspace.save')}</span>
        </button>
        {isSource ? (
          <>
            <div className="latex-mode" role="tablist" aria-label={t('vis.mode')}>
              <button type="button" role="tab" aria-selected={!visual} title={t('vis.sourceTitle')} onClick={() => setMode('source')}>
                <FileCode2 size={13} /><span>{t('vis.source')}</span>
              </button>
              <button type="button" role="tab" aria-selected={visual} title={t('vis.visualTitle')} onClick={() => setMode('visual')}>
                <PenLine size={13} /><span>{t('vis.visual')}</span>
              </button>
            </div>
            <button type="button" className="toolbar-action-btn" title={t('latex.forward.shortcut')} onClick={() => void forward()}>
              <Crosshair size={13} /><span>{t('latex.forward.run')}</span>
            </button>
            <div className="latex-menu-anchor">
              <button type="button" className="toolbar-action-btn" aria-expanded={menu === 'insert'} onClick={() => setMenu(menu === 'insert' ? null : 'insert')}>
                <Plus size={13} /><span>{t('latex.insert')}</span>
              </button>
              {menu === 'insert' ? (
                <div className="latex-menu" role="menu">
                  {SNIPPETS.map((snippet) => (
                    <button key={snippet.id} type="button" role="menuitem" onClick={() => { editor.current?.insert(snippet.text); setMenu(null) }}>
                      {t(`latex.snippet.${snippet.id}` as MessageKey)}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="latex-menu-anchor">
              <button type="button" className="toolbar-action-btn" aria-expanded={menu === 'symbols'} aria-label={t('latex.symbols')} title={t('latex.symbols')} onClick={() => setMenu(menu === 'symbols' ? null : 'symbols')}>
                <Sigma size={13} />
              </button>
              {menu === 'symbols' ? (
                <div className="latex-menu latex-symbols" role="menu" aria-label={t('latex.symbols')}>
                  {SYMBOLS.map(([shown, command]) => (
                    <button key={command} type="button" role="menuitem" title={command} aria-label={command} onClick={() => editor.current?.insert(visual ? `$${command}$` : command.endsWith('{}') ? `${command.slice(0, -1)}§}` : `${command} `)}>
                      {shown}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            {referencesClient ? (
              <button type="button" className={`toolbar-action-btn ${showReferences ? 'active' : ''}`} aria-pressed={showReferences} onClick={() => setShowReferences(!showReferences)}>
                <BookMarked size={13} /><span>{t('latex.refs.button')}</span>
              </button>
            ) : null}
            <button type="button" className={`toolbar-action-btn ${showOutline ? 'active' : ''}`} aria-pressed={showOutline} aria-label={t('latex.outline')} title={t('latex.outline')} onClick={() => setShowOutline(!showOutline)}>
              <ListTree size={13} />
            </button>
          </>
        ) : null}
        <span className="latex-toolbar-spacer" />
        {status ? (
          <>
            <label className="latex-select">
              <span>{t('latex.engine.label')}</span>
              <select value={status.settings.engine} onChange={(event) => void setOption({ engine: event.target.value })}>
                {engines.map((engine) => <option key={engine} value={engine}>{engine === 'auto' ? t('latex.engine.auto') : engine}</option>)}
              </select>
            </label>
            <label className="latex-check">
              <input type="checkbox" checked={status.settings.autoCompile} onChange={(event) => void setOption({ autoCompile: event.target.checked })} />
              <span>{t('latex.autoCompile')}</span>
            </label>
            <div className="latex-menu-anchor">
              <button type="button" className="toolbar-action-btn" aria-expanded={menu === 'rules'} aria-label={t('latex.rules.title')} title={t('latex.rules.title')} onClick={() => setMenu(menu === 'rules' ? null : 'rules')}>
                <Settings2 size={13} />
              </button>
              {menu === 'rules' ? (
                <div className="latex-menu latex-rules" role="group" aria-label={t('latex.rules.title')}>
                  {status.rules.map((rule) => (
                    <label key={rule.id} className="latex-check">
                      <input type="checkbox" checked={status.settings.rules[rule.id] ?? rule.defaultEnabled} onChange={(event) => void setRule(rule.id, event.target.checked)} />
                      <span>{hasKey(`latex.ruleName.${rule.id}`) ? t(`latex.ruleName.${rule.id}` as MessageKey) : rule.id}</span>
                    </label>
                  ))}
                </div>
              ) : null}
            </div>
          </>
        ) : null}
        {onToggleExpanded ? (
          <button type="button" className="toolbar-action-btn" aria-pressed={Boolean(expanded)} aria-label={expanded ? t('latex.collapse') : t('latex.expand')} title={expanded ? t('latex.collapse') : t('latex.expand')} onClick={onToggleExpanded}>
            {expanded ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </button>
        ) : null}
      </div>

      {noEngine ? (
        <div className="latex-banner" role="alert">
          <AlertTriangle size={14} />
          <span>{t('latex.engine.missing')}</span>
          {status?.installable ? (
            <button type="button" className="toolbar-action-btn primary" disabled={installing} onClick={() => void install()}>
              <Download size={13} /><span>{installing ? t('latex.engine.installing') : t('latex.engine.install')}</span>
            </button>
          ) : null}
        </div>
      ) : null}
      {statusError ? <p className="route-error" role="status">{t('latex.error.failed')}</p> : null}
      {notice ? <p className={notice.kind === 'error' ? 'route-error' : 'latex-notice'} role="status">{notice.text}</p> : null}

      <div className={`latex-body ${showOutline && isSource ? 'with-outline' : ''}`}>
        {showOutline && isSource ? (
          <nav className="latex-outline" aria-label={t('latex.outline')}>
            {headings.length === 0 ? <p className="latex-muted">{t('latex.outline.empty')}</p> : headings.map((entry) => (
              <button key={`${entry.line}:${entry.title}`} type="button" className={`level-${entry.level}`} onClick={() => editor.current?.goTo(entry.line)}>
                {entry.title}
              </button>
            ))}
          </nav>
        ) : null}
        <div className="latex-source">
          {visual ? (
            <VisualEditor
              key={`${tab.instanceId}:visual`}
              ref={editor}
              path={tab.path}
              value={tab.content}
              readOnly={tab.editable === false}
              labels={labels}
              citations={citations}
              onChange={onChange}
              onSave={() => void save()}
              onCompile={() => void compile()}
              onForward={() => void forward()}
              onCursor={setCursor}
              onOpenFile={(path) => onOpenFile(path)}
              onSource={() => setMode('source')}
            />
          ) : (
            <LatexEditor
              key={tab.instanceId}
              ref={editor}
              path={tab.path}
              value={tab.content}
              readOnly={tab.editable === false}
              problems={fileProblems}
              completion={() => completion.current}
              label={tab.path}
              onChange={onChange}
              onSave={() => void save()}
              onCompile={() => void compile()}
              onForward={() => void forward()}
              onCursor={setCursor}
            />
          )}
        </div>
        {isSource && showReferences && referencesClient ? (
          <ReferencesPanel
            client={referencesClient}
            path={tab.path}
            onCite={(keys) => editor.current?.insert(`\\cite{${keys.join(',')}}`)}
            onClose={() => setShowReferences(false)}
          />
        ) : null}
        {isSource ? (
          <div className="latex-preview">
            {pdfPath ? (
              <PdfView key={pdfPath} path={pdfPath} version={pdfVersion} highlight={highlight} onInverse={(page, x, y) => void inverse(page, x, y)} />
            ) : <p className="latex-muted">{t('latex.pdf.none')}</p>}
          </div>
        ) : null}
      </div>

      <section className="latex-problems" aria-label={t('latex.problems')}>
        <div className="latex-problems-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={panel === 'compile'} className={panel === 'compile' ? 'active' : ''} onClick={() => setPanel('compile')}>
            {t('latex.problems.compile', { count: compileIssues.length })}
          </button>
          <button type="button" role="tab" aria-selected={panel === 'rules'} className={panel === 'rules' ? 'active' : ''} onClick={() => setPanel('rules')}>
            {t('latex.problems.rules', { count: ruleIssues.length })}
          </button>
          <span className="latex-toolbar-spacer" />
          {panel === 'compile' && errors.length > 0 && client.startTurn ? (
            <button type="button" className="toolbar-action-btn" onClick={() => void askAssistant()}>
              <Bot size={13} /><span>{t('latex.ask.run')}</span>
            </button>
          ) : null}
          {compiled ? (
            <span className="latex-muted" role="status">
              {compiled.ok ? t('latex.compile.done', { engine: compiled.engine, seconds: compiled.seconds, passes: compiled.passes })
                : t('latex.compile.failed', { engine: compiled.engine, count: errors.length })}
            </span>
          ) : null}
        </div>
        <ul className="latex-problem-list">
          {listed.length === 0 ? <li className="latex-muted">{panel === 'compile' && !compiled ? t('latex.problems.notCompiled') : t('latex.problems.none')}</li> : listed.map((issue, index) => (
            <li key={`${issue.code}:${issue.file ?? ''}:${issue.line ?? 0}:${index}`} className={`severity-${issue.severity}`}>
              {issue.severity === 'error' ? <XCircle size={13} /> : issue.severity === 'warning' ? <AlertTriangle size={13} /> : <Info size={13} />}
              <button type="button" className="latex-problem-text" disabled={!issue.file || Boolean(issue.params?.outside)} onClick={() => goToIssue(issue)}>
                <span>{issueText(t, issue)}</span>
                {issue.file ? <small>{issue.file}{issue.line ? `:${issue.line}` : ''}</small> : null}
              </button>
              {issue.fixable && issue.rule && issue.file === tab.path ? (
                <button type="button" className="toolbar-action-btn" onClick={() => void fix(issue.rule ?? '')}>
                  <Wand2 size={12} /><span>{t('latex.fix')}</span>
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <div className="code-editor-statusbar">
        <span>{tab.path}</span>
        <span className="statusbar-separator">|</span>
        <span>{t('latex.status.line', { line: cursor })}</span>
        {isSource ? (
          <>
            <span className="statusbar-separator">|</span>
            <span>{t('latex.status.words', { count: words })}</span>
          </>
        ) : null}
        {tab.dirty ? (
          <>
            <span className="statusbar-separator">|</span>
            <span className="statusbar-dirty">{t('workspace.unsaved')}</span>
          </>
        ) : null}
      </div>
    </div>
  )
}

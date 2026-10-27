import { Box, FileText, Folder, GitBranch, X } from 'lucide-react'
import { useMemo, useRef, useState, type ReactNode } from 'react'

import type { WorkbenchBridgeClient } from '../bridge/client'
import type { ContributionRegistry, InspectorPageContribution } from '../extensions/registry'
import type { InspectorTabId, WorkbenchState } from '../state/workbench-store'
import { ArtifactsInspectorPage } from './ArtifactsInspectorPage'
import { ChangesInspectorPage } from './ChangesInspectorPage'
import { ContextInspectorPage } from './ContextInspectorPage'
import { LogsInspectorPage } from './LogsInspectorPage'
import { TasksInspectorPage } from './TasksInspectorPage'
import { ResearchInspectorPage } from './ResearchInspectorPage'
import { useOptionalI18n } from '../i18n/I18nProvider'
import type { Locale } from '../i18n/locales'
import { localizeKnownStatus, type MessageKey } from '../i18n/messages'

const BUILTIN_TABS: readonly { id: InspectorTabId; key: MessageKey }[] = [
  { id: 'context', key: 'inspector.context' },
  { id: 'tasks', key: 'inspector.tasks' },
  { id: 'research', key: 'inspector.research' },
  { id: 'changes', key: 'workbench.changes' },
  { id: 'artifacts', key: 'inspector.artifacts' },
  { id: 'logs', key: 'inspector.logs' },
]

const BUILTIN_IDS = new Set(BUILTIN_TABS.map((tab) => `inspector.${tab.id}`))

const REFERENCE_TAB_IDS = ['reference-file', 'reference-resources', 'reference-results'] as const

function runtimeFact(state: WorkbenchState, locale: Locale, t: (key: MessageKey) => string): { label: string; tone: 'ready' | 'pending' | 'offline' } {
  if (state.runtime.stale) {
    return state.runtime.epoch === null
      ? { label: t('workbench.offline'), tone: 'offline' }
      : { label: t('workbench.resyncing'), tone: 'pending' }
  }
  if (state.runtime.ready && state.runtime.state === 'ready') return { label: t('inspector.reference.ready'), tone: 'ready' }
  const offline = ['offline', 'failed', 'stopped'].includes(state.runtime.state)
  return { label: localizeKnownStatus(locale, state.runtime.state), tone: offline ? 'offline' : 'pending' }
}

function ReferenceFileInspector({ state, tab }: { state: WorkbenchState; tab: typeof REFERENCE_TAB_IDS[number] }): ReactNode {
  const { locale, t } = useOptionalI18n()
  const workspacePath = typeof state.workspace?.path === 'string' && state.workspace.path.trim() ? state.workspace.path : null
  const branch = typeof state.workspace?.branch === 'string' && state.workspace.branch.trim() ? state.workspace.branch : null
  const runtime = runtimeFact(state, locale, t)
  if (tab === 'reference-resources') {
    return (
      <div className="reference-inspector-page">
        <div className="reference-inspector-placeholder"><Box size={42} strokeWidth={1.5} /><strong>{t('inspector.reference.relatedResources')}</strong><p>{t('inspector.reference.noFile')}</p></div>
      </div>
    )
  }
  if (tab === 'reference-results') {
    return (
      <div className="reference-inspector-page">
        <div className="reference-inspector-placeholder"><FileText size={42} strokeWidth={1.5} /><strong>{t('inspector.reference.runResults')}</strong><p>{t('workbench.noSessions')}</p></div>
      </div>
    )
  }
  return (
    <div className="reference-file-content">
      <div className="reference-empty-file">
        <FileText size={42} strokeWidth={1.5} aria-hidden="true" />
        <strong>{t('inspector.reference.noFile')}</strong>
        <p>{t('inspector.reference.noFileHelp')}</p>
      </div>
      <section className="reference-inspector-section">
        <h3>{t('inspector.reference.workspace')}</h3>
        <div className="reference-fact-row"><Folder size={18} aria-hidden="true" /><span><small>{t('inspector.reference.workspaceDirectory')}</small><strong title={workspacePath ?? undefined} data-empty={workspacePath ? undefined : 'true'}>{workspacePath ?? t('workspace.noSelected')}</strong></span></div>
        <div className="reference-fact-row"><GitBranch size={18} aria-hidden="true" /><span><small>{t('inspector.reference.currentBranch')}</small><strong data-empty={branch ? undefined : 'true'}>{branch ?? t('inspector.reference.noBranch')}</strong></span></div>
        <div className="reference-fact-row"><Box size={18} aria-hidden="true" /><span><small>{t('inspector.reference.runtime')}</small><strong><i className="reference-status-dot" data-tone={runtime.tone} aria-hidden="true" />{runtime.label}</strong></span></div>
      </section>
    </div>
  )
}

type InspectorRegistry = Pick<ContributionRegistry, 'getInspectorPages' | 'resolveArtifactViewer'>

interface InspectorProps {
  open: boolean
  reference?: boolean
  drawer?: boolean
  onClose: () => void
  state: WorkbenchState
  client?: WorkbenchBridgeClient
  registry?: InspectorRegistry
  drawerRef?: (element: HTMLElement | null) => void
}

export function Inspector({ open, reference = false, drawer = false, onClose, state, client, registry, drawerRef }: InspectorProps) {
  const { locale, t } = useOptionalI18n()
  const [active, setActive] = useState<string>('context')
  const tabsRef = useRef<Array<HTMLButtonElement | null>>([])
  const contributions = registry?.getInspectorPages() ?? []
  const referenceEmpty = Boolean(reference && state.timeline.length === 0 && state.selectedSession?.mode !== 'research' && contributions.length === 0)
  const tabs = useMemo(() => referenceEmpty
    ? [
      { id: 'reference-file', label: t('inspector.reference.currentFile') },
      { id: 'reference-resources', label: t('inspector.reference.relatedResources') },
      { id: 'reference-results', label: t('inspector.reference.runResults') },
    ]
    : [
      ...BUILTIN_TABS.map((tab) => ({ id: tab.id, label: t(tab.key) })),
      ...contributions
        .filter((page) => !BUILTIN_IDS.has(page.id))
        .map((page) => ({ id: page.id, label: page.title })),
    ], [contributions, referenceEmpty, t])
  const activeTabId = tabs.some((tab) => tab.id === active) ? active : tabs[0]?.id ?? 'context'
  const lastUserPrompt = [...state.timeline]
    .reverse()
    .find((item) => item.type === 'message.created' && item.role === 'user' && item.text.trim())
    ?.text.trim()
  const retryContextWithoutImage = client && typeof client.startTurn === 'function'
    ? async (digest: string): Promise<void> => {
      await client.startTurn(
        lastUserPrompt ?? 'Retry the previous task with the selected image excluded.',
        [],
        [digest],
      )
    }
    : undefined
  const researchSessionId = typeof state.selectedSession?.id === 'string' ? state.selectedSession.id : null
  const researchSignal = [...state.operational.logs].reverse().find((entry) =>
    entry.sessionId === state.selectedSession?.id &&
    (entry.type === 'research.source.saved' || entry.type === 'research.citation.added'),
  )?.sequence ?? 0
  const defaults: Record<InspectorTabId, ReactNode> = {
    context: (
      <ContextInspectorPage
        state={state}
        client={client}
        onExcludeAttachment={retryContextWithoutImage}
      />
    ),
    tasks: <TasksInspectorPage state={state} client={client} />,
    research: <ResearchInspectorPage key={`${state.runtime.epoch}:${researchSessionId ?? ''}`} sessionId={researchSessionId} client={client} refreshSignal={`${state.runtime.activeTurn ?? ''}:${researchSignal}`} />,
    changes: <ChangesInspectorPage state={state} />,
    artifacts: <ArtifactsInspectorPage state={state} registry={registry} />,
    logs: <LogsInspectorPage state={state} />,
  }
  const referenceTab = REFERENCE_TAB_IDS.includes(activeTabId as typeof REFERENCE_TAB_IDS[number])
    ? activeTabId as typeof REFERENCE_TAB_IDS[number]
    : null
  const builtin = BUILTIN_TABS.find((tab) => tab.id === activeTabId)
  const contribution = contributions.find((page) =>
    page.id === (builtin ? `inspector.${activeTabId}` : activeTabId),
  )
  let content = referenceTab
    ? <ReferenceFileInspector state={state} tab={referenceTab} />
    : builtin ? defaults[builtin.id] : null
  if (contribution) {
    try {
      content = contribution.render() as ReactNode
    } catch {
      content = <p role="status">{t('inspector.pageUnavailable')}</p>
    }
  }
  const activate = (index: number): void => {
    const next = tabs[index]
    if (!next) return
    setActive(next.id)
    tabsRef.current[index]?.focus()
  }
  const selectedIndex = Math.max(0, tabs.findIndex((tab) => tab.id === activeTabId))
  const selected = tabs[selectedIndex]
  const selectedTabId = `inspector-tab-${selected.id.replaceAll('.', '-')}`
  const hidden = !open
  const autonomyLabel = state.runtime.autonomy === 'yolo'
    ? t('settings.autonomy.yolo')
    : state.runtime.autonomy === 'full_access'
      ? t('settings.autonomy.fullAccess')
    : state.runtime.autonomy === 'workspace'
      ? t('settings.autonomy.workspace')
      : state.runtime.autonomy === 'ask'
        ? t('settings.autonomy.ask')
        : localizeKnownStatus(locale, state.runtime.autonomy)
  const runtimeLabel = localizeKnownStatus(
    locale,
    state.runtime.ready ? 'ready' : state.runtime.state,
  )

  return (
    <aside
      ref={drawerRef}
      className="inspector glass-surface"
      aria-label={t('inspector.title')}
      data-open={open ? 'true' : 'false'}
      data-reference-empty={referenceEmpty ? 'true' : 'false'}
      aria-hidden={hidden || undefined}
      role={drawer ? 'dialog' : 'complementary'}
      aria-modal={drawer && open ? 'true' : undefined}
      tabIndex={drawer ? -1 : undefined}
    >
      <header className="panel-header inspector-heading">
        <div><p className="section-kicker">{t('inspector.title')}</p><h2>{referenceEmpty ? t('inspector.context') : selected.label}</h2></div>
        <div className="panel-actions">
          {Object.keys(state.approvals).length > 0 ? <span className="count-badge" title={t('approval.title')}>{Object.keys(state.approvals).length}</span> : null}
          <button type="button" className={referenceEmpty ? 'icon-button drawer-close reference-inspector-close' : 'icon-button drawer-close'} data-drawer-initial-focus aria-label={t('inspector.close')} title={t('inspector.close')} onClick={onClose}><X size={16} /></button>
        </div>
      </header>
      <div className="inspector-summary-strip" data-testid="inspector-summary-strip">
        <div className="inspector-summary-cell"><span>{t('inspector.summaryStatus')}</span><strong>{runtimeLabel}</strong></div>
        <div className="inspector-summary-cell"><span>{t('inspector.summaryAutonomy')}</span><strong>{autonomyLabel}</strong></div>
        <div className="inspector-summary-cell"><span>{t('inspector.summaryEvents')}</span><strong>{state.timeline.length}</strong></div>
      </div>
      <div className="inspector-tabs" role="tablist" aria-label={t('inspector.pages')}>
        {tabs.map((tab, index) => {
          const tabId = `inspector-tab-${tab.id.replaceAll('.', '-')}`
          return <button
            id={tabId}
            ref={(element) => { tabsRef.current[index] = element }}
            type="button"
            role="tab"
            key={tab.id}
            aria-controls="inspector-tabpanel"
            aria-selected={tab.id === activeTabId}
            tabIndex={tab.id === activeTabId ? 0 : -1}
            title={tab.label}
            onClick={() => activate(index)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowRight') { event.preventDefault(); activate((index + 1) % tabs.length) }
              else if (event.key === 'ArrowLeft') { event.preventDefault(); activate((index - 1 + tabs.length) % tabs.length) }
              else if (event.key === 'Home') { event.preventDefault(); activate(0) }
              else if (event.key === 'End') { event.preventDefault(); activate(tabs.length - 1) }
              else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate(index) }
            }}
          >{tab.label}</button>
        })}
      </div>
      <div
        id="inspector-tabpanel"
        className="inspector-content reading-surface"
        role="tabpanel"
        aria-labelledby={selectedTabId}
        aria-label={t('inspector.page', { label: selected.label })}
      >{content}</div>
    </aside>
  )
}

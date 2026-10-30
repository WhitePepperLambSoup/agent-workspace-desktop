import {
  Activity,
  Armchair,
  BookOpen,
  Bot,
  CalendarClock,
  Code2,
  ChevronDown,
  Circle,
  Clock3,
  Command,
  Database,
  Files,
  Folder,
  GitBranch,
  GitCompare,
  Image as ImageIcon,
  FolderOpen,
  MessageSquare,
  Minus,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Search,
  Settings,
  Sparkles,
  Square,
  Workflow,
  X,
} from 'lucide-react'
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'

import type { WindowAction } from '../../../shared/window'
import type { JsonValue } from '../../../shared/protocol'
import { Composer, type AttachmentCapability, type CostEstimate, type SlashCommand } from '../composer/Composer'
import { readPromptOptimizationSelection } from '../composer/promptOptimization'
import { attachmentErrorMessage, mergeAttachmentCapabilities, readAttachmentFiles } from '../composer/attachments'
import { ComposerDraftStore, composerDraftScope } from '../state/composer-drafts'
import type { AppearanceState } from '../design/appearance'
import { resolveAppearance } from '../design/appearance'
import { LiquidBackdrop } from '../effects/LiquidBackdrop'
import { LiquidGlassSurfaces } from '../effects/liquid-glass/LiquidGlassSurfaces'
import { GatewayCommandError, type WorkbenchBridgeClient } from '../bridge/client'
import { CommandPalette } from '../commands/CommandPalette'
import { createContributionRegistry, type ContributionRegistry } from '../extensions/registry'
import { Inspector } from '../inspector/Inspector'
import { useOptionalI18n, useProvidedI18n, useText } from '../i18n/I18nProvider'
import type { I18nValue } from '../i18n/I18nProvider'
import { type Locale } from '../i18n/locales'
import { localizeKnownStatus, translate } from '../i18n/messages'
import type { MessageKey } from '../i18n/messages'
import type { ResourceCapability } from '../markdown/resource-policy'
import { createWorkbenchStore, type WorkbenchState } from '../state/workbench-store'
import { filterCanonicalStreams } from '../state/projection-parsers'
import { ApprovalShelf } from '../timeline/ApprovalShelf'
import { SubagentStrip } from '../timeline/SubagentStrip'
import { DeviceNotices } from '../devices/DeviceNotices'
import { PhoneJobStrip } from '../devices/PhoneJobStrip'
import { useSendToPhone } from '../devices/SendToPhone'
import { TimelineActionsContext, type TimelineActions } from '../timeline/actions-context'
import { RewindDialog, rewindFilesFrom, type RewindFile } from '../timeline/RewindDialog'
import { parseUndo } from '../files/model'
import { requestRunFocus } from '../runs/focus-run'
import { CompareModelDialog, ComparisonSheet, comparisonFrom } from '../timeline/CompareDialogs'
import { ConversationTimeline } from '../timeline/ConversationTimeline'
import type { NoticeActions } from '../timeline/NoticeRow'
import type { ApprovalItem, NoticeEntry, TimelineEntry, TurnFile } from '../timeline/types'
import { CHECKS_MARKER, parseUserAttachmentReferences, SPEC_MARKER } from '../timeline/user-attachments'
import { TimelineWorkspaceContext } from '../timeline/workspace-context'
import { activityVisible, readInterfaceMode, writeInterfaceMode, type InterfaceMode } from './interface-mode'
import { DOCUMENT_PREVIEW_EVENT, type DocumentPreviewRequest } from '../office/preview-request'
import { OPEN_IN_EDITOR_EVENT, PREVIEW_EVENT, requestPreview, type PreviewRequest } from '../preview/preview-request'
import { RouteLoading, RouteOutlet, type ActivityRoute } from './RouteOutlet'
import { LazySettingsRoute, preloadRoutes } from './lazy-routes'
import { confirmAutonomyChange } from '../settings/autonomy'
import { SessionSidebar } from '../workspace/SessionSidebar'
import { droppedFolderPath } from '../workspace/folder-drop'
import { useAttentionNotifications } from '../notifications/attention'
import { useVoicePreference } from '../voice/voice'
import { QuickActions } from '../office/QuickActions'
import { shortcutFromEvent, useShortcuts } from '../shortcuts/keymap'
import { useDrawerController } from './useDrawerController'

type ActivityId = 'agent' | 'studio' | 'runs' | 'workspace' | 'knowledge' | 'schedules' | 'search' | 'changes' | 'jobs' | 'operations' | 'settings'
type Autonomy = 'ask' | 'workspace' | 'yolo' | 'full_access'

interface WorkbenchProps {
  appearance: AppearanceState
  nativeStatus?: string
  onAppearanceChange: (appearance: AppearanceState) => void
  client?: WorkbenchBridgeClient
  registry?: ContributionRegistry
  settingsI18n?: I18nValue
}

const fallbackStore = createWorkbenchStore()
// The Office preview loads when a file is first previewed.
const OfficePreviewDialog = lazy(() => import('../office/OfficePreview').then((module) => ({ default: module.OfficePreviewDialog })))
// So does the preview of pages, files and changes.
const PreviewSheet = lazy(() => import('../preview/PreviewSheet').then((module) => ({ default: module.PreviewSheet })))
function useRuntimeState(client: WorkbenchProps['client']): WorkbenchState {
  return useSyncExternalStore(
    (listener) => (client?.store ?? fallbackStore).subscribe(() => listener()),
    () => (client?.store ?? fallbackStore).getState(),
    () => fallbackStore.getState(),
  )
}

function stringFact(value: unknown, fallback: string): string {
  return typeof value === 'string' && value ? value : fallback
}

function providerVisionState(provider: Record<string, JsonValue> | null): boolean | null {
  if (!provider) return null
  const capabilities = provider.capabilities
  if (capabilities && typeof capabilities === 'object' && !Array.isArray(capabilities)) {
    const vision = (capabilities as Record<string, JsonValue>).vision
    if (typeof vision === 'boolean') return vision
  }
  const providerId = typeof provider.id === 'string' ? provider.id.toLowerCase() : ''
  const model = typeof provider.model === 'string' ? provider.model.toLowerCase() : ''
  return providerId === 'deepseek' && (model.includes('flash') || model.includes('v4.1')) ? true : null
}

const TURN_FILE_CHANGES = new Set(['created', 'modified', 'deleted', 'moved'])

function turnFiles(value: JsonValue | undefined): TurnFile[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item): TurnFile[] => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return []
    const { path, change, by, to, bytes, undoable } = item as Record<string, JsonValue>
    if (typeof path !== 'string' || typeof change !== 'string' || !TURN_FILE_CHANGES.has(change)) return []
    return [{
      path,
      change: change as TurnFile['change'],
      by: by === 'agent' ? 'agent' : 'other',
      ...(typeof to === 'string' ? { to } : {}),
      ...(typeof bytes === 'number' ? { bytes } : {}),
      ...(undoable === true && by === 'agent' ? { undoable: true } : {}),
    }]
  })
}

function timelineEntries(timeline: WorkbenchState['timeline'], tx: (text: string) => string): TimelineEntry[] {
  const entries: TimelineEntry[] = []
  // Files put back since a turn, by its change list.
  const undone = new Map<string, string[]>()
  for (const item of timeline) {
    if (item.type !== 'turn.files.undone') continue
    const listId = stringFact(item.data.changesEventId, '')
    const paths = Array.isArray(item.data.paths) ? item.data.paths.filter((path): path is string => typeof path === 'string') : []
    if (listId) undone.set(listId, [...(undone.get(listId) ?? []), ...paths])
  }
  for (const item of filterCanonicalStreams(timeline)) {
    if (item.type === 'turn.files.changed') {
      const files = turnFiles(item.data.files)
      if (files.length > 0) {
        entries.push({
          id: item.id,
          type: 'files',
          files,
          omitted: typeof item.data.omitted === 'number' ? item.data.omitted : 0,
          listed: item.data.listed === true,
          undone: undone.get(item.id) ?? [],
        })
      }
      continue
    }
    if (item.type.startsWith('tool.')) {
      entries.push({
        id: item.id,
        type: 'tool',
        name: stringFact(item.data.toolName ?? item.data.tool_name ?? item.data.name, tx('Tool')),
        state: stringFact(item.data.state, item.type.slice('tool.'.length)),
        arguments: item.data.arguments,
        result: item.data.result,
        attemptId: stringFact(item.data.attemptId ?? item.data.attempt_id, '') || undefined,
      })
      continue
    }
    if (item.type === 'turn.failed') {
      entries.push({
        id: item.id,
        type: 'notice',
        kind: 'failed',
        errorType: stringFact(item.data.errorType, '') || undefined,
        message: stringFact(item.data.message, '') || undefined,
      })
      continue
    }
    if (item.type === 'session.forked') {
      entries.push({
        id: item.id,
        type: 'notice',
        kind: 'forked',
        sourceSessionId: stringFact(item.data.sourceSessionId, '') || undefined,
        sourceModel: stringFact(item.data.sourceModel, '') || undefined,
        compareModel: stringFact(item.data.compareModel, '') || undefined,
      })
      continue
    }
    if (!['message.created', 'model.output.delta', 'model.completed'].includes(item.type) || !item.text) continue
    if (item.type === 'message.created' && item.data.role === 'tool') continue

    const resources = Array.isArray(item.data.resources)
      ? item.data.resources.slice(0, 64).flatMap((value): ResourceCapability[] => {
          if (!value || typeof value !== 'object' || Array.isArray(value)) return []
          const id = typeof value.id === 'string' ? value.id : null
          const url = typeof value.url === 'string' ? value.url : null
          return id && url ? [{ id, url }] : []
        })
      : undefined
    const role = item.role ?? (item.stream === 'reasoning' ? 'reasoning' : item.type === 'message.created' ? 'user' : 'assistant')
    const origin = role === 'user' ? phoneOrigin(item.data.origin) : null
    entries.push({
      id: item.id,
      type: 'message',
      role,
      text: item.text,
      open: item.open,
      resources,
      ...(role === 'user' && item.type === 'message.created'
        ? { forkable: item.data.inputId === undefined && item.data.inputState === undefined && !item.id.startsWith('wire-') }
        : {}),
      ...(origin ? { origin } : {}),
    })
  }
  return entries
}

/** Where a phone's message came from, as the gateway marks it (device link 2). */
function phoneOrigin(value: JsonValue | undefined): { device: string; labels: string[] } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const labels = Array.isArray(value.labels) ? value.labels.filter((label): label is string => typeof label === 'string') : []
  return { device: typeof value.device === 'string' ? value.device : '', labels }
}

function approvalEntries(state: WorkbenchState, tx: (text: string) => string): ApprovalItem[] {
  return Object.entries(state.approvals)
    .filter(([, approval]) => approval.sessionId == null || approval.sessionId === state.selectedSession?.id)
    .map(([requestId, approval]) => ({
      requestId,
      title: stringFact(approval.toolName ?? approval.tool ?? approval.name, tx('Approval required')),
      detail: stringFact(approval.summary ?? approval.reason, tx('Review the requested action')),
      supportsSessionScope: approval.supportsSessionScope === true,
      ...(typeof approval.subagent === 'string' && approval.subagent ? { subagent: approval.subagent } : {}),
      ...approvalPlan(approval.plan, approval.planTotal),
    }))
}

function approvalPlan(value: JsonValue | undefined, total: JsonValue | undefined): Pick<ApprovalItem, 'plan' | 'planTotal'> {
  if (!Array.isArray(value)) return {}
  const plan = value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return []
    const { action, path, to } = item as Record<string, JsonValue>
    if (typeof action !== 'string' || typeof path !== 'string') return []
    return [typeof to === 'string' ? { action, path, to } : { action, path }]
  })
  return plan.length ? { plan, planTotal: typeof total === 'number' ? total : plan.length } : {}
}

const ACTIVITIES: readonly {
  id: ActivityId
  label: string
  icon: typeof Bot
}[] = [
  { id: 'agent', label: 'Agent', icon: Bot },
  { id: 'studio', label: 'Studio', icon: Armchair },
  { id: 'runs', label: 'Agent runs', icon: Workflow },
  { id: 'workspace', label: 'Workspace', icon: Files },
  { id: 'knowledge', label: 'Knowledge', icon: BookOpen },
  { id: 'schedules', label: 'Scheduled tasks', icon: CalendarClock },
  { id: 'search', label: 'Search', icon: Search },
  { id: 'changes', label: 'Changes', icon: GitCompare },
  { id: 'jobs', label: 'Background jobs', icon: Clock3 },
  { id: 'operations', label: 'Operations', icon: Activity },
  { id: 'settings', label: 'Settings', icon: Settings },
]

const REFERENCE_RAIL_ACTIVITIES: readonly {
  id: ActivityId
  label: string
  icon: typeof Bot
}[] = [
  { id: 'agent', label: 'Agent', icon: MessageSquare },
  { id: 'studio', label: 'Studio', icon: Armchair },
  { id: 'runs', label: 'Agent runs', icon: Workflow },
  { id: 'workspace', label: 'Workspace', icon: Folder },
  { id: 'knowledge', label: 'Knowledge', icon: BookOpen },
  { id: 'schedules', label: 'Scheduled tasks', icon: CalendarClock },
  { id: 'changes', label: 'Changes', icon: Code2 },
  { id: 'jobs', label: 'Background jobs', icon: Database },
  { id: 'operations', label: 'Operations', icon: Activity },
  { id: 'search', label: 'Search', icon: Search },
]

function isReferenceLanding(state: WorkbenchState, reference: boolean): boolean {
  const hasPersistedSession = [state.selectedSession, ...state.sessions].some(
    (session) => typeof session?.workspace === 'string' && session.workspace.trim() !== '',
  )
  return reference && state.timeline.length === 0 && state.sessions.length <= 1 && !hasPersistedSession
}

export function settingsLayoutForViewport(width: number): 'stacked' | 'split' {
  return width <= 1100 ? 'stacked' : 'split'
}

function TitleStrip({ onWindowAction, onCommand, onToggleInspector, inspectorOpen, showInspectorToggle, state, onAutonomyChange, onOpenWorkspace, onOpenWorkspacePath, onOpenControlCenter }: {
  onWindowAction: (action: WindowAction) => void
  onCommand: (opener: HTMLButtonElement) => void
  onToggleInspector: (opener: HTMLButtonElement) => void
  inspectorOpen: boolean
  showInspectorToggle: boolean
  state: WorkbenchState
  onAutonomyChange?: (autonomy: Autonomy) => Promise<unknown>
  onOpenWorkspace?: () => Promise<unknown>
  onOpenWorkspacePath?: (path: string) => Promise<unknown>
  onOpenControlCenter?: () => void
}) {
  const tx = useText()
  const { locale } = useOptionalI18n()
  const workspaceName = stringFact(state.workspace?.name, tx('No workspace'))
  const provider = stringFact(state.provider?.id, tx('Provider'))
  const model = stringFact(state.provider?.model, tx('Model unavailable'))
  // A stale store that never received an epoch has no runtime to resync with.
  const status = state.runtime.stale
    ? tx(state.runtime.epoch === null ? 'Offline' : 'Resyncing')
    : localizeKnownStatus(locale, stringFact(state.runtime.state, state.runtime.ready ? 'ready' : 'offline'))
  const providerConnection = stringFact(state.provider?.connectionStatus, '')
  const autonomy = (['ask', 'workspace', 'yolo', 'full_access'].includes(state.runtime.autonomy)
    ? state.runtime.autonomy
    : 'workspace') as Autonomy
  const [changingAutonomy, setChangingAutonomy] = useState(false)
  const [autonomyError, setAutonomyError] = useState(false)
  const [openingWorkspace, setOpeningWorkspace] = useState(false)
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false)
  const workspaceMenuRef = useRef<HTMLDivElement>(null)
  const workspaceButtonRef = useRef<HTMLButtonElement>(null)
  const recentWorkspaces = (state.recentWorkspaces ?? []).filter((workspace) => workspace.path !== state.workspace?.path)
  const workspaceSwitching = state.runtime.state === 'switching' || openingWorkspace

  useEffect(() => {
    if (!workspaceMenuOpen) return
    const onPointerDown = (event: PointerEvent): void => {
      if (!workspaceMenuRef.current?.contains(event.target as Node)) setWorkspaceMenuOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setWorkspaceMenuOpen(false)
      workspaceButtonRef.current?.focus()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [workspaceMenuOpen])

  const openWorkspacePicker = (): void => {
    if (!onOpenWorkspace || workspaceSwitching) return
    setWorkspaceMenuOpen(false)
    setOpeningWorkspace(true)
    void onOpenWorkspace().finally(() => setOpeningWorkspace(false))
  }

  const openRecentWorkspace = (path: string): void => {
    if (!onOpenWorkspacePath || workspaceSwitching) return
    setWorkspaceMenuOpen(false)
    setOpeningWorkspace(true)
    void onOpenWorkspacePath(path).finally(() => setOpeningWorkspace(false))
  }

  return (
    <header className="title-strip glass-surface" aria-label={tx('Title bar')}>
      <div className="title-drag-region">
        <div className="product-mark" aria-hidden="true"><Sparkles size={19} strokeWidth={1.9} /></div>
        <div className="title-identity">
          <strong>{tx('Agent Workspace')}</strong>
          <span className="title-context">{tx('Local agent control center')}</span>
        </div>
      </div>
      <div className="runtime-facts" aria-label={tx('Runtime status')}>
        <span className="runtime-chip runtime-provider-chip"><span className="runtime-chip-label">LLM</span><strong>{provider}</strong></span>
        <span className="runtime-chip runtime-model-chip"><span className="runtime-chip-label">{tx('Model')}</span><strong>{model}</strong></span>
        <span className="runtime-chip runtime-mode-chip"><span className="runtime-chip-label">{tx('Mode')}</span><strong>{localizeKnownStatus(locale, state.runtime.mode)}</strong></span>
        <label className="autonomy-control" title={tx('Autonomy policy')}>
          <span className="runtime-chip-label">{tx('Autonomy')}</span>
          <select
            aria-label={tx('Autonomy policy')}
            value={state.runtime.pendingAutonomy ?? autonomy}
            disabled={!onAutonomyChange || !state.selectedSession || state.runtime.activeTurn !== null || state.runtime.state === 'switching' || changingAutonomy}
            onChange={(event) => {
              const next = event.currentTarget.value as Autonomy
              const confirmation = next === 'full_access'
                ? tx('Full access lets the agent use host processes, network access, sensitive files, and workspace changes without routine approval prompts. Hard input validation and audit logging remain active. Continue?')
                : tx('YOLO runs supported actions without routine prompts. Workspace boundaries and hard safety limits still apply. Continue?')
              if (!confirmAutonomyChange(next, confirmation)) return
              setChangingAutonomy(true)
              setAutonomyError(false)
              void onAutonomyChange?.(next)
                .catch(() => setAutonomyError(true))
                .finally(() => setChangingAutonomy(false))
            }}
          >
            <option value="ask">{tx('Ask')}</option>
            <option value="workspace">{tx('Workspace')}</option>
            <option value="yolo">YOLO</option>
            <option value="full_access">{tx('Full access')}</option>
          </select>
          {autonomyError ? <span className="visually-hidden" role="status">{tx('Unable to change autonomy policy')}</span> : null}
        </label>
        <span className={state.runtime.ready ? 'runtime-ready runtime-status-chip' : 'runtime-warning runtime-status-chip'}><Circle size={7} fill="currentColor" />{status}</span>
        {providerConnection === 'connected' || providerConnection === 'failed' ? (
          <span className={providerConnection === 'connected' ? 'runtime-provider-connected runtime-status-chip' : 'runtime-provider-failed runtime-status-chip'}>
            <Circle size={7} fill="currentColor" />
            {tx(providerConnection === 'connected' ? 'Provider connected' : 'Provider test failed')}
          </span>
        ) : null}
      </div>
      <div className="title-actions">
        <div className="reference-workspace-control" ref={workspaceMenuRef}>
          <button
            ref={workspaceButtonRef}
            className="title-nav-button reference-workspace-button"
            type="button"
            title={tx('Workspace')}
            aria-label={`${tx('Open workspace')}${state.workspace ? `: ${workspaceName}` : ''}`}
            aria-haspopup={recentWorkspaces.length > 0 ? 'menu' : undefined}
            aria-expanded={recentWorkspaces.length > 0 ? workspaceMenuOpen : undefined}
            disabled={!onOpenWorkspace || workspaceSwitching}
            onClick={() => {
              if (!onOpenWorkspace || workspaceSwitching) return
              if (recentWorkspaces.length === 0) openWorkspacePicker()
              else setWorkspaceMenuOpen((open) => !open)
            }}
          >
            <FolderOpen size={16} />
            <span>{tx('Workspace')}</span>
            <ChevronDown size={13} />
          </button>
          {workspaceMenuOpen && recentWorkspaces.length > 0 ? (
            <div className="workspace-menu" role="menu" aria-label={translate(locale, 'workspace.recent')}>
              <div className="workspace-menu-heading">{translate(locale, 'workspace.recent')}</div>
              {recentWorkspaces.slice(0, 8).map((workspace) => (
                <button
                  key={workspace.path}
                  className="workspace-menu-item"
                  type="button"
                  role="menuitem"
                  title={workspace.path}
                  aria-label={translate(locale, 'workspace.openRecent', { name: workspace.name })}
                  onClick={() => openRecentWorkspace(workspace.path)}
                >
                  <Folder size={13} />
                  <span className="workspace-menu-item-copy"><strong>{workspace.name}</strong><small>{workspace.path}</small></span>
                </button>
              ))}
              <div className="workspace-menu-divider" />
              <button className="workspace-menu-item workspace-menu-picker" type="button" role="menuitem" onClick={openWorkspacePicker}>
                <Folder size={13} />
                <span>{translate(locale, 'workspace.chooseFolder')}</span>
              </button>
            </div>
          ) : null}
        </div>
        {onOpenControlCenter ? <button
          className="title-nav-button reference-control-center-button"
          type="button"
          title={tx('Control center')}
          aria-label={tx('Control center')}
          onClick={() => onOpenControlCenter()}
        >
          <Workflow size={16} />
          <span>{tx('Control center')}</span>
        </button> : null}
        <button className="command-trigger" type="button" title={tx('Command palette')} aria-label={tx('Command palette')} onClick={(event) => onCommand(event.currentTarget)}>
          <Command size={14} />
          <span>{tx('Commands')}</span>
          <kbd>Ctrl K</kbd>
        </button>
      </div>
      {showInspectorToggle ? (
        <button className="title-icon-button" type="button" title={tx(inspectorOpen ? 'Collapse Inspector' : 'Open Inspector')} aria-label={tx(inspectorOpen ? 'Collapse Inspector' : 'Open Inspector')} onClick={(event) => onToggleInspector(event.currentTarget)}>{inspectorOpen ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />}</button>
      ) : null}
      <div className="window-controls" aria-label={tx('Window controls')}>
        <button type="button" aria-label={tx('Minimize')} title={tx('Minimize')} onClick={() => onWindowAction('minimize')}><Minus size={14} /></button>
        <button type="button" aria-label={tx('Maximize')} title={tx('Maximize')} onClick={() => onWindowAction('maximize')}><Square size={15} strokeWidth={1.8} /></button>
        <button type="button" aria-label={tx('Close')} title={tx('Close')} onClick={() => onWindowAction('close')}><X size={15} /></button>
      </div>
    </header>
  )
}

function ActivityRail({ active, onSelect, onToggleSessions, sessionsOpen, sessionsToggleLabel, settingsLabel, settingsShortcutLabel, mode, unreadLabel }: { active: ActivityId; onSelect: (id: ActivityId) => void; onToggleSessions: (opener: HTMLButtonElement) => void; sessionsOpen: boolean; sessionsToggleLabel: string; settingsLabel: string; settingsShortcutLabel: string; mode: InterfaceMode; unreadLabel: string | null }) {
  const tx = useText()
  return (
    <nav className="activity-rail glass-surface" aria-label={tx('Activity')}>
      <div className="activity-primary">
        <button
          className="activity-sidebar-toggle"
          type="button"
          aria-label={sessionsToggleLabel}
          title={sessionsToggleLabel}
          aria-controls="session-sidebar"
          aria-expanded={sessionsOpen}
          onClick={(event) => onToggleSessions(event.currentTarget)}
        >
          {sessionsOpen ? <PanelLeftClose size={19} strokeWidth={1.7} /> : <PanelLeftOpen size={19} strokeWidth={1.7} />}
        </button>
        {REFERENCE_RAIL_ACTIVITIES.filter(({ id }) => activityVisible(mode, id)).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            aria-label={id === 'settings' ? settingsLabel : tx(label)}
            aria-pressed={active === id}
            aria-description={id === 'schedules' && unreadLabel ? unreadLabel : undefined}
            title={id === 'settings' ? settingsLabel : tx(label)}
            onClick={() => onSelect(id)}
          >
            <Icon size={19} strokeWidth={1.7} />
            {id === 'schedules' && unreadLabel ? <span className="activity-badge" aria-hidden="true" /> : null}
          </button>
        ))}
      </div>
      <button
        className="activity-account"
        type="button"
        aria-label={settingsLabel}
        aria-pressed={active === 'settings'}
        title={settingsShortcutLabel}
        onClick={() => onSelect('settings')}
      >
        <Settings size={22} strokeWidth={1.7} />
      </button>
    </nav>
  )
}

export function getComposerReadiness(
  state: WorkbenchState,
  tx: (text: string) => string,
): { canSubmit: boolean; reason: string | null } {
  if (state.runtime.state === 'offline') {
    return { canSubmit: false, reason: tx('Runtime is offline') }
  }
  if (!state.workspace) {
    return { canSubmit: false, reason: tx('Workspace not selected') }
  }
  if (!state.provider) {
    return { canSubmit: false, reason: tx('Provider not configured') }
  }
  if (!state.selectedSession) {
    return { canSubmit: false, reason: tx('No sessions') }
  }
  if (state.runtime.state === 'awaiting_extension_approval') {
    return { canSubmit: false, reason: tx('Awaiting extension approval') }
  }
  if (state.runtime.state === 'awaiting_approval') {
    if (state.runtime.activeTurn && state.runtime.hostSessionId === String(state.selectedSession.id) && !state.runtime.stale) {
      return { canSubmit: true, reason: null }
    }
    return { canSubmit: false, reason: tx('Awaiting approval') }
  }
  if (state.runtime.state === 'starting') {
    return { canSubmit: false, reason: tx('Runtime is starting...') }
  }
  if (state.runtime.state === 'failed') {
    return { canSubmit: false, reason: tx('Runtime failed to start') }
  }
  if (state.runtime.state === 'stopped' || state.runtime.state === 'stopping') {
    return { canSubmit: false, reason: tx('Runtime is stopped') }
  }
  if (state.runtime.stale) {
    return { canSubmit: false, reason: tx('Resyncing') }
  }
  if (state.runtime.hostSessionId !== String(state.selectedSession.id)) {
    return { canSubmit: false, reason: tx('Loading conversation...') }
  }
  if (!state.runtime.ready || state.runtime.state !== 'ready') {
    return { canSubmit: false, reason: tx('Runtime not ready') }
  }
  return { canSubmit: true, reason: null }
}

function ConversationSurface({
  onOpenSessions,
  onOpenInspector,
  onCreateSession,
  onOpenRuns,
  onNavigate,
  routeVisible,
  state,
  client,
  registry,
  reference = false,
}: {
  onOpenSessions: (opener: HTMLButtonElement) => void
  onOpenInspector: (opener: HTMLButtonElement) => void
  onCreateSession?: () => Promise<unknown>
  onOpenRuns?: () => void
  onNavigate?: (activity: ActivityId) => void
  routeVisible?: (activity: ActivityId) => boolean
  state: WorkbenchState
  client?: WorkbenchProps['client']
  registry: ContributionRegistry
  reference?: boolean
}) {
  const tx = useText()
  const { locale } = useOptionalI18n()
  const [localDrafts] = useState(() => new ComposerDraftStore())
  const drafts = client?.composerDrafts ?? localDrafts
  const [actionError, setActionError] = useState<MessageKey | null>(null)
  const [creatingSession, setCreatingSession] = useState(false)
  const [suggestedPrompt, setSuggestedPrompt] = useState<string | null>(null)
  const [compareMessageId, setCompareMessageId] = useState<string | null>(null)
  const [comparisonSessionId, setComparisonSessionId] = useState<string | null>(null)
  const [rewindMessageId, setRewindMessageId] = useState<string | null>(null)
  const rewindFor = useCallback((sessionId: string, messageId: string) => async (apply: boolean): Promise<RewindFile[]> => {
    if (!client) throw new Error('runtime_unavailable')
    const response = await client.rewindFiles(sessionId, messageId, apply)
    if (response.type !== 'session.rewind.result') throw new Error('rewind_unavailable')
    return rewindFilesFrom(response.payload)
  }, [client])
  const [forking, setForking] = useState(false)
  const attachmentScopeRef = useRef('')
  const entries = useMemo(() => timelineEntries(state.timeline, tx), [state.timeline, tx])
  const approvals = approvalEntries(state, tx)
  const timelineSessionId = typeof state.selectedSession?.id === 'string' ? state.selectedSession.id : null
  const timelineActions = useMemo<TimelineActions>(() => ({
    ...(client && typeof client.undoFileBatch === 'function' ? {
      undoFileBatch: async (batchId: string) => {
        const outcome = parseUndo((await client.undoFileBatch(batchId)).payload)
        if (!outcome) throw new Error('undo_unavailable')
        return outcome
      },
    } : {}),
    ...(client && typeof client.undoTurnFiles === 'function' && timelineSessionId ? {
      sessionId: timelineSessionId,
      undoTurnFiles: async (eventId: string, paths: readonly string[] | null) => {
        const response = await client.undoTurnFiles(timelineSessionId, eventId, paths, true)
        if (response.type !== 'turn.files.undo.result') throw new Error('undo_unavailable')
        return rewindFilesFrom(response.payload).map((file) => ({ path: file.path, reason: file.reason }))
      },
    } : {}),
  }), [client, timelineSessionId])
  const subagentSessionId = typeof state.selectedSession?.id === 'string' ? state.selectedSession.id : null
  const phoneJobs = useMemo(
    () => Object.values(state.phoneJobs ?? {}).filter((item) => item.sessionId === subagentSessionId),
    [state.phoneJobs, subagentSessionId],
  )
  const phoneSend = useSendToPhone(client)
  const subagents = useMemo(
    () => Object.values(state.subagents ?? {}).filter((item) => item.sessionId === subagentSessionId),
    [state.subagents, subagentSessionId],
  )
  const readiness = getComposerReadiness(state, tx)
  const referenceFallback = isReferenceLanding(state, reference)
  const composerProviderLabel = stringFact(state.provider?.model, '') || null
  const composerReady = readiness.canSubmit
  const sessionTitle = stringFact(state.selectedSession?.title, tx('New session'))
  const selectedSessionId = stringFact(state.selectedSession?.id, '')
  const workspaceName = stringFact(state.workspace?.name, tx('No workspace'))
  const workspacePath = stringFact(state.workspace?.path ?? state.workspace?.id, '')
  const composerScope = composerDraftScope(workspacePath, selectedSessionId || null)
  const attachments = useSyncExternalStore(
    useCallback((listener) => drafts.subscribe(composerScope, listener), [drafts, composerScope]),
    useCallback(() => drafts.get(composerScope).attachments, [drafts, composerScope]),
    useCallback(() => drafts.get(composerScope).attachments, [drafts, composerScope]),
  )
  const setAttachments = (update: (current: readonly AttachmentCapability[]) => readonly AttachmentCapability[]): void => {
    drafts.setAttachments(composerScope, update)
  }
  const composerTurnId = state.runtime.hostSessionId === selectedSessionId ? state.runtime.activeTurn : null
  const pendingInputCount = state.timeline.filter((item) => item.role === 'user' && item.data.inputState === 'pending').length
  const attachmentScope = `${stringFact(state.workspace?.path ?? state.workspace?.id, '')}:${stringFact(state.selectedSession?.id, '')}`
  const externalOpener = window.agentWorkspace?.openExternal
  const visionState = providerVisionState(state.provider)
  const recoveryStatus = state.runtime.streamRecovery
    ? state.runtime.streamRecovery.status === 'recovering'
      ? tx('Continuing task...')
      : tx('Recovering connection...')
    : null
  attachmentScopeRef.current = attachmentScope
  const voice = useVoicePreference()
  const sidecarEpoch = state.runtime.epoch
  // The agent's meeting transcription uses the speech service chosen in Settings → Voice; each
  // sidecar is told the choice when it starts and when it changes.
  useEffect(() => {
    if (!client || sidecarEpoch === null || typeof client.setSpeech !== 'function') return
    void client.setSpeech(voice.providerId, voice.model).catch(() => undefined)
  }, [client, sidecarEpoch, voice.providerId, voice.model])
  const promptHistory = useMemo(() => entries.flatMap((entry) => {
    if (entry.type !== 'message' || entry.role !== 'user' || entry.open) return []
    if (entry.text.startsWith(CHECKS_MARKER) || entry.text.startsWith(SPEC_MARKER)) return []  // sent by the app, not typed
    const body = parseUserAttachmentReferences(entry.text).body.trim()
    return body ? [body] : []
  }).slice(-50), [entries])
  const slashCommands = useMemo<SlashCommand[]>(() => {
    const t = (key: MessageKey) => translate(locale, key)
    const commands: SlashCommand[] = []
    if (onCreateSession) commands.push({ name: 'new', description: t('composer.command.new'), run: () => onCreateSession() })
    if (client) {
      commands.push({ name: 'stop', description: t('composer.command.stop'), run: () => client.cancelTurn(selectedSessionId || null) })
      commands.push({
        name: 'mode', argumentHint: 'coding|research|task', description: t('composer.command.mode'),
        run: (argument) => {
          const mode = argument.toLowerCase()
          if (mode !== 'coding' && mode !== 'research' && mode !== 'task') throw new Error('invalid_mode')
          return client.setMode(mode)
        },
      })
    }
    if (onNavigate) {
      const routes: Array<[string, ActivityId, MessageKey]> = [
        ['runs', 'runs', 'composer.command.runs'],
        ['changes', 'changes', 'composer.command.changes'],
        ['files', 'workspace', 'composer.command.files'],
        ['knowledge', 'knowledge', 'composer.command.knowledge'],
        ['schedules', 'schedules', 'composer.command.schedules'],
        ['search', 'search', 'composer.command.search'],
        ['jobs', 'jobs', 'composer.command.jobs'],
        ['operations', 'operations', 'composer.command.operations'],
        ['settings', 'settings', 'composer.command.settings'],
      ]
      for (const [name, activity, key] of routes) {
        if (!routeVisible || routeVisible(activity)) commands.push({ name, description: t(key), run: () => onNavigate(activity) })
      }
    }
    return commands
  }, [client, locale, onCreateSession, onNavigate, routeVisible, selectedSessionId])
  const loadMentionPaths = useMemo(() => client && workspacePath ? async (): Promise<readonly string[]> => {
    const response = await client.getWorkspaceFilesTree('', 8, 3000)
    const files = (response.payload as { files?: unknown }).files
    return Array.isArray(files)
      ? files.flatMap((file) => file && typeof file === 'object' && (file as { type?: unknown }).type === 'file' &&
          typeof (file as { path?: unknown }).path === 'string' ? [(file as { path: string }).path] : [])
      : []
  } : undefined, [client, workspacePath])

  useLayoutEffect(() => {
    setActionError(null)
  }, [attachmentScope])

  const openExternal = useCallback((url: string): void => {
    // A link opens in the preview panel; the panel has a button for the browser.
    if (window.agentWorkspace?.preview) {
      requestPreview({ kind: 'url', url })
      return
    }
    if (!externalOpener) return
    const requestedScope = attachmentScope
    setActionError(null)
    drafts.update(composerScope, (draft) => ({ ...draft, attachmentError: null }))
    void externalOpener(url)
      .then((opened) => {
        if (!opened && attachmentScopeRef.current === requestedScope) {
          setActionError('workbench.externalOpenFailed')
        }
      })
      .catch(() => {
        if (attachmentScopeRef.current === requestedScope) {
          setActionError('workbench.externalOpenFailed')
        }
      })
  }, [attachmentScope, externalOpener, drafts, composerScope])

  /** A new conversation from one of this one's user messages; it opens when made. */
  const forkConversation = async (messageId: string, keepReply: boolean, compareModel?: string): Promise<{ sessionId: string; prompt: string | null }> => {
    if (!client || !selectedSessionId) throw new Error('runtime_unavailable')
    const t = (key: MessageKey, variables?: Record<string, string>) => translate(locale, key, variables)
    const title = (compareModel ? t('fork.compareTitle', { model: compareModel, title: sessionTitle }) : t('fork.title', { title: sessionTitle })).slice(0, 200)
    const response = await client.forkSession({ sessionId: selectedSessionId, messageId, keepReply, title, compareModel })
    const session = response.payload.session
    const forkedId = response.type === 'session.fork.result' && session && typeof session === 'object' && !Array.isArray(session) &&
      typeof session.id === 'string' ? session.id : null
    if (!forkedId) throw new GatewayCommandError(typeof response.payload.code === 'string' ? response.payload.code : 'fork_failed')
    await client.openSession(forkedId)
    return { sessionId: forkedId, prompt: typeof response.payload.prompt === 'string' ? response.payload.prompt : null }
  }

  const forkErrorKey = (error: unknown): MessageKey =>
    error instanceof GatewayCommandError && error.code === 'fork_turn_running' ? 'timeline.forkTurnRunning' : 'timeline.forkFailed'

  const runFork = (messageId: string, keepReply: boolean): void => {
    if (forking) return
    setForking(true)
    setActionError(null)
    void forkConversation(messageId, keepReply)
      .then(({ prompt }) => { if (!keepReply && prompt) setSuggestedPrompt(prompt) })
      .catch((error: unknown) => setActionError(forkErrorKey(error)))
      .finally(() => setForking(false))
  }

  /** Waits for the conversation's runtime, which starts after it opens. */
  const waitForRuntime = async (sessionId: string): Promise<void> => {
    if (!client) throw new Error('runtime_unavailable')
    const deadline = Date.now() + 15_000
    while (Date.now() < deadline) {
      const runtime = client.store.getState().runtime
      if (runtime.hostSessionId === sessionId && runtime.ready && runtime.state === 'ready' && !runtime.stale) return
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    throw new Error('runtime_unavailable')
  }

  const startComparison = async (model: string): Promise<void> => {
    if (!client || !compareMessageId) throw new Error('runtime_unavailable')
    setActionError(null)
    const { sessionId, prompt } = await forkConversation(compareMessageId, false, model)
    if (!prompt) throw new Error('fork_unavailable')
    await waitForRuntime(sessionId)
    const response = await client.startTurn(prompt, [], [], undefined, sessionId, model)
    if (response.type !== 'turn.start.result') throw new GatewayCommandError(typeof response.payload.code === 'string' ? response.payload.code : 'turn_start_failed')
    setComparisonSessionId(sessionId)
  }

  const estimateCost = useMemo(() => client && typeof client.estimateCost === 'function'
    ? async (messageChars: number): Promise<CostEstimate | null> => {
      const response = await client.estimateCost(messageChars, selectedSessionId || null)
      const payload = response.payload
      if (response.type !== 'cost.estimate.result' || payload.priced !== true || payload.free === true) return null
      const number = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null
      const expectedUsd = number(payload.expectedUsd)
      const highUsd = number(payload.highUsd)
      if (expectedUsd === null || highUsd === null) return null
      return {
        expectedUsd, highUsd, calls: number(payload.calls) ?? 0, cacheRatio: number(payload.cacheRatio) ?? 0,
        fromHistory: payload.fromHistory === true,
      }
    }
    : undefined, [client, selectedSessionId])

  const noticeActionsFor = (entry: NoticeEntry): NoticeActions | undefined => {
    if (entry.kind !== 'forked') return undefined
    const source = entry.sourceSessionId ? state.sessions.find((session) => session.id === entry.sourceSessionId) : undefined
    return {
      sourceTitle: typeof source?.title === 'string' ? source.title : undefined,
      onOpenSource: source && client ? () => { void client.openSession(entry.sourceSessionId!).catch(() => undefined) } : undefined,
      onShowComparison: entry.compareModel && client && selectedSessionId ? () => setComparisonSessionId(selectedSessionId) : undefined,
    }
  }

  const createSession = (): void => {
    if (!onCreateSession || creatingSession) return
    setCreatingSession(true)
    setActionError(null)
    void onCreateSession()
      .catch(() => setActionError('workbench.sessionCreateFailed'))
      .finally(() => setCreatingSession(false))
  }

  const importAttachments = (load: () => Promise<readonly AttachmentCapability[]>): void => {
    const requestedDraftScope = composerScope
    drafts.update(requestedDraftScope, (draft) => ({ ...draft, attachmentImports: draft.attachmentImports + 1, attachmentError: null }))
    void (async () => {
      try {
        const selected = await load()
        if (selected.length > 0) drafts.setAttachments(requestedDraftScope, (current) => {
          const sending = new Set(drafts.get(requestedDraftScope).inFlightAttachmentIds)
          // Pending acknowledgement still owns the previous message's chips.
          // Budget a new paste against the following draft, retaining both
          // sets until consumeAttachments revokes only the accepted IDs.
          const inFlight = current.filter(item => sending.has(item.id))
          const nextDraft = mergeAttachmentCapabilities(current.filter(item => !sending.has(item.id)), selected)
          return [...inFlight, ...nextDraft]
        })
      } catch (error) {
        drafts.update(requestedDraftScope, (draft) => ({ ...draft, attachmentError: attachmentErrorMessage(error) }))
      } finally {
        drafts.update(requestedDraftScope, (draft) => ({ ...draft, attachmentImports: Math.max(0, draft.attachmentImports - 1) }))
      }
    })()
  }

  return (
    <main className="conversation-column reading-surface" data-empty={referenceFallback && entries.length === 0 ? 'true' : 'false'}>
      <header className="conversation-toolbar conversation-header" data-testid="conversation-overview">
        <div className="narrow-tools">
           <button type="button" onClick={(event) => onOpenSessions(event.currentTarget)} aria-label={tx('Open sessions')} title={tx('Sessions')}><PanelLeftOpen size={16} /></button>
           <button type="button" onClick={(event) => onOpenInspector(event.currentTarget)} aria-label={tx('Open Inspector')} title={tx('Inspector')}><PanelRightOpen size={16} /></button>
        </div>
        <div className="conversation-heading">
          <span className="conversation-kicker">{tx('Active task')}</span>
          <strong title={sessionTitle}>{sessionTitle}</strong>
          <span className="conversation-location"><Folder size={11} />{workspaceName}</span>
        </div>
        <div className="conversation-quick-actions">
          {onCreateSession ? (
            <button
              type="button"
              className="conversation-quick-action is-primary"
              aria-label={tx('New task')}
              title={tx('New task')}
              disabled={creatingSession}
              onClick={createSession}
            >
              <Plus size={14} />
              <span>{tx('New task')}</span>
            </button>
          ) : null}
          {onOpenRuns ? (
            <button
              type="button"
              className="conversation-quick-action"
              aria-label={tx('Open run center')}
              title={tx('Open run center')}
              onClick={onOpenRuns}
            >
              <Workflow size={14} />
              <span>{tx('Run center')}</span>
            </button>
          ) : null}
        </div>
        <div className="conversation-header-actions">
          {(!state.runtime.ready || state.runtime.activeTurn) ? (
            <span className="conversation-state-chip"><Circle size={7} fill="currentColor" />{state.runtime.ready ? tx('Ready') : localizeKnownStatus(locale, state.runtime.state)}</span>
          ) : null}
          {entries.length > 0 ? <span className="conversation-count-chip">{entries.length} {tx(entries.length === 1 ? 'event' : 'events')}</span> : null}
        </div>
      </header>
      <div className="conversation-meta-bar">
        <span className="meta-runtime-summary">
          <span className="meta-runtime-dot" aria-hidden="true" />
          <strong>{stringFact(state.provider?.model, tx('Model unavailable'))}</strong>
          <span>{localizeKnownStatus(locale, state.runtime.mode)}</span>
          <span>{state.runtime.autonomy === 'yolo' ? 'YOLO' : localizeKnownStatus(locale, state.runtime.autonomy)}</span>
        </span>
        <span className="meta-spacer" />
        {recoveryStatus ? (
          <span
            className="meta-hint meta-recovery-hint"
            data-recovery="true"
            data-testid="stream-recovery-status"
            role="status"
            aria-live="polite"
          >
            {recoveryStatus}
            <span className="meta-recovery-attempt">
              {state.runtime.streamRecovery?.attempt}/{state.runtime.streamRecovery?.maxAttempts}
            </span>
          </span>
        ) : (
          <span className="meta-hint">{state.runtime.activeTurn ? tx('Task is running') : tx('Ready for the next instruction')}</span>
        )}
      </div>
      <div className="conversation-reading-stage">
      <TimelineWorkspaceContext.Provider value={workspacePath || null}>
      <TimelineActionsContext.Provider value={timelineActions}>
      <ConversationTimeline
        entries={entries}
        scopeKey={attachmentScope}
        registry={registry}
        hasMore={state.history.hasMore}
        onLoadPrevious={state.history.nextCursor && client && selectedSessionId
          ? () => client.history(selectedSessionId, state.history.nextCursor!)
          : undefined}
        onPromptSuggestion={setSuggestedPrompt}
        onEditPrompt={setSuggestedPrompt}
        onRetryPrompt={client ? (prompt) => {
          setActionError(null)
          void client.startTurn(prompt, [], [], undefined, selectedSessionId || null)
            .catch(() => setActionError('timeline.retryFailed'))
        } : undefined}
        retryDisabled={!composerReady || Boolean(composerTurnId)}
        onForkMessage={client ? (messageId) => runFork(messageId, false) : undefined}
        onBranchFromReply={client ? (messageId) => runFork(messageId, true) : undefined}
        onCompareReply={client ? setCompareMessageId : undefined}
        onRewindFiles={client && typeof client.rewindFiles === 'function' ? setRewindMessageId : undefined}
        forkDisabled={forking || !composerReady || Boolean(composerTurnId)}
        onSendToPhone={phoneSend.available ? (text) => phoneSend.send({ kind: 'text', text }) : undefined}
        noticeActionsFor={noticeActionsFor}
        onOpenExternal={typeof externalOpener === 'function' ? openExternal : undefined}
      />
      </TimelineActionsContext.Provider>
      </TimelineWorkspaceContext.Provider>
      </div>
      {compareMessageId ? (
        <CompareModelDialog
          currentModel={stringFact(state.provider?.model, '') || null}
          sourceModel={null}
          onSubmit={startComparison}
          onClose={() => setCompareMessageId(null)}
        />
      ) : null}
      {rewindMessageId && client && selectedSessionId ? (
        <RewindDialog
          rewind={rewindFor(selectedSessionId, rewindMessageId)}
          onClose={() => setRewindMessageId(null)}
        />
      ) : null}
      {comparisonSessionId && client ? (
        <ComparisonSheet
          load={async () => {
            const response = await client.compareSession(comparisonSessionId)
            if (response.type !== 'session.compare.result') throw new Error('compare_unavailable')
            return comparisonFrom(response.payload)
          }}
          onClose={() => setComparisonSessionId(null)}
          pendingApprovals={comparisonSessionId === selectedSessionId ? approvals.length : 0}
        />
      ) : null}
      <div className="conversation-dock">
        <div className="composer-context-strip" data-testid="composer-context-strip">
          <div className="composer-context-copy"><span className="composer-context-label">{tx('Task composer')}</span><strong title={readiness.reason ?? undefined}>{readiness.canSubmit ? tx('Ready to work') : tx('Composer paused')}</strong></div>
          <div className="composer-context-facts"><span>{state.runtime.autonomy === 'yolo' ? 'YOLO' : localizeKnownStatus(locale, state.runtime.autonomy)}</span><span>{localizeKnownStatus(locale, state.runtime.mode)}</span></div>
        </div>
        <details className="agent-capability-hints" data-testid="agent-capability-hints">
          <summary>
            <ImageIcon size={13} />
            <span>{visionState === true ? tx('Vision ready') : tx('Add context')}</span>
            <span className="capability-summary-copy">{tx('Images, files and subagents')}</span>
            <span className="capability-summary-chevron" aria-hidden="true">⌄</span>
          </summary>
          <div className="agent-capability-details" role="note">
            <span className="agent-capability-hint">{tx('Attach an image or screenshot, then ask the agent to inspect the interface.')}</span>
            {visionState === true ? <span className="agent-capability-badge">{tx('Vision ready')}</span> : null}
            <span className="agent-capability-hint">{tx('When parts of a request can be done at the same time, the agent hands them to sub-agents on its own.')}</span>
          </div>
        </details>
        <SubagentStrip
          subagents={subagents}
          onOpen={(runId) => {
            if (routeVisible && !routeVisible('runs')) return
            requestRunFocus(runId)
            onNavigate?.('runs')
          }}
          onWatch={routeVisible && !routeVisible('studio') ? undefined : () => onNavigate?.('studio')}
        />
        <PhoneJobStrip jobs={phoneJobs} />
        {phoneSend.ui}
        <ApprovalShelf
          approvals={approvals}
          resolve={(requestId, scope) => client?.resolveApproval(requestId, scope) ?? Promise.reject(new Error('runtime_unavailable'))}
        />
        {actionError ? <p className="conversation-action-error route-error" role="status">{translate(locale, actionError)}</p> : null}
        <Composer
          activeTurnId={composerTurnId}
          workspacePath={workspacePath}
          draftStore={drafts}
          providerLabel={composerProviderLabel}
          providerId={client && typeof client.listProviders === 'function' ? stringFact(state.provider?.id, '') || null : null}
          placeholder={composerProviderLabel ? tx('Reference composer placeholder') : undefined}
          queuedCount={state.runtime.queuedTurnCount ?? 0}
          pendingInputCount={pendingInputCount}
          attachments={attachments}
          disabled={!composerReady}
          disabledReason={readiness.reason}
          onRemoveAttachment={(id) => {
            setAttachments((current) => current.filter((item) => item.id !== id))
            drafts.update(composerScope, (draft) => ({ ...draft, attachmentError: null }))
          }}
          onAttach={window.agentWorkspace?.selectAttachments ? () => importAttachments(() => window.agentWorkspace.selectAttachments()) : undefined}
          onDropFolders={client?.openWorkspacePath ? (folders) => {
            const path = folders.map(droppedFolderPath).find((value): value is string => value !== null)
            if (!path) {
              setActionError('workspace.dropFolderUnavailable')
              return
            }
            setActionError(null)
            void client.openWorkspacePath(path).catch(() => setActionError('workspace.openFailed'))
          } : undefined}
          onPasteFiles={window.agentWorkspace?.importAttachments || window.agentWorkspace?.pasteAttachments ? (files) => {
            // Both the target scope and directory are captured before asynchronous file reads.
            const requestedWorkspace = workspacePath
            importAttachments(async () => {
              if (!requestedWorkspace) throw new Error('workspace_unavailable')
              if (files.length === 0) return window.agentWorkspace.pasteAttachments(requestedWorkspace)
              const imported = await readAttachmentFiles(files)
              return window.agentWorkspace.importAttachments(imported, requestedWorkspace)
            })
          } : undefined}
          suggestedPrompt={suggestedPrompt}
          onSuggestedPromptConsumed={() => setSuggestedPrompt(null)}
          onOptimizePrompt={(prompt) => {
            const selection = readPromptOptimizationSelection()
            return client?.optimizePrompt(prompt, selection ?? undefined)
              ?? Promise.reject(new Error('runtime_unavailable'))
          }}
          sessionId={stringFact(state.selectedSession?.id, '') || null}
          history={promptHistory}
          slashCommands={slashCommands}
          loadMentionPaths={loadMentionPaths}
          estimateCost={estimateCost}
          onTranscribe={client && voice.providerId ? async (audio) => {
            const response = await client.transcribeAudio(voice.providerId!, voice.model, audio.mediaType, audio.data)
            const text = (response.payload as { text?: unknown }).text
            if (typeof text !== 'string') throw new Error('transcription_failed')
            return text
          } : undefined}
          invoke={(command) => {
            if (!client) return Promise.reject(new Error('runtime_unavailable'))
            if (command.type === 'provider.list') return client.listProviders()
            if (command.type === 'provider.default') {
              const providerId = command.payload.providerId
              return typeof providerId === 'string'
                ? client.setDefaultProvider(providerId)
                : Promise.reject(new Error('invalid_provider'))
            }
            if (command.type === 'turn.cancel') return client.cancelTurn(command.sessionId,
              typeof command.payload.turnId === 'string' ? command.payload.turnId : undefined)
            const prompt = typeof command.payload.prompt === 'string' ? command.payload.prompt : ''
            const rawIds = command.payload.attachmentIds
            const attachmentIds = Array.isArray(rawIds) && rawIds.every((id) => typeof id === 'string') ? rawIds : []
            if (command.type === 'turn.steer') {
              const turnId = command.payload.turnId
              const inputId = command.payload.inputId
              return typeof turnId === 'string'
                ? client.steerTurn(prompt, turnId, attachmentIds, typeof inputId === 'string' ? inputId : undefined, command.sessionId)
                : Promise.reject(new Error('turn_not_active'))
            }
            const effort = command.payload.reasoningEffort
            const knownEffort = effort === 'off' || effort === 'low' || effort === 'medium' || effort === 'high' || effort === 'xhigh' || effort === 'max'
            const team = command.payload.team
            if (team === 'auto') {
              return client.startTurn(prompt, attachmentIds, [], knownEffort ? effort : undefined, command.sessionId, undefined, false,
                { members: 'auto', review: command.payload.teamReview !== false })
            }
            if (Array.isArray(team) && team.length > 0) {
              const members = team.flatMap((item) => item && typeof item === 'object' && !Array.isArray(item)
                && typeof item.id === 'string' && typeof item.name === 'string'
                ? [{ id: item.id, name: item.name, ...(typeof item.brief === 'string' ? { brief: item.brief } : {}) }] : [])
              return client.startTurn(prompt, attachmentIds, [], knownEffort ? effort : undefined, command.sessionId, undefined, false,
                { members, review: command.payload.teamReview !== false })
            }
            if (command.payload.planFirst === true) {
              return client.startTurn(prompt, attachmentIds, [], knownEffort ? effort : undefined, command.sessionId, undefined, true)
            }
            if (knownEffort) {
              return client.startTurn(prompt, attachmentIds, [], effort, command.sessionId)
            }
            return client.startTurn(prompt, attachmentIds, [], undefined, command.sessionId)
          }}
        />
      </div>
    </main>
  )
}

type PanelId = 'sidebar' | 'inspector'
type PanelWidths = Record<PanelId, number>

const PANEL_WIDTH_STORAGE_KEY = 'agent-workspace.panel-widths.v1'
const SIDEBAR_OPEN_STORAGE_KEY = 'agent-workspace.sidebar-open.v1'
const DEFAULT_PANEL_WIDTHS: PanelWidths = { sidebar: 264, inspector: 332 }
const PANEL_WIDTH_MIN: PanelWidths = { sidebar: 200, inspector: 260 }
const PANEL_WIDTH_MAX: PanelWidths = { sidebar: 420, inspector: 420 }
const CENTER_MIN_WIDTH = 400
// Mirrors the shell geometry in reference.css.
const SHELL_PADDING = 8
const SHELL_GAP = 8
const RAIL_WIDTH = 60

function shellInset(viewportWidth: number): number {
  return Math.min(12, Math.max(8, viewportWidth * 0.0075))
}

function clampPanelWidth(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}

function readPanelWidths(): PanelWidths {
  try {
    const saved = JSON.parse(window.localStorage.getItem(PANEL_WIDTH_STORAGE_KEY) ?? 'null') as Partial<PanelWidths> | null
    return {
      sidebar: typeof saved?.sidebar === 'number' && Number.isFinite(saved.sidebar)
        ? clampPanelWidth(saved.sidebar, PANEL_WIDTH_MIN.sidebar, PANEL_WIDTH_MAX.sidebar)
        : DEFAULT_PANEL_WIDTHS.sidebar,
      inspector: typeof saved?.inspector === 'number' && Number.isFinite(saved.inspector)
        ? clampPanelWidth(saved.inspector, PANEL_WIDTH_MIN.inspector, PANEL_WIDTH_MAX.inspector)
        : DEFAULT_PANEL_WIDTHS.inspector,
    }
  } catch {
    return { ...DEFAULT_PANEL_WIDTHS }
  }
}

function readDesktopSidebarOpen(): boolean {
  try { return window.localStorage.getItem(SIDEBAR_OPEN_STORAGE_KEY) !== 'false' } catch { return true }
}

function panelWidthLimit(panel: PanelId, viewportWidth: number, widths: PanelWidths, sidebarVisible: boolean, inspectorVisible: boolean): number {
  const shellAndRail = 2 * shellInset(viewportWidth) + 2 * SHELL_PADDING + RAIL_WIDTH
    + SHELL_GAP * (1 + Number(sidebarVisible) + Number(inspectorVisible))
  const otherPanel = panel === 'sidebar'
    ? inspectorVisible ? widths.inspector : 0
    : sidebarVisible ? widths.sidebar : 0
  return Math.max(PANEL_WIDTH_MIN[panel], Math.min(PANEL_WIDTH_MAX[panel], viewportWidth - shellAndRail - otherPanel - CENTER_MIN_WIDTH))
}

function visiblePanelWidths(preferred: PanelWidths, viewportWidth: number, sidebarVisible: boolean, inspectorVisible: boolean): PanelWidths {
  const sidebar = clampPanelWidth(
    preferred.sidebar,
    PANEL_WIDTH_MIN.sidebar,
    panelWidthLimit('sidebar', viewportWidth, { ...preferred, inspector: PANEL_WIDTH_MIN.inspector }, sidebarVisible, inspectorVisible),
  )
  const inspector = clampPanelWidth(
    preferred.inspector,
    PANEL_WIDTH_MIN.inspector,
    panelWidthLimit('inspector', viewportWidth, { sidebar, inspector: preferred.inspector }, sidebarVisible, inspectorVisible),
  )
  return { sidebar, inspector }
}

export function Workbench({ appearance, nativeStatus, onAppearanceChange, client, registry, settingsI18n }: WorkbenchProps) {
  const tx = useText()
  const [activity, setActivity] = useState<ActivityId>('agent')
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [documentPreview, setDocumentPreview] = useState<DocumentPreviewRequest | null>(null)
  useEffect(() => {
    const show = (event: Event) => {
      const detail = (event as CustomEvent<DocumentPreviewRequest>).detail
      if (detail && typeof detail.path === 'string') setDocumentPreview(detail)
    }
    window.addEventListener(DOCUMENT_PREVIEW_EVENT, show)
    return () => window.removeEventListener(DOCUMENT_PREVIEW_EVENT, show)
  }, [])
  const [preview, setPreview] = useState<PreviewRequest | null>(null)
  useEffect(() => {
    const show = (event: Event) => {
      const detail = (event as CustomEvent<PreviewRequest>).detail
      if (detail && (detail.kind === 'url' || detail.kind === 'file')) setPreview(detail)
    }
    // The Files page opens the file it was asked for when it shows.
    const edit = () => setActivity('workspace')
    window.addEventListener(PREVIEW_EVENT, show)
    window.addEventListener(OPEN_IN_EDITOR_EVENT, edit)
    return () => {
      window.removeEventListener(PREVIEW_EVENT, show)
      window.removeEventListener(OPEN_IN_EDITOR_EVENT, edit)
    }
  }, [])
  const drawer = useDrawerController()
  const [desktopSidebarOpen, setDesktopSidebarOpen] = useState(readDesktopSidebarOpen)
  const [desktopInspectorOpen, setDesktopInspectorOpen] = useState(() =>
    typeof window === 'undefined' || window.innerWidth > 1160,
  )
  const desktopInspectorOpener = useRef<HTMLElement | null>(null)
  const paletteOpener = useRef<HTMLElement | null>(null)
  const focusRouteHeading = useRef(false)
  const [settingsLayout, setSettingsLayout] = useState(() =>
    settingsLayoutForViewport(window.innerWidth),
  )
  const [standaloneLocale, setStandaloneLocale] = useState<Locale>('en-US')
  const providedI18n = useProvidedI18n()
  const standaloneSettingsI18n = useMemo<I18nValue>(() => ({
    locale: standaloneLocale,
    setLocale: setStandaloneLocale,
    t: (key, variables) => translate(standaloneLocale, key, variables),
  }), [standaloneLocale])
  const effectiveSettingsI18n = settingsI18n ?? providedI18n ?? standaloneSettingsI18n
  const resolved = resolveAppearance(appearance)
  const runtimeState = useRuntimeState(client)
  const shortcuts = useShortcuts()
  const referenceMode = Boolean(client && typeof window !== 'undefined' && window.agentWorkspace)
  const ownedRegistry = useMemo(createContributionRegistry, [])
  const commandRegistry = registry ?? ownedRegistry
  const sidebarOpen = drawer.narrow ? drawer.active === 'sessions' : desktopSidebarOpen
  const inspectorOpen = drawer.narrow ? drawer.active === 'inspector' : desktopInspectorOpen
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth)
  const previousViewportWidth = useRef(window.innerWidth)
  const [preferredPanelWidths, setPreferredPanelWidths] = useState(readPanelWidths)
  const preferredPanelWidthsRef = useRef(preferredPanelWidths)
  const panelDrag = useRef<{ panel: PanelId; pointerId: number; startX: number; startWidth: number; startWidths: PanelWidths } | null>(null)
  const panelResizeFrame = useRef<number | null>(null)
  const specularFrame = useRef<number | null>(null)
  const specularSample = useRef<{ target: HTMLElement; clientX: number } | null>(null)
  const specularSurface = useRef<HTMLElement | null>(null)
  const desktopSidebarVisible = sidebarOpen && !drawer.narrow
  const desktopInspectorVisible = inspectorOpen && viewportWidth > 1160
  const panelWidths = visiblePanelWidths(preferredPanelWidths, viewportWidth, desktopSidebarVisible, desktopInspectorVisible)
  const sidebarMax = panelWidthLimit('sidebar', viewportWidth, panelWidths, desktopSidebarVisible, desktopInspectorVisible)
  const inspectorMax = panelWidthLimit('inspector', viewportWidth, panelWidths, desktopSidebarVisible, desktopInspectorVisible)
  const desktopHost = client && typeof window !== 'undefined' ? window.agentWorkspace?.desktop : undefined
  const sessionLocation = useCallback((sessionId: string): { title: string | null; workspace: string | null } => {
    for (const group of runtimeState.workspaceDirectory?.groups ?? []) {
      const match = group.sessions.find((session) => session.id === sessionId)
      if (match) return { title: stringFact(match.title, '') || null, workspace: group.path }
    }
    const loaded = runtimeState.sessions.find((session) => session.id === sessionId)
    return { title: loaded ? stringFact(loaded.title, '') || null : null, workspace: loaded ? stringFact(loaded.workspace, '') || null : null }
  }, [runtimeState.sessions, runtimeState.workspaceDirectory])
  useAttentionNotifications(runtimeState, {
    turnFinished: effectiveSettingsI18n.t('notifications.turnFinished'),
    approvalNeeded: effectiveSettingsI18n.t('notifications.approvalNeeded'),
    sessionTitle: (sessionId) => sessionLocation(sessionId).title ?? effectiveSettingsI18n.t('workbench.untitledSession'),
  }, desktopHost ? (notification) => desktopHost.notify(notification) : undefined)
  useEffect(() => {
    if (!desktopHost || !client) return undefined
    return desktopHost.onNotificationActivated((sessionId) => {
      setActivity('agent')
      if (!sessionId) return
      const { workspace } = sessionLocation(sessionId)
      const opening = workspace && client.openWorkspaceSession
        ? client.openWorkspaceSession(workspace, sessionId)
        : client.openSession(sessionId)
      void Promise.resolve(opening).catch(() => undefined)
    })
  }, [client, desktopHost, sessionLocation])

  const clearSpecular = useCallback((): void => {
    if (specularFrame.current !== null) {
      window.cancelAnimationFrame(specularFrame.current)
      specularFrame.current = null
    }
    specularSample.current = null
    specularSurface.current?.style.setProperty('--specular-opacity', '0')
    specularSurface.current = null
  }, [])

  useLayoutEffect(() => clearSpecular, [activity, resolved.animateOptics, clearSpecular])

  // Warm the on-demand routes after the first paint so navigation stays instant.
  useEffect(() => {
    if (typeof window.requestIdleCallback === 'function') {
      const handle = window.requestIdleCallback(preloadRoutes, { timeout: 4000 })
      return () => window.cancelIdleCallback(handle)
    }
    const timer = window.setTimeout(preloadRoutes, 1500)
    return () => window.clearTimeout(timer)
  }, [])

  const commitPanelWidths = (persist: boolean): void => {
    if (panelResizeFrame.current !== null) {
      window.cancelAnimationFrame(panelResizeFrame.current)
      panelResizeFrame.current = null
    }
    const next = preferredPanelWidthsRef.current
    setPreferredPanelWidths(next)
    if (persist) {
      try { window.localStorage.setItem(PANEL_WIDTH_STORAGE_KEY, JSON.stringify(next)) } catch { /* Local storage may be unavailable. */ }
    }
  }

  const changePanelWidth = (panel: PanelId, requested: number, persist = true): void => {
    const current = visiblePanelWidths(preferredPanelWidthsRef.current, window.innerWidth, desktopSidebarVisible, desktopInspectorVisible)
    const maximum = panelWidthLimit(panel, window.innerWidth, current, desktopSidebarVisible, desktopInspectorVisible)
    const next = { ...preferredPanelWidthsRef.current, [panel]: clampPanelWidth(requested, PANEL_WIDTH_MIN[panel], maximum) }
    preferredPanelWidthsRef.current = next
    if (persist) commitPanelWidths(true)
    else if (panelResizeFrame.current === null) {
      panelResizeFrame.current = window.requestAnimationFrame(() => {
        panelResizeFrame.current = null
        setPreferredPanelWidths(preferredPanelWidthsRef.current)
      })
    }
  }

  useEffect(() => () => {
    if (panelResizeFrame.current !== null) window.cancelAnimationFrame(panelResizeFrame.current)
    panelResizeFrame.current = null
    panelDrag.current = null
  }, [])

  const onPanelPointerDown = (panel: PanelId, event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0 || drawer.narrow || (panel === 'sidebar' && !sidebarOpen)) return
    event.preventDefault()
    clearSpecular()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    panelDrag.current = { panel, pointerId: event.pointerId, startX: event.clientX, startWidth: panelWidths[panel], startWidths: preferredPanelWidthsRef.current }
  }

  const onPanelPointerMove = (panel: PanelId, event: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = panelDrag.current
    if (!drag || drag.panel !== panel || drag.pointerId !== event.pointerId) return
    const direction = panel === 'sidebar' ? 1 : -1
    changePanelWidth(panel, drag.startWidth + direction * (event.clientX - drag.startX), false)
  }

  const onPanelPointerEnd = (panel: PanelId, event: ReactPointerEvent<HTMLDivElement>, cancelled = false): void => {
    const drag = panelDrag.current
    if (!drag || drag.panel !== panel || drag.pointerId !== event.pointerId) return
    panelDrag.current = null
    if (cancelled) preferredPanelWidthsRef.current = drag.startWidths
    commitPanelWidths(!cancelled)
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  const onPanelKeyDown = (panel: PanelId, event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const maximum = panel === 'sidebar' ? sidebarMax : inspectorMax
    const current = panelWidths[panel]
    const step = event.shiftKey ? 32 : 12
    const direction = panel === 'sidebar' ? 1 : -1
    let requested: number
    if (event.key === 'Home') requested = PANEL_WIDTH_MIN[panel]
    else if (event.key === 'End') requested = maximum
    else if (event.key === 'ArrowRight') requested = current + direction * step
    else if (event.key === 'ArrowLeft') requested = current - direction * step
    else return
    event.preventDefault()
    event.stopPropagation()
    changePanelWidth(panel, requested)
  }
  const toggleSessions = useCallback((opener: HTMLElement): void => {
    if (drawer.narrow) {
      drawer.open('sessions', opener)
      return
    }
    setDesktopSidebarOpen((current) => !current)
  }, [drawer.narrow, drawer.open])
  const closeSessions = useCallback((): void => {
    if (drawer.narrow) drawer.close()
    else setDesktopSidebarOpen(false)
  }, [drawer.close, drawer.narrow])
  useEffect(() => {
    try { window.localStorage.setItem(SIDEBAR_OPEN_STORAGE_KEY, String(desktopSidebarOpen)) } catch { /* Local storage may be unavailable. */ }
  }, [desktopSidebarOpen])
  const toggleInspector = useCallback((opener: HTMLElement): void => {
    if (drawer.narrow) {
      drawer.open('inspector', opener)
      return
    }
    desktopInspectorOpener.current = opener
    setDesktopInspectorOpen((current) => !current)
  }, [drawer.narrow, drawer.open])
  const closeInspector = useCallback((): void => {
    if (drawer.narrow) {
      drawer.close()
      return
    }
    setDesktopInspectorOpen(false)
    desktopInspectorOpener.current?.focus()
  }, [drawer.close, drawer.narrow])
  const openPalette = useCallback((opener?: HTMLElement | null): void => {
    paletteOpener.current = opener ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null)
    setPaletteOpen(true)
  }, [])
  const selectActivity = useCallback((id: ActivityId, focusHeading = false): void => {
    focusRouteHeading.current = focusHeading
    setActivity(id)
  }, [])
  const [interfaceMode, setInterfaceMode] = useState<InterfaceMode>(readInterfaceMode)
  const changeInterfaceMode = useCallback((mode: InterfaceMode): void => {
    writeInterfaceMode(mode)
    setInterfaceMode(mode)
  }, [])
  const routeVisible = useCallback((id: ActivityId): boolean => activityVisible(interfaceMode, id), [interfaceMode])
  // A page the simple layout does not show closes when the layout changes.
  useEffect(() => {
    if (!activityVisible(interfaceMode, activity)) setActivity('agent')
  }, [activity, interfaceMode])
  const scheduleUnread = runtimeState.scheduleInbox?.unread ?? 0
  // The rail shows when scheduled runs finished; the gateway is asked now and then.
  useEffect(() => {
    if (!client?.listScheduleRuns) return undefined
    const check = () => void client.listScheduleRuns({ limit: 1 }).catch(() => undefined)
    check()
    const timer = window.setInterval(check, 60_000)
    return () => window.clearInterval(timer)
  }, [client])
  const openRunFromRoute = useCallback((runId: string): void => {
    if (!activityVisible(interfaceMode, 'runs')) return
    requestRunFocus(runId)
    setActivity('runs')
  }, [interfaceMode])
  const openAgentFromRoute = useCallback((): void => setActivity('agent'), [])
  const openSessionFromRoute = useCallback((workspace: string, sessionId: string): void => {
    if (!client) return
    setActivity('agent')
    const opening = client.openWorkspaceSession ? client.openWorkspaceSession(workspace, sessionId) : client.openSession(sessionId)
    void Promise.resolve(opening).catch(() => undefined)
  }, [client])

  useEffect(() => {
    const disposers: Array<() => void> = []
    const routeCommands: Array<{ id: ActivityId; title: string; keywords: string[] }> = [
      { id: 'agent', title: effectiveSettingsI18n.t('command.route.agent'), keywords: ['conversation', 'chat', '对话', '智能体'] },
      { id: 'studio', title: effectiveSettingsI18n.t('command.route.studio'), keywords: ['studio', 'office', '3d', 'team', 'experts', '工作室', '办公室', '专家团'] },
      { id: 'runs', title: effectiveSettingsI18n.t('command.route.runs'), keywords: ['runs', 'plan', 'attention', '运行', '计划', '待处理'] },
      { id: 'workspace', title: effectiveSettingsI18n.t('command.route.workspace'), keywords: ['files', 'sessions', '工作区', '文件'] },
      { id: 'knowledge', title: effectiveSettingsI18n.t('command.route.knowledge'), keywords: ['documents', 'knowledge', 'pdf', '知识库', '文档', '资料'] },
      { id: 'schedules', title: effectiveSettingsI18n.t('command.route.schedules'), keywords: ['schedule', 'automation', 'daily', '定时', '计划', '每天'] },
      { id: 'search', title: effectiveSettingsI18n.t('command.route.search'), keywords: ['find', '搜索', '会话'] },
      { id: 'changes', title: effectiveSettingsI18n.t('command.route.changes'), keywords: ['diff', '变更', '差异'] },
      { id: 'jobs', title: effectiveSettingsI18n.t('command.route.jobs'), keywords: ['tasks', '后台', '任务'] },
      { id: 'operations', title: effectiveSettingsI18n.t('command.route.operations'), keywords: ['queue', 'schedule', 'terminal', 'operations', '队列', '调度', '终端'] },
      { id: 'settings', title: effectiveSettingsI18n.t('command.route.settings'), keywords: ['appearance', 'theme', '设置', '外观'] },
    ]
    for (const route of routeCommands.filter((item) => activityVisible(interfaceMode, item.id))) {
      const shortcut = shortcuts[`route.${route.id}`] ?? undefined
      disposers.push(commandRegistry.registerCommand({ id: `route.${route.id}`, title: route.title, keywords: route.keywords, shortcut, isEnabled: () => true, run: () => selectActivity(route.id, true) }))
    }
    disposers.push(commandRegistry.registerCommand({
      id: 'session.new',
      title: effectiveSettingsI18n.t('workbench.newTask'),
      keywords: ['new', 'task', 'session', '新建', '任务', '会话'],
      shortcut: shortcuts['session.new'] ?? undefined,
      isEnabled: () => Boolean(client?.createSession),
      run: async () => { await client?.createSession?.() },
    }))
    disposers.push(commandRegistry.registerCommand({
      id: 'composer.focus',
      title: effectiveSettingsI18n.t('composer.message'),
      keywords: ['focus', 'input', 'prompt', '输入', '提示词'],
      shortcut: shortcuts['composer.focus'] ?? undefined,
      isEnabled: () => Boolean(document.querySelector('textarea[aria-label="Message"]')),
      run: () => {
        document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message"]')?.focus()
      },
    }))
    disposers.push(commandRegistry.registerCommand({
      id: 'turn.stop',
      title: effectiveSettingsI18n.t('composer.stopTurn'),
      keywords: ['stop', 'cancel', '停止', '取消'],
      shortcut: shortcuts['turn.stop'] ?? undefined,
      isEnabled: () => Boolean(client?.cancelTurn && runtimeState.runtime.activeTurn),
      run: async () => { await client?.cancelTurn?.() },
    }))
    disposers.push(commandRegistry.registerCommand({ id: 'app.palette', title: effectiveSettingsI18n.t('command.openPalette'), keywords: ['commands', '命令'], shortcut: shortcuts['app.palette'] ?? undefined, isEnabled: () => true, run: () => openPalette() }))
    disposers.push(commandRegistry.registerCommand({ id: 'drawer.sessions', title: effectiveSettingsI18n.t('command.toggleSessions'), keywords: ['sidebar', '会话', '侧栏'], shortcut: shortcuts['drawer.sessions'] ?? undefined, isEnabled: () => true, run: () => toggleSessions(document.activeElement instanceof HTMLElement ? document.activeElement : document.body) }))
    disposers.push(commandRegistry.registerCommand({ id: 'drawer.inspector', title: effectiveSettingsI18n.t('command.toggleInspector'), keywords: ['context', '检查器', '上下文'], shortcut: shortcuts['drawer.inspector'] ?? undefined, isEnabled: () => true, run: () => toggleInspector(document.activeElement instanceof HTMLElement ? document.activeElement : document.body) }))
    return () => { for (const dispose of disposers.reverse()) dispose() }
  }, [client, commandRegistry, effectiveSettingsI18n, openPalette, runtimeState.runtime.activeTurn, selectActivity, shortcuts, toggleInspector, toggleSessions, interfaceMode])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.isComposing || event.key === 'Process') return
      // A key the focused editor already used (Ctrl+K asks the model there) is not a shortcut.
      if (event.defaultPrevented) return
      const modifier = event.ctrlKey || event.metaKey
      if (modifier && event.shiftKey && event.key.toLocaleLowerCase() === 'p') {
        event.preventDefault()
        openPalette(document.activeElement instanceof HTMLElement ? document.activeElement : document.body)
        return
      }
      const pressed = shortcutFromEvent(event)
      const command = pressed ? commandRegistry.getCommandByShortcut(pressed) : null
      if (!command) return
      event.preventDefault()
      void Promise.resolve(command.run()).catch(() => undefined)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [commandRegistry, openPalette])

  useEffect(() => {
    if (!focusRouteHeading.current) return
    focusRouteHeading.current = false
    document.querySelector<HTMLElement>('.route-column h1, .settings-column > .route-header h1')?.focus()
  }, [activity])

  useEffect(() => {
    const updateSettingsLayout = (): void => {
      const width = window.innerWidth
      const leavingDesktopInspector = previousViewportWidth.current > 1160 && width <= 1160
      const enteringDrawer = previousViewportWidth.current >= 1024 && width < 1024
      if (leavingDesktopInspector || enteringDrawer) {
        const inspector = document.querySelector<HTMLElement>('.workbench > .inspector')
        if (inspector?.contains(document.activeElement)) {
          const opener = width < 1024
            ? document.querySelector<HTMLElement>('.narrow-tools button:last-child')
            : document.querySelector<HTMLElement>('.title-strip > .title-icon-button')
          const focusTarget = opener ?? document.querySelector<HTMLElement>('.activity-rail button[aria-pressed="true"]')
          focusTarget?.focus()
        }
        setDesktopInspectorOpen(false)
      }
      previousViewportWidth.current = width
      setSettingsLayout(settingsLayoutForViewport(width))
      setViewportWidth(width)
    }
    window.addEventListener('resize', updateSettingsLayout)
    return () => window.removeEventListener('resize', updateSettingsLayout)
  }, [])

  const handleSpecular = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!resolved.animateOptics) return
    if (panelDrag.current || event.buttons !== 0) {
      clearSpecular()
      return
    }
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>('.glass-interactive') : null
    if (!target || target.dataset.resizing === 'true') {
      clearSpecular()
      return
    }
    specularSample.current = { target, clientX: event.clientX }
    if (specularFrame.current !== null) return
    specularFrame.current = window.requestAnimationFrame(() => {
      specularFrame.current = null
      const sample = specularSample.current
      specularSample.current = null
      if (!sample || panelDrag.current || !sample.target.isConnected || sample.target.dataset.resizing === 'true') return
      const rect = sample.target.getBoundingClientRect()
      if (specularSurface.current !== sample.target) {
        specularSurface.current?.style.setProperty('--specular-opacity', '0')
      }
      sample.target.style.setProperty('--specular-offset', `${sample.clientX - rect.left - rect.width / 2}px`)
      sample.target.style.setProperty('--specular-opacity', '1')
      specularSurface.current = sample.target
    })
  }

  return (
    <div
      className="workbench"
      data-testid="workbench"
      data-ui-version="reference"
      data-experience="mainstream"
      data-layout="desktop"
      data-sidebar-open={sidebarOpen ? 'true' : 'false'}
      data-inspector-open={inspectorOpen ? 'true' : 'false'}
      style={{ '--panel-sidebar-width': `${panelWidths.sidebar}px`, '--panel-inspector-width': `${panelWidths.inspector}px` } as CSSProperties}
      onPointerMove={handleSpecular}
      onPointerLeave={clearSpecular}
    >
      <LiquidBackdrop appearance={resolved} />
      <LiquidGlassSurfaces enabled={resolved.effectiveRefraction} />
      <TitleStrip
        state={runtimeState}
        onCommand={openPalette}
        inspectorOpen={inspectorOpen}
        showInspectorToggle={!drawer.narrow}
        onToggleInspector={toggleInspector}
        onWindowAction={(action) => {
          if (window.agentWorkspace?.controlWindow) void window.agentWorkspace.controlWindow(action).catch(() => undefined)
        }}
        onAutonomyChange={client?.setAutonomy
          ? (autonomy) => client.setAutonomy(autonomy)
          : undefined}
        onOpenWorkspace={client?.openWorkspace
          ? () => client.openWorkspace()
          : undefined}
        onOpenWorkspacePath={client?.switchWorkspacePath
          ? (path) => client.switchWorkspacePath(path)
          : undefined}
        onOpenControlCenter={interfaceMode === 'full' ? () => selectActivity('runs') : undefined}
      />
      <ActivityRail active={activity} onSelect={(id) => selectActivity(id)} onToggleSessions={toggleSessions} sessionsOpen={sidebarOpen} sessionsToggleLabel={effectiveSettingsI18n.t('command.toggleSessions')} settingsLabel={effectiveSettingsI18n.t('settings.title')} settingsShortcutLabel={effectiveSettingsI18n.t('command.route.settings')} mode={interfaceMode} unreadLabel={scheduleUnread ? effectiveSettingsI18n.t('workbench.schedulesUnread', { count: scheduleUnread }) : null} />
      <SessionSidebar
        open={sidebarOpen}
        state={runtimeState}
        client={client}
        onClose={closeSessions}
        drawer={drawer.narrow}
        drawerRef={(element) => drawer.register('sessions', element)}
      />
      <div
        className="panel-resizer panel-resizer--sidebar"
        role="separator"
        tabIndex={drawer.narrow || !sidebarOpen ? -1 : 0}
        aria-label={tx('Resize sessions')}
        title={tx('Resize sessions')}
        aria-orientation="vertical"
        aria-valuemin={PANEL_WIDTH_MIN.sidebar}
        aria-valuemax={sidebarMax}
        aria-valuenow={panelWidths.sidebar}
        onPointerDown={(event) => onPanelPointerDown('sidebar', event)}
        onPointerMove={(event) => onPanelPointerMove('sidebar', event)}
        onPointerUp={(event) => onPanelPointerEnd('sidebar', event)}
        onPointerCancel={(event) => onPanelPointerEnd('sidebar', event, true)}
        onKeyDown={(event) => onPanelKeyDown('sidebar', event)}
        onDoubleClick={() => changePanelWidth('sidebar', DEFAULT_PANEL_WIDTHS.sidebar)}
      />
      {activity === 'settings' ? (
        <Suspense fallback={<RouteLoading />}><LazySettingsRoute state={runtimeState} client={client} appearance={appearance} nativeStatus={nativeStatus ?? effectiveSettingsI18n.t('settings.rendererOnly')} onAppearanceChange={onAppearanceChange} registry={commandRegistry} layout={settingsLayout} i18n={effectiveSettingsI18n} interfaceMode={interfaceMode} onInterfaceModeChange={changeInterfaceMode} /></Suspense>
      ) : activity !== 'agent' ? (
        <RouteOutlet route={activity as ActivityRoute} state={runtimeState} store={client?.store ?? fallbackStore} client={client} onOpenSession={openSessionFromRoute}
          onOpenRun={openRunFromRoute} onOpenAgent={openAgentFromRoute} />
      ) : (
        <ConversationSurface
          state={runtimeState}
          client={client}
          reference={referenceMode}
          registry={commandRegistry}
          onOpenSessions={toggleSessions}
          onOpenInspector={toggleInspector}
          onCreateSession={client?.createSession ? () => client.createSession() : undefined}
          onOpenRuns={interfaceMode === 'full' ? () => selectActivity('runs') : undefined}
          onNavigate={selectActivity}
          routeVisible={routeVisible}
        />
      )}
      <Inspector
        open={inspectorOpen}
        reference={referenceMode}
        drawer={drawer.narrow}
        drawerRef={(element) => drawer.register('inspector', element)}
        state={runtimeState}
        client={client}
        registry={commandRegistry}
        onClose={closeInspector}
      />
      <div
        className="panel-resizer panel-resizer--inspector"
        role="separator"
        tabIndex={drawer.narrow || !desktopInspectorVisible ? -1 : 0}
        aria-label={tx('Resize inspector')}
        title={tx('Resize inspector')}
        aria-orientation="vertical"
        aria-valuemin={PANEL_WIDTH_MIN.inspector}
        aria-valuemax={inspectorMax}
        aria-valuenow={panelWidths.inspector}
        onPointerDown={(event) => onPanelPointerDown('inspector', event)}
        onPointerMove={(event) => onPanelPointerMove('inspector', event)}
        onPointerUp={(event) => onPanelPointerEnd('inspector', event)}
        onPointerCancel={(event) => onPanelPointerEnd('inspector', event, true)}
        onKeyDown={(event) => onPanelKeyDown('inspector', event)}
        onDoubleClick={() => changePanelWidth('inspector', DEFAULT_PANEL_WIDTHS.inspector)}
      />
      {drawer.narrow && drawer.active ? <button type="button" className="drawer-backdrop" aria-label={effectiveSettingsI18n.t('workbench.closeDrawer')} onClick={() => drawer.close()} /> : null}
      {documentPreview && client?.previewDocument ? <Suspense fallback={null}><OfficePreviewDialog request={documentPreview} client={client} onClose={() => setDocumentPreview(null)} /></Suspense> : null}
      {preview ? <Suspense fallback={null}><PreviewSheet key={JSON.stringify(preview)} request={preview} client={client} onClose={() => setPreview(null)} /></Suspense> : null}
      {paletteOpen ? <CommandPalette registry={commandRegistry} onClose={() => { setPaletteOpen(false); paletteOpener.current?.focus() }} /> : null}
      <DeviceNotices notices={runtimeState.deviceNotices ?? []} />
      <QuickActions client={client && typeof client.quickRun === 'function' ? client : null} />
    </div>
  )
}

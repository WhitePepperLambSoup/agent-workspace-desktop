import type { JsonValue } from '../../../shared/protocol'

export interface TimelineItem {
  id: string
  type: string
  text: string
  stream: string
  open: boolean
  domainSequence?: number
  correlationId?: string
  role?: 'user' | 'assistant' | 'reasoning' | 'system'
  streamChunks?: Array<{ sequence: number; text: string }>
  data: Record<string, JsonValue>
}

export interface SessionRuntimeProjection {
  sessionId: string
  workspace: string | null
  ready: boolean
  state: string
  activeTurn: string | null
  queuedTurnCount: number
  turnRequested?: boolean
}

export interface RuntimeProjection {
  epoch: string | null
  sequence: number
  ready: boolean
  state: string
  mode: string
  autonomy: string
  pendingAutonomy: string | null
  hostSessionId: string | null
  activeTurn: string | null
  queuedTurnCount?: number
  activeSessions?: Record<string, SessionRuntimeProjection>
  stale: boolean
  streamRecovery?: { status: 'interrupted' | 'recovering'; attempt: number; maxAttempts: number } | null
}

export type ActivityRoute = 'agent' | 'studio' | 'runs' | 'workspace' | 'knowledge' | 'schedules' | 'search' | 'changes' | 'jobs' | 'operations' | 'settings'
export type InspectorTabId = 'context' | 'tasks' | 'research' | 'changes' | 'artifacts' | 'logs'

export interface RecentWorkspace {
  path: string
  name: string
  lastUsed: number
}

export interface WorkspaceConversationGroup extends RecentWorkspace {
  sessions: Array<Record<string, JsonValue>>
  sessionPresentation: Record<string, SessionPresentation>
  hasMore: boolean
  nextOffset: number | null
}

export interface WorkspaceDirectory {
  groups: WorkspaceConversationGroup[]
  state: 'idle' | 'loading' | 'ready' | 'error'
  nextWorkspaceOffset: number | null
}

export interface SessionPresentation {
  sessionId: string
  alias: string | null
  pinned: boolean
  archived: boolean
  version: number
}

export interface SessionSearchHit {
  id: string
  title: string
  mode: string
  updatedAt: string
  snippet: string
  documentKind: string
}

export interface ChangeSetSummary {
  changesetId: string
  createdAt: string
  changeCount: number
  supportedCount: number
  appliedCount: number
  rejectedCount: number
  state: string
}

export interface BackgroundJobSummary {
  jobId: string
  sessionId?: string
  label?: string
  state: string
  createdAt?: string
  updatedAt?: string
  terminalReason?: string | null
}

export interface RuntimeLogEntry {
  sequence: number
  type: string
  text: string
  sessionId: string | null
  createdAt?: string
}

export interface QueueTaskView {
  id: string
  workspace?: string
  prompt?: string
  model?: string
  status: string
  error?: string | null
  createdAt?: string
  updatedAt?: string
  priority?: number
  owner?: string | null
  leaseUntil?: string | null
  attempt?: number
}

export interface OrchestrationView {
  id: string
  kind: 'collaboration' | 'delivery'
  sessionId?: string
  title?: string
  goal?: string
  state: string
  phase?: string
  detail?: string | null
  finalText?: string | null
  routeId?: string
  canResume?: boolean
  canCancel?: boolean
  updatedAt?: string
  members?: Array<Record<string, JsonValue>>
}

export interface TerminalView {
  id: string
  sessionId?: string
  state: string
  argv?: string[]
  cwd?: string
  output?: string
  offset?: number
  outputOffset?: number
  nextOffset?: number
  exitCode?: number | null
  startedAt?: string
  endedAt?: string | null
  owner?: string | null
}

export interface OperationalEventView {
  sequence: number
  type: string
  text: string
  createdAt?: string
}

export interface OperationalProjection {
  route: ActivityRoute
  inspectorTab: InspectorTabId
  sessionPresentation: Record<string, SessionPresentation>
  search: {
    query: string
    state: 'idle' | 'loading' | 'ready' | 'unavailable'
    results: SessionSearchHit[]
  }
  workspaceSummary: Record<string, JsonValue> | null
  changes: ChangeSetSummary[]
  changesTruncated: boolean
  selectedChange: Record<string, JsonValue> | null
  jobs: BackgroundJobSummary[]
  jobsState: 'idle' | 'loading' | 'ready' | 'error'
  jobsSessionId?: string | null
  selectedJobLog: Record<string, JsonValue> | null
  logs: RuntimeLogEntry[]
  queue: QueueTaskView[]
  queueCounts: Record<string, number>
  queueState: 'idle' | 'loading' | 'ready' | 'error'
  collaborations: OrchestrationView[]
  deliveries: OrchestrationView[]
  orchestrationState: 'idle' | 'loading' | 'ready' | 'error'
  terminals: Record<string, TerminalView>
  terminalState: 'idle' | 'loading' | 'ready' | 'error'
  operationalEvents: OperationalEventView[]
  eventReplayCursor: number
  eventReplayEpoch: string | null
  eventReplayOldestSequence: number | null
  eventReplayNewestSequence: number | null
  eventReplayHasMore: boolean
  eventReplaySessionId: string | null
}

export interface CheckResultView {
  name: string
  command: string
  ok: boolean
  exitCode: number | null
  seconds: number
  output: string
  timedOut: boolean
}

export interface ProjectChecksState {
  workspace: string
  running: boolean
  names: string[]
  // The conversation whose turn the checks followed (absent when run from the Changes page).
  sessionId?: string
  results: CheckResultView[]
  finishedAt?: number
}

export interface WorkbenchState {
  // Local invalidation signal for projections reset by an accepted bootstrap.
  bootstrapVersion?: number
  runtime: RuntimeProjection
  // Finished scheduled runs nobody has looked at yet (the rail's badge).
  scheduleInbox?: { unread: number }
  workspace: Record<string, JsonValue> | null
  recentWorkspaces?: RecentWorkspace[]
  workspaceDirectory?: WorkspaceDirectory
  provider: Record<string, JsonValue> | null
  sessions: Array<Record<string, JsonValue>>
  selectedSession: Record<string, JsonValue> | null
  timeline: TimelineItem[]
  history: { hasMore: boolean; nextCursor: string | null; cutoff: number }
  approvals: Record<string, Record<string, JsonValue>>
  tools: Record<string, Record<string, JsonValue>>
  operational: OperationalProjection
  // Sub-agents a conversation started (delegate_tasks), by run id, while this window is open.
  subagents?: Record<string, SubagentView>
  // The open folder's checks (tests, type check, lint): running now, or their latest results.
  checks?: ProjectChecksState
  // Requests a conversation sent to a paired phone (phone_task), by job id.
  phoneJobs?: Record<string, PhoneJobView>
  // Files, text and links phones sent while this window is open, newest last.
  deviceNotices?: DeviceNotice[]
}

export interface PhoneJobView {
  jobId: string
  sessionId: string
  state: string
  device: string
  prompt: string
}

export interface DeviceNotice {
  id: string
  kind: 'file' | 'text' | 'link'
  device: string
  name?: string
  path?: string
  text?: string
  // The user lets text from phones go straight to the clipboard.
  copy: boolean
}

export const FINISHED_PHONE_JOB_STATES: ReadonlySet<string> = new Set(['succeeded', 'failed', 'rejected', 'expired', 'cancelled'])
export const DEVICE_NOTICES_KEPT = 10

export interface SubagentView {
  runId: string
  sessionId: string
  title: string
  state: string
  /** On an expert team's turn: the expert's id, and whether it works its part or reviews. */
  expert?: string
  phase?: 'work' | 'review'
  /** What it is doing now: thinking, or the tool it uses. */
  activity?: 'thinking' | 'tool'
  tool?: string
}

export const FINISHED_RUN_STATES: ReadonlySet<string> = new Set(['succeeded', 'failed', 'cancelled', 'needs_attention'])

/** Record a sub-agent's state; a conversation's new batch replaces its finished earlier ones. */
export function withSubagent(current: Record<string, SubagentView>, next: SubagentView): Record<string, SubagentView> {
  const startsBatch = next.state === 'draft' && !current[next.runId] && !Object.values(current).some((item) =>
    item.sessionId === next.sessionId && !FINISHED_RUN_STATES.has(item.state))
  const kept = startsBatch
    ? Object.fromEntries(Object.entries(current).filter(([, item]) => item.sessionId !== next.sessionId))
    : current
  return { ...kept, [next.runId]: next }
}


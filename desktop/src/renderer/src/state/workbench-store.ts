import type { EventEnvelope, JsonValue, ResponseEnvelope } from '../../../shared/protocol'
import {
  arrayObjects,
  changesFromPayload,
  historyFromPayload,
  isModelStream,
  isStreamReplacedBy,
  jobsFromPayload,
  mergeTimeline,
  modelRequestIdFromData,
  numberValue,
  objectValue,
  presentationsFromPayload,
  roleValue,
  searchHits,
  stringValue,
} from './projection-parsers'
import { mergeTurnInputTimeline, turnInputTimelineFromSnapshot } from './turn-inputs'

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

export type ActivityRoute = 'agent' | 'runs' | 'workspace' | 'knowledge' | 'schedules' | 'search' | 'changes' | 'jobs' | 'operations' | 'settings'
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
const DEVICE_NOTICES_KEPT = 10

export interface SubagentView {
  runId: string
  sessionId: string
  title: string
  state: string
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

interface StoreOptions {
  requestResync?: () => void
  maxBufferedCount?: number
  maxBufferedBytes?: number
  maxBufferedDistance?: number
  ipcGapGraceMs?: number
}

const DEFAULT_BUFFER_COUNT = 256
const DEFAULT_BUFFER_BYTES = 256 * 1024
const DEFAULT_BUFFER_DISTANCE = 512

function recentWorkspacesFromPayload(value: JsonValue | undefined): RecentWorkspace[] {
  return arrayObjects(value).flatMap((item) => {
    const path = stringValue(item.path)
    const name = stringValue(item.name)
    if (!path || !name) return []
    return [{ path, name, lastUsed: numberValue(item.lastUsed) ?? 0 }]
  })
}

export function workspacePathKey(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '')
  return /^[a-z]:\//i.test(normalized) || normalized.startsWith('//') ? normalized.toLocaleLowerCase() : normalized
}

function workspaceGroupsFromPayload(value: JsonValue | undefined): WorkspaceConversationGroup[] {
  return arrayObjects(value).flatMap((group) => {
    const path = stringValue(group.path)
    const name = stringValue(group.name)
    if (!path || !name) return []
    return [{ path, name, lastUsed: numberValue(group.lastUsed) ?? 0,
      sessions: arrayObjects(group.sessions).filter(session => typeof session.id === 'string'),
      sessionPresentation: presentationsFromPayload(group.sessionPresentation),
      hasMore: group.hasMore === true, nextOffset: numberValue(group.nextOffset) ?? null }]
  })
}

function mergeDirectorySessions(
  existing: Array<Record<string, JsonValue>>, incoming: Array<Record<string, JsonValue>>,
): Array<Record<string, JsonValue>> {
  const sessions = new Map(existing.map(session => [stringValue(session.id), session]))
  for (const session of incoming) sessions.set(stringValue(session.id), session)
  return [...sessions.values()]
}

function rememberCurrentWorkspace(state: WorkbenchState): WorkspaceDirectory {
  const directory: WorkspaceDirectory = state.workspaceDirectory ?? { groups: [], state: 'idle', nextWorkspaceOffset: null }
  const path = stringValue(state.workspace?.path)
  if (!path || !state.sessions.length) return directory
  const matching = directory.groups.find(group => workspacePathKey(group.path) === workspacePathKey(path))
  const group: WorkspaceConversationGroup = {
    path, name: stringValue(state.workspace?.name) ?? path.split(/[\\/]/).at(-1) ?? path,
    lastUsed: matching?.lastUsed ?? 0,
    sessions: mergeDirectorySessions(matching?.sessions ?? [], state.sessions.filter(session => !session.workspace || workspacePathKey(String(session.workspace)) === workspacePathKey(path))),
    sessionPresentation: { ...matching?.sessionPresentation, ...state.operational.sessionPresentation },
    hasMore: matching?.hasMore ?? false, nextOffset: matching?.nextOffset ?? null,
  }
  return { ...directory, groups: matching
    ? directory.groups.map(item => item === matching ? group : item)
    : [...directory.groups, group] }
}

const INITIAL_STATE: WorkbenchState = {
  bootstrapVersion: 0,
  runtime: {
    epoch: null,
    sequence: 0,
    ready: false,
    state: 'unconfigured',
    mode: 'coding',
    autonomy: 'workspace',
    pendingAutonomy: null,
    hostSessionId: null,
    activeTurn: null,
    queuedTurnCount: 0,
    stale: false,
    streamRecovery: null,
  },
  workspace: null,
  recentWorkspaces: [],
  workspaceDirectory: { groups: [], state: 'idle', nextWorkspaceOffset: null },
  provider: null,
  sessions: [],
  selectedSession: null,
  timeline: [],
  history: { hasMore: false, nextCursor: null, cutoff: 0 },
  approvals: {},
  tools: {},
  operational: {
    route: 'agent',
    inspectorTab: 'context',
    sessionPresentation: {},
    search: { query: '', state: 'idle', results: [] },
    workspaceSummary: null,
    changes: [],
    changesTruncated: false,
    selectedChange: null,
    jobs: [],
    jobsState: 'idle',
    jobsSessionId: null,
    selectedJobLog: null,
    logs: [],
    queue: [],
    queueCounts: {},
    queueState: 'idle',
    collaborations: [],
    deliveries: [],
    orchestrationState: 'idle',
    terminals: {},
    terminalState: 'idle',
    operationalEvents: [],
    eventReplayCursor: 0,
    eventReplayEpoch: null,
    eventReplayOldestSequence: null,
    eventReplayNewestSequence: null,
    eventReplayHasMore: false,
    eventReplaySessionId: null,
  },
}

function clearEventReplay(operational: OperationalProjection): OperationalProjection {
  return {
    ...operational,
    operationalEvents: [],
    eventReplayCursor: 0,
    eventReplayEpoch: null,
    eventReplayOldestSequence: null,
    eventReplayNewestSequence: null,
    eventReplayHasMore: false,
    eventReplaySessionId: null,
  }
}

function queueTasksFromPayload(value: JsonValue | undefined): QueueTaskView[] {
  return arrayObjects(value).flatMap((item) => {
    const id = stringValue(item.id)
    const status = stringValue(item.status)
    if (!id || !status) return []
    return [{
      id,
      workspace: stringValue(item.workspace) ?? undefined,
      prompt: stringValue(item.prompt) ?? undefined,
      model: stringValue(item.model) ?? undefined,
      status,
      error: stringValue(item.error),
      createdAt: stringValue(item.createdAt) ?? stringValue(item.created_at) ?? undefined,
      updatedAt: stringValue(item.updatedAt) ?? stringValue(item.updated_at) ?? undefined,
      priority: numberValue(item.priority),
      owner: stringValue(item.owner),
      leaseUntil: stringValue(item.leaseUntil) ?? stringValue(item.lease_until),
      attempt: numberValue(item.attempt),
    }]
  })
}

function orchestrationFromPayload(value: JsonValue | undefined, kind: OrchestrationView['kind']): OrchestrationView[] {
  return arrayObjects(value).flatMap((item) => {
    const id = stringValue(item.id)
    const stateValue = stringValue(item.state)
    if (!id || !stateValue) return []
    const members = Array.isArray(item.members)
      ? item.members.filter((entry): entry is Record<string, JsonValue> => Boolean(entry && typeof entry === 'object' && !Array.isArray(entry)))
      : undefined
    return [{
      id,
      kind,
      sessionId: stringValue(item.sessionId) ?? stringValue(item.session_id) ?? undefined,
      title: stringValue(item.title) ?? undefined,
      goal: stringValue(item.goal) ?? undefined,
      state: stateValue,
      phase: stringValue(item.phase) ?? undefined,
      detail: stringValue(item.detail),
      finalText: stringValue(item.finalText) ?? stringValue(item.final_text),
      routeId: stringValue(item.routeId) ?? stringValue(item.route_id) ?? undefined,
      canResume: item.canResume === true || item.can_resume === true,
      canCancel: item.canCancel !== false && item.can_cancel !== false,
      updatedAt: stringValue(item.updatedAt) ?? stringValue(item.updated_at) ?? undefined,
      members,
    }]
  })
}

function terminalFromPayload(value: JsonValue | undefined): TerminalView | null {
  const item = objectValue(value)
  const sessionId = stringValue(item?.sessionId) ?? stringValue(item?.session_id)
  const id = stringValue(item?.id) ?? stringValue(item?.terminalId) ?? stringValue(item?.terminal_id) ?? sessionId
  const stateValue = stringValue(item?.state) ?? stringValue(item?.status)
  if (!id || !stateValue) return null
  const argv = Array.isArray(item?.argv) ? item.argv.filter((entry): entry is string => typeof entry === 'string') : undefined
  return {
    id,
    sessionId: sessionId ?? undefined,
    state: stateValue,
    argv,
    cwd: stringValue(item?.cwd) ?? undefined,
    output: stringValue(item?.output) ?? undefined,
    offset: numberValue(item?.offset) ?? numberValue(item?.outputOffset),
    outputOffset: numberValue(item?.outputOffset),
    nextOffset: numberValue(item?.nextOffset),
    exitCode: numberValue(item?.exitCode),
    startedAt: stringValue(item?.startedAt) ?? stringValue(item?.started_at) ?? undefined,
    endedAt: stringValue(item?.endedAt) ?? stringValue(item?.ended_at),
    owner: stringValue(item?.owner),
  }
}

function approvalsFromPayload(value: JsonValue | undefined): WorkbenchState['approvals'] {
  const approvals: WorkbenchState['approvals'] = {}
  for (const approval of arrayObjects(value)) {
    const requestId = stringValue(approval.requestId)
    if (requestId) approvals[requestId] = approval
  }
  return approvals
}

function sessionRuntimesFromPayload(value: JsonValue | undefined): Record<string, SessionRuntimeProjection> {
  const sessions: Record<string, SessionRuntimeProjection> = {}
  for (const item of arrayObjects(value)) {
    const sessionId = stringValue(item.sessionId)
    if (!sessionId) continue
    sessions[sessionId] = {
      sessionId,
      workspace: stringValue(item.workspace),
      ready: item.ready === true,
      state: stringValue(item.state) ?? 'unconfigured',
      activeTurn: stringValue(item.activeTurn),
      queuedTurnCount: numberValue(item.queuedCount) ?? 0,
      turnRequested: item.turnRequested === true,
    }
  }
  return sessions
}

function runtimeFromPayload(value: JsonValue | undefined, previous: RuntimeProjection): RuntimeProjection {
  const snapshot = objectValue(value)
  if (!snapshot) return previous
  return {
    ...previous,
    ready: typeof snapshot.ready === 'boolean' ? snapshot.ready : previous.ready,
    state: stringValue(snapshot.state) ?? previous.state,
    mode: stringValue(snapshot.mode) ?? previous.mode,
    autonomy: stringValue(snapshot.autonomy) ?? previous.autonomy,
    hostSessionId: stringValue(snapshot.hostSessionId),
    activeTurn: stringValue(snapshot.activeTurn),
    queuedTurnCount: numberValue(snapshot.queuedCount) ?? 0,
    activeSessions: snapshot.activeSessions === undefined
      ? previous.activeSessions ?? {} : sessionRuntimesFromPayload(snapshot.activeSessions),
    streamRecovery: null,
  }
}

export function createWorkbenchStore(options: StoreOptions = {}) {
  let state = structuredClone(INITIAL_STATE)
  let currentModelRequest: {
    id: string; correlationId: string | undefined; sessionId: string | null; epoch: string | null; completed: boolean
  } | null = null
  let resyncIssued = false
  let pendingCommands = 0
  let bufferedBytes = 0
  const buffered = new Map<string, EventEnvelope | ResponseEnvelope>()
  const deferredHistoryPages = new Map<string, ResponseEnvelope>()
  let pendingBootstraps = 0
  let latestSessionSwitchTarget: string | null = null
  let hasSessionRuntimeSnapshots = false
  let gapCheckTimer: ReturnType<typeof setTimeout> | null = null
  const listeners = new Set<(state: WorkbenchState) => void>()

  const publish = (): void => {
    for (const listener of listeners) listener(state)
  }

  const rememberForegroundRuntime = (): void => {
    const runtime = state.runtime
    const sessionId = runtime.hostSessionId
    if (!sessionId) return
    if (hasSessionRuntimeSnapshots && sessionId !== stringValue(state.selectedSession?.id)) return
    const previous = runtime.activeSessions?.[sessionId]
    state.runtime = {
      ...runtime,
      activeSessions: {
        ...runtime.activeSessions,
        [sessionId]: {
          ...previous,
          sessionId,
          workspace: previous?.workspace ?? stringValue(state.workspace?.path) ?? null,
          ready: runtime.ready,
          state: runtime.state,
          activeTurn: runtime.activeTurn,
          queuedTurnCount: runtime.queuedTurnCount ?? 0,
        },
      },
    }
  }

  const projectSessionRuntimeEvent = (event: EventEnvelope): void => {
    const sessionId = event.sessionId
    if (!sessionId) return
    const payload = event.payload
    const previous = state.runtime.activeSessions?.[sessionId]
    const summary: SessionRuntimeProjection = previous ?? {
      sessionId, workspace: stringValue(payload.workspace), state: 'unconfigured', ready: false, activeTurn: null, queuedTurnCount: 0,
    }
    let next: SessionRuntimeProjection | null = null
    if (event.type === 'turn.started') {
      next = { ...summary, activeTurn: stringValue(payload.turnId) ?? stringValue(payload.correlationId) ?? 'active', turnRequested: false,
        queuedTurnCount: numberValue(payload.queuedCount) ?? summary.queuedTurnCount }
    } else if (['turn.completed', 'turn.cancelled', 'turn.failed', 'runtime.command_rejected', 'runtime.error'].includes(event.type)) {
      const turnId = stringValue(payload.turnId) ?? stringValue(payload.correlationId)
      if (!turnId || !summary.activeTurn || summary.activeTurn === 'pending' || turnId === summary.activeTurn) {
        next = { ...summary, activeTurn: null, turnRequested: false, queuedTurnCount: numberValue(payload.queuedCount) ?? 0 }
      }
    } else if (event.type === 'runtime.started') {
      next = { ...summary, state: 'ready', ready: true, workspace: stringValue(payload.workspace) ?? summary.workspace }
    } else if (event.type === 'runtime.failed' || event.type === 'runtime.stopped') {
      next = { ...summary, state: event.type.slice('runtime.'.length), ready: false, activeTurn: null, turnRequested: false,
        queuedTurnCount: numberValue(payload.queuedCount) ?? 0 }
    }
    if (next) state.runtime = { ...state.runtime, activeSessions: { ...state.runtime.activeSessions, [sessionId]: next } }
  }

  const cancelGapCheck = (): void => {
    if (gapCheckTimer !== null) clearTimeout(gapCheckTimer)
    gapCheckTimer = null
  }

  const freeze = (): void => {
    cancelGapCheck()
    if (!state.runtime.stale) {
      state = { ...state, runtime: { ...state.runtime, stale: true, ready: false } }
      publish()
    }
    if (!resyncIssued) {
      resyncIssued = true
      options.requestResync?.()
    }
  }

  const envelopeEpoch = (envelope: EventEnvelope | ResponseEnvelope): string | null =>
    stringValue(envelope.payload.epoch)

  const clearBuffered = (): void => {
    cancelGapCheck()
    buffered.clear()
    bufferedBytes = 0
  }

  const discardBufferedThrough = (sequence: number): void => {
    for (const [key, envelope] of buffered) {
      if (envelopeEpoch(envelope) !== state.runtime.epoch || envelope.sequence > sequence) continue
      buffered.delete(key)
      bufferedBytes -= new TextEncoder().encode(JSON.stringify(envelope)).byteLength
    }
    if (buffered.size === 0) cancelGapCheck()
    if (bufferedBytes < 0) bufferedBytes = 0
  }

  const bufferEnvelope = (envelope: EventEnvelope | ResponseEnvelope): boolean => {
    const size = new TextEncoder().encode(JSON.stringify(envelope)).byteLength
    const key = `${envelopeEpoch(envelope) ?? ''}:${envelope.sequence}`
    const previous = buffered.get(key)
    const previousSize = previous
      ? new TextEncoder().encode(JSON.stringify(previous)).byteLength
      : 0
    const count = buffered.size + (previous ? 0 : 1)
    const bytes = bufferedBytes - previousSize + size
    const distance =
      state.runtime.epoch !== null && envelopeEpoch(envelope) === state.runtime.epoch
        ? envelope.sequence - state.runtime.sequence
        : envelope.sequence
    if (
      count > (options.maxBufferedCount ?? DEFAULT_BUFFER_COUNT) ||
      bytes > (options.maxBufferedBytes ?? DEFAULT_BUFFER_BYTES) ||
      distance > (options.maxBufferedDistance ?? DEFAULT_BUFFER_DISTANCE)
    ) {
      clearBuffered()
      freeze()
      return false
    }
    buffered.set(key, envelope)
    bufferedBytes = bytes
    return true
  }

  const applyBootstrap = (response: ResponseEnvelope): void => {
    if (response.type !== 'app.bootstrap.result') return
    const payload = response.payload
    const epoch = stringValue(payload.epoch)
    const watermark = numberValue(payload.watermark)
    const runtime = objectValue(payload.runtime)
    const selectedSession = objectValue(payload.selectedSession)
    if (!epoch || watermark === undefined || watermark !== response.sequence || !runtime) {
      freeze()
      return
    }
    hasSessionRuntimeSnapshots = runtime.activeSessions !== undefined
    const approvals = approvalsFromPayload(payload.approvals)
    const handoff = [...buffered.values()]
      .filter((item) => envelopeEpoch(item) === epoch && item.sequence > watermark)
      .sort((left, right) => left.sequence - right.sequence)
    const coveredHistoryPages = [...buffered.values()]
      .filter((item): item is ResponseEnvelope =>
        item.kind === 'response' &&
        item.type === 'session.history.result' &&
        envelopeEpoch(item) === epoch &&
        item.sequence <= watermark,
      )
      .sort((left, right) => left.sequence - right.sequence)
    const recoverableHistoryPages = new Map<string, ResponseEnvelope>()
    for (const page of [...coveredHistoryPages, ...deferredHistoryPages.values()]) {
      recoverableHistoryPages.set(page.requestId, page)
    }
    const snapshotTimeline = turnInputTimelineFromSnapshot(payload.timeline)
    const snapshotHistory = historyFromPayload(payload.history)
    const previousSessionId = stringValue(state.selectedSession?.id)
    const nextSessionId = stringValue(selectedSession?.id)
    const preserveLoadedHistory = Boolean(
      previousSessionId &&
      previousSessionId === nextSessionId &&
      state.runtime.epoch === epoch &&
      state.timeline.length > 0 &&
      state.history.cutoff <= snapshotHistory.cutoff,
    )
    state = {
      bootstrapVersion: (state.bootstrapVersion ?? 0) + 1,
      runtime: {
        epoch,
        sequence: watermark,
        ready: payload.ready === true,
        state: stringValue(runtime.state) ?? 'unconfigured',
        mode: stringValue(runtime.mode) ?? 'coding',
        autonomy: stringValue(runtime.autonomy) ?? stringValue(selectedSession?.autonomy) ?? 'workspace',
        pendingAutonomy: null,
        hostSessionId: stringValue(runtime.hostSessionId),
        activeTurn: stringValue(runtime.activeTurn),
        queuedTurnCount: numberValue(runtime.queuedCount) ?? 0,
        activeSessions: sessionRuntimesFromPayload(runtime.activeSessions),
        stale: false,
        streamRecovery: null,
      },
      workspace: objectValue(payload.workspace),
      recentWorkspaces: recentWorkspacesFromPayload(payload.recentWorkspaces),
      workspaceDirectory: state.runtime.epoch === epoch ? rememberCurrentWorkspace(state) : { groups: [], state: 'idle', nextWorkspaceOffset: null },
      provider: objectValue(payload.provider),
      sessions: arrayObjects(payload.sessions),
      selectedSession,
      timeline: preserveLoadedHistory
        ? mergeTurnInputTimeline(state.timeline, snapshotTimeline)
        : snapshotTimeline,
      history: preserveLoadedHistory
        ? { ...state.history, cutoff: snapshotHistory.cutoff }
        : snapshotHistory,
      approvals,
      tools: {},
      operational: {
        ...structuredClone(INITIAL_STATE.operational),
        route: state.operational.route,
        inspectorTab: state.operational.inspectorTab,
        sessionPresentation: presentationsFromPayload(payload.sessionPresentation),
      },
      // No snapshot carries these: what phones sent stays until it is closed, and requests to
      // phones stay while the same sidecar runs them.
      ...(state.deviceNotices ? { deviceNotices: state.deviceNotices } : {}),
      ...(state.phoneJobs && state.runtime.epoch === epoch ? { phoneJobs: state.phoneJobs } : {}),
    }
    rememberForegroundRuntime()
    for (const page of [...recoverableHistoryPages.values()].sort((left, right) => left.sequence - right.sequence)) {
      projectHistoryPage(page, true)
    }
    deferredHistoryPages.clear()
    clearBuffered()
    resyncIssued = false
    publish()
    for (const item of handoff) {
      if (item.sequence !== state.runtime.sequence + 1) {
        freeze()
        break
      }
      if (item.kind === 'event') projectEvent(item)
      else projectResponse(item)
    }
  }

  const projectHistoryPage = (
    response: ResponseEnvelope,
    requireMatchingCutoff = false,
  ): boolean => {
    if (
      response.type !== 'session.history.result' ||
      response.sessionId !== stringValue(state.selectedSession?.id) ||
      stringValue(response.payload.epoch) !== state.runtime.epoch
    ) {
      return false
    }
    const incomingHistory = historyFromPayload(response.payload.history)
    if (requireMatchingCutoff && incomingHistory.cutoff > state.history.cutoff) return false
    state = {
      ...state,
      timeline: mergeTurnInputTimeline(state.timeline, turnInputTimelineFromSnapshot(response.payload.timeline)),
      history: {
        ...incomingHistory,
        cutoff: Math.max(state.history.cutoff, incomingHistory.cutoff),
      },
    }
    return true
  }

  const projectResponse = (response: ResponseEnvelope, options: { suppressSessionActivation?: boolean } = {}): void => {
    state = { ...state, runtime: { ...state.runtime, sequence: Math.max(state.runtime.sequence, response.sequence) } }
    const responseBelongsToSelection = response.sessionId === stringValue(state.selectedSession?.id)
    if (response.type === 'turn.start.result' && response.sessionId) {
      const sessionId = response.sessionId
      const previous = state.runtime.activeSessions?.[sessionId]
      state.runtime = { ...state.runtime, activeSessions: { ...state.runtime.activeSessions, [sessionId]: {
        sessionId,
        workspace: previous?.workspace ?? null,
        state: previous?.state ?? 'ready',
        ready: previous?.ready ?? true,
        activeTurn: response.payload.requested === true && !previous?.activeTurn ? 'pending' : previous?.activeTurn ?? null,
        queuedTurnCount: numberValue(response.payload.queuedCount) ?? previous?.queuedTurnCount ?? 0,
        turnRequested: response.payload.requested === true,
      } } }
    }
    if (response.type === 'turn.start.result' && responseBelongsToSelection) {
      state = {
        ...state,
        runtime: {
          ...state.runtime,
          activeTurn: response.payload.requested === true && state.runtime.activeTurn === null
            ? 'pending'
            : state.runtime.activeTurn,
          queuedTurnCount: numberValue(response.payload.queuedCount) ?? state.runtime.queuedTurnCount,
        },
      }
    }
    if (response.type === 'runtime.autonomy.set.result' && responseBelongsToSelection) {
      const autonomy = stringValue(response.payload.autonomy)
      if (autonomy) {
        const pending = response.payload.pending === true || response.payload.applied === false
        const previousAutonomy = state.runtime.autonomy
        state = {
          ...state,
          runtime: {
            ...state.runtime,
            autonomy: pending ? previousAutonomy : autonomy,
            pendingAutonomy: pending ? autonomy : null,
            state: pending ? 'switching' : state.runtime.state,
            ready: pending ? false : state.runtime.ready,
          },
          selectedSession: pending || !state.selectedSession ? state.selectedSession : { ...state.selectedSession, autonomy },
          sessions: state.sessions.map((session) =>
            session.id === response.sessionId && !pending ? { ...session, autonomy } : session,
          ),
        }
      }
    }
    if (response.type === 'workspace.sessions.list.result') {
      const directory = rememberCurrentWorkspace(state)
      const incoming = workspaceGroupsFromPayload(response.payload.workspaces)
      const partial = response.payload.partial === true
      const groups = partial ? [...directory.groups] : []
      for (const group of incoming) {
        const index = groups.findIndex(item => workspacePathKey(item.path) === workspacePathKey(group.path))
        const previous = index >= 0 ? groups[index] : undefined
        const rawGroup = arrayObjects(response.payload.workspaces).find(item => item.path === group.path)
        const append = (numberValue(rawGroup?.offset) ?? 0) > 0
        const merged = previous && append ? { ...group,
          sessions: mergeDirectorySessions(previous.sessions, group.sessions),
          sessionPresentation: { ...previous.sessionPresentation, ...group.sessionPresentation },
        } : group
        if (index >= 0) groups[index] = merged
        else groups.push(merged)
      }
      state = { ...state, workspaceDirectory: {
        groups, state: 'ready', nextWorkspaceOffset: partial && response.payload.workspaceOffset === undefined
          ? directory.nextWorkspaceOffset : numberValue(response.payload.nextWorkspaceOffset) ?? null,
      } }
    } else if (response.type === 'session.list.result') {
      state = { ...state, sessions: arrayObjects(response.payload.sessions) }
    } else if (response.type === 'session.open.result') {
      const session = objectValue(response.payload.session)
      const id = stringValue(session?.id)
      const responseSessionId = id ?? response.sessionId
      const isLatestTarget = latestSessionSwitchTarget === null || responseSessionId === null || responseSessionId === latestSessionSwitchTarget
      if (!options.suppressSessionActivation && isLatestTarget && session && id && response.sessionId === id) {
        const sessionChanged = stringValue(state.selectedSession?.id) !== id
        const hasRuntimeSnapshot = objectValue(response.payload.runtime) !== null
        if (hasRuntimeSnapshot) hasSessionRuntimeSnapshots = true
        state = {
          ...state,
          runtime: {
            ...runtimeFromPayload(response.payload.runtime, state.runtime),
            ...(!hasRuntimeSnapshot ? {
              hostSessionId: stringValue(response.payload.hostSessionId),
              ...(response.payload.switching === true ? { state: 'switching', ready: false } : {}),
            } : {}),
            autonomy: stringValue(session.autonomy) ?? state.runtime.autonomy,
            pendingAutonomy: null,
          },
          sessions: [session, ...state.sessions.filter((item) => item.id !== id)],
          selectedSession: session,
          timeline: turnInputTimelineFromSnapshot(response.payload.timeline),
          history: historyFromPayload(response.payload.history),
          approvals: approvalsFromPayload(response.payload.approvals),
          tools: {},
          operational: {
            ...(sessionChanged ? clearEventReplay(state.operational) : state.operational),
            changes: [],
            changesTruncated: false,
            selectedChange: null,
            jobs: [],
            jobsState: 'idle',
            jobsSessionId: id,
            selectedJobLog: null,
            logs: [],
          },
        }
      }
    } else if (response.type === 'session.history.result' && responseBelongsToSelection) {
      projectHistoryPage(response)
    } else if (response.type === 'session.create.result') {
      const session = objectValue(response.payload.session)
      const id = stringValue(session?.id)
      if (session && id) {
        const sessionChanged = stringValue(state.selectedSession?.id) !== id
        const hasRuntimeSnapshot = objectValue(response.payload.runtime) !== null
        if (hasRuntimeSnapshot) hasSessionRuntimeSnapshots = true
        state = {
          ...state,
          runtime: {
            ...runtimeFromPayload(response.payload.runtime, state.runtime),
            ...(!hasRuntimeSnapshot ? { hostSessionId: stringValue(response.payload.hostSessionId) ?? state.runtime.hostSessionId } : {}),
            autonomy: stringValue(session.autonomy) ?? state.runtime.autonomy,
            pendingAutonomy: null,
          },
          sessions: [session, ...state.sessions.filter((item) => item.id !== id)],
          selectedSession: session,
          timeline: [],
          history: { hasMore: false, nextCursor: null, cutoff: 0 },
          approvals: approvalsFromPayload(response.payload.approvals),
          tools: {},
          operational: {
            ...(sessionChanged ? clearEventReplay(state.operational) : state.operational),
            changes: [],
            changesTruncated: false,
            selectedChange: null,
            jobs: [],
            jobsState: 'idle',
            jobsSessionId: id,
            selectedJobLog: null,
            logs: [],
          },
        }
      }
    } else if (response.type === 'session.presentation.set.result') {
      const presentation = objectValue(response.payload.presentation)
      const sessionId = stringValue(presentation?.sessionId)
      if (presentation && sessionId && typeof presentation.pinned === 'boolean' && typeof presentation.archived === 'boolean') {
        state = {
          ...state,
          operational: {
            ...state.operational,
            sessionPresentation: {
              ...state.operational.sessionPresentation,
              [sessionId]: {
                sessionId,
                alias: stringValue(presentation.alias),
                pinned: presentation.pinned,
                archived: presentation.archived,
                version: numberValue(presentation.version) ?? 1,
              },
            },
          },
        }
      }
    } else if (response.type === 'session.search.result') {
      state = {
        ...state,
        operational: {
          ...state.operational,
          search: {
            query: stringValue(response.payload.query) ?? '',
            state: response.payload.indexState === 'unavailable' ? 'unavailable' : 'ready',
            results: searchHits(response.payload.results),
          },
        },
      }
    } else if (response.type === 'workspace.summary.get.result') {
      state = {
        ...state,
        operational: { ...state.operational, workspaceSummary: { ...response.payload } },
      }
    } else if (response.type === 'changes.list.result' && responseBelongsToSelection) {
      state = {
        ...state,
        operational: {
          ...state.operational,
          changes: changesFromPayload(response.payload.changesets),
          changesTruncated: response.payload.truncated === true,
        },
      }
    } else if (response.type === 'changes.inspect.result' && responseBelongsToSelection) {
      state = {
        ...state,
        operational: {
          ...state.operational,
          selectedChange: { ...response.payload },
        },
      }
    } else if (response.type === 'jobs.list.result') {
      const requestedSessionId = state.operational.jobsSessionId ?? null
      const responseSessionId = response.sessionId ?? null
      if (requestedSessionId !== responseSessionId) return
      state = {
        ...state,
        operational: {
          ...state.operational,
          jobs: jobsFromPayload(response.payload.jobs),
          jobsState: 'ready',
          jobsSessionId: responseSessionId,
        },
      }
    } else if (response.type === 'provider.default.result' && response.payload.applied === true) {
      const provider = objectValue(response.payload.provider)
      const providerId = stringValue(provider?.id)
      if (provider && providerId) {
        state = { ...state, provider }
      }
    } else if (response.type === 'jobs.logs.result' && responseBelongsToSelection) {
      state = {
        ...state,
        operational: { ...state.operational, selectedJobLog: { ...response.payload } },
      }
    } else if (response.type === 'jobs.stop.result' && responseBelongsToSelection) {
      const jobs = jobsFromPayload([response.payload.job] as JsonValue)
      const stopped = jobs[0]
      if (stopped) {
        state = {
          ...state,
          operational: {
            ...state.operational,
            jobs: [
              stopped,
              ...state.operational.jobs.filter((job) => job.jobId !== stopped.jobId),
            ],
          },
        }
      }
    } else if (response.type === 'workspace.queue.list.result' || response.type === 'workspace.queue.get.result') {
      const task = response.type === 'workspace.queue.get.result'
        ? queueTasksFromPayload([response.payload.task] as JsonValue)[0]
        : undefined
      const tasks = response.type === 'workspace.queue.list.result'
        ? queueTasksFromPayload(response.payload.tasks)
        : task ? [task, ...state.operational.queue.filter((item) => item.id !== task.id)] : state.operational.queue
      const counts = objectValue(response.payload.counts)
      state = {
        ...state,
        operational: {
          ...state.operational,
          queue: tasks,
          queueCounts: counts ? Object.fromEntries(Object.entries(counts).flatMap(([key, value]) => typeof value === 'number' ? [[key, value]] : [])) : state.operational.queueCounts,
          queueState: 'ready',
        },
      }
    } else if (response.type.startsWith('schedules.') && typeof response.payload.unread === 'number') {
      state = { ...state, scheduleInbox: { unread: response.payload.unread } }
    } else if (response.type.startsWith('workspace.collaborations.') && response.type.endsWith('.result')) {
      const values = orchestrationFromPayload(response.payload.items, 'collaboration')
      const item = orchestrationFromPayload([response.payload.item] as JsonValue, 'collaboration')[0]
      const next = values.length ? values : state.operational.collaborations
      state = { ...state, operational: { ...state.operational, collaborations: item ? [item, ...next.filter((entry) => entry.id !== item.id)] : next, orchestrationState: 'ready' } }
    } else if (response.type.startsWith('workspace.deliveries.') && response.type.endsWith('.result')) {
      const values = orchestrationFromPayload(response.payload.items, 'delivery')
      const item = orchestrationFromPayload([response.payload.item] as JsonValue, 'delivery')[0]
      const next = values.length ? values : state.operational.deliveries
      state = { ...state, operational: { ...state.operational, deliveries: item ? [item, ...next.filter((entry) => entry.id !== item.id)] : next, orchestrationState: 'ready' } }
    } else if (response.type === 'terminal.list.result') {
      const terminals = arrayObjects(response.payload.terminals).flatMap((item) => {
        const terminal = terminalFromPayload(item)
        return terminal ? [[terminal.id, terminal] as const] : []
      })
      state = {
        ...state,
        operational: {
          ...state.operational,
          terminals: { ...state.operational.terminals, ...Object.fromEntries(terminals) },
          terminalState: 'ready',
        },
      }
    } else if (response.type.startsWith('terminal.') && response.type.endsWith('.result')) {
      const terminal = terminalFromPayload(response.payload.terminal)
      if (terminal) state = { ...state, operational: { ...state.operational, terminals: { ...state.operational.terminals, [terminal.id]: terminal }, terminalState: 'ready' } }
    } else if (response.type === 'events.replay.result' && responseBelongsToSelection) {
      const replayEpoch = stringValue(response.payload.epoch)
      const replayCursor = numberValue(response.payload.nextSequence) ?? numberValue(response.payload.afterSequence)
      const replaySessionId = response.sessionId ?? null
      const epochChanged = state.operational.eventReplayEpoch !== null &&
        replayEpoch !== null && state.operational.eventReplayEpoch !== replayEpoch
      const sessionChanged = state.operational.eventReplaySessionId !== null &&
        state.operational.eventReplaySessionId !== replaySessionId
      const previousEvents = epochChanged || sessionChanged ? [] : state.operational.operationalEvents
      const replayedEvents = arrayObjects(response.payload.events).flatMap((item): OperationalEventView[] => {
        const type = stringValue(item.type)
        if (!type) return []
        const data = objectValue(item.data) ?? objectValue(item.payload) ?? item
        const phase = stringValue(data.phase) ?? stringValue(data.phaseId) ?? stringValue(data.stepId)
        const text = stringValue(data.message) ?? stringValue(data.text) ?? stringValue(data.detail) ??
          stringValue(data.reason) ?? stringValue(data.error) ?? stringValue(data.content) ??
          stringValue(data.result) ?? stringValue(data.title) ?? type
        return [{
          sequence: numberValue(item.sequence) ?? numberValue(item.domainSequence) ?? response.sequence,
          type: phase && type.startsWith('task.phase.') ? `${type}:${phase}` : type,
          text,
          createdAt: stringValue(item.createdAt) ?? undefined,
        }]
      })
      const existing = new Set(previousEvents.map((item) => `${item.sequence}:${item.type}:${item.text}`))
      const events = [
        ...previousEvents,
        ...replayedEvents.filter((item) => !existing.has(`${item.sequence}:${item.type}:${item.text}`)),
      ].sort((left, right) => left.sequence - right.sequence).slice(-200)
      state = {
        ...state,
        operational: {
          ...state.operational,
          operationalEvents: events,
          eventReplayCursor: replayCursor === undefined
            ? state.operational.eventReplayCursor
            : epochChanged ? replayCursor : Math.max(state.operational.eventReplayCursor, replayCursor),
          eventReplayEpoch: replayEpoch ?? state.operational.eventReplayEpoch,
          eventReplayOldestSequence: numberValue(response.payload.oldestSequence) ?? null,
          eventReplayNewestSequence: numberValue(response.payload.newestSequence) ?? null,
          eventReplayHasMore: response.payload.hasMore === true,
          eventReplaySessionId: replaySessionId,
        },
      }
    }
    rememberForegroundRuntime()
  }

  const projectEvent = (event: EventEnvelope): void => {
    state = { ...state, runtime: { ...state.runtime, sequence: event.sequence } }
    const payload = event.payload
    const selectedId = stringValue(state.selectedSession?.id)
    const belongsToSelection = event.sessionId === null || event.sessionId === selectedId
    const activatesLatestTarget = ['session.opened', 'runtime.session_switch_failed', 'runtime.started'].includes(event.type) &&
      event.sessionId !== null && event.sessionId === latestSessionSwitchTarget
    const belongsToRuntime = event.sessionId === null || (!hasSessionRuntimeSnapshots && event.sessionId === state.runtime.hostSessionId) ||
      event.sessionId === selectedId || activatesLatestTarget
    if (event.type === 'runtime.display_truncated') {
      // The gateway deliberately emits this boundary after dropping only a
      // display delta or compacting an oversized payload. The durable event
      // log/bootstrap remains authoritative, so freezing the whole runtime
      // here strands the live turn and makes a recoverable display loss look
      // like a failed model request. Keep sequencing live and request one
      // authoritative refresh instead.
      state = {
        ...state,
        runtime: belongsToRuntime ? {
          ...state.runtime,
          streamRecovery: { status: 'recovering', attempt: 0, maxAttempts: 0 },
        } : state.runtime,
        operational: belongsToSelection ? {
          ...state.operational,
          logs: [
            ...state.operational.logs,
            {
              sequence: event.sequence,
              type: event.type,
              text: stringValue(payload.reason) ?? 'display stream resynchronization requested',
              sessionId: event.sessionId,
              createdAt: stringValue(payload.createdAt) ?? undefined,
            },
          ].slice(-100),
        } : state.operational,
      }
      if (!resyncIssued) {
        resyncIssued = true
        options.requestResync?.()
      }
      publish()
      return
    }

    projectSessionRuntimeEvent(event)
    if (payload.displayTruncated === true && !resyncIssued) {
      resyncIssued = true
      state = {
        ...state,
        runtime: belongsToRuntime ? {
          ...state.runtime,
          streamRecovery: { status: 'recovering', attempt: 0, maxAttempts: 0 },
        } : state.runtime,
      }
      options.requestResync?.()
    }
    if (belongsToSelection) {
      const text = (
        stringValue(payload.message) ?? stringValue(payload.reason) ??
        stringValue(payload.state) ?? event.type
      ).slice(0, 2_000)
      state.operational = {
        ...state.operational,
        logs: [...state.operational.logs, {
          sequence: event.sequence,
          type: event.type,
          text,
          sessionId: event.sessionId,
          createdAt: stringValue(payload.createdAt) ?? undefined,
        }].slice(-100),
      }
    }
    if (belongsToRuntime) {
      if (event.type === 'runtime.started') {
        const startedWorkspace = stringValue(payload.workspace)
        if (startedWorkspace) {
          state.workspace = {
            path: startedWorkspace,
            name: startedWorkspace.split(/[\\/]/).filter(Boolean).at(-1) ?? startedWorkspace,
          }
        }
        state.runtime = state.runtime.pendingAutonomy !== null || state.runtime.state === 'switching'
          ? { ...state.runtime, ready: false, state: 'switching' }
          : { ...state.runtime, ready: true, state: 'ready' }
      } else if (event.type === 'runtime.workspace_switch_failed') {
        const restored = payload.restored === true
        state.runtime = {
          ...state.runtime,
          ready: restored && state.runtime.hostSessionId !== null,
          state: restored && state.runtime.hostSessionId !== null ? 'ready' : 'failed',
        }
      } else if (event.type === 'runtime.failed' || event.type === 'runtime.stopped') {
        state.runtime = {
          ...state.runtime,
          ready: false,
          state: event.type.split('.')[1] ?? 'failed',
          activeTurn: null,
          queuedTurnCount: numberValue(payload.queuedCount) ?? 0,
          streamRecovery: null,
        }
      } else if (event.type === 'runtime.command_rejected' || event.type === 'runtime.error') {
        state.runtime = {
          ...state.runtime,
          activeTurn: null,
          queuedTurnCount: numberValue(payload.queuedCount) ?? 0,
          streamRecovery: null,
        }
      } else if (event.type === 'runtime.mode_applied' || event.type === 'mode.changed') {
        state.runtime = {
          ...state.runtime,
          mode: stringValue(payload.mode) ?? stringValue(payload.toMode) ?? state.runtime.mode,
        }
      } else if (event.type === 'runtime.autonomy_pending') {
        state.runtime = {
          ...state.runtime,
          pendingAutonomy: stringValue(payload.autonomy),
          state: 'switching',
          ready: false,
        }
      } else if (event.type === 'runtime.autonomy_applied') {
        const autonomy = stringValue(payload.autonomy) ?? stringValue(payload.toAutonomy)
        if (autonomy) {
          state.runtime = {
            ...state.runtime,
            autonomy,
            pendingAutonomy: null,
            state: 'ready',
            ready: true,
          }
          if (state.selectedSession) {
            state.selectedSession = { ...state.selectedSession, autonomy }
          }
          state.sessions = state.sessions.map((session) =>
            session.id === event.sessionId ? { ...session, autonomy } : session,
          )
        }
      } else if (event.type === 'autonomy.changed') {
        const autonomy = stringValue(payload.toAutonomy) ?? stringValue(payload.autonomy)
        if (autonomy) {
          state.runtime = {
            ...state.runtime,
            pendingAutonomy: state.runtime.pendingAutonomy ?? autonomy,
            state: 'switching',
            ready: false,
          }
        }
      } else if (event.type === 'runtime.autonomy_failed') {
        const autonomy = stringValue(payload.autonomy)
        if (autonomy) {
          state.runtime = {
            ...state.runtime,
            autonomy,
            pendingAutonomy: null,
            state: state.runtime.hostSessionId ? 'ready' : 'failed',
            ready: state.runtime.hostSessionId !== null,
          }
          if (state.selectedSession) {
            state.selectedSession = { ...state.selectedSession, autonomy }
          }
          state.sessions = state.sessions.map((session) =>
            session.id === event.sessionId ? { ...session, autonomy } : session,
          )
        }
      } else if (event.type === 'session.opened') {
        const openedSessionId = event.sessionId ?? stringValue(payload.sessionId)
        const isLatestTarget = latestSessionSwitchTarget === null || openedSessionId === null || openedSessionId === latestSessionSwitchTarget
        const hostSettled = payload.activated !== false || payload.hostSettled === true
        if (openedSessionId && isLatestTarget && hostSettled) {
          const openedSession = state.sessions.find((session) => stringValue(session.id) === openedSessionId)
          const sessionRuntime = state.runtime.activeSessions?.[openedSessionId]
          state.runtime = {
            ...state.runtime,
            hostSessionId: openedSessionId,
            state: 'ready',
            ready: true,
            ...(hasSessionRuntimeSnapshots ? {
              activeTurn: sessionRuntime?.activeTurn ?? null,
              queuedTurnCount: sessionRuntime?.queuedTurnCount ?? 0,
              streamRecovery: null,
              mode: stringValue(openedSession?.mode) ?? state.runtime.mode,
              autonomy: stringValue(openedSession?.autonomy) ?? state.runtime.autonomy,
            } : {}),
          }
          if (openedSession && payload.activated !== false) state.selectedSession = openedSession
          if (hasSessionRuntimeSnapshots && sessionRuntime?.workspace) {
            state.workspace = { path: sessionRuntime.workspace,
              name: sessionRuntime.workspace.split(/[\\/]/).filter(Boolean).at(-1) ?? sessionRuntime.workspace }
          }
        }
      } else if (event.type === 'runtime.session_switch_failed') {
        const targetSessionId =
          stringValue(payload.targetSessionId) ??
          stringValue(payload.target_session_id) ??
          stringValue(payload.sessionId) ??
          event.sessionId
        const latestTarget = latestSessionSwitchTarget
        const staleFailure =
          targetSessionId !== null && latestTarget !== null && targetSessionId !== latestTarget
        const retryable = payload.retryable === true
        // A late failure from an older lifecycle generation is diagnostic only. It
        // must not roll the renderer back to the old host after a newer click has
        // already selected another session.
        if (!staleFailure) {
          const previousHostSessionId =
            stringValue(payload.previousSessionId) ??
            stringValue(payload.previous_session_id) ??
            stringValue(payload.hostSessionId)
          const recovered = previousHostSessionId !== null
          state.runtime = retryable
            ? { ...state.runtime, state: 'switching', ready: false }
            : {
                ...state.runtime,
                hostSessionId: previousHostSessionId ?? state.runtime.hostSessionId,
                state: recovered ? 'ready' : 'failed',
                ready: recovered,
              }
        }
      } else if (event.type === 'turn.started') {
        state.runtime = {
          ...state.runtime,
          hostSessionId: event.sessionId,
          activeTurn: stringValue(payload.turnId) ?? stringValue(payload.correlationId) ?? 'active',
          queuedTurnCount: numberValue(payload.queuedCount) ?? state.runtime.queuedTurnCount,
          streamRecovery: null,
        }
      } else if (event.type === 'model.stream.interrupted') {
        const correlationId = stringValue(payload.correlationId) ?? state.runtime.activeTurn
        state.runtime = {
          ...state.runtime,
          streamRecovery: {
            status: 'interrupted',
            attempt: numberValue(payload.attempt) ?? 1,
            maxAttempts: numberValue(payload.max_attempts) ?? 3,
          },
        }
        if (belongsToSelection && correlationId) {
          state.timeline = state.timeline.map((item) => {
            const itemCorrelation = item.correlationId ?? stringValue(item.data.correlationId) ?? stringValue(item.data.turnId)
            return item.open && (item.type === 'model.output.delta' || item.type === 'model.completed') && itemCorrelation === correlationId
              ? { ...item, open: false, data: { ...item.data, streamInterrupted: true } }
              : item
          })
        }
      } else if (event.type === 'model.stream.recovered') {
        state.runtime = {
          ...state.runtime,
          streamRecovery: {
            status: 'recovering',
            attempt: numberValue(payload.attempt) ?? state.runtime.streamRecovery?.attempt ?? 1,
            maxAttempts: numberValue(payload.max_attempts) ?? state.runtime.streamRecovery?.maxAttempts ?? 3,
          },
        }
      } else if (['turn.completed', 'turn.cancelled', 'turn.failed'].includes(event.type)) {
        const turnId = stringValue(payload.turnId) ?? stringValue(payload.correlationId)
        if (!turnId || !state.runtime.activeTurn || state.runtime.activeTurn === 'pending' || turnId === state.runtime.activeTurn) {
          state.runtime = {
            ...state.runtime,
            activeTurn: null,
            queuedTurnCount: numberValue(payload.queuedCount) ?? 0,
            streamRecovery: null,
          }
        }
      }
      rememberForegroundRuntime()
    }

    if (event.type === 'session.created') {
      const id = stringValue(payload.sessionId)
      if (id) {
        const session: Record<string, JsonValue> = {
          id,
          title: stringValue(payload.title) ?? 'New session',
          mode: stringValue(payload.mode) ?? state.runtime.mode,
          autonomy: stringValue(payload.autonomy) ?? 'workspace',
        }
        state.sessions = [session, ...state.sessions.filter((item) => item.id !== id)]
        if (payload.selected !== false) {
          const sessionChanged = stringValue(state.selectedSession?.id) !== id
          state.selectedSession = session
          state.timeline = []
          state.history = { hasMore: false, nextCursor: null, cutoff: 0 }
          state.approvals = {}
          state.tools = {}
          state.operational = {
            ...(sessionChanged ? clearEventReplay(state.operational) : state.operational),
            changes: [],
            changesTruncated: false,
            selectedChange: null,
            jobs: [],
            jobsState: 'idle',
            jobsSessionId: id,
            selectedJobLog: null,
            logs: [],
          }
        }
      }
    }

    if (event.type === 'session.presentation.changed') {
      const sessionId = stringValue(payload.sessionId)
      if (sessionId && state.sessions.some((session) => session.id === sessionId)) {
        state.operational = {
          ...state.operational,
          sessionPresentation: {
            ...state.operational.sessionPresentation,
            [sessionId]: {
              sessionId,
              alias: stringValue(payload.alias),
              pinned: payload.pinned === true,
              archived: payload.archived === true,
              version: numberValue(payload.version) ?? 1,
            },
          },
        }
      }
    } else if (event.type === 'changes.updated' && belongsToSelection) {
      state.operational = {
        ...state.operational,
        changes: [],
        selectedChange: null,
      }
    } else if (event.type.startsWith('background.job.') && belongsToSelection) {
      const jobId = stringValue(payload.jobId)
      if (jobId) {
        const previous = state.operational.jobs.find((job) => job.jobId === jobId)
        const next: BackgroundJobSummary = {
          ...previous,
          jobId,
          sessionId: event.sessionId ?? previous?.sessionId,
          label: stringValue(payload.label) ?? previous?.label,
          state: stringValue(payload.state) ?? event.type.slice('background.job.'.length),
          updatedAt: stringValue(payload.createdAt) ?? previous?.updatedAt,
        }
        state.operational = {
          ...state.operational,
          jobs: [next, ...state.operational.jobs.filter((job) => job.jobId !== jobId)],
        }
      }
    }

    if (belongsToSelection && event.type === 'turn.input.received') {
      const inputId = stringValue(payload.inputId) ?? stringValue(payload.eventId)
      if (inputId) state.timeline = mergeTurnInputTimeline(state.timeline, [{
        id: `input-${inputId}`, type: 'message.created', role: 'user',
        text: stringValue(payload.prompt) ?? '', stream: 'text', open: false,
        domainSequence: numberValue(payload.domainSequence),
        correlationId: stringValue(payload.correlationId) ?? stringValue(payload.turnId) ?? undefined,
        data: { ...payload, inputId, inputState: 'pending' },
      }])
    } else if (belongsToSelection && event.type === 'turn.input.applied') {
      const inputId = stringValue(payload.inputId) ?? stringValue(payload.input_id)
      if (inputId) state.timeline = state.timeline.map((item) => item.data.inputId === inputId
        ? { ...item, data: { ...item.data, inputState: 'applied' } } : item)
    }

    if (event.type.startsWith('run_queue.')) {
      const task = queueTasksFromPayload([payload] as JsonValue)[0]
      const taskId = stringValue(payload.taskId) ?? stringValue(payload.id)
      if (task || taskId) {
        const id = task?.id ?? taskId!
        const nextTask = task ?? state.operational.queue.find((item) => item.id === id)
        const queue = nextTask
          ? [nextTask, ...state.operational.queue.filter((item) => item.id !== id)]
          : state.operational.queue.filter((item) => item.id !== id)
        state.operational = { ...state.operational, queue }
      }
    }

    if (event.type.startsWith('collaboration.') || event.type.startsWith('delivery.')) {
      const kind: OrchestrationView['kind'] = event.type.startsWith('collaboration.') ? 'collaboration' : 'delivery'
      const item = orchestrationFromPayload([payload] as JsonValue, kind)[0]
      const id = stringValue(payload.id) ?? stringValue(payload.workflowId) ?? stringValue(payload.workflow_id)
      if (item || id) {
        const key = kind === 'collaboration' ? 'collaborations' : 'deliveries'
        const current = state.operational[key]
        const itemId = item?.id ?? id!
        state.operational = {
          ...state.operational,
          [key]: item ? [item, ...current.filter((entry) => entry.id !== itemId)] : current.filter((entry) => entry.id !== itemId),
          orchestrationState: 'ready',
        }
      }
    }

    if (event.type.startsWith('terminal.')) {
      const terminalId = stringValue(payload.terminalId) ?? stringValue(payload.id) ?? stringValue(payload.terminal_id)
      if (terminalId) {
        const previous = state.operational.terminals[terminalId]
        const output = stringValue(payload.data) ?? stringValue(payload.output)
        const next: TerminalView = {
          ...(previous ?? { id: terminalId, state: 'running' }),
          state: stringValue(payload.state) ?? stringValue(payload.status) ?? (event.type.endsWith('exited') ? 'exited' : previous?.state ?? 'running'),
          output: output ? `${previous?.output ?? ''}${output}`.slice(-512_000) : previous?.output,
          offset: numberValue(payload.offset) ?? previous?.offset,
          exitCode: numberValue(payload.exitCode) ?? previous?.exitCode,
        }
        state.operational = { ...state.operational, terminals: { ...state.operational.terminals, [terminalId]: next }, terminalState: 'ready' }
      }
    }

    if (belongsToSelection && ['task.phase.started', 'task.phase.progress', 'task.phase.paused', 'task.phase.failed', 'task.phase.completed'].includes(event.type)) {
      const phase = stringValue(payload.phase) ?? stringValue(payload.phaseId) ?? stringValue(payload.stepId)
      const detail = stringValue(payload.message) ?? stringValue(payload.reason) ?? event.type
      state.operational = {
        ...state.operational,
        operationalEvents: [...state.operational.operationalEvents, {
          sequence: numberValue(payload.domainSequence) ?? numberValue(payload.domain_sequence) ?? event.sequence,
          type: phase ? `${event.type}:${phase}` : event.type,
          text: detail,
          createdAt: stringValue(payload.createdAt) ?? undefined,
        }].sort((left, right) => left.sequence - right.sequence).slice(-200),
      }
    }

    if (belongsToSelection && event.type === 'model.requested') {
      currentModelRequest = {
        id: modelRequestIdFromData(payload) ?? stringValue(payload.eventId) ??
          `wire-request-${state.runtime.epoch}-${event.sessionId}-${event.sequence}`,
        correlationId: stringValue(payload.correlationId) ?? stringValue(payload.turnId) ?? state.runtime.activeTurn ?? undefined,
        sessionId: event.sessionId,
        epoch: state.runtime.epoch,
        completed: false,
      }
    } else if (belongsToSelection && event.type === 'model.output.delta') {
      const text = stringValue(payload.text) ?? ''
      const stream = stringValue(payload.kind) ?? 'text'
      const recoveryAttempt = numberValue(payload.recoveryAttempt) ?? 0
      const correlationId =
        stringValue(payload.correlationId) ??
        stringValue(payload.turnId) ??
        state.runtime.activeTurn ??
        [...state.timeline].reverse().find((item) => item.type === 'model.output.delta' && item.open)?.correlationId
      const explicitRequestId = modelRequestIdFromData(payload)
      const currentRequest = currentModelRequest && !currentModelRequest.completed &&
        currentModelRequest.sessionId === event.sessionId && currentModelRequest.epoch === state.runtime.epoch &&
        currentModelRequest.correlationId === correlationId ? currentModelRequest.id : undefined
      const matchingOpen = !explicitRequestId && !currentRequest ? [...state.timeline].reverse().find((item) =>
        isModelStream(item) && item.open && (!correlationId || item.correlationId === correlationId),
      ) : undefined
      const modelRequestId = explicitRequestId ?? currentRequest ??
        (matchingOpen ? modelRequestIdFromData(matchingOpen.data) : undefined) ??
        `wire-request-${state.runtime.epoch}-${event.sequence}`
      const streamId = `stream-${modelRequestId}-${stream}-${recoveryAttempt}`
      const streamData = { ...payload, modelRequestId }
      const existingIndex = state.timeline.findIndex(
        (item) =>
          item.open &&
          item.stream === stream &&
          item.type === event.type &&
          modelRequestIdFromData(item.data) === modelRequestId &&
          (numberValue(item.data.recoveryAttempt) ?? 0) === recoveryAttempt,
      )
      if (existingIndex >= 0) {
        const existing = state.timeline[existingIndex]!
        const incomingDomainSequence = numberValue(payload.domainSequence)
        const existingDomainSequence = numberValue(existing.data.domainSequence)
        const duplicateDomainSequence = incomingDomainSequence !== undefined &&
          existingDomainSequence !== undefined &&
          incomingDomainSequence <= existingDomainSequence
        const duplicateText = incomingDomainSequence === undefined && text.length > 0 &&
          existing.text.endsWith(text)
        if (!duplicateDomainSequence && !duplicateText) {
          state.timeline = [
            ...state.timeline.slice(0, existingIndex),
            {
              ...existing,
              text: existing.text + text,
              domainSequence: incomingDomainSequence ?? existing.domainSequence,
              streamChunks: incomingDomainSequence !== undefined && existing.streamChunks
                ? [...existing.streamChunks, { sequence: incomingDomainSequence, text }]
                : undefined,
              data: { ...existing.data, ...streamData },
            },
            ...state.timeline.slice(existingIndex + 1),
          ]
        }
      } else {
        state.timeline = [
          ...state.timeline,
          {
            id: streamId,
            type: event.type,
            text,
            stream,
            open: true,
            domainSequence: numberValue(payload.domainSequence),
            streamChunks: numberValue(payload.domainSequence) !== undefined
              ? [{ sequence: numberValue(payload.domainSequence)!, text }]
              : undefined,
            correlationId: correlationId ?? undefined,
            role: stream === 'reasoning' ? 'reasoning' : 'assistant',
            data: streamData,
          },
        ]
      }
    } else if (belongsToSelection && event.type === 'model.completed') {
      const completionCorrelation = stringValue(payload.correlationId) ?? stringValue(payload.turnId)
      const explicitRequestId = modelRequestIdFromData(payload)
      const currentRequest = currentModelRequest && currentModelRequest.sessionId === event.sessionId &&
        currentModelRequest.epoch === state.runtime.epoch &&
        (completionCorrelation === null || currentModelRequest.correlationId === completionCorrelation)
        ? currentModelRequest.id : undefined
      const last = !explicitRequestId && !currentRequest ? [...state.timeline].reverse().find((item) =>
        isModelStream(item) && item.open &&
        (completionCorrelation === null || item.correlationId === completionCorrelation),
      ) : undefined
      const modelRequestId = explicitRequestId ?? currentRequest ??
        (last ? modelRequestIdFromData(last.data) : undefined)
      if (modelRequestId) {
        state.timeline = state.timeline.map((item) =>
          isModelStream(item) && item.open && modelRequestIdFromData(item.data) === modelRequestId ? {
            ...item,
            text: item.stream === 'reasoning' ? item.text : stringValue(payload.text) ?? item.text,
            open: false,
            data: { ...item.data, ...payload, modelRequestId },
          } : item,
        )
      }
      if (currentModelRequest && (!modelRequestId || currentModelRequest.id === modelRequestId)) {
        currentModelRequest.completed = true
      }
    } else if (belongsToSelection && event.type === 'message.created') {
      const canonicalId =
        stringValue(payload.eventId) ??
        stringValue(payload.messageId) ??
        `wire-${event.sequence}`
      const correlationId =
        stringValue(payload.correlationId) ??
        stringValue(payload.turnId) ??
        state.runtime.activeTurn ??
        undefined
      const role = roleValue(payload.role)
      const explicitRequestId = modelRequestIdFromData(payload)
      const currentRequest = currentModelRequest && currentModelRequest.sessionId === event.sessionId &&
        currentModelRequest.epoch === state.runtime.epoch && currentModelRequest.correlationId === correlationId
        ? currentModelRequest.id : undefined
      const latestStream = role === 'assistant' && !explicitRequestId && !currentRequest ? [...state.timeline].reverse().find((item) =>
        isModelStream(item) && (!correlationId || item.correlationId === correlationId),
      ) : undefined
      const modelRequestId = role === 'assistant' ? explicitRequestId ?? currentRequest ??
        (latestStream ? modelRequestIdFromData(latestStream.data) : undefined) : undefined
      const canonicalData = modelRequestId ? { ...payload, modelRequestId } : payload
      const canonical: TimelineItem = {
        id: canonicalId,
        type: event.type,
        text: stringValue(payload.text) ?? stringValue(payload.content) ?? '',
        stream: stringValue(payload.kind) ?? 'text',
        open: false,
        domainSequence: numberValue(payload.domainSequence),
        correlationId,
        role,
        data: canonicalData,
      }
      const withoutDeltas =
        role === 'assistant'
          ? state.timeline.filter((item) => !isStreamReplacedBy(item, canonical)).map((item) =>
              isModelStream(item) && item.open && modelRequestId &&
                modelRequestIdFromData(item.data) === modelRequestId ? { ...item, open: false } : item,
            )
          : state.timeline
      if (currentModelRequest && currentModelRequest.id === modelRequestId) currentModelRequest.completed = true
      const reasoningText = stringValue(payload.reasoning)
      state.timeline = mergeTurnInputTimeline(withoutDeltas, [
        ...(reasoningText
          ? [
              {
                id: `${canonicalId}-reasoning`,
                type: 'message.created',
                text: reasoningText,
                stream: 'reasoning',
                open: false,
                domainSequence: canonical.domainSequence,
                correlationId,
                role: 'reasoning' as const,
                data: { ...canonicalData, text: reasoningText, kind: 'reasoning', role: 'reasoning' },
              },
            ]
          : []),
        canonical,
      ])
    }

    if (belongsToSelection && (event.type === 'turn.failed' || event.type === 'session.forked')) {
      // Why a turn stopped (and where a fork came from) is shown in the conversation.
      state.timeline = mergeTimeline(state.timeline, [{
        id: stringValue(payload.eventId) ?? `wire-${event.sequence}`,
        type: event.type,
        text: '',
        stream: 'notice',
        open: false,
        domainSequence: numberValue(payload.domainSequence),
        correlationId: stringValue(payload.correlationId) ?? undefined,
        data: payload,
      }])
    }

    if (event.type === 'approval.requested') {
      const requestId = stringValue(payload.requestId)
      if (requestId) {
        state.approvals = {
          ...state.approvals,
          [requestId]: { ...payload, sessionId: event.sessionId },
        }
      }
    } else if (event.type === 'approval.resolved') {
      const requestId = stringValue(payload.requestId)
      if (requestId) {
        const { [requestId]: _resolved, ...remaining } = state.approvals
        state.approvals = remaining
      }
    }

    if (event.type === 'agent.run.updated' && payload.delegated === true) {
      const runId = stringValue(payload.runId)
      const title = stringValue(payload.title)
      const runState = stringValue(payload.state)
      if (runId && title && runState && event.sessionId) {
        state.subagents = withSubagent(state.subagents ?? {}, { runId, sessionId: event.sessionId, title, state: runState })
      }
    }

    if (event.type === 'device.job.updated') {
      const jobId = stringValue(payload.jobId)
      const jobState = stringValue(payload.state)
      if (jobId && jobState && event.sessionId) {
        state.phoneJobs = {
          ...state.phoneJobs,
          [jobId]: {
            jobId, sessionId: event.sessionId, state: jobState,
            device: stringValue(payload.device) ?? '', prompt: stringValue(payload.prompt) ?? '',
          },
        }
      }
    } else if (event.type === 'device.received') {
      const kind = stringValue(payload.kind)
      if (kind === 'file' || kind === 'text' || kind === 'link') {
        const notice: DeviceNotice = {
          id: stringValue(payload.eventId) ?? `device-${event.sequence}`,
          kind,
          device: stringValue(payload.device) ?? '',
          copy: payload.copy === true,
          ...(stringValue(payload.name) ? { name: stringValue(payload.name)! } : {}),
          ...(stringValue(payload.path) ? { path: stringValue(payload.path)! } : {}),
          ...(stringValue(payload.text) ? { text: stringValue(payload.text)! } : {}),
        }
        state.deviceNotices = [...(state.deviceNotices ?? []), notice].slice(-DEVICE_NOTICES_KEPT)
      }
    }

    if (belongsToSelection && event.type.startsWith('tool.')) {
      const attemptId = stringValue(payload.attemptId) ?? stringValue(payload.attempt_id)
      if (attemptId) {
        state.tools = {
          ...state.tools,
          [attemptId]: { ...payload, state: event.type.slice('tool.'.length) },
        }
        const prior = state.timeline.find((item) => item.id === `tool-${attemptId}`)
        const toolItem: TimelineItem = {
          id: `tool-${attemptId}`,
          type: event.type,
          text: '',
          stream: 'tool',
          open: event.type === 'tool.started',
          domainSequence: prior?.domainSequence ?? numberValue(payload.domainSequence),
          data: { ...prior?.data, ...payload, state: event.type.slice('tool.'.length) },
        }
        state.timeline = prior
          ? state.timeline.map((item) => item.id === toolItem.id ? toolItem : item)
          : mergeTimeline(state.timeline, [toolItem])
      }
    }
    publish()
  }

  const flushBuffered = (): void => {
    let projected = false
    let next = [...buffered.values()].find(
      (item) =>
        item.sequence === state.runtime.sequence + 1 && envelopeEpoch(item) === state.runtime.epoch,
    )
    while (next) {
      projected = true
      buffered.delete(`${envelopeEpoch(next) ?? ''}:${next.sequence}`)
      bufferedBytes -= new TextEncoder().encode(JSON.stringify(next)).byteLength
      if (next.kind === 'event') {
        projectEvent(next)
      } else {
        projectResponse(next)
      }
      next = [...buffered.values()].find(
        (item) =>
          item.sequence === state.runtime.sequence + 1 && envelopeEpoch(item) === state.runtime.epoch,
      )
    }
    if (buffered.size === 0) cancelGapCheck()
    if (projected) publish()
  }

  const scheduleGapCheck = (): void => {
    if (gapCheckTimer !== null || buffered.size === 0 || state.runtime.stale) return
    gapCheckTimer = setTimeout(() => {
      gapCheckTimer = null
      if (pendingCommands > 0 || state.runtime.stale) return
      flushBuffered()
      if (buffered.size > 0) freeze()
    }, options.ipcGapGraceMs ?? 50)
  }

  const applyEvent = (event: EventEnvelope): void => {
    const epoch = stringValue(event.payload.epoch)
    if (pendingCommands > 0 && (pendingBootstraps > 0 || state.runtime.epoch === null || state.runtime.stale)) {
      bufferEnvelope(event)
      return
    }
    if (state.runtime.stale) {
      return
    }
    if (!epoch || epoch !== state.runtime.epoch) {
      freeze()
      return
    }
    if (event.sequence <= state.runtime.sequence) return
    if (event.sequence !== state.runtime.sequence + 1) {
      if (pendingCommands > 0) {
        bufferEnvelope(event)
      } else {
        freeze()
      }
      return
    }
    projectEvent(event)
    flushBuffered()
  }

  const applyResponse = (response: ResponseEnvelope, options: { suppressSessionActivation?: boolean } = {}): void => {
    if (response.type === 'app.bootstrap.result') {
      applyBootstrap(response)
      pendingBootstraps = Math.max(0, pendingBootstraps - 1)
    } else if (response.type === 'session.open.result' && !state.runtime.stale && state.runtime.epoch !== null) {
      const epoch = stringValue(response.payload.epoch)
      if (!epoch || epoch !== state.runtime.epoch) {
        freeze()
      } else {
        // A session-open response is an authoritative snapshot. It must be
        // applied even while a background bootstrap is refreshing the rest of
        // the workbench; otherwise a switch can remain visually stuck behind
        // that bootstrap's pending counter or an unrelated sequence gap.
        projectResponse(response, options)
        discardBufferedThrough(state.runtime.sequence)
        flushBuffered()
      }
    } else if (response.type === 'events.replay.result' && !state.runtime.stale && state.runtime.epoch !== null) {
      if (response.sessionId === stringValue(state.selectedSession?.id)) {
        const epoch = stringValue(response.payload.epoch)
        if (!epoch || epoch !== state.runtime.epoch) {
          freeze()
        } else {
          projectResponse(response, options)
        }
      }
    } else if (pendingBootstraps > 0 || state.runtime.stale) {
      if (!projectHistoryPage(response, true)) bufferEnvelope(response)
    } else if (!state.runtime.stale) {
      const epoch = stringValue(response.payload.epoch)
      if (!epoch || epoch !== state.runtime.epoch) {
        freeze()
      } else if (response.sequence === state.runtime.sequence + 1) {
        projectResponse(response, options)
        flushBuffered()
      } else if (response.sequence > state.runtime.sequence) {
        bufferEnvelope(response)
      } else {
        projectHistoryPage(response, true)
      }
    }
    pendingCommands = Math.max(0, pendingCommands - 1)
    if (pendingCommands === 0) {
      flushBuffered()
      if (buffered.size > 0) scheduleGapCheck()
    }
    // Command responses can carry user-visible state (for example queued
    // turns) without a companion event. Publish after projection so React
    // subscribers observe the response immediately.
    publish()
  }

  const commandFailed = (type?: string, sessionId?: string | null): void => {
    pendingCommands = Math.max(0, pendingCommands - 1)
    if (type === 'app.bootstrap') pendingBootstraps = Math.max(0, pendingBootstraps - 1)
    if (type === 'workspace.sessions.list') {
      state = { ...state, workspaceDirectory: { ...(state.workspaceDirectory ?? { groups: [], nextWorkspaceOffset: null }), state: 'error' } }
    }
    if (type === 'jobs.list') {
      const requestedSessionId = sessionId ?? stringValue(state.selectedSession?.id)
      if ((state.operational.jobsSessionId ?? null) === (requestedSessionId ?? null)) {
        state = {
          ...state,
          operational: { ...state.operational, jobsState: 'error' },
        }
        publish()
      }
    }
    if (type === 'workspace.queue.list' || type === 'workspace.queue.get') {
      state = { ...state, operational: { ...state.operational, queueState: 'error' } }
    }
    if (type === 'workspace.collaborations.list' || type === 'workspace.deliveries.list') {
      state = { ...state, operational: { ...state.operational, orchestrationState: 'error' } }
    }
    if (type?.startsWith('terminal.')) {
      state = { ...state, operational: { ...state.operational, terminalState: 'error' } }
    }
    freeze()
  }

  return {
    getState: (): WorkbenchState => state,
    subscribe(listener: (state: WorkbenchState) => void): () => void {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    beginCommand(type?: string, sessionId?: string | null): void {
      pendingCommands += 1
      if (type === 'app.bootstrap') pendingBootstraps += 1
      if (type === 'workspace.sessions.list') {
        state = { ...state, workspaceDirectory: { ...(state.workspaceDirectory ?? { groups: [], nextWorkspaceOffset: null }), state: 'loading' } }
        publish()
      }
      if (type === 'jobs.list') {
        const requestedSessionId = sessionId ?? stringValue(state.selectedSession?.id)
        state = {
          ...state,
          operational: { ...state.operational, jobsState: 'loading', jobsSessionId: requestedSessionId },
        }
        publish()
      }
      if (type === 'workspace.queue.list' || type === 'workspace.queue.get') {
        state = { ...state, operational: { ...state.operational, queueState: 'loading' } }
        publish()
      }
      if (type === 'workspace.collaborations.list' || type === 'workspace.deliveries.list') {
        state = { ...state, operational: { ...state.operational, orchestrationState: 'loading' } }
        publish()
      }
      if (type?.startsWith('terminal.')) {
        state = { ...state, operational: { ...state.operational, terminalState: 'loading' } }
        publish()
      }
    },
    applyResponse,
    setSessionSwitchTarget(sessionId: string | null): void {
      latestSessionSwitchTarget = sessionId
    },
    applyHistoryPage(response: ResponseEnvelope): void {
      if (response.type !== 'session.history.result') return
      if (projectHistoryPage(response, true)) {
        deferredHistoryPages.delete(response.requestId)
        publish()
        return
      }
      if (deferredHistoryPages.size >= 8) {
        const oldest = deferredHistoryPages.keys().next().value
        if (typeof oldest === 'string') deferredHistoryPages.delete(oldest)
      }
      deferredHistoryPages.set(response.requestId, response)
    },
    commandFailed,
    applyBootstrap,
    applyEvent,
    markDisconnected: freeze,
  }
}

export type WorkbenchStore = ReturnType<typeof createWorkbenchStore>

export interface PresentedSession {
  id: string
  workspace: string
  rawTitle: string
  title: string
  mode: string
  autonomy: string
  pinned: boolean
  archived: boolean
  version: number
}

export function selectPresentedSessions(
  state: WorkbenchState,
  options?: {
    query?: string
    includeArchived?: boolean
    onlyArchived?: boolean
  },
): PresentedSession[] {
  const normalized = (options?.query ?? '').trim().toLocaleLowerCase()
  const includeArchived = options?.includeArchived ?? false
  const onlyArchived = options?.onlyArchived ?? false

  const results: PresentedSession[] = []

  for (const session of state.sessions) {
    const id = typeof session.id === 'string' ? session.id : ''
    if (!id) continue
    const presentation = state.operational.sessionPresentation[id]
    const pinned = presentation?.pinned === true
    const archived = presentation?.archived === true
    const version = presentation?.version ?? 1

    if (onlyArchived) {
      if (!archived) continue
    } else if (!includeArchived && archived) {
      continue
    }

    const rawTitle = typeof session.title === 'string' ? session.title : ''
    const title = presentation?.alias || rawTitle || 'Untitled session'
    const sessionWorkspaceValue: unknown = session.workspace
    const sessionWorkspace = typeof sessionWorkspaceValue === 'string' ? sessionWorkspaceValue : ''
    const currentWorkspacePathValue: unknown = state.workspace?.path
    const currentWorkspacePath = typeof currentWorkspacePathValue === 'string' ? currentWorkspacePathValue : ''
    const workspace = sessionWorkspace.trim() ? sessionWorkspace : currentWorkspacePath
    const mode = typeof session.mode === 'string' ? session.mode : 'coding'
    const autonomy = typeof session.autonomy === 'string' ? session.autonomy : 'workspace'

    if (
      normalized &&
      !title.toLocaleLowerCase().includes(normalized) &&
      !rawTitle.toLocaleLowerCase().includes(normalized)
    ) {
      continue
    }

    results.push({
      id,
      workspace,
      rawTitle,
      title,
      mode,
      autonomy,
      pinned,
      archived,
      version,
    })
  }

  return results.sort((left, right) => Number(right.pinned) - Number(left.pinned))
}

export interface PresentedWorkspaceGroup extends Omit<WorkspaceConversationGroup, 'sessions' | 'sessionPresentation'> {
  sessions: PresentedSession[]
  current: boolean
}

export function selectWorkspaceGroups(state: WorkbenchState, options: { query?: string } = {}): PresentedWorkspaceGroup[] {
  const groups = rememberCurrentWorkspace(state).groups.map(group => ({ ...group }))
  for (const workspace of state.recentWorkspaces ?? []) {
    if (!groups.some(group => workspacePathKey(group.path) === workspacePathKey(workspace.path))) {
      groups.push({ ...workspace, sessions: [], sessionPresentation: {}, hasMore: false, nextOffset: null })
    }
  }
  const currentPath = stringValue(state.workspace?.path) ?? ''
  if (currentPath && !groups.some(group => workspacePathKey(group.path) === workspacePathKey(currentPath))) {
    groups.unshift({ path: currentPath, name: stringValue(state.workspace?.name) ?? currentPath,
      lastUsed: 0, sessions: [], sessionPresentation: {}, hasMore: false, nextOffset: null })
  }
  // Embedded clients may already supply global session summaries.
  for (const session of state.sessions) {
    const path = stringValue(session.workspace) || currentPath
    const group = groups.find(item => workspacePathKey(item.path) === workspacePathKey(path))
    if (group) group.sessions = mergeDirectorySessions(group.sessions, [session])
    else groups.push({ path, name: path.split(/[\\/]/).filter(Boolean).at(-1) || 'No workspace', lastUsed: 0,
      sessions: [session], sessionPresentation: {}, hasMore: false, nextOffset: null })
  }
  const query = (options.query ?? '').trim().toLocaleLowerCase()
  return groups.flatMap(group => {
    const current = workspacePathKey(group.path) === workspacePathKey(currentPath)
    const folderMatches = query && `${group.name} ${group.path}`.toLocaleLowerCase().includes(query)
    const sessions = selectPresentedSessions({ ...state, workspace: { path: group.path }, sessions: group.sessions,
      operational: { ...state.operational, sessionPresentation: current
        ? { ...group.sessionPresentation, ...state.operational.sessionPresentation } : group.sessionPresentation },
    }, { query: folderMatches ? '' : query })
    if (query && !folderMatches && sessions.length === 0) return []
    return [{ path: group.path, name: group.name, lastUsed: group.lastUsed, hasMore: group.hasMore,
      nextOffset: group.nextOffset, sessions, current }]
  })
}

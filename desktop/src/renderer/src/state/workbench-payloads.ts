import type { JsonValue } from '../../../shared/protocol'
import { arrayObjects, numberValue, objectValue, presentationsFromPayload, stringValue } from './projection-parsers'
import type { CheckResultView, OperationalProjection, OrchestrationView, QueueTaskView, RecentWorkspace, RuntimeProjection, SessionRuntimeProjection, SubagentView, TerminalView, WorkbenchState, WorkspaceConversationGroup, WorkspaceDirectory } from './workbench-types'

export function recentWorkspacesFromPayload(value: JsonValue | undefined): RecentWorkspace[] {
  return arrayObjects(value).flatMap((item) => {
    const path = stringValue(item.path)
    const name = stringValue(item.name)
    if (!path || !name) return []
    return [{ path, name, lastUsed: numberValue(item.lastUsed) ?? 0 }]
  })
}

/** The results of a folder's checks (checks.finished, project.get). */
export function checkResultsFrom(value: JsonValue | undefined): CheckResultView[] {
  return arrayObjects(value).flatMap((item) => {
    const name = stringValue(item.name)
    const command = stringValue(item.command)
    if (!name || command === null) return []
    return [{
      name,
      command,
      ok: item.ok === true,
      exitCode: numberValue(item.exitCode) ?? null,
      seconds: numberValue(item.seconds) ?? 0,
      output: stringValue(item.output) ?? '',
      timedOut: item.timedOut === true,
    }]
  })
}

export function workspacePathKey(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '')
  return /^[a-z]:\//i.test(normalized) || normalized.startsWith('//') ? normalized.toLocaleLowerCase() : normalized
}

export function workspaceGroupsFromPayload(value: JsonValue | undefined): WorkspaceConversationGroup[] {
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

export function mergeDirectorySessions(
  existing: Array<Record<string, JsonValue>>, incoming: Array<Record<string, JsonValue>>,
): Array<Record<string, JsonValue>> {
  const sessions = new Map(existing.map(session => [stringValue(session.id), session]))
  for (const session of incoming) sessions.set(stringValue(session.id), session)
  return [...sessions.values()]
}

export function rememberCurrentWorkspace(state: WorkbenchState): WorkspaceDirectory {
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

export function clearEventReplay(operational: OperationalProjection): OperationalProjection {
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

export function queueTasksFromPayload(value: JsonValue | undefined): QueueTaskView[] {
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

export function orchestrationFromPayload(value: JsonValue | undefined, kind: OrchestrationView['kind']): OrchestrationView[] {
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

export function terminalFromPayload(value: JsonValue | undefined): TerminalView | null {
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

export function approvalsFromPayload(value: JsonValue | undefined): WorkbenchState['approvals'] {
  const approvals: WorkbenchState['approvals'] = {}
  for (const approval of arrayObjects(value)) {
    const requestId = stringValue(approval.requestId)
    if (requestId) approvals[requestId] = approval
  }
  return approvals
}

/**
 * The sub-agents a snapshot says conversations wait on, over the ones this window already knew:
 * the snapshot's state wins, and what a sub-agent was doing is kept.
 */
export function subagentsFromPayload(value: JsonValue | undefined, known: Record<string, SubagentView>): Record<string, SubagentView> {
  const merged = { ...known }
  for (const item of arrayObjects(value)) {
    const runId = stringValue(item.runId)
    const sessionId = stringValue(item.sessionId)
    const title = stringValue(item.title)
    const state = stringValue(item.state)
    if (!runId || !sessionId || !title || !state) continue
    const expert = stringValue(item.expert)
    merged[runId] = {
      ...merged[runId],
      runId, sessionId, title, state,
      ...(expert ? { expert, phase: item.phase === 'review' ? 'review' : 'work' } : {}),
    }
  }
  return merged
}

export function sessionRuntimesFromPayload(value: JsonValue | undefined): Record<string, SessionRuntimeProjection> {
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

export function runtimeFromPayload(value: JsonValue | undefined, previous: RuntimeProjection): RuntimeProjection {
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


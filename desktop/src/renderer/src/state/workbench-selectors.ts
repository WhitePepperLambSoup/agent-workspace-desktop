import { stringValue } from './projection-parsers'
import { mergeDirectorySessions, rememberCurrentWorkspace, workspacePathKey } from './workbench-payloads'
import type { WorkbenchState, WorkspaceConversationGroup } from './workbench-types'

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

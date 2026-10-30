import type { JsonValue } from '../../../shared/protocol'
import type { WorkbenchState } from '../state/workbench-types'
import type { TeamSettings } from '../team/team-settings'
import { studioCast, turnRunning, type StudioActor } from './cast'

/** One floor of the studio building: a conversation whose expert team is at work. */
export interface StudioFloor {
  sessionId: string
  title: string | null
  workspace: string | null
  cast: StudioActor[]
}

/**
 * What a floor's sign says: experts at work (and how many wait for a free slot), the agent
 * alone, a question for the user, done.
 */
export type FloorSummary =
  | { kind: 'working'; count: number; queued: number }
  | { kind: 'queued'; count: number }
  | { kind: 'lead' | 'waiting' | 'done' | 'idle' }

/** The building is at most this tall; a new team takes the place of the oldest floor at rest. */
export const MAX_FLOORS = 6

const FINISHED = new Set(['succeeded', 'failed', 'cancelled'])

function text(value: JsonValue | undefined): string | null {
  return typeof value === 'string' && value ? value : null
}

/**
 * Conversations whose expert team is at work now: an expert still busy, or the agent's turn
 * running after it called its team (it writes the answer from their findings).
 */
export function busyTeams(state: WorkbenchState): string[] {
  const open = new Map<string, boolean>()
  for (const item of Object.values(state.subagents ?? {})) {
    if (!item.expert) continue
    open.set(item.sessionId, (open.get(item.sessionId) ?? false) || !FINISHED.has(item.state))
  }
  return [...open].filter(([sessionId, busy]) => busy || turnRunning(state, sessionId)).map(([sessionId]) => sessionId)
}

/**
 * The building's floors in order, floor 1 first: the conversations seen with a busy team while
 * the studio is open stay on their floor; newly busy ones are added on top. Past MAX_FLOORS the
 * oldest floors whose team is at rest make way, then the oldest at all.
 */
export function floorOrder(previous: readonly string[], busy: readonly string[]): string[] {
  const order = [...previous, ...busy.filter((sessionId) => !previous.includes(sessionId))]
  while (order.length > MAX_FLOORS) {
    const resting = order.findIndex((sessionId) => !busy.includes(sessionId))
    order.splice(resting >= 0 ? resting : 0, 1)
  }
  return order
}

/** A conversation's title and folder, from the sidebar's lists. */
export function sessionInfo(state: WorkbenchState, sessionId: string): { title: string | null; workspace: string | null } {
  for (const group of state.workspaceDirectory?.groups ?? []) {
    const match = group.sessions.find((session) => session.id === sessionId)
    if (match) return { title: text(match.title), workspace: group.path }
  }
  const loaded = [state.selectedSession, ...state.sessions].find((session) => session?.id === sessionId)
  return { title: text(loaded?.title), workspace: text(loaded?.workspace) ?? text(state.workspace?.path) }
}

export function studioFloors(
  state: WorkbenchState,
  team: TeamSettings,
  names: { lead: string; expert: (id: string) => string },
  order: readonly string[],
): StudioFloor[] {
  return order.map((sessionId) => ({ sessionId, ...sessionInfo(state, sessionId), cast: studioCast(state, team, names, sessionId) }))
}

export function floorSummary(cast: readonly StudioActor[]): FloorSummary {
  const lead = cast.find((actor) => actor.lead)
  const experts = cast.filter((actor) => !actor.lead)
  if (cast.some((actor) => actor.state === 'waiting')) return { kind: 'waiting' }
  const working = experts.filter((actor) => actor.state === 'working').length
  // Experts not started yet wait for a free slot: only a few run at a time across all tasks.
  const queued = experts.filter((actor) => actor.state === 'arriving').length
  if (working > 0) return { kind: 'working', count: working, queued }
  if (queued > 0) return { kind: 'queued', count: queued }
  if (lead && (lead.state === 'working' || lead.state === 'answering')) return { kind: 'lead' }
  if (experts.some((actor) => actor.state === 'done')) return { kind: 'done' }
  return { kind: 'idle' }
}

import type { JsonValue } from '../../../shared/protocol'
import { activityKind } from '../team/activity'
import { lookFor, spotFor, type ActorState, type StudioActor } from './cast'

/**
 * A finished turn told again: who did what and when (session.replay), and the studio's people
 * at any moment of it. The lead is at the board while its team works, at the window while it
 * thinks, at the door while it waits for an approval; the experts come in with their first step
 * and are done after their last.
 */

export interface ReplayStep {
  actor: string
  kind: 'tool' | 'think' | 'wait' | 'answer'
  tool?: string
  detail?: string
  start: number
  end: number
  failed?: boolean
  /** The conversation's timeline row (a lead's tool call). */
  item?: string
}

export interface ReplayActor {
  id: string
  runId?: string
  title?: string
  expert?: string | null
}

export interface Replay {
  turnId: string
  prompt: string
  outcome: string | null
  duration: number
  actors: ReplayActor[]
  steps: ReplayStep[]
}

export interface ReplayTurn {
  turnId: string
  prompt: string
  outcome: string | null
  finished: boolean
}

function text(value: JsonValue | undefined): string | undefined {
  return typeof value === 'string' && value ? value : undefined
}

function number(value: JsonValue | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function objects(value: JsonValue | undefined): Array<Record<string, JsonValue>> {
  return Array.isArray(value) ? value.flatMap((item) => (item && typeof item === 'object' && !Array.isArray(item) ? [item] : [])) : []
}

const KINDS = new Set(['tool', 'think', 'wait', 'answer'])

export function parseReplay(payload: Record<string, JsonValue> | undefined): { turns: ReplayTurn[]; replay: Replay | null } {
  const turns = objects(payload?.turns).flatMap((item): ReplayTurn[] => {
    const turnId = text(item.turnId)
    return turnId ? [{ turnId, prompt: text(item.prompt) ?? '', outcome: text(item.outcome) ?? null, finished: item.finished === true }] : []
  })
  const raw = payload?.replay
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { turns, replay: null }
  const replay: Replay = {
    turnId: text(raw.turnId) ?? '',
    prompt: text(raw.prompt) ?? '',
    outcome: text(raw.outcome) ?? null,
    duration: number(raw.duration),
    actors: objects(raw.actors).flatMap((item): ReplayActor[] => {
      const id = text(item.id)
      return id ? [{ id, ...(text(item.runId) ? { runId: text(item.runId) } : {}), ...(text(item.title) ? { title: text(item.title) } : {}), expert: text(item.expert) ?? null }] : []
    }),
    steps: objects(raw.steps).flatMap((item): ReplayStep[] => {
      const actor = text(item.actor)
      const kind = text(item.kind)
      if (!actor || !kind || !KINDS.has(kind)) return []
      return [{
        actor,
        kind: kind as ReplayStep['kind'],
        ...(text(item.tool) ? { tool: text(item.tool) } : {}),
        ...(text(item.detail) ? { detail: text(item.detail) } : {}),
        start: number(item.start),
        end: Math.max(number(item.start), number(item.end)),
        ...(item.failed === true ? { failed: true } : {}),
        ...(text(item.item) ? { item: text(item.item) } : {}),
      }]
    }),
  }
  return { turns, replay }
}

/** How long a moment of the answer stays shown. */
const ANSWER_SECONDS = 2

function active(step: ReplayStep, at: number): boolean {
  return step.kind === 'answer' ? at >= step.start && at < step.start + ANSWER_SECONDS : at >= step.start && at < step.end
}

/** The steps under way at a moment, the newest first. */
export function stepsAt(replay: Replay, at: number): ReplayStep[] {
  return replay.steps.filter((step) => active(step, at)).sort((a, b) => b.start - a.start)
}

/** Where someone is and what they do at a moment, from their steps. */
function actorAt(steps: ReplayStep[], at: number, after: ActorState): Pick<StudioActor, 'state' | 'activity' | 'spot'> {
  const now = steps.filter((step) => active(step, at)).sort((a, b) => b.start - a.start)
  const wait = now.find((step) => step.kind === 'wait')
  if (wait) {
    const kind = activityKind(wait.tool)
    return { state: 'waiting', activity: null, spot: kind === 'code' || kind === 'write' ? 'door' : 'desk' }
  }
  const tool = now.find((step) => step.kind === 'tool')
  if (tool) {
    const activity = tool.tool === 'delegate_tasks' ? 'delegate' : activityKind(tool.tool)
    return { state: 'working', activity, spot: spotFor(activity, tool.tool) }
  }
  if (now.some((step) => step.kind === 'answer')) return { state: 'answering', activity: 'write', spot: 'desk' }
  if (now.some((step) => step.kind === 'think')) return { state: 'working', activity: 'thinking', spot: 'window' }
  const first = steps[0]
  const last = steps.at(-1)
  if (!first || at < first.start) return { state: 'arriving', activity: null, spot: 'desk' }
  if (last && at >= Math.max(...steps.map((step) => step.end))) return { state: after, activity: null, spot: 'desk' }
  // Between two steps: at the desk.
  return { state: 'working', activity: 'thinking', spot: 'desk' }
}

/** The studio's people at a moment of the turn: its lead, then its experts and helpers. */
export function castAt(
  replay: Replay,
  at: number,
  names: { lead: string; expert: (id: string) => string; helper?: string },
): StudioActor[] {
  const byActor = new Map<string, ReplayStep[]>()
  for (const step of replay.steps) byActor.set(step.actor, [...(byActor.get(step.actor) ?? []), step])
  const ended = at >= replay.duration
  const leadAfter: ActorState = replay.outcome === 'failed' ? 'failed' : replay.outcome === 'cancelled' ? 'stopped' : 'done'
  const leadSteps = byActor.get('lead') ?? []
  const leadNow = actorAt(leadSteps, at, leadAfter)
  const lead: StudioActor = {
    id: 'lead', name: names.lead, lead: true, look: lookFor('lead'),
    ...(ended ? { state: leadAfter, activity: null, spot: 'desk' } : leadNow.state === 'arriving' ? { state: 'working', activity: 'thinking', spot: 'window' } : leadNow),
  }
  const others = replay.actors.filter((actor) => actor.id !== 'lead').map((actor): StudioActor => {
    const steps = byActor.get(actor.id) ?? []
    const failed = steps.at(-1)?.failed === true
    const now = actorAt(steps, at, failed ? 'failed' : 'done')
    return {
      id: actor.expert ?? `helper:${actor.runId ?? actor.id}`,
      name: actor.expert ? names.expert(actor.expert) : actor.title || names.helper || names.lead,
      lead: false,
      ...now,
      ...(actor.runId ? { runId: actor.runId } : {}),
      ...(actor.expert ? {} : { leaves: true }),
      look: lookFor(actor.expert ?? `helper:${actor.runId ?? actor.id}`),
    }
  })
  return [lead, ...others]
}

/** mm:ss */
export function clock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds))
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

import type { JsonValue } from '../../../shared/protocol'
import type { SubagentView, WorkbenchState } from '../state/workbench-types'
import { activityKind, type ActivityKind } from '../team/activity'
import { domainColor, isLibraryExpert } from '../team/catalog'
import type { TeamSettings } from '../team/team-settings'

/** What a person in the studio is doing; the scene turns it into a place and a pose. */
export type ActorState = 'idle' | 'arriving' | 'working' | 'answering' | 'waiting' | 'done' | 'failed' | 'stopped'
/** Where they go: their desk, the bookshelf (looking things up), the terminal (running code on
 * this computer), the sandbox's glass room (running code in it), the glass door (waiting to be
 * allowed to touch this computer), the whiteboard (handing out work), the meeting table
 * (reviewing together), or the window (thinking it over). */
export type Spot = 'desk' | 'shelf' | 'terminal' | 'sandbox' | 'door' | 'board' | 'table' | 'window'

export type HairStyle = 'short' | 'long' | 'bun' | 'spiky' | 'bald'
export type Accessory = 'none' | 'glasses' | 'headset' | 'cap' | 'helmet' | 'tie' | 'scarf' | 'badge'

export interface ActorLook {
  shirt: string
  pants: string
  skin: string
  hair: string
  hairStyle: HairStyle
  accessory: Accessory
}

export interface StudioActor {
  /** 'lead' for the conversation's agent, otherwise the expert's id. */
  id: string
  name: string
  lead: boolean
  state: ActorState
  activity: ActivityKind | null
  spot: Spot
  /** The run to open on a click (experts), absent for the lead and idle experts. */
  runId?: string
  /** A few words over their head. */
  speech?: string
  /** A document just made (the tool's attempt): they fetch it from the printer once. */
  errand?: string
  /** A sub-agent sent for one task: done, it leaves by the door. */
  leaves?: boolean
  look: ActorLook
}

/** Desks besides the lead's: the experts and sub-agents at work in a room at most. */
const DESKS = 4

/** Hand-made looks for the lead and the best-known experts; the rest are drawn from their id. */
const LOOKS: Record<string, ActorLook> = {
  lead: { shirt: '#2f5d9e', pants: '#2b3140', skin: '#f1c7a5', hair: '#2b211c', hairStyle: 'short', accessory: 'badge' },
  researcher: { shirt: '#2a9d8f', pants: '#34404c', skin: '#e9b896', hair: '#5b3a29', hairStyle: 'long', accessory: 'glasses' },
  analyst: { shirt: '#e0a13a', pants: '#3a3f4a', skin: '#c99272', hair: '#151515', hairStyle: 'short', accessory: 'headset' },
  critic: { shirt: '#c8553d', pants: '#2e2e36', skin: '#f2d0b4', hair: '#7a4b2a', hairStyle: 'spiky', accessory: 'cap' },
  engineer: { shirt: '#4f6274', pants: '#2c3440', skin: '#d8a483', hair: '#3a2a20', hairStyle: 'short', accessory: 'helmet' },
  legal: { shirt: '#3e3f55', pants: '#22232c', skin: '#efc6a6', hair: '#1e1a18', hairStyle: 'bun', accessory: 'tie' },
  finance: { shirt: '#3a7d44', pants: '#2a3330', skin: '#e3b28f', hair: '#9a9a9a', hairStyle: 'bald', accessory: 'glasses' },
  product: { shirt: '#7b5ea7', pants: '#33303f', skin: '#f0c9ab', hair: '#3b2416', hairStyle: 'bun', accessory: 'none' },
  writer: { shirt: '#c06c84', pants: '#38323c', skin: '#e8bc9b', hair: '#6d3b26', hairStyle: 'long', accessory: 'scarf' },
  teacher: { shirt: '#8a8d3b', pants: '#3b3a30', skin: '#d39b78', hair: '#4a4a4a', hairStyle: 'short', accessory: 'glasses' },
}
const SHIRTS = ['#3f88c5', '#d1495b', '#66a182', '#edae49', '#8f6593', '#00798c', '#e76f51']
const HAIRS = ['#2b211c', '#6b3e26', '#a0522d', '#1b1b1b', '#c19a6b']
const STYLES: HairStyle[] = ['short', 'long', 'bun', 'spiky']
const ACCESSORIES: Accessory[] = ['none', 'glasses', 'scarf', 'cap']

function hash(text: string): number {
  let value = 2166136261
  for (const char of text) value = Math.imul(value ^ char.codePointAt(0)!, 16777619)
  return value >>> 0
}

export function lookFor(id: string): ActorLook {
  const made = LOOKS[id]
  if (made) return made
  const seed = hash(id)
  return {
    // A library expert wears the colour of their field.
    shirt: domainColor(id) ?? SHIRTS[seed % SHIRTS.length]!,
    pants: '#30343e',
    skin: ['#f1c7a5', '#d8a483', '#c99272', '#e9b896'][(seed >> 3) % 4]!,
    hair: HAIRS[(seed >> 5) % HAIRS.length]!,
    hairStyle: STYLES[(seed >> 7) % STYLES.length]!,
    accessory: ACCESSORIES[(seed >> 9) % ACCESSORIES.length]!,
  }
}

/** Searches in books and papers; other searches are on the web, at the desk. */
const LIBRARY = /^(knowledge_|paper_|read_paper|reference_library|memory_search|lab_notebook_search|list_research_sources|read_research_source|save_research_source|list_citations|check_references)/
/** Tools that make a document someone could print. */
const PRINTED = /^(create_(docx|xlsx|pptx|pdf)|edit_docx|update_xlsx|compile_latex|export_references)$/

/** Where an activity takes someone working alone; the tool tells books from the web. */
export function spotFor(activity: ActivityKind | null, tool?: string): Spot {
  if (activity === 'search') return tool && !LIBRARY.test(tool) ? 'desk' : 'shelf'
  if (activity === 'code' && tool === 'run_sandbox') return 'sandbox'
  if (activity === 'code') return 'terminal'
  if (activity === 'delegate') return 'board'
  return 'desk'
}

function text(value: JsonValue | undefined): string | undefined {
  return typeof value === 'string' && value ? value : undefined
}

/** A short line for a speech bubble: the start of a sentence, not the middle of one. */
export function speechLine(value: string, limit = 42): string {
  const flat = value.replace(/```[\s\S]*?(```|$)/g, ' ').replace(/[#*_>`|-]+/g, ' ').replace(/\s+/g, ' ').trim()
  return flat.length > limit ? `${flat.slice(0, limit - 1).trimEnd()}…` : flat
}

function selectedSessionId(state: WorkbenchState): string | null {
  return text(state.selectedSession?.id) ?? null
}

export function turnRunning(state: WorkbenchState, sessionId: string | null): boolean {
  if (!sessionId) return false
  const session = state.runtime.activeSessions?.[sessionId]
  if (session) return Boolean(session.activeTurn || session.turnRequested)
  return Boolean(state.runtime.activeTurn) && state.runtime.hostSessionId === sessionId
}

/**
 * The conversation's tool calls by attempt, oldest first: those of its newest turn (after the
 * last message from the user), or all of them. The timeline's tool rows keep them through a
 * resync of the window, which starts the live tool states over; the live states go over them.
 */
export function toolCalls(state: WorkbenchState, scope: 'turn' | 'all' = 'turn'): Map<string, Record<string, JsonValue>> {
  const rows: Array<[string, Record<string, JsonValue>]> = []
  const earlier = new Set<string>()
  let inTurn = true
  for (let index = state.timeline.length - 1; index >= 0; index -= 1) {
    const item = state.timeline[index]!
    if (item.role === 'user') inTurn = scope === 'all'
    if (!item.type.startsWith('tool.') || !item.id.startsWith('tool-')) continue
    const attempt = item.id.slice('tool-'.length)
    if (inTurn) rows.unshift([attempt, { ...item.data, state: item.type.slice('tool.'.length) }])
    else earlier.add(attempt)
  }
  const calls = new Map(rows)
  for (const [attempt, tool] of Object.entries(state.tools)) {
    if (!earlier.has(attempt)) calls.set(attempt, tool)
  }
  return calls
}

/** The newest document the agent made (its tool's attempt); the studio fetches each one from the printer once. */
function printed(state: WorkbenchState): string | undefined {
  const entries = [...toolCalls(state)]
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const [attempt, tool] = entries[index]!
    const name = text(tool.toolName) ?? text(tool.name)
    if (tool.state === 'settled' && name && PRINTED.test(name)) return attempt
  }
  return undefined
}

/** The tool the conversation's agent is running now, if any (the newest one started). */
function runningTool(state: WorkbenchState): string | undefined {
  const tools = [...toolCalls(state).values()]
  for (let index = tools.length - 1; index >= 0; index -= 1) {
    const tool = tools[index]!
    if (tool.state === 'started' || tool.state === 'approved') return text(tool.toolName) ?? text(tool.name) ?? 'tool'
  }
  return undefined
}

/**
 * The assistant text the agent is writing now, for the lead's bubble: the newest of this turn
 * (after the last user message), unless a tool came after it; then it is thinking of its next step.
 */
function answerSoFar(state: WorkbenchState): string | undefined {
  for (let index = state.timeline.length - 1; index >= 0; index -= 1) {
    const item = state.timeline[index]!
    if (item.role === 'user' || item.type.startsWith('tool.')) return undefined
    if (item.role === 'assistant' && item.text.trim()) return item.text
  }
  return undefined
}

function expertState(view: SubagentView | undefined, approval: boolean): ActorState {
  if (!view) return 'idle'
  if (approval || view.state === 'needs_attention') return 'waiting'
  if (view.state === 'running' || view.state === 'starting') return 'working'
  if (view.state === 'succeeded') return 'done'
  if (view.state === 'failed') return 'failed'
  if (view.state === 'cancelled') return 'stopped'
  return 'arriving'
}

/**
 * The studio's people from the window's state: the conversation's agent (the lead) and, once
 * the conversation has called it, the expert team, each doing what their real task is doing. By default the
 * conversation on screen; for another one (a floor of the building) the window knows its turn
 * and its experts, not the tool the agent runs or the answer it writes.
 */
export function studioCast(
  state: WorkbenchState,
  team: TeamSettings,
  names: { lead: string; expert: (id: string) => string; helper?: string },
  sessionId: string | null = selectedSessionId(state),
): StudioActor[] {
  const onScreen = sessionId === selectedSessionId(state)
  const approvals = Object.values(state.approvals).filter((item) => item.sessionId === sessionId)
  const subagents = Object.values(state.subagents ?? {}).filter((item) => item.sessionId === sessionId)

  const leadApprovals = approvals.filter((item) => !text(item.subagent))
  const leadApproval = leadApprovals.length > 0
  // Asked to run something or change files on this computer: they wait at the sandbox's door.
  const atDoor = leadApprovals.some((item) => {
    const kind = activityKind(text(item.toolName) ?? text(item.tool) ?? text(item.name))
    return kind === 'code' || kind === 'write'
  })
  const running = turnRunning(state, sessionId)
  const tool = running && onScreen ? runningTool(state) : undefined
  const leadActivity = running ? activityKind(tool) : null
  const unfinished = subagents.filter((item) => item.state !== 'succeeded' && item.state !== 'failed' && item.state !== 'cancelled')
  const delegating = unfinished.length > 0
  const reviewing = unfinished.some((item) => item.phase === 'review')
  const answer = running && onScreen && !tool ? answerSoFar(state) : undefined
  const errand = running && onScreen && !leadApproval ? printed(state) : undefined
  // Thinking before it writes or uses anything, the agent stands at the window; between two
  // steps it thinks at its desk.
  const pondering = running && onScreen && !tool && !answer && !delegating && !leadApproval && toolCalls(state).size === 0
  const lead: StudioActor = {
    id: 'lead',
    name: names.lead,
    lead: true,
    state: leadApproval ? 'waiting' : !running ? 'idle' : answer ? 'answering' : 'working',
    // While the experts work, the lead waits for them at the whiteboard; a review of the lead's
    // draft happens together at the meeting table.
    activity: delegating && !tool ? 'delegate' : leadActivity,
    spot: leadApproval ? (atDoor ? 'door' : 'desk') : reviewing ? 'table' : delegating && (!tool || tool === 'delegate_tasks') ? 'board'
      : pondering ? 'window' : spotFor(leadActivity, tool),
    ...(answer && !leadApproval ? { speech: speechLine(answer) } : {}),
    ...(errand ? { errand } : {}),
    look: lookFor('lead'),
  }

  // Without its team the agent works on its own: the experts come in once the conversation calls them.
  const experts = subagents.some((item) => item.expert) ? teamOf(team, names, subagents, approvals) : []
  // Sub-agents the agent sent work to come in by the door, to the desks the experts leave free.
  const free = Math.max(0, DESKS - experts.length)
  const helpers = free === 0 ? [] : subagents.filter((item) => !item.expert).slice(-free).map((view): StudioActor => {
    const approval = approvals.some((item) => text(item.subagent) === view.title)
    const actorState = expertState(view, approval)
    const activity = actorState === 'working' ? (view.activity === 'tool' ? activityKind(view.tool) : 'thinking') : null
    return {
      id: `helper:${view.runId}`,
      name: speechLine(view.title, 14) || names.helper || names.lead,
      lead: false,
      state: actorState,
      activity,
      spot: actorState === 'working' ? spotFor(activity, view.tool) : 'desk',
      runId: view.runId,
      leaves: true,
      look: lookFor(`helper:${view.runId}`),
    }
  })
  return [lead, ...experts, ...helpers]
}

/** The expert team at its desks: a fixed team's members, or the experts the lead picked. */
function teamOf(
  team: TeamSettings,
  names: { lead: string; expert: (id: string) => string },
  subagents: SubagentView[],
  approvals: Array<Record<string, JsonValue>>,
): StudioActor[] {
  // A fixed team shows its members; on auto, the experts the lead picked in this conversation
  // (the newest first, as many as there are desks).
  const picked = [...new Set(subagents.map((item) => item.expert).filter((id): id is string => Boolean(id)).reverse())]
  const members = team.mode === 'fixed' ? team.members : picked.slice(0, DESKS)
  const experts = members.flatMap((id): StudioActor[] => {
    const custom = isLibraryExpert(id) ? null : team.custom.find((item) => item.id === id)
    if (!isLibraryExpert(id) && !custom) return []
    const name = custom ? custom.name : names.expert(id)
    // The newest run of this expert in the conversation (the review round replaces the work round).
    const view = subagents.filter((item) => item.expert === id).at(-1)
    const approval = approvals.some((item) => text(item.subagent) === view?.title)
    const actorState = expertState(view, approval)
    const activity = actorState === 'working' ? (view?.activity === 'tool' ? activityKind(view.tool) : 'thinking') : null
    return [{
      id,
      name,
      lead: false,
      state: actorState,
      activity,
      spot: view?.phase === 'review' && actorState === 'working' ? 'table' : actorState === 'working' ? spotFor(activity, view?.tool) : 'desk',
      ...(view ? { runId: view.runId } : {}),
      look: lookFor(id),
    }]
  })
  return experts
}

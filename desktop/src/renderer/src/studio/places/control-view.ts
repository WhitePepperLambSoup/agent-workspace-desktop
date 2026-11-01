import type { JsonValue } from '../../../../shared/protocol'
import type { I18nValue } from '../../i18n/I18nProvider'
import type { MessageKey } from '../../i18n/messages'
import type { WorkbenchState } from '../../state/workbench-types'
import type { TeamSettings } from '../../team/team-settings'
import { studioCast, type ActorState, type StudioActor } from '../cast'
import type { Action } from '../person'
import { actorView } from '../views'
import type { ControlPersonView, ControlStationView, ControlView } from './control'
import { CONTROL_STATIONS, type ControlModel, type ControlStation, type StationCost } from './models'

type Translate = I18nValue['t']

const CROWD: Record<ActorState, ControlPersonView['state']> = {
  idle: 'idle', arriving: 'idle', working: 'working', answering: 'working', waiting: 'waiting', done: 'done', failed: 'failed', stopped: 'idle',
}
const AT_DESK: Record<ControlPersonView['state'], Action> = { working: 'type', waiting: 'raise', done: 'rest', failed: 'slump', idle: 'rest' }
const BESIDE: Record<ControlPersonView['state'], Action> = { working: 'talk', waiting: 'raise', done: 'cheer', failed: 'slump', idle: 'rest' }

/** What a console's state comes to in words. */
export function stationLine(station: ControlStation, t: Translate): string {
  if (station.state === 'approval') return t('places.control.state.approval', { count: station.approvals })
  if (station.state === 'quiet') return t('places.control.state.quiet', { minutes: Math.floor(station.quietFor / 60_000) })
  if (station.state === 'queued') return t('places.control.state.queued', { count: station.queued })
  return t(`places.control.state.${station.state}` as MessageKey)
}

export function money(usd: number, locale: string, estimated: boolean): string {
  const amount = new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD', minimumFractionDigits: usd < 0.01 ? 4 : 2, maximumFractionDigits: 4 }).format(usd)
  return `${estimated ? '≈ ' : ''}${amount}`
}

/** What a conversation has cost, its sub-agents and experts included; unpriced models are not given a price. */
export function costText(cost: StationCost | null, t: Translate, locale: string): string | null {
  if (!cost) return null
  if (!cost.priced) return t('places.control.costUnpriced')
  return cost.team > 0
    ? t('places.control.costTeam', { cost: money(cost.usd, locale, cost.estimated), team: money(cost.team, locale, cost.estimated) })
    : t('places.control.cost', { cost: money(cost.usd, locale, cost.estimated) })
}

export function stationTitle(station: ControlStation, t: Translate): string {
  return station.title ?? t('workbench.untitledSession')
}

/** The people at a console: the conversation's agent at the desk, its team beside it. */
export function stationPeople(
  state: WorkbenchState,
  station: ControlStation,
  team: TeamSettings,
  names: { lead: string; expert: (id: string) => string; helper?: string },
  t: Translate,
): Array<ControlPersonView & { lead: boolean; runId?: string }> {
  const cast = studioCast(state, team, names, station.sessionId)
  return cast.map((actor: StudioActor, index) => {
    const view = actorView(actor, t)
    const crowd = station.state === 'failed' && actor.lead && actor.state === 'idle' ? 'failed'
      : station.state === 'done' && actor.lead && actor.state === 'idle' ? 'done'
        : CROWD[actor.state]
    // The marks over a head are short: the studio's speech lines are for the studio.
    const bubble = station.state === 'quiet' && actor.lead ? '…'
      : crowd === 'failed' ? '!' : crowd === 'done' ? '✓' : view.bubble && view.bubble.length <= 2 ? view.bubble : undefined
    return {
      id: actor.id,
      name: actor.name,
      lead: actor.lead,
      state: crowd,
      stateLabel: actor.lead && station.state !== 'working' ? stationLine(station, t) : view.stateLabel,
      look: actor.look,
      action: index === 0 ? AT_DESK[crowd] : BESIDE[crowd],
      ...(bubble ? { bubble } : {}),
      ...(actor.runId ? { runId: actor.runId } : {}),
    }
  })
}

export function controlView(
  model: ControlModel,
  state: WorkbenchState,
  team: TeamSettings,
  names: { lead: string; expert: (id: string) => string; helper?: string },
  t: Translate,
  locale: string,
): ControlView {
  const slots: Array<ControlStationView | null> = Array.from({ length: CONTROL_STATIONS }, (_, index) => {
    const station = model.stations[index]
    if (!station) return null
    const cost = costText(station.cost, t, locale)
    return {
      sessionId: station.sessionId,
      title: stationTitle(station, t),
      detail: cost ? `${stationLine(station, t)} · ${cost}` : stationLine(station, t),
      ...(['approval', 'failed', 'quiet'].includes(station.state) ? { tone: 'alert' as const } : ['working', 'queued'].includes(station.state) ? { tone: 'busy' as const } : {}),
      state: station.state,
      people: stationPeople(state, station, team, names, t),
    }
  })
  return { slots, empty: model.stations.length === 0 ? t('places.control.empty') : null }
}

/** The room in a line: how many are at work, the questions waiting, the jobs running, the cost. */
export function controlSummary(model: ControlModel, t: Translate, locale: string): { title: string; detail: string } {
  const working = model.stations.filter((station) => station.state !== 'done' && station.state !== 'stopped').length + model.more
  return {
    title: working > 0 ? t('places.control.summary', { count: working }) : t('places.control.summaryNone'),
    detail: t('places.control.summaryDetail', { approvals: model.approvals, jobs: model.jobs.running })
      + (model.costUsd !== null ? ` · ${t('places.control.cost', { cost: money(model.costUsd, locale, false) })}` : ''),
  }
}

/** The answer of usage.conversations, by conversation. */
export function stationCosts(payload: Record<string, JsonValue> | undefined): Map<string, StationCost> {
  const costs = new Map<string, StationCost>()
  const items = Array.isArray(payload?.conversations) ? payload.conversations : []
  for (const item of items) {
    if (!item || typeof item !== 'object' || Array.isArray(item) || typeof item.sessionId !== 'string') continue
    costs.set(item.sessionId, {
      usd: typeof item.costUsd === 'number' ? item.costUsd : 0,
      team: typeof item.teamCostUsd === 'number' ? item.teamCostUsd : 0,
      priced: item.priced === true,
      estimated: item.estimated === true,
    })
  }
  return costs
}

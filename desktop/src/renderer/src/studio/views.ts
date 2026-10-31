import { useCallback, useEffect, useState } from 'react'

import type { I18nValue } from '../i18n/I18nProvider'
import type { MessageKey } from '../i18n/messages'
import type { WorkbenchState } from '../state/workbench-types'
import type { TeamSettings } from '../team/team-settings'
import type { StudioActor } from './cast'
import { floorSummary, studioFloors, type FloorSummary } from './floors'
import type { StudioActorView, StudioFloorView, StudioOptions } from './scene'

/** The words for an actor: their state (or what they are doing) and a bubble when there is something to say. */
export function actorView(actor: StudioActor, t: I18nValue['t']): StudioActorView {
  const stateLabel = actor.state === 'working' && actor.activity
    ? t(`team.activity.${actor.activity}` as MessageKey)
    : t(`studio.state.${actor.state}` as MessageKey)
  const bubble = actor.state === 'answering' ? actor.speech
    : actor.state === 'waiting' ? '?'
      : actor.state === 'done' ? '✓'
        : actor.state === 'failed' ? '!'
          : actor.state === 'working' && actor.spot === 'table' ? '…'
            : undefined
  return { ...actor, stateLabel, ...(bubble ? { bubble } : {}) }
}

export function summaryText(summary: FloorSummary, t: I18nValue['t']): string {
  if (summary.kind === 'working') {
    return summary.queued > 0
      ? t('studio.floorState.workingQueued', { count: summary.count, queued: summary.queued })
      : t('studio.floorState.working', { count: summary.count })
  }
  if (summary.kind === 'queued') return t('studio.floorState.queued', { count: summary.count })
  return t(`studio.floorState.${summary.kind}` as MessageKey)
}

/** The building's floors in order, as the scene shows them, with each conversation's folder. */
export function buildingFloors(
  state: WorkbenchState,
  team: TeamSettings,
  names: { lead: string; expert: (id: string) => string },
  order: readonly string[],
  t: I18nValue['t'],
): Array<StudioFloorView & { workspace: string | null }> {
  return studioFloors(state, team, names, order).map((floor, index) => {
    const summary = floorSummary(floor.cast)
    return {
      id: floor.sessionId,
      number: t('studio.floor', { floor: index + 1 }),
      title: floor.title ?? t('workbench.untitledSession'),
      summary: summaryText(summary, t),
      busy: summary.kind !== 'done' && summary.kind !== 'idle',
      cast: floor.cast.map((actor) => actorView(actor, t)),
      workspace: floor.workspace,
    }
  })
}

/** The app's colour mode, accent and motion preference, as the shell sets them. */
export function useShellLook(): StudioOptions {
  const read = useCallback((): StudioOptions => {
    const shell = document.querySelector<HTMLElement>('[data-color-mode]')
    const accent = shell ? getComputedStyle(shell).getPropertyValue('--accent').trim() : ''
    const systemReduced = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    return {
      dark: shell?.getAttribute('data-color-mode') !== 'light',
      reducedMotion: systemReduced || shell?.getAttribute('data-reduced-motion') === 'true',
      accent: /^#[0-9a-f]{6}$/i.test(accent) ? accent : '#4b8fe6',
    }
  }, [])
  const [look, setLook] = useState(read)
  useEffect(() => {
    const update = (): void => {
      const next = read()
      setLook((current) => (current.dark === next.dark && current.reducedMotion === next.reducedMotion && current.accent === next.accent ? current : next))
    }
    const shell = document.querySelector('[data-color-mode]')
    const observer = shell ? new MutationObserver(update) : null
    observer?.observe(shell!, { attributes: true, attributeFilter: ['data-color-mode', 'data-reduced-motion', 'data-palette'] })
    // Windows' animation setting can change while the window is open.
    const motion = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null
    motion?.addEventListener('change', update)
    return () => {
      observer?.disconnect()
      motion?.removeEventListener('change', update)
    }
  }, [read])
  return look
}

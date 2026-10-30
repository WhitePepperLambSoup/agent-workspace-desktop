import { Building2, Pause, Play, RotateCcw } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'

import { useOptionalI18n, type I18nValue } from '../i18n/I18nProvider'
import type { MessageKey } from '../i18n/messages'
import type { WorkbenchState } from '../state/workbench-types'
import { libraryName } from '../team/catalog'
import { useTeamSettings } from '../team/team-settings'
import { studioCast, type StudioActor } from './cast'
import { busyTeams, floorOrder, floorSummary, studioFloors, type FloorSummary } from './floors'
import type { StudioActorView, StudioFloorView, StudioScene } from './scene'
import './studio.css'

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

/** The app's colour mode, accent and motion preference, as the shell sets them. */
function useShellLook(): { dark: boolean; reducedMotion: boolean; accent: string } {
  const read = useCallback(() => {
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
    const shell = document.querySelector('[data-color-mode]')
    if (!shell) return undefined
    const observer = new MutationObserver(() => {
      const next = read()
      setLook((current) => (current.dark === next.dark && current.reducedMotion === next.reducedMotion && current.accent === next.accent ? current : next))
    })
    observer.observe(shell, { attributes: true, attributeFilter: ['data-color-mode', 'data-reduced-motion', 'data-palette'] })
    return () => observer.disconnect()
  }, [read])
  return look
}

export function StudioRoute({ state, onOpenRun, onOpenAgent, onOpenSession }: {
  state: WorkbenchState
  onOpenRun?: (runId: string) => void
  onOpenAgent?: () => void
  onOpenSession?: (workspace: string, sessionId: string) => void
}) {
  const { t, locale } = useOptionalI18n()
  const team = useTeamSettings()
  const look = useShellLook()
  const stageRef = useRef<HTMLDivElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<StudioScene | null>(null)
  const [unsupported, setUnsupported] = useState(false)
  const [ready, setReady] = useState(false)
  const [paused, setPaused] = useState(false)
  /** The floor up close while the building is shown; null is the whole building. */
  const [focus, setFocus] = useState<string | null>(null)

  const names = { lead: t('studio.lead'), expert: (id: string) => libraryName(id, locale) ?? id }
  // Each conversation seen with its team at work while the studio is open keeps a floor;
  // with two or more the studio is an office building.
  const order = useRef<string[]>([])
  order.current = floorOrder(order.current, busyTeams(state))
  const building = order.current.length >= 2
  const selectedId = typeof state.selectedSession?.id === 'string' ? state.selectedSession.id : null
  const workspaces = new Map<string, string | null>()
  const floors: StudioFloorView[] = building
    ? studioFloors(state, team, names, order.current).map((floor, index): StudioFloorView => {
      const summary = floorSummary(floor.cast)
      workspaces.set(floor.sessionId, floor.workspace)
      return {
        id: floor.sessionId,
        number: t('studio.floor', { floor: index + 1 }),
        title: floor.title ?? t('workbench.untitledSession'),
        summary: summaryText(summary, t),
        busy: summary.kind !== 'done' && summary.kind !== 'idle',
        cast: floor.cast.map((actor) => actorView(actor, t)),
      }
    })
    : [{ id: selectedId ?? 'studio', number: '', title: '', summary: '', busy: false, cast: studioCast(state, team, names).map((actor) => actorView(actor, t)) }]
  const inView = building ? (floors.find((floor) => floor.id === focus) ?? null) : floors[0]!
  const signature = JSON.stringify(floors)
  const latest = useRef({ floors, workspaces, building, selectedId })
  latest.current = { floors, workspaces, building, selectedId }
  const focusId = building ? inView?.id ?? null : null
  const latestFocus = useRef(focusId)
  latestFocus.current = focusId

  /** A click on someone: the lead opens their conversation, an expert their task. */
  const actions = useRef({ onOpenAgent, onOpenRun, onOpenSession })
  actions.current = { onOpenAgent, onOpenRun, onOpenSession }
  const pick = useCallback((floorId: string, actorId: string) => {
    const { floors: current, workspaces: folders, building: tower, selectedId: selected } = latest.current
    const actor = current.find((floor) => floor.id === floorId)?.cast.find((item) => item.id === actorId)
    if (!actor) return
    const { onOpenAgent: openAgent, onOpenRun: openRun, onOpenSession: openSession } = actions.current
    if (!actor.lead) {
      if (actor.runId) openRun?.(actor.runId)
      return
    }
    const workspace = folders.get(floorId)
    if (tower && floorId !== selected && workspace && openSession) openSession(workspace, floorId)
    else openAgent?.()
  }, [])

  useEffect(() => {
    const stage = stageRef.current
    const overlay = overlayRef.current
    if (!stage || !overlay) return undefined
    let cancelled = false
    let created: StudioScene | null = null
    setReady(false)
    // three.js loads only when the studio opens.
    void import('./scene').then(({ createStudioScene }) => {
      if (cancelled) return
      try {
        created = createStudioScene(stage, overlay, look, { pick, pickFloor: setFocus })
      } catch {
        setUnsupported(true)
        return
      }
      sceneRef.current = created
      created.update(latest.current.floors)
      created.focus(latestFocus.current)
      setUnsupported(false)
      setReady(true)
    }).catch(() => { if (!cancelled) setUnsupported(true) })
    return () => {
      cancelled = true
      created?.dispose()
      sceneRef.current = null
    }
  }, [look, pick])

  useEffect(() => {
    sceneRef.current?.update(latest.current.floors)
  }, [signature])

  useEffect(() => {
    sceneRef.current?.focus(focusId)
  }, [focusId, ready])

  useEffect(() => {
    sceneRef.current?.setPaused(paused)
  }, [paused, ready])

  const overview = building && inView === null
  const description = overview ? t('studio.buildingHint')
    : building && inView ? `${inView.number} · ${inView.title}`
      : t('studio.description')
  return (
    <main className="route-column reading-surface studio-route" aria-label={t('studio.title')}>
      <header className="route-header studio-header">
        <div>
          <p className="section-kicker">{t('team.title')}</p>
          <h1 tabIndex={-1}>{t('studio.title')}</h1>
          <p className="studio-description">{description}</p>
        </div>
        <div className="studio-actions">
          {building ? (
            <button type="button" className="icon-button" aria-pressed={overview} aria-label={t('studio.building')} title={t('studio.building')}
              disabled={!ready || overview} onClick={() => setFocus(null)}><Building2 size={15} /></button>
          ) : null}
          <button type="button" className="icon-button" aria-label={t('studio.reset')} title={t('studio.reset')} disabled={!ready}
            onClick={() => sceneRef.current?.resetView()}><RotateCcw size={15} /></button>
          <button type="button" className="icon-button" aria-pressed={paused} aria-label={t(paused ? 'studio.resume' : 'studio.pause')}
            title={t(paused ? 'studio.resume' : 'studio.pause')} disabled={!ready} onClick={() => setPaused((value) => !value)}>
            {paused ? <Play size={15} /> : <Pause size={15} />}
          </button>
        </div>
      </header>
      <div className="studio-stage" ref={stageRef} data-ready={ready ? 'true' : 'false'}
        data-view={overview ? 'building' : building ? 'floor' : 'room'} data-floors={floors.length}>
        <div className="studio-overlay" ref={overlayRef} aria-hidden="true" />
        {unsupported ? <p className="studio-unsupported" role="status">{t('studio.unsupported')}</p> : null}
        {ready ? <p className="studio-hint">{t(overview ? 'studio.buildingClick' : 'studio.hint')}</p> : null}
      </div>
      {overview ? (
        <ul className="studio-roster studio-floor-list" aria-label={t('studio.floors')}>
          {[...floors].reverse().map((floor) => (
            <li key={floor.id} data-busy={floor.busy ? 'true' : 'false'}>
              <button type="button" title={t('studio.openFloor', { floor: floor.number, title: floor.title })} onClick={() => setFocus(floor.id)}>
                <span className="studio-floor-dot" aria-hidden="true" />
                <strong>{floor.number}</strong>
                <span className="studio-floor-name">{floor.title}</span>
                <span>{floor.summary}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="studio-roster" aria-label={t('studio.people')}>
          {(inView?.cast ?? []).map((view) => (
            <li key={view.id} data-state={view.state}>
              <button type="button" disabled={!view.lead && !view.runId}
                title={view.lead ? t('studio.lead') : t('studio.openTask', { name: view.name })}
                onClick={() => pick(inView!.id, view.id)}>
                <span className="studio-swatch" style={{ '--swatch': view.look.shirt } as CSSProperties} aria-hidden="true" />
                <strong>{view.name}</strong>
                <span>{view.stateLabel}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}

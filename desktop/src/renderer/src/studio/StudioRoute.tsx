import { Building2, Map as MapIcon, Pause, Play, RotateCcw } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'

import type { WorkbenchBridgeClient } from '../bridge/client'
import type { MessageKey } from '../i18n/messages'

import { useOptionalI18n } from '../i18n/I18nProvider'
import type { WorkbenchState } from '../state/workbench-types'
import { libraryName } from '../team/catalog'
import { useTeamSettings } from '../team/team-settings'
import { studioCast } from './cast'
import { busyTeams, floorOrder } from './floors'
import type { StudioFloorView, StudioScene } from './scene'
import { actorView, buildingFloors, summaryText, useShellLook } from './views'
import type { PlaceId } from './places/models'
import { PlaceView } from './places/PlaceView'
import './studio.css'

export { actorView, summaryText }

interface StudioProps {
  state: WorkbenchState
  client?: WorkbenchBridgeClient
  onOpenRun?: (runId: string) => void
  onOpenAgent?: () => void
  onOpenSession?: (workspace: string, sessionId: string) => void
  /** Opens another page of the window (knowledge, schedules, changes, settings…). */
  onOpenRoute?: (route: string) => void
}

/** The place last shown, for the next time the page opens. */
let lastPlace: PlaceId = 'studio'

/**
 * The studio page: the studio itself (one room, or the building of the conversations whose teams
 * are at work), and the campus around it with its other places.
 */
export function StudioRoute(props: StudioProps) {
  const { t } = useOptionalI18n()
  const [place, setPlaceState] = useState<PlaceId>(lastPlace)
  const setPlace = useCallback((next: PlaceId) => {
    lastPlace = next
    setPlaceState(next)
  }, [])
  const toCampus = place === 'campus' ? null : (
    <button type="button" className="icon-button studio-campus-button" aria-label={t('places.campus.go')} title={t('places.campus.go')} onClick={() => setPlace('campus')}><MapIcon size={15} /></button>
  )
  if (place === 'studio') return <StudioRoom {...props} nav={toCampus} />
  return <PlacePage {...props} place={place} nav={toCampus} onPlace={setPlace} />
}

function PlacePage({ place, nav, onPlace, state, client, onOpenAgent, onOpenRoute, onOpenRun }: StudioProps & {
  place: Exclude<PlaceId, 'studio'>
  nav: ReactNode
  onPlace: (place: PlaceId) => void
}) {
  const { t } = useOptionalI18n()
  const look = useShellLook()
  const [paused, setPaused] = useState(false)
  // Counts the presses of Reset view.
  const [resets, setResets] = useState(0)
  const [ready, setReady] = useState(false)
  return (
    <main className="route-column reading-surface studio-route place-route" aria-label={t(`places.${place}.title` as MessageKey)}>
      <header className="route-header studio-header">
        <div>
          <p className="section-kicker">{place === 'campus' ? t('studio.title') : t('places.campus.title')}</p>
          <h1 tabIndex={-1}>{t(`places.${place}.title` as MessageKey)}</h1>
          <p className="studio-description">{t(`places.${place}.description` as MessageKey)}</p>
        </div>
        <div className="studio-actions">
          {nav}
          <button type="button" className="icon-button" aria-label={t('studio.reset')} title={t('studio.reset')} disabled={!ready} onClick={() => setResets((value) => value + 1)}><RotateCcw size={15} /></button>
          <button type="button" className="icon-button" aria-pressed={paused} aria-label={t(paused ? 'studio.resume' : 'studio.pause')}
            title={t(paused ? 'studio.resume' : 'studio.pause')} disabled={!ready} onClick={() => setPaused((value) => !value)}>
            {paused ? <Play size={15} /> : <Pause size={15} />}
          </button>
        </div>
      </header>
      <PlaceView key={place} place={place} state={state} client={client} look={look} paused={paused} resets={resets}
        onPlace={onPlace} onOpenRoute={onOpenRoute} onOpenAgent={onOpenAgent} onOpenRun={onOpenRun} onReady={(value) => setReady(value === true)} />
    </main>
  )
}

function StudioRoom({ state, onOpenRun, onOpenAgent, onOpenSession, nav }: StudioProps & { nav?: ReactNode }) {
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

  const names = { lead: t('studio.lead'), expert: (id: string) => libraryName(id, locale) ?? id, helper: t('studio.helper') }
  // Each conversation seen with its team at work while the studio is open keeps a floor;
  // with two or more the studio is an office building.
  const order = useRef<string[]>([])
  order.current = floorOrder(order.current, busyTeams(state))
  const building = order.current.length >= 2
  const selectedId = typeof state.selectedSession?.id === 'string' ? state.selectedSession.id : null
  const workspaces = new Map<string, string | null>()
  const floors: StudioFloorView[] = building
    ? buildingFloors(state, team, names, order.current, t).map(({ workspace, ...floor }) => {
      workspaces.set(floor.id, workspace)
      return floor
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
          {nav}
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

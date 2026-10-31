import { BookOpen, Building2, Clock, Construction, Crosshair, Map as MapIcon, MessageSquare, Server, Smartphone, type LucideIcon } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { WorkbenchBridgeClient } from '../bridge/client'
import { useOptionalI18n } from '../i18n/I18nProvider'
import type { MessageKey } from '../i18n/messages'
import type { WorkbenchState } from '../state/workbench-types'
import { libraryName } from '../team/catalog'
import { useTeamSettings } from '../team/team-settings'
import { studioCast } from './cast'
import { busyTeams, floorOrder } from './floors'
import { agentPlace, type PlaceId } from './places/models'
import { PlaceView } from './places/PlaceView'
import type { StudioActorView, StudioFloorView, StudioScene } from './scene'
import { actorView, buildingFloors, useShellLook } from './views'
import './studio.css'

/** How long after the window has painted the studio's 3D starts loading behind it. */
const START_DELAY_MS = 1200
/** Following the agent: a place stays at least this long, and a new one must hold this long. */
const FOLLOW_STAY_MS = 5000
const FOLLOW_SETTLE_MS = 1500

type Place = Exclude<PlaceId, 'studio'>
const CAMPUS: readonly Place[] = ['campus', 'library', 'site', 'servers', 'duty', 'desk']
const PLACE_ICONS: Record<Place, LucideIcon> = { campus: MapIcon, library: BookOpen, site: Construction, servers: Server, duty: Clock, desk: Smartphone }

/** What is looked at while shown in full: wherever the agent works, a floor (null: the building), or a place. */
type Look = { kind: 'follow' } | { kind: 'floor'; id: string | null } | { kind: 'place'; place: Place }

/**
 * The conversation's studio behind the window's panes: the agent at work in its room, under clear
 * liquid glass, dimmed so text stays readable on top. Shown in full ("viewing"), the panes step
 * aside: by default the view follows the agent to wherever its work is (the library while it
 * searches the knowledge base, the building site while it writes code, the server room while it
 * runs things on a server), and any floor of the building or place of the campus can be picked.
 */
export function StudioBackdrop({ state, client, viewing, paused, onPick, onOpenSession, onOpenRoute, onOpenRun, onLeave, onFailure }: {
  state: WorkbenchState
  client?: WorkbenchBridgeClient
  viewing: boolean
  /** Another page draws the studio: this one stops drawing. */
  paused: boolean
  /** Someone in this conversation's room was clicked while it is shown in full. */
  onPick?: (actor: StudioActorView) => void
  /** The agent of another conversation's floor was clicked: open that conversation. */
  onOpenSession?: (workspace: string, sessionId: string) => void
  /** Something in a place was clicked that has its own page. */
  onOpenRoute?: (route: string) => void
  onOpenRun?: (runId: string) => void
  /** Back to the conversation. */
  onLeave?: () => void
  /** WebGL is missing, failed or drawn in software: the window goes back to the plain backdrop. */
  onFailure: () => void
}) {
  const { t, locale } = useOptionalI18n()
  const team = useTeamSettings()
  const look = useShellLook()
  const stageRef = useRef<HTMLDivElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<StudioScene | null>(null)
  const [ready, setReady] = useState(false)
  const [choice, setChoice] = useState<Look>({ kind: 'follow' })

  const names = { lead: t('studio.lead'), expert: (id: string) => libraryName(id, locale) ?? id, helper: t('studio.helper') }
  const selectedId = typeof state.selectedSession?.id === 'string' ? state.selectedSession.id : 'studio'

  // Following the agent: its place changes only once the work there has gone on a moment, and
  // stays a while, so the view does not flick between places at every tool.
  const wanted = agentPlace(state)
  const [followed, setFollowed] = useState(wanted)
  const since = useRef(Date.now())
  useEffect(() => {
    if (!viewing || choice.kind !== 'follow' || wanted === followed) return undefined
    const timer = window.setTimeout(() => {
      setFollowed(wanted)
      since.current = Date.now()
    }, Math.max(FOLLOW_SETTLE_MS, FOLLOW_STAY_MS - (Date.now() - since.current)))
    return () => window.clearTimeout(timer)
  }, [choice.kind, followed, viewing, wanted])
  // Back behind the panes, the next look follows the agent again from where it is.
  useEffect(() => {
    if (viewing) return
    setChoice({ kind: 'follow' })
    setFollowed(wanted)
    since.current = Date.now()
  }, [viewing, wanted])

  const shown: { kind: 'floor'; id: string | null } | { kind: 'place'; place: Place } =
    choice.kind === 'place' ? choice
      : choice.kind === 'floor' ? choice
        : followed === 'studio' ? { kind: 'floor', id: selectedId } : { kind: 'place', place: followed }
  const placeShown = viewing && shown.kind === 'place' ? shown.place : null

  // Each conversation seen with its team at work keeps a floor while the window is open; shown in
  // full, the conversation on screen has one too.
  const order = useRef<string[]>([])
  order.current = floorOrder(order.current, busyTeams(state))
  const shownOrder = state.selectedSession ? floorOrder(order.current, [...busyTeams(state), selectedId]) : order.current
  const building = viewing && shownOrder.length >= 2
  const floors: Array<StudioFloorView & { workspace?: string | null }> = building
    ? buildingFloors(state, team, names, shownOrder, t)
    : [{ id: selectedId, number: '', title: '', summary: '', busy: false, cast: studioCast(state, team, names).map((actor) => actorView(actor, t)) }]
  const floorShown = shown.kind === 'floor' ? shown.id : selectedId
  const focus = !building ? null : floorShown !== null && !floors.some((floor) => floor.id === floorShown) ? selectedId : floorShown
  const signature = JSON.stringify(floors)
  const latest = useRef({ floors, focus, viewing, selectedId, onPick, onOpenSession, onFailure })
  latest.current = { floors, focus, viewing, selectedId, onPick, onOpenSession, onFailure }

  const pick = useCallback((floorId: string, actorId: string) => {
    const current = latest.current
    if (!current.viewing) return
    const floor = current.floors.find((item) => item.id === floorId)
    const actor = floor?.cast.find((item) => item.id === actorId)
    if (!floor || !actor) return
    if (actor.lead && floorId !== current.selectedId) {
      if (floor.workspace) current.onOpenSession?.(floor.workspace, floorId)
      return
    }
    current.onPick?.(actor)
  }, [])
  const pickFloor = useCallback((floorId: string) => setChoice({ kind: 'floor', id: floorId }), [])

  useEffect(() => {
    const stage = stageRef.current
    const overlay = overlayRef.current
    if (!stage || !overlay) return undefined
    let cancelled = false
    let created: StudioScene | null = null
    setReady(false)
    // three.js loads once the window has painted; the plain colour shows until then.
    const timer = window.setTimeout(() => {
      void import('./scene').then(({ createStudioScene }) => {
        if (cancelled) return
        try {
          // Behind every conversation by default: only where the GPU draws it.
          created = createStudioScene(stage, overlay, { ...look, requireGpu: true }, { pick, pickFloor }, latest.current.viewing ? 'room' : 'backdrop')
        } catch {
          latest.current.onFailure()
          return
        }
        sceneRef.current = created
        created.update(latest.current.floors)
        created.focus(latest.current.focus)
        setReady(true)
      }).catch(() => { if (!cancelled) latest.current.onFailure() })
    }, START_DELAY_MS)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
      created?.dispose()
      sceneRef.current = null
    }
  }, [look, pick, pickFloor])

  // The floors first, then where to look: the scene flies to the floor (or out to the building).
  useEffect(() => {
    const scene = sceneRef.current
    if (!scene) return
    scene.update(latest.current.floors)
    scene.focus(latest.current.focus)
  }, [signature, focus, ready])

  useEffect(() => {
    sceneRef.current?.setMode(viewing ? 'room' : 'backdrop')
  }, [viewing, ready])

  // Nothing is drawn while the window is hidden, the studio page draws it instead, or a place of
  // the campus is shown in its stead.
  useEffect(() => {
    const apply = (): void => sceneRef.current?.setActive(!paused && !document.hidden && placeShown === null)
    apply()
    document.addEventListener('visibilitychange', apply)
    return () => document.removeEventListener('visibilitychange', apply)
  }, [paused, placeShown, ready])

  const placeLabel = (place: PlaceId): string => t(`places.${place}.title` as MessageKey)
  return (
    <div className="studio-backdrop" data-viewing={viewing ? 'true' : 'false'} data-ready={ready ? 'true' : 'false'}
      data-place-shown={placeShown ?? undefined} aria-hidden={viewing ? undefined : 'true'}>
      <div className="studio-backdrop-stage" ref={stageRef} data-testid="studio-backdrop" data-floors={floors.length}>
        <div className="studio-overlay" ref={overlayRef} aria-hidden="true" />
        {viewing && ready && placeShown === null ? <p className="studio-hint">{t('studio.backdrop.hint')}</p> : null}
      </div>
      {placeShown !== null ? (
        <div className="studio-backdrop-place">
          <PlaceView key={placeShown} place={placeShown} state={state} client={client} look={look} paused={paused}
            onPlace={(place) => setChoice(place === 'studio' ? { kind: 'floor', id: selectedId } : { kind: 'place', place })}
            onOpenRoute={onOpenRoute} onOpenAgent={onLeave} onOpenRun={onOpenRun} />
        </div>
      ) : null}
      {viewing && ready ? (
        <div className="studio-floor-switch" role="radiogroup" aria-label={t('studio.backdrop.views')}>
          <button type="button" role="radio" aria-checked={choice.kind === 'follow'} onClick={() => {
            setChoice({ kind: 'follow' })
            setFollowed(wanted)
            since.current = Date.now()
          }}>
            <Crosshair size={14} aria-hidden="true" />
            <span>{t('studio.backdrop.follow', { place: placeLabel(followed) })}</span>
          </button>
          <p className="studio-switch-heading">{t('studio.floors')}</p>
          {building ? (
            <button type="button" role="radio" aria-checked={choice.kind === 'floor' && choice.id === null} onClick={() => setChoice({ kind: 'floor', id: null })}>
              <Building2 size={14} aria-hidden="true" />
              <span>{t('studio.building')}</span>
            </button>
          ) : null}
          {[...floors].reverse().map((floor) => (
            <button key={floor.id} type="button" role="radio" aria-checked={choice.kind === 'floor' && choice.id === floor.id} data-busy={floor.busy ? 'true' : 'false'}
              title={floor.number ? `${floor.number} · ${floor.title} · ${floor.summary}` : undefined} onClick={() => setChoice({ kind: 'floor', id: floor.id })}>
              {floor.number ? <strong>{floor.number}</strong> : <MessageSquare size={14} aria-hidden="true" />}
              <span>{floor.id === selectedId ? t('studio.backdrop.thisConversation') : floor.title}</span>
            </button>
          ))}
          <p className="studio-switch-heading">{t('places.campus.title')}</p>
          {CAMPUS.map((place) => {
            const Icon = PLACE_ICONS[place]
            return (
            <button key={place} type="button" role="radio" aria-checked={choice.kind === 'place' && choice.place === place} onClick={() => setChoice({ kind: 'place', place })}>
              <Icon size={14} aria-hidden="true" />
              <span>{placeLabel(place)}</span>
            </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

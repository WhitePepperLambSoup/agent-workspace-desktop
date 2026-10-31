import { useCallback, useEffect, useRef, useState } from 'react'

import type { JsonValue } from '../../../../shared/protocol'
import type { WorkbenchBridgeClient } from '../../bridge/client'
import type { GitFileDiff } from '../../changes/ChangesRoute'
import type { GitStatus } from '../../changes/GitPanel'
import type { WorkspaceFileItem } from '../../editor/FileTree'
import { useOptionalI18n, type I18nValue } from '../../i18n/I18nProvider'
import type { MessageKey } from '../../i18n/messages'
import { parseSnapshot, type KnowledgeSnapshot } from '../../knowledge/model'
import { requestEditor } from '../../preview/preview-request'
import { parseRuns, parseSchedules, type ScheduleRunView, type ScheduleView } from '../../schedules/model'
import { jobsFromPayload } from '../../state/projection-parsers'
import type { BackgroundJobSummary, WorkbenchState } from '../../state/workbench-types'
import { turnRunning } from '../cast'
import { busyTeams } from '../floors'
import type { StudioOptions } from '../scene'
import type { CampusModel, CampusPlace } from './campus'
import { libraryName } from '../../team/catalog'
import { activityKind } from '../../team/activity'
import { lookFor } from '../cast'
import { deskModel, dutyModel, libraryModel, serverModel, siteModel, visitorsOf, type PlaceId } from './models'
import type { PlaceBuilder, PlaceScene } from './stage'
import type { PlaceInput, PlaceVisitorView } from './types'

/** What the window asked the sidecar for, per place; null until it answered. */
interface PlaceData {
  knowledge: KnowledgeSnapshot | null
  works: Array<{ key?: string; id?: string; title: string }> | null
  files: WorkspaceFileItem[] | null
  diff: GitFileDiff[] | null
  /** Undefined until asked; null for a folder without Git. */
  git: GitStatus | null | undefined
  hosts: Array<{ name: string }> | null
  ssh: boolean
  jobs: BackgroundJobSummary[]
  schedules: ScheduleView[] | null
  runs: ScheduleRunView[] | null
  link: Record<string, JsonValue> | null
}

const EMPTY: PlaceData = { knowledge: null, works: null, files: null, diff: null, git: undefined, hosts: null, ssh: true, jobs: [], schedules: null, runs: null, link: null }
type Shown = Exclude<PlaceId, 'studio'>
const NEEDS: Record<Shown, ReadonlyArray<keyof PlaceData>> = {
  campus: ['knowledge', 'files', 'diff', 'git', 'hosts', 'jobs', 'schedules', 'runs', 'link'],
  library: ['knowledge', 'works'],
  site: ['files', 'diff', 'git'],
  servers: ['hosts', 'jobs'],
  duty: ['schedules', 'runs'],
  desk: ['link'],
}
/** The site reads this much of the folder: more does not fit in one reply for a large repository. */
const SITE_DEPTH = 6
const SITE_FILES = 1500
/** How often a place asks again while it is open. */
const EVERY: Record<Shown, number> = { campus: 15_000, library: 4_000, site: 8_000, servers: 5_000, duty: 10_000, desk: 4_000 }

/** Asks the sidecar for what the place shows, now and then while it is open; failures keep what was there. */
function usePlaceData(client: WorkbenchBridgeClient | undefined, place: Shown, turn: boolean): PlaceData {
  const [data, setData] = useState<PlaceData>(EMPTY)
  const patch = useCallback((next: Partial<PlaceData>) => setData((current) => ({ ...current, ...next })), [])
  useEffect(() => {
    if (!client) return undefined
    let alive = true
    const needs = new Set(NEEDS[place])
    const set = (next: Partial<PlaceData>): void => { if (alive) patch(next) }
    const payload = (response: { payload: unknown }): Record<string, JsonValue> => (response.payload ?? {}) as Record<string, JsonValue>
    let retry = 0
    // One question at a time, so a place does not crowd out the conversation's own requests;
    // what failed is asked again soon (the sidecar may have been busy).
    const load = async (first: boolean, attempt = 0): Promise<void> => {
      const asks: Array<() => Promise<unknown>> = []
      if (needs.has('knowledge')) asks.push(() => client.knowledgeStatus().then((response) => set({ knowledge: parseSnapshot(response.payload) })))
      // The reference library and the file tree change seldom: read once when the place opens.
      if (first && needs.has('works')) asks.push(() => client.listReferences().then((response) => set({ works: (payload(response).works as unknown as PlaceData['works']) ?? [] })))
      if (first && needs.has('hosts')) {
        asks.push(() => client.listServers().then((response) => {
          const value = payload(response)
          set({ hosts: Array.isArray(value.hosts) ? (value.hosts as unknown as Array<{ name: string }>) : [], ssh: value.ssh !== false })
        }))
      }
      if (needs.has('jobs')) asks.push(() => client.listJobs({ limit: 20, sessionScope: 'workspace' }).then((response) => set({ jobs: jobsFromPayload(payload(response).jobs) })))
      if (needs.has('schedules')) asks.push(() => client.listSchedules().then((response) => set({ schedules: parseSchedules(payload(response)).schedules })))
      if (needs.has('runs')) asks.push(() => client.listScheduleRuns({ limit: 30 }).then((response) => set({ runs: parseRuns(payload(response)) })))
      if (needs.has('link')) asks.push(() => client.deviceLinkStatus().then((response) => set({ link: payload(response) })))
      // The folder's files and Git state take longest on a large repository: asked last.
      if (first && needs.has('files')) asks.push(() => client.getWorkspaceFilesTree('', SITE_DEPTH, SITE_FILES).then((response) => set({ files: (payload(response).files as unknown as WorkspaceFileItem[]) ?? [] })))
      if (needs.has('diff')) asks.push(() => client.getGitDiff().then((response) => set({ diff: (payload(response).files as unknown as GitFileDiff[]) ?? [] })))
      if (needs.has('git')) asks.push(() => client.gitStatus().then((response) => set({ git: (payload(response).status as unknown as GitStatus) ?? null })))
      let failed = false
      for (const ask of asks) {
        if (!alive) return
        try {
          await ask()
        } catch {
          failed = true
        }
      }
      // A couple of quick tries; a question that keeps failing waits for the next round.
      if (failed && alive && attempt < 2) {
        window.clearTimeout(retry)
        retry = window.setTimeout(() => void load(first, attempt + 1), 2000)
      }
    }
    void load(true)
    const timer = window.setInterval(() => void load(false), EVERY[place])
    return () => {
      alive = false
      window.clearInterval(timer)
      window.clearTimeout(retry)
    }
  }, [client, patch, place])
  // A turn that ends may have changed the folder's files.
  const wasTurn = useRef(turn)
  useEffect(() => {
    if (!client || wasTurn.current === turn) return
    wasTurn.current = turn
    if (turn || !NEEDS[place].includes('files')) return
    void client.getWorkspaceFilesTree('', SITE_DEPTH, SITE_FILES).then((response) => patch({ files: ((response.payload as Record<string, unknown>).files as WorkspaceFileItem[]) ?? [] })).catch(() => undefined)
  }, [client, patch, place, turn])
  return data
}

type Translate = I18nValue['t']

/** The campus's buildings: whether something goes on in each, and a line about it. */
export function campusModel(state: WorkbenchState, data: PlaceData, t: Translate, now: number): CampusModel {
  const selected = typeof state.selectedSession?.id === 'string' ? state.selectedSession.id : null
  const teams = busyTeams(state).length
  const working = turnRunning(state, selected)
  const library = libraryModel(data.knowledge, null, state, '')
  const site = siteModel(data.files, data.diff, data.git, state)
  const servers = serverModel(data.hosts, data.ssh, data.jobs, state)
  const duty = dutyModel(data.schedules, data.runs, now)
  const desk = deskModel(data.link, state, now)
  const documents = (data.knowledge?.documents ?? []).length
  const next = duty.upcoming[0]
  const nextTime = next ? new Date(next.at) : null
  const online = desk.phones.filter((phone) => phone.online).length
  const jobsRunning = servers.racks.reduce((total, rack) => total + rack.running, 0)
  const spots: Record<CampusPlace, CampusModel['spots'][CampusPlace]> = {
    studio: {
      busy: teams > 0 || working,
      alert: Object.values(state.approvals).some((item) => item.sessionId === selected),
      detail: teams > 0 ? t('places.studio.teams', { count: teams }) : working ? t('places.studio.working') : t('places.studio.idle'),
    },
    library: {
      busy: library.librarian.state !== 'idle' || library.clerk,
      alert: library.cart.some((book) => book.state === 'failed'),
      detail: data.knowledge === null ? '' : library.clerk ? t('places.library.reading', { count: library.cart.length }) : t('places.library.summary', { bases: library.cases.length, count: documents }),
    },
    site: {
      busy: site.worker.state !== 'idle' || site.checks.running,
      alert: site.checks.failed.length > 0 || (data.git?.conflicts.length ?? 0) > 0,
      detail: data.diff === null ? '' : site.changed > 0 ? t('places.site.changed', { count: site.changed }) : t('places.site.clean'),
    },
    servers: {
      busy: servers.racks.some((rack) => rack.busy || rack.running > 0),
      alert: servers.racks.some((rack) => rack.failed),
      detail: jobsRunning > 0 ? t('places.servers.running', { count: jobsRunning }) : data.hosts === null ? '' : t('places.servers.summary', { count: servers.racks.length - 1 + servers.more }),
    },
    duty: {
      busy: duty.officers.some((officer) => officer.state === 'running'),
      alert: duty.officers.some((officer) => officer.state === 'failed'),
      detail: next && nextTime && !Number.isNaN(nextTime.getTime())
        ? t('places.duty.next', { time: nextTime.toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' }), title: next.title })
        : data.schedules === null ? '' : t('places.duty.none'),
    },
    desk: {
      busy: online > 0 || desk.outgoing > 0,
      alert: desk.error,
      detail: data.link === null ? '' : desk.enabled ? t('places.desk.summary', { online, count: desk.phones.length }) : t('places.desk.closed'),
    },
  }
  return { spots, floors: Math.max(1, teams) }
}

const BUILDERS: Record<Shown, string> = { campus: 'buildCampus', library: 'buildLibrary', site: 'buildSite', servers: 'buildServers', duty: 'buildDuty', desk: 'buildDesk' }

/**
 * One place of the campus, or the campus itself: its 3D, and below it a list of what is in it for
 * keyboards and screen readers. Picks open what was clicked: a page of the window, a file, the
 * conversation, or (on the campus) a place.
 */
export function PlaceView({ place, state, client, look, paused, resets = 0, onPlace, onOpenRoute, onOpenAgent, onOpenRun, onReady }: {
  place: Shown
  state: WorkbenchState
  client?: WorkbenchBridgeClient
  look: StudioOptions
  paused: boolean
  /** Each new count flies the camera back to its first view. */
  resets?: number
  onPlace: (place: Exclude<PlaceId, 'campus'>) => void
  onOpenRoute?: (route: string) => void
  onOpenAgent?: () => void
  /** An expert's task, from someone working in the place. */
  onOpenRun?: (runId: string) => void
  /** The scene is drawn (true), or could not be (null). */
  onReady?: (ready: boolean | null) => void
}) {
  const { t, locale } = useOptionalI18n()
  const selected = typeof state.selectedSession?.id === 'string' ? state.selectedSession.id : null
  const turn = turnRunning(state, selected)
  const data = usePlaceData(client, place, turn)
  const stageRef = useRef<HTMLDivElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<PlaceScene<PlaceInput<unknown>> | null>(null)
  const [ready, setReady] = useState(false)
  const [unsupported, setUnsupported] = useState(false)

  // The clock moves the duty room and the phones' presence along without new data.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15_000)
    return () => window.clearInterval(timer)
  }, [])

  const translate = t as (key: MessageKey, values?: Record<string, string | number>) => string
  const model: unknown = place === 'campus' ? campusModel(state, data, t, now)
    : place === 'library' ? libraryModel(data.knowledge, data.works, state, t('knowledge.defaultBase'))
      : place === 'site' ? siteModel(data.files, data.diff, data.git, state)
        : place === 'servers' ? serverModel(data.hosts, data.ssh, data.jobs, state)
          : place === 'duty' ? dutyModel(data.schedules, data.runs, now)
            : deskModel(data.link, state, now)
  // Experts of any conversation's team whose work is here come in.
  const visitors: PlaceVisitorView[] = place === 'library' || place === 'site' || place === 'servers'
    ? visitorsOf(state, place).map((visitor) => ({
      id: `run-${visitor.runId}`,
      name: (visitor.expert ? libraryName(visitor.expert, locale) : null) ?? visitor.title,
      stateLabel: t(`team.activity.${activityKind(visitor.tool)}` as MessageKey),
      look: lookFor(visitor.expert ?? visitor.runId),
      pick: `run:${visitor.runId}`,
    }))
    : []
  const input: PlaceInput<unknown> = { model, t: translate, lead: t('studio.lead'), visitors }
  const signature = JSON.stringify([model, visitors])
  const latest = useRef(input)
  latest.current = input

  const actions = useRef({ onPlace, onOpenRoute, onOpenAgent, onOpenRun })
  actions.current = { onPlace, onOpenRoute, onOpenAgent, onOpenRun }
  const pick = useCallback((id: string) => {
    const { onPlace: go, onOpenRoute: open, onOpenAgent: agent, onOpenRun: run } = actions.current
    if (id === 'agent') agent?.()
    else if (id.startsWith('run:')) run?.(id.slice(4))
    else if (id.startsWith('route:')) open?.(id.slice(6))
    else if (id.startsWith('file:')) requestEditor(id.slice(5))
    else if (id.startsWith('place:')) {
      const next = id.slice(6) as Exclude<PlaceId, 'campus'>
      void (sceneRef.current?.approach(id) ?? Promise.resolve()).then(() => go(next))
    }
  }, [])

  useEffect(() => {
    const stage = stageRef.current
    const overlay = overlayRef.current
    if (!stage || !overlay) return undefined
    let cancelled = false
    let created: PlaceScene<PlaceInput<unknown>> | null = null
    setReady(false)
    void import('./scene').then((module) => {
      if (cancelled) return
      const build = (module as unknown as Record<string, PlaceBuilder<PlaceInput<unknown>>>)[BUILDERS[place]]!
      try {
        created = module.createPlaceScene(stage, overlay, look, build, { pick })
      } catch {
        setUnsupported(true)
        onReady?.(null)
        return
      }
      sceneRef.current = created
      created.update(latest.current)
      setUnsupported(false)
      setReady(true)
      onReady?.(true)
    }).catch(() => { if (!cancelled) setUnsupported(true) })
    return () => {
      cancelled = true
      created?.dispose()
      sceneRef.current = null
    }
    // onReady only reports; a new callback is no reason to build the place again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [look, pick, place])

  useEffect(() => {
    sceneRef.current?.update(latest.current)
  }, [signature, ready, t])

  useEffect(() => {
    sceneRef.current?.setPaused(paused)
  }, [paused, ready])

  useEffect(() => {
    if (resets > 0) sceneRef.current?.resetView()
  }, [resets])

  return (
    <>
      <div className="studio-stage place-stage" ref={stageRef} data-ready={ready ? 'true' : 'false'} data-place={place}>
        <div className="studio-overlay" ref={overlayRef} aria-hidden="true" />
        {unsupported ? <p className="studio-unsupported" role="status">{t('studio.unsupported')}</p> : null}
        {ready ? <p className="studio-hint">{t(place === 'campus' ? 'places.campus.hint' : 'places.hint')}</p> : null}
      </div>
      <PlaceRoster place={place} model={model} t={t} onPick={pick} />
    </>
  )
}

/** The place's contents as a list: what the 3D shows, for keyboards and screen readers. */
function PlaceRoster({ place, model, t, onPick }: { place: Shown; model: unknown; t: Translate; onPick: (id: string) => void }) {
  const items: Array<{ id: string; title: string; detail: string; pick?: string; busy?: boolean }> = []
  if (place === 'campus') {
    const campus = model as CampusModel
    for (const [id, spot] of Object.entries(campus.spots)) items.push({ id, title: t(`places.${id}.title` as MessageKey), detail: spot.detail, pick: `place:${id}`, busy: spot.busy })
  } else if (place === 'library') {
    const library = model as ReturnType<typeof libraryModel>
    for (const item of library.cases) items.push({ id: item.id, title: item.name, detail: t('places.library.documents', { count: item.total }), pick: 'route:knowledge', busy: library.librarian.caseId === item.id && library.librarian.state !== 'idle' })
    items.push({ id: 'papers', title: t('places.library.papers'), detail: t('places.library.paperCount', { count: library.papers.total }), pick: 'route:workspace' })
  } else if (place === 'site') {
    const site = model as ReturnType<typeof siteModel>
    const changed = site.districts.flatMap((district) => district.buildings.filter((building) => building.changed || building.editing))
    for (const building of changed.slice(0, 12)) items.push({ id: building.path, title: building.path, detail: building.editing ? t('places.site.worker.editing') : t('places.site.uncommitted'), pick: `file:${building.path}`, busy: building.editing })
    if (changed.length === 0 && site.known) items.push({ id: 'clean', title: site.branch ?? t('places.site.noGit'), detail: t('places.site.clean'), pick: 'route:changes' })
  } else if (place === 'servers') {
    const servers = model as ReturnType<typeof serverModel>
    for (const rack of servers.racks) items.push({ id: rack.id, title: rack.local ? t('places.servers.local') : rack.name, detail: rack.failed ? t('places.servers.failed') : rack.running > 0 ? t('places.servers.running', { count: rack.running }) : rack.busy ? t('places.servers.busy') : t('places.servers.idle'), ...(rack.local ? { pick: 'route:jobs' } : {}), busy: rack.busy })
  } else if (place === 'duty') {
    const duty = model as ReturnType<typeof dutyModel>
    for (const officer of duty.officers) items.push({ id: officer.id, title: officer.title || t('places.duty.untitled'), detail: t(`places.duty.state.${officer.state}` as MessageKey), pick: 'route:schedules', busy: officer.state === 'running' })
    if (duty.officers.length === 0) items.push({ id: 'none', title: t('places.duty.empty'), detail: '', pick: 'route:schedules' })
  } else {
    const desk = model as ReturnType<typeof deskModel>
    for (const phone of desk.phones) items.push({ id: phone.id, title: phone.name, detail: phone.online ? t('places.desk.online') : t('places.desk.offline'), pick: 'route:settings', busy: phone.online })
    if (desk.phones.length === 0) items.push({ id: 'none', title: t('places.desk.noPhones'), detail: desk.enabled ? '' : t('places.desk.closed'), pick: 'route:settings' })
  }
  return (
    <ul className="studio-roster studio-floor-list place-roster" aria-label={t(`places.${place}.title` as MessageKey)}>
      {items.map((item) => (
        <li key={item.id} data-busy={item.busy ? 'true' : 'false'}>
          <button type="button" disabled={!item.pick} onClick={() => item.pick && onPick(item.pick)}>
            <span className="studio-floor-dot" aria-hidden="true" />
            <strong className="studio-floor-name">{item.title}</strong>
            {item.detail ? <span>{item.detail}</span> : null}
          </button>
        </li>
      ))}
    </ul>
  )
}

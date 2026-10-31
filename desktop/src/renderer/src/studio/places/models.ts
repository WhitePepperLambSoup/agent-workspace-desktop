import type { JsonValue } from '../../../../shared/protocol'
import type { GitFileDiff } from '../../changes/ChangesRoute'
import type { GitStatus } from '../../changes/GitPanel'
import type { WorkspaceFileItem } from '../../editor/FileTree'
import type { KnowledgeSnapshot, KnowledgeState } from '../../knowledge/model'
import type { ScheduleRunView, ScheduleView } from '../../schedules/model'
import type { BackgroundJobSummary, WorkbenchState } from '../../state/workbench-types'
import { toolCalls, turnRunning } from '../cast'

/**
 * What each place of the campus shows, from what the window knows: the knowledge base and the
 * reference library, the open folder's files and changes, the servers of ~/.ssh/config and the
 * jobs the conversation ran on them, the scheduled tasks, the paired phones. Nothing is made up:
 * an empty knowledge base is an empty bookcase.
 */

export type PlaceId = 'campus' | 'studio' | 'library' | 'site' | 'servers' | 'duty' | 'desk'
export const PLACES: readonly Exclude<PlaceId, 'campus'>[] = ['studio', 'library', 'site', 'servers', 'duty', 'desk']

type Tool = Record<string, JsonValue>

function text(value: JsonValue | undefined): string | undefined {
  return typeof value === 'string' && value ? value : undefined
}

function toolName(tool: Tool): string {
  return text(tool.toolName) ?? text(tool.name) ?? ''
}

/** A tool's arguments or result, which may come as an object or as JSON text. */
function record(value: JsonValue | undefined): Record<string, JsonValue> | null {
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value) as JsonValue
    } catch {
      return null
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null
}

function list(value: JsonValue | undefined): Record<string, JsonValue>[] {
  return Array.isArray(value) ? value.flatMap((item) => (item && typeof item === 'object' && !Array.isArray(item) ? [item] : [])) : []
}

/** The conversation's tools, oldest first, that match. */
function toolsOf(state: WorkbenchState, test: (name: string) => boolean): Tool[] {
  return [...toolCalls(state, 'all').values()].filter((tool) => test(toolName(tool)))
}

const running = (tool: Tool): boolean => tool.state === 'started' || tool.state === 'approved'

// ---- library ---------------------------------------------------------------------------------

export type BookKind = 'pdf' | 'word' | 'sheet' | 'slides' | 'web' | 'text' | 'image' | 'other'

export interface LibraryBook {
  id: string
  title: string
  kind: BookKind
  /** How much there is to it (passages, or 1 for a paper): the spine's thickness. */
  size: number
  state: KnowledgeState
  /** The latest search of the conversation found it. */
  cited: boolean
}

export interface LibraryCase {
  id: string
  name: string
  /** Documents in this knowledge base, also those that do not fit on its shelves. */
  total: number
  books: LibraryBook[]
}

export type LibrarianState = 'idle' | 'searching' | 'reading' | 'adding' | 'papers'

export interface LibraryModel {
  enabled: boolean
  /** Knowledge bases, one bookcase each; past the last case they share it. */
  cases: LibraryCase[]
  /** Documents still being read in (or that failed), on the cart by the desk. */
  cart: LibraryBook[]
  papers: { total: number; books: LibraryBook[] }
  librarian: { state: LibrarianState; caseId: string | null; cited: number }
  /** Documents are being read in: the clerk at the scanner. */
  clerk: boolean
}

export const LIBRARY_CASES = 5
export const BOOKS_PER_CASE = 72
export const PAPERS_SHOWN = 60

export function bookKind(name: string): BookKind {
  const lower = name.toLowerCase()
  if (/^https?:/.test(lower)) return 'web'
  const suffix = lower.split('.').pop() ?? ''
  if (suffix === 'pdf') return 'pdf'
  if (['doc', 'docx', 'odt', 'rtf', 'wps'].includes(suffix)) return 'word'
  if (['xls', 'xlsx', 'csv', 'ods', 'et'].includes(suffix)) return 'sheet'
  if (['ppt', 'pptx', 'odp', 'dps'].includes(suffix)) return 'slides'
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tif', 'tiff'].includes(suffix)) return 'image'
  if (['txt', 'md', 'markdown', 'html', 'htm', 'json', 'xml', 'tex', 'epub'].includes(suffix)) return 'text'
  return 'other'
}

const LIBRARY_TOOLS = /^(paper_|read_paper|reference_library|list_research_sources|read_research_source|save_research_source|list_citations|check_references|add_citation|export_references)/

/** The documents the conversation's latest knowledge search found. */
function citedDocuments(state: WorkbenchState): Set<string> {
  const searches = toolsOf(state, (name) => name === 'knowledge_search').filter((tool) => tool.state === 'settled')
  const result = record(searches.at(-1)?.result)
  return new Set(list(result?.results).flatMap((item) => {
    const id = text(item.document_id) ?? text(item.documentId)
    return id ? [id] : []
  }))
}

export function libraryModel(snapshot: KnowledgeSnapshot | null, works: ReadonlyArray<{ key?: string; id?: string; title: string }> | null, state: WorkbenchState, defaultName: string): LibraryModel {
  const cited = citedDocuments(state)
  const documents = snapshot?.documents ?? []
  const book = (document: KnowledgeSnapshot['documents'][number]): LibraryBook => ({
    id: document.id,
    title: document.title,
    kind: bookKind(document.originPath ?? document.origin ?? document.title),
    size: Math.max(1, document.passages),
    state: document.state,
    cited: cited.has(document.id),
  })
  const collections = snapshot?.collections ?? []
  const cases: LibraryCase[] = []
  collections.forEach((collection, index) => {
    const shelved = documents.filter((document) => document.collectionId === collection.id && document.state === 'ready')
    const name = collection.id === 'default' && !collection.name ? defaultName : collection.label
    if (index < LIBRARY_CASES) {
      cases.push({ id: collection.id, name, total: collection.documents, books: [] })
    }
    const target = cases[Math.min(index, LIBRARY_CASES - 1)]!
    if (index >= LIBRARY_CASES) target.total += collection.documents
    // The cited ones first, so they are on the shelves even in a full case; then the newest.
    const ordered = [...shelved].sort((a, b) => Number(cited.has(b.id)) - Number(cited.has(a.id)) || b.createdAt.localeCompare(a.createdAt))
    target.books.push(...ordered.map(book))
  })
  for (const item of cases) item.books = item.books.slice(0, BOOKS_PER_CASE)
  const cart = documents.filter((document) => document.state !== 'ready').slice(0, 10).map(book)

  // The librarian is the conversation's agent: at the shelves while it searches the knowledge
  // base, at the papers while it works with the literature, at the reading table with what it
  // found while it writes the answer.
  const knowledge = toolsOf(state, (name) => name.startsWith('knowledge_'))
  const papers = toolsOf(state, (name) => LIBRARY_TOOLS.test(name))
  const turn = turnRunning(state, text(state.selectedSession?.id) ?? null)
  const firstCited = documents.find((document) => cited.has(document.id))
  const caseOf = (collectionId: string | undefined): string | null => {
    const index = collections.findIndex((collection) => collection.id === collectionId)
    return index < 0 ? null : cases[Math.min(index, LIBRARY_CASES - 1)]?.id ?? null
  }
  let librarian: LibraryModel['librarian'] = { state: 'idle', caseId: null, cited: cited.size }
  if (turn) {
    if (knowledge.some((tool) => running(tool) && toolName(tool) === 'knowledge_add')) librarian = { ...librarian, state: 'adding' }
    else if (knowledge.some(running)) librarian = { ...librarian, state: 'searching', caseId: caseOf(firstCited?.collectionId) ?? cases[0]?.id ?? null }
    else if (papers.some(running)) librarian = { ...librarian, state: 'papers' }
    else if (cited.size > 0) librarian = { ...librarian, state: 'reading', caseId: caseOf(firstCited?.collectionId) }
  }
  const paperBooks = (works ?? []).slice(0, PAPERS_SHOWN).map((work, index): LibraryBook => ({
    id: work.key ?? work.id ?? `paper-${index}`, title: work.title, kind: 'pdf', size: 1, state: 'ready', cited: false,
  }))
  return {
    enabled: snapshot?.enabled !== false,
    cases,
    cart,
    papers: { total: works?.length ?? 0, books: paperBooks },
    librarian,
    clerk: documents.some((document) => document.state === 'queued' || document.state === 'indexing'),
  }
}

// ---- building site ---------------------------------------------------------------------------

export type BuildingKind = 'code' | 'web' | 'doc' | 'data' | 'config' | 'asset' | 'other'

export interface SiteBuilding {
  path: string
  name: string
  /** 0..1 from the file's size, on a log scale. */
  height: number
  kind: BuildingKind
  changed: boolean
  conflict: boolean
  /** The agent is writing it now. */
  editing: boolean
}

export interface SiteDistrict {
  name: string
  /** Files in this top-level folder, also those not shown. */
  total: number
  buildings: SiteBuilding[]
}

/** The agent at the site: between two steps of its turn it thinks at the office. */
export type WorkerState = 'idle' | 'editing' | 'testing' | 'reading' | 'thinking'

export interface SiteModel {
  folder: string | null
  districts: SiteDistrict[]
  files: number
  changed: number
  branch: string | null
  /** The folder's Git state has been read: until then the site says nothing of it. */
  known: boolean
  /** Commits not pushed yet: trucks waiting at the gate. */
  ahead: number
  head: string | null
  checks: { running: boolean; failed: string[]; passed: number }
  worker: { state: WorkerState; path: string | null }
}

export const SITE_DISTRICTS = 8
export const SITE_BUILDINGS = 180

const SKIPPED = /(^|\/)(node_modules|\.git|\.venv|venv|__pycache__|dist|out|build|target|\.next|coverage|\.mypy_cache|\.pytest_cache|\.ruff_cache)(\/|$)/

export function buildingKind(path: string): BuildingKind {
  const suffix = path.toLowerCase().split('.').pop() ?? ''
  if (['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'rs', 'go', 'java', 'kt', 'c', 'h', 'cc', 'cpp', 'hpp', 'cs', 'rb', 'php', 'swift', 'scala', 'lua', 'sh', 'ps1', 'r', 'm', 'jl', 'vue', 'svelte'].includes(suffix)) return 'code'
  if (['html', 'htm', 'css', 'scss', 'less'].includes(suffix)) return 'web'
  if (['md', 'txt', 'rst', 'tex', 'bib', 'docx', 'doc', 'pdf', 'pptx', 'odt'].includes(suffix)) return 'doc'
  if (['json', 'csv', 'xlsx', 'xls', 'parquet', 'sqlite', 'db', 'npy', 'h5', 'jsonl', 'tsv'].includes(suffix)) return 'data'
  if (['toml', 'yaml', 'yml', 'ini', 'cfg', 'lock', 'xml', 'env', 'gitignore', 'editorconfig'].includes(suffix)) return 'config'
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'mp3', 'mp4', 'wav', 'ttf', 'woff', 'woff2'].includes(suffix)) return 'asset'
  return 'other'
}

const EDIT_TOOLS = /^(write_file|apply_patch|edit_|create_|update_|move_path|delete_path|make_directory)/
const TEST_TOOLS = /^(run_|debug_python|code_diagnostics|check_page)/
const READ_TOOLS = /^(read_file|list_files|search_files|code_map|find_|list_symbols|git_)/

/**
 * The open folder as a building site: top-level folders are districts, files are buildings.
 * `diff` is null and `status` undefined until read; a null status is a folder without Git.
 */
export function siteModel(
  files: readonly WorkspaceFileItem[] | null,
  diff: readonly GitFileDiff[] | null,
  status: GitStatus | null | undefined,
  state: WorkbenchState,
): SiteModel {
  const changed = new Set((diff ?? []).map((item) => item.filePath.replace(/\\/g, '/')))
  const conflicts = new Set((status?.conflicts ?? []).map((item) => item.path.replace(/\\/g, '/')))
  const active = [...toolCalls(state).values()].filter(running)
  const editing = active.find((tool) => EDIT_TOOLS.test(toolName(tool)))
  const editPath = text(record(editing?.arguments)?.path)?.replace(/\\/g, '/') ?? null
  const all = (files ?? []).filter((item) => item.type === 'file' && !SKIPPED.test(item.path.replace(/\\/g, '/')))
  const largest = Math.max(1, ...all.map((item) => item.size))
  const building = (item: WorkspaceFileItem): SiteBuilding => {
    const path = item.path.replace(/\\/g, '/')
    return {
      path,
      name: item.name,
      height: Math.min(1, Math.log2(1 + item.size) / Math.log2(1 + largest)),
      kind: buildingKind(path),
      changed: changed.has(path),
      conflict: conflicts.has(path),
      editing: editPath !== null && path === editPath,
    }
  }
  // Districts by top-level folder, the root's own files as one; the busiest first.
  const groups = new Map<string, WorkspaceFileItem[]>()
  for (const item of all) {
    const path = item.path.replace(/\\/g, '/')
    const name = path.includes('/') ? path.split('/')[0]! : '.'
    groups.set(name, [...(groups.get(name) ?? []), item])
  }
  const order = [...groups.entries()].sort((a, b) => b[1].length - a[1].length)
  const shown = order.slice(0, SITE_DISTRICTS)
  const share = Math.max(8, Math.floor(SITE_BUILDINGS / Math.max(1, shown.length)))
  const districts = shown.map(([name, items]) => {
    // Changed and edited files always stand; then the largest.
    const ranked = [...items].map(building).sort((a, b) =>
      Number(b.editing) - Number(a.editing) || Number(b.changed || b.conflict) - Number(a.changed || a.conflict) || b.height - a.height)
    return { name, total: items.length, buildings: ranked.slice(0, share) }
  })
  const checks = state.checks
  const failed = (checks?.results ?? []).filter((result) => !result.ok).map((result) => result.name)
  const workerState: WorkerState = !turnRunning(state, text(state.selectedSession?.id) ?? null) ? 'idle'
    : editing ? 'editing'
      : active.some((tool) => TEST_TOOLS.test(toolName(tool))) || checks?.running ? 'testing'
        : active.some((tool) => READ_TOOLS.test(toolName(tool))) ? 'reading'
          : agentPlace(state) === 'site' ? 'thinking' : 'idle'
  return {
    folder: text(state.workspace?.name) ?? null,
    districts,
    files: all.length,
    changed: changed.size,
    branch: status?.branch ?? null,
    known: diff !== null && status !== undefined,
    ahead: status?.ahead ?? 0,
    head: status?.head ?? null,
    checks: { running: checks?.running ?? false, failed, passed: (checks?.results ?? []).length - failed.length },
    worker: { state: workerState, path: editPath },
  }
}

// ---- server room -----------------------------------------------------------------------------

export interface ServerJob { id: string; name: string; state: string }

export interface ServerRack {
  /** 'local' for this computer, else the host's name in ~/.ssh/config. */
  id: string
  name: string
  local: boolean
  /** The conversation is running something there now. */
  busy: boolean
  /** The last thing run there failed (could not connect, or exited with an error). */
  failed: boolean
  running: number
  queued: number
  finished: number
  jobs: ServerJob[]
}

export interface ServerModel {
  ssh: boolean
  racks: ServerRack[]
  /** Hosts in ~/.ssh/config that do not fit in the room. */
  more: number
  technician: { state: 'idle' | 'working' | 'waiting'; rack: string | null }
}

export const SERVER_RACKS = 6
const REMOTE_TOOLS = /^(remote_run|remote_copy|slurm_jobs)$/
const LOCAL_TOOLS = /^(run_process|run_terminal|run_wsl|start_background_job|stop_background_job|run_checks|debug_python)$/
const RUNNING_JOB = /^(running|starting|queued|pending)$/i

function slurmJobs(result: Record<string, JsonValue> | null): ServerJob[] {
  return [...list(result?.queued), ...list(result?.finished)].flatMap((job) => {
    const id = text(job.id)
    return id ? [{ id, name: text(job.name) ?? '', state: (text(job.state) ?? '').toUpperCase() }] : []
  })
}

/**
 * Racks for this computer and each host of ~/.ssh/config; what runs on them from the jobs list
 * and the conversation's remote tools (the latest Slurm status the agent asked for, as it was).
 */
export function serverModel(hosts: ReadonlyArray<{ name: string }> | null, ssh: boolean, jobs: readonly BackgroundJobSummary[], state: WorkbenchState): ServerModel {
  const approvals = Object.values(state.approvals)
  const remote = toolsOf(state, (name) => REMOTE_TOOLS.test(name))
  const hostOf = (tool: Tool): string | undefined => text(record(tool.arguments)?.host) ?? text(record(tool.result)?.host)
  const localActive = [...toolCalls(state).values()].some((tool) => running(tool) && LOCAL_TOOLS.test(toolName(tool)))
  const localRunning = jobs.filter((job) => RUNNING_JOB.test(job.state)).length
  const local: ServerRack = {
    id: 'local', name: '', local: true, busy: localActive || localRunning > 0,
    // The jobs list is newest first.
    failed: jobs[0]?.state === 'failed',
    running: localRunning, queued: 0, finished: jobs.length - localRunning,
    jobs: jobs.slice(0, 12).map((job) => ({ id: job.jobId, name: job.label ?? job.jobId, state: job.state })),
  }
  const named = [...(hosts ?? [])]
  // Hosts the conversation used come first, so they are in the room.
  const used = new Set(remote.map(hostOf).filter((host): host is string => Boolean(host)))
  named.sort((a, b) => Number(used.has(b.name)) - Number(used.has(a.name)))
  for (const host of used) if (!named.some((item) => item.name === host)) named.unshift({ name: host })
  const racks = named.slice(0, SERVER_RACKS - 1).map((host): ServerRack => {
    const mine = remote.filter((tool) => hostOf(tool) === host.name)
    const latest = mine.at(-1)
    const status = [...mine].reverse().find((tool) => toolName(tool) === 'slurm_jobs' && tool.state === 'settled' && record(tool.result))
    const slurm = slurmJobs(record(status?.result))
    const exit = record(latest?.result)?.exit_code
    return {
      id: host.name,
      name: host.name,
      local: false,
      busy: mine.some(running),
      failed: latest?.state === 'failed' || (typeof exit === 'number' && exit !== 0),
      running: slurm.filter((job) => job.state === 'RUNNING').length,
      queued: slurm.filter((job) => job.state === 'PENDING').length,
      finished: slurm.filter((job) => job.state !== 'RUNNING' && job.state !== 'PENDING').length,
      jobs: slurm.slice(0, 12),
    }
  })
  const working = remote.find(running)
  const waiting = approvals.some((item) => REMOTE_TOOLS.test(text(item.toolName) ?? ''))
  const technician: ServerModel['technician'] = working ? { state: 'working', rack: hostOf(working) ?? null }
    : waiting ? { state: 'waiting', rack: null }
      : localActive ? { state: 'working', rack: 'local' } : { state: 'idle', rack: null }
  return { ssh, racks: [local, ...racks], more: Math.max(0, named.length - (SERVER_RACKS - 1)), technician }
}

// ---- duty room -------------------------------------------------------------------------------

export type OfficerState = 'running' | 'soon' | 'idle' | 'failed' | 'done' | 'off'

export interface DutyOfficer {
  id: string
  title: string
  state: OfficerState
  next: string | null
}

export interface DutyModel {
  officers: DutyOfficer[]
  more: number
  /** The next runs, soonest first. */
  upcoming: Array<{ id: string; title: string; at: string }>
}

export const DUTY_DESKS = 8
/** Within this long before its next run, an officer gets up and goes to the desk. */
const SOON_MS = 90_000

export function dutyModel(schedules: readonly ScheduleView[] | null, runs: readonly ScheduleRunView[] | null, now: number): DutyModel {
  const all = schedules ?? []
  const latest = new Map<string, ScheduleRunView>()
  for (const run of runs ?? []) {
    const known = latest.get(run.scheduleId)
    if (!known || run.updatedAt > known.updatedAt) latest.set(run.scheduleId, run)
  }
  const officers = all.map((schedule): DutyOfficer => {
    const last = latest.get(schedule.id) ?? schedule.lastRun
    const next = schedule.nextRun
    const due = next ? Date.parse(next) - now : Infinity
    const state: OfficerState = last && (last.state === 'running' || last.state === 'starting') ? 'running'
      : !schedule.enabled ? 'off'
        : due <= SOON_MS ? 'soon'
          : last && !last.read && (last.state === 'failed' || last.state === 'interrupted' || last.state === 'missed') ? 'failed'
            : last && !last.read && last.state === 'succeeded' ? 'done' : 'idle'
    return { id: schedule.id, title: schedule.title, state, next }
  })
  // Those at work and due first, then the others in the list's order.
  const rank: Record<OfficerState, number> = { running: 0, soon: 1, failed: 2, done: 3, idle: 4, off: 5 }
  const ordered = [...officers].sort((a, b) => rank[a.state] - rank[b.state])
  const upcoming = all.filter((schedule) => schedule.enabled && schedule.nextRun)
    .map((schedule) => ({ id: schedule.id, title: schedule.title, at: schedule.nextRun! }))
    .sort((a, b) => a.at.localeCompare(b.at))
    .slice(0, 5)
  return { officers: ordered.slice(0, DUTY_DESKS), more: Math.max(0, ordered.length - DUTY_DESKS), upcoming }
}

// ---- front desk ------------------------------------------------------------------------------

export interface DeskPhone {
  id: string
  name: string
  /** Seen in the last two minutes. */
  online: boolean
  /** What it did last, within the last minute: it comes up to the counter. */
  recent: string | null
}

export interface DeskModel {
  enabled: boolean
  running: boolean
  error: boolean
  pairing: boolean
  phones: DeskPhone[]
  /** Requests this computer sent to a phone, still under way. */
  outgoing: number
}

const ONLINE_MS = 120_000
const RECENT_MS = 60_000
const FINISHED_PHONE_JOBS = new Set(['succeeded', 'failed', 'rejected', 'expired', 'cancelled'])

export function deskModel(status: Record<string, JsonValue> | null, state: WorkbenchState, now: number): DeskModel {
  const phones = list(status?.devices).flatMap((device): DeskPhone[] => {
    const id = text(device.deviceId)
    if (!id) return []
    const seen = text(device.lastSeenAt)
    const activity = list(device.activity).flatMap((step) => {
      const at = text(step.at)
      const action = text(step.action)
      return at && action ? [{ at, action }] : []
    }).sort((a, b) => b.at.localeCompare(a.at))
    const last = activity[0]
    return [{
      id,
      name: text(device.name) ?? id,
      online: seen !== undefined && now - Date.parse(seen) < ONLINE_MS,
      recent: last && now - Date.parse(last.at) < RECENT_MS ? last.action : null,
    }]
  })
  return {
    enabled: status?.enabled === true,
    running: status?.running === true,
    error: Boolean(text(status?.error)),
    pairing: Boolean(status?.pairing && typeof status.pairing === 'object'),
    phones,
    outgoing: Object.values(state.phoneJobs ?? {}).filter((job) => !FINISHED_PHONE_JOBS.has(job.state)).length,
  }
}

// ---- where the work is ---------------------------------------------------------------------

const PAPER_TOOLS = /^(knowledge_|paper_|read_paper|reference_library|list_research_sources|read_research_source|save_research_source|check_references|add_citation|list_citations|export_references)/
const SITE_TOOLS = /^(apply_patch|code_diagnostics|find_definition|find_references|list_symbols|run_checks|run_process|run_terminal|run_wsl|debug_python|check_page|git_|code_map)/
const SERVER_TOOLS = /^(remote_|slurm_jobs)/
const CODE_KINDS: ReadonlySet<BuildingKind> = new Set(['code', 'web', 'config'])

/** The place a tool's work happens in: books and papers in the library, code on the site, servers in their room. */
export function placeOfTool(tool: string, path?: string): Exclude<PlaceId, 'campus'> {
  if (PAPER_TOOLS.test(tool)) return 'library'
  if (SERVER_TOOLS.test(tool)) return 'servers'
  if (tool === 'phone_task') return 'desk'
  if (SITE_TOOLS.test(tool)) return 'site'
  // Writing or reading a file is building work when the file is code; documents are desk work.
  if ((tool === 'write_file' || tool === 'read_file') && path && CODE_KINDS.has(buildingKind(path))) return 'site'
  return 'studio'
}

/**
 * Where the conversation's agent works now: the place of the newest tool of its turn, running or
 * just done (most tools take a moment; between two steps of the same work it stays there), else
 * its studio.
 */
export function agentPlace(state: WorkbenchState): Exclude<PlaceId, 'campus'> {
  if (!turnRunning(state, text(state.selectedSession?.id) ?? null)) return 'studio'
  const tool = [...toolCalls(state).values()].at(-1)
  return tool ? placeOfTool(toolName(tool), text(record(tool.arguments)?.path)) : 'studio'
}

/** Someone from any conversation's team working in a place: an expert whose tool belongs there. */
export interface PlaceVisitor {
  /** The expert's run. */
  runId: string
  expert: string | null
  title: string
  tool: string
}

const ACTIVE_RUNS = new Set(['running', 'starting'])

export function visitorsOf(state: WorkbenchState, place: Exclude<PlaceId, 'campus' | 'studio'>): PlaceVisitor[] {
  return Object.values(state.subagents ?? {}).flatMap((run): PlaceVisitor[] => {
    if (!ACTIVE_RUNS.has(run.state) || run.activity !== 'tool' || !run.tool) return []
    return placeOfTool(run.tool) === place ? [{ runId: run.runId, expert: run.expert ?? null, title: run.title, tool: run.tool }] : []
  })
}
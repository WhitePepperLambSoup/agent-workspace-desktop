import type { JsonValue } from '../../../shared/protocol'
import type { MessageKey } from '../i18n/messages'

export type RuleKind = 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'once' | 'cron'
export type ScheduleAutonomy = 'ask' | 'workspace' | 'yolo' | 'full_access'
export type RunState = 'starting' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted' | 'missed'

export interface ScheduleRule {
  kind: RuleKind
  time?: string
  days?: number[]
  day?: number
  at?: string
  cron?: string
}

export interface ScheduleRunView {
  runId: string
  scheduleId: string
  title: string
  dueAt: string
  state: RunState
  manual: boolean
  read: boolean
  sessionId?: string
  result?: string
  error?: string
  updatedAt: string
}

export interface ScheduleView {
  id: string
  title: string
  prompt: string
  workspace: string
  rule: ScheduleRule
  enabled: boolean
  notifyPhone: boolean
  autonomy: ScheduleAutonomy
  nextRun: string | null
  lastRun: ScheduleRunView | null
}

type Translate = (key: MessageKey, values?: Record<string, string | number>) => string

const RUN_STATES: readonly RunState[] = ['starting', 'running', 'succeeded', 'failed', 'cancelled', 'interrupted', 'missed']
const KINDS: readonly RuleKind[] = ['daily', 'weekdays', 'weekly', 'monthly', 'once', 'cron']
const AUTONOMY: readonly ScheduleAutonomy[] = ['ask', 'workspace', 'yolo', 'full_access']

function record(value: JsonValue | undefined): Record<string, JsonValue> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null
}

function text(value: JsonValue | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined
}

export function parseRun(value: JsonValue | undefined): ScheduleRunView | null {
  const item = record(value)
  const runId = text(item?.runId)
  const state = text(item?.state) as RunState | undefined
  if (!item || !runId || !state || !RUN_STATES.includes(state)) return null
  return {
    runId,
    scheduleId: text(item.scheduleId) ?? '',
    title: text(item.title) ?? '',
    dueAt: text(item.dueAt) ?? '',
    state,
    manual: item.manual === true,
    read: item.read === true,
    sessionId: text(item.sessionId),
    result: text(item.result),
    error: text(item.error),
    updatedAt: text(item.updatedAt) ?? '',
  }
}

export function parseRule(value: JsonValue | undefined): ScheduleRule | null {
  const item = record(value)
  const kind = text(item?.kind) as RuleKind | undefined
  if (!item || !kind || !KINDS.includes(kind)) return null
  return {
    kind,
    time: text(item.time),
    days: Array.isArray(item.days) ? item.days.filter((day): day is number => typeof day === 'number') : undefined,
    day: typeof item.day === 'number' ? item.day : undefined,
    at: text(item.at),
    cron: text(item.cron),
  }
}

export function parseSchedule(value: JsonValue | undefined): ScheduleView | null {
  const item = record(value)
  const id = text(item?.id)
  const rule = parseRule(item?.rule)
  if (!item || !id || !rule) return null
  const autonomy = text(item.autonomy) as ScheduleAutonomy | undefined
  return {
    id,
    title: text(item.title) ?? '',
    prompt: text(item.prompt) ?? '',
    workspace: text(item.workspace) ?? '',
    rule,
    enabled: item.enabled !== false,
    notifyPhone: item.notifyPhone === true,
    autonomy: autonomy && AUTONOMY.includes(autonomy) ? autonomy : 'workspace',
    nextRun: text(item.nextRun) ?? null,
    lastRun: parseRun(item.lastRun),
  }
}

export function parseSchedules(payload: Record<string, JsonValue>): { schedules: ScheduleView[]; unread: number } {
  const schedules = Array.isArray(payload.schedules) ? payload.schedules.flatMap((item) => parseSchedule(item) ?? []) : []
  return { schedules, unread: typeof payload.unread === 'number' ? payload.unread : 0 }
}

export function parseRuns(payload: Record<string, JsonValue>): ScheduleRunView[] {
  return Array.isArray(payload.runs) ? payload.runs.flatMap((item) => parseRun(item) ?? []) : []
}

/** ISO weekdays, Monday first. */
export const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const
const WEEKDAY_KEYS: Record<number, MessageKey> = {
  1: 'schedules.weekday.1', 2: 'schedules.weekday.2', 3: 'schedules.weekday.3', 4: 'schedules.weekday.4',
  5: 'schedules.weekday.5', 6: 'schedules.weekday.6', 7: 'schedules.weekday.7',
}

export function weekdayLabel(day: number, t: Translate): string {
  return t(WEEKDAY_KEYS[day] ?? 'schedules.weekday.1')
}

export function formatMoment(value: string | null | undefined, locale: string): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString(locale, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', weekday: 'short' })
}

/** "Every day at 08:30" and the like, in the interface language. */
export function describeRule(rule: ScheduleRule, t: Translate, locale: string): string {
  const time = rule.time ?? ''
  if (rule.kind === 'daily') return t('schedules.rule.daily', { time })
  if (rule.kind === 'weekdays') return t('schedules.rule.weekdays', { time })
  if (rule.kind === 'weekly') {
    const separator = locale.startsWith('zh') || locale.startsWith('ja') ? '、' : ', '
    return t('schedules.rule.weekly', { days: (rule.days ?? []).map((day) => weekdayLabel(day, t)).join(separator), time })
  }
  if (rule.kind === 'monthly') return t('schedules.rule.monthly', { day: rule.day ?? 1, time })
  if (rule.kind === 'once') return t('schedules.rule.once', { at: formatMoment(rule.at, locale) })
  return t('schedules.rule.cron', { cron: rule.cron ?? '' })
}

export const RUN_STATE_KEYS: Record<RunState, MessageKey> = {
  starting: 'schedules.state.starting',
  running: 'schedules.state.running',
  succeeded: 'schedules.state.succeeded',
  failed: 'schedules.state.failed',
  cancelled: 'schedules.state.cancelled',
  interrupted: 'schedules.state.interrupted',
  missed: 'schedules.state.missed',
}

export const ERROR_KEYS: Record<string, MessageKey> = {
  invalid_title: 'schedules.error.title',
  invalid_prompt: 'schedules.error.prompt',
  invalid_workspace: 'schedules.error.workspace',
  folder_missing: 'schedules.error.workspace',
  invalid_time: 'schedules.error.time',
  invalid_days: 'schedules.error.days',
  invalid_day: 'schedules.error.day',
  invalid_at: 'schedules.error.at',
  invalid_cron: 'schedules.error.cron',
  too_many_schedules: 'schedules.error.tooMany',
  schedule_not_found: 'schedules.error.notFound',
  desktop_not_ready: 'schedules.error.notReady',
  runtime_unavailable: 'schedules.error.notReady',
  runtime_start_failed: 'schedules.error.startFailed',
  runtime_busy: 'schedules.error.busy',
  storage_unavailable: 'schedules.error.storage',
}

export interface ScheduleDraft {
  id?: string
  title: string
  prompt: string
  workspace: string
  kind: RuleKind
  time: string
  days: number[]
  day: number
  at: string
  cron: string
  autonomy: ScheduleAutonomy
  notifyPhone: boolean
  enabled: boolean
}

function localDateTimeInput(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function emptyDraft(workspace: string, now = new Date()): ScheduleDraft {
  const soon = new Date(now.getTime() + 60 * 60 * 1000)
  return {
    title: '', prompt: '', workspace, kind: 'daily', time: '08:30', days: [1], day: 1,
    at: localDateTimeInput(soon), cron: '0 9 * * 1-5', autonomy: 'workspace', notifyPhone: false, enabled: true,
  }
}

export function draftFrom(schedule: ScheduleView, now = new Date()): ScheduleDraft {
  const base = emptyDraft(schedule.workspace, now)
  const at = schedule.rule.at ? new Date(schedule.rule.at) : null
  return {
    ...base,
    id: schedule.id,
    title: schedule.title,
    prompt: schedule.prompt,
    kind: schedule.rule.kind,
    time: schedule.rule.time ?? base.time,
    days: schedule.rule.days?.length ? schedule.rule.days : base.days,
    day: schedule.rule.day ?? base.day,
    at: at && !Number.isNaN(at.getTime()) ? localDateTimeInput(at) : base.at,
    cron: schedule.rule.cron ?? base.cron,
    autonomy: schedule.autonomy,
    notifyPhone: schedule.notifyPhone,
    enabled: schedule.enabled,
  }
}

export function draftRule(draft: ScheduleDraft): Record<string, JsonValue> {
  if (draft.kind === 'daily' || draft.kind === 'weekdays') return { kind: draft.kind, time: draft.time }
  if (draft.kind === 'weekly') return { kind: 'weekly', time: draft.time, days: [...draft.days].sort() }
  if (draft.kind === 'monthly') return { kind: 'monthly', time: draft.time, day: draft.day }
  if (draft.kind === 'once') return { kind: 'once', at: new Date(draft.at).toISOString() }
  return { kind: 'cron', cron: draft.cron.trim() }
}

export function draftPayload(draft: ScheduleDraft): Record<string, JsonValue> {
  const payload: Record<string, JsonValue> = {
    title: draft.title.trim(),
    prompt: draft.prompt.trim(),
    workspace: draft.workspace,
    rule: draftRule(draft),
    autonomy: draft.autonomy,
    notifyPhone: draft.notifyPhone,
    enabled: draft.enabled,
  }
  if (draft.id) payload.id = draft.id
  return payload
}

/** The first problem with a draft, before it goes to the gateway. */
export function draftProblem(draft: ScheduleDraft, now = new Date()): MessageKey | null {
  if (!draft.title.trim()) return 'schedules.error.title'
  if (!draft.prompt.trim()) return 'schedules.error.prompt'
  if (!draft.workspace) return 'schedules.error.workspace'
  if (draft.kind !== 'once' && draft.kind !== 'cron' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.time)) return 'schedules.error.time'
  if (draft.kind === 'weekly' && draft.days.length === 0) return 'schedules.error.days'
  if (draft.kind === 'once') {
    const at = new Date(draft.at)
    if (Number.isNaN(at.getTime())) return 'schedules.error.at'
    if (at.getTime() <= now.getTime()) return 'schedules.error.past'
  }
  if (draft.kind === 'cron' && draft.cron.trim().split(/\s+/).length !== 5) return 'schedules.error.cron'
  return null
}

export interface ScheduleTemplate {
  id: string
  title: MessageKey
  prompt: MessageKey
  rule: Pick<ScheduleDraft, 'kind' | 'time' | 'days'>
}

/** Starting points that show what scheduled tasks are good for; each fills the editor. */
export const TEMPLATES: readonly ScheduleTemplate[] = [
  { id: 'news', title: 'schedules.template.news.title', prompt: 'schedules.template.news.prompt', rule: { kind: 'daily', time: '08:00', days: [1] } },
  { id: 'tidy', title: 'schedules.template.tidy.title', prompt: 'schedules.template.tidy.prompt', rule: { kind: 'weekly', time: '18:00', days: [5] } },
  { id: 'report', title: 'schedules.template.report.title', prompt: 'schedules.template.report.prompt', rule: { kind: 'weekly', time: '17:00', days: [5] } },
  { id: 'papers', title: 'schedules.template.papers.title', prompt: 'schedules.template.papers.prompt', rule: { kind: 'weekly', time: '09:00', days: [1] } },
  { id: 'watch', title: 'schedules.template.watch.title', prompt: 'schedules.template.watch.prompt', rule: { kind: 'daily', time: '09:00', days: [1] } },
  { id: 'tests', title: 'schedules.template.tests.title', prompt: 'schedules.template.tests.prompt', rule: { kind: 'weekdays', time: '09:00', days: [1] } },
]

export function folderName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
}

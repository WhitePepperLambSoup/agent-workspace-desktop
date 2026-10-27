import { CalendarClock, FolderOpen, MessageSquare, Pencil, Play, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'

import type { WorkbenchBridgeClient } from '../bridge/client'
import { useOptionalI18n } from '../i18n/I18nProvider'
import type { MessageKey } from '../i18n/messages'
import type { WorkbenchState } from '../state/workbench-store'
import {
  describeRule,
  draftFrom,
  draftPayload,
  draftProblem,
  emptyDraft,
  ERROR_KEYS,
  folderName,
  formatMoment,
  parseRuns,
  parseSchedule,
  parseSchedules,
  RUN_STATE_KEYS,
  TEMPLATES,
  WEEKDAYS,
  weekdayLabel,
  type ScheduleDraft,
  type ScheduleRunView,
  type ScheduleTemplate,
  type ScheduleView,
} from './model'
import './schedules.css'

export type SchedulesClient = Pick<
  WorkbenchBridgeClient,
  'listSchedules' | 'saveSchedule' | 'deleteSchedule' | 'runSchedule' | 'listScheduleRuns' | 'markScheduleRunsRead'
>

interface SchedulesRouteProps {
  state: WorkbenchState
  client?: SchedulesClient
  onOpenSession?: (workspace: string, sessionId: string) => void
}

function errorCode(error: unknown): string {
  return error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : ''
}

const RESULT_PREVIEW_CHARS = 280

export function SchedulesRoute({ state, client, onOpenSession }: SchedulesRouteProps) {
  const { t, locale } = useOptionalI18n()
  const [schedules, setSchedules] = useState<ScheduleView[] | null>(null)
  const [runs, setRuns] = useState<ScheduleRunView[]>([])
  const [unread, setUnread] = useState(0)
  const [draft, setDraft] = useState<ScheduleDraft | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [extraFolders, setExtraFolders] = useState<string[]>([])
  const generation = useRef(0)
  const currentFolder = typeof state.workspace?.path === 'string' ? state.workspace.path : ''

  const reason = useCallback((error: unknown): string => {
    const code = errorCode(error)
    return t(ERROR_KEYS[code] ?? 'schedules.error.generic')
  }, [t])

  const load = useCallback(async () => {
    if (!client) return
    const current = ++generation.current
    try {
      const [listed, history] = await Promise.all([client.listSchedules(), client.listScheduleRuns({ limit: 30 })])
      if (current !== generation.current) return
      const parsed = parseSchedules(listed.payload)
      setSchedules(parsed.schedules)
      setUnread(parsed.unread)
      setRuns(parseRuns(history.payload))
    } catch (error) {
      if (current === generation.current) setNotice({ tone: 'error', text: reason(error) })
    }
  }, [client, reason])

  useEffect(() => { void load() }, [load])

  // Runs in progress are followed closely; otherwise the page checks now and then.
  const active = runs.some((run) => run.state === 'starting' || run.state === 'running')
  useEffect(() => {
    if (!client) return undefined
    const timer = window.setInterval(() => void load(), active ? 4000 : 30000)
    return () => window.clearInterval(timer)
  }, [active, client, load])

  const folders = useMemo(() => {
    const seen = new Set<string>()
    const list: string[] = []
    for (const path of [currentFolder, ...(state.recentWorkspaces ?? []).map((item) => item.path), ...extraFolders, draft?.workspace ?? '']) {
      const key = path.replace(/\\/g, '/').toLocaleLowerCase()
      if (!path || seen.has(key)) continue
      seen.add(key)
      list.push(path)
    }
    return list
  }, [currentFolder, draft?.workspace, extraFolders, state.recentWorkspaces])

  // An editor opened before the folders were known takes the first one once they are.
  useEffect(() => {
    if (draft && !draft.workspace && folders[0]) setDraft({ ...draft, workspace: folders[0] })
  }, [draft, folders])

  const act = async (action: () => Promise<unknown>, success?: MessageKey): Promise<boolean> => {
    if (!client) return false
    setBusy(true)
    setNotice(null)
    try {
      await action()
      if (success) setNotice({ tone: 'ok', text: t(success) })
      await load()
      return true
    } catch (error) {
      setNotice({ tone: 'error', text: reason(error) })
      return false
    } finally {
      setBusy(false)
    }
  }

  const startFrom = (template?: ScheduleTemplate): void => {
    const base = emptyDraft(currentFolder || folders[0] || '')
    setNotice(null)
    setDraft(template ? { ...base, title: t(template.title), prompt: t(template.prompt), ...template.rule } : base)
  }

  const save = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (!draft || !client) return
    const problem = draftProblem(draft)
    if (problem) {
      setNotice({ tone: 'error', text: t(problem) })
      return
    }
    const saved = await act(async () => {
      const reply = await client.saveSchedule(draftPayload(draft))
      if (!parseSchedule(reply.payload.schedule)) throw new Error('schedule_missing')
    }, draft.id ? 'schedules.saved' : 'schedules.created')
    if (saved) setDraft(null)
  }

  const pickFolder = async (): Promise<void> => {
    const picked = await window.agentWorkspace?.selectWorkspace?.()
    if (!picked || !draft) return
    setExtraFolders((current) => current.includes(picked) ? current : [...current, picked])
    setDraft({ ...draft, workspace: picked })
  }

  const openRun = (run: ScheduleRunView): void => {
    const schedule = schedules?.find((item) => item.id === run.scheduleId)
    if (!run.sessionId || !schedule) return
    if (!run.read) void client?.markScheduleRunsRead([run.runId]).then(() => load()).catch(() => undefined)
    onOpenSession?.(schedule.workspace, run.sessionId)
  }

  const kindLabels: Record<ScheduleDraft['kind'], MessageKey> = {
    daily: 'schedules.kind.daily', weekdays: 'schedules.kind.weekdays', weekly: 'schedules.kind.weekly',
    monthly: 'schedules.kind.monthly', once: 'schedules.kind.once', cron: 'schedules.kind.cron',
  }

  const editor = draft ? <form className="route-section schedules-editor" onSubmit={(event) => void save(event)} aria-labelledby="schedule-editor-title">
    <header><div><h2 id="schedule-editor-title">{t(draft.id ? 'schedules.editTitle' : 'schedules.newTitle')}</h2></div></header>
    <label className="schedules-field"><span>{t('schedules.field.title')}</span>
      <input value={draft.title} maxLength={120} autoFocus onChange={(event) => setDraft({ ...draft, title: event.currentTarget.value })} placeholder={t('schedules.field.titlePlaceholder')} /></label>
    <label className="schedules-field"><span>{t('schedules.field.prompt')}</span>
      <textarea value={draft.prompt} rows={5} maxLength={16000} onChange={(event) => setDraft({ ...draft, prompt: event.currentTarget.value })} placeholder={t('schedules.field.promptPlaceholder')} /></label>
    <div className="schedules-field"><span id="schedule-folder-label">{t('schedules.field.folder')}</span>
      <div className="schedules-folder-row">
        <select aria-labelledby="schedule-folder-label" value={draft.workspace} onChange={(event) => setDraft({ ...draft, workspace: event.currentTarget.value })}>
          {folders.length === 0 || !draft.workspace ? <option value="">{t('schedules.field.noFolder')}</option> : null}
          {folders.map((path) => <option key={path} value={path} title={path}>{folderName(path)}</option>)}
        </select>
        {window.agentWorkspace ? <button type="button" className="secondary-button" onClick={() => void pickFolder()}><FolderOpen size={14} />{t('schedules.field.chooseFolder')}</button> : null}
      </div>
      <small>{t('schedules.field.folderHelp')}</small>
    </div>
    <div className="schedules-field"><span id="schedule-when-label">{t('schedules.field.when')}</span>
      <div className="schedules-when" role="group" aria-labelledby="schedule-when-label">
        <select aria-label={t('schedules.field.repeat')} value={draft.kind} onChange={(event) => setDraft({ ...draft, kind: event.currentTarget.value as ScheduleDraft['kind'] })}>
          {(Object.keys(kindLabels) as ScheduleDraft['kind'][]).map((kind) => <option key={kind} value={kind}>{t(kindLabels[kind])}</option>)}
        </select>
        {draft.kind === 'monthly' ? <label className="schedules-inline"><span>{t('schedules.field.dayOfMonth')}</span>
          <input type="number" min={1} max={28} value={draft.day} onChange={(event) => setDraft({ ...draft, day: Math.min(28, Math.max(1, Number(event.currentTarget.value) || 1)) })} /></label> : null}
        {draft.kind === 'once' ? <input type="datetime-local" aria-label={t('schedules.field.at')} value={draft.at} onChange={(event) => setDraft({ ...draft, at: event.currentTarget.value })} />
          : draft.kind === 'cron' ? <input aria-label={t('schedules.field.cron')} value={draft.cron} spellCheck={false} onChange={(event) => setDraft({ ...draft, cron: event.currentTarget.value })} />
            : <input type="time" aria-label={t('schedules.field.time')} value={draft.time} onChange={(event) => setDraft({ ...draft, time: event.currentTarget.value })} />}
      </div>
      {draft.kind === 'weekly' ? <div className="schedules-days" role="group" aria-label={t('schedules.field.days')}>
        {WEEKDAYS.map((day) => <button key={day} type="button" aria-pressed={draft.days.includes(day)}
          onClick={() => setDraft({ ...draft, days: draft.days.includes(day) ? draft.days.filter((item) => item !== day) : [...draft.days, day] })}>{weekdayLabel(day, t)}</button>)}
      </div> : null}
      {draft.kind === 'cron' ? <small>{t('schedules.field.cronHelp')}</small> : null}
    </div>
    <fieldset className="schedules-field schedules-permission"><legend>{t('schedules.field.permission')}</legend>
      {(['workspace', 'ask', 'yolo'] as const).map((value) => <label key={value} className="schedules-radio">
        <input type="radio" name="schedule-autonomy" checked={draft.autonomy === value} onChange={() => setDraft({ ...draft, autonomy: value })} />
        <span><strong>{t(`schedules.permission.${value}` as MessageKey)}</strong><small>{t(`schedules.permission.${value}Help` as MessageKey)}</small></span>
      </label>)}
    </fieldset>
    <label className="schedules-check"><input type="checkbox" checked={draft.notifyPhone} onChange={(event) => setDraft({ ...draft, notifyPhone: event.currentTarget.checked })} />
      <span>{t('schedules.field.notifyPhone')}<small>{t('schedules.field.notifyPhoneHelp')}</small></span></label>
    <div className="schedules-editor-actions">
      <button type="submit" className="primary-button" disabled={busy}>{t('schedules.save')}</button>
      <button type="button" className="secondary-button" disabled={busy} onClick={() => { setDraft(null); setNotice(null) }}>{t('schedules.cancel')}</button>
    </div>
  </form> : null

  const unreadRuns = runs.filter((run) => !run.read && run.state !== 'starting' && run.state !== 'running')

  return <main className="route-column reading-surface schedules-route" aria-label={t('workbench.schedules')}>
    <header className="route-header">
      <div><p className="section-kicker">{t('schedules.kicker')}</p><h1 tabIndex={-1}>{t('workbench.schedules')}</h1></div>
      <div className="schedules-header-actions">
        <button type="button" className="icon-button" aria-label={t('schedules.refresh')} title={t('schedules.refresh')} disabled={!client} onClick={() => void load()}><RefreshCw size={15} /></button>
        <button type="button" className="primary-button" disabled={!client || busy} onClick={() => startFrom()}><Plus size={14} />{t('schedules.new')}</button>
      </div>
    </header>
    <div className="route-content schedules-content">
      <p className="route-note">{t('schedules.lede')}</p>
      <div className="schedules-feedback" aria-live="polite">
        {notice ? <p role="status" className={notice.tone === 'error' ? 'route-error' : 'route-note schedules-ok'}>{notice.text}</p> : null}
      </div>
      {editor}

      <section className="route-section" aria-labelledby="schedules-list-title">
        <header><div><h2 id="schedules-list-title">{t('schedules.listTitle')}</h2></div></header>
        {schedules === null ? <p className="route-note">{t('schedules.loading')}</p> : null}
        {schedules?.length === 0 ? <p className="route-note schedules-empty"><CalendarClock size={15} aria-hidden="true" />{t('schedules.empty')}</p> : null}
        <ul className="schedules-list">
          {schedules?.map((schedule) => <li key={schedule.id} className="schedules-card" data-enabled={schedule.enabled ? 'true' : 'false'}>
            <div className="schedules-card-main">
              <strong>{schedule.title}</strong>
              <small>{describeRule(schedule.rule, t, locale)} · <span title={schedule.workspace}>{folderName(schedule.workspace)}</span></small>
              <small>{schedule.enabled
                ? schedule.nextRun ? t('schedules.next', { at: formatMoment(schedule.nextRun, locale) }) : t('schedules.noNext')
                : t('schedules.paused')}
              {schedule.lastRun ? ` · ${t('schedules.last', { state: t(RUN_STATE_KEYS[schedule.lastRun.state]), at: formatMoment(schedule.lastRun.dueAt, locale) })}` : ''}</small>
            </div>
            <label className="toggle-control" title={t(schedule.enabled ? 'schedules.pause' : 'schedules.resume')}>
              <input type="checkbox" aria-label={t('schedules.enabledLabel', { title: schedule.title })} checked={schedule.enabled} disabled={busy}
                onChange={(event) => { const enabled = event.currentTarget.checked; void act(() => client!.saveSchedule({ id: schedule.id, enabled })) }} />
              <span />
            </label>
            <div className="schedules-card-actions">
              <button type="button" className="secondary-button" disabled={busy} onClick={() => void act(() => client!.runSchedule(schedule.id), 'schedules.started')}><Play size={13} />{t('schedules.runNow')}</button>
              <button type="button" className="icon-button" aria-label={t('schedules.edit', { title: schedule.title })} title={t('schedules.edit', { title: schedule.title })} disabled={busy} onClick={() => { setNotice(null); setDraft(draftFrom(schedule)) }}><Pencil size={14} /></button>
              <button type="button" className="icon-button" aria-label={t('schedules.delete', { title: schedule.title })} title={t('schedules.delete', { title: schedule.title })} disabled={busy}
                onClick={() => { if (window.confirm(t('schedules.confirmDelete', { title: schedule.title }))) void act(() => client!.deleteSchedule(schedule.id), 'schedules.deleted') }}><Trash2 size={14} /></button>
            </div>
          </li>)}
        </ul>
      </section>

      {!draft ? <section className="route-section" aria-labelledby="schedules-templates-title">
        <header><div><h2 id="schedules-templates-title">{t('schedules.templatesTitle')}</h2><span>{t('schedules.templatesHelp')}</span></div></header>
        <div className="schedules-templates">
          {TEMPLATES.map((template) => <button key={template.id} type="button" className="schedules-template" disabled={!client} onClick={() => startFrom(template)}>
            <strong>{t(template.title)}</strong><small>{t(template.prompt)}</small>
          </button>)}
        </div>
      </section> : null}

      <section className="route-section" aria-labelledby="schedules-runs-title">
        <header>
          <div><h2 id="schedules-runs-title">{t('schedules.runsTitle')}</h2><span>{unread ? t('schedules.unread', { count: unread }) : t('schedules.runsHelp')}</span></div>
          {unreadRuns.length ? <button type="button" className="secondary-button" disabled={busy} onClick={() => void act(() => client!.markScheduleRunsRead())}>{t('schedules.markAllRead')}</button> : null}
        </header>
        {runs.length === 0 ? <p className="route-note">{t('schedules.noRuns')}</p> : null}
        <ul className="schedules-runs">
          {runs.map((run) => <li key={run.runId} className="schedules-run" data-state={run.state} data-unread={!run.read && run.state !== 'starting' && run.state !== 'running' ? 'true' : undefined}>
            <div className="schedules-run-main">
              <strong>{run.title}</strong>
              <small><span className="schedules-state" data-state={run.state}>{t(RUN_STATE_KEYS[run.state])}</span> · {formatMoment(run.dueAt, locale)}{run.manual ? ` · ${t('schedules.manual')}` : ''}</small>
              {run.result ? <p>{run.result.length > RESULT_PREVIEW_CHARS ? `${run.result.slice(0, RESULT_PREVIEW_CHARS)}…` : run.result}</p> : null}
              {run.error ? <p className="schedules-run-error">{t(ERROR_KEYS[run.error] ?? 'schedules.error.runFailed', { detail: run.error })}</p> : null}
            </div>
            {run.sessionId && onOpenSession ? <button type="button" className="secondary-button" onClick={() => openRun(run)}><MessageSquare size={13} />{t('schedules.openConversation')}</button> : null}
          </li>)}
        </ul>
      </section>
    </div>
  </main>
}

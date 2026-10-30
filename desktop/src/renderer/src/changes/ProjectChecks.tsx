import { CheckCircle2, ChevronDown, ChevronRight, Loader2, Play, Plus, ShieldAlert, Trash2, XCircle } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import type { JsonValue } from '../../../shared/protocol'
import type { WorkbenchBridgeClient } from '../bridge/client'
import { useOptionalI18n } from '../i18n/I18nProvider'
import { checkResultsFrom, workspacePathKey, type CheckResultView, type WorkbenchState } from '../state/workbench-store'

export type ProjectClient = Pick<WorkbenchBridgeClient, 'projectSettings' | 'saveProjectSettings' | 'trustProjectSettings' | 'runProjectChecks'>

interface CheckDraft { name: string; command: string; timeout: number }
interface FormatterDraft { files: string; command: string }
interface ProjectDraft {
  checks: CheckDraft[]
  afterTurn: boolean
  maxFixRounds: number
  protected: string
  formatters: FormatterDraft[]
  secretScan: boolean
}
interface ProjectDocument {
  path: string
  exists: boolean
  trusted: boolean
  error: string | null
  draft: ProjectDraft
  suggested: { name: string; command: string; source: string }[]
  results: CheckResultView[]
  finishedAt: number | null
  running: boolean
}

const NOTICES = {
  saved: 'checks.notice.saved',
  saveFailed: 'checks.notice.saveFailed',
  runFailed: 'checks.notice.runFailed',
  loadFailed: 'checks.loadFailed',
} as const

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function documentFrom(payload: Record<string, unknown>): ProjectDocument | null {
  const config = payload.config && typeof payload.config === 'object' ? payload.config as Record<string, unknown> : null
  if (!config) return null
  const rules = config.rules && typeof config.rules === 'object' ? config.rules as Record<string, unknown> : {}
  const list = (value: unknown): Record<string, unknown>[] =>
    Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object') : []
  return {
    path: text(payload.path) || '.agent/project.json',
    exists: payload.exists === true,
    trusted: payload.trusted !== false,
    error: typeof payload.error === 'string' ? payload.error : null,
    draft: {
      checks: list(config.checks).map((item) => ({ name: text(item.name), command: text(item.command), timeout: typeof item.timeout === 'number' ? item.timeout : 600 })),
      afterTurn: config.afterTurn === true,
      maxFixRounds: typeof config.maxFixRounds === 'number' ? config.maxFixRounds : 2,
      protected: (Array.isArray(rules.protected) ? rules.protected : []).filter((item) => typeof item === 'string').join('\n'),
      formatters: list(rules.format).map((item) => ({ files: text(item.files), command: text(item.command) })),
      secretScan: rules.secretScan !== false,
    },
    suggested: list(payload.suggested).map((item) => ({ name: text(item.name), command: text(item.command), source: text(item.source) })),
    results: checkResultsFrom(payload.results as JsonValue | undefined),
    finishedAt: typeof payload.finishedAt === 'number' ? payload.finishedAt * 1000 : null,
    running: payload.running === true,
  }
}

function configFrom(draft: ProjectDraft): { [key: string]: JsonValue } {
  return {
    checks: draft.checks.filter((check) => check.name.trim() && check.command.trim())
      .map((check) => ({ name: check.name.trim(), command: check.command.trim(), timeout: check.timeout })),
    afterTurn: draft.afterTurn,
    maxFixRounds: draft.maxFixRounds,
    rules: {
      protected: draft.protected.split('\n').map((line) => line.trim()).filter(Boolean),
      format: draft.formatters.filter((item) => item.files.trim() && item.command.trim())
        .map((item) => ({ files: item.files.trim(), command: item.command.trim() })),
      secretScan: draft.secretScan,
    },
  }
}

export function ProjectChecks({ state, client }: { state: WorkbenchState; client: ProjectClient }) {
  const { t } = useOptionalI18n()
  const [document, setDocument] = useState<ProjectDocument | null>(null)
  const [draft, setDraft] = useState<ProjectDraft | null>(null)
  const [notice, setNotice] = useState<'saved' | 'saveFailed' | 'runFailed' | 'loadFailed' | null>(null)
  const [busy, setBusy] = useState<'save' | 'run' | 'trust' | null>(null)
  const [open, setOpen] = useState<Set<string>>(new Set())
  const workspace = typeof state.workspace?.path === 'string' ? state.workspace.path : null

  const accept = useCallback((payload: Record<string, unknown>): void => {
    const next = documentFrom(payload)
    if (!next) {
      setNotice('loadFailed')
      return
    }
    setDocument(next)
    setDraft(next.draft)
  }, [])

  useEffect(() => {
    let active = true
    client.projectSettings()
      .then((response) => { if (active && response.type === 'project.get.result') accept(response.payload) })
      .catch(() => { if (active) setNotice('loadFailed') })
    return () => { active = false }
  }, [client, workspace, accept])

  // Results that arrived while the page is open (after a turn, or from the agent's run_checks).
  const live = state.checks && workspace && workspacePathKey(state.checks.workspace) === workspacePathKey(workspace) ? state.checks : null
  const results = live && (live.running || live.finishedAt) ? live.results : document?.results ?? []
  const running = live?.running ?? document?.running ?? false
  const changed = useMemo(() => Boolean(document && draft && JSON.stringify(configFrom(draft)) !== JSON.stringify(configFrom(document.draft))), [document, draft])

  const save = (): void => {
    if (!draft) return
    setBusy('save')
    setNotice(null)
    client.saveProjectSettings(configFrom(draft))
      .then((response) => {
        if (response.type !== 'project.set.result') throw new Error('unexpected')
        accept(response.payload)
        setNotice('saved')
      })
      .catch(() => setNotice('saveFailed'))
      .finally(() => setBusy(null))
  }

  const run = (): void => {
    setBusy('run')
    setNotice(null)
    client.runProjectChecks()
      .then((response) => { if (response.type === 'project.checks.run.result') accept(response.payload) })
      .catch(() => setNotice('runFailed'))
      .finally(() => setBusy(null))
  }

  const trust = (): void => {
    setBusy('trust')
    client.trustProjectSettings()
      .then((response) => { if (response.type === 'project.trust.result') accept(response.payload) })
      .catch(() => setNotice('saveFailed'))
      .finally(() => setBusy(null))
  }

  if (!document || !draft) {
    return (
      <section className="route-section project-checks">
        {notice === 'loadFailed' ? <p className="route-error" role="status">{t('checks.loadFailed')}</p> : <p className="route-empty">{t('checks.loading')}</p>}
      </section>
    )
  }

  const update = (change: Partial<ProjectDraft>): void => setDraft({ ...draft, ...change })
  const setCheck = (index: number, change: Partial<CheckDraft>): void =>
    update({ checks: draft.checks.map((check, at) => at === index ? { ...check, ...change } : check) })
  const setFormatter = (index: number, change: Partial<FormatterDraft>): void =>
    update({ formatters: draft.formatters.map((item, at) => at === index ? { ...item, ...change } : item) })
  const unused = document.suggested.filter((item) => !draft.checks.some((check) => check.command === item.command || check.name === item.name))
  const hasChecks = document.draft.checks.length > 0

  return (
    <div className="route-content project-checks">
      <section className="route-section">
        <header>
          <div>
            <h2>{t('checks.title')}</h2>
            <span>{t('checks.description', { path: document.path })}</span>
          </div>
          <button type="button" className="provider-primary" disabled={!hasChecks || !document.trusted || running || busy !== null || changed} onClick={run}>
            {running || busy === 'run' ? <Loader2 size={13} className="spin-animation" aria-hidden="true" /> : <Play size={13} aria-hidden="true" />}
            {running || busy === 'run' ? t('checks.running') : t('checks.run')}
          </button>
        </header>
        {document.error ? <p className="route-error" role="status">{t('checks.fileBroken', { error: document.error })}</p> : null}
        {!document.trusted ? (
          <div className="checks-trust" role="status">
            <ShieldAlert size={15} aria-hidden="true" />
            <div>
              <p>{t('checks.untrusted', { path: document.path })}</p>
              <ul>
                {document.draft.checks.map((check) => <li key={`c-${check.name}`}><code>{check.command}</code></li>)}
                {document.draft.formatters.map((item) => <li key={`f-${item.files}`}><code>{item.command}</code></li>)}
              </ul>
              <button type="button" className="provider-secondary" disabled={busy !== null} onClick={trust}>{t('checks.trust')}</button>
            </div>
          </div>
        ) : null}
        {results.length ? (
          <ul className="checks-results" aria-label={t('checks.results')}>
            {results.map((result) => {
              const expanded = open.has(result.name)
              const outcome = result.ok ? t('checks.passed') : result.timedOut ? t('checks.timedOut') : t('checks.failed', { code: String(result.exitCode ?? '?') })
              return (
                <li key={result.name} data-ok={result.ok ? 'true' : 'false'}>
                  <button type="button" className="checks-result-row" aria-expanded={expanded} aria-label={`${result.name}: ${outcome}`}
                    onClick={() => setOpen((current) => {
                      const next = new Set(current)
                      if (next.has(result.name)) next.delete(result.name)
                      else next.add(result.name)
                      return next
                    })}>
                    {expanded ? <ChevronDown size={13} aria-hidden="true" /> : <ChevronRight size={13} aria-hidden="true" />}
                    {result.ok ? <CheckCircle2 size={14} className="checks-ok" aria-hidden="true" /> : <XCircle size={14} className="checks-failed" aria-hidden="true" />}
                    <strong>{result.name}</strong>
                    <span>{outcome}</span>
                    <span className="checks-seconds">{t('checks.seconds', { seconds: result.seconds.toFixed(1) })}</span>
                  </button>
                  {expanded ? <pre className="checks-output">{result.output || t('checks.noOutput')}</pre> : null}
                </li>
              )
            })}
          </ul>
        ) : hasChecks ? <p className="route-empty">{running ? t('checks.running') : t('checks.notRun')}</p> : null}
      </section>

      <section className="route-section">
        <header>
          <div>
            <h2>{t('checks.setup')}</h2>
            <span>{t('checks.setupHint')}</span>
          </div>
        </header>
        <ul className="checks-editor">
          {draft.checks.map((check, index) => (
            <li key={index}>
              <input aria-label={t('checks.name')} placeholder={t('checks.name')} value={check.name} maxLength={60} onChange={(event) => setCheck(index, { name: event.target.value })} />
              <input aria-label={t('checks.command')} placeholder={t('checks.commandPlaceholder')} className="checks-command" value={check.command} maxLength={2000} onChange={(event) => setCheck(index, { command: event.target.value })} />
              <button type="button" className="icon-button" aria-label={t('checks.remove', { name: check.name || '…' })} onClick={() => update({ checks: draft.checks.filter((_, at) => at !== index) })}>
                <Trash2 size={13} />
              </button>
            </li>
          ))}
        </ul>
        <div className="provider-actions">
          <button type="button" className="provider-secondary" disabled={draft.checks.length >= 12} onClick={() => update({ checks: [...draft.checks, { name: '', command: '', timeout: 600 }] })}>
            <Plus size={13} aria-hidden="true" />{t('checks.add')}
          </button>
        </div>
        {unused.length ? (
          <div className="checks-suggested">
            <p>{t('checks.suggested')}</p>
            <ul>
              {unused.map((item) => (
                <li key={item.command}>
                  <code>{item.command}</code>
                  <span className="checks-source">{item.source}</span>
                  <button type="button" className="text-btn" onClick={() => update({ checks: [...draft.checks, { name: item.name, command: item.command, timeout: 600 }] })}>{t('checks.use')}</button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <label className="settings-toggle checks-toggle">
          <input type="checkbox" role="switch" checked={draft.afterTurn} onChange={(event) => update({ afterTurn: event.target.checked })} />
          <span>{t('checks.afterTurn')}</span>
        </label>
        <label className="checks-rounds">
          <span>{t('checks.fixRounds')}</span>
          <select value={draft.maxFixRounds} disabled={!draft.afterTurn} onChange={(event) => update({ maxFixRounds: Number(event.target.value) })}>
            {[0, 1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
      </section>

      <section className="route-section">
        <header>
          <div>
            <h2>{t('checks.rules')}</h2>
            <span>{t('checks.rulesHint')}</span>
          </div>
        </header>
        <label className="checks-field">
          <span>{t('checks.protected')}</span>
          <textarea rows={3} value={draft.protected} placeholder={'migrations/**\n.env*'} onChange={(event) => update({ protected: event.target.value })} />
        </label>
        <p className="checks-field-label">{t('checks.formatters')}</p>
        <ul className="checks-editor">
          {draft.formatters.map((item, index) => (
            <li key={index}>
              <input aria-label={t('checks.formatFiles')} placeholder="*.py" value={item.files} maxLength={200} onChange={(event) => setFormatter(index, { files: event.target.value })} />
              <input aria-label={t('checks.formatCommand')} placeholder="ruff format {file}" className="checks-command" value={item.command} maxLength={2000} onChange={(event) => setFormatter(index, { command: event.target.value })} />
              <button type="button" className="icon-button" aria-label={t('checks.removeFormatter')} onClick={() => update({ formatters: draft.formatters.filter((_, at) => at !== index) })}>
                <Trash2 size={13} />
              </button>
            </li>
          ))}
        </ul>
        <div className="provider-actions">
          <button type="button" className="provider-secondary" onClick={() => update({ formatters: [...draft.formatters, { files: '', command: '' }] })}>
            <Plus size={13} aria-hidden="true" />{t('checks.addFormatter')}
          </button>
        </div>
        <label className="settings-toggle checks-toggle">
          <input type="checkbox" role="switch" checked={draft.secretScan} onChange={(event) => update({ secretScan: event.target.checked })} />
          <span>{t('checks.secretScan')}</span>
        </label>
        <div className="provider-actions">
          <button type="button" className="provider-primary" disabled={!changed || busy !== null} onClick={save}>{t('checks.save')}</button>
          {notice ? (
            <span className={`provider-status${notice === 'saved' ? '' : ' provider-status-error'}`} role="status">{t(NOTICES[notice])}</span>
          ) : null}
        </div>
      </section>
    </div>
  )
}

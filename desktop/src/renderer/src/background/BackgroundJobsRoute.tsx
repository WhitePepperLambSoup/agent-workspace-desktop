import { RefreshCw, Square, Terminal } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { WorkbenchBridgeClient } from '../bridge/client'
import type { WorkbenchState } from '../state/workbench-store'
import { JobLog } from './JobLog'
import { useOptionalI18n } from '../i18n/I18nProvider'
import { localizeKnownStatus, translate, type MessageKey } from '../i18n/messages'

type JobsClient = Pick<WorkbenchBridgeClient, 'listJobs' | 'getJobLogs' | 'stopJob'>
const TERMINAL = new Set(['succeeded', 'failed', 'stopped', 'interrupted'])

export function BackgroundJobsRoute({ state, client }: { state: WorkbenchState; client?: JobsClient }) {
  const { locale, t } = useOptionalI18n()
  const [stopping, setStopping] = useState<string | null>(null)
  const [error, setError] = useState<MessageKey | null>(null)
  const requestGeneration = useRef(0)
  const selectedSessionId = typeof state.selectedSession?.id === 'string' ? state.selectedSession.id : null
  const load = useCallback(async (): Promise<void> => {
    const requestSessionId = selectedSessionId
    if (!client || !requestSessionId) return
    const generation = ++requestGeneration.current
    setError(null)
    try {
      await client.listJobs()
    } catch {
      if (generation === requestGeneration.current && requestSessionId === selectedSessionId) setError('jobs.loadFailed')
    }
  }, [client, selectedSessionId])
  useEffect(() => {
    requestGeneration.current += 1
    setError(null)
  }, [selectedSessionId])
  useEffect(() => {
    if (state.operational.jobsState === 'idle' && selectedSessionId) void load()
  }, [load, selectedSessionId, state.operational.jobsState])
  const loadLogs = async (jobId: string): Promise<void> => {
    if (!client) return
    setError(null)
    try { await client.getJobLogs(jobId) } catch { setError('jobs.logsFailed') }
  }
  const stop = async (jobId: string): Promise<void> => {
    if (!client || stopping) return
    setStopping(jobId); setError(null)
    try { await client.stopJob(jobId) } catch { setError('jobs.stopFailed') } finally { setStopping(null) }
  }
  return <main className="route-column reading-surface" aria-label={t('workbench.jobs')}><header className="route-header"><div><p className="section-kicker">{t('workbench.workspace')}</p><h1 tabIndex={-1}>{t('workbench.jobs')}</h1></div><button type="button" className="icon-button" aria-label={t('jobs.refresh')} title={t('jobs.refresh')} disabled={!client || !selectedSessionId} onClick={() => void load()}><RefreshCw size={15} /></button></header><div className="route-content operational-split">
    <section className="route-section"><header><div><h2>{t('jobs.jobs')}</h2><span>{t('jobs.reported', { count: state.operational.jobs.length })}</span></div></header><div className="route-list" role="list">{state.operational.jobs.map((job) => { const label = job.label ?? job.jobId; const active = !TERMINAL.has(job.state); return <div className="route-list-row" role="listitem" key={job.jobId}><button type="button" className="job-open" aria-label={t('jobs.loadLogs', { label })} onClick={() => void loadLogs(job.jobId)}><Terminal size={14} /><span><strong>{label}</strong><small>{job.jobId}</small></span></button><span className="route-list-state">{localizeKnownStatus(locale, job.state)}</span><button type="button" className="icon-button" aria-label={t('jobs.stopLabel', { label })} title={t('composer.stop')} aria-busy={stopping === job.jobId} disabled={!client || !active || stopping !== null} onClick={() => void stop(job.jobId)}><Square size={13} /></button></div> })}</div><div className="jobs-feedback" aria-live="polite">{state.operational.jobsState === 'loading' ? <p role="status" className="route-note">{t('jobs.loading')}</p> : null}{state.operational.jobsState === 'ready' && state.operational.jobs.length === 0 ? <p className="route-note">{t('jobs.empty')}</p> : null}{error ? <p role="status" className="route-error">{translate(locale, error)}</p> : null}</div></section>
    <JobLog value={state.operational.selectedJobLog} />
  </div></main>
}

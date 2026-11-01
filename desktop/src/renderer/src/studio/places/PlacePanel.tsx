import { FileCode, RotateCcw, Search, Square, Undo2 } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'

import type { WorkbenchBridgeClient } from '../../bridge/client'
import { JobLog } from '../../background/JobLog'
import type { GitFileDiff } from '../../changes/ChangesRoute'
import { useOptionalI18n } from '../../i18n/I18nProvider'
import { localizeKnownStatus } from '../../i18n/messages'
import { parseResults, type KnowledgeResult } from '../../knowledge/model'
import { requestEditor } from '../../preview/preview-request'
import type { BackgroundJobSummary, WorkbenchState } from '../../state/workbench-types'
import { whileShown } from './while-shown'

/** Lines of a file's change shown beside the site; the rest is on the changes page. */
const DIFF_LINES = 60
const RUNNING = /^(running|starting|queued|pending)$/i
/** How often a running job's output is read again while it is shown. */
const LOG_EVERY = 3_000

/**
 * Beside a place, what can be done there: on the building site, see a changed file's change and
 * undo it (and restore it); in the server room, read a job's output and stop it; in the library,
 * search the knowledge base.
 */
export function PlacePanel({ place, state, client, diff, jobs, onRefresh }: {
  place: 'site' | 'servers' | 'library'
  state: WorkbenchState
  client?: WorkbenchBridgeClient
  diff: GitFileDiff[] | null
  jobs: BackgroundJobSummary[]
  onRefresh: () => void
}) {
  return (
    <aside className="control-panel place-panel" data-place={place}>
      {place === 'site' ? <SitePanel client={client} diff={diff} onRefresh={onRefresh} />
        : place === 'servers' ? <ServersPanel state={state} client={client} jobs={jobs} onRefresh={onRefresh} />
          : <LibraryPanel client={client} />}
    </aside>
  )
}

function SitePanel({ client, diff, onRefresh }: { client?: WorkbenchBridgeClient; diff: GitFileDiff[] | null; onRefresh: () => void }) {
  const { t, locale } = useOptionalI18n()
  const [open, setOpen] = useState<string | null>(null)
  const [undone, setUndone] = useState<Array<{ path: string; checkpointId: string }>>([])
  const [error, setError] = useState<string | null>(null)
  const discard = async (file: GitFileDiff): Promise<void> => {
    if (!client?.revertGitDiff) return
    if (!window.confirm(t(file.status === 'untracked' ? 'workspace.discardUntrackedConfirm' : 'workspace.discardConfirm'))) return
    setError(null)
    try {
      const data = (await client.revertGitDiff(file.filePath)).payload as { success?: boolean; checkpointId?: string | null }
      if (data.success !== true) throw new Error('revert')
      if (data.checkpointId) setUndone((current) => [{ path: file.filePath, checkpointId: data.checkpointId! }, ...current])
      onRefresh()
    } catch {
      setError(t('changes.revertFailed'))
    }
  }
  const restore = async (item: { path: string; checkpointId: string }): Promise<void> => {
    if (!client?.undoGitRevert) return
    setError(null)
    try {
      await client.undoGitRevert(item.checkpointId)
      setUndone((current) => current.filter((entry) => entry !== item))
      onRefresh()
    } catch {
      setError(t('changes.revertFailed'))
    }
  }
  const files = diff ?? []
  return (
    <>
      <header className="control-summary"><h2>{t('places.site.changed', { count: files.length })}</h2></header>
      {undone.map((item) => (
        <p key={item.checkpointId} className="place-undone">
          {t('places.site.undone', { path: item.path })}
          <button type="button" onClick={() => void restore(item)}><Undo2 size={13} aria-hidden="true" />{t('places.site.restore')}</button>
        </p>
      ))}
      <ul className="control-list">
        {files.map((file) => {
          const lines = file.hunks.flatMap((hunk) => [{ kind: 'marker', content: hunk.header }, ...hunk.lines])
          return (
            <li key={file.filePath} data-state={open === file.filePath ? 'open' : undefined}>
              <button type="button" aria-expanded={open === file.filePath} onClick={() => setOpen(open === file.filePath ? null : file.filePath)}>
                <span className="studio-floor-dot" aria-hidden="true" />
                <strong>{file.filePath}</strong>
                <span>+{file.additions} −{file.deletions} · {localizeKnownStatus(locale, file.status)}</span>
              </button>
              {open === file.filePath ? (
                <div className="place-file">
                  <pre className="place-diff">
                    {lines.slice(0, DIFF_LINES).map((line, index) => <span key={index} data-kind={line.kind}>{line.content}{'\n'}</span>)}
                  </pre>
                  {lines.length > DIFF_LINES ? <small>{t('places.site.moreLines', { count: lines.length - DIFF_LINES })}</small> : null}
                  <div className="control-actions">
                    <button type="button" onClick={() => requestEditor(file.filePath)}><FileCode size={14} aria-hidden="true" />{t('places.site.openFile')}</button>
                    <button type="button" disabled={!client} onClick={() => void discard(file)}><RotateCcw size={14} aria-hidden="true" />{t('places.site.discard')}</button>
                  </div>
                </div>
              ) : null}
            </li>
          )
        })}
        {diff !== null && files.length === 0 ? <li className="control-empty">{t('places.site.clean')}</li> : null}
      </ul>
      {error ? <p className="route-error" role="status">{error}</p> : null}
    </>
  )
}

function ServersPanel({ state, client, jobs, onRefresh }: { state: WorkbenchState; client?: WorkbenchBridgeClient; jobs: BackgroundJobSummary[]; onRefresh: () => void }) {
  const { t, locale } = useOptionalI18n()
  const [shown, setShown] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const job = jobs.find((item) => item.jobId === shown)
  const running = job ? RUNNING.test(job.state) : false
  // The output of the job shown, read again while it runs.
  useEffect(() => {
    if (!client || !shown) return undefined
    const read = (): void => { void client.getJobLogs(shown, 16_384).catch(() => setError(t('jobs.logsFailed'))) }
    read()
    if (!running) return undefined
    return whileShown(read, LOG_EVERY)
  }, [client, running, shown, t])
  const stop = async (jobId: string): Promise<void> => {
    if (!client) return
    setError(null)
    try {
      await client.stopJob(jobId)
      onRefresh()
    } catch {
      setError(t('jobs.stopFailed'))
    }
  }
  const log = state.operational.selectedJobLog
  return (
    <>
      <header className="control-summary"><h2>{t('places.servers.jobs')}</h2></header>
      <ul className="control-list">
        {jobs.map((item) => (
          <li key={item.jobId} data-state={RUNNING.test(item.state) ? 'working' : item.state === 'failed' ? 'failed' : undefined}>
            <button type="button" aria-expanded={shown === item.jobId} onClick={() => setShown(shown === item.jobId ? null : item.jobId)}>
              <span className="studio-floor-dot" aria-hidden="true" />
              <strong>{item.label ?? item.jobId}</strong>
              <span>{localizeKnownStatus(locale, item.state)}</span>
            </button>
          </li>
        ))}
        {jobs.length === 0 ? <li className="control-empty">{t('places.servers.noJobs')}</li> : null}
      </ul>
      {job ? (
        <div className="place-file">
          {running ? (
            <div className="control-actions">
              <button type="button" disabled={!client} onClick={() => void stop(job.jobId)}><Square size={13} aria-hidden="true" />{t('composer.stop')}</button>
            </div>
          ) : null}
          <JobLog value={log && log.jobId === job.jobId ? log : null} />
        </div>
      ) : null}
      {error ? <p className="route-error" role="status">{error}</p> : null}
    </>
  )
}

function LibraryPanel({ client }: { client?: WorkbenchBridgeClient }) {
  const { t } = useOptionalI18n()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<KnowledgeResult[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const search = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (!client || !query.trim()) return
    setBusy(true)
    setFailed(false)
    try {
      setResults(parseResults((await client.searchKnowledge(query.trim())).payload))
    } catch {
      setResults(null)
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <form className="place-search" onSubmit={(event) => void search(event)}>
        <input type="search" value={query} aria-label={t('places.library.search')} placeholder={t('places.library.search')}
          onChange={(event) => setQuery(event.currentTarget.value)} />
        <button type="submit" className="icon-button" aria-label={t('places.library.searchButton')} title={t('places.library.searchButton')} disabled={!client || busy || !query.trim()}>
          <Search size={14} />
        </button>
      </form>
      {busy ? <p className="control-note" role="status">{t('places.library.searching')}</p> : null}
      {failed ? <p className="route-error" role="status">{t('places.library.searchFailed')}</p> : null}
      {results ? (
        <ol className="control-list place-results">
          {results.map((result, index) => (
            <li key={`${result.documentId}-${index}`}>
              <strong>{[result.document, result.page ? t('knowledge.page', { page: result.page }) : null, result.section].filter(Boolean).join(' · ')}</strong>
              <p>{result.passage}</p>
            </li>
          ))}
          {results.length === 0 ? <li className="control-empty">{t('places.library.noResults')}</li> : null}
        </ol>
      ) : null}
    </>
  )
}

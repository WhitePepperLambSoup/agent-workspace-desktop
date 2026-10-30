import { CircleDot, FileWarning, GitBranch, GitPullRequestArrow, Loader2, Play, RefreshCw, ScrollText, Search, Wrench } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import type { WorkbenchBridgeClient } from '../bridge/client'
import { useOptionalI18n } from '../i18n/I18nProvider'
import type { MessageKey } from '../i18n/messages'

export type GitClient = Pick<
  WorkbenchBridgeClient,
  | 'gitStatus'
  | 'createGitBranch'
  | 'switchGitBranch'
  | 'takeConflictSide'
  | 'markConflictResolved'
  | 'finishGitOperation'
  | 'ciRuns'
  | 'ciLog'
  | 'gitIssues'
  | 'gitIssue'
>

export interface GitStatus {
  branch: string | null
  head: string | null
  detached: boolean
  defaultBranch: string | null
  upstream: string | null
  ahead: number
  behind: number
  operation: 'merge' | 'rebase' | 'cherry-pick' | null
  conflicts: Array<{ path: string; blocks: number }>
  github: boolean
  githubCli: boolean
  recentBranches: string[]
}

interface CiRun {
  id: number
  title: string
  workflow: string
  status: string
  conclusion: string | null
  url: string | null
}

interface IssueItem {
  number: number
  title: string
  labels: string[]
}

interface IssueDetail extends IssueItem {
  url: string
  body: string
  comments: Array<{ author: string; body: string }>
  branch: string
}

const ERRORS: Record<string, MessageKey> = {
  not_git_repository: 'changes.notGitRepository',
  git_unavailable: 'git.error.gitMissing',
  branch_exists: 'git.error.branchExists',
  invalid_branch_name: 'git.error.branchName',
  branch_missing: 'git.error.branchMissing',
  switch_blocked: 'git.error.switchBlocked',
  conflict_markers_left: 'git.error.markersLeft',
  conflicts_left: 'git.error.conflictsLeft',
  finish_failed: 'git.error.finishFailed',
  github_cli_unavailable: 'git.error.ghMissing',
  github_not_signed_in: 'git.error.ghSignIn',
  github_command_failed: 'git.error.ghFailed',
  git_timeout: 'git.error.timeout',
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

export function gitErrorKey(code: string): MessageKey {
  return ERRORS[code] ?? 'git.error.failed'
}

/** A failure answered with git's own words (`error` and `detail`), or a refused command. */
function failureOf(reply: { payload: unknown } | null, reason?: unknown): { key: MessageKey; detail: string } | null {
  if (reason !== undefined) {
    return { key: gitErrorKey(reason instanceof Error ? reason.message : String(reason)), detail: '' }
  }
  const payload = record(reply?.payload)
  return typeof payload.error === 'string'
    ? { key: gitErrorKey(payload.error), detail: typeof payload.detail === 'string' ? payload.detail : '' }
    : null
}

/** Words of a title for a branch name, as the sidecar makes them. */
export function branchFromTitle(title: string, issue?: number): string {
  const words = title.normalize('NFKD').replace(/[^\x00-\x7f]/g, '').toLowerCase().match(/[a-z0-9]+/g) ?? []
  let joined = ''
  for (const word of words) {
    const next = joined ? `${joined}-${word}` : word
    if (next.length > 40) break
    joined = next
  }
  if (issue !== undefined) return joined ? `issue-${issue}-${joined}` : `issue-${issue}`
  return joined ? `task/${joined}` : 'task/change'
}

function ciState(run: CiRun): 'running' | 'failed' | 'passed' | 'other' {
  if (run.status !== 'completed') return 'running'
  if (run.conclusion === 'failure' || run.conclusion === 'timed_out' || run.conclusion === 'startup_failure') return 'failed'
  return run.conclusion === 'success' ? 'passed' : 'other'
}

/** The Changes page's Git tab. */
export function GitPanel({
  client,
  onAsk,
  onOpenFile,
}: {
  client: GitClient
  /** Sends a request to the current conversation; false when it could not. */
  onAsk?: (prompt: string) => Promise<boolean>
  onOpenFile?: (path: string) => void
}) {
  const { t } = useOptionalI18n()
  const [status, setStatus] = useState<GitStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [failure, setFailure] = useState<{ key: MessageKey; detail: string } | null>(null)
  const [notice, setNotice] = useState<MessageKey | null>(null)
  const [branchName, setBranchName] = useState('')
  const [runs, setRuns] = useState<CiRun[] | null>(null)
  const [log, setLog] = useState<{ run: CiRun; text: string } | null>(null)
  const [issues, setIssues] = useState<IssueItem[] | null>(null)
  const [search, setSearch] = useState('')
  const [onNewBranch, setOnNewBranch] = useState(true)

  const apply = useCallback((reply: { payload: unknown }): boolean => {
    const problem = failureOf(reply)
    if (problem) {
      setFailure(problem)
      return false
    }
    const next = record(reply.payload).status
    if (next) setStatus(next as GitStatus)
    return true
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      apply(await client.gitStatus())
    } catch (reason) {
      setFailure(failureOf(null, reason))
    } finally {
      setLoading(false)
    }
  }, [apply, client])

  useEffect(() => {
    void load()
  }, [load])

  const act = async (label: string, run: () => Promise<{ payload: unknown }>, done?: MessageKey): Promise<boolean> => {
    setBusy(label)
    setFailure(null)
    setNotice(null)
    try {
      const ok = apply(await run())
      if (ok && done) setNotice(done)
      return ok
    } catch (reason) {
      setFailure(failureOf(null, reason))
      return false
    } finally {
      setBusy(null)
    }
  }

  const ask = async (prompt: string): Promise<void> => {
    if (!onAsk) return
    setFailure(null)
    if (await onAsk(prompt)) setNotice('git.sent')
    else setFailure({ key: 'changes.hunkCommentFailed', detail: '' })
  }

  const loadRuns = useCallback(async () => {
    setBusy('runs')
    try {
      const reply = await client.ciRuns()
      setRuns(Array.isArray(record(reply.payload).runs) ? (record(reply.payload).runs as CiRun[]) : [])
    } catch (reason) {
      setFailure(failureOf(null, reason))
    } finally {
      setBusy(null)
    }
  }, [client])

  const loadIssues = async (): Promise<void> => {
    setBusy('issues')
    try {
      const reply = await client.gitIssues(search.trim())
      setIssues(Array.isArray(record(reply.payload).issues) ? (record(reply.payload).issues as IssueItem[]) : [])
    } catch (reason) {
      setFailure(failureOf(null, reason))
    } finally {
      setBusy(null)
    }
  }

  const showLog = async (run: CiRun): Promise<void> => {
    setBusy(`log:${run.id}`)
    setFailure(null)
    try {
      const reply = await client.ciLog(run.id)
      const payload = record(reply.payload)
      const problem = failureOf(reply)
      if (problem) setFailure(problem)
      else setLog({ run, text: typeof payload.log === 'string' && payload.log ? payload.log : t('git.ci.noLog') })
    } catch (reason) {
      setFailure(failureOf(null, reason))
    } finally {
      setBusy(null)
    }
  }

  const startIssue = async (item: IssueItem): Promise<void> => {
    setBusy(`issue:${item.number}`)
    setFailure(null)
    try {
      const detail = record(record((await client.gitIssue(item.number)).payload).issue) as unknown as IssueDetail
      if (onNewBranch && status && status.branch !== detail.branch) {
        const made = apply(await client.createGitBranch(detail.branch))
        if (!made) return
      }
      const comments = detail.comments.length
        ? `\n\n${t('git.issue.comments')}\n${detail.comments.map((comment) => `${comment.author}: ${comment.body}`).join('\n\n')}`
        : ''
      await ask(t('git.issue.prompt', { number: detail.number, title: detail.title, url: detail.url, body: detail.body || '—', comments }))
    } catch (reason) {
      setFailure(failureOf(null, reason))
    } finally {
      setBusy(null)
    }
  }

  if (!status) {
    return (
      <section className="git-panel">
        {failure ? <p className="route-error" role="status">{t(failure.key)}</p> : <p className="route-note">{t('git.loading')}</p>}
      </section>
    )
  }

  const onDefault = Boolean(status.branch && status.branch === status.defaultBranch)

  return (
    <section className="git-panel" aria-label={t('git.tab')}>
      <header className="git-panel-head">
        <GitBranch size={15} aria-hidden="true" />
        <strong>{status.branch ?? t('git.detached', { head: status.head ?? '?' })}</strong>
        <span className="git-upstream">
          {status.upstream
            ? t('git.upstream', { upstream: status.upstream, ahead: status.ahead, behind: status.behind })
            : t('git.noUpstream')}
        </span>
        {status.operation ? <span className="git-operation">{t(`git.operation.${status.operation}` as MessageKey)}</span> : null}
        <button type="button" className="icon-button" aria-label={t('changes.refresh')} onClick={() => void load()} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'is-spinning' : undefined} />
        </button>
      </header>

      {failure ? (
        <div className="route-error" role="status">
          <p>{t(failure.key)}</p>
          {failure.detail ? <pre className="git-detail">{failure.detail}</pre> : null}
        </div>
      ) : null}
      {notice ? <p className="review-notice" role="status">{t(notice)}</p> : null}

      {status.operation || status.conflicts.length > 0 ? (
        <section className="git-section git-conflicts">
          <h3><FileWarning size={14} aria-hidden="true" />{t('git.conflicts', { count: status.conflicts.length })}</h3>
          {status.conflicts.map((item) => (
            <div key={item.path} className="git-row">
              <button type="button" className="git-path" onClick={() => onOpenFile?.(item.path)} disabled={!onOpenFile}>
                {item.path}
              </button>
              <small>{t('git.conflictBlocks', { count: item.blocks })}</small>
              <div className="git-row-actions">
                <button type="button" className="secondary-button" disabled={busy !== null} onClick={() => void act(`ours:${item.path}`, () => client.takeConflictSide(item.path, 'ours'))}>{t('git.keepOurs')}</button>
                <button type="button" className="secondary-button" disabled={busy !== null} onClick={() => void act(`theirs:${item.path}`, () => client.takeConflictSide(item.path, 'theirs'))}>{t('git.takeTheirs')}</button>
                <button type="button" className="secondary-button" disabled={busy !== null} onClick={() => void act(`done:${item.path}`, () => client.markConflictResolved(item.path))}>{t('git.markResolved')}</button>
                {onAsk ? (
                  <button type="button" className="secondary-button" onClick={() => void ask(t('git.conflictPrompt', { path: item.path }))}>
                    <Wrench size={12} aria-hidden="true" />{t('git.askResolve')}
                  </button>
                ) : null}
              </div>
            </div>
          ))}
          {status.operation ? (
            <div className="git-row-actions">
              <button type="button" className="primary-button" disabled={busy !== null || status.conflicts.length > 0} onClick={() => void act('continue', () => client.finishGitOperation('continue'), 'git.finished')}>
                <Play size={12} aria-hidden="true" />{t(`git.continue.${status.operation}` as MessageKey)}
              </button>
              <button
                type="button"
                className="secondary-button"
                disabled={busy !== null}
                onClick={() => {
                  if (window.confirm(t('git.abortConfirm'))) void act('abort', () => client.finishGitOperation('abort'), 'git.aborted')
                }}
              >
                {t(`git.abort.${status.operation}` as MessageKey)}
              </button>
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="git-section">
        <h3><GitBranch size={14} aria-hidden="true" />{t('git.branches')}</h3>
        {onDefault ? <p className="route-note">{t('git.onDefault', { branch: status.branch ?? '' })}</p> : null}
        <form
          className="git-new-branch"
          onSubmit={(event) => {
            event.preventDefault()
            const name = branchName.trim()
            if (name) void act('branch', () => client.createGitBranch(name), 'git.branchCreated').then((ok) => { if (ok) setBranchName('') })
          }}
        >
          <input aria-label={t('git.newBranch')} placeholder={t('git.newBranchPlaceholder')} value={branchName} onChange={(event) => setBranchName(event.target.value)} />
          <button type="submit" className="secondary-button" disabled={!branchName.trim() || busy !== null}>{t('git.createBranch')}</button>
        </form>
        {status.recentBranches.length > 0 ? (
          <div className="git-branch-list">
            {status.recentBranches.map((name) => (
              <button key={name} type="button" className="git-branch" disabled={busy !== null} title={t('git.switchTo', { branch: name })} onClick={() => void act(`switch:${name}`, () => client.switchGitBranch(name))}>
                {name}
              </button>
            ))}
          </div>
        ) : null}
      </section>

      {status.github ? (
        <>
          <section className="git-section">
            <h3>
              <CircleDot size={14} aria-hidden="true" />{t('git.ci.title')}
              <button type="button" className="icon-button" aria-label={t('git.ci.load')} onClick={() => void loadRuns()} disabled={busy === 'runs'}>
                {busy === 'runs' ? <Loader2 size={13} className="spin-animation" /> : <RefreshCw size={13} />}
              </button>
            </h3>
            {runs === null ? <p className="route-note">{t('git.ci.hint')}</p> : null}
            {runs?.length === 0 ? <p className="route-note">{t('git.ci.none')}</p> : null}
            {runs?.map((run) => {
              const state = ciState(run)
              return (
                <div key={run.id} className={`git-row ci-${state}`}>
                  <span className="git-ci-state">{t(`git.ci.${state}` as MessageKey)}</span>
                  <span className="git-ci-title"><strong>{run.workflow}</strong> {run.title}</span>
                  {state === 'failed' ? (
                    <div className="git-row-actions">
                      <button type="button" className="secondary-button" disabled={busy !== null} onClick={() => void showLog(run)}>
                        {busy === `log:${run.id}` ? <Loader2 size={12} className="spin-animation" /> : <ScrollText size={12} aria-hidden="true" />}{t('git.ci.log')}
                      </button>
                    </div>
                  ) : null}
                </div>
              )
            })}
            {log ? (
              <div className="git-log">
                <pre aria-label={t('git.ci.logOf', { workflow: log.run.workflow })}>{log.text}</pre>
                <div className="git-row-actions">
                  {onAsk ? (
                    <button type="button" className="primary-button" onClick={() => void ask(t('git.ci.prompt', { workflow: log.run.workflow, branch: status.branch ?? '', log: log.text }))}>
                      <Wrench size={12} aria-hidden="true" />{t('git.ci.fix')}
                    </button>
                  ) : null}
                  <button type="button" className="secondary-button" onClick={() => setLog(null)}>{t('git.close')}</button>
                </div>
              </div>
            ) : null}
          </section>

          <section className="git-section">
            <h3><GitPullRequestArrow size={14} aria-hidden="true" />{t('git.issues.title')}</h3>
            <form className="git-new-branch" onSubmit={(event) => { event.preventDefault(); void loadIssues() }}>
              <input aria-label={t('git.issues.search')} placeholder={t('git.issues.search')} value={search} onChange={(event) => setSearch(event.target.value)} />
              <button type="submit" className="secondary-button" disabled={busy !== null}>
                {busy === 'issues' ? <Loader2 size={12} className="spin-animation" /> : <Search size={12} aria-hidden="true" />}{t('git.issues.load')}
              </button>
            </form>
            {issues !== null ? (
              <label className="git-check">
                <input type="checkbox" checked={onNewBranch} onChange={(event) => setOnNewBranch(event.target.checked)} />
                {t('git.issues.onBranch')}
              </label>
            ) : null}
            {issues?.length === 0 ? <p className="route-note">{t('git.issues.none')}</p> : null}
            {issues?.map((item) => (
              <div key={item.number} className="git-row">
                <span className="git-ci-title"><strong>#{item.number}</strong> {item.title}</span>
                {item.labels.map((label) => <em key={label} className="git-label">{label}</em>)}
                {onAsk ? (
                  <div className="git-row-actions">
                    <button type="button" className="secondary-button" disabled={busy !== null} onClick={() => void startIssue(item)}>
                      {busy === `issue:${item.number}` ? <Loader2 size={12} className="spin-animation" /> : <Play size={12} aria-hidden="true" />}{t('git.issues.start')}
                    </button>
                  </div>
                ) : null}
              </div>
            ))}
          </section>
        </>
      ) : (
        <p className="route-note">{status.githubCli ? t('git.notGithub') : t('git.error.ghMissing')}</p>
      )}
    </section>
  )
}

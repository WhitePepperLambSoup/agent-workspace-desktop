import {
  Bot,
  Check,
  CircleDot,
  FileCheck2,
  GitPullRequest,
  MessageSquarePlus,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { WorkbenchBridgeClient } from '../bridge/client'
import { useText } from '../i18n/I18nProvider'
import type { WorkbenchState } from '../state/workbench-store'

type ReviewClient = Partial<
  Pick<
    WorkbenchBridgeClient,
    | 'listReviewSnapshots'
    | 'getReviewSnapshot'
    | 'createReviewSnapshot'
    | 'createReviewComment'
    | 'resolveReviewComment'
    | 'followupReviewComment'
    | 'createDraftPullRequest'
    | 'refreshPullRequest'
    | 'listAgentRuns'
  >
>

interface ReviewLine {
  kind: 'add' | 'delete' | 'context' | 'marker'
  content: string
  oldLineno?: number | null
  newLineno?: number | null
}

interface ReviewHunk {
  hunkIndex: number
  header: string
  lines: ReviewLine[]
}

interface ReviewFile {
  filePath: string
  status: string
  additions: number
  deletions: number
  hunks: ReviewHunk[]
}

interface ReviewSnapshotView {
  id: string
  runId: string | null
  baseSha: string
  headSha: string
  diffSha256: string
  workingTreeDirty: boolean
  fileCount: number
  additions: number
  deletions: number
  createdAt: string
  files?: ReviewFile[]
}

interface ReviewCommentView {
  id: string
  path: string
  side: 'old' | 'new'
  line: number
  body: string
  state: 'open' | 'resolved'
  followupRunId: string | null
}

interface ReviewDeliveryView {
  prUrl: string | null
  prNumber: number | null
  state: string
  isDraft: boolean
  headBranch: string | null
  baseBranch: string | null
  commitSha?: string | null
  lastError?: string | null
}

interface DeliveryCheckView {
  name: string
  state: string
  url: string | null
  detail: string
}

interface AgentRunOption {
  id: string
  title: string
  state: string
}

interface ReviewDetailPayload {
  snapshot?: ReviewSnapshotView
  comments?: ReviewCommentView[]
  delivery?: ReviewDeliveryView | null
  checks?: DeliveryCheckView[]
}

function payloadObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function errorMessage(reason: unknown): string {
  const raw = reason instanceof Error ? reason.message : String(reason)
  const known: Record<string, string> = {
    review_empty: 'There are no changes to capture from this base revision.',
    review_snapshot_stale: 'The checkout changed after this snapshot. Capture a new snapshot.',
    review_commit_required: 'Enter a commit title before creating the pull request.',
    github_cli_unavailable: 'GitHub CLI is not installed or could not be found.',
    github_command_failed: 'GitHub could not create or inspect the pull request.',
    git_command_failed: 'Git could not commit or push the reviewed changes.',
    delivery_timeout: 'Delivery timed out. Check the network and retry.',
    delivery_unavailable: 'Git or GitHub CLI could not be started.',
    review_checkout_missing: 'The checkout for this review no longer exists.',
    invalid_head_branch: 'Create or select a feature branch before delivery.',
    pull_request_url_missing: 'GitHub created no readable pull request URL.',
    invalid_github_response: 'GitHub returned an unreadable pull request response.',
    pull_request_exists: 'A pull request already exists for this snapshot. Refresh its status.',
  }
  return known[raw] ?? raw
}

export function ReviewWorkspace({
  state,
  client,
}: {
  state: WorkbenchState
  client?: ReviewClient
}) {
  const tx = useText()
  const [snapshots, setSnapshots] = useState<ReviewSnapshotView[]>([])
  const [runs, setRuns] = useState<AgentRunOption[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selectedIdRef = useRef<string | null>(null)
  const [snapshot, setSnapshot] = useState<ReviewSnapshotView | null>(null)
  const [comments, setComments] = useState<ReviewCommentView[]>([])
  const [delivery, setDelivery] = useState<ReviewDeliveryView | null>(null)
  const [checks, setChecks] = useState<DeliveryCheckView[]>([])
  const [sourceRunId, setSourceRunId] = useState('')
  const [selectedFile, setSelectedFile] = useState('')
  const [anchor, setAnchor] = useState<{
    path: string
    side: 'old' | 'new'
    line: number
  } | null>(null)
  const [commentBody, setCommentBody] = useState('')
  const [prTitle, setPrTitle] = useState('')
  const [prBody, setPrBody] = useState('')
  const [baseBranch, setBaseBranch] = useState('main')
  const [commitTitle, setCommitTitle] = useState('')
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const generation = useRef(0)
  const workspaceKey = String(state.workspace?.path ?? '') + ':' + state.runtime.epoch

  useEffect(() => {
    selectedIdRef.current = selectedId
  }, [selectedId])

  const applyDetails = useCallback((payload: unknown) => {
    const details = payloadObject(payload) as ReviewDetailPayload
    const next = details.snapshot ?? null
    setSnapshot(next)
    setComments(Array.isArray(details.comments) ? details.comments : [])
    setDelivery(details.delivery ?? null)
    setChecks(Array.isArray(details.checks) ? details.checks : [])
    setSelectedFile((current) => {
      const files = next?.files ?? []
      return files.some((file) => file.filePath === current)
        ? current
        : (files[0]?.filePath ?? '')
    })
    if (next) {
      setPrTitle((current) =>
        current || `Review ${next.runId ? `agent run ${next.runId.slice(0, 8)}` : 'workspace changes'}`,
      )
    }
  }, [])

  const loadDetails = useCallback(
    async (snapshotId: string, request?: number) => {
      if (!client?.getReviewSnapshot) return
      const ticket = request ?? generation.current
      const reply = await client.getReviewSnapshot(snapshotId)
      if (ticket !== generation.current || selectedIdRef.current !== snapshotId) return
      applyDetails(reply.payload)
    },
    [applyDetails, client],
  )

  const load = useCallback(async () => {
    if (!client?.listReviewSnapshots || !state.workspace) return
    const request = ++generation.current
    setLoading(true)
    setError(null)
    try {
      const [snapshotReply, runsReply] = await Promise.all([
        client.listReviewSnapshots(100),
        client.listAgentRuns?.({ limit: 200 }) ?? Promise.resolve({ payload: { runs: [] } }),
      ])
      if (request !== generation.current) return
      const nextSnapshots = payloadObject(snapshotReply.payload).snapshots
      const nextRuns = payloadObject(runsReply.payload).runs
      const snapshotList = Array.isArray(nextSnapshots)
        ? (nextSnapshots as ReviewSnapshotView[])
        : []
      setSnapshots(snapshotList)
      setRuns(Array.isArray(nextRuns) ? (nextRuns as AgentRunOption[]) : [])
      const current = selectedIdRef.current
      const nextId =
        current && snapshotList.some((item) => item.id === current)
          ? current
          : (snapshotList[0]?.id ?? null)
      setSelectedId(nextId)
      selectedIdRef.current = nextId
      if (nextId) await loadDetails(nextId, request)
      else {
        setSnapshot(null)
        setComments([])
        setDelivery(null)
        setChecks([])
      }
    } catch (reason) {
      if (request === generation.current) setError(tx(errorMessage(reason)))
    } finally {
      if (request === generation.current) setLoading(false)
    }
  }, [client, loadDetails, workspaceKey])

  useEffect(() => {
    selectedIdRef.current = null
    setSelectedId(null)
    setSnapshot(null)
    setComments([])
    setDelivery(null)
    setChecks([])
    setSnapshots([])
    setSourceRunId('')
    void load()
    return () => {
      generation.current += 1
    }
  }, [load])

  const selectSnapshot = async (snapshotId: string) => {
    const request = ++generation.current
    setSelectedId(snapshotId)
    selectedIdRef.current = snapshotId
    setError(null)
    setSnapshot(null)
    setComments([])
    setDelivery(null)
    setChecks([])
    setAnchor(null)
    setLoading(false)
    try {
      await loadDetails(snapshotId, request)
    } catch (reason) {
      if (request !== generation.current) return
      setError(tx(errorMessage(reason)))
    }
  }

  const capture = async () => {
    if (!client?.createReviewSnapshot || busy) return
    const request = ++generation.current
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const reply = await client.createReviewSnapshot(sourceRunId ? { runId: sourceRunId } : {})
      if (request !== generation.current) return
      const details = payloadObject(reply.payload) as ReviewDetailPayload
      if (details.snapshot) {
        setSelectedId(details.snapshot.id)
        selectedIdRef.current = details.snapshot.id
        setSnapshots((current) => [
          details.snapshot as ReviewSnapshotView,
          ...current.filter((item) => item.id !== details.snapshot?.id),
        ])
      }
      applyDetails(reply.payload)
    } catch (reason) {
      setError(tx(errorMessage(reason)))
    } finally {
      setBusy(false)
    }
  }

  const addComment = async () => {
    if (!client?.createReviewComment || !snapshot || !anchor || !commentBody.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      await client.createReviewComment({
        snapshotId: snapshot.id,
        ...anchor,
        body: commentBody.trim(),
      })
      setAnchor(null)
      setCommentBody('')
      await loadDetails(snapshot.id)
    } catch (reason) {
      setError(tx(errorMessage(reason)))
    } finally {
      setBusy(false)
    }
  }

  const resolveComment = async (commentId: string) => {
    if (!client?.resolveReviewComment || !snapshot) return
    try {
      await client.resolveReviewComment(commentId)
      await loadDetails(snapshot.id)
    } catch (reason) {
      setError(tx(errorMessage(reason)))
    }
  }

  const followup = async (comment: ReviewCommentView) => {
    const ownerSessionId = state.selectedSession?.id
    if (!client?.followupReviewComment || typeof ownerSessionId !== 'string') return
    setError(null)
    try {
      const reply = await client.followupReviewComment(comment.id, {
        sessionId: ownerSessionId,
        isolation: 'worktree',
        start: true,
      })
      const run = payloadObject(reply.payload).run
      const runId = payloadObject(run).id
      setNotice(tx('Follow-up agent run {id} started.', { id: typeof runId === 'string' ? runId : '' }))
      if (snapshot) await loadDetails(snapshot.id)
    } catch (reason) {
      setError(tx(errorMessage(reason)))
    }
  }

  const createPullRequest = async () => {
    if (!client?.createDraftPullRequest || !snapshot || !prTitle.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      await client.createDraftPullRequest({
        snapshotId: snapshot.id,
        title: prTitle.trim(),
        body: prBody.trim(),
        baseBranch: baseBranch.trim(),
        commitTitle: commitTitle.trim(),
      })
      setNotice(tx('Draft pull request created.'))
      await loadDetails(snapshot.id)
    } catch (reason) {
      setError(tx(errorMessage(reason)))
    } finally {
      setBusy(false)
    }
  }

  const refreshPullRequest = async () => {
    if (!client?.refreshPullRequest || !snapshot) return
    setError(null)
    try {
      await client.refreshPullRequest(snapshot.id)
      await loadDetails(snapshot.id)
    } catch (reason) {
      setError(tx(errorMessage(reason)))
    }
  }

  const activeFile = useMemo(
    () => snapshot?.files?.find((file) => file.filePath === selectedFile) ?? null,
    [selectedFile, snapshot],
  )

  return (
    <section className="review-workspace" aria-label={tx('Immutable review workspace')}>
      <div className="review-toolbar glass-surface">
        <div>
          <p className="section-kicker">{tx('Frozen evidence')}</p>
          <h2>{tx('Review snapshots')}</h2>
        </div>
        <label>
          <span>{tx('Review source')}</span>
          <select
            aria-label={tx('Review source')}
            value={sourceRunId}
            onChange={(event) => setSourceRunId(event.target.value)}
          >
            <option value="">{tx('Current workspace')}</option>
            {runs.map((run) => (
              <option key={run.id} value={run.id}>{run.title} · {tx(run.state.replaceAll('_', ' '))}</option>
            ))}
          </select>
        </label>
        <button type="button" className="primary-button" onClick={() => void capture()} disabled={busy || !client?.createReviewSnapshot}>
          <ShieldCheck size={14} />{tx('Capture snapshot')}
        </button>
        <button type="button" className="icon-button" onClick={() => void load()} aria-label={tx('Refresh review snapshots')} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'is-spinning' : undefined} />
        </button>
      </div>

      {error ? <p className="route-error" role="status">{error}</p> : null}
      {notice ? <p className="review-notice" role="status">{notice}</p> : null}

      <div className="review-layout">
        <aside className="review-snapshot-list glass-surface" aria-label={tx('Snapshots')}>
          {snapshots.map((item) => (
            <button key={item.id} type="button" className={selectedId === item.id ? 'is-selected' : ''} aria-pressed={selectedId === item.id} onClick={() => void selectSnapshot(item.id)}>
              <FileCheck2 size={14} />
              <span><strong>{item.id.slice(0, 8)}</strong><small>{item.fileCount} {tx('files')} · +{item.additions} -{item.deletions}</small></span>
              {item.workingTreeDirty ? <em>{tx('uncommitted')}</em> : <Check size={13} />}
            </button>
          ))}
          {!loading && snapshots.length === 0 ? <p className="route-note">{tx('Capture a snapshot to begin review.')}</p> : null}
        </aside>

        <section className="review-diff-pane glass-surface">
          {snapshot ? (
            <>
              <header className="review-snapshot-header">
                <div><p className="section-kicker">{snapshot.diffSha256.slice(0, 12)}</p><h2>{snapshot.fileCount} {tx('changed files')}</h2></div>
                <code>{snapshot.baseSha.slice(0, 8)} → {snapshot.headSha.slice(0, 8)}</code>
              </header>
              <div className="review-file-tabs">
                {snapshot.files?.map((file) => (
                  <button key={file.filePath} type="button" className={selectedFile === file.filePath ? 'active' : ''} onClick={() => setSelectedFile(file.filePath)}>
                    {file.filePath}<span>+{file.additions} -{file.deletions}</span>
                  </button>
                ))}
              </div>
              {activeFile ? (
                <div className="review-hunks">
                  {activeFile.hunks.map((hunk) => (
                    <article key={hunk.hunkIndex} className="review-hunk">
                      <code className="review-hunk-header">{hunk.header}</code>
                      {hunk.lines.map((line, index) => {
                        const side: 'old' | 'new' = line.newLineno ? 'new' : 'old'
                        const lineNumber = line.newLineno ?? line.oldLineno
                        const anchored = lineNumber
                          ? comments.filter((comment) => comment.path === activeFile.filePath && comment.side === side && comment.line === lineNumber)
                          : []
                        return (
                          <div key={`${hunk.hunkIndex}-${index}`} className={`review-line line-${line.kind}`}>
                            {lineNumber ? (
                              <button type="button" className="review-line-anchor" aria-label={tx('Comment on {side} line {line}', { side: tx(side), line: lineNumber })} onClick={() => { setAnchor({ path: activeFile.filePath, side, line: lineNumber }); setCommentBody('') }}>
                                <span>{line.oldLineno ?? ''}</span><span>{line.newLineno ?? ''}</span><MessageSquarePlus size={12} />
                              </button>
                            ) : <span className="review-line-anchor" />}
                            <pre>{line.content}</pre>
                            {anchored.map((comment) => <span key={comment.id} className={`review-comment-marker state-${comment.state}`} title={comment.body}><CircleDot size={10} /></span>)}
                          </div>
                        )
                      })}
                    </article>
                  ))}
                </div>
              ) : <p className="route-note">{tx('Select a file to inspect the frozen diff.')}</p>}
              {anchor ? (
                <form className="review-comment-form" onSubmit={(event) => { event.preventDefault(); void addComment() }}>
                  <strong>{anchor.path}:{anchor.line} · {tx(anchor.side)}</strong>
                  <textarea aria-label={tx('Review comment')} value={commentBody} onChange={(event) => setCommentBody(event.target.value)} rows={3} autoFocus />
                  <div><button type="button" className="secondary-button" onClick={() => setAnchor(null)}>{tx('Cancel')}</button><button type="submit" className="primary-button" disabled={!commentBody.trim() || busy}>{tx('Add comment')}</button></div>
                </form>
              ) : null}
            </>
          ) : <p className="route-empty">{tx('Select or capture a review snapshot.')}</p>}
        </section>

        <aside className="review-sidebar">
          <section className="review-comments-card glass-surface">
            <header><h2>{tx('Review comments')}</h2><span>{comments.filter((comment) => comment.state === 'open').length}</span></header>
            {comments.map((comment) => (
              <article key={comment.id} className={`review-comment state-${comment.state}`}>
                <code>{comment.path}:{comment.line} · {tx(comment.side)}</code>
                <p>{comment.body}</p>
                {comment.followupRunId ? <small><Bot size={12} />{comment.followupRunId}</small> : null}
                {comment.state === 'open' ? <div><button type="button" className="secondary-button" aria-label={tx('Send to agent')} onClick={() => void followup(comment)} disabled={Boolean(comment.followupRunId)}><Bot size={12} />{tx('Send to agent')}</button><button type="button" className="secondary-button" onClick={() => void resolveComment(comment.id)}><Check size={12} />{tx('Resolve')}</button></div> : null}
              </article>
            ))}
            {comments.length === 0 ? <p className="route-note">{tx('No comments on this snapshot.')}</p> : null}
          </section>

          <section className="review-delivery-card glass-surface">
            <header><h2><GitPullRequest size={15} />{tx('Pull request & CI')}</h2>{delivery ? <span className={`delivery-state state-${delivery.state}`}>{tx(delivery.state === 'open' ? 'Open PR' : delivery.state.replaceAll('_', ' '))}</span> : null}</header>
            {delivery?.prUrl ? <a href={delivery.prUrl} target="_blank" rel="noreferrer">PR #{delivery.prNumber} · {delivery.headBranch} → {delivery.baseBranch}</a> : null}
            {delivery?.commitSha ? <small className="review-prepared-commit">{tx('Prepared commit')} <code>{delivery.commitSha.slice(0, 12)}</code></small> : null}
            {delivery?.lastError ? <p className="review-delivery-error">{tx(errorMessage(delivery.lastError))}</p> : null}
            {!delivery?.prUrl ? <>
            <input aria-label={tx('Pull request title')} value={prTitle} onChange={(event) => setPrTitle(event.target.value)} placeholder={tx('Pull request title')} />
            <textarea aria-label={tx('Pull request description')} value={prBody} onChange={(event) => setPrBody(event.target.value)} placeholder={tx('Summary and validation')} rows={3} />
            <div className="review-pr-row"><input aria-label={tx('Base branch')} value={baseBranch} onChange={(event) => setBaseBranch(event.target.value)} /><input aria-label={tx('Commit title')} value={commitTitle} onChange={(event) => setCommitTitle(event.target.value)} placeholder={snapshot?.workingTreeDirty ? tx('Required for uncommitted changes') : tx('Commit title')} /></div>
            </> : null}
            <div className="review-pr-actions">{!delivery?.prUrl ? <button type="button" className="primary-button" aria-label={tx('Create draft PR')} onClick={() => void createPullRequest()} disabled={!snapshot || !prTitle.trim() || !baseBranch.trim() || (Boolean(snapshot?.workingTreeDirty) && !commitTitle.trim()) || busy}><GitPullRequest size={13} />{tx('Create draft PR')}</button> : null}{delivery?.prUrl ? <button type="button" className="secondary-button" aria-label={tx('Refresh PR status')} onClick={() => void refreshPullRequest()}><RefreshCw size={12} />{tx('Refresh PR status')}</button> : null}</div>
            <div className="review-checks">
              {checks.map((check) => <div key={check.name} className={`review-check state-${check.state}`}><CircleDot size={11} /><span><strong>{check.name}</strong>{check.detail ? <small>{check.detail}</small> : null}</span><em>{tx(check.state.replaceAll('_', ' '))}</em></div>)}
            </div>
          </section>
        </aside>
      </div>
    </section>
  )
}

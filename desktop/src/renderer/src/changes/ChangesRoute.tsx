import {
  Check,
  ChevronDown,
  ChevronRight,
  FileDiff,
  GitBranch,
  GitCommit,
  GitCompare,
  History,
  ListChecks,
  MessageSquare,
  Loader2,
  ShieldCheck,
  RefreshCw,
  Search,
  Sparkles,
  Undo2,
  UploadCloud,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { WorkbenchBridgeClient } from '../bridge/client'
import { useOptionalI18n } from '../i18n/I18nProvider'
import { localizeKnownStatus, translate, type MessageKey } from '../i18n/messages'
import { openWorkspaceFile } from '../preview/preview-request'
import type { WorkbenchState } from '../state/workbench-store'
import { ChangeDetail } from './ChangeDetail'
import { branchFromTitle, GitPanel, gitErrorKey, type GitClient, type GitStatus } from './GitPanel'
import { HunkComment } from './HunkDiff'
import { ProjectChecks, type ProjectClient } from './ProjectChecks'
import { ReviewWorkspace } from './ReviewWorkspace'

export interface GitHunkLine {
  kind: 'add' | 'delete' | 'context' | 'marker'
  content: string
  oldLineno?: number | null
  newLineno?: number | null
}

export interface GitDiffHunk {
  hunkIndex: number
  oldStart: number
  oldCount: number
  newStart: number
  newCount: number
  header: string
  lines: GitHunkLine[]
}

export interface GitFileDiff {
  filePath: string
  status: string
  additions: number
  deletions: number
  summary: string
  isStaged?: boolean
  hunks: GitDiffHunk[]
}

/** A hunk as unified diff text, for a comment sent to the conversation. */
function hunkText(hunk: GitDiffHunk): string {
  return [hunk.header, ...hunk.lines.filter((line) => line.kind !== 'marker').map((line) => `${line.content}`)].join('\n')
}

type ChangesClient = Pick<WorkbenchBridgeClient, 'listChanges' | 'inspectChange'> &
  Partial<
    Pick<
      WorkbenchBridgeClient,
      | 'getGitDiff'
      | 'revertGitDiff'
      | 'deliverGitChanges'
      | 'undoGitRevert'
      | 'listReviewSnapshots'
      | 'getReviewSnapshot'
      | 'createReviewSnapshot'
      | 'createReviewComment'
      | 'resolveReviewComment'
      | 'followupReviewComment'
      | 'createDraftPullRequest'
      | 'refreshPullRequest'
      | 'listAgentRuns'
      | 'projectSettings'
      | 'saveProjectSettings'
      | 'trustProjectSettings'
      | 'runProjectChecks'
      | 'startTurn'
      | 'writeCommitMessage'
    >
  > &
  Partial<GitClient>

export function ChangesRoute({
  state,
  client,
}: {
  state: WorkbenchState
  client?: ChangesClient
}) {
  const { locale, t } = useOptionalI18n()
  const sessionId = state.selectedSession?.id ?? null
  const sessionTitle = state.selectedSession?.title ?? ''
  const sessionMode = state.selectedSession?.mode ?? ''
  const bootstrapVersion = state.bootstrapVersion ?? 0

  // Mode: Working Tree vs Changesets
  const [activeTab, setActiveTab] = useState<'working_tree' | 'changesets' | 'review' | 'checks' | 'git'>(
    client?.getGitDiff ? 'working_tree' : 'changesets',
  )

  // Changeset inspection state (retained for backward compatibility and durable audit)
  const [selectedId, setSelectedId] = useState(state.operational.changes[0]?.changesetId ?? '')
  const [path, setPath] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<MessageKey | null>(null)
  const changesRequestGeneration = useRef(0)

  // Working tree git diff state
  const [gitFiles, setGitFiles] = useState<GitFileDiff[]>([])
  const [selectedGitFile, setSelectedGitFile] = useState<string>('')
  const [loadingGit, setLoadingGit] = useState(false)
  const [isGitRepo, setIsGitRepo] = useState<boolean>(true)
  const [expandedHunks, setExpandedHunks] = useState<Set<number>>(new Set())
  // The part of a file's change the user is writing a comment on (path:hunk).
  const [commenting, setCommenting] = useState<string | null>(null)
  const [selectedFilesForDelivery, setSelectedFilesForDelivery] = useState<Set<string>>(new Set())
  const gitRequestGeneration = useRef(0)

  // Undo checkpoint state
  const [lastUndoCheckpoint, setLastUndoCheckpoint] = useState<{ checkpointId: string; filePath: string } | null>(null)

  // Delivery state
  const [deliveryTitle, setDeliveryTitle] = useState('')
  const [deliveryDescription, setDeliveryDescription] = useState<string | null>(null)
  const deliveryDraft = useRef({ sessionId, titleInitialized: false, titleEdited: false })
  const effectiveDeliveryDescription = deliveryDescription ?? (state.selectedSession?.title
    ? t('changes.defaultDeliveryDescription', { id: String(state.selectedSession.id) })
    : '')
  const [delivering, setDelivering] = useState(false)
  const [deliveryResult, setDeliveryResult] = useState<{
    commitSha: string | null
    branch: string
    summary: string
  } | null>(null)

  const loadChangesets = useCallback(async (clearError = true): Promise<void> => {
    const generation = ++changesRequestGeneration.current
    if (!client || !sessionId) return
    if (clearError) setError(null)
    try {
      await client.listChanges(20)
    } catch {
      if (generation !== changesRequestGeneration.current) return
      setError((current) => clearError ? 'changes.loadFailed' : current ?? 'changes.loadFailed')
    }
  }, [client, sessionId])

  const loadGitDiff = useCallback(async (): Promise<void> => {
    if (!client?.getGitDiff) return
    const generation = ++gitRequestGeneration.current
    setLoadingGit(true)
    try {
      const res = await client.getGitDiff()
      if (generation !== gitRequestGeneration.current) return
      const data = res.payload as { files?: GitFileDiff[]; isGitRepo?: boolean; error?: string }
      if (data.isGitRepo !== undefined) {
        setIsGitRepo(data.isGitRepo)
      }
      if (data.error && data.error !== 'not_git_repository') {
        setError('changes.loadFailed')
      }
      if (Array.isArray(data.files)) {
        setGitFiles(data.files)
        setSelectedFilesForDelivery((current) => {
          const available = new Set(data.files?.map((file) => file.filePath) ?? [])
          return new Set(Array.from(current).filter((filePath) => available.has(filePath)))
        })
        setSelectedGitFile((current) =>
          data.files?.some((file) => file.filePath === current)
            ? current
            : (data.files?.[0]?.filePath ?? ''),
        )
      }
    } catch {
      if (generation === gitRequestGeneration.current) {
        setError('changes.loadFailed')
      }
    } finally {
      if (generation === gitRequestGeneration.current) setLoadingGit(false)
    }
  }, [client])

  useEffect(() => {
    void loadChangesets(false)
  }, [loadChangesets, bootstrapVersion])

  useEffect(() => {
    gitRequestGeneration.current += 1
    setGitFiles([])
    setSelectedGitFile('')
    setSelectedFilesForDelivery(new Set())
    void loadGitDiff()
  }, [loadGitDiff, state.workspace?.path])

  useEffect(() => {
    setSelectedId((current) =>
      state.operational.changes.some((item) => item.changesetId === current)
        ? current
        : state.operational.changes[0]?.changesetId ?? '',
    )
  }, [state.operational.changes])

  useEffect(() => {
    setPath('')
    setError(null)
  }, [state.selectedSession?.id])

  // Initialize once per session, allowing late metadata without overwriting edits.
  useEffect(() => {
    const draft = deliveryDraft.current
    if (draft.sessionId !== sessionId) {
      draft.sessionId = sessionId
      draft.titleInitialized = false
      draft.titleEdited = false
      setDeliveryTitle('')
      setDeliveryDescription(null)
    }
    if (sessionTitle && !draft.titleInitialized) {
      draft.titleInitialized = true
      if (!draft.titleEdited) setDeliveryTitle(`feat(${sessionMode}): ${sessionTitle}`)
    }
  }, [sessionId, sessionTitle, sessionMode])

  const inspect = async (overridePath?: string): Promise<void> => {
    const targetPath = (overridePath ?? path).trim()
    if (!client || loading || !selectedId || !targetPath) return
    setLoading(true)
    setError(null)
    try {
      await client.inspectChange(selectedId, targetPath, 0, 65_536)
    } catch {
      setError('changes.inspectFailed')
    } finally {
      setLoading(false)
    }
  }

  const handleRevertFile = async (filePath: string): Promise<void> => {
    if (!client?.revertGitDiff) return
    const targetFile = gitFiles.find((f) => f.filePath === filePath)
    const isUntracked = targetFile?.status === 'untracked'
    const confirmMessage = isUntracked
      ? t('workspace.discardUntrackedConfirm')
      : t('workspace.discardConfirm')
    if (!window.confirm(confirmMessage)) return

    try {
      const res = await client.revertGitDiff(filePath)
      const data = res?.payload as { success?: boolean; checkpointId?: string | null } | undefined
      if (data?.success !== true) {
        setError('changes.revertFailed')
        return
      }
      if (data?.checkpointId) {
        setLastUndoCheckpoint({ checkpointId: data.checkpointId, filePath })
      }
      await loadGitDiff()
    } catch {
      setError('changes.revertFailed')
    }
  }

  const handleRevertHunk = async (filePath: string, hunkIndex: number): Promise<void> => {
    if (!client?.revertGitDiff) return
    if (!window.confirm(t('workspace.discardHunkConfirm'))) return

    try {
      const res = await client.revertGitDiff(filePath, hunkIndex)
      const data = res?.payload as { success?: boolean; checkpointId?: string | null } | undefined
      if (data?.success !== true) {
        setError('changes.revertFailed')
        return
      }
      if (data?.checkpointId) {
        setLastUndoCheckpoint({ checkpointId: data.checkpointId, filePath })
      }
      await loadGitDiff()
    } catch {
      setError('changes.revertFailed')
    }
  }

  const handleUndoRevert = async (): Promise<void> => {
    if (!client?.undoGitRevert || !lastUndoCheckpoint) return
    try {
      const res = await client.undoGitRevert(lastUndoCheckpoint.checkpointId)
      const data = res?.payload as { success?: boolean; error?: string } | undefined
      if (data?.success) {
        setLastUndoCheckpoint(null)
        await loadGitDiff()
      } else {
        setError('changes.undoFailed')
      }
    } catch {
      setError('changes.undoFailed')
    }
  }

  const handleDeliver = async (): Promise<void> => {
    if (
      !client?.deliverGitChanges ||
      !deliveryTitle.trim() ||
      delivering ||
      selectedFilesForDelivery.size === 0
    )
      return
    setDelivering(true)
    setError(null)
    try {
      if (commitOnNewBranch && gitClient && gitBranch?.branch === gitBranch?.defaultBranch) {
        let failed: string | undefined
        try {
          const made = await gitClient.createGitBranch(newBranchName.trim() || branchFromTitle(deliveryTitle))
          failed = (made.payload as { error?: string }).error
          if (!failed) {
            setGitBranch((made.payload as { status?: GitStatus }).status ?? null)
            setCommitOnNewBranch(false)
          }
        } catch (reason) {
          failed = reason instanceof Error ? reason.message : String(reason)
        }
        if (failed) {
          setError(gitErrorKey(failed))
          return
        }
      }
      const selectedList = Array.from(selectedFilesForDelivery)
      const res = await client.deliverGitChanges(
        deliveryTitle.trim(),
        effectiveDeliveryDescription.trim(),
        false,
        selectedList,
      )
      const data = res.payload as {
        commitSha: string | null
        branch: string
        summary: string
        success: boolean
      }
      if (data.success) {
        setDeliveryResult({
          commitSha: data.commitSha,
          branch: data.branch,
          summary: data.summary,
        })
        await loadGitDiff()
      } else {
        setError('changes.deliveryFailed')
      }
    } catch {
      setError('changes.deliveryFailed')
    } finally {
      setDelivering(false)
    }
  }

  const selectedChangeset = useMemo(
    () => state.operational.changes.find((c) => c.changesetId === selectedId),
    [state.operational.changes, selectedId],
  )

  const activeGitFileDiff = useMemo(
    () => gitFiles.find((f) => f.filePath === selectedGitFile),
    [gitFiles, selectedGitFile],
  )

  // Expand all hunks by default for active file
  useEffect(() => {
    if (activeGitFileDiff) {
      setExpandedHunks(new Set(activeGitFileDiff.hunks.map((h) => h.hunkIndex)))
    }
  }, [activeGitFileDiff])

  // One object per client: the checks page reads the settings again whenever it changes.
  const projectClient = useMemo<ProjectClient | null>(() => (
    client?.projectSettings && client.saveProjectSettings && client.trustProjectSettings && client.runProjectChecks
      ? {
          projectSettings: client.projectSettings.bind(client),
          saveProjectSettings: client.saveProjectSettings.bind(client),
          trustProjectSettings: client.trustProjectSettings.bind(client),
          runProjectChecks: client.runProjectChecks.bind(client),
        }
      : null
  ), [client])

  const gitClient = useMemo<GitClient | null>(() => {
    const names = ['gitStatus', 'createGitBranch', 'switchGitBranch', 'takeConflictSide', 'markConflictResolved', 'finishGitOperation', 'ciRuns', 'ciLog', 'gitIssues', 'gitIssue'] as const
    if (!client || !names.every((name) => typeof client[name] === 'function')) return null
    return Object.fromEntries(names.map((name) => [name, (client[name] as (...args: never[]) => unknown).bind(client)])) as unknown as GitClient
  }, [client])

  const askConversation = client?.startTurn
    ? async (prompt: string): Promise<boolean> => {
      try {
        await client.startTurn!(prompt)
        return true
      } catch {
        return false
      }
    }
    : undefined

  // The branch, for the commit form: on the default branch it offers a new one.
  const [gitBranch, setGitBranch] = useState<GitStatus | null>(null)
  const [commitOnNewBranch, setCommitOnNewBranch] = useState(false)
  const [newBranchName, setNewBranchName] = useState('')
  const [writingMessage, setWritingMessage] = useState(false)
  const [messageError, setMessageError] = useState<MessageKey | null>(null)
  useEffect(() => {
    if (activeTab !== 'working_tree' || !gitClient || gitFiles.length === 0) return
    let current = true
    void gitClient.gitStatus().then((reply) => {
      const next = (reply.payload as { status?: GitStatus }).status ?? null
      if (!current) return
      setGitBranch(next)
      setCommitOnNewBranch(Boolean(next?.branch && next.branch === next.defaultBranch))
    }, () => undefined)
    return () => {
      current = false
    }
  }, [activeTab, gitClient, gitFiles.length])

  const writeMessage = async (): Promise<void> => {
    if (!client?.writeCommitMessage || writingMessage || selectedFilesForDelivery.size === 0) return
    setWritingMessage(true)
    setMessageError(null)
    try {
      const reply = await client.writeCommitMessage(Array.from(selectedFilesForDelivery), locale)
      const message = (reply.payload as { message?: { title?: string; body?: string } }).message
      if (message?.title) {
        deliveryDraft.current.titleEdited = true
        setDeliveryTitle(message.title)
        setDeliveryDescription(message.body ?? '')
      }
    } catch (reason) {
      const code = reason instanceof Error ? reason.message : String(reason)
      setMessageError(code === 'provider_unconfigured' ? 'review.aiNoProvider' : code === 'nothing_to_commit' ? 'changes.noFilesSelected' : 'git.error.message')
    } finally {
      setWritingMessage(false)
    }
  }

  const totalAdditions = useMemo(() => gitFiles.reduce((acc, f) => acc + f.additions, 0), [gitFiles])
  const totalDeletions = useMemo(() => gitFiles.reduce((acc, f) => acc + f.deletions, 0), [gitFiles])

  return (
    <main className="route-column reading-surface changes-route" aria-label={t('workbench.changes')}>
      <header className="route-header">
        <div>
          <p className="section-kicker">{t('changes.session')}</p>
          <h1 tabIndex={-1}>{t('workbench.changes')}</h1>
        </div>
        <div className="changes-view-tabs" role="tablist">
          {client?.getGitDiff ? (
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'working_tree'}
              className={`sub-tab-btn ${activeTab === 'working_tree' ? 'active' : ''}`}
              onClick={() => setActiveTab('working_tree')}
            >
              <GitCompare size={13} />
              <span>{t('changes.workingTree')}</span>
              {gitFiles.length > 0 ? <span className="tab-badge">{gitFiles.length}</span> : null}
            </button>
          ) : null}
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'changesets'}
            className={`sub-tab-btn ${activeTab === 'changesets' ? 'active' : ''}`}
            onClick={() => setActiveTab('changesets')}
          >
            <History size={13} />
            <span>{t('changes.changesets')}</span>
            {state.operational.changes.length > 0 ? (
              <span className="tab-badge">{state.operational.changes.length}</span>
            ) : null}
          </button>
          {client?.listReviewSnapshots ? (
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'review'}
              className={`sub-tab-btn ${activeTab === 'review' ? 'active' : ''}`}
              onClick={() => setActiveTab('review')}
            >
              <ShieldCheck size={13} />
              <span>{t('changes.review')}</span>
            </button>
          ) : null}
          {client?.projectSettings ? (
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'checks'}
              className={`sub-tab-btn ${activeTab === 'checks' ? 'active' : ''}`}
              onClick={() => setActiveTab('checks')}
            >
              <ListChecks size={13} />
              <span>{t('changes.checksTab')}</span>
              {state.checks?.running ? <Loader2 size={11} className="spin-animation" aria-hidden="true" /> : null}
            </button>
          ) : null}
          {gitClient ? (
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'git'}
              className={`sub-tab-btn ${activeTab === 'git' ? 'active' : ''}`}
              onClick={() => setActiveTab('git')}
            >
              <GitBranch size={13} />
              <span>{t('git.tab')}</span>
            </button>
          ) : null}
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label={t('changes.refresh')}
          title={t('changes.refresh')}
          disabled={!client || !state.selectedSession}
          onClick={() => {
            void loadChangesets()
            void loadGitDiff()
          }}
        >
          <RefreshCw size={15} />
        </button>
      </header>

      <div className="changes-content">
      {error ? (
        <p role="status" className="route-error">
          {translate(locale, error)}
        </p>
      ) : null}

      {lastUndoCheckpoint ? (
        <aside className="undo-checkpoint-banner" role="status" aria-live="polite">
          <div className="undo-checkpoint-info">
            <Undo2 size={15} />
            <span>{t('changes.revertedFileNotice', { path: lastUndoCheckpoint.filePath })}</span>
          </div>
          <div className="undo-checkpoint-actions">
            <button
              type="button"
              className="text-btn undo-action-btn"
              onClick={() => void handleUndoRevert()}
            >
              {t('changes.undoRevert')}
            </button>
            <button
              type="button"
              className="icon-button undo-dismiss-btn"
              aria-label={t('workbench.dismiss')}
              onClick={() => setLastUndoCheckpoint(null)}
            >
              ×
            </button>
          </div>
        </aside>
      ) : null}

      {/* WORKING TREE DIFF VIEW */}
      {activeTab === 'working_tree' && client?.getGitDiff ? (
        <div className="route-content operational-split">
          <section className="route-section">
            <header>
              <div>
                <h2>{t('changes.changedFiles')}</h2>
                <span>
                  {t('changes.stats', {
                    files: gitFiles.length,
                    add: totalAdditions,
                    del: totalDeletions,
                  })}
                </span>
              </div>
            </header>

            {gitFiles.length > 0 ? (
              <div className="file-selection-controls">
                <button
                  type="button"
                  className="text-btn"
                  onClick={() => setSelectedFilesForDelivery(new Set(gitFiles.map((f) => f.filePath)))}
                >
                  {t('changes.selectAll')}
                </button>
                <button
                  type="button"
                  className="text-btn"
                  onClick={() => setSelectedFilesForDelivery(new Set())}
                >
                  {t('changes.deselectAll')}
                </button>
                <span className="selection-count">
                  {t('changes.selectedCount', {
                    selected: selectedFilesForDelivery.size,
                    total: gitFiles.length,
                  })}
                </span>
              </div>
            ) : null}

            <div className="route-list" role="list">
              {gitFiles.map((file) => (
                <div role="listitem" key={file.filePath} className="git-file-item">
                  <input
                    type="checkbox"
                    aria-label={t('changes.selectFileForDelivery', { path: file.filePath })}
                    checked={selectedFilesForDelivery.has(file.filePath)}
                    onChange={(e) => {
                      setSelectedFilesForDelivery((prev) => {
                        const next = new Set(prev)
                        if (e.target.checked) next.add(file.filePath)
                        else next.delete(file.filePath)
                        return next
                      })
                    }}
                  />
                  <button
                    type="button"
                    className="route-list-row"
                    aria-pressed={selectedGitFile === file.filePath}
                    onClick={() => {
                      setSelectedGitFile(file.filePath)
                      setExpandedHunks(new Set(file.hunks.map((h) => h.hunkIndex)))
                    }}
                  >
                    <FileDiff size={15} />
                    <span className="git-file-info">
                      <strong>{file.filePath}</strong>
                      <small className="git-stat">
                        <span className="stat-add">+{file.additions}</span>
                        <span className="stat-del">-{file.deletions}</span>
                      </small>
                    </span>
                    <span className={`status-tag status-${file.status}`}>{localizeKnownStatus(locale, file.status)}</span>
                  </button>
                  <button
                    type="button"
                    className="icon-button-small"
                    title={t('changes.discardFile')}
                    aria-label={t('changes.discardFile')}
                    onClick={() => void handleRevertFile(file.filePath)}
                  >
                    <Undo2 size={13} />
                  </button>
                </div>
              ))}
            </div>

            {!isGitRepo ? (
              <p className="route-note warning">{t('changes.notGitRepository')}</p>
            ) : gitFiles.length === 0 && !loadingGit ? (
              <p className="route-note">{t('changes.noWorkingTreeChanges')}</p>
            ) : null}

            {/* Delivery / PR Section */}
            {gitFiles.length > 0 ? (
              <div className="delivery-card">
                <h3>
                  <UploadCloud size={14} />
                  <span>{t('changes.deliveryTitle')}</span>
                  {client?.writeCommitMessage ? (
                    <button
                      type="button"
                      className="text-btn commit-write-message"
                      disabled={writingMessage || selectedFilesForDelivery.size === 0}
                      aria-busy={writingMessage}
                      onClick={() => void writeMessage()}
                    >
                      {writingMessage ? <Loader2 size={12} className="spin-animation" /> : <Sparkles size={12} />}
                      {writingMessage ? t('git.writingMessage') : t('git.writeMessage')}
                    </button>
                  ) : null}
                </h3>
                {messageError ? <p className="route-note warning">{t(messageError)}</p> : null}
                {gitBranch?.branch && gitBranch.branch === gitBranch.defaultBranch ? (
                  <div className="commit-new-branch">
                    <label className="git-check">
                      <input type="checkbox" checked={commitOnNewBranch} onChange={(event) => setCommitOnNewBranch(event.target.checked)} />
                      {t('git.commitOnNewBranch', { branch: gitBranch.branch })}
                    </label>
                    {commitOnNewBranch ? (
                      <input
                        type="text"
                        aria-label={t('git.newBranch')}
                        placeholder={branchFromTitle(deliveryTitle)}
                        value={newBranchName}
                        onChange={(event) => setNewBranchName(event.target.value)}
                      />
                    ) : null}
                  </div>
                ) : null}
                <input
                  type="text"
                  aria-label={t('changes.commitTitle')}
                  placeholder={t('changes.commitTitlePlaceholder')}
                  value={deliveryTitle}
                  onChange={(e) => {
                    deliveryDraft.current.titleEdited = true
                    setDeliveryTitle(e.target.value)
                  }}
                />
                <textarea
                  aria-label={t('changes.commitDesc')}
                  placeholder={t('changes.commitDescPlaceholder')}
                  value={effectiveDeliveryDescription}
                  onChange={(e) => setDeliveryDescription(e.target.value)}
                  rows={2}
                />
                <button
                  type="button"
                  className="delivery-btn"
                  disabled={delivering || !deliveryTitle.trim() || selectedFilesForDelivery.size === 0}
                  onClick={() => void handleDeliver()}
                >
                  <GitCommit size={14} />
                  <span>{delivering ? t('changes.delivering') : t('changes.deliverCommit')}</span>
                </button>
                {selectedFilesForDelivery.size === 0 ? (
                  <p className="route-note warning" style={{ marginTop: '6px' }}>
                    {t('changes.noFilesSelected')}
                  </p>
                ) : null}
                {deliveryResult ? (
                  <div className="delivery-success">
                    <Check size={14} />
                    <span>
                      {t('changes.deliveredOnBranch', {
                        branch: deliveryResult.branch,
                        sha: deliveryResult.commitSha ?? '',
                      })}
                    </span>
                  </div>
                ) : null}
              </div>
            ) : null}
          </section>

          {/* Hunk Review & Diff Section */}
          <section className="route-section hunk-review-section">
            <header>
              <div>
                <h2>{selectedGitFile || t('changes.inspect')}</h2>
                <span>
                  {activeGitFileDiff
                    ? t('changes.hunksCount', { count: activeGitFileDiff.hunks.length, summary: activeGitFileDiff.summary })
                    : t('changes.boundedArtifact')}
                </span>
              </div>
            </header>

            {activeGitFileDiff ? (
              <div className="hunk-list">
                {activeGitFileDiff.hunks.map((hunk) => {
                  const isExpanded = expandedHunks.has(hunk.hunkIndex)
                  return (
                    <div key={hunk.hunkIndex} className="hunk-block">
                      <div className="hunk-header">
                        <button
                          type="button"
                          className="hunk-toggle"
                          onClick={() => {
                            setExpandedHunks((prev) => {
                              const next = new Set(prev)
                              if (next.has(hunk.hunkIndex)) next.delete(hunk.hunkIndex)
                              else next.add(hunk.hunkIndex)
                              return next
                            })
                          }}
                        >
                          {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                          <code>{hunk.header}</code>
                        </button>
                        <button
                          type="button"
                          className="hunk-discard-btn"
                          aria-label={t('changes.discardHunk')}
                          title={t('changes.discardHunk')}
                          onClick={() => void handleRevertHunk(activeGitFileDiff.filePath, hunk.hunkIndex)}
                        >
                          <Undo2 size={12} />
                          <span>{t('changes.discardHunk')}</span>
                        </button>
                        {client?.startTurn && sessionId ? (
                          <button
                            type="button"
                            className="hunk-discard-btn"
                            aria-expanded={commenting === `:${hunk.hunkIndex}`}
                            onClick={() => setCommenting((current) => current === `:${hunk.hunkIndex}` ? null : `:${hunk.hunkIndex}`)}
                          >
                            <MessageSquare size={12} />
                            <span>{t('changes.commentHunk')}</span>
                          </button>
                        ) : null}
                      </div>
                      {commenting === `:${hunk.hunkIndex}` && client?.startTurn ? (
                        <HunkComment
                          onCancel={() => setCommenting(null)}
                          onSend={async (comment) => {
                            try {
                              await client.startTurn!(t('changes.askAbout', { path: activeGitFileDiff.filePath, diff: hunkText(hunk), comment }))
                              setCommenting(null)
                              return true
                            } catch {
                              return false
                            }
                          }}
                        />
                      ) : null}

                      {isExpanded ? (
                        <div className="hunk-lines" role="region" tabIndex={0} aria-label={t('changes.hunkLines', { header: hunk.header })}>
                          {hunk.lines.map((l, idx) => (
                            <div key={idx} className={`hunk-line hunk-line-${l.kind}`}>
                              <span className="line-num old-num">{l.oldLineno ?? ''}</span>
                              <span className="line-num new-num">{l.newLineno ?? ''}</span>
                              <span className="line-kind">
                                {l.kind === 'add' ? '+' : l.kind === 'delete' ? '-' : ' '}
                              </span>
                              <pre className="line-code">{l.content}</pre>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            ) : (
              <p className="route-note">{t('changes.selectFileToReview')}</p>
            )}
          </section>
        </div>
      ) : null}

      {/* SESSION CHANGESETS VIEW (Durable Audit) */}
      {activeTab === 'review' && client?.listReviewSnapshots ? (
        <ReviewWorkspace state={state} client={client} />
      ) : null}

      {activeTab === 'checks' && projectClient ? <ProjectChecks state={state} client={projectClient} /> : null}

      {activeTab === 'git' && gitClient ? (
        <GitPanel client={gitClient} onAsk={askConversation} onOpenFile={(file) => openWorkspaceFile(file)} />
      ) : null}

      {/* SESSION CHANGESETS VIEW (Durable Audit) */}
      {activeTab === 'changesets' || (!client?.getGitDiff && activeTab !== 'review' && activeTab !== 'checks' && activeTab !== 'git') ? (
        <div className="route-content operational-split">
          <section className="route-section">
            <header>
              <div>
                <h2>{t('changes.changesets')}</h2>
                <span>{t('changes.durableRecords')}</span>
              </div>
            </header>
            <div className="route-list" role="list">
              {state.operational.changes.map((item) => (
                <div role="listitem" key={item.changesetId}>
                  <button
                    type="button"
                    className="route-list-row"
                    aria-pressed={selectedId === item.changesetId}
                    onClick={() => setSelectedId(item.changesetId)}
                  >
                    <FileDiff size={15} />
                    <span>
                      <strong>{item.changesetId.slice(0, 12)}</strong>
                      <small>{t('changes.count', { count: item.changeCount })}</small>
                    </span>
                    <span className="route-list-state">
                      {localizeKnownStatus(locale, item.state)}
                    </span>
                  </button>

                  {/* Auto-discovered changed files list in changeset */}
                  {selectedId === item.changesetId &&
                  Array.isArray((item as { files?: Array<{ path: string; kind: string }> }).files) ? (
                    <div className="changeset-files-sublist">
                      {(item as { files?: Array<{ path: string; kind: string }> }).files?.map(
                        (f) => (
                          <button
                            key={f.path}
                            type="button"
                            className="changeset-file-pill"
                            onClick={() => {
                              setPath(f.path)
                              void inspect(f.path)
                            }}
                          >
                            <span>{f.path}</span>
                            <small>{f.kind}</small>
                          </button>
                        ),
                      )}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
            {state.operational.changes.length === 0 ? (
              <p className="route-note">{t('changes.noDurable')}</p>
            ) : null}
          </section>

          <section className="route-section">
            <header>
              <div>
                <h2>{t('changes.inspect')}</h2>
                <span>{t('changes.boundedArtifact')}</span>
              </div>
            </header>
            <div className="inspect-controls">
              <input
                type="text"
                aria-label={t('changes.path')}
                value={path}
                onChange={(event) => setPath(event.target.value)}
                placeholder="src/file.ts"
              />
              <button
                type="button"
                aria-label={t('changes.inspectAction')}
                aria-busy={loading}
                disabled={!client || loading || !selectedId || !path.trim()}
                onClick={() => void inspect()}
              >
                <Search size={14} />
                {t('changes.inspect')}
              </button>
            </div>
            <ChangeDetail detail={state.operational.selectedChange} />
          </section>
        </div>
      ) : null}
      </div>
    </main>
  )
}

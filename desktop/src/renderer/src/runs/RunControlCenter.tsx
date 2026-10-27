import {
  AlertTriangle,
  Check,
  Copy,
  ChevronRight,
  CircleDot,
  GitBranch,
  Inbox,
  Eye,
  FolderOpen,
  FileSearch,
  History,
  ListChecks,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Play,
  RotateCcw,
  Square,
  ShieldCheck,
  Trash2,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { WorkbenchBridgeClient } from '../bridge/client'
import { useText } from '../i18n/I18nProvider'
import type { WorkbenchState } from '../state/workbench-store'
import { SafeMarkdown } from '../markdown/SafeMarkdown'
import { ModelContextDetails, type ModelContextManifest, type ModelUsage } from '../inspector/ModelContextDetails'
import { RunDetailsPage, type RunPhaseView } from './RunDetailsPage'
import { CollaborationOverview } from './CollaborationOverview'
import { FOCUS_RUN_EVENT, takeRunFocus } from './focus-run'

export interface AgentRunView {
  id: string
  sessionId: string
  title: string
  goal: string
  state: string
  isolation: 'shared' | 'worktree'
  parentRunId?: string | null
  checkoutPath: string | null
  branch: string | null
  activeStepId: string | null
  blockingReason: string | null
  pauseRequested?: boolean
  completedSteps: number
  totalSteps: number
  progress: number
  updatedAt: string
}

export interface PlanStepView {
  id: string
  runId: string
  title: string
  detail: string
  acceptance: string
  state: string
  position: number
  dependencies: string[]
  evidence: string[]
}

export interface AttentionView {
  id: string
  runId: string | null
  sessionId: string | null
  kind: string
  severity: string
  title: string
  detail: string
  state: string
  action?: Record<string, unknown>
}

type RunClient = Pick<
  WorkbenchBridgeClient,
  | 'listAgentRuns'
  | 'getAgentRun'
  | 'createAgentRun'
  | 'updateAgentRun'
  | 'startAgentRun'
  | 'pauseAgentRun'
  | 'resumeAgentRun'
  | 'cancelAgentRun'
  | 'cleanupAgentRun'
  | 'createPlanStep'
  | 'updatePlanStep'
  | 'deletePlanStep'
  | 'listAttention'
  | 'resolveAttention'
> & Partial<Pick<WorkbenchBridgeClient, 'createReviewSnapshot' | 'openWorkspacePath' | 'getRunHistory' | 'getRunEvidence'>>

function arrayPayload<T>(payload: unknown, key: string): T[] {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return []
  const value = (payload as Record<string, unknown>)[key]
  return Array.isArray(value) ? (value as T[]) : []
}

function runPayload(payload: unknown): AgentRunView | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  const value = (payload as Record<string, unknown>).run
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as AgentRunView)
    : null
}

const ACTIVE_STATES = new Set(['queued', 'starting', 'running'])
interface ExecutionHistoryItem { role: 'user' | 'assistant'; content: string; sequence: number; truncated: boolean }
interface ExecutionDetails { resultText?: string; resultTruncated?: boolean; autonomy?: string | null; history?: ExecutionHistoryItem[]; manifest?: ModelContextManifest | null; lastUsage?: ModelUsage | null; phases?: RunPhaseView[] }
interface RunHistoryItem { eventId?: string; type: string; domainSequence?: number; createdAt?: string; data?: Record<string, unknown> }
interface RunEvidenceItem { stepId?: string; stepTitle?: string; index?: number; evidence?: string }
interface RunPage<T> { runId: string | null; items: T[]; loaded: boolean; hasMore: boolean; nextCursor: string | null }

function emptyRunPage<T>(runId: string | null = null): RunPage<T> {
  return { runId, items: [], loaded: false, hasMore: false, nextCursor: null }
}

function pagePayload<T>(payload: unknown): Pick<RunPage<T>, 'items' | 'hasMore' | 'nextCursor'> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { items: [], hasMore: false, nextCursor: null }
  }
  const value = payload as Record<string, unknown>
  const nextCursor = typeof value.nextCursor === 'string' ? value.nextCursor : null
  return {
    items: Array.isArray(value.items) ? value.items as T[] : [],
    hasMore: value.hasMore === true && nextCursor !== null,
    nextCursor,
  }
}

function historyItemText(item: RunHistoryItem): string {
  const data = item.data ?? {}
  for (const key of ['text', 'content', 'reason', 'reasoning', 'error', 'result']) {
    if (typeof data[key] === 'string') return data[key] as string
  }
  return Object.keys(data).length > 0 ? JSON.stringify(data, null, 2) : item.type
}

export function RunControlCenter({
  state,
  client,
}: {
  state: WorkbenchState
  client?: RunClient
}) {
  const tx = useText()
  const [runs, setRuns] = useState<AgentRunView[]>([])
  const [attention, setAttention] = useState<AttentionView[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [steps, setSteps] = useState<PlanStepView[]>([])
  const [execution, setExecution] = useState<ExecutionDetails>({})
  const [runHistory, setRunHistory] = useState<RunPage<RunHistoryItem>>(emptyRunPage)
  const [runEvidence, setRunEvidence] = useState<RunPage<RunEvidenceItem>>(emptyRunPage)
  const [goal, setGoal] = useState('')
  const [title, setTitle] = useState('')
  const [isolation, setIsolation] = useState<'auto' | 'shared' | 'worktree'>('auto')
  // Off: the task is created as a draft so its steps can be planned before it starts.
  const [startNow, setStartNow] = useState(true)
  const [parentRunIdDraft, setParentRunIdDraft] = useState<string | null>(null)
  const [stepTitle, setStepTitle] = useState('')
  const [stepAcceptance, setStepAcceptance] = useState('')
  const [addingStep, setAddingStep] = useState(false)
  const goalInput = useRef<HTMLTextAreaElement | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [loadingEvidence, setLoadingEvidence] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const generation = useRef(0)
  const selectedIdRef = useRef<string | null>(null)
  const loadingRequest = useRef<number | null>(null)
  const pageGeneration = useRef(0)
  const workspaceKey = String(state.workspace?.path ?? '') + ':' + state.runtime.epoch

  const sessionId =
    typeof state.selectedSession?.id === 'string' && state.selectedSession.id
      ? state.selectedSession.id
      : null
  const workspaceReady = state.workspace !== null

  const load = useCallback(async (silent = false) => {
    if (silent && loadingRequest.current !== null) return
    const request = ++generation.current
    loadingRequest.current = request
    if (!client || !workspaceReady) {
      setRuns([])
      setAttention([])
      setSteps([])
      loadingRequest.current = null
      return
    }
    if (!silent) {
      setLoading(true)
      setError(null)
    }
    try {
      const [runsReply, attentionReply] = await Promise.all([
        client.listAgentRuns({ limit: 200 }),
        client.listAttention({ state: 'open', limit: 500 }),
      ])
      if (request !== generation.current) return
      const nextRuns = arrayPayload<AgentRunView>(runsReply.payload, 'runs')
      setRuns(nextRuns)
      setAttention(arrayPayload<AttentionView>(attentionReply.payload, 'items'))
      const currentId = selectedIdRef.current
      const nextSelected =
        currentId && nextRuns.some((run) => run.id === currentId)
          ? currentId
          : nextRuns[0]?.id ?? null
      if (currentId !== nextSelected) {
        pageGeneration.current += 1
        setRunHistory(emptyRunPage(nextSelected))
        setRunEvidence(emptyRunPage(nextSelected))
        setLoadingHistory(false)
        setLoadingEvidence(false)
      }
      setSelectedId(nextSelected)
      selectedIdRef.current = nextSelected
      if (nextSelected && nextSelected !== currentId) setAddingStep(false)
      if (nextSelected) {
        const detail = await client.getAgentRun(nextSelected)
        if (request === generation.current && selectedIdRef.current === nextSelected) {
          setSteps(arrayPayload<PlanStepView>(detail.payload, 'steps'))
          setExecution(detail.payload as ExecutionDetails)
        }
      } else {
        setSteps([])
      }
    } catch (reason) {
      if (request === generation.current) {
        setError(reason instanceof Error ? reason.message : tx('Unable to load agent runs'))
      }
    } finally {
      if (loadingRequest.current === request) loadingRequest.current = null
      if (request === generation.current) setLoading(false)
    }
  }, [client, workspaceKey, workspaceReady])

  useEffect(() => {
    selectedIdRef.current = null
    setSelectedId(null)
    setRuns([])
    setSteps([])
    setExecution({})
    setAttention([])
    pageGeneration.current += 1
    setRunHistory(emptyRunPage())
    setRunEvidence(emptyRunPage())
    setLoadingHistory(false)
    setLoadingEvidence(false)
    void load()
    return () => {
      generation.current += 1
    }
  }, [load])

  useEffect(() => {
    if (!client || !workspaceReady) return
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load(true)
    }, 2_000)
    return () => window.clearInterval(timer)
  }, [client, load, workspaceReady])

  useEffect(() => {
    // A sub-agent chip in a conversation opens its run here.
    const focus = (runId: string): void => {
      selectedIdRef.current = runId
      void load()
    }
    const pending = takeRunFocus()
    if (pending) focus(pending)
    const listener = (event: Event): void => {
      const runId = (event as CustomEvent<unknown>).detail
      if (typeof runId === 'string') focus(runId)
    }
    window.addEventListener(FOCUS_RUN_EVENT, listener)
    return () => window.removeEventListener(FOCUS_RUN_EVENT, listener)
  }, [load])

  const selected = useMemo(
    () => runs.find((run) => run.id === selectedId) ?? null,
    [runs, selectedId],
  )
  // Sub-agents are listed under the task they belong to.
  const orderedRuns = useMemo(() => {
    const known = new Set(runs.map((run) => run.id))
    const children = new Map<string, AgentRunView[]>()
    for (const run of runs) {
      if (run.parentRunId && known.has(run.parentRunId)) {
        children.set(run.parentRunId, [...(children.get(run.parentRunId) ?? []), run])
      }
    }
    const ordered: Array<{ run: AgentRunView; depth: number }> = []
    const placed = new Set<string>()
    const visit = (run: AgentRunView, depth: number): void => {
      if (placed.has(run.id)) return
      placed.add(run.id)
      ordered.push({ run, depth })
      for (const child of children.get(run.id) ?? []) visit(child, Math.min(depth + 1, 2))
    }
    for (const run of runs) {
      if (!run.parentRunId || !known.has(run.parentRunId)) visit(run, 0)
    }
    for (const run of runs) visit(run, 0) // anything left over (a broken parent chain)
    return ordered
  }, [runs])
  const activeCount = runs.filter((run) => ACTIVE_STATES.has(run.state)).length
  const blockedCount = runs.filter((run) => run.state === 'needs_attention').length

  const selectRun = async (runId: string) => {
    const request = ++generation.current
    if (selectedIdRef.current !== runId) setAddingStep(false) // reloading the same run keeps the step form open
    selectedIdRef.current = runId
    setSelectedId(runId)
    setSteps([])
    setExecution({})
    pageGeneration.current += 1
    setRunHistory(emptyRunPage(runId))
    setRunEvidence(emptyRunPage(runId))
    setLoadingHistory(false)
    setLoadingEvidence(false)
    setLoading(false)
    if (!client) return
    setError(null)
    try {
      const detail = await client.getAgentRun(runId)
      if (request !== generation.current || selectedIdRef.current !== runId) return
      setSteps(arrayPayload<PlanStepView>(detail.payload, 'steps'))
      setExecution(detail.payload as ExecutionDetails)
    } catch (reason) {
      if (request !== generation.current) return
      setError(reason instanceof Error ? reason.message : tx('Unable to load run details'))
    }
  }

  const createRun = async () => {
    const normalizedGoal = goal.trim()
    if (!client || !sessionId || !normalizedGoal || saving) return
    setSaving(true)
    setError(null)
    try {
      const parentRun = parentRunIdDraft ? runs.find((item) => item.id === parentRunIdDraft) ?? null : null
      const reply = await client.createAgentRun({
        goal: normalizedGoal,
        title: title.trim() || (parentRun ? `Subagent: ${parentRun.title}` : undefined),
        isolation,
        sessionId,
        parentRunId: parentRunIdDraft ?? undefined,
      })
      const created = runPayload(reply.payload)
      setGoal('')
      setTitle('')
      setParentRunIdDraft(null)
      if (created && startNow) {
        await client.startAgentRun(created.id)
        selectedIdRef.current = created.id
        await load()
      } else if (created) {
        generation.current += 1
        selectedIdRef.current = created.id
        setRuns((current) => [created, ...current.filter((run) => run.id !== created.id)])
        setSelectedId(created.id)
        setSteps([])
        setExecution({})
        pageGeneration.current += 1
        setRunHistory(emptyRunPage(created.id))
        setRunEvidence(emptyRunPage(created.id))
        setLoadingHistory(false)
        setLoadingEvidence(false)
      } else {
        await load()
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : tx('Unable to create agent run'))
    } finally {
      setSaving(false)
    }
  }

  const addStep = async () => {
    if (!client || !selected || !stepTitle.trim() || saving) return
    setSaving(true)
    setError(null)
    try {
      await client.createPlanStep(selected.id, {
        title: stepTitle.trim(),
        acceptance: stepAcceptance.trim(),
        position: steps.length,
      })
      setStepTitle('')
      setStepAcceptance('')
      await selectRun(selected.id)
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : tx('Unable to save plan step'))
    } finally {
      setSaving(false)
    }
  }

  const setStepState = async (step: PlanStepView, nextState: string) => {
    if (!client) return
    setError(null)
    try {
      await client.updatePlanStep(step.id, { state: nextState })
      await selectRun(step.runId)
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : tx('Unable to update plan step'))
    }
  }

  const removeStep = async (step: PlanStepView) => {
    if (!client) return
    try {
      await client.deletePlanStep(step.id)
      await selectRun(step.runId)
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : tx('Unable to delete plan step'))
    }
  }

  const resolveItem = async (item: AttentionView) => {
    if (!client) return
    try {
      await client.resolveAttention(item.id, { acknowledged: true })
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : tx('Unable to resolve attention item'))
    }
  }

  const reviewRun = async (): Promise<void> => {
    if (!client?.createReviewSnapshot || !selected || saving) return
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      await client.createReviewSnapshot({ runId: selected.id })
      setNotice(tx('Review snapshot captured.'))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : tx('Unable to capture review snapshot'))
    } finally {
      setSaving(false)
    }
  }

  const retryBranch = async (): Promise<void> => {
    if (!client || !selected || saving || !['failed', 'needs_attention'].includes(selected.state)) return
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      const reply = await client.createAgentRun({
        goal: selected.goal,
        title: `Retry: ${selected.title}`,
        isolation: selected.isolation,
        sessionId: selected.sessionId,
        parentRunId: selected.id,
      })
      const created = runPayload(reply.payload)
      if (!created) throw new Error(tx('Retry branch was not created'))
      await client.startAgentRun(created.id)
      setNotice(tx('Retry branch started.'))
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : tx('Unable to retry branch'))
    } finally {
      setSaving(false)
    }
  }

  const openRunWorkspace = async (): Promise<void> => {
    if (!client?.openWorkspacePath || !selected?.checkoutPath || saving) return
    setError(null)
    setNotice(null)
    try {
      const opened = await client.openWorkspacePath(selected.checkoutPath)
      if (!opened) throw new Error(tx('Unable to open workspace'))
      setNotice(tx('Workspace opened.'))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : tx('Unable to open workspace'))
    }
  }

  const copyEvidence = async (): Promise<void> => {
    if (!selected || !navigator.clipboard?.writeText) {
      setError(tx('Clipboard is unavailable'))
      return
    }
    setError(null)
    try {
      await navigator.clipboard.writeText(JSON.stringify({ run: selected, steps, execution }, null, 2))
      setNotice(tx('Evidence copied.'))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : tx('Unable to copy evidence'))
    }
  }

  const loadRunHistory = async (): Promise<void> => {
    if (!client?.getRunHistory || !selected || loadingHistory) return
    const runId = selected.id
    const requestGeneration = pageGeneration.current
    const currentPage = runHistory.runId === runId ? runHistory : emptyRunPage<RunHistoryItem>(runId)
    if (currentPage.loaded && !currentPage.hasMore) return
    setLoadingHistory(true)
    setError(null)
    try {
      const options: { limit: number; before?: string } = { limit: 50 }
      if (currentPage.nextCursor) options.before = currentPage.nextCursor
      const reply = await client.getRunHistory(runId, options)
      if (requestGeneration !== pageGeneration.current || selectedIdRef.current !== runId) return
      const page = pagePayload<RunHistoryItem>(reply.payload)
      const existing = currentPage.items
      const seen = new Set(existing.map((item) => item.eventId ?? String(item.domainSequence ?? '')))
      const items = [...existing, ...page.items.filter((item) => {
        const key = item.eventId ?? String(item.domainSequence ?? '')
        if (!key || seen.has(key)) return false
        seen.add(key)
        return true
      })]
      setRunHistory({ runId, items, loaded: true, hasMore: page.hasMore, nextCursor: page.nextCursor })
    } catch (reason) {
      if (requestGeneration === pageGeneration.current && selectedIdRef.current === runId) {
        setError(reason instanceof Error ? reason.message : tx('Unable to load run history'))
      }
    } finally {
      if (requestGeneration === pageGeneration.current && selectedIdRef.current === runId) setLoadingHistory(false)
    }
  }

  const loadRunEvidence = async (): Promise<void> => {
    if (!client?.getRunEvidence || !selected || loadingEvidence) return
    const runId = selected.id
    const requestGeneration = pageGeneration.current
    const currentPage = runEvidence.runId === runId ? runEvidence : emptyRunPage<RunEvidenceItem>(runId)
    if (currentPage.loaded && !currentPage.hasMore) return
    setLoadingEvidence(true)
    setError(null)
    try {
      const options: { limit: number; cursor?: string } = { limit: 50 }
      if (currentPage.nextCursor) options.cursor = currentPage.nextCursor
      const reply = await client.getRunEvidence(runId, options)
      if (requestGeneration !== pageGeneration.current || selectedIdRef.current !== runId) return
      const page = pagePayload<RunEvidenceItem>(reply.payload)
      const existing = currentPage.items
      const seen = new Set(existing.map((item) => `${item.stepId ?? ''}:${item.index ?? ''}`))
      const items = [...existing, ...page.items.filter((item) => {
        const key = `${item.stepId ?? ''}:${item.index ?? ''}`
        if (key === ':' || seen.has(key)) return false
        seen.add(key)
        return true
      })]
      setRunEvidence({ runId, items, loaded: true, hasMore: page.hasMore, nextCursor: page.nextCursor })
    } catch (reason) {
      if (requestGeneration === pageGeneration.current && selectedIdRef.current === runId) {
        setError(reason instanceof Error ? reason.message : tx('Unable to load run evidence'))
      }
    } finally {
      if (requestGeneration === pageGeneration.current && selectedIdRef.current === runId) setLoadingEvidence(false)
    }
  }

  const controlRun = async (operation: 'start' | 'pause' | 'resume' | 'cancel' | 'cleanup') => {
    if (!client || !selected || saving) return
    setSaving(true)
    setError(null)
    try {
      if (operation === 'start') await client.startAgentRun(selected.id)
      else if (operation === 'pause') await client.pauseAgentRun(selected.id)
      else if (operation === 'resume') await client.resumeAgentRun(selected.id)
      else if (operation === 'cancel') await client.cancelAgentRun(selected.id)
      else await client.cleanupAgentRun(selected.id)
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : tx('Unable to control agent run'))
    } finally {
      setSaving(false)
    }
  }

  const resolveApproval = async (item: AttentionView, scope: 'once' | null) => {
    if (!client) return
    try {
      await client.resolveAttention(item.id, { scope })
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : tx('Unable to resolve approval'))
    }
  }

  return (
    <main className="route-column run-control-route" aria-label={tx('Agent runs')}>
      <header className="route-header run-control-header">
        <div>
          <p className="section-kicker">{tx('Control center')}</p>
          <h1 tabIndex={-1}>{tx('Agent runs')}</h1>
          <p className="route-description">{tx('Ask in a conversation and the agent hands parts of the work to sub-agents when that helps; they show up here. Start a task here to let it run on its own.')}</p>
        </div>
        <div className="run-summary-strip" aria-label={tx('Run summary')}>
          <span><CircleDot size={13} />{activeCount} {tx('active')}</span>
          <span><AlertTriangle size={13} />{blockedCount} {tx('need attention')}</span>
          <span><Inbox size={13} />{attention.length} {tx('in inbox')}</span>
          <button type="button" className="icon-button" onClick={() => void load()} aria-label={tx('Refresh')} disabled={loading}>
            <RefreshCw size={15} className={loading ? 'is-spinning' : undefined} />
          </button>
        </div>
      </header>

      <div className="run-control-content">
      {!workspaceReady ? <p className="route-empty">{tx('Open a workspace to manage agent runs.')}</p> : null}
      {error ? <p className="route-error" role="status">{error}</p> : null}
      {notice ? <p className="review-notice" role="status">{notice}</p> : null}

      <CollaborationOverview timeline={state.timeline} />

      {workspaceReady ? (
        <div className="run-control-grid">
          <section className="run-list-pane glass-surface" aria-label={tx('Runs')}>
            <form className="run-create-form" onSubmit={(event) => { event.preventDefault(); void createRun() }}>
              {parentRunIdDraft ? (
                <p className="run-subagent-context" role="status">
                  <span>{tx('Adding a sub-agent to “{title}”', { title: runs.find((item) => item.id === parentRunIdDraft)?.title ?? '' })}</span>
                  <button type="button" className="link-button" onClick={() => { setParentRunIdDraft(null); setTitle('') }}>{tx('Cancel')}</button>
                </p>
              ) : null}
              <textarea ref={goalInput} value={goal} onChange={(event) => setGoal(event.target.value)} placeholder={tx('What should be done? Say how to tell it is finished.')} aria-label={tx('Run goal')} rows={3} />
              <details className="run-create-options">
                <summary>{tx('Options')}</summary>
                <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder={tx('Optional run title')} aria-label={tx('Run title')} />
                <label>
                  <span>{tx('Where it works')}</span>
                  <select value={isolation} onChange={(event) => setIsolation(event.target.value as 'auto' | 'shared' | 'worktree')}>
                    <option value="auto">{tx('Automatic')}</option>
                    <option value="worktree">{tx('Git worktree')}</option>
                    <option value="shared">{tx('Shared checkout')}</option>
                  </select>
                </label>
                <small>{tx('Automatic gives the task its own git worktree in a repository and uses the folder itself elsewhere.')}</small>
                <label className="run-option-check">
                  <input type="checkbox" checked={!startNow} onChange={(event) => setStartNow(!event.target.checked)} />
                  <span>{tx('Plan steps before it starts')}</span>
                </label>
              </details>
              <button className="primary-button" type="submit" disabled={!sessionId || !goal.trim() || saving}>
                {startNow ? <Play size={14} /> : <Plus size={14} />}
                {tx(parentRunIdDraft ? (startNow ? 'Start sub-agent' : 'Create sub-agent') : (startNow ? 'Start task' : 'Create task'))}
              </button>
              {!sessionId ? <small>{tx('Select or create a session before creating a run.')}</small> : null}
            </form>

            <div className="run-card-list">
              {orderedRuns.map(({ run, depth }) => (
                <button key={run.id} type="button" className={`run-card ${selectedId === run.id ? 'is-selected' : ''}`} data-depth={depth || undefined} onClick={() => void selectRun(run.id)}>
                  <span className={`run-state-dot state-${run.state}`} />
                  <span className="run-card-main">
                    <strong>{run.title}</strong>
                    <small>{tx(run.state.replaceAll('_', ' '))}{run.totalSteps > 0 ? ` · ${run.completedSteps}/${run.totalSteps}` : ''}</small>
                    {run.totalSteps > 0 ? <span className="run-progress"><i style={{ width: `${Math.round(run.progress * 100)}%` }} /></span> : null}
                  </span>
                  <span className="run-card-meta">
                    <ChevronRight size={14} />
                  </span>
                </button>
              ))}
              {!loading && runs.length === 0 ? <p className="route-note">{tx('No tasks yet. Tasks started here and sub-agents started from conversations appear in this list.')}</p> : null}
            </div>
          </section>

          <section className="run-detail-pane glass-surface" aria-label={tx('Selected run')}>
            {selected ? (
              <>
                <header className="run-detail-header">
                  <div>
                    <p className="section-kicker">{tx(selected.state.replaceAll('_', ' '))}</p>
                    <h2>{selected.title}</h2>
                    <p>{selected.goal}</p>
                  </div>
                  <div className="run-checkout-badge">
                    {selected.isolation === 'worktree' ? <GitBranch size={13} /> : <ShieldCheck size={13} />}
                    <span>{selected.branch || tx(selected.isolation === 'worktree' ? 'Git worktree' : 'Shared checkout')}</span>
                  </div>
                </header>
                <div className="run-control-actions">
                  {['draft', 'queued', 'needs_attention'].includes(selected.state) ? (
                    <button
                      type="button"
                      className="primary-button"
                      onClick={() => void controlRun(selected.state === 'needs_attention' && selected.blockingReason === 'paused_by_user' ? 'resume' : 'start')}
                      disabled={saving}
                    >
                      <Play size={13} />{tx(selected.state === 'needs_attention' && selected.blockingReason === 'paused_by_user' ? 'Resume paused run' : selected.state === 'needs_attention' ? 'Resume run' : 'Start run')}
                    </button>
                  ) : null}
                  {ACTIVE_STATES.has(selected.state) && selected.pauseRequested ? (
                    <button type="button" className="secondary-button" disabled>
                      <Square size={12} />{tx('Pause requested; finishing the current turn')}
                    </button>
                  ) : null}
                  {ACTIVE_STATES.has(selected.state) && !selected.pauseRequested ? (
                    <button type="button" className="secondary-button" onClick={() => void controlRun('pause')} disabled={saving}>
                      <Square size={12} />{tx('Pause run')}
                    </button>
                  ) : null}
                  {ACTIVE_STATES.has(selected.state) ? (
                    <button type="button" className="secondary-button danger-button" onClick={() => void controlRun('cancel')} disabled={saving}>
                      <Square size={12} />{tx('Cancel run')}
                    </button>
                  ) : null}
                  {['succeeded', 'failed', 'cancelled'].includes(selected.state) && selected.isolation === 'worktree' && selected.checkoutPath ? (
                    <button type="button" className="secondary-button" onClick={() => void controlRun('cleanup')} disabled={saving}>
                      <Trash2 size={13} />{tx('Clean worktree')}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => {
                      setParentRunIdDraft(selected.id)
                      setTitle(`Subagent: ${selected.title}`)
                      setGoal('')
                      setNotice(null)
                      goalInput.current?.focus()
                    }}
                    disabled={saving}
                  >
                    <Plus size={13} />{tx('Add sub-agent')}
                  </button>
                </div>
                {selected.blockingReason ? <p className="run-blocking-reason"><AlertTriangle size={14} />{selected.blockingReason.startsWith('plan-verification') || selected.blockingReason === 'plan_verification_required' ? tx('Plan verification required') : selected.blockingReason}</p> : null}
                {execution.resultText ? <section className="inspector-section run-output">
                  <h3>{tx('Run output')}</h3><SafeMarkdown source={execution.resultText} />
                  {execution.resultTruncated ? <small>{tx('Output preview truncated')}</small> : null}
                </section> : null}
                <details className="run-more-actions">
                  <summary><MoreHorizontal size={13} />{tx('More actions')}</summary>
                <div className="run-evidence-actions" aria-label={tx('Run actions')}>
                  <button type="button" className="secondary-button" onClick={() => void reviewRun()} disabled={saving || !client?.createReviewSnapshot}>
                    <Eye size={13} />{tx('Review run')}
                  </button>
                  {['failed', 'needs_attention'].includes(selected.state) ? (
                    <button type="button" className="secondary-button" onClick={() => void retryBranch()} disabled={saving}>
                      <RotateCcw size={13} />{tx('Retry branch')}
                    </button>
                  ) : null}
                  {selected.isolation === 'worktree' && selected.checkoutPath ? (
                    <button type="button" className="secondary-button" onClick={() => void openRunWorkspace()} disabled={saving || !client?.openWorkspacePath}>
                      <FolderOpen size={13} />{tx('Open workspace')}
                    </button>
                  ) : null}
                  <button type="button" className="secondary-button" onClick={() => void copyEvidence()} disabled={saving}>
                    <Copy size={13} />{tx('Copy evidence')}
                  </button>
                  {client?.getRunHistory && !(runHistory.runId === selected.id && runHistory.loaded) ? (
                    <button type="button" className="secondary-button" onClick={() => void loadRunHistory()} disabled={loadingHistory || (runHistory.runId === selected.id && runHistory.loaded && !runHistory.hasMore)}>
                      <History size={13} />{tx(loadingHistory ? 'Loading history' : 'Load run history')}
                    </button>
                  ) : null}
                  {client?.getRunEvidence && !(runEvidence.runId === selected.id && runEvidence.loaded) ? (
                    <button type="button" className="secondary-button" onClick={() => void loadRunEvidence()} disabled={loadingEvidence || (runEvidence.runId === selected.id && runEvidence.loaded && !runEvidence.hasMore)}>
                      <FileSearch size={13} />{tx(loadingEvidence ? 'Loading evidence' : 'Load run evidence')}
                    </button>
                  ) : null}
                </div>
                </details>
                <div className="run-plan-heading"><h3><ListChecks size={15} />{tx('Execution plan')}</h3><span>{Math.round(selected.progress * 100)}%</span></div>
                {steps.length === 0 ? <p className="run-plan-empty">{tx('The agent plans its own steps. Add steps only to guide it or to check each part.')}</p> : null}
                {steps.length > 0 || execution.phases?.length ? <RunDetailsPage
                  compact
                  phases={execution.phases?.length ? execution.phases : steps.map((step) => ({
                    id: step.id,
                    label: step.title,
                    state: step.state,
                    progress: step.state === 'completed' ? 1 : step.state === 'running' ? 0.5 : 0,
                    attempts: 0,
                    failureReason: step.state === 'failed' ? selected.blockingReason : null,
                    requiresUserAction: step.state === 'blocked' || selected.blockingReason === 'plan_verification_required',
                  }))}
                /> : null}
                <div className="run-plan-list">
                  {steps.map((step, index) => (
                    <article key={step.id} className={`run-step state-${step.state}`}>
                      <button type="button" className="run-step-state" aria-label={tx('Toggle step completion')} onClick={() => void setStepState(step, step.state === 'completed' ? 'pending' : 'completed')}>
                        {step.state === 'completed' ? <Check size={14} /> : <span>{index + 1}</span>}
                      </button>
                      <div>
                        <strong>{step.title}</strong>
                        {step.acceptance ? <small>{step.acceptance}</small> : null}
                        {step.dependencies.length ? <em>{tx('Depends on')} {step.dependencies.length}</em> : null}
                        {ACTIVE_STATES.has(selected.state) && step.state !== 'completed' && step.state !== 'running' ? (
                          <button type="button" className="secondary-button" onClick={() => void setStepState(step, 'running')}><Play size={12} />{tx('Work on step')}</button>
                        ) : null}
                        {step.state === 'running' ? <small>{tx('Current execution step')}</small> : null}
                        {step.evidence.length > 0 ? <details className="step-evidence">
                          <summary>{tx('Execution records')} ({step.evidence.length})</summary>
                          <ul>{step.evidence.slice(-20).map((item, evidenceIndex) => <li key={evidenceIndex}>{item}</li>)}</ul>
                        </details> : null}
                      </div>
                      <button type="button" className="icon-button" aria-label={tx('Delete step')} onClick={() => void removeStep(step)}><Trash2 size={13} /></button>
                    </article>
                  ))}
                </div>
                {addingStep ? (
                  <form className="run-step-form" onSubmit={(event) => { event.preventDefault(); void addStep() }}>
                    <input value={stepTitle} onChange={(event) => setStepTitle(event.target.value)} placeholder={tx('Next plan step')} aria-label={tx('Step title')} />
                    <input value={stepAcceptance} onChange={(event) => setStepAcceptance(event.target.value)} placeholder={tx('Acceptance evidence')} aria-label={tx('Step acceptance criteria')} />
                    <button type="submit" className="secondary-button" disabled={!stepTitle.trim() || saving}><Plus size={13} />{tx('Add step')}</button>
                  </form>
                ) : (
                  <button type="button" className="link-button run-step-open" onClick={() => setAddingStep(true)}><Plus size={13} />{tx('Add a step')}</button>
                )}
                {execution.autonomy ? <p className="run-policy-badge">{tx('Execution policy')}: {tx(execution.autonomy === 'yolo' ? 'YOLO' : execution.autonomy === 'ask' ? 'Ask' : execution.autonomy === 'full_access' ? 'Full access' : 'Workspace')}</p> : null}
                {execution.history?.length ? <details className="inspector-section run-history" open={false}>
                  <summary>{tx('Execution history')} ({execution.history.length})</summary>
                  <ol className="run-history-list">
                    {execution.history.map((item) => <li key={item.sequence}>
                      <header><strong>{tx(item.role === 'user' ? 'User message' : 'Assistant message')}</strong><small>#{item.sequence}</small></header>
                      <SafeMarkdown source={item.content} />
                      {item.truncated ? <small>{tx('History preview truncated')}</small> : null}
                    </li>)}
                  </ol>
                </details> : null}
                {runHistory.runId === selected.id && runHistory.loaded ? <section className="inspector-section run-history-page" aria-label={tx('Run history')}>
                  <h3>{tx('Run history')} ({runHistory.items.length})</h3>
                  {runHistory.items.length ? <ol className="run-history-list">
                    {runHistory.items.map((item, index) => <li key={item.eventId ?? item.domainSequence ?? index}>
                      <header><strong>{tx(item.type.replaceAll('.', ' '))}</strong><small>{item.domainSequence ? `#${item.domainSequence}` : ''}{item.createdAt ? ` · ${item.createdAt}` : ''}</small></header>
                      <SafeMarkdown source={historyItemText(item)} />
                    </li>)}
                  </ol> : <p className="route-note">{tx('No run history recorded')}</p>}
                  {runHistory.hasMore ? <button type="button" className="secondary-button" onClick={() => void loadRunHistory()} disabled={loadingHistory}>
                    {tx(loadingHistory ? 'Loading history' : 'Load more history')}
                  </button> : null}
                </section> : null}
                {runEvidence.runId === selected.id && runEvidence.loaded ? <section className="inspector-section run-evidence-page" aria-label={tx('Run evidence')}>
                  <h3>{tx('Run evidence')} ({runEvidence.items.length})</h3>
                  {runEvidence.items.length ? <ul>
                    {runEvidence.items.map((item, index) => <li key={`${item.stepId ?? 'step'}:${item.index ?? index}`}>
                      <strong>{item.stepTitle || tx('Execution plan')}</strong>
                      <SafeMarkdown source={item.evidence ?? ''} />
                    </li>)}
                  </ul> : <p className="route-note">{tx('No run evidence recorded')}</p>}
                  {runEvidence.hasMore ? <button type="button" className="secondary-button" onClick={() => void loadRunEvidence()} disabled={loadingEvidence}>
                    {tx(loadingEvidence ? 'Loading evidence' : 'Load more evidence')}
                  </button> : null}
                </section> : null}
                <ModelContextDetails manifest={execution.manifest} usage={execution.lastUsage} />
              </>
            ) : <p className="route-empty">{tx('Select a run to inspect its plan.')}</p>}
          </section>

          <aside className="attention-pane glass-surface" aria-label={tx('Attention inbox')}>
            <header><div><p className="section-kicker">{tx('Across all runs')}</p><h2>{tx('Attention inbox')}</h2></div><span>{attention.length}</span></header>
            <div className="attention-list">
              {attention.map((item) => (
                <article key={item.id} className={`attention-item severity-${item.severity}`}>
                  <AlertTriangle size={15} />
                  <div><strong>{tx(item.title)}</strong><small>{tx(item.detail || item.kind)}</small></div>
                  {item.kind === 'approval' && item.action?.kind === 'resolve_approval' ? (
                    <div className="attention-actions">
                      <button type="button" className="primary-button" onClick={() => void resolveApproval(item, 'once')}>{tx('Allow once')}</button>
                      <button type="button" className="secondary-button" onClick={() => void resolveApproval(item, null)}>{tx('Deny')}</button>
                    </div>
                  ) : item.runId && item.kind === 'review' ? (
                    <button type="button" className="secondary-button" onClick={() => void selectRun(item.runId!)}>{tx('Inspect plan')}</button>
                  ) : (
                    <button type="button" className="secondary-button" onClick={() => void resolveItem(item)}>{tx('Resolve')}</button>
                  )}
                </article>
              ))}
              {attention.length === 0 ? <p className="route-note">{tx('Nothing needs your attention.')}</p> : null}
            </div>
          </aside>
        </div>
      ) : null}
      </div>
    </main>
  )
}

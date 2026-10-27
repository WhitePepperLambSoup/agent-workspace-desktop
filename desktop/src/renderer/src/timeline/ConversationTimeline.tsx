import { elementScroll, useVirtualizer } from '@tanstack/react-virtual'
import { ArrowRight, Code2, FileText, FolderInput, Sparkles } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import type { ContributionRegistry } from '../extensions/registry'
import { isRenderableContribution } from '../extensions/registry'
import type { NoticeActions } from './NoticeRow'
import { TimelineRow, type MessageActions } from './TimelineRow'
import type { NoticeEntry, TimelineEntry } from './types'
import { useOptionalI18n } from '../i18n/I18nProvider'
import { parseUserAttachmentReferences } from './user-attachments'

const HISTORY_PREFETCH_THRESHOLD_PX = 160
const HISTORY_TIMEOUT_MS = 8_000
const FOLLOW_SCROLL_THROTTLE_MS = 180
const PROGRAMMATIC_SCROLL_PROTECTION_MS = 900
// Rows appended at the tail while the conversation is open rise in (motion.css).
// A larger batch is a history load, and rows the virtual list mounts while
// scrolling were never appended, so both stay still.
const MAX_ARRIVALS = 2
const ARRIVAL_MOTION_MS = 700

/** Ids of rows that arrived at the tail within the arrival motion. */
function useArrivals(entries: readonly TimelineEntry[], scopeKey: string | null): ReadonlySet<string> {
  const memory = useRef({ scopeKey, length: entries.length, tailId: entries.at(-1)?.id, at: new Map<string, number>() })
  const state = memory.current
  if (state.scopeKey !== scopeKey) {
    Object.assign(state, { scopeKey, length: entries.length, tailId: entries.at(-1)?.id, at: new Map() })
  }
  const added = entries.length - state.length
  const now = performance.now()
  if (added !== 0 || entries.at(-1)?.id !== state.tailId) {
    const appended = added > 0 && added <= MAX_ARRIVALS && (state.length === 0 || entries[state.length - 1]?.id === state.tailId)
    if (appended) for (const entry of entries.slice(-added)) if (!state.at.has(entry.id)) state.at.set(entry.id, now)
    state.length = entries.length
    state.tailId = entries.at(-1)?.id
  }
  const arriving = new Set<string>()
  for (const [id, at] of state.at) {
    if (now - at < ARRIVAL_MOTION_MS) arriving.add(id)
    else state.at.delete(id)
  }
  return arriving
}

interface ConversationTimelineProps {
  entries: readonly TimelineEntry[]
  scopeKey?: string | null
  hasMore?: boolean
  onLoadPrevious?: () => void | Promise<unknown>
  onOpenExternal?: (url: string) => void
  onPromptSuggestion?: (prompt: string) => void
  /** Puts a sent message back into the composer for editing. */
  onEditPrompt?: (prompt: string) => void
  /** Sends a prompt again as a new turn. */
  onRetryPrompt?: (prompt: string) => void
  retryDisabled?: boolean
  /** Rewrites a user message in a new conversation that ends before it. */
  onForkMessage?: (messageId: string) => void
  /** Continues in a new conversation that keeps the turn the user message started. */
  onBranchFromReply?: (messageId: string) => void
  /** Asks the question of a turn again with another model in a new conversation. */
  onCompareReply?: (messageId: string) => void
  /** Puts the files the agent changed after a user message back as they were. */
  onRewindFiles?: (messageId: string) => void
  forkDisabled?: boolean
  /** Puts a message's text in a paired phone's inbox. */
  onSendToPhone?: (text: string) => void
  noticeActionsFor?: (entry: NoticeEntry) => NoticeActions | undefined
  registry?: Pick<ContributionRegistry, 'resolveTimelineRenderer'>
}

interface RetryPlan {
  edit: string | null
  retry: string | null
  kind: 'resend' | 'regenerate'
  /** The user message whose turn a fork, branch or comparison starts from. */
  forkFrom: string | null
  branchFrom: string | null
  compareFrom: string | null
}

/**
 * Edit and resend apply to finished user messages; regenerate applies only to
 * the latest answer. Messages that carried attachments are not resent, since
 * the attachments themselves cannot be replayed from the transcript. A turn's
 * last answer can branch into a new conversation or be compared with another
 * model's answer to the same question.
 */
function planMessageActions(entries: readonly TimelineEntry[]): Map<string, RetryPlan> {
  const plans = new Map<string, RetryPlan>()
  let lastUser: { id: string; text: string; replayable: boolean; forkable: boolean } | null = null
  let turnAnswerId: string | null = null
  let latestAssistantId: string | null = null
  let latestAssistantPrompt: string | null = null
  const closeTurn = (): void => {
    if (!turnAnswerId || !lastUser) return
    const plan = plans.get(turnAnswerId)
    if (plan) {
      plan.branchFrom = lastUser.id
      plan.compareFrom = lastUser.forkable && lastUser.replayable ? lastUser.id : null
    }
  }
  for (const entry of entries) {
    if (entry.type !== 'message' || entry.open) continue
    if (entry.role === 'user') {
      // A message sent while the turn ran belongs to that turn, which goes on.
      if (entry.forkable === false && lastUser) {
        const parsed = parseUserAttachmentReferences(entry.text)
        const text = parsed.body.trim()
        plans.set(entry.id, { edit: text || null, retry: null, kind: 'resend', forkFrom: null, branchFrom: null, compareFrom: null })
        continue
      }
      closeTurn()
      const parsed = parseUserAttachmentReferences(entry.text)
      const text = parsed.body.trim()
      const replayable = text.length > 0 && parsed.filenames.length === 0
      const forkable = entry.forkable === true
      lastUser = { id: entry.id, text, replayable, forkable }
      turnAnswerId = null
      latestAssistantId = null
      plans.set(entry.id, {
        edit: text || null, retry: replayable ? text : null, kind: 'resend',
        forkFrom: forkable && text ? entry.id : null, branchFrom: null, compareFrom: null,
      })
    } else if (entry.role === 'assistant') {
      latestAssistantId = entry.id
      latestAssistantPrompt = lastUser?.replayable ? lastUser.text : null
      if (lastUser) {
        if (turnAnswerId) plans.delete(turnAnswerId)
        turnAnswerId = entry.id
        plans.set(entry.id, { edit: null, retry: null, kind: 'regenerate', forkFrom: null, branchFrom: null, compareFrom: null })
      }
    }
  }
  closeTurn()
  if (latestAssistantId && latestAssistantPrompt) {
    const plan = plans.get(latestAssistantId)
    if (plan) plan.retry = latestAssistantPrompt
    else plans.set(latestAssistantId, { edit: null, retry: latestAssistantPrompt, kind: 'regenerate', forkFrom: null, branchFrom: null, compareFrom: null })
  }
  return plans
}

function contributionMetadata(entry: TimelineEntry): Record<string, unknown> {
  const id = /^[a-zA-Z0-9._:-]{1,160}$/.test(entry.id) ? entry.id : 'redacted'
  if (entry.type === 'message') {
    return {
      id,
      type: entry.type,
      role: entry.role,
      open: entry.open,
      textLength: Math.min(entry.text.length, 2_000_000),
    }
  }
  return { id, type: entry.type }
}

function nodeAtBottom(node: HTMLElement): boolean {
  return node.scrollHeight - node.scrollTop - node.clientHeight <= 48
}

function MeasuredTimelineRow({
  entry, index, setSize, start, arrived, onResize, children,
}: {
  entry: TimelineEntry
  index: number
  setSize: number
  start: number
  arrived: boolean
  onResize: (index: number, height: number) => void
  children: ReactNode
}) {
  const nodeRef = useRef<HTMLElement>(null)
  const measurementVersion = useRef(0)
  const message = entry.type === 'message' ? entry : null
  const tool = entry.type === 'tool' ? entry : null
  const diff = entry.type === 'diff' ? entry : null
  const measure = useCallback((defer = false) => {
    const node = nodeRef.current
    if (!node?.isConnected) return
    const version = ++measurementVersion.current
    const height = Math.ceil(node.getBoundingClientRect().height)
    const publish = () => {
      if (node.isConnected && version === measurementVersion.current) onResize(index, height)
    }
    // TanStack may synchronously commit a scroll adjustment. Publish after the
    // React commit, in the same frame, rather than flushing inside its lifecycle.
    if (defer) queueMicrotask(publish)
    else publish()
  }, [index, onResize])

  // Content commits and native details toggles must update offsets before a
  // delayed ResizeObserver can leave the following absolute row at its old top.
  useLayoutEffect(() => measure(true), [
    measure, entry.type, message?.role, message?.text, message?.open, message?.resources,
    tool?.name, tool?.state, tool?.arguments, tool?.result, diff?.source,
  ])

  useEffect(() => {
    const node = nodeRef.current
    if (!node) return
    const onToggle = () => measure()
    node.addEventListener('toggle', onToggle, true)
    if (typeof ResizeObserver === 'undefined') return () => node.removeEventListener('toggle', onToggle, true)
    const observer = new ResizeObserver((records) => {
      for (const record of records) {
        if (record.target !== node || !node.isConnected) continue
        const height = record.borderBoxSize?.[0]?.blockSize
        if (typeof height === 'number') {
          measurementVersion.current += 1
          onResize(index, Math.ceil(height))
        }
        else measure()
      }
    })
    observer.observe(node, { box: 'border-box' })
    return () => {
      observer.disconnect()
      node.removeEventListener('toggle', onToggle, true)
    }
  }, [index, measure, onResize])

  return (
    <article
      ref={nodeRef}
      data-index={index}
      aria-posinset={index + 1}
      aria-setsize={setSize}
      data-testid="timeline-row"
      data-arrived={arrived ? 'true' : undefined}
      className={`timeline-row ${entry.type === 'message' ? `role-${entry.role}` : `row-${entry.type}`}`}
      style={{ transform: `translateY(${start}px)` }}
    >
      {children}
    </article>
  )
}

export function ConversationTimeline({
  entries, scopeKey = null, hasMore = false, onLoadPrevious, onOpenExternal, onPromptSuggestion, onEditPrompt, onRetryPrompt,
  retryDisabled = false, onForkMessage, onBranchFromReply, onCompareReply, onRewindFiles, forkDisabled = false, onSendToPhone, noticeActionsFor,
  registry,
}: ConversationTimelineProps) {
  const { t } = useOptionalI18n()
  const hasActions = Boolean(onEditPrompt || onRetryPrompt || onForkMessage || onBranchFromReply || onCompareReply || onRewindFiles)
  const actionPlans = useMemo(
    () => hasActions ? planMessageActions(entries) : null,
    [entries, hasActions],
  )
  const actionsFor = (entry: TimelineEntry): MessageActions | undefined => {
    const plan = actionPlans?.get(entry.id)
    if (!plan) return onSendToPhone && entry.type === 'message' ? { onSendToPhone } : undefined
    return {
      onSendToPhone,
      onEdit: plan.edit && onEditPrompt ? () => onEditPrompt(plan.edit!) : undefined,
      onRetry: plan.retry && onRetryPrompt ? () => onRetryPrompt(plan.retry!) : undefined,
      retryKind: plan.kind,
      retryDisabled,
      onFork: plan.forkFrom && onForkMessage ? () => onForkMessage(plan.forkFrom!) : undefined,
      onBranch: plan.branchFrom && onBranchFromReply ? () => onBranchFromReply(plan.branchFrom!) : undefined,
      onCompare: plan.compareFrom && onCompareReply ? () => onCompareReply(plan.compareFrom!) : undefined,
      // A user message with its own durable event can be a point to restore files to.
      onRewind: plan.forkFrom && onRewindFiles ? () => onRewindFiles(plan.forkFrom!) : undefined,
      forkDisabled,
    }
  }
  const parentRef = useRef<HTMLDivElement>(null)
  const [loadingPrevious, setLoadingPrevious] = useState(false)
  const [historyError, setHistoryError] = useState(false)
  const loadingPreviousRef = useRef(false)
  const followOutput = useRef(true)
  const programmaticScrollUntil = useRef(0)
  const programmaticScrollTarget = useRef<number | null>(null)
  const prependAnchor = useRef<{ height: number; top: number } | null>(null)
  const historyGeneration = useRef(0)
  const automaticHistoryKey = useRef<string | null>(null)
  const followScrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const followFrameIds = useRef<number[]>([])
  const userScrollIntent = useRef(false)
  const lastFollowScrollAt = useRef(0)
  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 92,
    overscan: 8,
    initialRect: { width: 800, height: 600 },
    initialOffset: () => Math.max(0, entries.length * 92 - 600),
    getItemKey: (index) => entries[index]?.id ?? index,
    scrollToFn: (offset, options, instance) => {
      const viewportHeight = instance.scrollRect?.height ?? instance.scrollElement?.clientHeight ?? 0
      const bottomOffset = Math.max(0, instance.getTotalSize() - viewportHeight)
      const requestedOffset = offset + (options.adjustments ?? 0)
      if (!followOutput.current && requestedOffset >= bottomOffset - 2) return
      programmaticScrollTarget.current = requestedOffset
      programmaticScrollUntil.current = performance.now() + PROGRAMMATIC_SCROLL_PROTECTION_MS
      elementScroll(offset, options, instance)
    },
  })
  const resizeRow = useCallback((index: number, height: number) => {
    if (Number.isFinite(height) && height > 0) virtualizer.resizeItem(index, height)
  }, [virtualizer])
  const rows = virtualizer.getVirtualItems()
  const arrivals = useArrivals(entries, scopeKey)
  const visibleRows = rows.length > 0
    ? rows
    : entries.slice(-16).map((_, offset) => {
      const index = Math.max(0, entries.length - 16) + offset
      return { index, key: entries[index]?.id ?? index, start: index * 92 }
    })
  const tail = entries.at(-1)
  const outputRevision = tail?.type === 'message'
    ? `${tail.id}:${tail.text.length}:${tail.open === true}`
    : tail?.id ?? ''

  useEffect(() => {
    if (entries.length === 0 || !followOutput.current) return
    const scroll = () => {
      followScrollTimer.current = null
      if (!followOutput.current) return
      lastFollowScrollAt.current = performance.now()
      const followToEnd = () => {
        if (!followOutput.current) return
        const node = parentRef.current
        const target = node ? Math.max(0, node.scrollHeight - node.clientHeight) : null
        programmaticScrollTarget.current = target
        programmaticScrollUntil.current = performance.now() + PROGRAMMATIC_SCROLL_PROTECTION_MS
        virtualizer.scrollToIndex(entries.length - 1, { align: 'end' })
        if (node && target !== null) node.scrollTop = target
      }
      followToEnd()
      const settle = (remainingFrames: number) => {
        if (!followOutput.current || remainingFrames <= 0) return
        const frame = requestAnimationFrame(() => {
          followFrameIds.current = followFrameIds.current.filter((id) => id !== frame)
          followToEnd()
          settle(remainingFrames - 1)
        })
        followFrameIds.current.push(frame)
      }
      settle(3)
    }
    const remaining = FOLLOW_SCROLL_THROTTLE_MS - (performance.now() - lastFollowScrollAt.current)
    if (remaining <= 0 && followScrollTimer.current === null) scroll()
    else if (followScrollTimer.current === null) followScrollTimer.current = setTimeout(scroll, remaining)
    return () => {
      if (followScrollTimer.current !== null) {
        clearTimeout(followScrollTimer.current)
        followScrollTimer.current = null
      }
      for (const frame of followFrameIds.current) cancelAnimationFrame(frame)
      followFrameIds.current = []
    }
  }, [entries.length, outputRevision, virtualizer])

  useEffect(() => {
    const node = parentRef.current
    if (entries.length === 0 || !node || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      if (!followOutput.current) return
      const target = Math.max(0, node.scrollHeight - node.clientHeight)
      programmaticScrollTarget.current = target
      programmaticScrollUntil.current = performance.now() + PROGRAMMATIC_SCROLL_PROTECTION_MS
      node.scrollTop = target
    })
    observer.observe(node)
    const spacer = node.querySelector('.timeline-spacer')
    if (spacer) observer.observe(spacer)
    return () => observer.disconnect()
  }, [entries.length, scopeKey])

  useLayoutEffect(() => {
    const anchor = prependAnchor.current
    const node = parentRef.current
    if (!anchor || !node) return
    node.scrollTop = anchor.top + (node.scrollHeight - anchor.height)
    prependAnchor.current = null
  }, [entries.length])

  useLayoutEffect(() => {
    historyGeneration.current += 1
    setLoadingPrevious(false)
    loadingPreviousRef.current = false
    setHistoryError(false)
    prependAnchor.current = null
    followOutput.current = true
    automaticHistoryKey.current = null
  }, [scopeKey])

  const loadPrevious = (): void => {
    if (!onLoadPrevious || loadingPreviousRef.current) return
    const node = parentRef.current
    if (node) prependAnchor.current = { height: node.scrollHeight, top: node.scrollTop }
    followOutput.current = false
    loadingPreviousRef.current = true
    setLoadingPrevious(true)
    setHistoryError(false)
    const generation = historyGeneration.current
    let timeout: ReturnType<typeof setTimeout> | undefined
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => reject(new Error('history_timeout')), HISTORY_TIMEOUT_MS)
    })
    void Promise.race([Promise.resolve(onLoadPrevious()), timeoutPromise])
      .catch(() => {
        if (historyGeneration.current === generation) setHistoryError(true)
      })
      .finally(() => {
        if (timeout !== undefined) clearTimeout(timeout)
        if (historyGeneration.current === generation) {
          loadingPreviousRef.current = false
          setLoadingPrevious(false)
        }
      })
  }

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const node = parentRef.current
      if (!node || !hasMore || !onLoadPrevious || node.scrollTop > HISTORY_PREFETCH_THRESHOLD_PX) return
      const key = `${scopeKey ?? ''}:${entries[0]?.id ?? ''}:${entries.length}`
      if (automaticHistoryKey.current === key) return
      automaticHistoryKey.current = key
      loadPrevious()
    })
    return () => cancelAnimationFrame(frame)
  }, [entries.length, entries[0]?.id, hasMore, onLoadPrevious, scopeKey])

  return (
    <div
      ref={parentRef}
      className="conversation-reading timeline-scroll"
      role="region"
      aria-label={t('timeline.title')}
      aria-busy={loadingPrevious}
      tabIndex={0}
      onScroll={(event) => {
        const node = event.currentTarget
        const expectedTarget = programmaticScrollTarget.current
        const programmaticProtectionActive = performance.now() < programmaticScrollUntil.current
        const isExpectedProgrammaticScroll = programmaticProtectionActive
          && !userScrollIntent.current
          && (expectedTarget === null || Math.abs(node.scrollTop - expectedTarget) <= 48)
        if (!isExpectedProgrammaticScroll && userScrollIntent.current) {
          followOutput.current = nodeAtBottom(node)
          programmaticScrollTarget.current = null
        }
        userScrollIntent.current = false
        if (node.scrollTop <= HISTORY_PREFETCH_THRESHOLD_PX && hasMore) loadPrevious()
      }}
      onPointerDown={() => {
        userScrollIntent.current = true
        programmaticScrollTarget.current = null
      }}
      onKeyDown={(event) => {
        if (!['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) return
        userScrollIntent.current = true
        programmaticScrollTarget.current = null
        if (['ArrowUp', 'PageUp', 'Home'].includes(event.key)) followOutput.current = false
      }}
      onWheel={(event) => {
        userScrollIntent.current = true
        const projectedScrollTop = Math.max(0, event.currentTarget.scrollTop + event.deltaY)
        programmaticScrollTarget.current = null
        if (event.deltaY < 0) followOutput.current = false
        else if (event.deltaY > 0 && nodeAtBottom(event.currentTarget)) followOutput.current = true
        if (event.deltaY < 0 && projectedScrollTop <= HISTORY_PREFETCH_THRESHOLD_PX && hasMore) {
          loadPrevious()
        }
      }}
    >
      {hasMore && onLoadPrevious ? (
        historyError ? (
          <div className="timeline-history-error" role="status">
            <span>{t('timeline.loadPreviousFailed')}</span>
            <button type="button" className="timeline-history-button" onClick={loadPrevious}>
              {t('timeline.retryPrevious')}
            </button>
          </div>
        ) : loadingPrevious ? (
          <p className="timeline-history-loading" role="status">{t('timeline.loadingPrevious')}</p>
        ) : null
      ) : null}
      {entries.length === 0 ? (
        <div className="empty-session">
          <div className="empty-session-icon" aria-hidden="true"><Sparkles size={17} /></div>
          <strong>{t('timeline.emptyTitle')}</strong>
          <span>{t('timeline.emptyDescription')}</span>
          <div className="empty-session-suggestions" data-testid="empty-session-suggestions">
            <button type="button" onClick={() => onPromptSuggestion?.(t('timeline.suggestion.buildPrompt'))}>
              <FileText size={13} />
              <span className="suggestion-copy"><strong>{t('timeline.suggestion.build')}</strong><small>{t('timeline.suggestion.buildHint')}</small></span>
              <ArrowRight size={12} aria-hidden="true" />
            </button>
            <button type="button" onClick={() => onPromptSuggestion?.(t('timeline.suggestion.inspectPrompt'))}>
              <FolderInput size={13} />
              <span className="suggestion-copy"><strong>{t('timeline.suggestion.inspect')}</strong><small>{t('timeline.suggestion.inspectHint')}</small></span>
              <ArrowRight size={12} aria-hidden="true" />
            </button>
            <button type="button" onClick={() => onPromptSuggestion?.(t('timeline.suggestion.fixPrompt'))}>
              <Code2 size={13} />
              <span className="suggestion-copy"><strong>{t('timeline.suggestion.fix')}</strong><small>{t('timeline.suggestion.fixHint')}</small></span>
              <ArrowRight size={12} aria-hidden="true" />
            </button>
          </div>
          <span className="empty-session-ready">{t('status.ready')}</span>
        </div>
      ) : (
        <div className="timeline-spacer" role="feed" aria-label={t('timeline.title')} aria-busy={loadingPrevious} style={{ height: virtualizer.getTotalSize() }}>
          {visibleRows.map((row) => {
            const entry = entries[row.index]
            if (!entry) return null
            const fallback = (
              <TimelineRow entry={entry} onOpenExternal={onOpenExternal} actions={actionsFor(entry)}
                noticeActions={entry.type === 'notice' ? noticeActionsFor?.(entry) : undefined} />
            )
            const contribution = registry?.resolveTimelineRenderer(
              contributionMetadata(entry),
              () => fallback,
            )
            const content = isRenderableContribution(contribution) ? contribution : fallback
            return (
              <MeasuredTimelineRow
                key={entry.id}
                entry={entry}
                index={row.index}
                setSize={entries.length}
                start={row.start}
                arrived={arrivals.has(entry.id)}
                onResize={resizeRow}
              >
                {content}
              </MeasuredTimelineRow>
            )
          })}
        </div>
      )}
    </div>
  )
}

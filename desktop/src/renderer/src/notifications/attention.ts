import { useEffect, useRef, useState, useSyncExternalStore } from 'react'

import type { DesktopNotification } from '../../../shared/desktop'
import type { WorkbenchState } from '../state/workbench-store'

const PREFERENCE_KEY = 'agent-workspace.notifications.v1'
const listeners = new Set<() => void>()

/** At work with nothing new from it for this long, a conversation is called quiet. */
export const QUIET_MS = 5 * 60_000
/** A turn that failed is pointed out this long after. */
export const FAILED_SHOWN_MS = 10 * 60_000
/** How often time is looked at again, for silences no event marks. */
const CLOCK_MS = 30_000

/** Whether background notifications are on; defaults to on. */
export function notificationsEnabled(): boolean {
  try { return window.localStorage.getItem(PREFERENCE_KEY) !== 'off' } catch { return true }
}

export function setNotificationsEnabled(enabled: boolean): void {
  try { window.localStorage.setItem(PREFERENCE_KEY, enabled ? 'on' : 'off') } catch { /* Preference stays in memory only. */ }
  for (const listener of listeners) listener()
}

export function useNotificationsEnabled(): boolean {
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => listeners.delete(listener) },
    notificationsEnabled,
    () => true,
  )
}

/** The time now, looked at again every half minute while `active`. */
export function useClock(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return undefined
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), CLOCK_MS)
    return () => window.clearInterval(timer)
  }, [active])
  return now
}

/** Whether a conversation has a turn running, queued or requested. */
export function sessionRunning(state: WorkbenchState, sessionId: string): boolean {
  const session = state.runtime.activeSessions?.[sessionId]
  if (session) return Boolean(session.activeTurn || session.turnRequested || (session.queuedTurnCount ?? 0) > 0)
  return Boolean(state.runtime.activeTurn) && state.runtime.hostSessionId === sessionId
}

/**
 * What about a conversation needs the user: a question waiting, a long silence while it works,
 * or a turn that just failed. Null when nothing does.
 */
export type SessionAttention = { kind: 'approval'; count: number } | { kind: 'quiet'; minutes: number } | { kind: 'failed' }

export function sessionAttention(state: WorkbenchState, sessionId: string, now: number): SessionAttention | null {
  const count = Object.values(state.approvals).filter((approval) => approval.sessionId === sessionId).length
  if (count > 0) return { kind: 'approval', count }
  const seen = state.sessionActivity?.[sessionId]
  if (sessionRunning(state, sessionId)) {
    return seen && now - seen.at >= QUIET_MS ? { kind: 'quiet', minutes: Math.floor((now - seen.at) / 60_000) } : null
  }
  return seen?.ended?.outcome === 'failed' && now - seen.ended.at < FAILED_SHOWN_MS ? { kind: 'failed' } : null
}

export interface AttentionSnapshot {
  epoch: string | null
  /** Session id → active turn id for every session with a running turn. */
  turns: Map<string, string>
  approvals: Map<string, { sessionId: string | null; title: string }>
  /** Conversations at work with nothing new from them for a while, and for how many minutes. */
  quiet: Map<string, number>
  /** How each conversation's last turn ended, as far as the window saw. */
  endings: Map<string, string>
}

function text(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 200) : fallback
}

export function attentionSnapshot(state: WorkbenchState, now = Date.now()): AttentionSnapshot {
  const turns = new Map<string, string>()
  for (const session of Object.values(state.runtime.activeSessions ?? {})) {
    if (session.activeTurn) turns.set(session.sessionId, session.activeTurn)
  }
  if (state.runtime.activeTurn && state.runtime.hostSessionId) turns.set(state.runtime.hostSessionId, state.runtime.activeTurn)
  const approvals = new Map<string, { sessionId: string | null; title: string }>()
  for (const [requestId, approval] of Object.entries(state.approvals)) {
    approvals.set(requestId, {
      sessionId: typeof approval.sessionId === 'string' ? approval.sessionId : null,
      title: text(approval.toolName ?? approval.tool ?? approval.name, ''),
    })
  }
  const quiet = new Map<string, number>()
  const endings = new Map<string, string>()
  for (const [sessionId, seen] of Object.entries(state.sessionActivity ?? {})) {
    if (seen.ended) endings.set(sessionId, seen.ended.outcome)
    const attention = turns.has(sessionId) ? sessionAttention(state, sessionId, now) : null
    if (attention?.kind === 'quiet') quiet.set(sessionId, attention.minutes)
  }
  return { epoch: state.runtime.epoch, turns, approvals, quiet, endings }
}

export interface AttentionText {
  turnFinished: string
  approvalNeeded: string
  /** Defaults to turnFinished. */
  turnFailed?: string
  /** The title of a long silence; without it, none is reported. */
  quiet?: string
  /** How long, in the body. */
  minutes?: (minutes: number) => string
  sessionTitle: (sessionId: string) => string
}

/**
 * Notifications for turns that ended (or failed), approvals that appeared, and conversations
 * that went quiet while at work, between two snapshots.
 */
export function attentionChanges(previous: AttentionSnapshot, next: AttentionSnapshot, copy: AttentionText): DesktopNotification[] {
  // A new epoch replays state after a reconnect; nothing in it is news.
  if (previous.epoch !== next.epoch) return []
  const notifications: DesktopNotification[] = []
  for (const [sessionId, turnId] of previous.turns) {
    if (next.turns.get(sessionId) === turnId) continue
    const failed = next.endings.get(sessionId) === 'failed' && next.turns.get(sessionId) === undefined
    notifications.push({
      title: failed ? copy.turnFailed ?? copy.turnFinished : copy.turnFinished,
      body: copy.sessionTitle(sessionId),
      sessionId,
      urgency: failed ? 'attention' : 'normal',
    })
  }
  for (const [requestId, approval] of next.approvals) {
    if (previous.approvals.has(requestId)) continue
    const where = approval.sessionId ? copy.sessionTitle(approval.sessionId) : ''
    notifications.push({
      title: copy.approvalNeeded,
      body: [approval.title, where].filter(Boolean).join(' · ').slice(0, 400),
      sessionId: approval.sessionId,
      urgency: 'attention',
    })
  }
  if (copy.quiet) {
    for (const [sessionId, minutes] of next.quiet) {
      if (previous.quiet.has(sessionId)) continue
      notifications.push({
        title: copy.quiet,
        body: [copy.sessionTitle(sessionId), copy.minutes?.(minutes)].filter(Boolean).join(' · ').slice(0, 400),
        sessionId,
        urgency: 'attention',
      })
    }
  }
  return notifications
}

/**
 * Sends a system notification when work finishes, fails, needs approval, or goes quiet while the
 * window is in the background. Time is looked at again while something is at work, for the
 * silences no event marks.
 */
export function useAttentionNotifications(state: WorkbenchState, copy: AttentionText, notify: ((notification: DesktopNotification) => unknown) | undefined): void {
  const enabled = useNotificationsEnabled()
  const now = useClock(Object.keys(state.runtime.activeSessions ?? {}).length > 0 || Boolean(state.runtime.activeTurn))
  const previous = useRef<AttentionSnapshot | null>(null)
  const copyRef = useRef(copy)
  copyRef.current = copy
  useEffect(() => {
    const next = attentionSnapshot(state, Math.max(now, Date.now()))
    const before = previous.current
    previous.current = next
    if (!before || !enabled || !notify) return
    for (const notification of attentionChanges(before, next, copyRef.current)) void notify(notification)
  }, [enabled, notify, now, state])
}

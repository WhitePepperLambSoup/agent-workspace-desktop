import { useEffect, useRef, useSyncExternalStore } from 'react'

import type { DesktopNotification } from '../../../shared/desktop'
import type { WorkbenchState } from '../state/workbench-store'

const PREFERENCE_KEY = 'agent-workspace.notifications.v1'
const listeners = new Set<() => void>()

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

export interface AttentionSnapshot {
  epoch: string | null
  /** Session id → active turn id for every session with a running turn. */
  turns: Map<string, string>
  approvals: Map<string, { sessionId: string | null; title: string }>
}

function text(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 200) : fallback
}

export function attentionSnapshot(state: WorkbenchState): AttentionSnapshot {
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
  return { epoch: state.runtime.epoch, turns, approvals }
}

export interface AttentionText {
  turnFinished: string
  approvalNeeded: string
  sessionTitle: (sessionId: string) => string
}

/** Notifications for turns that ended and approvals that appeared between two snapshots. */
export function attentionChanges(previous: AttentionSnapshot, next: AttentionSnapshot, copy: AttentionText): DesktopNotification[] {
  // A new epoch replays state after a reconnect; nothing in it is news.
  if (previous.epoch !== next.epoch) return []
  const notifications: DesktopNotification[] = []
  for (const [sessionId, turnId] of previous.turns) {
    if (next.turns.get(sessionId) === turnId) continue
    notifications.push({ title: copy.turnFinished, body: copy.sessionTitle(sessionId), sessionId, urgency: 'normal' })
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
  return notifications
}

/** Sends a system notification when work finishes or needs approval while the window is in the background. */
export function useAttentionNotifications(state: WorkbenchState, copy: AttentionText, notify: ((notification: DesktopNotification) => unknown) | undefined): void {
  const enabled = useNotificationsEnabled()
  const previous = useRef<AttentionSnapshot | null>(null)
  const copyRef = useRef(copy)
  copyRef.current = copy
  useEffect(() => {
    const next = attentionSnapshot(state)
    const before = previous.current
    previous.current = next
    if (!before || !enabled || !notify) return
    for (const notification of attentionChanges(before, next, copyRef.current)) void notify(notification)
  }, [enabled, notify, state])
}

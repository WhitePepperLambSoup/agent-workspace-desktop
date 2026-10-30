/**
 * Simple or full layout. Simple keeps the activity rail to what most people use (conversations,
 * the knowledge base, scheduled tasks and the workspace); full adds the developer surfaces.
 * The choice is kept per window profile; until it is made, the desktop's default applies.
 */

export type InterfaceMode = 'simple' | 'full'

export const INTERFACE_MODE_STORAGE_KEY = 'agent-workspace.interface.v1'
export const INTERFACE_MODE_CHANGED_EVENT = 'agent-workspace:interface-mode'

const SIMPLE_ACTIVITIES: ReadonlySet<string> = new Set(['agent', 'studio', 'knowledge', 'schedules', 'workspace', 'settings'])

export function readInterfaceMode(): InterfaceMode {
  try {
    const stored = window.localStorage.getItem(INTERFACE_MODE_STORAGE_KEY)
    if (stored === 'simple' || stored === 'full') return stored
  } catch {
    // Storage can be unavailable; the default applies.
  }
  return window.agentWorkspace?.interfaceDefault ?? 'simple'
}

export function writeInterfaceMode(mode: InterfaceMode): void {
  try {
    window.localStorage.setItem(INTERFACE_MODE_STORAGE_KEY, mode)
  } catch {
    // The choice still applies to this window.
  }
  window.dispatchEvent(new CustomEvent(INTERFACE_MODE_CHANGED_EVENT, { detail: mode }))
}

export function activityVisible(mode: InterfaceMode, activity: string): boolean {
  return mode === 'full' || SIMPLE_ACTIVITIES.has(activity)
}

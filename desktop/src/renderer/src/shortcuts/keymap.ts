import { useMemo, useSyncExternalStore } from 'react'

import type { MessageKey } from '../i18n/messages'

/** Commands whose keyboard shortcut can be changed, with their defaults. */
export const SHORTCUT_COMMANDS: ReadonlyArray<{ id: string; titleKey: MessageKey; defaultShortcut: string | null }> = [
  { id: 'app.palette', titleKey: 'command.openPalette', defaultShortcut: 'Ctrl+K' },
  { id: 'session.new', titleKey: 'workbench.newTask', defaultShortcut: 'Ctrl+N' },
  { id: 'composer.focus', titleKey: 'composer.message', defaultShortcut: 'Ctrl+L' },
  { id: 'turn.stop', titleKey: 'composer.stopTurn', defaultShortcut: 'Ctrl+Shift+Backspace' },
  { id: 'drawer.sessions', titleKey: 'command.toggleSessions', defaultShortcut: 'Ctrl+Shift+S' },
  { id: 'drawer.inspector', titleKey: 'command.toggleInspector', defaultShortcut: 'Ctrl+Shift+I' },
  { id: 'route.agent', titleKey: 'command.route.agent', defaultShortcut: 'Ctrl+1' },
  { id: 'route.runs', titleKey: 'command.route.runs', defaultShortcut: 'Ctrl+2' },
  { id: 'route.changes', titleKey: 'command.route.changes', defaultShortcut: 'Ctrl+3' },
  { id: 'route.workspace', titleKey: 'command.route.workspace', defaultShortcut: null },
  { id: 'route.search', titleKey: 'command.route.search', defaultShortcut: null },
  { id: 'route.jobs', titleKey: 'command.route.jobs', defaultShortcut: null },
  { id: 'route.operations', titleKey: 'command.route.operations', defaultShortcut: null },
  { id: 'route.settings', titleKey: 'command.route.settings', defaultShortcut: null },
]

/** Editing and system keys that a custom shortcut must never take over. */
const RESERVED = new Set(['Ctrl+A', 'Ctrl+C', 'Ctrl+V', 'Ctrl+X', 'Ctrl+Z', 'Ctrl+Y', 'Ctrl+Shift+Z', 'Ctrl+S', 'Ctrl+F', 'Ctrl+Shift+P', 'Alt+F4'])
const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'OS'])
const STORAGE_KEY = 'agent-workspace.shortcuts.v1'

type Overrides = Readonly<Record<string, string | null>>
const listeners = new Set<() => void>()
let cached: { raw: string | null; value: Overrides } | null = null

/** Formats a key event the same way the global shortcut handler matches it. */
export function shortcutFromEvent(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>): string | null {
  if (MODIFIER_KEYS.has(event.key) || event.key === 'Dead' || event.key === 'Process' || event.key === 'Unidentified') return null
  const key = event.key === ' ' ? 'Space' : event.key.length === 1 ? event.key.toLocaleUpperCase() : event.key
  return [event.ctrlKey || event.metaKey ? 'Ctrl' : '', event.altKey ? 'Alt' : '', event.shiftKey ? 'Shift' : '', key].filter(Boolean).join('+')
}

export type ShortcutProblem = 'needsModifier' | 'reserved'

/** Shortcuts need Ctrl or Alt (or a function key) so typing never triggers them. */
export function shortcutProblem(shortcut: string): ShortcutProblem | null {
  if (RESERVED.has(shortcut)) return 'reserved'
  const parts = shortcut.split('+')
  const key = parts.at(-1) ?? ''
  const functionKey = /^F([1-9]|1[0-9]|2[0-4])$/.test(key)
  if (!functionKey && !parts.includes('Ctrl') && !parts.includes('Alt')) return 'needsModifier'
  return null
}

export function readShortcutOverrides(): Overrides {
  let raw: string | null = null
  try { raw = window.localStorage.getItem(STORAGE_KEY) } catch { /* Defaults apply. */ }
  if (cached && cached.raw === raw) return cached.value
  const value: Record<string, string | null> = {}
  try {
    const parsed = raw ? JSON.parse(raw) as unknown : null
    if (parsed && typeof parsed === 'object') {
      for (const command of SHORTCUT_COMMANDS) {
        const entry = (parsed as Record<string, unknown>)[command.id]
        if (entry === null) value[command.id] = null
        else if (typeof entry === 'string' && entry.length <= 64 && shortcutProblem(entry) === null) value[command.id] = entry
      }
    }
  } catch { /* Corrupt storage falls back to defaults. */ }
  cached = { raw, value }
  return value
}

function writeOverrides(next: Overrides): void {
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next)) } catch { /* Kept for this run only. */ }
  cached = { raw: JSON.stringify(next), value: next }
  for (const listener of listeners) listener()
}

export function resolveShortcuts(overrides: Overrides): Record<string, string | null> {
  const resolved: Record<string, string | null> = {}
  for (const command of SHORTCUT_COMMANDS) {
    resolved[command.id] = command.id in overrides ? overrides[command.id] : command.defaultShortcut
  }
  return resolved
}

/** The command already using a shortcut, ignoring `exceptId`. */
export function shortcutOwner(shortcut: string, overrides: Overrides, exceptId?: string): string | null {
  const resolved = resolveShortcuts(overrides)
  const wanted = shortcut.toLocaleLowerCase()
  for (const [id, value] of Object.entries(resolved)) {
    if (id !== exceptId && value?.toLocaleLowerCase() === wanted) return id
  }
  return null
}

export function setShortcut(commandId: string, shortcut: string | null): void {
  const command = SHORTCUT_COMMANDS.find((item) => item.id === commandId)
  if (!command) return
  const current = { ...readShortcutOverrides() }
  if (shortcut !== null && (shortcutProblem(shortcut) !== null || shortcutOwner(shortcut, current, commandId) !== null)) return
  if (shortcut === command.defaultShortcut) delete current[commandId]
  else current[commandId] = shortcut
  writeOverrides(current)
}

export function resetShortcuts(): void {
  writeOverrides({})
}

export function useShortcuts(): Record<string, string | null> {
  const overrides = useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => listeners.delete(listener) },
    readShortcutOverrides,
    () => ({}),
  )
  return useMemo(() => resolveShortcuts(overrides), [overrides])
}

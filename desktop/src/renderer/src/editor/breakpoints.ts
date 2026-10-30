import { useCallback, useSyncExternalStore } from 'react'

/** The breakpoints of each folder's files (1-based line numbers), for the editor's gutter and
 * the debugger; kept in local storage so they are there after a restart. */
const STORAGE_KEY = 'agent-workspace.breakpoints.v1'
type Folder = Readonly<Record<string, readonly number[]>>
const EMPTY: Folder = Object.freeze({})

class BreakpointStore {
  private folders: Record<string, Folder> | null = null
  private readonly listeners = new Set<() => void>()

  private all(): Record<string, Folder> {
    if (this.folders) return this.folders
    let stored: Record<string, Folder> = {}
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as unknown
      if (raw && typeof raw === 'object') stored = raw as Record<string, Folder>
    } catch {
      // Unreadable: start without breakpoints.
    }
    this.folders = stored
    return stored
  }

  folder(folder: string | null): Folder {
    return folder ? this.all()[folder] ?? EMPTY : EMPTY
  }

  set(folder: string, path: string, lines: readonly number[]): void {
    const next = [...new Set(lines.filter((line) => Number.isInteger(line) && line > 0))].sort((a, b) => a - b)
    const current = this.folder(folder)[path] ?? []
    if (current.length === next.length && current.every((line, index) => line === next[index])) return
    const files = { ...this.folder(folder) }
    if (next.length) files[path] = next
    else delete files[path]
    this.folders = { ...this.all(), [folder]: files }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.folders))
    } catch {
      // Only remembered for convenience.
    }
    for (const listener of this.listeners) listener()
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
}

export const breakpointStore = new BreakpointStore()

export function useBreakpoints(folder: string | null): Folder {
  const snapshot = useCallback(() => breakpointStore.folder(folder), [folder])
  return useSyncExternalStore(breakpointStore.subscribe, snapshot)
}

/** Files the debugger can run, for now Python. */
export function isDebuggable(path: string): boolean {
  return /\.py$/i.test(path)
}

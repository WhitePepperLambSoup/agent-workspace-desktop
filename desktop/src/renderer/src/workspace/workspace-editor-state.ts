import type { EditorTab } from '../editor/CodeEditor'
import type { WorkspaceFileItem } from '../editor/FileTree'

export interface WorkspaceEditorTab extends EditorTab {
  instanceId: number
}

export interface WorkspaceEditorState {
  tabs: WorkspaceEditorTab[]
  activeTabPath: string | null
  files: WorkspaceFileItem[]
  loadingFiles: boolean
  filesRequestId: number
  draftBackupFailed: boolean
  saveFailed: boolean
}

const DRAFT_STORAGE_PREFIX = 'agent-workspace.editor-drafts.v1:'
const MAX_DRAFT_BACKUP_CHARS = 1_000_000
const emptyState: WorkspaceEditorState = {
  tabs: [], activeTabPath: null, files: [], loadingFiles: false,
  filesRequestId: 0, draftBackupFailed: false, saveFailed: false,
}

const unprotectedStores = new Set<WorkspaceEditorStore>()
let mainProtectionReported = false
let unloadProtectionActive = false

function warnBeforeUnload(event: BeforeUnloadEvent): void {
  if (unprotectedStores.size === 0) return
  try {
    if (window.agentWorkspace?.isQuitApproved?.() === true) return
  } catch {
    // Keep protecting the draft if the main process cannot answer.
  }
  event.preventDefault()
  event.returnValue = ''
}

function syncUnloadProtection(store: WorkspaceEditorStore): void {
  if (store.hasUnprotectedDrafts()) unprotectedStores.add(store)
  else unprotectedStores.delete(store)
  const risk = unprotectedStores.size > 0
  if (risk && !unloadProtectionActive) {
    window.addEventListener('beforeunload', warnBeforeUnload)
    unloadProtectionActive = true
  } else if (!risk && unloadProtectionActive) {
    window.removeEventListener('beforeunload', warnBeforeUnload)
    unloadProtectionActive = false
  }
  if (risk !== mainProtectionReported) {
    try {
      if (window.agentWorkspace?.reportUnprotectedDrafts?.(risk) === true) mainProtectionReported = risk
    } catch {
      // The renderer unload guard still protects the draft if reporting fails.
    }
  }
}

function storageKey(workspacePath: string): string {
  return `${DRAFT_STORAGE_PREFIX}${encodeURIComponent(workspacePath)}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function restoredDraft(value: unknown, instanceId: number): WorkspaceEditorTab | null {
  if (!isRecord(value) || typeof value.path !== 'string' || typeof value.content !== 'string'
    || typeof value.originalContent !== 'string' || typeof value.sha256 !== 'string') return null
  if (value.content === value.originalContent) return null
  return {
    path: value.path,
    content: value.content,
    originalContent: value.originalContent,
    sha256: value.sha256,
    dirty: true,
    lineCount: value.content.split('\n').length,
    editable: true,
    instanceId,
  }
}

export class WorkspaceEditorStore {
  private readonly workspaces = new Map<string, WorkspaceEditorState>()
  private readonly listeners = new Set<() => void>()
  private readonly pendingWrites = new Set<string>()
  /** Files saved again while a write was on its way: written once more when it is done. */
  private readonly writeAgain = new Set<string>()
  private nextInstanceId = 1
  private nextFilesRequestId = 1

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  allocateTabId(): number {
    return this.nextInstanceId++
  }

  get(workspacePath: string | null): WorkspaceEditorState {
    if (!workspacePath) return emptyState
    const existing = this.workspaces.get(workspacePath)
    if (existing) return existing
    const restored = this.restore(workspacePath)
    this.workspaces.set(workspacePath, restored)
    return restored
  }

  update(workspacePath: string | null, change: (current: WorkspaceEditorState) => WorkspaceEditorState, backupDrafts = false): void {
    if (!workspacePath) return
    const current = this.get(workspacePath)
    const changed = change(current)
    if (changed === current) return
    const backupFailed = backupDrafts ? !this.backup(workspacePath, changed.tabs, changed.activeTabPath) : changed.draftBackupFailed
    this.workspaces.set(workspacePath, { ...changed, draftBackupFailed: backupFailed })
    syncUnloadProtection(this)
    for (const listener of this.listeners) listener()
  }

  beginFilesLoad(workspacePath: string): number {
    const requestId = this.nextFilesRequestId++
    this.update(workspacePath, (current) => ({ ...current, filesRequestId: requestId, loadingFiles: true }))
    return requestId
  }

  finishFilesLoad(workspacePath: string, requestId: number, files?: WorkspaceFileItem[]): void {
    this.update(workspacePath, (current) => current.filesRequestId === requestId
      ? { ...current, files: files ?? current.files, loadingFiles: false }
      : current)
  }

  beginWrite(workspacePath: string, filePath: string): WorkspaceEditorTab | null {
    const tab = this.get(workspacePath).tabs.find((item) => item.path === filePath)
    const key = `${workspacePath}\0${filePath}`
    if (tab?.dirty && (tab.saving || this.pendingWrites.has(key))) {
      // Saved again before the last save came back: the newer text is written after it.
      this.writeAgain.add(key)
      return null
    }
    if (!tab || !tab.dirty || tab.saving || this.pendingWrites.has(key)
      || tab.editable === false || tab.truncated || tab.isBinary) return null
    this.pendingWrites.add(key)
    this.update(workspacePath, (current) => ({
      ...current,
      saveFailed: false,
      tabs: current.tabs.map((item) => item.instanceId === tab.instanceId ? { ...item, saving: true } : item),
    }))
    return tab
  }

  /** True when the file was saved again meanwhile and should be written once more. */
  finishWrite(workspacePath: string, filePath: string, tab: WorkspaceEditorTab, sha256?: string): boolean {
    const key = `${workspacePath}\0${filePath}`
    this.pendingWrites.delete(key)
    const again = this.writeAgain.delete(key) && sha256 !== undefined
    this.update(workspacePath, (current) => ({
      ...current,
      saveFailed: sha256 === undefined,
      tabs: current.tabs.map((item) => {
        if (item.instanceId !== tab.instanceId) return item
        if (sha256 === undefined) return { ...item, saving: false }
        return {
          ...item,
          sha256,
          originalContent: tab.content,
          dirty: item.content !== tab.content,
          saving: false,
        }
      }),
    }), sha256 !== undefined)
    return again
  }

  hasUnprotectedDrafts(): boolean {
    return [...this.workspaces.values()].some((state) =>
      state.draftBackupFailed && state.tabs.some((tab) => tab.dirty))
  }

  private restore(workspacePath: string): WorkspaceEditorState {
    try {
      const raw = window.localStorage.getItem(storageKey(workspacePath))
      if (raw === null) return { ...emptyState }
      const value: unknown = JSON.parse(raw)
      if (!isRecord(value) || !Array.isArray(value.tabs)) return { ...emptyState, draftBackupFailed: true }
      const tabs = value.tabs.flatMap((tab): WorkspaceEditorTab[] => {
        const restored = restoredDraft(tab, this.allocateTabId())
        return restored ? [restored] : []
      })
      const activeTabPath = typeof value.activeTabPath === 'string'
        && tabs.some((tab) => tab.path === value.activeTabPath)
        ? value.activeTabPath : tabs[0]?.path ?? null
      return { ...emptyState, tabs, activeTabPath, draftBackupFailed: tabs.length !== value.tabs.length }
    } catch {
      return { ...emptyState, draftBackupFailed: true }
    }
  }

  private backup(workspacePath: string, tabs: WorkspaceEditorTab[], activeTabPath: string | null): boolean {
    try {
      const drafts = tabs.filter((tab) => tab.dirty).map((tab) => ({
        path: tab.path, content: tab.content, originalContent: tab.originalContent, sha256: tab.sha256,
      }))
      if (drafts.length === 0) {
        window.localStorage.removeItem(storageKey(workspacePath))
        return true
      }
      const serialized = JSON.stringify({ tabs: drafts, activeTabPath })
      if (serialized.length > MAX_DRAFT_BACKUP_CHARS) return false
      window.localStorage.setItem(storageKey(workspacePath), serialized)
      return true
    } catch {
      return false
    }
  }
}

const clientStores = new WeakMap<object, WorkspaceEditorStore>()
const unavailableClientStore = new WorkspaceEditorStore()

export function editorStoreFor(client?: object): WorkspaceEditorStore {
  if (!client) return unavailableClientStore
  let store = clientStores.get(client)
  if (!store) {
    store = new WorkspaceEditorStore()
    clientStores.set(client, store)
  }
  return store
}

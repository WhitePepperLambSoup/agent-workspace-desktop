import type { MessageKey } from '../i18n/messages'
import type { AttachmentCapability } from '../../../shared/attachments'

export type DraftAttachment = AttachmentCapability

export interface ComposerDraft {
  draft: string
  revision: number
  previousDraft: string | null
  optimizationStatus: boolean
  submitError: MessageKey | null
  submitErrorCode: string | null
  submitting: boolean
  optimizing: boolean
  cancelling: boolean
  retryInputId: string | null
  retryTurnId: string | null
  attachments: readonly DraftAttachment[]
  attachmentImports: number
  attachmentError: MessageKey | null
  inFlightAttachmentIds: readonly string[]
}

export function composerDraftScope(workspacePath: string | null | undefined, sessionId: string | null): string {
  const path = (workspacePath ?? '').trim().replace(/\\/g, '/').replace(/\/+$/, '')
  return JSON.stringify([/^[a-z]:\//i.test(path) ? path.toLowerCase() : path, sessionId])
}

function emptyDraft(): ComposerDraft {
  return { draft: '', revision: 0, previousDraft: null, optimizationStatus: false,
    submitError: null, submitErrorCode: null, submitting: false, optimizing: false,
    cancelling: false, retryInputId: null, retryTurnId: null, attachments: [],
    attachmentImports: 0, attachmentError: null, inFlightAttachmentIds: [] }
}

/** Kept by the bridge so changing routes never disposes a conversation's draft. */
export class ComposerDraftStore {
  private readonly drafts = new Map<string, ComposerDraft>()
  private readonly listeners = new Map<string, Set<() => void>>()
  private readonly pendingImportScopes = new Map<string, string>()

  private resolvedScope(scope: string): string {
    return this.pendingImportScopes.get(scope) ?? scope
  }

  get(scope: string): ComposerDraft {
    scope = this.resolvedScope(scope)
    let draft = this.drafts.get(scope)
    if (!draft) {
      draft = emptyDraft()
      this.drafts.set(scope, draft)
    }
    return draft
  }

  subscribe(scope: string, listener: () => void): () => void {
    scope = this.resolvedScope(scope)
    const listeners = this.listeners.get(scope) ?? new Set<() => void>()
    listeners.add(listener)
    this.listeners.set(scope, listeners)
    return () => {
      listeners.delete(listener)
      if (listeners.size === 0) this.listeners.delete(scope)
    }
  }

  update(scope: string, update: (draft: ComposerDraft) => ComposerDraft): void {
    scope = this.resolvedScope(scope)
    const previous = this.get(scope)
    const next = update(previous)
    if (next === previous) return
    this.drafts.set(scope, next)
    if (next.attachmentImports === 0) {
      for (const [origin, destination] of this.pendingImportScopes) {
        if (destination === scope) this.pendingImportScopes.delete(origin)
      }
    }
    for (const listener of this.listeners.get(scope) ?? []) listener()
  }

  edit(scope: string, draft: string): void {
    this.update(scope, (previous) => ({ ...previous, draft, revision: previous.revision + 1,
      previousDraft: null, optimizationStatus: false, retryInputId: null, retryTurnId: null,
      submitError: null, submitErrorCode: null }))
  }

  setAttachments(scope: string, update: (attachments: readonly DraftAttachment[]) => readonly DraftAttachment[]): void {
    this.update(scope, (previous) => {
      const attachments = update(previous.attachments)
      return { ...previous, attachments, retryInputId: null, retryTurnId: null }
    })
  }

  consumeAttachments(scope: string, ids: readonly string[]): void {
    if (ids.length === 0) return
    const accepted = new Set(ids)
    this.update(scope, (previous) => ({ ...previous,
      attachments: previous.attachments.filter((item) => !accepted.has(item.id)) }))
  }

  migrateStartupDraft(from: string, to: string): void {
    if (this.resolvedScope(from) === this.resolvedScope(to)) return
    // A newly restored session can adopt its folder's startup draft. Opening
    // a different folder must never carry its files or instructions across.
    const source = this.get(from)
    try {
      const originWorkspace = JSON.parse(from)[0]
      const destinationWorkspace = JSON.parse(to)[0]
      if (originWorkspace !== destinationWorkspace &&
        !(originWorkspace === '' && source.attachments.length === 0 && source.attachmentImports === 0)) return
    } catch { return }
    const destination = this.get(to)
    if (source.submitting || source.optimizing || destination.revision > 0 || destination.attachments.length > 0) return
    if (!source.draft && source.attachments.length === 0 && source.attachmentImports === 0) return
    this.update(to, () => ({ ...source }))
    this.update(from, () => emptyDraft())
    // Imports capture the original scope before their asynchronous byte read.
    // Redirect those callbacks until the adopted draft's last import finishes.
    if (source.attachmentImports > 0) this.pendingImportScopes.set(from, to)
  }
}

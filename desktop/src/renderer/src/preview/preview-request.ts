/**
 * Anything in the window can ask for a web page or a file of the open folder to be shown; the
 * workbench opens the preview. Office files keep their own preview; pages, PDFs and pictures go to
 * the preview panel, and other files to the reader.
 */
import { isOfficePath } from '../office/model'
import { requestDocumentPreview } from '../office/preview-request'

/** The turn whose change list a file was opened from, so the reader can show that change. */
export interface FileChange {
  sessionId: string
  eventId: string
}

export type PreviewRequest =
  | { kind: 'url'; url: string }
  /** view 'changes' shows the change in the reader, for a page or picture too; page opens a PDF there. */
  | { kind: 'file'; path: string; change?: FileChange; view?: 'changes'; page?: number }

export const PREVIEW_EVENT = 'agent-workspace:preview'

export function requestPreview(request: PreviewRequest): void {
  window.dispatchEvent(new CustomEvent<PreviewRequest>(PREVIEW_EVENT, { detail: request }))
}

export function openWorkspaceFile(path: string, change?: FileChange, page?: number): void {
  if (isOfficePath(path)) {
    requestDocumentPreview({ path })
    return
  }
  requestPreview({ kind: 'file', path, ...(change ? { change } : {}), ...(page ? { page } : {}) })
}

/** What one turn changed in a file. */
export function openFileChange(path: string, change: FileChange): void {
  requestPreview({ kind: 'file', path, change, view: 'changes' })
}

/** A file to open in the Files page's editor (read when that page next opens). */
export const OPEN_IN_EDITOR_EVENT = 'agent-workspace:open-in-editor'
let pendingEditorPath: string | null = null

export function requestEditor(path: string): void {
  pendingEditorPath = path
  window.dispatchEvent(new CustomEvent<string>(OPEN_IN_EDITOR_EVENT, { detail: path }))
}

export function takeEditorRequest(): string | null {
  const path = pendingEditorPath
  pendingEditorPath = null
  return path
}

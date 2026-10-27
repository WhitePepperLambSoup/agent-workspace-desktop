/**
 * Anything in the window can ask for an Office file to be previewed; the workbench shows the
 * dialog. The digest of the content a change replaced adds that earlier version, and the digest
 * the change produced tells whether the file changed again since.
 */

export interface DocumentPreviewRequest {
  path: string
  previousSha256?: string
  resultSha256?: string
}

export const DOCUMENT_PREVIEW_EVENT = 'agent-workspace:preview-document'

export function requestDocumentPreview(request: DocumentPreviewRequest): void {
  window.dispatchEvent(new CustomEvent<DocumentPreviewRequest>(DOCUMENT_PREVIEW_EVENT, { detail: request }))
}

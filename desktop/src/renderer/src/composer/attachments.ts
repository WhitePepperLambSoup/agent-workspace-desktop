import { ATTACHMENT_LIMITS, type AttachmentCapability, type AttachmentImportFile } from '../../../shared/attachments'
import type { MessageKey } from '../i18n/messages'

const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/

export function normalizeAttachmentCapabilities(values: readonly AttachmentCapability[], maximum: number = ATTACHMENT_LIMITS.files): AttachmentCapability[] {
  const attachments: AttachmentCapability[] = []
  const ids = new Set<string>()
  for (const item of values) {
    const name = item.name.trim()
    if (
      ids.has(item.id) ||
      !OPAQUE_ID.test(item.id) ||
      name.length === 0 ||
      name.length > 240 ||
      /[\\/]/.test(name) ||
      /^[A-Za-z]:/.test(name)
    ) continue
    ids.add(item.id)
    const capability: AttachmentCapability = { id: item.id, name }
    if (typeof item.mediaType === 'string' && /^[\w.+-]+\/[\w.+-]+$/.test(item.mediaType)) capability.mediaType = item.mediaType.toLowerCase()
    if (typeof item.sizeBytes === 'number' && Number.isSafeInteger(item.sizeBytes) && item.sizeBytes >= 0) capability.sizeBytes = item.sizeBytes
    if (typeof item.previewDataUrl === 'string' && item.previewDataUrl.length <= ATTACHMENT_LIMITS.previewDataUrlBytes
      && /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+=*$/.test(item.previewDataUrl)) capability.previewDataUrl = item.previewDataUrl
    attachments.push(capability)
    if (attachments.length === maximum) break
  }
  return attachments
}

function isImage(item: { name: string; mediaType?: string }): boolean {
  return /^(image\/(png|jpeg|gif|webp))$/.test(item.mediaType ?? '') || /\.(png|jpe?g|gif|webp)$/i.test(item.name)
}

function validateBatch(values: readonly { name: string; mediaType?: string; sizeBytes?: number }[]): void {
  if (values.length > ATTACHMENT_LIMITS.files) throw new Error('too_many_attachments')
  const images = values.filter(isImage)
  if (images.length > ATTACHMENT_LIMITS.images) throw new Error('too_many_image_attachments')
  let total = 0
  let imageTotal = 0
  for (const item of values) {
    const bytes = item.sizeBytes ?? 0
    const image = isImage(item)
    if (bytes > (image ? ATTACHMENT_LIMITS.imageBytes : ATTACHMENT_LIMITS.fileBytes)) throw new Error(image ? 'image_attachment_too_large' : 'attachment_too_large')
    total += bytes
    if (image) imageTotal += bytes
  }
  if (total > ATTACHMENT_LIMITS.totalBytes || imageTotal > ATTACHMENT_LIMITS.imageTotalBytes) throw new Error('attachments_too_large')
}

export function mergeAttachmentCapabilities(current: readonly AttachmentCapability[], added: readonly AttachmentCapability[]): AttachmentCapability[] {
  const values = normalizeAttachmentCapabilities([...current, ...added], ATTACHMENT_LIMITS.files + 1)
  validateBatch(values)
  return values
}

export async function readAttachmentFiles(files: readonly File[]): Promise<AttachmentImportFile[]> {
  // Check sizes before reading: an accidental large paste must not allocate its whole contents.
  validateBatch(files.map(file => ({ name: file.name, mediaType: file.type, sizeBytes: file.size })))
  return Promise.all(files.map(async file => ({ name: file.name, mediaType: file.type, data: new Uint8Array(await file.arrayBuffer()) })))
}

export function attachmentErrorMessage(error: unknown): MessageKey {
  const message = error instanceof Error ? error.message : String(error)
  if (/unsupported_image_input/.test(message)) return 'composer.error.visionUnsupported'
  if (/too_many_image_attachments|too_many_images/.test(message)) return 'composer.error.tooManyImages'
  if (/too_many_attachments/.test(message)) return 'composer.error.tooManyAttachments'
  if (/image_attachment_too_large|image_too_large/.test(message)) return 'composer.error.imageTooLarge'
  if (/attachment.*too_large|file_too_large/.test(message)) return 'composer.error.attachmentsTooLarge'
  if (/unsupported_image_type|invalid_image_attachment|invalid_image_data|invalid_attachment_image/.test(message)) return 'composer.error.imageInvalid'
  if (/workspace_unavailable|no_workspace/.test(message)) return 'composer.error.noWorkspace'
  if (/workspace_changed/.test(message)) return 'composer.error.workspaceChanged'
  if (/clipboard_empty/.test(message)) return 'composer.error.clipboardEmpty'
  return 'workbench.attachFailed'
}

import { ATTACHMENT_LIMITS, type AttachmentCapability, type AttachmentImportFile } from './attachments'

const MEDIA_TYPE = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

export function parseAttachmentCapabilities(input: unknown): AttachmentCapability[] {
  if (!Array.isArray(input)) throw new Error('invalid_attachment_selection')
  if (input.length > ATTACHMENT_LIMITS.files) throw new Error('too_many_attachments')
  return input.map((item: unknown) => {
    if (!item || typeof item !== 'object') throw new Error('invalid_attachment_selection')
    const { id, name, mediaType, sizeBytes, previewDataUrl } = item as Partial<AttachmentCapability>
    if (typeof id !== 'string' || !id || id.length > 256 || typeof name !== 'string' || !name || name.length > 240 ||
      (mediaType !== undefined && (typeof mediaType !== 'string' || mediaType.length > 160 || !MEDIA_TYPE.test(mediaType))) ||
      (sizeBytes !== undefined && (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0 || sizeBytes > ATTACHMENT_LIMITS.fileBytes)) ||
      (previewDataUrl !== undefined && (typeof previewDataUrl !== 'string' || previewDataUrl.length > ATTACHMENT_LIMITS.previewDataUrlBytes ||
        !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(previewDataUrl)))) {
      throw new Error('invalid_attachment_selection')
    }
    return { id, name, ...(mediaType === undefined ? {} : { mediaType }),
      ...(sizeBytes === undefined ? {} : { sizeBytes }), ...(previewDataUrl === undefined ? {} : { previewDataUrl }) }
  })
}

export function validateAttachmentImports(input: readonly AttachmentImportFile[]): void {
  if (!Array.isArray(input)) throw new Error('invalid_attachment_files')
  if (input.length > ATTACHMENT_LIMITS.files) throw new Error('too_many_attachments')
  let total = 0
  let images = 0
  let imageTotal = 0
  for (const file of input) {
    if (!file || typeof file !== 'object' || typeof file.name !== 'string' || !file.name || file.name.length > 240 ||
      typeof file.mediaType !== 'string' || file.mediaType.length > 160 ||
      (file.mediaType !== '' && !MEDIA_TYPE.test(file.mediaType)) || !(file.data instanceof Uint8Array)) {
      throw new Error('invalid_attachment_files')
    }
    if (file.data.byteLength > ATTACHMENT_LIMITS.fileBytes) throw new Error('attachment_file_too_large')
    total += file.data.byteLength
    if (IMAGE_TYPES.has(file.mediaType)) {
      images += 1
      imageTotal += file.data.byteLength
      if (file.data.byteLength > ATTACHMENT_LIMITS.imageBytes) throw new Error('attachment_image_too_large')
    }
  }
  if (images > ATTACHMENT_LIMITS.images) throw new Error('too_many_images')
  if (imageTotal > ATTACHMENT_LIMITS.imageTotalBytes) throw new Error('attachment_images_too_large')
  if (total > ATTACHMENT_LIMITS.totalBytes) throw new Error('attachments_too_large')
}

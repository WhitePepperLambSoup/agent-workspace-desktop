// Keep the clipboard, picker and composer limits consistent across processes.
export const ATTACHMENT_LIMITS = Object.freeze({
  files: 8,
  images: 4,
  imageBytes: 5 * 1024 * 1024,
  imageTotalBytes: 20 * 1024 * 1024,
  fileBytes: 20 * 1024 * 1024,
  totalBytes: 50 * 1024 * 1024,
  previewDataUrlBytes: 64 * 1024,
})

export interface AttachmentCapability {
  id: string
  name: string
  mediaType?: string
  sizeBytes?: number
  previewDataUrl?: string
}

export interface AttachmentImportFile {
  name: string
  mediaType: string
  data: Uint8Array
}

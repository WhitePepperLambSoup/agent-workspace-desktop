import { randomUUID } from 'node:crypto'
import { constants, lstatSync, realpathSync } from 'node:fs'
import { lstat, mkdir, open, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, parse, relative, resolve, sep } from 'node:path'

import { ATTACHMENT_LIMITS, type AttachmentCapability, type AttachmentImportFile } from '../shared/attachments'
export type { AttachmentCapability } from '../shared/attachments'

interface AttachmentRecord extends AttachmentCapability {
  path: string
  workspace: string
}

interface ImportEntry {
  name: string
  mediaType: string
  data: Buffer
  existingPath?: string
}

export interface AttachmentImporter {
  importFiles(files: readonly AttachmentImportFile[]): Promise<AttachmentCapability[]>
  importPaths(paths: readonly string[]): Promise<AttachmentCapability[]>
}

type ImagePreview = (data: Buffer, mediaType: string) => string | undefined

// Drafts can remain in multiple sessions/folders. Keep their capabilities while
// bounding abandoned file picks independently of the eight-file send limit.
const MAX_CACHED_ATTACHMENTS = 1024
const SUPPORTED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
const FILE_MEDIA_TYPES: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
  '.pdf': 'application/pdf', '.txt': 'text/plain', '.md': 'text/markdown',
  '.tex': 'application/x-tex', '.json': 'application/json', '.csv': 'text/csv',
  '.html': 'text/html', '.htm': 'text/html', '.xml': 'application/xml',
  '.svg': 'image/svg+xml', '.zip': 'application/zip', '.py': 'text/x-python',
  '.js': 'text/javascript', '.ts': 'text/plain',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
}

function isWithin(root: string, candidate: string): boolean {
  const distance = relative(root, candidate)
  return distance === '' || (distance !== '..' && !distance.startsWith(`..${sep}`) && !isAbsolute(distance))
}

function validateCount(count: number): void {
  if (count > ATTACHMENT_LIMITS.files) throw new Error('too_many_attachments')
}

function validateName(name: unknown): asserts name is string {
  if (typeof name !== 'string' || !name || name.length > 240 ||
    /[\\/\x00-\x1f\x7f<>:"|?*]/.test(name) || /[. ]$/.test(name) ||
    name === '.' || name === '..' || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) {
    throw new Error('invalid_attachment_name')
  }
}

function imageType(data: Buffer): string | undefined {
  if (data.length >= 24 && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    data.toString('ascii', 12, 16) === 'IHDR') return 'image/png'
  if (data.length >= 4 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg'
  if (data.length >= 13 && ['GIF87a', 'GIF89a'].includes(data.toString('ascii', 0, 6))) return 'image/gif'
  if (data.length >= 16 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
  return undefined
}

function validateImageDimensions(data: Buffer, mediaType: string): void {
  let width = 0
  let height = 0
  if (mediaType === 'image/png') {
    width = data.readUInt32BE(16)
    height = data.readUInt32BE(20)
  } else if (mediaType === 'image/gif') {
    width = data.readUInt16LE(6)
    height = data.readUInt16LE(8)
  } else if (mediaType === 'image/webp') {
    const chunk = data.toString('ascii', 12, 16)
    if (chunk === 'VP8X' && data.length >= 30) {
      width = data.readUIntLE(24, 3) + 1
      height = data.readUIntLE(27, 3) + 1
    } else if (chunk === 'VP8L' && data.length >= 25 && data[20] === 0x2f) {
      const packed = data.readUInt32LE(21)
      width = (packed & 0x3fff) + 1
      height = ((packed >>> 14) & 0x3fff) + 1
    } else if (chunk === 'VP8 ' && data.length >= 30 && data.subarray(23, 26).equals(Buffer.from([0x9d, 0x01, 0x2a]))) {
      width = data.readUInt16LE(26) & 0x3fff
      height = data.readUInt16LE(28) & 0x3fff
    }
  } else if (mediaType === 'image/jpeg') {
    let offset = 2
    while (offset < data.length) {
      if (data[offset++] !== 0xff) break
      while (data[offset] === 0xff) offset += 1
      const marker = data[offset++]
      if (marker === 0xd9 || marker === 0xda || offset + 2 > data.length) break
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue
      const length = data.readUInt16BE(offset)
      if (length < 2 || offset + length > data.length) break
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker) && length >= 8) {
        height = data.readUInt16BE(offset + 3)
        width = data.readUInt16BE(offset + 5)
        break
      }
      offset += length
    }
  }
  if (!width || !height) throw new Error('invalid_attachment_image')
  if (width * height > 40 * 1024 * 1024) throw new Error('attachment_image_too_large')
}

function mediaTypeFor(name: string, declared: unknown, data: Buffer): string {
  const detected = imageType(data)
  const extensionType = FILE_MEDIA_TYPES[extname(name).toLowerCase()]
  const provided = typeof declared === 'string' ? declared.split(';', 1)[0].trim().toLowerCase() : ''
  if (provided && (provided.length > 160 || !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(provided))) {
    throw new Error('invalid_attachment_media_type')
  }
  if (detected) {
    validateImageDimensions(data, detected)
    return detected
  }
  // SVG and other non-vision image formats remain useful file references. They
  // are never turned into raster previews or sent as supported vision images.
  if (SUPPORTED_IMAGE_TYPES.has(provided) || (extensionType && SUPPORTED_IMAGE_TYPES.has(extensionType))) {
    throw new Error('invalid_attachment_image')
  }
  return extensionType || provided || 'application/octet-stream'
}

function validateMetrics(entries: readonly { mediaType?: string; sizeBytes: number }[]): void {
  validateCount(entries.length)
  let images = 0
  let imageBytes = 0
  let totalBytes = 0
  for (const entry of entries) {
    const size = entry.sizeBytes
    totalBytes += size
    if (SUPPORTED_IMAGE_TYPES.has(entry.mediaType ?? '')) {
      images += 1
      imageBytes += size
      if (size > ATTACHMENT_LIMITS.imageBytes) throw new Error('attachment_image_too_large')
    } else if (size > ATTACHMENT_LIMITS.fileBytes) {
      throw new Error('attachment_file_too_large')
    }
  }
  if (images > ATTACHMENT_LIMITS.images) throw new Error('too_many_images')
  if (imageBytes > ATTACHMENT_LIMITS.imageTotalBytes) throw new Error('attachment_images_too_large')
  if (totalBytes > ATTACHMENT_LIMITS.totalBytes) throw new Error('attachments_too_large')
}

function noSymlinkComponents(path: string): boolean {
  const root = parse(path).root
  let current = root
  for (const component of relative(root, path).split(sep).filter(Boolean)) {
    current = resolve(current, component)
    try {
      if (lstatSync(current).isSymbolicLink()) return false
    } catch {
      return false
    }
  }
  return true
}

function regularFileWithin(workspace: string, path: string): boolean {
  try {
    return isWithin(workspace, path) && noSymlinkComponents(path) && lstatSync(path).isFile() &&
      isWithin(realpathSync(workspace), realpathSync(path))
  } catch {
    return false
  }
}

async function safeStagingDirectory(workspace: string): Promise<string> {
  const directories = [resolve(workspace, '.agent-workspace'), resolve(workspace, '.agent-workspace', 'attachments')]
  for (const directory of directories) {
    try {
      await mkdir(directory)
    } catch (error: unknown) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST')) {
        throw new Error('attachment_import_failed')
      }
    }
    if (!(await lstat(directory)).isDirectory() || !noSymlinkComponents(directory) ||
      !isWithin(realpathSync(workspace), realpathSync(directory))) {
      throw new Error('unsafe_attachment_directory')
    }
  }
  return directories[1]
}

export class AttachmentRegistry {
  private workspace: string | null = null
  private readonly records = new Map<string, AttachmentRecord>()

  constructor(private readonly imagePreview?: ImagePreview) {}

  setWorkspace(path: string | null): void {
    this.workspace = path ? resolve(path) : null
  }

  private requestedWorkspace(path: unknown): string {
    if (!this.workspace) throw new Error('workspace_unavailable')
    if (typeof path !== 'string' || path.length > 4096 || !isAbsolute(path) || resolve(path) !== this.workspace) {
      throw new Error('attachment_workspace_changed')
    }
    if (!noSymlinkComponents(this.workspace) || !lstatSync(this.workspace).isDirectory()) {
      throw new Error('unsafe_attachment_directory')
    }
    return this.workspace
  }

  private register(workspace: string, path: string, metadata?: Pick<AttachmentCapability, 'mediaType' | 'previewDataUrl' | 'sizeBytes'>): AttachmentCapability {
    const capability = { id: randomUUID(), name: basename(path), ...metadata }
    this.records.set(capability.id, { ...capability, path, workspace })
    if (this.records.size > MAX_CACHED_ATTACHMENTS) {
      const oldestId = this.records.keys().next().value
      if (oldestId !== undefined) this.records.delete(oldestId)
    }
    return capability
  }

  issue(paths: readonly string[]): AttachmentCapability[] {
    if (!this.workspace) throw new Error('workspace_unavailable')
    validateCount(paths.length)
    const workspace = this.workspace
    const validated = paths.map((rawPath) => {
      const path = resolve(rawPath)
      if (!regularFileWithin(workspace, path)) throw new Error('attachment_outside_workspace')
      return { path, mediaType: FILE_MEDIA_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream', sizeBytes: lstatSync(path).size }
    })
    validateMetrics(validated)
    return validated.map(({ path, ...metadata }) => this.register(workspace, path, metadata))
  }

  // Capture the workspace before opening a dialog or awaiting the native
  // clipboard. A later folder switch must not redirect these user-owned files.
  captureImporter(workspacePath: string): AttachmentImporter {
    const workspace = this.requestedWorkspace(workspacePath)
    return {
      importFiles: async (files) => this.importByteEntries(files, workspace),
      importPaths: async (paths) => this.importPathEntries(paths, workspace),
    }
  }

  async importFiles(files: readonly AttachmentImportFile[], workspacePath: string): Promise<AttachmentCapability[]> {
    return this.captureImporter(workspacePath).importFiles(files)
  }

  async importPaths(paths: readonly string[], workspacePath: string): Promise<AttachmentCapability[]> {
    return this.captureImporter(workspacePath).importPaths(paths)
  }

  private async importByteEntries(files: readonly AttachmentImportFile[], workspace: string): Promise<AttachmentCapability[]> {
    if (!Array.isArray(files)) throw new Error('invalid_attachment_files')
    validateCount(files.length)
    let receivedBytes = 0
    const entries = files.map((file: AttachmentImportFile) => {
      if (!file || typeof file !== 'object') throw new Error('invalid_attachment_files')
      validateName(file.name)
      if (!(file.data instanceof Uint8Array) || file.data.byteLength > ATTACHMENT_LIMITS.fileBytes) {
        throw new Error('attachment_file_too_large')
      }
      receivedBytes += file.data.byteLength
      if (receivedBytes > ATTACHMENT_LIMITS.totalBytes) throw new Error('attachments_too_large')
      const data = Buffer.from(file.data)
      return { name: file.name, mediaType: mediaTypeFor(file.name, file.mediaType, data), data }
    })
    validateMetrics(entries.map((entry) => ({ mediaType: entry.mediaType, sizeBytes: entry.data.length })))
    return this.persist(entries, workspace)
  }

  private async importPathEntries(paths: readonly string[], workspace: string): Promise<AttachmentCapability[]> {
    if (!Array.isArray(paths)) throw new Error('invalid_attachment_files')
    validateCount(paths.length)
    const descriptors = await Promise.all(paths.map(async (rawPath) => {
      if (typeof rawPath !== 'string' || rawPath.length > 4096 || !isAbsolute(rawPath) || rawPath.split(/[\\/]/).includes('..')) throw new Error('invalid_attachment_file')
      const path = resolve(rawPath)
      const name = basename(path)
      validateName(name)
      let info
      try {
        info = await lstat(path)
        if (!info.isFile() || !noSymlinkComponents(path)) throw new Error('invalid_attachment_file')
      } catch {
        throw new Error('invalid_attachment_file')
      }
      if (info.size > ATTACHMENT_LIMITS.fileBytes) throw new Error('attachment_file_too_large')
      return { path, name, size: info.size, ino: info.ino, dev: info.dev }
    }))
    if (descriptors.reduce((sum, entry) => sum + entry.size, 0) > ATTACHMENT_LIMITS.totalBytes) throw new Error('attachments_too_large')
    const entries = await Promise.all(descriptors.map(async ({ path, name, size, ino, dev }) => {
      const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
      try {
        const info = await file.stat()
        if (!info.isFile() || info.size !== size || info.ino !== ino || info.dev !== dev || !noSymlinkComponents(path)) throw new Error('invalid_attachment_file')
        // Read at most the checked size plus one byte. A file growing during
        // import cannot make readFile allocate an unbounded clipboard payload.
        const bounded = Buffer.alloc(size + 1)
        let length = 0
        while (length < bounded.length) {
          const { bytesRead } = await file.read(bounded, length, bounded.length - length, length)
          if (bytesRead === 0) break
          length += bytesRead
        }
        if (length !== size || (await file.stat()).size !== size) throw new Error('attachment_file_changed')
        const data = bounded.subarray(0, length)
        return { name, mediaType: mediaTypeFor(name, '', data), data,
          ...(isWithin(workspace, path) ? { existingPath: path } : {}) }
      } finally {
        await file.close()
      }
    }))
    validateMetrics(entries.map((entry) => ({ mediaType: entry.mediaType, sizeBytes: entry.data.length })))
    return this.persist(entries, workspace)
  }

  private async persist(entries: readonly ImportEntry[], workspace: string): Promise<AttachmentCapability[]> {
    if (entries.length === 0) return []
    const metadata = entries.map((entry) => {
      let previewDataUrl: string | undefined
      if (SUPPORTED_IMAGE_TYPES.has(entry.mediaType)) {
        previewDataUrl = this.imagePreview?.(entry.data, entry.mediaType)
        if (previewDataUrl && (previewDataUrl.length > ATTACHMENT_LIMITS.previewDataUrlBytes ||
          !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(previewDataUrl))) previewDataUrl = undefined
      }
      return { mediaType: entry.mediaType, sizeBytes: entry.data.length, ...(previewDataUrl ? { previewDataUrl } : {}) }
    })
    let batchDirectory: string | undefined
    const paths: string[] = []
    try {
      if (entries.some((entry) => !entry.existingPath)) {
        const staging = await safeStagingDirectory(workspace)
        batchDirectory = resolve(staging, randomUUID())
        await mkdir(batchDirectory)
      }
      for (const entry of entries) {
        if (entry.existingPath) {
          if (!regularFileWithin(workspace, entry.existingPath)) throw new Error('invalid_attachment_file')
          paths.push(entry.existingPath)
        } else {
          if (!batchDirectory || !noSymlinkComponents(batchDirectory)) throw new Error('unsafe_attachment_directory')
          // Repeated copied names in one batch must each remain distinct.
          let path = resolve(batchDirectory, entry.name)
          if (paths.includes(path)) {
            const uniqueDirectory = resolve(batchDirectory, randomUUID())
            await mkdir(uniqueDirectory)
            path = resolve(uniqueDirectory, entry.name)
          }
          await writeFile(path, entry.data, { flag: 'wx', mode: 0o600 })
          if (!regularFileWithin(workspace, path)) throw new Error('unsafe_attachment_directory')
          paths.push(path)
        }
      }
    } catch (error) {
      // Only our fresh UUID batch can be removed. Existing user files and the
      // persistent attachment store are never deleted on a failed import.
      if (batchDirectory && noSymlinkComponents(dirname(batchDirectory))) await rm(batchDirectory, { recursive: true, force: true })
      if (error instanceof Error && /^[a-z_]+$/.test(error.message)) throw error
      throw new Error('attachment_import_failed')
    }
    return paths.map((path, index) => this.register(workspace, path, metadata[index]))
  }

  resolve(ids: readonly string[]): string[] {
    validateCount(ids.length)
    if (ids.length === 0) return []
    if (!this.workspace) throw new Error('workspace_unavailable')
    const workspace = this.workspace
    const records = ids.map((id) => {
      const record = this.records.get(id)
      if (!record || record.workspace !== workspace || !regularFileWithin(workspace, record.path)) {
        throw new Error('unknown_attachment')
      }
      return record
    })
    validateMetrics(records.map((record) => ({ mediaType: record.mediaType, sizeBytes: lstatSync(record.path).size })))
    return records.map((record) => relative(workspace, record.path).split(sep).join('/'))
  }

  consume(ids: readonly string[]): void {
    // A successful turn response can arrive after switching folders. Revoke
    // exactly the sent IDs, even when their owning workspace is now inactive.
    for (const id of ids) this.records.delete(id)
  }
}

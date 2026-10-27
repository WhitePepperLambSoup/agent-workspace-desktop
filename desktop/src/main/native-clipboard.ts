import { execFile } from 'node:child_process'
import { win32, isAbsolute } from 'node:path'
import { promisify } from 'node:util'

import { ATTACHMENT_LIMITS, type AttachmentImportFile } from '../shared/attachments'

interface ClipboardImage {
  isEmpty(): boolean
  getSize(): { width: number; height: number }
  toPNG(): Buffer
}

interface ClipboardReader {
  availableFormats(): string[]
  readBuffer(format: string): Buffer
  readImage(): ClipboardImage
  readText(): string
}

type ClipboardAttachments = { paths: string[] } | { files: AttachmentImportFile[] }
const FILE_FORMATS = new Set(['cf_hdrop', 'filenamew', 'filename', 'text/uri-list', 'filedrop', 'application/x-moz-file'])
const IMAGE_FORMAT = /^(image\/(png|jpeg|gif|webp|bmp)|png|bitmap|dib|dibv5|cf_bitmap|cf_dib|cf_dibv5)$/i
const MAX_NATIVE_BYTES = 64 * 1024
const executeFile = promisify(execFile)

function validatedPaths(paths: readonly unknown[]): string[] {
  if (paths.length > ATTACHMENT_LIMITS.files) throw new Error('too_many_attachments')
  if (paths.some((path) => typeof path !== 'string' || path.length > 4096 ||
    /[\x00-\x1f]/.test(path) || !(win32.isAbsolute(path) || isAbsolute(path)))) throw new Error('invalid_clipboard_files')
  return paths as string[]
}

function decodeFileUriList(buffer: Buffer, platform: string): string[] {
  if (buffer.length === 0 || buffer.length > MAX_NATIVE_BYTES) throw new Error('invalid_clipboard_files')
  const lines = buffer.toString('utf8').replace(/^\uFEFF/, '').replace(/\0+$/, '').split(/\r?\n/)
    .map((line) => line.trim()).filter((line) => line && !line.startsWith('#'))
  if (lines.length === 0) throw new Error('invalid_clipboard_files')
  const paths = lines.map((line) => {
    try {
      const url = new URL(line)
      if (url.protocol !== 'file:' || url.search || url.hash) throw new Error()
      const pathname = decodeURIComponent(url.pathname)
      return platform === 'win32' ? `${url.hostname ? `//${url.hostname}` : ''}${pathname.replace(/^\/(\w:)/, '$1')}` : pathname
    } catch { throw new Error('invalid_clipboard_files') }
  })
  return validatedPaths(paths)
}

export function decodeFileDrop(buffer: Buffer): string[] {
  if (buffer.length < 20 || buffer.length > MAX_NATIVE_BYTES) throw new Error('invalid_clipboard_files')
  const offset = buffer.readUInt32LE(0)
  const wide = buffer.readUInt32LE(16) !== 0
  if (offset < 20 || offset >= buffer.length || (wide && (buffer.length - offset) % 2 !== 0)) throw new Error('invalid_clipboard_files')
  const content = buffer.subarray(offset).toString(wide ? 'utf16le' : 'latin1')
  if (!content.endsWith('\0\0')) throw new Error('invalid_clipboard_files')
  const paths = content.slice(0, -2).split('\0').filter(Boolean)
  return validatedPaths(paths)
}

// This probe runs during a paste event. Bitmap format names are sufficient;
// Chromium sometimes exposes Explorer selections only as text/uri-list, so
// inspect its small payload to distinguish local files from copied web links.
export function clipboardHasAttachments(
  clipboard: Pick<ClipboardReader, 'availableFormats' | 'readBuffer' | 'readText'>,
  platform: string = process.platform,
): boolean {
  const formats = clipboard.availableFormats()
  if (formats.some((format) =>
    (format.toLowerCase() !== 'text/uri-list' && FILE_FORMATS.has(format.toLowerCase())) || IMAGE_FORMAT.test(format))) return true
  const uriList = formats.find((format) => format.toLowerCase() === 'text/uri-list')
  if (!uriList) return false
  try {
    const buffer = clipboard.readBuffer(uriList)
    if (buffer.length === 0) {
      // Chromium synthesizes this lone type for Windows CF_HDROP. Electron's
      // custom-format APIs cannot read that built-in native payload. A copied
      // ordinary link supplies text or readable URI bytes and stays native.
      return platform === 'win32' && formats.length === 1 && clipboard.readText().length === 0
    }
    return decodeFileUriList(buffer, platform).length > 0
  } catch (error: unknown) {
    if (error instanceof Error && error.message === 'too_many_attachments') return true
    return false
  }
}

export async function readWindowsFileDropList(): Promise<string[]> {
  // Electron's readBuffer exposes registered formats; the built-in CF_HDROP is
  // not consistently exposed. STA WinForms reads the actual native file list,
  // including multiple Explorer selections. No clipboard path enters a command.
  const script = '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); Add-Type -AssemblyName System.Windows.Forms; $copiedPaths = @([System.Windows.Forms.Clipboard]::GetFileDropList()); ConvertTo-Json -InputObject $copiedPaths -Compress'
  try {
    const { stdout } = await executeFile('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-STA', '-WindowStyle', 'Hidden', '-Command', script,
    ], { windowsHide: true, timeout: 3500, maxBuffer: MAX_NATIVE_BYTES, encoding: 'utf8' })
    const result: unknown = JSON.parse(stdout.replace(/^\uFEFF/, '').trim())
    if (!Array.isArray(result)) throw new Error('invalid_clipboard_files')
    return validatedPaths(result)
  } catch (error: unknown) {
    if (error instanceof Error && ['invalid_clipboard_files', 'too_many_attachments'].includes(error.message)) throw error
    throw new Error('clipboard_unavailable')
  }
}

export async function readClipboardAttachments(
  clipboard: ClipboardReader,
  platform: string = process.platform,
  windowsFileDrop: () => Promise<string[]> = readWindowsFileDropList,
): Promise<ClipboardAttachments> {
  const formats = clipboard.availableFormats()
  const fileFormats = formats.filter((format) => FILE_FORMATS.has(format.toLowerCase()))
  if (fileFormats.length > 0) {
    const dropName = fileFormats.find((format) => format.toLowerCase() === 'cf_hdrop')
    if (dropName) {
      const drop = clipboard.readBuffer(dropName)
      if (drop.length > 0) return { paths: decodeFileDrop(drop) }
    }
    // FileNameW alone commonly exposes only the first file. Ask the OS for the
    // whole list before using that compatibility fallback.
    if (platform === 'win32') {
      try {
        const paths = await windowsFileDrop()
        if (paths.length > 0) return { paths: validatedPaths(paths) }
      } catch (error: unknown) {
        if (!(error instanceof Error && error.message === 'clipboard_unavailable')) throw error
      }
    }
    const unicodeName = fileFormats.find((format) => format.toLowerCase() === 'filenamew')
    if (unicodeName) {
      const buffer = clipboard.readBuffer(unicodeName)
      if (buffer.length > 0 && buffer.length <= MAX_NATIVE_BYTES && buffer.length % 2 === 0) {
        return { paths: validatedPaths(buffer.toString('utf16le').split('\0').filter(Boolean)) }
      }
    }
    const uriList = fileFormats.find((format) => format.toLowerCase() === 'text/uri-list')
    if (uriList) {
      const buffer = clipboard.readBuffer(uriList)
      return { paths: decodeFileUriList(buffer, platform) }
    }
    throw new Error('clipboard_files_unavailable')
  }
  if (!formats.some((format) => IMAGE_FORMAT.test(format))) return { files: [] }
  const image = clipboard.readImage()
  if (image.isEmpty()) throw new Error('invalid_attachment_image')
  const { width, height } = image.getSize()
  // Bound the uncompressed encoding cost independently of the eventual 5 MiB
  // PNG limit. This guard runs before synchronously encoding the bitmap.
  if (width <= 0 || height <= 0 || width * height > 40 * 1024 * 1024) throw new Error('attachment_image_too_large')
  const data = image.toPNG()
  if (data.length > ATTACHMENT_LIMITS.imageBytes) throw new Error('attachment_image_too_large')
  return { files: [{ name: `clipboard-${new Date().toISOString().replace(/[:.]/g, '-')}.png`, mediaType: 'image/png', data }] }
}

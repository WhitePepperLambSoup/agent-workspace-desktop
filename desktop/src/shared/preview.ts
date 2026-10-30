import { z } from 'zod'

/** What the preview panel is asked to show: a web page, or a file of the open folder. */
export const previewTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('url'), url: z.string().min(1).max(4096) }).strict(),
  // page: a PDF opens at that page.
  z.object({ kind: z.literal('file'), path: z.string().min(1).max(1024), page: z.number().int().min(1).max(100_000).optional() }).strict(),
])
export type PreviewTarget = z.infer<typeof previewTargetSchema>

export const previewActionSchema = z.enum(['back', 'forward', 'reload', 'external', 'close'])
export type PreviewAction = z.infer<typeof previewActionSchema>

/** Where the page goes in the window, in CSS pixels of the app's own page; null hides it. */
export const previewBoundsSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().nonnegative(),
  height: z.number().finite().nonnegative(),
}).strict().nullable()
export type PreviewBounds = z.infer<typeof previewBoundsSchema>

export const previewStateSchema = z.object({
  open: z.boolean(),
  kind: z.enum(['web', 'file']).nullable(),
  /** The page's address; for a file, its path in the folder. */
  location: z.string().max(4096),
  title: z.string().max(500),
  loading: z.boolean(),
  canGoBack: z.boolean(),
  canGoForward: z.boolean(),
  /** The page can be opened in the browser (an https address). */
  external: z.boolean(),
  /** The page tried something the panel does not allow: a download or another kind of link. */
  blocked: z.enum(['download', 'navigation']).nullable(),
  failed: z.boolean(),
  /** Escape was pressed inside the page. */
  escape: z.boolean().optional(),
})
export type PreviewState = z.infer<typeof previewStateSchema>

export const CLOSED_PREVIEW: PreviewState = {
  open: false,
  kind: null,
  location: '',
  title: '',
  loading: false,
  canGoBack: false,
  canGoForward: false,
  external: false,
  blocked: null,
  failed: false,
}

// Files the panel shows itself (Chromium renders them); Office files have their own preview and
// text files open in the reader.
const PREVIEW_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
}

// What a page shown in the panel may load beside it from the same folder.
const SUBRESOURCE_TYPES: Record<string, string> = {
  ...PREVIEW_TYPES,
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.xml': 'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.wasm': 'application/wasm',
}

function extension(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? ''
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot).toLowerCase() : ''
}

/** Whether the panel opens this file itself. */
export function isPanelFile(path: string): boolean {
  return extension(path) in PREVIEW_TYPES
}

/** The type a file is served with to a page in the panel; anything else downloads (and is refused). */
export function previewContentType(path: string): string {
  return SUBRESOURCE_TYPES[extension(path)] ?? 'application/octet-stream'
}

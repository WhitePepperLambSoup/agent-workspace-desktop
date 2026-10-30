import { randomBytes } from 'node:crypto'
import { createReadStream, realpathSync, statSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { Readable } from 'node:stream'

import type { BrowserWindow, Session, WebContents, WebContentsView } from 'electron'

import { CLOSED_PREVIEW, isPanelFile, previewContentType, type PreviewAction, type PreviewBounds, type PreviewState, type PreviewTarget } from '../shared/preview'
import { isAllowedExternalUrl } from './security'

/**
 * The preview panel: one embedded page above the window's own content, for a web page the user
 * opened from a reply or a file of the open folder (a page, a PDF, a picture). It runs in its own
 * in-memory session with every permission refused and downloads blocked, and is never given the
 * app's preload. Folder files come from the aw-preview scheme under a random name for each file
 * opened; every response asks for a sandbox without the same origin, so a page can load its own
 * styles, scripts and pictures but cannot read the other files of the folder.
 */
export const PREVIEW_SCHEME = 'aw-preview'
export const PREVIEW_PARTITION = 'agent-workspace-preview'

export const PREVIEW_HEADERS: Readonly<Record<string, string>> = {
  'content-security-policy': 'sandbox allow-scripts allow-popups allow-forms allow-modals',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'cache-control': 'no-store',
}

/** A file of the folder for a request path of the preview scheme; null when outside it or missing. */
export function resolvePreviewFile(root: string, requestPath: string): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(requestPath).replace(/^\/+/, '')
  } catch {
    return null
  }
  if (!decoded || decoded.length > 1024 || decoded.includes('\0') || isAbsolute(decoded)) return null
  if (decoded.split(/[\\/]/).includes('..')) return null
  try {
    const realRoot = realpathSync(root)
    const path = realpathSync(resolve(realRoot, decoded))
    const distance = relative(realRoot, path)
    if (!distance || distance === '..' || distance.startsWith(`..${sep}`) || isAbsolute(distance)) return null
    return statSync(path).isFile() ? path : null
  } catch {
    return null
  }
}

/** The preview-scheme address of a folder file opened under a name. */
export function previewUrl(token: string, path: string): string {
  return `${PREVIEW_SCHEME}://${token}/${path.split(/[\\/]/).map(encodeURIComponent).join('/')}`
}

/** Where a page in the panel may go: the web, or another file opened under the same name. */
export function isAllowedPreviewNavigation(url: string, token: string | null): boolean {
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') return !parsed.username && !parsed.password
    return parsed.protocol === `${PREVIEW_SCHEME}:` && token !== null && parsed.host === token
  } catch {
    return false
  }
}

export interface PreviewHost {
  window(): BrowserWindow | null
  /** The folder open in the window; files are previewed only from it. */
  workspace(): string | null
  publish(state: PreviewState): void
  openExternal(url: string): void
  createView(session: Session): WebContentsView
}

export class PreviewPanel {
  private view: WebContentsView | null = null
  private token: string | null = null
  private root: string | null = null
  private kind: PreviewState['kind'] = null
  private filePath = ''
  private blocked: PreviewState['blocked'] = null
  private failed = false
  private bounds: PreviewBounds = null

  constructor(private readonly session: Session, private readonly host: PreviewHost) {
    session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    session.setPermissionCheckHandler(() => false)
    session.on('will-download', (event) => {
      event.preventDefault()
      this.blocked = 'download'
      this.publish()
    })
    session.protocol.handle(PREVIEW_SCHEME, (request) => this.serve(request))
  }

  private serve(request: Request): Response {
    let url: URL
    try {
      url = new URL(request.url)
    } catch {
      return new Response(null, { status: 400 })
    }
    if (!this.token || !this.root || url.host !== this.token) return new Response(null, { status: 404 })
    const path = resolvePreviewFile(this.root, url.pathname)
    if (!path) return new Response(null, { status: 404, headers: PREVIEW_HEADERS })
    const size = statSync(path).size
    const body = Readable.toWeb(createReadStream(path)) as ReadableStream<Uint8Array>
    return new Response(body, {
      status: 200,
      headers: { ...PREVIEW_HEADERS, 'content-type': previewContentType(path), 'content-length': String(size) },
    })
  }

  /** Show a page or a folder file; false when it may not be shown. */
  open(target: PreviewTarget): boolean {
    let url: string
    if (target.kind === 'url') {
      if (!isAllowedExternalUrl(target.url)) return false
      url = target.url
      this.kind = 'web'
      this.token = null
      this.root = null
      this.filePath = ''
    } else {
      const workspace = this.host.workspace()
      if (!workspace || !isPanelFile(target.path) || !resolvePreviewFile(workspace, target.path)) return false
      this.token = randomBytes(16).toString('hex')
      this.root = workspace
      this.kind = 'file'
      this.filePath = target.path.replace(/\\/g, '/')
      url = previewUrl(this.token, this.filePath) + (target.page && /\.pdf$/i.test(this.filePath) ? `#page=${target.page}` : '')
    }
    const view = this.ensureView()
    if (!view) return false
    this.blocked = null
    this.failed = false
    void view.webContents.loadURL(url).catch(() => undefined)
    this.publish()
    return true
  }

  private ensureView(): WebContentsView | null {
    if (this.view && !this.view.webContents.isDestroyed()) return this.view
    const window = this.host.window()
    if (!window || window.isDestroyed()) return null
    const view = this.host.createView(this.session)
    const contents = view.webContents
    contents.setWindowOpenHandler(({ url }) => {
      // A link that opens a new window opens here instead.
      if (isAllowedPreviewNavigation(url, this.token)) void contents.loadURL(url).catch(() => undefined)
      else this.refuse()
      return { action: 'deny' }
    })
    const guard = (event: { preventDefault(): void; url: string; isMainFrame: boolean }): void => {
      if (!event.isMainFrame || isAllowedPreviewNavigation(event.url, this.token)) return
      event.preventDefault()
      this.refuse()
    }
    contents.on('will-frame-navigate', guard)
    contents.on('will-redirect', guard)
    contents.on('before-input-event', (_event, input) => {
      if (input.type === 'keyDown' && input.key === 'Escape' && !input.control && !input.alt && !input.meta && !input.shift) {
        this.publish({ escape: true })
      }
    })
    for (const name of ['did-start-loading', 'did-stop-loading', 'did-navigate', 'did-navigate-in-page', 'page-title-updated'] as const) {
      contents.on(name as 'did-start-loading', () => this.publish())
    }
    contents.on('did-fail-load', (_event, code, _description, _url, isMainFrame) => {
      // -3 is a navigation replaced by another one.
      if (isMainFrame && code !== -3) {
        this.failed = true
        this.publish()
      }
    })
    contents.on('render-process-gone', () => {
      this.failed = true
      this.publish()
    })
    view.setBorderRadius(10)
    view.setVisible(false)
    window.contentView.addChildView(view)
    this.view = view
    this.applyBounds()
    return view
  }

  private refuse(): void {
    this.blocked = 'navigation'
    this.publish()
  }

  /** Place the page where the window's panel is; null hides it (a dialog is in front of it). */
  setBounds(bounds: PreviewBounds): void {
    this.bounds = bounds
    this.applyBounds()
  }

  private applyBounds(): void {
    const view = this.view
    const window = this.host.window()
    if (!view || !window || window.isDestroyed()) return
    const bounds = this.bounds
    if (!bounds || bounds.width < 2 || bounds.height < 2) {
      view.setVisible(false)
      return
    }
    const zoom = window.webContents.getZoomFactor()
    view.setBounds({
      x: Math.round(bounds.x * zoom),
      y: Math.round(bounds.y * zoom),
      width: Math.round(bounds.width * zoom),
      height: Math.round(bounds.height * zoom),
    })
    view.setVisible(true)
  }

  act(action: PreviewAction): boolean {
    if (action === 'close') {
      this.close()
      return true
    }
    const contents = this.liveContents()
    if (!contents) return false
    const history = contents.navigationHistory
    if (action === 'back' && history.canGoBack()) history.goBack()
    else if (action === 'forward' && history.canGoForward()) history.goForward()
    else if (action === 'reload') {
      this.failed = false
      this.blocked = null
      contents.reload()
    } else if (action === 'external') {
      const url = contents.getURL()
      if (!isAllowedExternalUrl(url)) return false
      this.host.openExternal(url)
    } else return false
    return true
  }

  /** The folder changed or the window reloaded: a file preview no longer belongs to it. */
  closeFiles(): void {
    if (this.kind === 'file') this.close()
  }

  close(): void {
    const view = this.view
    this.view = null
    this.token = null
    this.root = null
    this.kind = null
    this.filePath = ''
    this.blocked = null
    this.failed = false
    if (view) {
      const window = this.host.window()
      if (window && !window.isDestroyed()) window.contentView.removeChildView(view)
      if (!view.webContents.isDestroyed()) view.webContents.close()
    }
    this.host.publish(CLOSED_PREVIEW)
  }

  private liveContents(): WebContents | null {
    const contents = this.view?.webContents
    return contents && !contents.isDestroyed() ? contents : null
  }

  private publish(extra: Partial<PreviewState> = {}): void {
    const contents = this.liveContents()
    if (!contents) {
      this.host.publish(CLOSED_PREVIEW)
      return
    }
    const url = contents.getURL()
    const file = this.kind === 'file' && url.startsWith(`${PREVIEW_SCHEME}://`)
    this.host.publish({
      open: true,
      kind: this.kind,
      location: file ? filePathOf(url) ?? this.filePath : url,
      title: contents.getTitle().slice(0, 500),
      loading: contents.isLoading(),
      canGoBack: contents.navigationHistory.canGoBack(),
      canGoForward: contents.navigationHistory.canGoForward(),
      external: isAllowedExternalUrl(url),
      blocked: this.blocked,
      failed: this.failed,
      ...extra,
    })
  }
}

function filePathOf(url: string): string | null {
  try {
    return decodeURIComponent(new URL(url).pathname.replace(/^\/+/, ''))
  } catch {
    return null
  }
}

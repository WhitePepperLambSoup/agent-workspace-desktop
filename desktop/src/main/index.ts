import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { release } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import { BrowserWindow, Menu, Notification, WebContentsView, app, clipboard, crashReporter, dialog, globalShortcut, ipcMain, nativeImage, nativeTheme, protocol, screen, session, shell } from 'electron'

import { z } from 'zod'

import { nativeAppearanceRequestSchema } from '../shared/appearance'
import { desktopNotificationSchema, updateFeedSchema, type AppInfo, type UpdateStatus } from '../shared/desktop'
import { uiCommandSchema } from '../shared/api'
import { ATTACHMENT_LIMITS, type AttachmentImportFile } from '../shared/attachments'
import { validateAttachmentImports } from '../shared/attachment-validation'
import { windowActionSchema } from '../shared/window'
import { applyNativeAppearance } from './appearance'
import {
  CONTENT_SECURITY_POLICY,
  installSessionSecurity,
  isAllowedExternalUrl,
  isTrustedIpcSender,
  resolveWorkspaceDocumentPath,
  resolveWorkspaceEntryPath,
} from './security'
import { SidecarClient } from './sidecar'
import { performWindowAction } from './window-controls'
import { AttachmentRegistry } from './attachments'
import { clipboardHasAttachments, readClipboardAttachments } from './native-clipboard'
import { captureClipboard, QuickActionsShortcut, quickActionsSettingsSchema, type QuickCapture } from './quick-actions'
import { QuitCoordinator } from './quit-coordinator'
import { resolveDevelopmentPython } from './python-runtime'
import { RendererEventBuffer } from './renderer-event-buffer'
import { installNativeWindowShape, supportsNativeWindowRounding } from './window-shape'
import { createMainLogger } from './logger'
import { sessionArchiveFileName } from './file-names'
import { buildDiagnosticsReport, diagnosticsFileName, tailLines } from './diagnostics'
import { resolveWorkspaceImage } from './workspace-image'
import { RendererRecoveryPolicy } from './crash-recovery'
import { MINIMUM_WINDOW_SIZE, readWindowState, restoreBounds, writeWindowState } from './window-state'
import { UpdateController, type UpdaterEngine } from './updater'
import { PREVIEW_PARTITION, PREVIEW_SCHEME, PreviewPanel, resolvePreviewFile } from './preview'
import { previewActionSchema, previewBoundsSchema, previewTargetSchema } from '../shared/preview'

// Installers and latest.yml are attached to each GitHub release; "latest/download" always points
// at the newest one, which is what installed copies check.
const RELEASE_UPDATE_FEED = 'https://github.com/WhitePepperLambSoup/agent-workspace-desktop/releases/latest/download'
// A thesis with many figures; larger PDFs open in the preview panel instead.
const MAX_EDITOR_PDF_BYTES = 200 * 1024 * 1024
const MAX_FIGURE_BYTES = 30 * 1024 * 1024
const exportPdfSchema = z.object({
  html: z.string().min(1).max(4 * 1024 * 1024),
  css: z.string().max(4 * 1024 * 1024),
  title: z.string().max(300),
}).strict()
// Print layout for an exported answer: black on white, readable widths, code and tables kept.
const EXPORT_PAGE_CSS = `
body { margin: 0; color: #111; background: #fff; font: 11pt/1.6 "Segoe UI", "Microsoft YaHei", sans-serif; }
.markdown-body { max-width: 100%; }
.markdown-body pre, .markdown-body code { font-family: Consolas, "Cascadia Mono", monospace; font-size: 9.5pt; white-space: pre-wrap; }
.markdown-body pre { background: #f5f5f5; padding: 8px; border-radius: 4px; }
.markdown-body table { border-collapse: collapse; }
.markdown-body th, .markdown-body td { border: 1px solid #bbb; padding: 3px 6px; }
.markdown-body img { max-width: 100%; }
.markdown-body button.markdown-link { all: unset; color: #1a56db; text-decoration: underline; }
`

function exportFileName(title: string, suffix: string): string {
  const words = title.trim().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'answer'
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  return `${words}-${stamp}${suffix}`
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[character] ?? character)
}

// Acceptance tests provide an isolated profile so parallel Electron processes do not
// contend for the default Windows Chromium lock. Ordinary launches leave this unset.
const testUserData =
  process.env.AGENT_WORKSPACE_E2E === '1'
    ? process.env.AGENT_WORKSPACE_TEST_USER_DATA
    : undefined
if (testUserData) {
  const resolvedTestUserData = resolve(testUserData)
  app.setPath('appData', join(resolvedTestUserData, 'app-data'))
  app.setPath('userData', resolvedTestUserData)
  if (process.env.AGENT_WORKSPACE_TEST_DISABLE_GPU === '1') {
    app.commandLine.appendSwitch('disable-gpu')
    app.disableHardwareAcceleration()
  }
}

const logDirectory = join(app.getPath('userData'), 'logs')
const logger = createMainLogger(logDirectory, { mirror: console })
const windowStatePath = join(app.getPath('userData'), 'window-state.json')
const rendererRecovery = new RendererRecoveryPolicy()

// Minidumps stay on this machine next to main.log; nothing is uploaded.
app.setPath('crashDumps', join(logDirectory, 'crashes'))
crashReporter.start({ uploadToServer: false })
process.on('uncaughtException', (error) => logger.error('Uncaught main-process exception', error))
process.on('unhandledRejection', (reason) => logger.error('Unhandled main-process rejection', reason))

function sidecarOptions(): ConstructorParameters<typeof SidecarClient>[0] {
  if (app.isPackaged) {
    return {
      executable: join(process.resourcesPath, 'sidecar', 'agent-workspace-ui-gateway.exe'),
      args: [],
      cwd: process.resourcesPath,
    }
  }
  const workspaceRoot = resolve(app.getAppPath(), '..')
  const developmentPython = resolveDevelopmentPython(workspaceRoot, {
    configuredExecutable: process.env.AGENT_WORKSPACE_PYTHON,
  })
  const testSidecar = process.env.AGENT_WORKSPACE_SIDECAR
  if (testSidecar) {
    return {
      executable: developmentPython,
      args: [testSidecar],
      cwd: workspaceRoot,
    }
  }
  return {
    executable: developmentPython,
    args: ['-m', 'agent_workspace.ui_gateway'],
    cwd: workspaceRoot,
  }
}

// Folder files shown in the preview panel; registered before the app is ready, as Electron requires.
protocol.registerSchemesAsPrivileged([
  { scheme: PREVIEW_SCHEME, privileges: { standard: true, secure: true, stream: true } },
])

const isIsolatedTestInstance = process.env.AGENT_WORKSPACE_E2E === '1' && testUserData !== undefined
// Acceptance tests run on the developer's own desktop: their windows open past the left edge of
// every display, without taking focus or a taskbar button. Specs that read the real screen set
// AGENT_WORKSPACE_TEST_SHOW_WINDOW=1.
const offscreenTestWindow = isIsolatedTestInstance && process.env.AGENT_WORKSPACE_TEST_SHOW_WINDOW !== '1'
if (offscreenTestWindow) {
  // Chromium would otherwise treat the window as occluded and stop painting it.
  const disabled = app.commandLine.getSwitchValue('disable-features')
  app.commandLine.appendSwitch('disable-features', [disabled, 'CalculateNativeWinOcclusion'].filter(Boolean).join(','))
}
const hasSingleInstanceLock = isIsolatedTestInstance || app.requestSingleInstanceLock()
let mainWindow: BrowserWindow | null = null
let sidecar: SidecarClient | null = null
let rendererEvents: RendererEventBuffer | null = null
let refreshMainWindowShape: (() => void) | null = null
const attachmentRegistry = new AttachmentRegistry((data) => {
  const image = nativeImage.createFromBuffer(data)
  if (image.isEmpty()) return undefined
  const { width, height } = image.getSize()
  if (width <= 0 || height <= 0 || width * height > 40 * 1024 * 1024) return undefined
  const scale = Math.min(1, 128 / Math.max(width, height))
  const preview = image.resize({ width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), quality: 'good' })
  const dataUrl = preview.toDataURL()
  return dataUrl.length <= ATTACHMENT_LIMITS.previewDataUrlBytes ? dataUrl : undefined
})
let activeWorkspace: string | null = null
let unprotectedEditorDrafts = false
let previewPanel: PreviewPanel | null = null

function setActiveWorkspace(path: string | null): void {
  if (path !== activeWorkspace) previewPanel?.closeFiles()
  activeWorkspace = path
  attachmentRegistry.setWorkspace(path)
}

function createPreviewPanel(): PreviewPanel {
  const previewSession = session.fromPartition(PREVIEW_PARTITION)
  // Sites see an ordinary Chrome, not this app's name.
  const escapedName = app.getName().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  previewSession.setUserAgent(previewSession.getUserAgent()
    .replace(new RegExp(`\\s(?:Electron|${escapedName})/\\S+`, 'gi'), ''))
  return new PreviewPanel(previewSession, {
    window: () => mainWindow,
    workspace: () => activeWorkspace,
    publish: (state) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('agent-workspace:preview-state', state)
    },
    openExternal: (url) => void shell.openExternal(url),
    createView: (viewSession) => new WebContentsView({
      webPreferences: {
        session: viewSession,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
        // Chromium's PDF viewer.
        plugins: true,
        spellcheck: false,
        safeDialogs: true,
        navigateOnDragDrop: false,
        autoplayPolicy: 'document-user-activation-required',
      },
    }),
  })
}

function requestQuitAfterStorageFlush(): void {
  try {
    session.defaultSession.flushStorageData()
  } catch (error: unknown) {
    logger.error('Renderer storage flush failed', error)
  }
  app.quit()
}

const quitCoordinator = new QuitCoordinator({
  getSidecar: () => sidecar,
  requestQuit: requestQuitAfterStorageFlush,
  reportError: (error) => logger.error('Sidecar shutdown failed', error),
  confirmQuit: () => {
    if (!unprotectedEditorDrafts || !mainWindow || mainWindow.isDestroyed()) return true
    return dialog.showMessageBoxSync(mainWindow, {
      type: 'warning',
      title: 'Unsaved editor draft',
      message: 'A workspace editor draft could not be backed up.',
      detail: 'Save the file before closing, or close and discard the unprotected draft.',
      buttons: ['Keep editing', 'Close anyway'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    }) === 1
  },
})

function trackWindowState(window: BrowserWindow): void {
  let timer: NodeJS.Timeout | null = null
  const save = (): void => {
    if (timer) clearTimeout(timer)
    timer = null
    if (window.isDestroyed() || window.isMinimized()) return
    writeWindowState(windowStatePath, { bounds: window.getNormalBounds(), maximized: window.isMaximized() })
  }
  const schedule = (): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(save, 500)
  }
  for (const event of ['resize', 'move', 'maximize', 'unmaximize'] as const) window.on(event as 'resize', schedule)
  window.on('close', save)
}

function recoverRenderer(window: BrowserWindow, reason: string): void {
  logger.error('Renderer process gone', { reason })
  if (window.isDestroyed()) return
  if (rendererRecovery.recordCrash(reason)) {
    setTimeout(() => {
      if (!window.isDestroyed()) void window.loadFile(join(__dirname, '../renderer/index.html'))
    }, 500)
    return
  }
  if (reason === 'clean-exit' || reason === 'killed') return
  void dialog.showMessageBox(window, {
    type: 'error',
    title: 'Agent Workspace',
    message: 'The interface stopped responding repeatedly.',
    detail: `Your conversations are saved. Restart the app; if this keeps happening, attach the log in ${logDirectory}.`,
    buttons: ['Restart', 'Close'],
    defaultId: 0,
    noLink: true,
  }).then(({ response }) => {
    if (response === 0) {
      app.relaunch()
      app.exit(0)
    } else {
      app.quit()
    }
  })
}

/**
 * AGENT_WORKSPACE_INTERFACE=simple|full sets the layout a window opens with until the user
 * picks one in Settings (an administrator's default, and the full layout for the test suite).
 */
function interfaceDefaultArguments(): string[] {
  const value = process.env.AGENT_WORKSPACE_INTERFACE
  return value === 'simple' || value === 'full' ? [`--agent-workspace-interface=${value}`] : []
}

function createWindow(): BrowserWindow {
  rendererEvents?.markUnavailable()
  const nativeRounding = supportsNativeWindowRounding()
  const savedState = readWindowState(windowStatePath)
  const displays = screen.getAllDisplays()
  const bounds = restoreBounds(savedState, displays.map((display) => display.workArea))
  const leftmost = displays.reduce((left, display) => (display.bounds.x < left.bounds.x ? display : left), displays[0]!)
  const developmentIcon = join(app.getAppPath(), 'resources', 'icon.png')
  const window = new BrowserWindow({
    ...bounds,
    ...(offscreenTestWindow
      ? {
          x: leftmost.bounds.x - bounds.width - 64,
          y: leftmost.bounds.y,
          show: false,
          skipTaskbar: true,
          hasShadow: false,
        }
      : {}),
    minWidth: MINIMUM_WINDOW_SIZE.width,
    minHeight: MINIMUM_WINDOW_SIZE.height,
    ...(!app.isPackaged && existsSync(developmentIcon) ? { icon: developmentIcon } : {}),
    frame: false,
    titleBarStyle: 'hidden',
    // Native materials provide translucency; an opaque HWND lets Windows round
    // its backdrop and content together without an uncropped square underneath.
    transparent: !nativeRounding,
    // The older-Windows region fallback needs the original frameless geometry,
    // while Windows 11 keeps native resize borders and compositor rounding.
    thickFrame: nativeRounding,
    roundedCorners: true,
    backgroundColor: '#00000000',
    backgroundMaterial: 'acrylic',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      additionalArguments: interfaceDefaultArguments(),
    },
  })
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    rendererEvents?.markUnavailable()
    event.preventDefault()
    if (isAllowedExternalUrl(url)) void shell.openExternal(url)
  })
  window.webContents.on('did-start-loading', () => {
    rendererEvents?.markUnavailable()
    unprotectedEditorDrafts = false
    // A reloaded window has no panel to hold the preview.
    previewPanel?.close()
  })
  refreshMainWindowShape = installNativeWindowShape(window, process.platform, nativeRounding)
  if (offscreenTestWindow) {
    // Away from every display the window has no monitor, and Chromium then lays the page over
    // the invisible resize borders. One pixel of the right border on the leftmost display gives
    // it that monitor's geometry; nothing is drawn there. Sizes set later keep that anchor, in
    // the same move, so the window is never laid out away from the display.
    const border = Math.round((window.getContentSize()[0]! - window.getSize()[0]!) / 2)
    if (border > 0) {
      const setBounds = window.setBounds.bind(window)
      const place = (width: number, height: number): void => {
        const [minimumWidth, minimumHeight] = window.getMinimumSize()
        const outerWidth = Math.max(width, minimumWidth!)
        setBounds({
          x: leftmost.bounds.x - outerWidth - border + 1,
          y: leftmost.bounds.y,
          width: outerWidth,
          height: Math.max(height, minimumHeight!),
        })
      }
      window.setSize = (width, height) => place(width, height)
      window.setContentSize = (width, height) => place(width, height)
      window.setBounds = (next) => {
        const [width, height] = window.getSize()
        place(next.width ?? width!, next.height ?? height!)
      }
      place(window.getSize()[0]!, window.getSize()[1]!)
    }
    window.showInactive()
  } else if (savedState?.maximized) {
    window.maximize()
  }
  trackWindowState(window)
  window.on('focus', () => window.flashFrame(false))
  window.webContents.on('render-process-gone', (_event, details) => {
    rendererEvents?.markUnavailable()
    recoverRenderer(window, details.reason)
  })
  window.webContents.on('destroyed', () => rendererEvents?.markUnavailable())
  window.on('close', (event) => quitCoordinator.onWindowClose(event))
  void window.loadFile(join(__dirname, '../renderer/index.html'))
  return window
}

function installContentSecurityPolicy(): void {
  installSessionSecurity(session.defaultSession, {
    isTrustedRequester: (webContents) => Boolean(mainWindow && !mainWindow.isDestroyed() && webContents === mainWindow.webContents),
  })
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [CONTENT_SECURITY_POLICY],
      },
    })
  })
}

function registerCapabilities(client: SidecarClient): void {
  rendererEvents = new RendererEventBuffer((event) => {
    const window = mainWindow
    if (!window || window.isDestroyed() || window.webContents.isDestroyed()) {
      throw new Error('renderer_unavailable')
    }
    window.webContents.send('agent-workspace:event', event)
  })
  ipcMain.on('agent-workspace:renderer-ready', (event) => {
    if (
      !mainWindow ||
      !isTrustedIpcSender(
        event.sender,
        event.senderFrame,
        mainWindow.webContents,
        mainWindow.webContents.mainFrame,
      )
    ) {
      return
    }
    rendererEvents?.markReady()
  })
  ipcMain.on('agent-workspace:unprotected-drafts', (event, present: unknown) => {
    const trusted = Boolean(mainWindow && isTrustedIpcSender(
      event.sender, event.senderFrame, mainWindow.webContents, mainWindow.webContents.mainFrame,
    ))
    if (trusted && typeof present === 'boolean') unprotectedEditorDrafts = present
    event.returnValue = trusted && typeof present === 'boolean'
  })
  ipcMain.on('agent-workspace:is-quit-approved', (event) => {
    const trusted = Boolean(mainWindow && isTrustedIpcSender(
      event.sender, event.senderFrame, mainWindow.webContents, mainWindow.webContents.mainFrame,
    ))
    event.returnValue = trusted && quitCoordinator.isExitApproved()
  })
  ipcMain.handle('agent-workspace:invoke', async (event, input: unknown) => {
    if (
      !mainWindow ||
      !isTrustedIpcSender(
        event.sender,
        event.senderFrame,
        mainWindow.webContents,
        mainWindow.webContents.mainFrame,
      )
    ) {
      throw new Error('unauthorized_ipc_sender')
    }
    const command = uiCommandSchema.parse(input)
    let forwarded = command
    let attachmentIds: string[] = []
    if (command.type === 'turn.start' || command.type === 'turn.steer') {
      const rawIds = command.payload.attachmentIds
      if (rawIds !== undefined && (!Array.isArray(rawIds) || !rawIds.every((id): id is string => typeof id === 'string'))) {
        throw new Error('invalid_attachment_ids')
      }
      attachmentIds = (rawIds as string[] | undefined) ?? []
      const attachmentPaths = attachmentRegistry.resolve(attachmentIds)
      const payload = { ...command.payload }
      delete payload.attachmentIds
      if (attachmentPaths.length > 0) payload.attachmentPaths = attachmentPaths
      forwarded = { ...command, payload }
    }
    // The sidecar client validated the response when it read it from the sidecar.
    const response = await client.invokeForRenderer(forwarded)
    if (command.type === 'workspace.open' && response.type === 'workspace.open.result') {
      const path = response.payload.workspace && typeof response.payload.workspace === 'object'
        ? (response.payload.workspace as { path?: unknown }).path : null
      setActiveWorkspace(typeof path === 'string' ? path : null)
    } else if (command.type === 'app.bootstrap') {
      const workspace = response.payload.workspace
      const path = workspace && typeof workspace === 'object' ? (workspace as { path?: unknown }).path : null
      if (typeof path === 'string') {
        setActiveWorkspace(path)
      } else if (workspace === null) {
        setActiveWorkspace(null)
      }
    } else if ((command.type === 'turn.start' && response.type === 'turn.start.result') ||
      (command.type === 'turn.steer' && response.type === 'turn.steer.result' && response.payload.accepted === true)) {
      attachmentRegistry.consume(attachmentIds)
    }
    return response
  })
  ipcMain.handle('agent-workspace:select-workspace', async (event) => {
    if (
      !mainWindow ||
      !isTrustedIpcSender(
        event.sender,
        event.senderFrame,
        mainWindow.webContents,
        mainWindow.webContents.mainFrame,
      )
    ) {
      throw new Error('unauthorized_ipc_sender')
    }
    const options: Electron.OpenDialogOptions = { properties: ['openDirectory'] }
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options)
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })
  ipcMain.handle('agent-workspace:select-attachments', async (event) => {
    if (
      !mainWindow ||
      !isTrustedIpcSender(event.sender, event.senderFrame, mainWindow.webContents, mainWindow.webContents.mainFrame)
    ) {
      throw new Error('unauthorized_ipc_sender')
    }
    if (!activeWorkspace) throw new Error('workspace_unavailable')
    const importer = attachmentRegistry.captureImporter(activeWorkspace)
    const result = await dialog.showOpenDialog(mainWindow, { properties: ['openFile', 'multiSelections'] })
    if (result.canceled) return []
    return importer.importPaths(result.filePaths)
  })
  ipcMain.handle('agent-workspace:import-attachments', async (event, files: readonly AttachmentImportFile[], workspacePath: unknown) => {
    if (!mainWindow || !isTrustedIpcSender(event.sender, event.senderFrame, mainWindow.webContents, mainWindow.webContents.mainFrame)) {
      throw new Error('unauthorized_ipc_sender')
    }
    if (typeof workspacePath !== 'string') throw new Error('attachment_workspace_changed')
    validateAttachmentImports(files)
    return attachmentRegistry.importFiles(files, workspacePath)
  })
  ipcMain.handle('agent-workspace:paste-attachments', async (event, workspacePath: unknown) => {
    if (!mainWindow || !isTrustedIpcSender(event.sender, event.senderFrame, mainWindow.webContents, mainWindow.webContents.mainFrame)) {
      throw new Error('unauthorized_ipc_sender')
    }
    if (typeof workspacePath !== 'string') throw new Error('attachment_workspace_changed')
    const importer = attachmentRegistry.captureImporter(workspacePath)
    const pasted = await readClipboardAttachments(clipboard)
    return 'paths' in pasted ? importer.importPaths(pasted.paths) : importer.importFiles(pasted.files)
  })
  ipcMain.on('agent-workspace:clipboard-has-attachments', (event) => {
    if (!mainWindow || !isTrustedIpcSender(event.sender, event.senderFrame, mainWindow.webContents, mainWindow.webContents.mainFrame)) {
      event.returnValue = false
      return
    }
    try {
      event.returnValue = clipboardHasAttachments(clipboard)
    } catch {
      event.returnValue = false
    }
  })
  ipcMain.handle('agent-workspace:open-external', async (event, input: unknown) => {
    if (
      !mainWindow ||
      !isTrustedIpcSender(
        event.sender,
        event.senderFrame,
        mainWindow.webContents,
        mainWindow.webContents.mainFrame,
      )
    ) {
      throw new Error('unauthorized_ipc_sender')
    }
    if (typeof input !== 'string' || input.length > 4096 || !isAllowedExternalUrl(input)) return false
    await shell.openExternal(input)
    return true
  })
  ipcMain.handle('agent-workspace:open-path', async (event, input: unknown) => {
    if (
      !mainWindow ||
      !isTrustedIpcSender(
        event.sender,
        event.senderFrame,
        mainWindow.webContents,
        mainWindow.webContents.mainFrame,
      )
    ) {
      throw new Error('unauthorized_ipc_sender')
    }
    const path = resolveWorkspaceDocumentPath(activeWorkspace, input)
    return path ? (await shell.openPath(path)).length === 0 : false
  })
  // A file a phone sent: shown selected in Explorer, never run.
  trustedHandle('agent-workspace:reveal-path', (_event, input: unknown) => {
    const path = resolveWorkspaceEntryPath(activeWorkspace, input)
    if (!path) return false
    shell.showItemInFolder(path)
    return true
  })
  trustedHandle('agent-workspace:copy-text', (_event, input: unknown) => {
    if (typeof input !== 'string' || input.length > 64 * 1024) return false
    clipboard.writeText(input)
    return true
  })
  // The global shortcut for the quick actions. Test instances never take a system-wide key; they
  // open the actions through the hook below.
  trustedHandle('agent-workspace:quick-actions-configure', (_event, input: unknown) => {
    const parsed = quickActionsSettingsSchema.safeParse(input)
    if (!parsed.success) return { ok: false, error: 'invalid' }
    if (isIsolatedTestInstance) return { ok: true }
    return quickActionsShortcut.configure(parsed.data)
  })
  if (isIsolatedTestInstance) {
    ;(globalThis as { agentWorkspaceTestQuickActions?: (capture: QuickCapture) => void }).agentWorkspaceTestQuickActions =
      (capture) => openQuickActions(capture)
  }
  ipcMain.handle('agent-workspace:set-appearance', (event, input: unknown) => {
    if (
      !mainWindow ||
      !isTrustedIpcSender(
        event.sender,
        event.senderFrame,
        mainWindow.webContents,
        mainWindow.webContents.mainFrame,
      )
    ) {
      throw new Error('unauthorized_ipc_sender')
    }
    const result = applyNativeAppearance(mainWindow, nativeAppearanceRequestSchema.parse(input), nativeTheme)
    // Changing native backdrop margins can recreate the Windows window region.
    refreshMainWindowShape?.()
    return result
  })
  ipcMain.handle('agent-workspace:capture-frame', async (event) => {
    if (
      !mainWindow ||
      !isTrustedIpcSender(
        event.sender,
        event.senderFrame,
        mainWindow.webContents,
        mainWindow.webContents.mainFrame,
      )
    ) {
      throw new Error('unauthorized_ipc_sender')
    }
    const image = await mainWindow.webContents.capturePage()
    const size = image.getSize()
    return { dataUrl: image.toDataURL(), width: size.width, height: size.height }
  })
  ipcMain.handle('agent-workspace:window-action', (event, input: unknown) => {
    if (
      !mainWindow ||
      !isTrustedIpcSender(
        event.sender,
        event.senderFrame,
        mainWindow.webContents,
        mainWindow.webContents.mainFrame,
      )
    ) {
      throw new Error('unauthorized_ipc_sender')
    }
    return performWindowAction(mainWindow, windowActionSchema.parse(input))
  })
  client.subscribe((event) => rendererEvents?.publish(event))
}

/** The window brought forward with the quick actions on what the clipboard holds. */
function openQuickActions(capture: QuickCapture): void {
  const window = mainWindow
  if (!window || window.isDestroyed()) return
  if (!offscreenTestWindow) {
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
  }
  window.webContents.send('agent-workspace:quick-actions', capture)
}

const quickActionsShortcut = new QuickActionsShortcut(globalShortcut, () => openQuickActions(captureClipboard(clipboard)))

function isTrustedEvent(event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent): boolean {
  return Boolean(mainWindow && isTrustedIpcSender(
    event.sender, event.senderFrame, mainWindow.webContents, mainWindow.webContents.mainFrame,
  ))
}

function trustedHandle(channel: string, handler: (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown): void {
  ipcMain.handle(channel, (event, ...args: unknown[]) => {
    if (!isTrustedEvent(event)) throw new Error('unauthorized_ipc_sender')
    return handler(event, ...args)
  })
}

function registerDesktopCapabilities(): void {
  const updates = new UpdateController({
    packaged: app.isPackaged,
    executableDirectory: dirname(app.getPath('exe')),
    settingsPath: join(app.getPath('userData'), 'update-feed.json'),
    environmentFeed: process.env.AGENT_WORKSPACE_UPDATE_URL,
    defaultFeed: RELEASE_UPDATE_FEED,
    // Loaded on demand so the updater adds nothing to startup.
    loadEngine: async () => {
      const module = await import('electron-updater')
      const updater = (module as unknown as { default?: { autoUpdater: unknown }; autoUpdater?: unknown })
      return (updater.autoUpdater ?? updater.default?.autoUpdater) as UpdaterEngine
    },
    onStatus: (status: UpdateStatus) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('agent-workspace:update-status', status)
    },
    log: (message, detail) => logger.warn(message, detail),
  })
  trustedHandle('agent-workspace:app-info', (): AppInfo => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    platform: `${process.platform} ${process.arch}`,
    packaged: app.isPackaged,
    logDirectory,
  }))
  trustedHandle('agent-workspace:open-log-folder', async () => (await shell.openPath(logDirectory)).length === 0)
  trustedHandle('agent-workspace:update-status', () => updates.getStatus())
  trustedHandle('agent-workspace:update-feed', () => ({ url: updates.getFeed() }))
  trustedHandle('agent-workspace:update-set-feed', (_event, input) => updates.setFeed(updateFeedSchema.parse(input).url))
  trustedHandle('agent-workspace:update-check', () => updates.check())
  trustedHandle('agent-workspace:update-download', () => updates.download())
  trustedHandle('agent-workspace:update-install', () => updates.install())
  trustedHandle('agent-workspace:export-diagnostics', async (_event, renderer) => {
    if (!mainWindow) return null
    const now = new Date()
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: join(app.getPath('documents'), diagnosticsFileName(now)),
      filters: [{ name: 'Text', extensions: ['txt'] }],
      properties: ['showOverwriteConfirmation'],
    })
    if (result.canceled || !result.filePath) return null
    const report = buildDiagnosticsReport({
      generatedAt: now,
      app: {
        version: app.getVersion(),
        electron: process.versions.electron,
        chrome: process.versions.chrome,
        node: process.versions.node,
        platform: `${process.platform} ${process.arch}`,
        osRelease: release(),
        packaged: app.isPackaged,
        locale: app.getLocale(),
        uptimeSeconds: Math.round(process.uptime()),
        memoryMb: Math.round(process.memoryUsage().rss / 1_048_576),
        updates: updates.getStatus(),
      },
      renderer,
      previousLogLines: tailLines(`${logger.path}.1`, 100),
      logLines: tailLines(logger.path, 400),
    })
    writeFileSync(result.filePath, report, 'utf8')
    logger.info('Diagnostics exported')
    return result.filePath
  })
  trustedHandle('agent-workspace:image-thumbnail', (_event, root, relativePath) => {
    const source = resolveWorkspaceImage(root, relativePath)
    if (!source) return null
    const image = nativeImage.createFromPath(source)
    if (image.isEmpty()) return null
    const { width } = image.getSize()
    // Bounded so a full-page capture never exceeds the IPC budget.
    return (width > 720 ? image.resize({ width: 720, quality: 'good' }) : image).toDataURL()
  })
  // The LaTeX editor's PDF view draws the open folder's PDF itself (for SyncTeX); it gets bytes.
  trustedHandle('agent-workspace:read-pdf', async (_event, input) => {
    if (!activeWorkspace || typeof input !== 'string' || !/\.pdf$/i.test(input)) return null
    const path = resolvePreviewFile(activeWorkspace, input)
    if (!path || statSync(path).size > MAX_EDITOR_PDF_BYTES) return null
    return new Uint8Array(await readFile(path))
  })
  // The figure point editor draws a figure of the open folder under its handles, at full size.
  trustedHandle('agent-workspace:read-figure', async (_event, input) => {
    if (!activeWorkspace || typeof input !== 'string' || !/\.(png|jpe?g)$/i.test(input)) return null
    const path = resolvePreviewFile(activeWorkspace, input)
    if (!path || statSync(path).size > MAX_FIGURE_BYTES) return null
    const data = await readFile(path)
    return `data:${/\.png$/i.test(path) ? 'image/png' : 'image/jpeg'};base64,${data.toString('base64')}`
  })
  // An answer as a PDF in the open folder's exports/: the page as the window shows it (formulas
  // too), printed by a hidden window that runs no scripts.
  trustedHandle('agent-workspace:export-pdf', async (_event, input) => {
    const request = exportPdfSchema.safeParse(input)
    if (!request.success || !activeWorkspace) return null
    const folder = join(activeWorkspace, 'exports')
    mkdirSync(folder, { recursive: true })
    const base = exportFileName(request.data.title, '')
    let name = `${base}.pdf`
    for (let number = 2; existsSync(join(folder, name)); number += 1) name = `${base}-${number}.pdf`
    const page = join(app.getPath('temp'), `aw-export-${randomUUID()}.html`)
    // Nothing on the page reaches the network: the formula fonts come from the app's own files.
    const policy = "default-src 'none'; style-src 'unsafe-inline'; font-src file: data:; img-src file: data:"
    writeFileSync(page, `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}"><title>${escapeHtml(request.data.title)}</title><style>${request.data.css}\n${EXPORT_PAGE_CSS}</style></head><body><main class="markdown-body">${request.data.html}</main></body></html>`)
    const printer = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, javascript: false, partition: 'agent-workspace-export' } })
    try {
      await printer.loadFile(page)
      const pdf = await printer.webContents.printToPDF({ printBackground: true, pageSize: 'A4' })
      writeFileSync(join(folder, name), pdf)
      return `exports/${name}`
    } catch {
      return null
    } finally {
      printer.destroy()
      try { unlinkSync(page) } catch { /* the temp folder is cleaned anyway */ }
    }
  })
  // A Jupyter notebook for the reader; its pictures make it larger than a sidecar reply.
  trustedHandle('agent-workspace:read-notebook', async (_event, input) => {
    if (!activeWorkspace || typeof input !== 'string' || !/\.ipynb$/i.test(input)) return null
    const path = resolvePreviewFile(activeWorkspace, input)
    if (!path || statSync(path).size > MAX_FIGURE_BYTES) return null
    return readFile(path, 'utf8')
  })
  trustedHandle('agent-workspace:preview-open', (_event, input) => {
    const target = previewTargetSchema.safeParse(input)
    return target.success && previewPanel !== null && previewPanel.open(target.data)
  })
  trustedHandle('agent-workspace:preview-action', (_event, input) => {
    const action = previewActionSchema.safeParse(input)
    return action.success && previewPanel !== null && previewPanel.act(action.data)
  })
  ipcMain.on('agent-workspace:preview-bounds', (event, input: unknown) => {
    if (!isTrustedEvent(event)) return
    const bounds = previewBoundsSchema.safeParse(input)
    if (bounds.success) previewPanel?.setBounds(bounds.data)
  })
  trustedHandle('agent-workspace:notify', (_event, input) => {
    const parsed = desktopNotificationSchema.safeParse(input)
    if (!parsed.success || !mainWindow || mainWindow.isDestroyed()) return false
    // Only interrupt when the user is elsewhere; the open window already shows the change.
    if (mainWindow.isFocused() && mainWindow.isVisible() && !mainWindow.isMinimized()) return false
    if (parsed.data.urgency === 'attention') mainWindow.flashFrame(true)
    if (!Notification.isSupported()) return false
    const notification = new Notification({ title: parsed.data.title, body: parsed.data.body, silent: parsed.data.urgency !== 'attention' })
    notification.on('click', () => {
      if (!mainWindow || mainWindow.isDestroyed()) return
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
      mainWindow.webContents.send('agent-workspace:notification-activated', { sessionId: parsed.data.sessionId })
    })
    notification.show()
    return true
  })
  trustedHandle('agent-workspace:select-session-export-path', async (_event, rawName) => {
    if (!mainWindow) return null
    const name = sessionArchiveFileName(rawName)
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: join(app.getPath('documents'), name),
      filters: [{ name: 'Agent Workspace session', extensions: ['zip'] }],
      properties: ['showOverwriteConfirmation'],
    })
    return result.canceled || !result.filePath ? null : result.filePath
  })
  trustedHandle('agent-workspace:select-knowledge-files', async (_event, rawSuffixes) => {
    if (!mainWindow) return []
    // The knowledge base's own list of readable types; anything else is not offered.
    const suffixes = Array.isArray(rawSuffixes)
      ? rawSuffixes.filter((suffix): suffix is string => typeof suffix === 'string' && /^\.[a-z0-9]{1,10}$/.test(suffix)).slice(0, 64)
      : []
    const result = await dialog.showOpenDialog(mainWindow, {
      filters: suffixes.length ? [{ name: 'Documents', extensions: suffixes.map((suffix) => suffix.slice(1)) }] : [],
      properties: ['openFile', 'multiSelections'],
    })
    return result.canceled ? [] : result.filePaths.slice(0, 50)
  })
  trustedHandle('agent-workspace:select-session-archive', async () => {
    if (!mainWindow) return null
    const result = await dialog.showOpenDialog(mainWindow, {
      filters: [{ name: 'Agent Workspace session', extensions: ['zip'] }],
      properties: ['openFile'],
    })
    return result.canceled ? null : result.filePaths[0] ?? null
  })
}

async function startApplication(): Promise<void> {
  Menu.setApplicationMenu(null)
  // Windows shows toast notifications only for an app with a registered identity.
  if (process.platform === 'win32') app.setAppUserModelId('local.agentworkspace.desktop')
  installContentSecurityPolicy()
  logger.info('Starting Agent Workspace', { version: app.getVersion(), packaged: app.isPackaged })
  // Runs the JavaScript language servers (Pyright, TypeScript) when Node is not installed.
  process.env.AGENT_WORKSPACE_ELECTRON_NODE = process.execPath
  sidecar = new SidecarClient(sidecarOptions())
  registerCapabilities(sidecar)
  registerDesktopCapabilities()
  // The handshake is queued first, so renderer commands written later still
  // follow it. Opening the window in parallel hides the sidecar boot time.
  const handshake = sidecar.invoke({
    type: 'app.handshake',
    payload: { client: 'electron', protocol: 1 },
    sessionId: null,
  })
  mainWindow = createWindow()
  previewPanel = createPreviewPanel()
  mainWindow.on('closed', () => previewPanel?.close())
  try {
    await handshake
  } catch (error) {
    logger.error('Sidecar handshake failed', error)
  }
}

if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow?.isMinimized()) mainWindow.restore()
    mainWindow?.focus()
  })
  app.whenReady().then(startApplication).catch((error: unknown) => {
    logger.error('Electron startup failed', error)
    app.quit()
  })
}

app.on('before-quit', (event) => quitCoordinator.onBeforeQuit(event))

app.on('window-all-closed', () => app.quit())
app.on('will-quit', () => quickActionsShortcut.clear())

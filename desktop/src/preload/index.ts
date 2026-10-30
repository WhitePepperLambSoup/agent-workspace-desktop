import { contextBridge, ipcRenderer, webFrame, webUtils } from 'electron'

import {
  nativeAppearanceRequestSchema,
  nativeAppearanceResultSchema,
} from '../shared/appearance'
import { type AgentWorkspaceApi, type DesktopHostApi, type PreviewApi, type UiEvent, type UiResponse, uiCommandSchema } from '../shared/api'
import { appInfoSchema, desktopNotificationSchema, updateStatusSchema } from '../shared/desktop'
import { parseAttachmentCapabilities, validateAttachmentImports } from '../shared/attachment-validation'
import { windowActionResultSchema, windowActionSchema } from '../shared/window'
import { previewActionSchema, previewBoundsSchema, previewStateSchema, previewTargetSchema } from '../shared/preview'
import { synchronizeNativeWindowShape } from './window-shape'

// Keep CSS clipping aligned with the native HWND on system maximize/restore and
// fullscreen, including actions initiated outside our own title-bar buttons.
synchronizeNativeWindowShape(ipcRenderer, document, () => webFrame.getZoomFactor())

const desktopMethods: DesktopHostApi = {
  async getAppInfo() {
    return appInfoSchema.parse(await ipcRenderer.invoke('agent-workspace:app-info'))
  },
  async openLogFolder() {
    return (await ipcRenderer.invoke('agent-workspace:open-log-folder')) === true
  },
  async getUpdateStatus() {
    return updateStatusSchema.parse(await ipcRenderer.invoke('agent-workspace:update-status'))
  },
  async getUpdateFeed() {
    const result: unknown = await ipcRenderer.invoke('agent-workspace:update-feed')
    const url = result && typeof result === 'object' ? (result as { url?: unknown }).url : null
    return typeof url === 'string' ? url : null
  },
  async setUpdateFeed(url) {
    if (url !== null && (typeof url !== 'string' || url.length > 2048)) return false
    return (await ipcRenderer.invoke('agent-workspace:update-set-feed', { url })) === true
  },
  async checkForUpdates() {
    return updateStatusSchema.parse(await ipcRenderer.invoke('agent-workspace:update-check'))
  },
  async downloadUpdate() {
    return updateStatusSchema.parse(await ipcRenderer.invoke('agent-workspace:update-download'))
  },
  async installUpdate() {
    return (await ipcRenderer.invoke('agent-workspace:update-install')) === true
  },
  onUpdateStatus(listener) {
    const handler = (_event: Electron.IpcRendererEvent, status: unknown): void => {
      const parsed = updateStatusSchema.safeParse(status)
      if (parsed.success) listener(parsed.data)
    }
    ipcRenderer.on('agent-workspace:update-status', handler)
    return () => ipcRenderer.removeListener('agent-workspace:update-status', handler)
  },
  async exportDiagnostics(workbench) {
    let payload: unknown = null
    try { payload = JSON.parse(JSON.stringify(workbench ?? null)) } catch { payload = null }
    const result: unknown = await ipcRenderer.invoke('agent-workspace:export-diagnostics', payload)
    return typeof result === 'string' ? result : null
  },
  async notify(notification) {
    const parsed = desktopNotificationSchema.safeParse(notification)
    if (!parsed.success) return false
    return (await ipcRenderer.invoke('agent-workspace:notify', parsed.data)) === true
  },
  onNotificationActivated(listener) {
    const handler = (_event: Electron.IpcRendererEvent, detail: unknown): void => {
      const sessionId = detail && typeof detail === 'object' ? (detail as { sessionId?: unknown }).sessionId : null
      listener(typeof sessionId === 'string' && sessionId.length <= 200 ? sessionId : null)
    }
    ipcRenderer.on('agent-workspace:notification-activated', handler)
    return () => ipcRenderer.removeListener('agent-workspace:notification-activated', handler)
  },
}
const desktop = Object.freeze(desktopMethods)

const previewMethods: PreviewApi = {
  async open(target) {
    const parsed = previewTargetSchema.safeParse(target)
    return parsed.success && (await ipcRenderer.invoke('agent-workspace:preview-open', parsed.data)) === true
  },
  setBounds(bounds) {
    const parsed = previewBoundsSchema.safeParse(bounds)
    if (parsed.success) ipcRenderer.send('agent-workspace:preview-bounds', parsed.data)
  },
  async act(action) {
    const parsed = previewActionSchema.safeParse(action)
    return parsed.success && (await ipcRenderer.invoke('agent-workspace:preview-action', parsed.data)) === true
  },
  onState(listener) {
    const handler = (_event: Electron.IpcRendererEvent, state: unknown): void => {
      const parsed = previewStateSchema.safeParse(state)
      if (parsed.success) listener(parsed.data)
    }
    ipcRenderer.on('agent-workspace:preview-state', handler)
    return () => ipcRenderer.removeListener('agent-workspace:preview-state', handler)
  },
}
const preview = Object.freeze(previewMethods)
const interfaceArgument = process.argv.find((value) => value.startsWith('--agent-workspace-interface='))?.split('=')[1]

const api: AgentWorkspaceApi = {
  desktop,
  preview,
  interfaceDefault: interfaceArgument === 'simple' || interfaceArgument === 'full' ? interfaceArgument : undefined,
  // Responses and events come from the main process, which validated each one when it read it
  // from the sidecar; parsing them again here cost the window ~10 ms per megabyte.
  async invoke(command) {
    const validated = uiCommandSchema.parse(command)
    return (await ipcRenderer.invoke('agent-workspace:invoke', validated)) as UiResponse
  },
  subscribe(listener) {
    const handler = (_event: Electron.IpcRendererEvent, document: unknown): void => {
      listener(document as UiEvent)
    }
    ipcRenderer.on('agent-workspace:event', handler)
    // Register the listener before acknowledging readiness so the main-process
    // event buffer can safely replay events missed during startup or reload.
    ipcRenderer.send('agent-workspace:renderer-ready')
    return () => ipcRenderer.removeListener('agent-workspace:event', handler)
  },
  async selectWorkspace() {
    const result: unknown = await ipcRenderer.invoke('agent-workspace:select-workspace')
    if (result === null || typeof result === 'string') return result
    throw new Error('invalid_workspace_selection')
  },
  async selectAttachments() {
    return parseAttachmentCapabilities(await ipcRenderer.invoke('agent-workspace:select-attachments'))
  },
  async importAttachments(files, workspacePath) {
    validateAttachmentImports(files)
    if (typeof workspacePath !== 'string' || !workspacePath || workspacePath.length > 4096) throw new Error('attachment_workspace_changed')
    return parseAttachmentCapabilities(await ipcRenderer.invoke('agent-workspace:import-attachments', files, workspacePath))
  },
  async pasteAttachments(workspacePath) {
    if (typeof workspacePath !== 'string' || !workspacePath || workspacePath.length > 4096) throw new Error('attachment_workspace_changed')
    return parseAttachmentCapabilities(await ipcRenderer.invoke('agent-workspace:paste-attachments', workspacePath))
  },
  clipboardHasAttachments() {
    return ipcRenderer.sendSync('agent-workspace:clipboard-has-attachments') === true
  },
  async openExternal(url) {
    if (typeof url !== 'string' || url.length > 4096) return false
    const result: unknown = await ipcRenderer.invoke('agent-workspace:open-external', url)
    if (typeof result === 'boolean') return result
    throw new Error('invalid_external_open_result')
  },
  async openPath(path) {
    if (typeof path !== 'string' || path.length > 4096) return false
    const result: unknown = await ipcRenderer.invoke('agent-workspace:open-path', path)
    if (typeof result === 'boolean') return result
    throw new Error('invalid_path_open_result')
  },
  async revealPath(path) {
    if (typeof path !== 'string' || !path || path.length > 4096) return false
    return (await ipcRenderer.invoke('agent-workspace:reveal-path', path)) === true
  },
  async copyText(text) {
    if (typeof text !== 'string' || text.length > 64 * 1024) return false
    return (await ipcRenderer.invoke('agent-workspace:copy-text', text)) === true
  },
  async configureQuickActions(settings) {
    const result: unknown = await ipcRenderer.invoke('agent-workspace:quick-actions-configure', {
      enabled: settings?.enabled === true,
      accelerator: typeof settings?.accelerator === 'string' ? settings.accelerator.slice(0, 40) : '',
    })
    const value = (result ?? {}) as { ok?: unknown; error?: unknown }
    return value.ok === true
      ? { ok: true }
      : { ok: false, error: value.error === 'taken' ? 'taken' : 'invalid' }
  },
  onQuickActions(listener) {
    const handler = (_event: Electron.IpcRendererEvent, capture: unknown) => {
      const value = (capture ?? {}) as { text?: unknown; image?: unknown }
      listener({
        text: typeof value.text === 'string' ? value.text.slice(0, 20_000) : '',
        image: typeof value.image === 'string' && value.image.length <= 9 * 1024 * 1024 ? value.image : null,
      })
    }
    ipcRenderer.on('agent-workspace:quick-actions', handler)
    return () => ipcRenderer.removeListener('agent-workspace:quick-actions', handler)
  },
  async setAppearance(request) {
    const validated = nativeAppearanceRequestSchema.parse(request)
    return nativeAppearanceResultSchema.parse(
      await ipcRenderer.invoke('agent-workspace:set-appearance', validated),
    )
  },
  async controlWindow(action) {
    return windowActionResultSchema.parse(
      await ipcRenderer.invoke('agent-workspace:window-action', windowActionSchema.parse(action)),
    )
  },
  async captureFrame() {
    const result: unknown = await ipcRenderer.invoke('agent-workspace:capture-frame')
    if (!result || typeof result !== 'object') throw new Error('invalid_capture_frame')
    const value = result as { dataUrl?: unknown; width?: unknown; height?: unknown }
    if (typeof value.dataUrl !== 'string' || typeof value.width !== 'number' || typeof value.height !== 'number') {
      throw new Error('invalid_capture_frame')
    }
    return { dataUrl: value.dataUrl, width: value.width, height: value.height }
  },
  reportUnprotectedDrafts(present) {
    return ipcRenderer.sendSync('agent-workspace:unprotected-drafts', present) === true
  },
  isQuitApproved() {
    return ipcRenderer.sendSync('agent-workspace:is-quit-approved') === true
  },
  async exportPdf(request) {
    if (!request || typeof request.html !== 'string' || typeof request.css !== 'string' || typeof request.title !== 'string') return null
    const result: unknown = await ipcRenderer.invoke('agent-workspace:export-pdf', { html: request.html, css: request.css, title: request.title })
    return typeof result === 'string' ? result : null
  },
  async readNotebook(path) {
    if (typeof path !== 'string' || !path || path.length > 4096) return null
    const result: unknown = await ipcRenderer.invoke('agent-workspace:read-notebook', path)
    return typeof result === 'string' ? result : null
  },
  async readFigure(path) {
    if (typeof path !== 'string' || !path || path.length > 4096) return null
    const result: unknown = await ipcRenderer.invoke('agent-workspace:read-figure', path)
    return typeof result === 'string' && /^data:image\/(png|jpeg);base64,/.test(result) ? result : null
  },
  async readPdf(path) {
    if (typeof path !== 'string' || !path || path.length > 4096) return null
    const result: unknown = await ipcRenderer.invoke('agent-workspace:read-pdf', path)
    return result instanceof Uint8Array ? result : null
  },
  async imageThumbnail(workspacePath, relativePath) {
    if (typeof workspacePath !== 'string' || typeof relativePath !== 'string' || workspacePath.length > 4096 || relativePath.length > 1024) return null
    const result: unknown = await ipcRenderer.invoke('agent-workspace:image-thumbnail', workspacePath, relativePath)
    return typeof result === 'string' && /^data:image\/(png|jpeg);base64,/.test(result) ? result : null
  },
  async selectSessionExportPath(suggestedName) {
    const name = typeof suggestedName === 'string' ? suggestedName.slice(0, 200) : ''
    const result: unknown = await ipcRenderer.invoke('agent-workspace:select-session-export-path', name)
    return typeof result === 'string' && result.length <= 4096 ? result : null
  },
  async selectSessionArchive() {
    const result: unknown = await ipcRenderer.invoke('agent-workspace:select-session-archive')
    return typeof result === 'string' && result.length <= 4096 ? result : null
  },
  async selectKnowledgeFiles(suffixes) {
    const offered = Array.isArray(suffixes) ? suffixes.filter((suffix) => typeof suffix === 'string').slice(0, 64) : []
    const result: unknown = await ipcRenderer.invoke('agent-workspace:select-knowledge-files', offered)
    return Array.isArray(result)
      ? result.filter((path): path is string => typeof path === 'string' && path.length > 0 && path.length <= 4096).slice(0, 50)
      : []
  },
  getPathForFile(file) {
    try {
      const path = webUtils.getPathForFile(file)
      return path && path.length <= 4096 ? path : null
    } catch {
      return null
    }
  },
}

contextBridge.exposeInMainWorld('agentWorkspace', Object.freeze(api))

import { z } from 'zod'

import type { NativeAppearanceRequest, NativeAppearanceResult } from './appearance'
import type { AppInfo, DesktopNotification, UpdateStatus } from './desktop'
import type { WindowAction, WindowActionResult } from './window'
import type { AttachmentCapability, AttachmentImportFile } from './attachments'
export type { AttachmentCapability, AttachmentImportFile } from './attachments'
import {
  COMMAND_TYPES,
  jsonValueSchema,
  type EventEnvelope,
  type ResponseEnvelope,
} from './protocol'

// Keep this as an independent object schema.  `commandEnvelopeSchema` carries
// a cross-field refinement for autonomy payloads; Zod 4 intentionally refuses
// `.omit()` on refined object schemas, which used to make every renderer test
// crash during module import.  The UI command has the same wire fields after
// removing the transport-owned envelope metadata, and validates the one
// cross-field rule locally.
export const uiCommandSchema = z
  .object({
    type: z.enum(COMMAND_TYPES),
    payload: z.record(z.string(), jsonValueSchema),
    sessionId: z.string().min(1).max(256).nullable(),
  })
  .strict()
  .superRefine((command, context) => {
    if (command.type !== 'runtime.autonomy.set') return
    const autonomy = command.payload.autonomy
    if (!['ask', 'workspace', 'yolo', 'full_access'].includes(String(autonomy))) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['payload', 'autonomy'],
        message: 'invalid_autonomy',
      })
    }
  })

export type UiCommand = z.infer<typeof uiCommandSchema>
export type UiResponse = ResponseEnvelope
export type UiEvent = EventEnvelope

export const PROVIDER_PROTOCOLS = [
  'openai-compatible',
  'anthropic',
  'gemini',
  'ollama',
] as const

export type ProviderProtocol = (typeof PROVIDER_PROTOCOLS)[number]

export interface ProviderProfile {
  id: string
  name: string
  protocol: ProviderProtocol
  baseUrl: string
  model: string
  isDefault: boolean
  hasCredential: boolean
}

export interface ProviderListResult {
  providers: ProviderProfile[]
  defaultProviderId: string | null
}

export interface ProviderSettingsInput {
  providerId: string
  name: string
  protocol: ProviderProtocol
  baseUrl: string
  model: string
  apiKey?: string
  makeDefault?: boolean
}

export interface ProviderCapabilities {
  streaming: boolean
  toolCalling: boolean | null
  vision: boolean | null
  reasoning: boolean | null
  contextWindow: number | null
}

export interface ProviderHealthResult {
  providerId: string
  model: string
  status: 'healthy' | 'degraded' | 'needs_setup' | 'needs_credential' | 'error'
  ok: boolean
  apiKeyPresent: boolean
  apiKeyValue: null
  latencyMs: number | null
  capabilities: ProviderCapabilities
  errorCode: string | null
  message: string
  remediation: string
}

export interface AgentWorkspaceApi {
  /** The layout to open with until the user chooses one (AGENT_WORKSPACE_INTERFACE). */
  readonly interfaceDefault?: 'simple' | 'full'
  invoke(command: UiCommand): Promise<UiResponse>
  subscribe(listener: (event: UiEvent) => void): () => void
  selectWorkspace(): Promise<string | null>
  selectAttachments(): Promise<readonly AttachmentCapability[]>
  importAttachments(files: readonly AttachmentImportFile[], workspacePath: string): Promise<readonly AttachmentCapability[]>
  pasteAttachments(workspacePath: string): Promise<readonly AttachmentCapability[]>
  clipboardHasAttachments(): boolean
  openExternal(url: string): Promise<boolean>
  openPath(workspaceRelativePdfPath: string): Promise<boolean>
  /** Show a file or folder of the open folder in Explorer, selected; false when it is not there. */
  revealPath?(workspaceRelativePath: string): Promise<boolean>
  /** Put text on the system clipboard, also while the window is in the background. */
  copyText?(text: string): Promise<boolean>
  setAppearance(request: NativeAppearanceRequest): Promise<NativeAppearanceResult>
  controlWindow(action: WindowAction): Promise<WindowActionResult>
  captureFrame(): Promise<{ dataUrl: string; width: number; height: number }>
  reportUnprotectedDrafts?(present: boolean): boolean
  isQuitApproved?(): boolean
  /** Absolute path of a dropped file or folder; null when it has none. */
  getPathForFile?(file: File): string | null
  /** A downscaled data URL for an image inside the workspace; null when unavailable. */
  imageThumbnail?(workspacePath: string, relativePath: string): Promise<string | null>
  /** Native save dialog for a session archive; null when cancelled. */
  selectSessionExportPath?(suggestedName: string): Promise<string | null>
  /** Native open dialog for a session archive; null when cancelled. */
  selectSessionArchive?(): Promise<string | null>
  /** Native open dialog for documents of the given types; [] when cancelled. */
  selectKnowledgeFiles?(suffixes: readonly string[]): Promise<readonly string[]>
  /** Desktop host facts and self-update controls; absent outside Electron. */
  desktop?: DesktopHostApi
}

export interface DesktopHostApi {
  getAppInfo(): Promise<AppInfo>
  openLogFolder(): Promise<boolean>
  getUpdateStatus(): Promise<UpdateStatus>
  getUpdateFeed(): Promise<string | null>
  setUpdateFeed(url: string | null): Promise<boolean>
  checkForUpdates(): Promise<UpdateStatus>
  downloadUpdate(): Promise<UpdateStatus>
  installUpdate(): Promise<boolean>
  onUpdateStatus(listener: (status: UpdateStatus) => void): () => void
  /** Saves a redacted diagnostics report; resolves to the saved path or null when cancelled. */
  exportDiagnostics(workbench: Record<string, unknown>): Promise<string | null>
  /** Shows a system notification while the window is in the background; false when skipped. */
  notify(notification: DesktopNotification): Promise<boolean>
  onNotificationActivated(listener: (sessionId: string | null) => void): () => void
}

declare global {
  interface Window {
    agentWorkspace: AgentWorkspaceApi
  }
}

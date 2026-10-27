import { closeSync, openSync, readSync, realpathSync, statSync } from 'node:fs'
import { extname, isAbsolute, relative, resolve, sep } from 'node:path'

export const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "worker-src 'self' blob:",
  "connect-src 'none'",
  "media-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'none'",
].join('; ')

export function isAllowedExternalUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return (
      url.protocol === 'https:' &&
      url.hostname.length > 0 &&
      url.username.length === 0 &&
      url.password.length === 0
    )
  } catch {
    return false
  }
}

// Documents the default app may open, each recognized by how its file begins: a PDF, the zip
// package of a Word, Excel or PowerPoint file (macro-enabled formats are not listed), or a
// picture (such as a photo a phone sent).
const OPENABLE_DOCUMENTS: Record<string, string> = {
  '.pdf': '%PDF-', '.docx': 'PK\u0003\u0004', '.xlsx': 'PK\u0003\u0004', '.pptx': 'PK\u0003\u0004',
  '.png': '\u0089PNG', '.jpg': 'ÿØÿ', '.jpeg': 'ÿØÿ', '.gif': 'GIF8', '.webp': 'RIFF',
}

/** A file or folder inside the open folder (links that lead out of it are refused). */
export function resolveWorkspaceEntryPath(workspace: string | null, input: unknown): string | null {
  if (!workspace || typeof input !== 'string' || !input || input.length > 4096 ||
      input.includes('\0') || isAbsolute(input)) {
    return null
  }
  try {
    const root = realpathSync(workspace)
    const path = realpathSync(resolve(root, input))
    const distance = relative(root, path)
    if (!distance || distance === '..' || distance.startsWith(`..${sep}`) || isAbsolute(distance)) {
      return null
    }
    return path
  } catch {
    return null
  }
}

export function resolveWorkspaceDocumentPath(workspace: string | null, input: unknown): string | null {
  if (!workspace || typeof input !== 'string' || !input || input.length > 4096 ||
      input.includes('\0') || isAbsolute(input) || !(extname(input).toLowerCase() in OPENABLE_DOCUMENTS)) {
    return null
  }
  try {
    const root = realpathSync(workspace)
    const path = realpathSync(resolve(root, input))
    const distance = relative(root, path)
    if (!distance || distance === '..' || distance.startsWith(`..${sep}`) || isAbsolute(distance)) {
      return null
    }
    const signature = OPENABLE_DOCUMENTS[extname(path).toLowerCase()]
    if (!signature || !statSync(path).isFile()) return null
    const file = openSync(path, 'r')
    try {
      const header = Buffer.alloc(signature.length)
      return readSync(file, header, 0, header.length, 0) === header.length
        && header.toString('latin1') === signature ? path : null
    } finally {
      closeSync(file)
    }
  } catch {
    return null
  }
}

export function isTrustedIpcSender(
  sender: unknown,
  senderFrame: unknown,
  trustedSender: unknown,
  trustedMainFrame: unknown,
): boolean {
  return sender === trustedSender && senderFrame === trustedMainFrame
}

export interface SessionWithPermissions {
  setPermissionRequestHandler?: (
    handler: (
      webContents: unknown,
      permission: string,
      callback: (permissionGranted: boolean) => void,
      details: unknown,
    ) => void,
  ) => void
  setPermissionCheckHandler?: (
    handler: (
      webContents: unknown,
      permission: string,
      requestingOrigin: string,
      details: unknown,
    ) => boolean,
  ) => void
}

function isAudioOnlyMediaRequest(permission: string, details: unknown): boolean {
  if (permission !== 'media' || !details || typeof details !== 'object') return false
  const record = details as { mediaTypes?: unknown; mediaType?: unknown }
  if (Array.isArray(record.mediaTypes)) {
    return record.mediaTypes.length === 1 && record.mediaTypes[0] === 'audio'
  }
  return record.mediaType === 'audio'
}

export interface SessionSecurityOptions {
  /** Whether a request comes from the app's own window; only it may use the microphone. */
  isTrustedRequester?: (webContents: unknown) => boolean
}

/**
 * Denies every device and browser permission except microphone-only capture
 * for the app's own window, which composer voice input needs. Camera, screen
 * capture and everything else stay denied.
 */
export function installSessionSecurity(session: SessionWithPermissions, options: SessionSecurityOptions = {}): void {
  const microphoneAllowed = (webContents: unknown, permission: string, details: unknown): boolean =>
    isAudioOnlyMediaRequest(permission, details) && options.isTrustedRequester?.(webContents) === true
  if (typeof session.setPermissionRequestHandler === 'function') {
    session.setPermissionRequestHandler((webContents, permission, callback, details) => {
      callback(microphoneAllowed(webContents, permission, details))
    })
  }
  if (typeof session.setPermissionCheckHandler === 'function') {
    session.setPermissionCheckHandler((webContents, permission, _origin, details) => {
      return microphoneAllowed(webContents, permission, details)
    })
  }
}

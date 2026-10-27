import { realpathSync, statSync } from 'node:fs'
import { isAbsolute, normalize, resolve, sep } from 'node:path'

const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|webp)$/i
export const MAX_THUMBNAIL_SOURCE_BYTES = 25 * 1024 * 1024

function within(root: string, candidate: string): boolean {
  const base = root.endsWith(sep) ? root : root + sep
  return process.platform === 'win32'
    ? candidate.toLowerCase().startsWith(base.toLowerCase())
    : candidate.startsWith(base)
}

/**
 * Resolves a workspace-relative image path to a real file inside the workspace.
 * Rejects traversal, symlink escapes, non-image extensions and oversized files.
 */
export function resolveWorkspaceImage(root: unknown, relativePath: unknown): string | null {
  if (typeof root !== 'string' || !root || root.length > 4096 || !isAbsolute(root)) return null
  if (typeof relativePath !== 'string' || !relativePath || relativePath.length > 1024 || relativePath.includes('\0')) return null
  if (isAbsolute(relativePath) || !IMAGE_EXTENSIONS.test(relativePath)) return null
  if (normalize(relativePath).split(/[\\/]/).includes('..')) return null
  try {
    const realRoot = realpathSync(root)
    const realFile = realpathSync(resolve(realRoot, relativePath))
    if (!within(realRoot, realFile)) return null
    const stats = statSync(realFile)
    if (!stats.isFile() || stats.size === 0 || stats.size > MAX_THUMBNAIL_SOURCE_BYTES) return null
    return realFile
  } catch {
    return null
  }
}

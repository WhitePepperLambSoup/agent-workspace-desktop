/** Separates dropped folders from dropped files. */
export function splitDroppedItems(transfer: DataTransfer): { folders: File[]; files: File[] } {
  const folders: File[] = []
  const files: File[] = []
  const items = Array.from(transfer.items ?? [])
  if (items.length === 0) return { folders, files: Array.from(transfer.files ?? []) }
  for (const item of items) {
    if (item.kind !== 'file') continue
    const file = item.getAsFile()
    if (!file) continue
    const entry = typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null
    ;(entry?.isDirectory ? folders : files).push(file)
  }
  return { folders, files }
}

export function hasDroppedFiles(transfer: DataTransfer): boolean {
  return Array.from(transfer.types ?? []).includes('Files')
}

/** Resolves a dropped folder to its absolute path through the desktop bridge. */
export function droppedFolderPath(file: File): string | null {
  try {
    const path = window.agentWorkspace?.getPathForFile?.(file)
    return typeof path === 'string' && path ? path : null
  } catch {
    return null
  }
}

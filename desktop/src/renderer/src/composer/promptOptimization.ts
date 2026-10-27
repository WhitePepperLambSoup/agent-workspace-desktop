export interface PromptOptimizationSelection {
  providerId: string
  model: string
}

const STORAGE_KEY = 'agentWorkspace.promptOptimizationProvider'

export function readPromptOptimizationSelection(): PromptOptimizationSelection | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    const record = value as Record<string, unknown>
    return typeof record.providerId === 'string' && record.providerId &&
      typeof record.model === 'string' && record.model
      ? { providerId: record.providerId, model: record.model }
      : null
  } catch {
    return null
  }
}

export function writePromptOptimizationSelection(selection: PromptOptimizationSelection | null): void {
  try {
    if (selection === null) window.localStorage.removeItem(STORAGE_KEY)
    else window.localStorage.setItem(STORAGE_KEY, JSON.stringify(selection))
  } catch {
    // Settings remain session-local when storage is unavailable.
  }
}

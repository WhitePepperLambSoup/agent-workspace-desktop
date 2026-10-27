/** Batches of file changes the agent made with organize_files, as the gateway reports them. */

export type FileAction = 'move' | 'copy' | 'recycle' | 'make_folder'
/** How a step reads to the user: a move within one folder is a rename. */
export type FileVerb = FileAction | 'rename'

export interface FileBatchStepView {
  action: FileAction
  path: string
  to: string | null
  auto: boolean
  undone: boolean
}

export interface FileBatchProblem {
  path: string
  // changed, missing, occupied, not_empty, recycled_missing or failed
  reason: string
}

export interface FileBatchView {
  id: string
  summary: string
  createdAt: string
  state: string
  undoable: boolean
  steps: FileBatchStepView[]
  problems: FileBatchProblem[]
}

export interface FileBatchUndoView {
  batch: FileBatchView
  undone: number
  skipped: FileBatchProblem[]
}

const ACTIONS = new Set<FileAction>(['move', 'copy', 'recycle', 'make_folder'])

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function problems(value: unknown): FileBatchProblem[] {
  return Array.isArray(value)
    ? value.flatMap((item) => {
        const entry = record(item)
        return entry && typeof entry.path === 'string' && typeof entry.reason === 'string'
          ? [{ path: entry.path, reason: entry.reason }]
          : []
      })
    : []
}

export function parseFileBatch(value: unknown): FileBatchView | null {
  const batch = record(value)
  if (!batch || typeof batch.id !== 'string' || typeof batch.state !== 'string') return null
  const steps = Array.isArray(batch.steps)
    ? batch.steps.flatMap((item): FileBatchStepView[] => {
        const step = record(item)
        if (!step || !ACTIONS.has(step.action as FileAction) || typeof step.path !== 'string') return []
        return [{
          action: step.action as FileAction,
          path: step.path,
          to: typeof step.to === 'string' ? step.to : null,
          auto: step.auto === true,
          undone: step.undone === true,
        }]
      })
    : []
  return {
    id: batch.id,
    summary: typeof batch.summary === 'string' ? batch.summary : '',
    createdAt: typeof batch.createdAt === 'string' ? batch.createdAt : '',
    state: batch.state,
    undoable: batch.undoable === true,
    steps,
    problems: problems(batch.problems),
  }
}

export function parseUndo(value: unknown): FileBatchUndoView | null {
  const reply = record(value)
  const batch = parseFileBatch(reply?.batch)
  if (!reply || !batch) return null
  return { batch, undone: typeof reply.undone === 'number' ? reply.undone : 0, skipped: problems(reply.skipped) }
}

function parent(path: string): string {
  const index = path.lastIndexOf('/')
  return index < 0 ? '' : path.slice(0, index)
}

export function stepVerb(step: { action: string; path: string; to?: string | null }): FileVerb {
  if (step.action === 'move' && step.to && parent(step.to) === parent(step.path)) return 'rename'
  return ACTIONS.has(step.action as FileAction) ? step.action as FileAction : 'move'
}

/** The changes the user asked for, without the destination folders the batch made on the way. */
export function visibleSteps(batch: FileBatchView): FileBatchStepView[] {
  return batch.steps.filter((step) => !step.auto)
}

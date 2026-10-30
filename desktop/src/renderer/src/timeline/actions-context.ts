import { createContext } from 'react'

import type { FileBatchUndoView } from '../files/model'

/** A file an undo put back, or left alone and why (changed, not_kept, unsafe, failed). */
export interface TurnFileUndo {
  path: string
  reason: string | null
}

/** Actions a tool row can take through the window's client (absent outside a conversation). */
export interface TimelineActions {
  undoFileBatch?: (batchId: string) => Promise<FileBatchUndoView>
  /** Put files a turn created or changed back (all of them when paths is null). */
  undoTurnFiles?: (eventId: string, paths: readonly string[] | null) => Promise<TurnFileUndo[]>
  /** The conversation whose turns the timeline shows, for a file's change. */
  sessionId?: string
}

export const TimelineActionsContext = createContext<TimelineActions>({})

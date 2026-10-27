import { createContext } from 'react'

import type { FileBatchUndoView } from '../files/model'

/** Actions a tool row can take through the window's client (absent outside a conversation). */
export interface TimelineActions {
  undoFileBatch?: (batchId: string) => Promise<FileBatchUndoView>
}

export const TimelineActionsContext = createContext<TimelineActions>({})

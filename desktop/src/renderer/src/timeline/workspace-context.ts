import { createContext } from 'react'

/** The open workspace root, for resolving workspace-relative files shown in the timeline. */
export const TimelineWorkspaceContext = createContext<string | null>(null)

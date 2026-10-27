export type MessageEntry = {
  id: string
  type: 'message'
  role: 'user' | 'assistant' | 'reasoning' | 'system'
  text: string
  open: boolean
  resources?: readonly { id: string; url: string }[]
  /** A user message that started its turn (not one sent while the turn ran); it can be forked. */
  forkable?: boolean
  /** A paired phone handed this message over, and how (broad_autonomy, private, subtask, handoff). */
  origin?: { device: string; labels: readonly string[] }
}

export type ToolEntry = {
  id: string
  type: 'tool'
  name: string
  state: string
  /** The tool call's attempt, which a file change's rollback copy is stored under. */
  attemptId?: string
  arguments?: unknown
  result?: unknown
}

export type DiffEntry = {
  id: string
  type: 'diff'
  source: string
}

/** Why a turn stopped, or where a forked conversation came from. */
export type NoticeEntry = {
  id: string
  type: 'notice'
  kind: 'failed' | 'forked'
  errorType?: string
  message?: string
  sourceSessionId?: string
  sourceModel?: string
  compareModel?: string
}

export type TimelineEntry = MessageEntry | ToolEntry | DiffEntry | NoticeEntry

export interface ApprovalItem {
  requestId: string
  title: string
  detail: string
  supportsSessionScope: boolean
  // The sub-agent asking, when the request comes from one this conversation started.
  subagent?: string
  // Every change of a file batch (organize_files), listed before it is approved.
  plan?: ReadonlyArray<{ action: string; path: string; to?: string }>
  planTotal?: number
}

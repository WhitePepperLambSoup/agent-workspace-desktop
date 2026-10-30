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

/** One file in the list a turn ends with. */
export interface TurnFile {
  path: string
  change: 'created' | 'modified' | 'deleted' | 'moved'
  /** The agent wrote, moved or deleted it; 'other' changed while the turn ran a command. */
  by: 'agent' | 'other'
  to?: string
  bytes?: number
  /** One of the agent's recorded writes, which can be put back. */
  undoable?: boolean
}

/** The files a turn changed, under its answer (``turn.files.changed``). */
export type FilesEntry = {
  id: string
  type: 'files'
  files: readonly TurnFile[]
  /** Changed files beyond the list. */
  omitted: number
  /** Whether the folder could be listed, so changes made by commands are included. */
  listed: boolean
  /** Files put back since (``turn.files.undone``). */
  undone: readonly string[]
}

export type TimelineEntry = MessageEntry | ToolEntry | DiffEntry | NoticeEntry | FilesEntry

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

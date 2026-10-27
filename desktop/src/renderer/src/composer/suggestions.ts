/** A composer command typed as `/name [argument]` on a single line. */
export interface SlashCommand {
  name: string
  description: string
  /** Shown after the name when the command takes an argument, e.g. `coding|research|task`. */
  argumentHint?: string
  run: (argument: string) => void | Promise<unknown>
}

export interface SlashDraft {
  name: string
  argument: string
  /** True while the name itself is still being typed (no space yet). */
  typingName: boolean
}

const SLASH_DRAFT = /^\/([a-z][a-z0-9-]*)?(?:(\s+)(.*))?$/i

export function parseSlashDraft(draft: string): SlashDraft | null {
  if (draft.includes('\n')) return null
  const match = SLASH_DRAFT.exec(draft)
  if (!match) return null
  return { name: (match[1] ?? '').toLowerCase(), argument: (match[3] ?? '').trim(), typingName: match[2] === undefined }
}

export function matchSlashCommands(commands: readonly SlashCommand[], prefix: string): SlashCommand[] {
  const query = prefix.toLowerCase()
  return commands.filter((command) => command.name.startsWith(query))
}

/** Finds an `@query` token that ends at the caret and starts a word. */
export function mentionAtCaret(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret)
  const match = /(^|\s)@([^\s@`]*)$/.exec(before)
  if (!match) return null
  return { start: caret - match[2].length - 1, query: match[2] }
}

/** Ranks workspace paths for a mention query: name prefix, name, then path matches. */
export function rankMentionPaths(paths: readonly string[], query: string, limit = 8): string[] {
  const needle = query.toLowerCase().replaceAll('\\', '/')
  const scored: Array<{ path: string; score: number }> = []
  for (const path of paths) {
    const lower = path.toLowerCase()
    const name = lower.slice(lower.lastIndexOf('/') + 1)
    let score: number
    if (!needle) score = 3
    else if (name.startsWith(needle)) score = 0
    else if (name.includes(needle)) score = 1
    else if (lower.includes(needle)) score = 2
    else continue
    scored.push({ path, score })
  }
  scored.sort((left, right) => left.score - right.score || left.path.length - right.path.length || left.path.localeCompare(right.path))
  return scored.slice(0, limit).map((item) => item.path)
}

/** Formats an inserted mention so paths with spaces stay one token for the model. */
export function formatMention(path: string): string {
  return `\`${path}\` `
}

/**
 * Steps through previously sent prompts (oldest first in `history`).
 * Returns the new index (null = back to an empty draft) and its text.
 */
export function recallHistory(history: readonly string[], index: number | null, direction: 'older' | 'newer'): { index: number | null; text: string } | null {
  if (history.length === 0) return null
  if (direction === 'older') {
    const next = index === null ? history.length - 1 : Math.max(0, index - 1)
    return { index: next, text: history[next] }
  }
  if (index === null) return null
  const next = index + 1
  return next >= history.length ? { index: null, text: '' } : { index: next, text: history[next] }
}

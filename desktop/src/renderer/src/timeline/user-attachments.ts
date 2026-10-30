export interface UserAttachmentDisplay {
  body: string
  filenames: readonly string[]
}

/** The first line of the message the app sends when the folder's checks failed after a turn
 * (ui_gateway/gateway_project.py CHECKS_MARKER): shown as a notice, kept out of prompt history. */
export const CHECKS_MARKER = '<!-- agent-workspace:checks -->'

/** The first line of a prompt the Specs tab sends (coding/specs.py SPEC_MARKER); the second is
 * a comment with the spec, its step and task. Shown as a notice, kept out of prompt history. */
export const SPEC_MARKER = '<!-- agent-workspace:spec -->'

export interface SpecPromptMeta {
  spec: string
  title: string
  step: string
  task: string | null
}

export function specPromptMeta(text: string): SpecPromptMeta | null {
  if (!text.startsWith(SPEC_MARKER)) return null
  const line = text.slice(SPEC_MARKER.length).trimStart().split('\n', 1)[0] ?? ''
  const match = /^<!-- (\{.*\}) -->$/.exec(line)
  if (!match) return null
  try {
    const meta = JSON.parse(match[1]!) as Record<string, unknown>
    return {
      spec: String(meta.spec ?? ''),
      title: String(meta.title ?? ''),
      step: String(meta.step ?? ''),
      task: typeof meta.task === 'string' ? meta.task : null,
    }
  } catch {
    return null
  }
}

const MAX_ATTACHMENTS = 8
const MAX_FILENAME_LENGTH = 240
const MAX_REFERENCE_TAIL = 4_096
// Match SafeMarkdown's display budget. Larger messages retain their source
// instead of adding another unbounded scan just to recognize a code fence.
const MAX_SOURCE_LENGTH = 500_000
const REFERENCE_LINE = /^\[File reference: \.agent-workspace\/attachments\/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}\/(.{1,240})\]$/

function isStagedBasename(name: string): boolean {
  // Keep the native attachment name restrictions, plus C1 controls. Square
  // brackets, parentheses, apostrophes and ampersands remain ordinary text.
  return name.length > 0 && name.length <= MAX_FILENAME_LENGTH &&
    !/[\\/\x00-\x1f\x7f-\x9f<>:"|?*]/.test(name) && !/[. ]$/.test(name) &&
    name !== '.' && name !== '..' &&
    !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)
}

function hasOpenFence(source: string, end: number): boolean {
  let fence: { marker: string; length: number } | null = null
  let start = 0
  while (start < end) {
    const newline = source.indexOf('\n', start)
    const lineEnd = newline < 0 || newline > end ? end : newline
    let cursor = start
    while (cursor < lineEnd && cursor - start < 3 && source[cursor] === ' ') cursor += 1
    const marker = source[cursor]
    if (marker === '`' || marker === '~') {
      const markerStart = cursor
      while (cursor < lineEnd && source[cursor] === marker) cursor += 1
      const length = cursor - markerStart
      if (length >= 3) {
        const rest = source.slice(cursor, lineEnd)
        if (fence) {
          if (marker === fence.marker && length >= fence.length && /^[\t \r]*$/.test(rest)) fence = null
        } else if (marker !== '`' || !rest.includes('`')) {
          fence = { marker, length }
        }
      }
    }
    start = lineEnd + 1
  }
  return fence !== null
}

/** Recognize only the Gateway's trailing staged-file block for display.
 * The original message, stored references and model input are never changed.
 * Ambiguous or malformed content stays completely intact.
 */
export function parseUserAttachmentReferences(source: string): UserAttachmentDisplay {
  const unchanged: UserAttachmentDisplay = { body: source, filenames: [] }
  if (source.length > MAX_SOURCE_LENGTH || !source.endsWith(']')) return unchanged

  const tailStart = Math.max(0, source.length - MAX_REFERENCE_TAIL)
  const tail = source.slice(tailStart)
  const separator = tail.lastIndexOf('\n\n')
  if (separator < 0 || tailStart + separator === 0) return unchanged
  const lines = tail.slice(separator + 2).split('\n')
  if (lines.length === 0 || lines.length > MAX_ATTACHMENTS) return unchanged

  const filenames: string[] = []
  for (const line of lines) {
    const match = REFERENCE_LINE.exec(line)
    if (!match || !isStagedBasename(match[1])) return unchanged
    filenames.push(match[1])
  }

  const bodyEnd = tailStart + separator
  if (hasOpenFence(source, bodyEnd)) return unchanged
  return { body: source.slice(0, bodyEnd), filenames }
}

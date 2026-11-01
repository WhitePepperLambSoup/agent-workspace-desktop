/**
 * Anything in the window can ask the conversation's timeline to show one of its rows (a tool
 * call the studio's replay points at). The request waits until the timeline has that row: the
 * conversation may open, or its history load, after the request.
 */
export const TIMELINE_FOCUS_EVENT = 'agent-workspace:timeline-focus'
let pending: string | null = null

export function requestTimelineFocus(entryId: string): void {
  pending = entryId
  window.dispatchEvent(new CustomEvent<string>(TIMELINE_FOCUS_EVENT, { detail: entryId }))
}

/** The row asked for, if the timeline has it now; the request is then done. */
export function takeTimelineFocus(has: (entryId: string) => boolean): string | null {
  if (pending === null || !has(pending)) return null
  const entryId = pending
  pending = null
  return entryId
}

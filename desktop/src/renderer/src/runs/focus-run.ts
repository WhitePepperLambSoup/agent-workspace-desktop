/**
 * Asks the Agent runs page to show one run, whether the page is open already or opens next
 * (a sub-agent chip in the conversation links to its run this way).
 */

export const FOCUS_RUN_EVENT = 'agent-workspace:focus-run'

let pending: string | null = null

export function requestRunFocus(runId: string): void {
  pending = runId
  window.dispatchEvent(new CustomEvent<string>(FOCUS_RUN_EVENT, { detail: runId }))
}

/** The run a request named before the page mounted, once. */
export function takeRunFocus(): string | null {
  const runId = pending
  pending = null
  return runId
}

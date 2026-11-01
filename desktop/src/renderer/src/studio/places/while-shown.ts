/**
 * Runs `ask` every so often while the window is shown: in the notification area, or minimized, a place
 * asks nothing, and it asks at once when the window comes back. Returns what stops it.
 */
export function whileShown(ask: () => void, every: number): () => void {
  const timer = window.setInterval(() => { if (!document.hidden) ask() }, every)
  const onVisibility = (): void => { if (!document.hidden) ask() }
  document.addEventListener('visibilitychange', onVisibility)
  return () => {
    window.clearInterval(timer)
    document.removeEventListener('visibilitychange', onVisibility)
  }
}

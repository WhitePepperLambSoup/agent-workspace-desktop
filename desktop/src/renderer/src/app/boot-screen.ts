import type { WorkbenchState } from '../state/workbench-types'

interface BootStore {
  getState(): Pick<WorkbenchState, 'bootstrapVersion'>
  subscribe(listener: () => void): () => void
}

/** The first state from the engine has arrived, or the start has ended without one. */
export function firstStateArrived(store: BootStore, started: Promise<unknown>): Promise<void> {
  return new Promise((resolve) => {
    const arrived = (): boolean => (store.getState().bootstrapVersion ?? 0) > 0
    if (arrived()) {
      resolve()
      return
    }
    const unsubscribe = store.subscribe(() => {
      if (!arrived()) return
      unsubscribe()
      resolve()
    })
    const ended = (): void => {
      unsubscribe()
      resolve()
    }
    void started.then(ended, ended)
  })
}

/** The window behind it has drawn what it knows; a hidden window draws no frames, so not for long. */
function drawn(): Promise<void> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(resolve, 300)
    requestAnimationFrame(() => requestAnimationFrame(() => {
      window.clearTimeout(timer)
      resolve()
    }))
  })
}

/** End the start-up screen (public/boot.js) once the window has something true to show. */
export async function endBootScreen(store: BootStore, started: Promise<unknown>, rendered: Promise<unknown>): Promise<void> {
  await Promise.all([firstStateArrived(store, started), rendered])
  await drawn()
  window.dispatchEvent(new Event('aw-boot-done'))
}

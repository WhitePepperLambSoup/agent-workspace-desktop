import { WINDOW_CORNER_RADIUS } from '../shared/window-shape'

interface WindowShapeIpc {
  on(channel: string, handler: (event: unknown, shape: unknown) => void): unknown
  removeListener(channel: string, handler: (event: unknown, shape: unknown) => void): unknown
}

/** Reflect the fixed native boundary enum without exposing a renderer IPC API. */
export function synchronizeNativeWindowShape(
  ipc: WindowShapeIpc,
  document: Document,
  getZoomFactor: () => number = () => 1,
): () => void {
  let nativeWindowShape: 'rounded' | 'rectangular' = 'rounded'
  const viewport = document.defaultView
  const syncWindowShape = (): void => {
    const root = document.documentElement
    if (!root) return
    const requestedZoom = getZoomFactor()
    const zoom = Number.isFinite(requestedZoom) && requestedZoom > 0 ? requestedZoom : 1
    const radius = nativeWindowShape === 'rectangular' ? 0 : WINDOW_CORNER_RADIUS / zoom
    root.setAttribute('data-window-shape', nativeWindowShape)
    // Page zoom changes CSS pixels per DIP. devicePixelRatio also includes
    // monitor DPI, which the native setShape API already handles separately.
    root.style.setProperty('--window-radius', `${radius}px`)
  }
  const onShape = (_event: unknown, shape: unknown): void => {
    if (shape !== 'rounded' && shape !== 'rectangular') return
    nativeWindowShape = shape
    syncWindowShape()
  }
  ipc.on('agent-workspace:window-shape', onShape)
  document.addEventListener('DOMContentLoaded', syncWindowShape, { once: true })
  viewport?.addEventListener('resize', syncWindowShape)
  syncWindowShape()
  return () => {
    ipc.removeListener('agent-workspace:window-shape', onShape)
    document.removeEventListener('DOMContentLoaded', syncWindowShape)
    viewport?.removeEventListener('resize', syncWindowShape)
  }
}

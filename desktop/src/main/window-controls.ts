import type { WindowAction, WindowActionResult } from '../shared/window'

interface ControllableWindow {
  minimize(): void
  maximize(): void
  unmaximize(): void
  close(): void
  isMaximized(): boolean
  isFullScreen(): boolean
  setFullScreen(fullscreen: boolean): void
}

export function performWindowAction(
  window: ControllableWindow,
  action: WindowAction,
): WindowActionResult {
  if (action === 'minimize') {
    window.minimize()
    return { maximized: window.isMaximized(), closed: false }
  }
  if (action === 'maximize') {
    // Chromium can otherwise leave fullscreen internally without restoring
    // Electron's DWM corner preference or emitting leave-full-screen.
    if (window.isFullScreen()) window.setFullScreen(false)
    const maximize = !window.isMaximized()
    if (maximize) window.maximize()
    else window.unmaximize()
    return { maximized: maximize, closed: false }
  }
  window.close()
  return { maximized: false, closed: true }
}

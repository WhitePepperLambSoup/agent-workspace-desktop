import type { BrowserWindow, Rectangle } from 'electron'
import type { EventEmitter } from 'node:events'
import { release } from 'node:os'

import { WINDOW_CORNER_RADIUS } from '../shared/window-shape'

export function supportsNativeWindowRounding(platform = process.platform, systemRelease = release()): boolean {
  const build = Number(systemRelease.split('.')[2])
  return platform === 'win32' && Number.isFinite(build) && build >= 22000
}

// Older Windows versions lack compositor rounding. Their solid fallback can
// use an OS region, while Windows 11 rounds its native backdrop and content.
function roundedWindowRegion(width: number, height: number): Rectangle[] {
  const radius = Math.min(WINDOW_CORNER_RADIUS, Math.floor(width / 2), Math.floor(height / 2))
  if (radius === 0) return [{ x: 0, y: 0, width, height }]
  const rectangles: Rectangle[] = []
  if (height > radius * 2) {
    rectangles.push({ x: 0, y: radius, width, height: height - radius * 2 })
  }
  for (let y = 0; y < radius; y += 1) {
    // Pixel centers retain the antialiased CSS curve while the HWND excludes the
    // invisible corner area from both desktop composition and mouse hit testing.
    const dy = radius - y - 0.5
    const inset = Math.max(0, Math.ceil(radius - Math.sqrt(radius * radius - dy * dy) - 0.5))
    rectangles.push({ x: inset, y, width: width - inset * 2, height: 1 })
    rectangles.push({ x: inset, y: height - y - 1, width: width - inset * 2, height: 1 })
  }
  return rectangles
}

/** Install an actual OS window region; return a refresh for native material changes. */
export function installNativeWindowShape(
  window: BrowserWindow, platform = process.platform,
  nativeRounding = supportsNativeWindowRounding(platform),
): () => void {
  // BrowserWindow.webContents is a native getter and throws once the window is
  // destroyed. Keep the emitter reference while installing lifecycle handlers.
  const webContents = window.webContents
  // Transparent Windows windows enter fullscreen by resizing to the display;
  // Electron's widget-based isFullScreen() getter can remain false throughout.
  let fullscreenFromEvents = window.isFullScreen()
  const refresh = (): void => {
    if (window.isDestroyed()) return
    const rectangular = window.isMaximized() || fullscreenFromEvents || window.isFullScreen() ||
      (platform === 'win32' && window.isSnapped())
    if (platform === 'win32') {
      const [width, height] = window.getSize()
      if (width > 0 && height > 0) {
        // An empty region list removes the custom region so maximized/fullscreen
        // windows fill the screen and retain the system's resize/snap behavior.
        // A custom region or per-pixel HWND transparency prevents DWM from
        // clipping system backdrops. Let Windows 11 own the complete outline.
        window.setShape(rectangular || nativeRounding ? [] : roundedWindowRegion(width, height))
      }
    }
    if (!webContents.isDestroyed()) {
      webContents.send('agent-workspace:window-shape', rectangular ? 'rectangular' : 'rounded')
    }
  }
  const enterFullScreen = (): void => {
    fullscreenFromEvents = true
    refresh()
  }
  const leaveFullScreen = (): void => {
    fullscreenFromEvents = false
    refresh()
  }
  const restored = (): void => {
    if (window.isDestroyed()) return
    // Windows can restore the widget without Electron's leave-full-screen
    // event. Complete that transition so DWM's native rounding is restored too.
    if (platform === 'win32' && nativeRounding && fullscreenFromEvents && !window.isFullScreen()) {
      fullscreenFromEvents = false
      window.setFullScreen(false)
    }
    refresh()
  }
  const events = ['resize', 'maximize', 'moved'] as const
  const restoreEvents = ['unmaximize', 'restore'] as const
  // Electron narrows each EventEmitter overload to one event literal; use the
  // inherited emitter interface for this group of payload-free lifecycle events.
  const windowEvents: EventEmitter = window
  for (const event of events) windowEvents.on(event, refresh)
  for (const event of restoreEvents) windowEvents.on(event, restored)
  windowEvents.on('enter-full-screen', enterFullScreen)
  windowEvents.on('leave-full-screen', leaveFullScreen)
  webContents.on('did-finish-load', refresh)
  window.once('closed', () => {
    for (const event of events) windowEvents.removeListener(event, refresh)
    for (const event of restoreEvents) windowEvents.removeListener(event, restored)
    windowEvents.removeListener('enter-full-screen', enterFullScreen)
    windowEvents.removeListener('leave-full-screen', leaveFullScreen)
    webContents.removeListener('did-finish-load', refresh)
  })
  refresh()
  return refresh
}

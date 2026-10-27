import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export interface Rectangle { x: number; y: number; width: number; height: number }

export interface WindowState {
  bounds: Rectangle
  maximized: boolean
}

export const DEFAULT_WINDOW_SIZE = { width: 1440, height: 900 }
export const MINIMUM_WINDOW_SIZE = { width: 960, height: 640 }

function isRectangle(value: unknown): value is Rectangle {
  if (!value || typeof value !== 'object') return false
  const rectangle = value as Record<string, unknown>
  return ['x', 'y', 'width', 'height'].every((key) => Number.isFinite(rectangle[key]))
}

export function parseWindowState(raw: unknown): WindowState | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Record<string, unknown>
  if (!isRectangle(value.bounds) || typeof value.maximized !== 'boolean') return null
  return { bounds: { ...value.bounds }, maximized: value.maximized }
}

function intersectionArea(a: Rectangle, b: Rectangle): number {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  return width > 0 && height > 0 ? width * height : 0
}

/**
 * Returns bounds that fit a currently connected display. A window saved on a
 * monitor that is now disconnected (or a resolution that shrank) is moved and
 * clamped instead of reopening off-screen.
 */
export function restoreBounds(saved: WindowState | null, workAreas: readonly Rectangle[]): Partial<Rectangle> & { width: number; height: number } {
  if (!saved || workAreas.length === 0) return { ...DEFAULT_WINDOW_SIZE }
  const best = workAreas.reduce((current, area) =>
    intersectionArea(saved.bounds, area) > intersectionArea(saved.bounds, current) ? area : current, workAreas[0])
  const visible = intersectionArea(saved.bounds, best)
  const area = visible > 0 ? best : workAreas[0]
  const width = Math.max(MINIMUM_WINDOW_SIZE.width, Math.min(saved.bounds.width, area.width))
  const height = Math.max(MINIMUM_WINDOW_SIZE.height, Math.min(saved.bounds.height, area.height))
  // Require a usable portion of the title bar to remain on screen.
  const usable = visible >= Math.min(width, 200) * 48
  const x = usable ? Math.min(Math.max(saved.bounds.x, area.x), area.x + area.width - width) : area.x + Math.round((area.width - width) / 2)
  const y = usable ? Math.min(Math.max(saved.bounds.y, area.y), area.y + area.height - height) : area.y + Math.round((area.height - height) / 2)
  return { x, y, width, height }
}

export function readWindowState(path: string): WindowState | null {
  try {
    return parseWindowState(JSON.parse(readFileSync(path, 'utf8')))
  } catch {
    return null
  }
}

export function writeWindowState(path: string, state: WindowState): void {
  try {
    mkdirSync(dirname(path), { recursive: true })
    const temporary = `${path}.tmp`
    writeFileSync(temporary, JSON.stringify(state), 'utf8')
    renameSync(temporary, path)
  } catch {
    // Window placement is a convenience; failing to persist it is not fatal.
  }
}

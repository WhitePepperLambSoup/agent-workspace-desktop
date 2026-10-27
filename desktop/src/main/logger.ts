import { appendFileSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { inspect } from 'node:util'

export type LogLevel = 'info' | 'warn' | 'error'

export interface MainLogger {
  info(message: string, detail?: unknown): void
  warn(message: string, detail?: unknown): void
  error(message: string, detail?: unknown): void
  readonly path: string
}

const DEFAULT_MAX_BYTES = 1024 * 1024

function formatDetail(detail: unknown): string {
  if (detail === undefined) return ''
  if (detail instanceof Error) return ` ${detail.stack ?? `${detail.name}: ${detail.message}`}`
  return ` ${inspect(detail, { depth: 4, breakLength: Infinity })}`
}

/**
 * Appends main-process diagnostics to `<directory>/main.log`, keeping one
 * rotated generation. Packaged builds have no console, so this is the only
 * record of startup, crash and sidecar failures.
 */
export function createMainLogger(directory: string, options: { maxBytes?: number; mirror?: Pick<Console, LogLevel> } = {}): MainLogger {
  const path = join(directory, 'main.log')
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
  const mirror = options.mirror
  let directoryReady = false

  const write = (level: LogLevel, message: string, detail: unknown): void => {
    mirror?.[level](message, ...(detail === undefined ? [] : [detail]))
    const line = `${new Date().toISOString()} ${level.toUpperCase()} ${message}${formatDetail(detail)}\n`
    try {
      if (!directoryReady) {
        mkdirSync(directory, { recursive: true })
        directoryReady = true
      }
      let size = 0
      try { size = statSync(path).size } catch { /* First write creates the file. */ }
      if (size + Buffer.byteLength(line) > maxBytes) {
        rmSync(`${path}.1`, { force: true })
        renameSync(path, `${path}.1`)
      }
      appendFileSync(path, line, 'utf8')
    } catch {
      // Logging must never take the application down.
    }
  }

  return {
    path,
    info: (message, detail) => write('info', message, detail),
    warn: (message, detail) => write('warn', message, detail),
    error: (message, detail) => write('error', message, detail),
  }
}

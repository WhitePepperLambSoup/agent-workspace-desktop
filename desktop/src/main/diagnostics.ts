import { existsSync, readFileSync } from 'node:fs'

const SECRET_PATTERNS: readonly RegExp[] = [
  /\b(sk|pk|rk)-[A-Za-z0-9_-]{16,}/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /\b(api[_-]?key|token|password|secret)(["']?\s*[:=]\s*["']?)[^\s"',;]{6,}/gi,
]

/** Masks credential-shaped values so an exported report can be shared. */
export function redactSecrets(text: string): string {
  return SECRET_PATTERNS.reduce((current, pattern) => current.replace(pattern, (match, ...groups) => {
    if (typeof groups[0] === 'string' && typeof groups[1] === 'string' && /api|token|password|secret/i.test(groups[0])) {
      return `${groups[0]}${groups[1]}[redacted]`
    }
    return `${match.slice(0, 4)}[redacted]`
  }), text)
}

export function tailLines(path: string, maxLines: number): string[] {
  if (!existsSync(path)) return []
  try {
    const lines = readFileSync(path, 'utf8').split(/\r?\n/)
    if (lines.at(-1) === '') lines.pop()
    return lines.slice(-maxLines)
  } catch {
    return []
  }
}

export function buildDiagnosticsReport(input: {
  generatedAt: Date
  app: Record<string, unknown>
  renderer: unknown
  logLines: readonly string[]
  previousLogLines: readonly string[]
}): string {
  const section = (title: string, body: string) => `== ${title} ==\n${body.trimEnd()}\n`
  const renderer = JSON.stringify(input.renderer ?? null, null, 2)
  const log = [...input.previousLogLines, ...input.logLines].join('\n') || '(empty)'
  return redactSecrets([
    `Agent Workspace diagnostics\nGenerated: ${input.generatedAt.toISOString()}\n`,
    section('Application', JSON.stringify(input.app, null, 2)),
    section('Workbench', renderer.length > 512_000 ? `${renderer.slice(0, 512_000)}\n[truncated]` : renderer),
    section(`main.log (last ${input.logLines.length + input.previousLogLines.length} lines)`, log),
  ].join('\n'))
}

export function diagnosticsFileName(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `agent-workspace-diagnostics-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}.txt`
}

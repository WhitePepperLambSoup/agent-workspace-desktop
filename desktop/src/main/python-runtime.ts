import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

export type PythonProbe = (executable: string) => boolean

export function probePythonExecutable(executable: string): boolean {
  const result = spawnSync(executable, ['--version'], {
    shell: false,
    stdio: 'ignore',
    timeout: 3_000,
    windowsHide: true,
  })
  return result.error === undefined && result.status === 0
}

export function resolveDevelopmentPython(
  workspaceRoot: string,
  options: {
    platform?: NodeJS.Platform
    configuredExecutable?: string
    probe?: PythonProbe
    exists?: (path: string) => boolean
  } = {},
): string {
  const platform = options.platform ?? process.platform
  const configured = options.configuredExecutable?.trim()
  if (configured) return configured

  const venvPython =
    platform === 'win32'
      ? join(workspaceRoot, '.venv', 'Scripts', 'python.exe')
      : join(workspaceRoot, '.venv', 'bin', 'python')
  const systemCandidates = platform === 'win32' ? ['python.exe', 'py.exe', 'python'] : ['python3', 'python']
  const probe = options.probe ?? probePythonExecutable
  const exists = options.exists ?? existsSync

  if (exists(venvPython) && probe(venvPython)) return venvPython
  for (const candidate of systemCandidates) {
    if (probe(candidate)) return candidate
  }
  return systemCandidates[0]
}

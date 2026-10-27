import { statSync } from 'node:fs'
import { resolve } from 'node:path'

const SIDECAR_STAGING_PATH = 'build/sidecar/agent-workspace-ui-gateway.exe'
const SIDECAR_RUNTIME_PATH = 'build/sidecar/_internal'
const sidecar = resolve(process.cwd(), SIDECAR_STAGING_PATH)
const runtime = resolve(process.cwd(), SIDECAR_RUNTIME_PATH)

try {
  if (!statSync(sidecar).isFile()) throw new Error('not_a_file')
} catch {
  console.error(`missing_packaged_sidecar:${sidecar}`)
  process.exitCode = 1
}

try {
  if (!statSync(runtime).isDirectory()) throw new Error('not_a_directory')
} catch {
  console.error(`missing_packaged_sidecar_runtime:${runtime}`)
  process.exitCode = 1
}

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const root = resolve(desktop, '..')
const [bundleInput, ...testArgs] = process.argv.slice(2)
if (!bundleInput) {
  console.error('Usage: npm run test:packaged -- <bundle-directory> [playwright-options]')
  process.exit(2)
}
const bundleCandidates = [resolve(bundleInput), resolve(root, bundleInput)]
const bundle = bundleCandidates.find((candidate) => existsSync(candidate)) ?? bundleCandidates[0]
const localPython = resolve(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')
const python = process.env.AGENT_WORKSPACE_PYTHON || (existsSync(localPython) ? localPython : 'python')
const verified = spawnSync(python, [resolve(root, 'scripts/build_electron_release.py'), '--verify', bundle], {
  cwd: root, stdio: 'inherit', windowsHide: true,
})
if (verified.error || verified.status !== 0) process.exit(verified.status || 1)
const tested = spawnSync(process.execPath, [resolve(desktop, 'node_modules/@playwright/test/cli.js'),
  'test', 'tests/electron/packaged-release.spec.ts', 'tests/electron/packaged-agent-runs.spec.ts',
  'tests/electron/packaged-usability.spec.ts', ...testArgs], {
  cwd: desktop, stdio: 'inherit', windowsHide: true,
  env: { ...process.env, AGENT_WORKSPACE_E2E_BUNDLE: bundle },
})
if (tested.error) console.error(tested.error.message)
process.exit(tested.status ?? 1)

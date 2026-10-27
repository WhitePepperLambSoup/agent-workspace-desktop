import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { isValidUpdateFeedUrl, type UpdateStatus } from '../shared/desktop'

/** The subset of electron-updater's AppUpdater this controller relies on. */
export interface UpdaterEngine {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  setFeedURL(options: { provider: 'generic'; url: string }): void
  checkForUpdates(): Promise<unknown>
  downloadUpdate(): Promise<unknown>
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void
  on(event: string, listener: (...args: unknown[]) => void): unknown
}

export interface UpdateControllerOptions {
  packaged: boolean
  executableDirectory: string
  settingsPath: string
  environmentFeed?: string
  /** Where releases are published; used when neither the environment nor Settings name one. */
  defaultFeed?: string
  loadEngine: () => Promise<UpdaterEngine>
  onStatus: (status: UpdateStatus) => void
  log: (message: string, detail?: unknown) => void
}

function message(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500)
}

/**
 * Wraps electron-updater with an explicit, user-visible state machine. Updates
 * only apply to NSIS installs (the unpacked directory build cannot replace
 * itself), and the feed URL comes from the environment, Settings or the release default.
 */
export class UpdateController {
  private status: UpdateStatus
  private engine: UpdaterEngine | null = null
  private configuredFeed: string | null

  constructor(private readonly options: UpdateControllerOptions) {
    this.configuredFeed = this.readFeed()
    this.status = this.baseStatus()
  }

  getStatus(): UpdateStatus {
    return this.status
  }

  getFeed(): string | null {
    if (this.options.environmentFeed && isValidUpdateFeedUrl(this.options.environmentFeed)) return this.options.environmentFeed
    if (this.configuredFeed) return this.configuredFeed
    return this.options.defaultFeed && isValidUpdateFeedUrl(this.options.defaultFeed) ? this.options.defaultFeed : null
  }

  /** Persists a user-provided feed. Returns false for non-HTTPS input. */
  setFeed(url: string | null): boolean {
    if (url !== null && !isValidUpdateFeedUrl(url)) return false
    this.configuredFeed = url
    try {
      mkdirSync(dirname(this.options.settingsPath), { recursive: true })
      writeFileSync(this.options.settingsPath, JSON.stringify({ url }), 'utf8')
    } catch (error) {
      this.options.log('Update feed could not be saved', error)
      return false
    }
    this.engine = null
    this.publish(this.baseStatus())
    return true
  }

  async check(): Promise<UpdateStatus> {
    const base = this.baseStatus()
    if (base.state === 'unsupported') {
      this.publish(base)
      return base
    }
    if (this.status.state === 'checking' || this.status.state === 'downloading') return this.status
    this.publish({ state: 'checking' })
    try {
      const engine = await this.ensureEngine()
      await engine.checkForUpdates()
    } catch (error) {
      this.options.log('Update check failed', error)
      this.publish({ state: 'error', message: message(error) })
    }
    return this.status
  }

  async download(): Promise<UpdateStatus> {
    if (this.status.state !== 'available') return this.status
    this.publish({ state: 'downloading', percent: 0 })
    try {
      await (await this.ensureEngine()).downloadUpdate()
    } catch (error) {
      this.options.log('Update download failed', error)
      this.publish({ state: 'error', message: message(error) })
    }
    return this.status
  }

  install(): boolean {
    if (this.status.state !== 'downloaded' || !this.engine) return false
    this.engine.quitAndInstall(false, true)
    return true
  }

  private baseStatus(): UpdateStatus {
    if (!this.options.packaged) return { state: 'unsupported', reason: 'development' }
    // NSIS installs place their uninstaller next to the executable.
    if (!existsSync(join(this.options.executableDirectory, 'Uninstall AgentWorkspace.exe'))) {
      return { state: 'unsupported', reason: 'not-installed' }
    }
    if (!this.getFeed()) return { state: 'unsupported', reason: 'no-feed' }
    return { state: 'idle' }
  }

  private readFeed(): string | null {
    try {
      const raw = JSON.parse(readFileSync(this.options.settingsPath, 'utf8')) as { url?: unknown }
      return typeof raw.url === 'string' && isValidUpdateFeedUrl(raw.url) ? raw.url : null
    } catch {
      return null
    }
  }

  private async ensureEngine(): Promise<UpdaterEngine> {
    const feed = this.getFeed()
    if (!feed) throw new Error('update_feed_unconfigured')
    if (this.engine) return this.engine
    const engine = await this.options.loadEngine()
    engine.autoDownload = false
    engine.autoInstallOnAppQuit = true
    engine.setFeedURL({ provider: 'generic', url: feed })
    engine.on('update-available', (info) => {
      const version = (info as { version?: unknown } | undefined)?.version
      this.publish({ state: 'available', version: typeof version === 'string' ? version : '' })
    })
    engine.on('update-not-available', () => this.publish({ state: 'not-available', checkedAt: Date.now() }))
    engine.on('download-progress', (progress) => {
      const percent = (progress as { percent?: unknown } | undefined)?.percent
      this.publish({ state: 'downloading', percent: typeof percent === 'number' ? Math.max(0, Math.min(100, percent)) : 0 })
    })
    engine.on('update-downloaded', (info) => {
      const version = (info as { version?: unknown } | undefined)?.version
      this.publish({ state: 'downloaded', version: typeof version === 'string' ? version : '' })
    })
    engine.on('error', (error) => {
      this.options.log('Updater error', error)
      this.publish({ state: 'error', message: message(error) })
    })
    this.engine = engine
    return engine
  }

  private publish(status: UpdateStatus): void {
    this.status = status
    this.options.onStatus(status)
  }
}

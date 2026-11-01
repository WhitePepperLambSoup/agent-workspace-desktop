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
  now?: () => number
}

const AUTO_CHECK_FIRST_MS = 60_000
const AUTO_CHECK_POLL_MS = 60 * 60_000
const AUTO_CHECK_INTERVAL_MS = 24 * 60 * 60_000

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
  private autoCheck: boolean
  private lastCheckedAt: number
  private autoCheckTimer: NodeJS.Timeout | null = null
  // A check nobody asked for fails quietly: being offline is not worth a message.
  private quiet = false

  constructor(private readonly options: UpdateControllerOptions) {
    const saved = this.readSettings()
    this.configuredFeed = saved.url
    this.autoCheck = saved.autoCheck
    this.lastCheckedAt = saved.lastCheckedAt
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

  getAutoCheck(): boolean {
    return this.autoCheck
  }

  setAutoCheck(enabled: boolean): boolean {
    this.autoCheck = enabled
    this.saveSettings()
    return enabled
  }

  /** Looks for a new version once a day while the app runs, unless turned off; never downloads. */
  startAutoChecks(): void {
    if (this.autoCheckTimer || this.baseStatus().state === 'unsupported') return
    this.scheduleAutoCheck(AUTO_CHECK_FIRST_MS)
  }

  stopAutoChecks(): void {
    if (this.autoCheckTimer) clearTimeout(this.autoCheckTimer)
    this.autoCheckTimer = null
  }

  private scheduleAutoCheck(delay: number): void {
    this.autoCheckTimer = setTimeout(() => {
      void this.runAutoCheck().finally(() => this.scheduleAutoCheck(AUTO_CHECK_POLL_MS))
    }, delay)
    this.autoCheckTimer.unref?.()
  }

  private async runAutoCheck(): Promise<void> {
    const now = this.options.now?.() ?? Date.now()
    if (!this.autoCheck || now - this.lastCheckedAt < AUTO_CHECK_INTERVAL_MS) return
    // Something the user is in the middle of, or has already been told about, stays as it is.
    if (this.status.state !== 'idle' && this.status.state !== 'not-available' && this.status.state !== 'error') return
    this.quiet = true
    try {
      await this.check()
    } finally {
      this.quiet = false
    }
  }

  private checked(): void {
    this.lastCheckedAt = this.options.now?.() ?? Date.now()
    this.saveSettings()
  }

  private fail(context: string, error: unknown): void {
    this.options.log(context, error)
    this.publish(this.quiet ? { state: 'idle' } : { state: 'error', message: message(error) })
  }

  /** Persists a user-provided feed. Returns false for non-HTTPS input. */
  setFeed(url: string | null): boolean {
    if (url !== null && !isValidUpdateFeedUrl(url)) return false
    this.configuredFeed = url
    if (!this.saveSettings()) return false
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
      this.fail('Update check failed', error)
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

  private readSettings(): { url: string | null; autoCheck: boolean; lastCheckedAt: number } {
    try {
      const raw = JSON.parse(readFileSync(this.options.settingsPath, 'utf8')) as { url?: unknown; autoCheck?: unknown; lastCheckedAt?: unknown }
      return {
        url: typeof raw.url === 'string' && isValidUpdateFeedUrl(raw.url) ? raw.url : null,
        autoCheck: raw.autoCheck !== false,
        lastCheckedAt: typeof raw.lastCheckedAt === 'number' ? raw.lastCheckedAt : 0,
      }
    } catch {
      return { url: null, autoCheck: true, lastCheckedAt: 0 }
    }
  }

  private saveSettings(): boolean {
    try {
      mkdirSync(dirname(this.options.settingsPath), { recursive: true })
      writeFileSync(this.options.settingsPath, JSON.stringify({ url: this.configuredFeed, autoCheck: this.autoCheck, lastCheckedAt: this.lastCheckedAt }), 'utf8')
      return true
    } catch (error) {
      this.options.log('Update settings could not be saved', error)
      return false
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
      this.checked()
      const version = (info as { version?: unknown } | undefined)?.version
      this.publish({ state: 'available', version: typeof version === 'string' ? version : '' })
    })
    engine.on('update-not-available', () => {
      this.checked()
      this.publish({ state: 'not-available', checkedAt: Date.now() })
    })
    engine.on('download-progress', (progress) => {
      const percent = (progress as { percent?: unknown } | undefined)?.percent
      this.publish({ state: 'downloading', percent: typeof percent === 'number' ? Math.max(0, Math.min(100, percent)) : 0 })
    })
    engine.on('update-downloaded', (info) => {
      const version = (info as { version?: unknown } | undefined)?.version
      this.publish({ state: 'downloaded', version: typeof version === 'string' ? version : '' })
    })
    engine.on('error', (error) => this.fail('Updater error', error))
    this.engine = engine
    return engine
  }

  private publish(status: UpdateStatus): void {
    this.status = status
    this.options.onStatus(status)
  }
}

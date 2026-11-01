import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import {
  backgroundSettingsSchema,
  DEFAULT_BACKGROUND_SETTINGS,
  DEFAULT_MAIN_STRINGS,
  type BackgroundSettings,
  type MainStrings,
} from '../shared/desktop'

/** What would stop if the app quit. */
export interface AppActivity {
  runningTasks: number
  schedules: number
  phoneLink: boolean
}

const IDLE: AppActivity = { runningTasks: 0, schedules: 0, phoneLink: false }

export type CloseChoice = 'hide' | 'quit' | 'stay'

export function readBackgroundSettings(path: string): BackgroundSettings {
  try {
    return backgroundSettingsSchema.parse(JSON.parse(readFileSync(path, 'utf8')))
  } catch {
    return { ...DEFAULT_BACKGROUND_SETTINGS }
  }
}

export function fillIn(template: string, count: number): string {
  return template.replace('{count}', String(count))
}

/**
 * What closing the window does. A saved choice stands, except that quitting with tasks at work
 * asks first; with no saved choice it asks only when something would stop.
 */
export function closeDecision(settings: BackgroundSettings, activity: AppActivity): 'hide' | 'quit' | 'ask' {
  if (settings.closeAction === 'background') return 'hide'
  if (activity.runningTasks > 0) return 'ask'
  if (settings.closeAction === 'quit') return 'quit'
  return activity.schedules > 0 || activity.phoneLink ? 'ask' : 'quit'
}

export interface TrayLike {
  update(tooltip: string, runningLabel: string | null, showLabel: string, quitLabel: string): void
  notify(title: string, body: string): void
  destroy(): void
}

export interface BackgroundDependencies {
  settingsPath: string
  /** The app's state from the sidecar; rejects when it cannot tell. */
  readActivity(): Promise<AppActivity>
  /** Asks what closing the window should do; with `remember`, the choice is kept. */
  ask(activity: AppActivity, strings: MainStrings): Promise<{ choice: CloseChoice; remember: boolean }>
  /** The system tray; null where the app has no business showing one (test instances). */
  createTray(actions: { show(): void; quit(): void }): TrayLike | null
  hideWindow(): void
  showWindow(): void
  quit(): void
  applyLogin(settings: BackgroundSettings): void
  sleep: { start(): number; stop(id: number): void }
  log(message: string, detail?: unknown): void
  now?: () => number
}

const ACTIVITY_TIMEOUT_MS = 1500

/**
 * Keeps the app alive behind its window when the user wants that: the close decision, the tray
 * icon, start at login, and holding off sleep while a task runs.
 */
export class BackgroundController {
  private settings: BackgroundSettings
  private strings: MainStrings = DEFAULT_MAIN_STRINGS
  private tray: TrayLike | null = null
  private activity: AppActivity = IDLE
  private sleepHold: number | null = null
  private deciding = false
  private hiddenNoticeShown = false

  constructor(private readonly dependencies: BackgroundDependencies) {
    this.settings = readBackgroundSettings(dependencies.settingsPath)
  }

  /** At start: the saved login item, and the tray if the app is set to live there. */
  start(startedHidden: boolean): void {
    this.dependencies.applyLogin(this.settings)
    if (startedHidden || this.settings.closeAction === 'background') this.ensureTray()
  }

  getSettings(): BackgroundSettings {
    return this.settings
  }

  setSettings(next: BackgroundSettings): BackgroundSettings {
    this.settings = next
    try {
      mkdirSync(dirname(this.dependencies.settingsPath), { recursive: true })
      writeFileSync(this.dependencies.settingsPath, JSON.stringify(next), 'utf8')
    } catch (error) {
      this.dependencies.log('Background settings could not be saved', error)
    }
    this.dependencies.applyLogin(next)
    if (next.closeAction === 'background') this.ensureTray()
    this.applyActivity()
    return next
  }

  setStrings(strings: MainStrings): void {
    this.strings = strings
    this.applyActivity()
  }

  getStrings(): MainStrings {
    return this.strings
  }

  /** Reads what is at work, for the tray and the sleep hold. */
  async refresh(): Promise<AppActivity> {
    try {
      this.activity = await withTimeout(this.dependencies.readActivity(), ACTIVITY_TIMEOUT_MS)
    } catch {
      // A sidecar that is restarting or busy has nothing to report; keep the last known state.
    }
    this.applyActivity()
    return this.activity
  }

  /** The window's close button: the decision takes a moment, so the close was already held. */
  async handleClose(): Promise<CloseChoice> {
    if (this.deciding) return 'stay'
    this.deciding = true
    try {
      const activity = await this.refresh()
      const decision = closeDecision(this.settings, activity)
      if (decision !== 'ask') return decision === 'hide' ? this.hide() : 'quit'
      const { choice, remember } = await this.dependencies.ask(activity, this.strings)
      if (remember && choice !== 'stay') this.setSettings({ ...this.settings, closeAction: choice === 'hide' ? 'background' : 'quit' })
      return choice === 'hide' ? this.hide() : choice
    } finally {
      this.deciding = false
    }
  }

  dispose(): void {
    if (this.sleepHold !== null) this.dependencies.sleep.stop(this.sleepHold)
    this.sleepHold = null
    this.tray?.destroy()
    this.tray = null
  }

  private hide(): CloseChoice {
    this.ensureTray()
    this.dependencies.hideWindow()
    if (!this.hiddenNoticeShown) {
      this.hiddenNoticeShown = true
      this.tray?.notify(this.strings.appName, this.strings.hiddenNotice)
    }
    return 'hide'
  }

  private ensureTray(): void {
    if (this.tray) return
    this.tray = this.dependencies.createTray({
      show: () => this.dependencies.showWindow(),
      quit: () => this.dependencies.quit(),
    })
    this.applyActivity()
  }

  private applyActivity(): void {
    const { runningTasks } = this.activity
    const running = runningTasks > 0 ? fillIn(this.strings.trayRunning, runningTasks) : null
    this.tray?.update(running ? `${this.strings.appName} - ${running}` : this.strings.appName, running, this.strings.trayShow, this.strings.trayQuit)
    const hold = runningTasks > 0 && this.settings.keepAwake
    if (hold && this.sleepHold === null) this.sleepHold = this.dependencies.sleep.start()
    if (!hold && this.sleepHold !== null) {
      this.dependencies.sleep.stop(this.sleepHold)
      this.sleepHold = null
    }
  }
}

function withTimeout<T>(work: Promise<T>, milliseconds: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), milliseconds)
    work.then(
      (value) => { clearTimeout(timer); resolve(value) },
      (error: unknown) => { clearTimeout(timer); reject(error instanceof Error ? error : new Error(String(error))) },
    )
  })
}

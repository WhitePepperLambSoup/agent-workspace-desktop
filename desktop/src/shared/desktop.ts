import { z } from 'zod'

/** Host facts shown in Settings > About and used for support diagnostics. */
export const appInfoSchema = z.object({
  version: z.string(),
  electron: z.string(),
  chrome: z.string(),
  platform: z.string(),
  packaged: z.boolean(),
  logDirectory: z.string(),
})
export type AppInfo = z.infer<typeof appInfoSchema>

export const updateStatusSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('unsupported'), reason: z.enum(['development', 'not-installed', 'no-feed']) }),
  z.object({ state: z.literal('idle') }),
  z.object({ state: z.literal('checking') }),
  z.object({ state: z.literal('available'), version: z.string() }),
  z.object({ state: z.literal('not-available'), checkedAt: z.number() }),
  z.object({ state: z.literal('downloading'), percent: z.number().min(0).max(100) }),
  z.object({ state: z.literal('downloaded'), version: z.string() }),
  z.object({ state: z.literal('error'), message: z.string().max(500) }),
])
export type UpdateStatus = z.infer<typeof updateStatusSchema>

/** How the app lives behind its window. */
export const backgroundSettingsSchema = z.object({
  /** What closing the window does: ask when something would stop, or a remembered choice. */
  closeAction: z.enum(['ask', 'background', 'quit']),
  /** Start with Windows, with the window hidden. */
  openAtLogin: z.boolean(),
  /** Hold off the computer's sleep while a task runs. */
  keepAwake: z.boolean(),
})
export type BackgroundSettings = z.infer<typeof backgroundSettingsSchema>
export const DEFAULT_BACKGROUND_SETTINGS: BackgroundSettings = { closeAction: 'ask', openAtLogin: false, keepAwake: true }

/** The main process's own words, in the window's language (it has no catalog of its own). */
export const mainStringsSchema = z.object({
  appName: z.string().max(80),
  closeRunningTitle: z.string().max(200),
  closeServicesTitle: z.string().max(200),
  closeBody: z.string().max(600),
  closeBackground: z.string().max(80),
  closeQuit: z.string().max(80),
  closeCancel: z.string().max(80),
  closeRemember: z.string().max(120),
  hiddenNotice: z.string().max(300),
  trayShow: z.string().max(80),
  trayQuit: z.string().max(80),
  trayRunning: z.string().max(120),
  draftTitle: z.string().max(120),
  draftMessage: z.string().max(300),
  draftDetail: z.string().max(600),
  draftKeep: z.string().max(80),
  draftClose: z.string().max(80),
  crashMessage: z.string().max(300),
  crashDetail: z.string().max(600),
  crashRestart: z.string().max(80),
  crashClose: z.string().max(80),
})
export type MainStrings = z.infer<typeof mainStringsSchema>
export const DEFAULT_MAIN_STRINGS: MainStrings = {
  appName: 'Agent Workspace',
  closeRunningTitle: '{count} tasks are running',
  closeServicesTitle: 'Scheduled tasks and the phone connection need the app running',
  closeBody: 'In the background the app stays in the notification area of the taskbar. Quitting stops running tasks, scheduled tasks and the phone connection.',
  closeBackground: 'Keep running in the background',
  closeQuit: 'Quit',
  closeCancel: 'Cancel',
  closeRemember: 'Remember my choice',
  hiddenNotice: 'Agent Workspace is still running. Open it from the icon in the notification area.',
  trayShow: 'Show window',
  trayQuit: 'Quit',
  trayRunning: '{count} tasks running',
  draftTitle: 'Unsaved editor draft',
  draftMessage: 'A workspace editor draft could not be backed up.',
  draftDetail: 'Save the file before closing, or close and discard the unprotected draft.',
  draftKeep: 'Keep editing',
  draftClose: 'Close anyway',
  crashMessage: 'The interface stopped responding repeatedly.',
  crashDetail: 'Your conversations are saved. Restart the app; if this keeps happening, attach the log in {folder}.',
  crashRestart: 'Restart',
  crashClose: 'Close',
}

/** An error of the interface, for the app's log. */
export const uiErrorReportSchema = z.object({
  where: z.string().max(120),
  message: z.string().max(2000),
  stack: z.string().max(8000),
  componentStack: z.string().max(8000),
})
export type UiErrorReport = z.infer<typeof uiErrorReportSchema>

/** The page of a release, with what it changes. */
export function releaseNotesUrl(version: string): string {
  return `https://github.com/WhitePepperLambSoup/agent-workspace-desktop/releases/tag/v${encodeURIComponent(version)}`
}

/** Update feeds must be HTTPS; a bare host or path is rejected. */
export const updateFeedSchema = z.object({
  url: z.string().max(2048).nullable(),
})
export type UpdateFeed = z.infer<typeof updateFeedSchema>

export function isValidUpdateFeedUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname.length > 0 && !url.username && !url.password
  } catch {
    return false
  }
}

export const desktopNotificationSchema = z.object({
  title: z.string().min(1).max(120),
  body: z.string().max(400),
  /** Session the notification refers to; clicking it focuses that session. */
  sessionId: z.string().max(200).nullable(),
  urgency: z.enum(['normal', 'attention']),
})
export type DesktopNotification = z.infer<typeof desktopNotificationSchema>

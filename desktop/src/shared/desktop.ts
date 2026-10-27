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

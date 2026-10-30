import { z } from 'zod'

/** What the clipboard held when the shortcut was pressed: its text, and a picture as PNG
 * (base64), for the quick actions on text and on a table screenshot. */
export interface QuickCapture {
  text: string
  image: string | null
}

export const DEFAULT_QUICK_ACCELERATOR = 'Control+Alt+Q'
const MAX_TEXT = 20_000
const MAX_IMAGE_BYTES = 6 * 1024 * 1024
const MAX_IMAGE_WIDTH = 2400

export const quickActionsSettingsSchema = z.object({
  enabled: z.boolean(),
  accelerator: z.string().min(1).max(40).regex(/^[A-Za-z0-9+]+$/),
})

export type QuickActionsSettings = z.infer<typeof quickActionsSettingsSchema>

interface ClipboardImage {
  isEmpty(): boolean
  getSize(): { width: number; height: number }
  resize(options: { width: number }): ClipboardImage
  toPNG(): Buffer
}

export interface ClipboardSource {
  readText(): string
  readImage(): ClipboardImage
}

export interface ShortcutRegistry {
  register(accelerator: string, callback: () => void): boolean
  unregister(accelerator: string): void
}

export function captureClipboard(clipboard: ClipboardSource): QuickCapture {
  const text = clipboard.readText().slice(0, MAX_TEXT)
  let image: string | null = null
  const picture = clipboard.readImage()
  if (!picture.isEmpty()) {
    const { width } = picture.getSize()
    const scaled = width > MAX_IMAGE_WIDTH ? picture.resize({ width: MAX_IMAGE_WIDTH }) : picture
    const png = scaled.toPNG()
    if (png.length <= MAX_IMAGE_BYTES) image = png.toString('base64')
  }
  return { text, image }
}

/** The global shortcut that brings the window forward with the quick actions. */
export class QuickActionsShortcut {
  private registered: string | null = null

  constructor(
    private readonly shortcuts: ShortcutRegistry,
    private readonly onTrigger: () => void,
  ) {}

  configure(settings: QuickActionsSettings): { ok: boolean; error?: 'taken' | 'invalid' } {
    this.clear()
    if (!settings.enabled) return { ok: true }
    let registered = false
    try {
      registered = this.shortcuts.register(settings.accelerator, this.onTrigger)
    } catch {
      return { ok: false, error: 'invalid' }
    }
    if (!registered) return { ok: false, error: 'taken' }
    this.registered = settings.accelerator
    return { ok: true }
  }

  clear(): void {
    if (this.registered) this.shortcuts.unregister(this.registered)
    this.registered = null
  }
}

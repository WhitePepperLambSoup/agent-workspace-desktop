import type { UiEvent } from '../shared/api'

export interface RendererEventBufferOptions {
  /** Maximum number of events retained while the renderer is unavailable. */
  maxEvents?: number
  /** Maximum UTF-8 bytes retained while the renderer is unavailable. */
  maxBytes?: number
}

export type RendererEventSender = (event: UiEvent) => void

const DEFAULT_MAX_EVENTS = 4096
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024

/**
 * Keeps sidecar events alive across renderer startup and reload windows.
 *
 * The renderer explicitly marks itself ready after installing its IPC listener.
 * Until then, events are retained in order. A failed send changes the bridge
 * back to unavailable and leaves the event at the head of the queue so the
 * next ready signal can retry it. The buffer is intentionally bounded; when
 * it overflows, the oldest events are discarded and the renderer's existing
 * sequence-gap recovery performs an authoritative bootstrap.
 */
export class RendererEventBuffer {
  private readonly maxEvents: number
  private readonly maxBytes: number
  private readonly pending: UiEvent[] = []
  private pendingBytes = 0
  private ready = false
  private flushing = false

  constructor(
    private readonly send: RendererEventSender,
    options: RendererEventBufferOptions = {},
  ) {
    this.maxEvents = Math.max(1, Math.floor(options.maxEvents ?? DEFAULT_MAX_EVENTS))
    this.maxBytes = Math.max(1, Math.floor(options.maxBytes ?? DEFAULT_MAX_BYTES))
  }

  get isReady(): boolean {
    return this.ready
  }

  get pendingCount(): number {
    return this.pending.length
  }

  get pendingBytesCount(): number {
    return this.pendingBytes
  }

  /** Mark the current renderer document unavailable without dropping events. */
  markUnavailable(): void {
    this.ready = false
  }

  /**
   * Mark the current renderer document ready and replay retained events.
   * Calling this more than once is safe and flushes any events accumulated
   * after an earlier ready signal.
   */
  markReady(): void {
    this.ready = true
    this.flush()
  }

  publish(event: UiEvent): void {
    if (this.ready && this.trySend(event)) return
    this.enqueue(event)
    if (this.ready) this.flush()
  }

  private enqueue(event: UiEvent): void {
    const bytes = eventByteLength(event)
    this.pending.push(event)
    this.pendingBytes += bytes
    while (
      this.pending.length > this.maxEvents ||
      (this.pending.length > 1 && this.pendingBytes > this.maxBytes)
    ) {
      const removed = this.pending.shift()
      if (!removed) break
      this.pendingBytes -= eventByteLength(removed)
    }
  }

  private flush(): void {
    if (!this.ready || this.flushing) return
    this.flushing = true
    try {
      while (this.ready && this.pending.length > 0) {
        const next = this.pending[0]
        if (!this.trySend(next)) {
          this.ready = false
          break
        }
        this.pending.shift()
        this.pendingBytes -= eventByteLength(next)
      }
    } finally {
      this.flushing = false
    }
  }

  private trySend(event: UiEvent): boolean {
    try {
      this.send(event)
      return true
    } catch {
      return false
    }
  }
}

function eventByteLength(event: UiEvent): number {
  return Buffer.byteLength(JSON.stringify(event), 'utf8')
}

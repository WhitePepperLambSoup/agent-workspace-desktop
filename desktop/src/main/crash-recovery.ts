/**
 * Decides whether a crashed renderer should be reloaded. Reloading forever
 * would hide a deterministic crash loop, so recovery stops after a few crashes
 * inside a short window and the user gets an explicit error instead.
 */
export class RendererRecoveryPolicy {
  private readonly crashes: number[] = []

  constructor(
    private readonly maxCrashes = 3,
    private readonly windowMs = 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  /** Returns true when the renderer may be reloaded after this crash. */
  recordCrash(reason: string): boolean {
    // A clean exit or an intentional kill is not a crash to recover from.
    if (reason === 'clean-exit' || reason === 'killed') return false
    const current = this.now()
    while (this.crashes.length > 0 && current - this.crashes[0] > this.windowMs) this.crashes.shift()
    this.crashes.push(current)
    return this.crashes.length <= this.maxCrashes
  }
}

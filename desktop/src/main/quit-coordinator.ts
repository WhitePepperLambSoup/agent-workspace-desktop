export interface QuitEvent {
  preventDefault(): void
}

export interface ShutdownClient {
  shutdown(): Promise<void>
}

interface QuitCoordinatorOptions {
  getSidecar: () => ShutdownClient | null
  requestQuit: () => void
  reportError: (error: unknown) => void
  confirmQuit?: () => boolean
  /** What closing the window means; the window stays until this answers. Without it, closing quits. */
  decideClose?: () => Promise<'hide' | 'quit' | 'stay'>
}

export class QuitCoordinator {
  private quitting = false
  private approvedExit = false

  constructor(private readonly options: QuitCoordinatorOptions) {}

  isExitApproved(): boolean {
    return this.approvedExit
  }

  /** The system is ending the session: no prompt, and no hiding in the background. */
  approveExit(): void {
    this.approvedExit = true
  }

  private confirmExit(): boolean {
    if (this.approvedExit) return true
    if (this.options.confirmQuit?.() === false) return false
    this.approvedExit = true
    return true
  }

  onWindowClose(event: QuitEvent): void {
    if (this.quitting) return
    const { decideClose } = this.options
    if (decideClose && !this.approvedExit) {
      event.preventDefault()
      void decideClose().then(
        (choice) => {
          if (choice === 'quit' && this.confirmExit()) this.options.requestQuit()
        },
        (error: unknown) => {
          this.options.reportError(error)
          if (this.confirmExit()) this.options.requestQuit()
        },
      )
      return
    }
    if (!this.confirmExit()) {
      event.preventDefault()
      return
    }
    if (!this.options.getSidecar()) return
    event.preventDefault()
    this.options.requestQuit()
  }

  onBeforeQuit(event: QuitEvent): void {
    const sidecar = this.options.getSidecar()
    if (this.quitting) return
    if (!this.confirmExit()) {
      event.preventDefault()
      return
    }
    if (!sidecar) return
    event.preventDefault()
    this.quitting = true
    void sidecar.shutdown().then(
      () => this.options.requestQuit(),
      (error: unknown) => {
        this.options.reportError(error)
        this.quitting = false
        this.approvedExit = false
      },
    )
  }
}

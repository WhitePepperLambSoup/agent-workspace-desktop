import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'

import { type UiCommand, type UiEvent, type UiResponse, uiCommandSchema } from '../shared/api'
import {
  MAX_MESSAGE_BYTES,
  PROTOCOL_VERSION,
  encodeCommandLine,
  parseInboundLine,
} from '../shared/protocol'

interface SidecarWritable {
  write(line: Uint8Array, callback: (error?: Error | null) => void): boolean
  once(event: 'drain', listener: () => void): unknown
  once(event: 'error', listener: (error: Error) => void): unknown
  removeListener(event: 'drain', listener: () => void): unknown
  removeListener(event: 'error', listener: (error: Error) => void): unknown
  destroy(): void
}

interface SidecarReadable {
  on(event: 'data', listener: (chunk: Buffer) => void): unknown
  once(event: 'error', listener: (error: Error) => void): unknown
  removeListener(event: 'error', listener: (error: Error) => void): unknown
  removeAllListeners(event?: string): unknown
  resume(): void
  destroy(): void
}

export interface SidecarProcess extends EventEmitter {
  readonly pid?: number
  readonly stdin: SidecarWritable
  readonly stdout: SidecarReadable
  readonly stderr: SidecarReadable
  exitCode: number | null
  kill(signal?: NodeJS.Signals | number): boolean
  unref(): void
}

interface SidecarOptions {
  executable: string
  args: string[]
  cwd: string
  spawnProcess?: () => SidecarProcess
  maxInflightRequests?: number
  maxQueuedBytes?: number
  requestTimeoutMs?: number
  shutdownGraceMs?: number
  killReapMs?: number
  terminateProcessTree?: (child: SidecarProcess) => Promise<void>
}

interface PendingRequest {
  commandType: UiCommand['type']
  expectedType: Exclude<UiResponse['type'], 'app.error'>
  expectedSessionId: string | null
  timeout: NodeJS.Timeout
  resolve: (response: UiResponse) => void
  reject: (error: Error) => void
}

interface QueuedWrite {
  requestId: string
  line: Buffer
}

interface StreamErrorHandlers {
  stdin: (error: Error) => void
  stdout: (error: Error) => void
  stderr: (error: Error) => void
}

const EXPECTED_RESPONSE_TYPES: Record<
  UiCommand['type'],
  Exclude<UiResponse['type'], 'app.error'>
> = {
  'app.handshake': 'app.handshake.result',
  'app.bootstrap': 'app.bootstrap.result',
  'app.shutdown': 'app.shutdown.result',
  'workspace.open': 'workspace.open.result',
  'workspace.sessions.list': 'workspace.sessions.list.result',
  'session.list': 'session.list.result',
  'session.open': 'session.open.result',
  'session.history': 'session.history.result',
  'events.replay': 'events.replay.result',
  'session.create': 'session.create.result',
  'session.presentation.set': 'session.presentation.set.result',
  'session.search': 'session.search.result',
  'session.export': 'session.export.result',
  'session.import': 'session.import.result',
  'session.fork': 'session.fork.result',
  'session.compare': 'session.compare.result',
  'session.usage': 'session.usage.result',
  'limits.get': 'limits.get.result',
  'limits.set': 'limits.set.result',
  'cost.estimate': 'cost.estimate.result',
  'devices.status': 'devices.status.result',
  'devices.configure': 'devices.configure.result',
  'devices.pairing.start': 'devices.pairing.start.result',
  'devices.token.create': 'devices.token.create.result',
  'devices.revoke': 'devices.revoke.result',
  'devices.update': 'devices.update.result',
  'devices.reset': 'devices.reset.result',
  'devices.send': 'devices.send.result',
  'devices.firewall.allow': 'devices.firewall.allow.result',
  'knowledge.status': 'knowledge.status.result',
  'knowledge.configure': 'knowledge.configure.result',
  'knowledge.add': 'knowledge.add.result',
  'knowledge.document.update': 'knowledge.document.update.result',
  'knowledge.document.delete': 'knowledge.document.delete.result',
  'knowledge.collection.create': 'knowledge.collection.create.result',
  'knowledge.collection.update': 'knowledge.collection.update.result',
  'knowledge.collection.delete': 'knowledge.collection.delete.result',
  'knowledge.session.get': 'knowledge.session.get.result',
  'knowledge.session.set': 'knowledge.session.set.result',
  'knowledge.search': 'knowledge.search.result',
  'document.preview': 'document.preview.result',
  'schedules.list': 'schedules.list.result',
  'schedules.save': 'schedules.save.result',
  'schedules.delete': 'schedules.delete.result',
  'schedules.run': 'schedules.run.result',
  'schedules.runs': 'schedules.runs.result',
  'schedules.read': 'schedules.read.result',
  'files.batches.list': 'files.batches.list.result',
  'files.batches.undo': 'files.batches.undo.result',
  'usage.bill': 'usage.bill.result',
  'usage.cap.set': 'usage.cap.set.result',
  'knowledge.watch.list': 'knowledge.watch.list.result',
  'knowledge.watch.add': 'knowledge.watch.add.result',
  'knowledge.watch.remove': 'knowledge.watch.remove.result',
  'knowledge.watch.scan': 'knowledge.watch.scan.result',
  'session.rewind': 'session.rewind.result',
  'memory.list': 'memory.list.result',
  'memory.update': 'memory.update.result',
  'memory.delete': 'memory.delete.result',
  'workspace.agent.inspect': 'workspace.agent.inspect.result',
  'audio.transcribe': 'audio.transcribe.result',
  'workspace.summary.get': 'workspace.summary.get.result',
  'changes.list': 'changes.list.result',
  'changes.inspect': 'changes.inspect.result',
  'research.sources.list': 'research.sources.list.result',
  'research.source.read': 'research.source.read.result',
  'research.citations.list': 'research.citations.list.result',
  'jobs.list': 'jobs.list.result',
  'jobs.logs': 'jobs.logs.result',
  'jobs.stop': 'jobs.stop.result',
  'terminal.start': 'terminal.start.result',
  'terminal.input': 'terminal.input.result',
  'terminal.resize': 'terminal.resize.result',
  'terminal.status': 'terminal.status.result',
  'terminal.list': 'terminal.list.result',
  'terminal.replay': 'terminal.replay.result',
  'terminal.stop': 'terminal.stop.result',
  'provider.list': 'provider.list.result',
  'provider.get': 'provider.get.result',
  'provider.set': 'provider.set.result',
  'provider.clear': 'provider.clear.result',
  'provider.delete': 'provider.delete.result',
  'provider.default': 'provider.default.result',
  'provider.test': 'provider.test.result',
  'provider.bootstrap': 'provider.bootstrap.result',
  'provider.health': 'provider.health.result',
  'prompt.optimize': 'prompt.optimize.result',
  'turn.start': 'turn.start.result',
  'turn.steer': 'turn.steer.result',
  'turn.cancel': 'turn.cancel.result',
  'runtime.mode.set': 'runtime.mode.set.result',
  'runtime.autonomy.set': 'runtime.autonomy.set.result',
  'approval.resolve': 'approval.resolve.result',
  'workspace.files.tree': 'workspace.files.tree.result',
  'workspace.file.read': 'workspace.file.read.result',
  'workspace.file.write': 'workspace.file.write.result',
  'workspace.git.diff': 'workspace.git.diff.result',
  'workspace.git.revert': 'workspace.git.revert.result',
  'workspace.git.undo': 'workspace.git.undo.result',
  'workspace.git.deliver': 'workspace.git.deliver.result',
  'workspace.context.get': 'workspace.context.get.result',
  'workspace.tasks.list': 'workspace.tasks.list.result',
  'workspace.tasks.create': 'workspace.tasks.create.result',
  'workspace.tasks.update': 'workspace.tasks.update.result',
  'workspace.tasks.delete': 'workspace.tasks.delete.result',
  'workspace.queue.list': 'workspace.queue.list.result',
  'workspace.queue.get': 'workspace.queue.get.result',
  'workspace.collaborations.list': 'workspace.collaborations.list.result',
  'workspace.collaborations.get': 'workspace.collaborations.get.result',
  'workspace.collaborations.cancel': 'workspace.collaborations.cancel.result',
  'workspace.collaborations.resume': 'workspace.collaborations.resume.result',
  'workspace.deliveries.list': 'workspace.deliveries.list.result',
  'workspace.deliveries.get': 'workspace.deliveries.get.result',
  'workspace.deliveries.cancel': 'workspace.deliveries.cancel.result',
  'workspace.deliveries.resume': 'workspace.deliveries.resume.result',
  'workspace.runs.list': 'workspace.runs.list.result',
  'workspace.runs.get': 'workspace.runs.get.result',
  'workspace.runs.create': 'workspace.runs.create.result',
  'workspace.runs.update': 'workspace.runs.update.result',
  'workspace.runs.start': 'workspace.runs.start.result',
  'workspace.runs.pause': 'workspace.runs.pause.result',
  'workspace.runs.resume': 'workspace.runs.resume.result',
  'workspace.runs.cancel': 'workspace.runs.cancel.result',
  'workspace.runs.cleanup': 'workspace.runs.cleanup.result',
  'run.history.page': 'run.history.page.result',
  'workspace.runs.history': 'workspace.runs.history.result',
  'run.evidence.page': 'run.evidence.page.result',
  'workspace.runs.evidence': 'workspace.runs.evidence.result',
  'workspace.plan.retry': 'workspace.plan.retry.result',
  'workspace.plan.skip': 'workspace.plan.skip.result',
  'workspace.runs.failure.action': 'workspace.runs.failure.action.result',
  'workspace.plan.list': 'workspace.plan.list.result',
  'workspace.plan.create': 'workspace.plan.create.result',
  'workspace.plan.update': 'workspace.plan.update.result',
  'workspace.plan.delete': 'workspace.plan.delete.result',
  'workspace.attention.list': 'workspace.attention.list.result',
  'workspace.attention.resolve': 'workspace.attention.resolve.result',
  'workspace.review.list': 'workspace.review.list.result',
  'workspace.review.get': 'workspace.review.get.result',
  'workspace.review.create': 'workspace.review.create.result',
  'workspace.review.comments.create': 'workspace.review.comments.create.result',
  'workspace.review.comments.resolve': 'workspace.review.comments.resolve.result',
  'workspace.review.comments.followup': 'workspace.review.comments.followup.result',
  'workspace.review.pr.create': 'workspace.review.pr.create.result',
  'workspace.review.pr.refresh': 'workspace.review.pr.refresh.result',
  'system.doctor': 'system.doctor.result',
}

const DEFAULT_MAX_INFLIGHT_REQUESTS = 64
const DEFAULT_MAX_QUEUED_BYTES = MAX_MESSAGE_BYTES * 4
const DEFAULT_REQUEST_TIMEOUT_MS = 60_000
const PROVIDER_TEST_TIMEOUT_MS = 25_000
const GIT_DELIVERY_TIMEOUT_MS = 45_000
const DEFAULT_SHUTDOWN_GRACE_MS = 2_000
const DEFAULT_KILL_REAP_MS = 2_000

export class SidecarError extends Error {
  readonly name = 'SidecarError'

  constructor(readonly code: string, readonly response?: UiResponse) {
    super(code)
  }
}

export function terminateWindowsProcessTree(
  child: SidecarProcess,
  spawnCommand: typeof spawn = spawn,
): Promise<void> {
  const pid = child.pid
  if (!Number.isSafeInteger(pid) || (pid ?? 0) <= 0) {
    return Promise.reject(new SidecarError('sidecar_kill_failed'))
  }
  return new Promise<void>((resolve, reject) => {
    const killer = spawnCommand(
      'taskkill.exe',
      ['/PID', String(pid), '/T', '/F'],
      { shell: false, windowsHide: true, stdio: 'ignore' },
    )
    killer.once('error', () => reject(new SidecarError('sidecar_kill_failed')))
    killer.once('exit', (code) => {
      if (code === 0 || child.exitCode !== null) resolve()
      else reject(new SidecarError('sidecar_kill_failed'))
    })
  })
}

export class BoundedLineDecoder {
  private buffer = Buffer.alloc(0)

  constructor(private readonly maximumBytes = MAX_MESSAGE_BYTES) {}

  push(chunk: Uint8Array): Buffer[] {
    this.buffer = Buffer.concat([this.buffer, Buffer.from(chunk)])
    const lines: Buffer[] = []
    let newline = this.buffer.indexOf(0x0a)
    while (newline >= 0) {
      if (newline + 1 > this.maximumBytes) throw new SidecarError('message_too_large')
      lines.push(this.buffer.subarray(0, newline))
      this.buffer = this.buffer.subarray(newline + 1)
      newline = this.buffer.indexOf(0x0a)
    }
    if (this.buffer.byteLength > this.maximumBytes) {
      throw new SidecarError('message_too_large')
    }
    return lines
  }
}

export class SidecarClient {
  private child: SidecarProcess | null = null
  private decoder = new BoundedLineDecoder()
  private readonly pending = new Map<string, PendingRequest>()
  private readonly listeners = new Set<(event: UiEvent) => void>()
  private readonly writeQueue: QueuedWrite[] = []
  private activeWrite: QueuedWrite | null = null
  private queuedBytes = 0
  private waitingForDrain = false
  private exitPromise: Promise<number> | null = null
  private resolveExit: ((code: number) => void) | null = null
  private processFailure: SidecarError | null = null
  private closing = false
  private closed = false
  private shutdownPromise: Promise<void> | null = null
  private stopPromise: Promise<void> | null = null
  private handshakeReady = false
  private handshakePromise: Promise<void> | null = null
  private restartHandshakeRequired = false
  private recoveryPromise: Promise<void> | null = null
  private readonly streamErrorHandlers = new WeakMap<SidecarProcess, StreamErrorHandlers>()

  constructor(private readonly options: SidecarOptions) {}

  async invoke(commandInput: UiCommand): Promise<UiResponse> {
    if (this.closing || this.closed) throw new SidecarError('sidecar_closed')
    if (this.recoveryPromise) await this.recoveryPromise
    if (this.closing || this.closed) throw new SidecarError('sidecar_closed')
    const command = uiCommandSchema.parse(commandInput)
    if (command.type !== 'app.handshake' && this.restartHandshakeRequired) {
      await this.ensureHandshake()
    }
    const requestId = randomUUID()
    const line = encodeCommandLine({
      v: PROTOCOL_VERSION,
      kind: 'command',
      requestId,
      ...command,
    })
    if (this.pending.size >= this.maximumInflightRequests) {
      throw new SidecarError('sidecar_inflight_limit')
    }
    if (this.queuedBytes + line.byteLength > this.maximumQueuedBytes) {
      throw new SidecarError('sidecar_queue_bytes_limit')
    }

    this.ensureStarted()
    const response = new Promise<UiResponse>((resolve, reject) => {
      const pending: PendingRequest = {
        commandType: command.type,
        expectedType: EXPECTED_RESPONSE_TYPES[command.type],
        expectedSessionId: command.sessionId,
        timeout: setTimeout(() => this.onRequestTimeout(requestId), this.timeoutFor(command.type)),
        resolve,
        reject,
      }
      this.pending.set(requestId, pending)
    })
    this.writeQueue.push({ requestId, line })
    this.queuedBytes += line.byteLength
    this.pumpWrites()
    let resolved: UiResponse
    try {
      resolved = await response
    } catch (error) {
      if (command.type === 'app.handshake') {
        this.handshakeReady = false
        this.restartHandshakeRequired = true
      }
      throw error
    }
    if (command.type === 'app.handshake') {
      this.handshakeReady = true
      this.restartHandshakeRequired = false
    }
    return resolved
  }

  async invokeForRenderer(command: UiCommand): Promise<UiResponse> {
    try {
      return await this.invoke(command)
    } catch (error) {
      if (error instanceof SidecarError && error.response) return error.response
      throw error
    }
  }

  subscribe(listener: (event: UiEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  waitForExit(): Promise<number> {
    return this.exitPromise ?? Promise.resolve(-1)
  }

  shutdown(): Promise<void> {
    if (!this.shutdownPromise) {
      const shutdown = this.shutdownInternal()
      this.shutdownPromise = shutdown
      void shutdown.catch(() => {
        if (this.shutdownPromise === shutdown) this.shutdownPromise = null
      })
    }
    return this.shutdownPromise
  }

  stop(): Promise<void> {
    if (!this.stopPromise) {
      const stop = this.stopInternal()
      this.stopPromise = stop
      void stop.catch(() => {
        if (this.stopPromise === stop) this.stopPromise = null
      })
    }
    return this.stopPromise
  }

  private get maximumInflightRequests(): number {
    return this.options.maxInflightRequests ?? DEFAULT_MAX_INFLIGHT_REQUESTS
  }

  private get maximumQueuedBytes(): number {
    return this.options.maxQueuedBytes ?? DEFAULT_MAX_QUEUED_BYTES
  }

  private get requestTimeoutMs(): number {
    return this.options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
  }

  private timeoutFor(commandType: UiCommand['type']): number {
    if (commandType === 'provider.test') return PROVIDER_TEST_TIMEOUT_MS
    if (commandType === 'app.bootstrap' || commandType === 'session.history') return 120_000
    if (commandType === 'workspace.git.deliver') return GIT_DELIVERY_TIMEOUT_MS
    if (commandType === 'workspace.review.pr.create') return 660_000
    if (commandType === 'workspace.review.pr.refresh') return 60_000
    if (commandType === 'workspace.review.create') return 120_000
    if (commandType === 'system.doctor') return 30_000
    return this.requestTimeoutMs
  }

  private get shutdownGraceMs(): number {
    return this.options.shutdownGraceMs ?? DEFAULT_SHUTDOWN_GRACE_MS
  }

  private get killReapMs(): number {
    return this.options.killReapMs ?? DEFAULT_KILL_REAP_MS
  }

  private async terminateProcessTree(child: SidecarProcess): Promise<void> {
    if (this.options.terminateProcessTree) {
      await this.options.terminateProcessTree(child)
      return
    }
    if (process.platform === 'win32' && Number.isSafeInteger(child.pid) && (child.pid ?? 0) > 0) {
      await terminateWindowsProcessTree(child)
      return
    }
    let signalled = false
    try {
      signalled = child.kill('SIGKILL')
    } catch {
      throw new SidecarError('sidecar_kill_failed')
    }
    if (!signalled && child.exitCode === null) throw new SidecarError('sidecar_kill_failed')
  }

  private ensureStarted(): SidecarProcess {
    if (this.child && this.child.exitCode === null) return this.child
    this.decoder = new BoundedLineDecoder()
    this.processFailure = null
    this.child =
      this.options.spawnProcess?.() ??
      (spawn(this.options.executable, this.options.args, {
        cwd: this.options.cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      }) as unknown as SidecarProcess)
    this.exitPromise = new Promise<number>((resolve) => {
      this.resolveExit = resolve
    })
    const child = this.child
    const streamErrors: StreamErrorHandlers = {
      stdin: () => this.failTransport(child),
      stdout: () => this.failTransport(child),
      stderr: () => this.failTransport(child),
    }
    this.streamErrorHandlers.set(child, streamErrors)
    child.stdin.once('error', streamErrors.stdin)
    child.stdout.once('error', streamErrors.stdout)
    child.stderr.once('error', streamErrors.stderr)
    child.stdout.on('data', this.onStdout)
    child.stderr.resume()
    child.once('error', this.onProcessError)
    child.once('exit', this.onProcessExit)
    child.once('close', this.onProcessClose)
    return child
  }

  private ensureHandshake(): Promise<void> {
    if (this.handshakeReady) return Promise.resolve()
    if (!this.handshakePromise) {
      this.handshakePromise = this.invoke({
        type: 'app.handshake',
        payload: { client: 'electron', protocol: PROTOCOL_VERSION },
        sessionId: null,
      }).then(() => undefined)
      this.handshakePromise.then(
        () => { this.handshakePromise = null },
        () => { this.handshakePromise = null },
      )
    }
    return this.handshakePromise
  }

  private readonly onDrain = (): void => {
    this.waitingForDrain = false
    if (!this.activeWrite) this.pumpWrites()
  }

  private pumpWrites(): void {
    const child = this.child
    if (!child || this.activeWrite || this.waitingForDrain) return
    const write = this.writeQueue.shift()
    if (!write) return
    this.activeWrite = write
    const accepted = child.stdin.write(write.line, (error) => this.onWriteComplete(child, write, error))
    if (!accepted) {
      this.waitingForDrain = true
      child.stdin.once('drain', this.onDrain)
    }
  }

  private onWriteComplete(child: SidecarProcess, write: QueuedWrite, error?: Error | null): void {
    if (this.activeWrite !== write) return
    this.activeWrite = null
    this.queuedBytes -= write.line.byteLength
    if (error) {
      this.failTransport(child)
      return
    }
    if (!this.waitingForDrain) this.pumpWrites()
  }

  private failTransport(child: SidecarProcess): void {
    if (this.child !== child || this.closed) return
    const error = new SidecarError('sidecar_stdio_failed')
    this.processFailure = error
    this.failAll(error)
    this.beginRecovery(child, error)
  }

  private readonly onStdout = (chunk: Buffer): void => {
    try {
      for (const line of this.decoder.push(chunk)) {
        const message = parseInboundLine(line)
        if (message.kind === 'event') {
          for (const listener of this.listeners) {
            try {
              listener(message)
            } catch (error) {
              // A renderer subscriber is an observer. Its bug must not turn a
              // valid sidecar event stream into a transport failure, because
              // that used to reject every pending request and restart the
              // sidecar while the model was still running.
              console.error('Sidecar event listener failed', error)
            }
          }
          continue
        }
        const pending = this.pending.get(message.requestId)
        if (!pending) throw new SidecarError('sidecar_unexpected_response')
        this.validateResponse(message, pending)
        this.takePending(message.requestId)
        if (message.type === 'app.error') {
          pending.reject(new SidecarError(message.payload.code, message))
        } else {
          pending.resolve(message)
        }
      }
    } catch (error) {
      const protocolError =
        error instanceof SidecarError ? error : new SidecarError('sidecar_protocol_error')
      this.failAll(protocolError)
      const child = this.child
      if (child) this.beginRecovery(child, protocolError)
    }
  }

  private validateResponse(message: UiResponse, pending: PendingRequest): void {
    if (message.type === 'app.error') {
      if (message.sessionId !== pending.expectedSessionId) {
        throw new SidecarError('sidecar_response_mismatch')
      }
      return
    }
    if (message.type !== pending.expectedType) {
      throw new SidecarError('sidecar_response_mismatch')
    }
    if (pending.commandType === 'app.handshake') {
      const { epoch, features, maxMessageBytes, protocol, ready } = message.payload
      if (
        message.sessionId !== null ||
        protocol !== PROTOCOL_VERSION ||
        ready !== true ||
        maxMessageBytes !== MAX_MESSAGE_BYTES ||
        typeof epoch !== 'string' ||
        !epoch ||
        !Array.isArray(features) ||
        !features.every((feature) => typeof feature === 'string')
      ) {
        throw new SidecarError('sidecar_handshake_mismatch')
      }
      return
    }
    if (pending.commandType === 'app.bootstrap') {
      if (
        typeof message.payload.ready !== 'boolean' ||
        typeof message.payload.epoch !== 'string' ||
        message.payload.epoch.length === 0 ||
        message.payload.watermark !== message.sequence
      ) {
        throw new SidecarError('sidecar_session_mismatch')
      }
      return
    }
    if (message.sessionId !== pending.expectedSessionId && pending.commandType !== 'session.open') {
      throw new SidecarError('sidecar_response_mismatch')
    }
    if (pending.commandType === 'app.shutdown' && message.payload.stopping !== true) {
      throw new SidecarError('sidecar_response_mismatch')
    }
  }

  private readonly onProcessError = (): void => {
    const error = new SidecarError('sidecar_spawn_failed')
    this.processFailure = error
    this.failAll(error)
    const child = this.child
    if (child) this.beginRecovery(child, error)
  }

  private readonly onProcessExit = (code: number | null): void => {
    const child = this.child
    if (!child) return
    const exitCode = code ?? -1
    this.finalizeProcess(
      child,
      exitCode,
      this.processFailure ?? new SidecarError(`sidecar_exited:${exitCode}`),
      false,
    )
  }

  private readonly onProcessClose = (code: number | null): void => {
    const child = this.child
    if (!child) return
    const exitCode = code ?? child.exitCode ?? -1
    this.finalizeProcess(
      child,
      exitCode,
      this.processFailure ?? new SidecarError(`sidecar_exited:${exitCode}`),
      false,
    )
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout)
      pending.reject(error)
    }
    this.pending.clear()
    this.clearWrites()
  }

  private takePending(requestId: string): PendingRequest | undefined {
    const pending = this.pending.get(requestId)
    if (!pending) return undefined
    clearTimeout(pending.timeout)
    this.pending.delete(requestId)
    return pending
  }

  private onRequestTimeout(requestId: string): void {
    if (!this.pending.has(requestId)) return
    const error = new SidecarError('sidecar_request_timeout')
    this.failAll(error)
    const child = this.child
    if (child) this.beginRecovery(child, error)
  }

  private async shutdownInternal(): Promise<void> {
    if (this.closed) return
    this.closing = true
    if (this.recoveryPromise) await this.recoveryPromise
    const child = this.child
    if (!child) {
      this.closed = true
      return
    }
    try {
      await this.invokeDuringClose({ type: 'app.shutdown', payload: {}, sessionId: null })
    } catch {
      await this.killAndReap(child, new SidecarError('sidecar_stopped'), true)
      return
    }
    if (await this.waitForProcessExit(child, this.shutdownGraceMs)) return
    await this.killAndReap(child, new SidecarError('sidecar_stopped'), true)
  }

  private invokeDuringClose(command: UiCommand): Promise<UiResponse> {
    this.closing = false
    const request = this.invoke(command)
    this.closing = true
    return request
  }

  private async stopInternal(): Promise<void> {
    const child = this.child
    if (this.closed) return
    if (!child) {
      this.closing = true
      this.closed = true
      return
    }
    await this.killAndReap(child, new SidecarError('sidecar_stopped'), true)
  }

  private beginRecovery(child: SidecarProcess, error: SidecarError): void {
    if (this.recoveryPromise || this.closing || this.closed) return
    const recovery = this.killAndReap(child, error, false)
    this.recoveryPromise = recovery
    recovery.then(
      () => {
        if (this.recoveryPromise === recovery) this.recoveryPromise = null
      },
      () => {
        if (this.recoveryPromise === recovery) this.recoveryPromise = null
      },
    )
  }

  private async killAndReap(
    child: SidecarProcess,
    error: SidecarError,
    terminal: boolean,
  ): Promise<void> {
    if (this.closed || this.child !== child) return
    if (terminal) this.closing = true
    this.failAll(error)
    await this.terminateProcessTree(child)
    if (await this.waitForProcessExit(child, this.killReapMs)) return
    throw new SidecarError('sidecar_reap_timeout')
  }

  private waitForProcessExit(child: SidecarProcess, timeoutMs: number): Promise<boolean> {
    if (this.child !== child || this.closed) return Promise.resolve(true)
    return new Promise<boolean>((resolve) => {
      let timer: NodeJS.Timeout
      const finish = (exited: boolean): void => {
        clearTimeout(timer)
        child.removeListener('exit', onExit)
        child.removeListener('close', onClose)
        resolve(exited)
      }
      const onExit = (): void => finish(true)
      const onClose = (): void => finish(true)
      child.once('exit', onExit)
      child.once('close', onClose)
      timer = setTimeout(() => finish(false), timeoutMs)
    })
  }

  private finalizeProcess(
    child: SidecarProcess,
    exitCode: number,
    error: SidecarError,
    detach: boolean,
    terminal = false,
  ): void {
    if (this.closed || this.child !== child) return
    const permanent = this.closing || terminal
    this.closing = permanent
    this.closed = permanent
    this.handshakeReady = false
    this.restartHandshakeRequired = !permanent
    this.failAll(error)
    child.stdin.removeListener('drain', this.onDrain)
    const streamErrors = this.streamErrorHandlers.get(child)
    if (streamErrors) {
      child.stdin.removeListener('error', streamErrors.stdin)
      child.stdout.removeListener('error', streamErrors.stdout)
      child.stderr.removeListener('error', streamErrors.stderr)
      this.streamErrorHandlers.delete(child)
    }
    child.stdout.removeAllListeners('data')
    child.removeListener('error', this.onProcessError)
    child.removeListener('exit', this.onProcessExit)
    child.removeListener('close', this.onProcessClose)
    child.stdin.destroy()
    child.stdout.destroy()
    child.stderr.destroy()
    if (detach) child.unref()
    this.child = null
    this.resolveExit?.(exitCode)
    this.resolveExit = null
  }

  private clearWrites(): void {
    this.child?.stdin.removeListener('drain', this.onDrain)
    this.writeQueue.length = 0
    this.activeWrite = null
    this.queuedBytes = 0
    this.waitingForDrain = false
  }
}

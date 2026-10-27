import type { AgentWorkspaceApi, ProviderSettingsInput, UiEvent, UiResponse } from '../../../shared/api'
import type { Autonomy, JsonValue } from '../../../shared/protocol'
import { createWorkbenchStore, type WorkbenchStore } from '../state/workbench-store'
import { ComposerDraftStore } from '../state/composer-drafts'

export class GatewayCommandError extends Error {
  readonly name = 'GatewayCommandError'

  constructor(readonly code: string) {
    super(code)
  }
}

export class WorkbenchBridgeClient {
  readonly store: WorkbenchStore
  readonly composerDrafts = new ComposerDraftStore()
  private unsubscribe: (() => void) | null = null
  private bootstrapInFlight: Promise<void> | null = null
  private bootstrapRetryRequested = false
  private activatingSessionId: string | null = null
  private readonly sessionSwitchInFlight = new Set<Promise<void>>()
  private sessionActivationRetryTimer: ReturnType<typeof setTimeout> | null = null
  private expectedSessionActivationId: string | null = null
  private readonly settledSessionActivations = new Set<string>()
  private expectedWorkspacePath: string | null = null
  private workspaceSessionSwitch: Promise<void> = Promise.resolve()
  private workspaceSessionSwitchGeneration = 0

  constructor(private readonly api: AgentWorkspaceApi) {
    this.store = createWorkbenchStore({ requestResync: () => void this.bootstrap() })
  }

  async start(): Promise<void> {
    if (!this.unsubscribe) {
      this.unsubscribe = this.api.subscribe((event) => {
        const openedSessionId = event.sessionId ?? (typeof event.payload.sessionId === 'string' ? event.payload.sessionId : null)
        if (event.type === 'session.opened' && openedSessionId && event.payload.activated !== false) {
          this.settledSessionActivations.add(openedSessionId)
        }
        if (event.type === 'runtime.session_switch_failed' && openedSessionId) {
          this.settledSessionActivations.add(openedSessionId)
        }
        const projectedEvent = this.projectSessionActivationEvent(event)
        this.store.applyEvent(projectedEvent)
        if (
          event.type === 'changes.updated' &&
          event.sessionId !== null &&
          event.sessionId === this.selectedSessionId
        ) {
          void this.listChanges(20).catch(() => undefined)
        }
        if (['turn.completed', 'turn.cancelled', 'turn.failed'].includes(event.type)) {
          this.activateViewedSessionWhenIdle(true)
        }
      })
    }
    await this.bootstrap()
    await this.waitForStartupReadiness()
  }

  stop(): void {
    this.unsubscribe?.()
    this.unsubscribe = null
    if (this.sessionActivationRetryTimer !== null) {
      clearTimeout(this.sessionActivationRetryTimer)
      this.sessionActivationRetryTimer = null
    }
  }

  async switchWorkspacePath(path: string): Promise<boolean> {
    const selectedPath = path.trim()
    if (!selectedPath) return false
    this.expectedWorkspacePath = selectedPath
    const response = await this.invoke({
      type: 'workspace.open',
      payload: { path: selectedPath },
      sessionId: null,
    })
    if (response.type === 'workspace.open.result' && response.payload.switching === true) {
      await this.bootstrap()
      await this.waitForWorkspaceActivation(selectedPath)
    }
    return true
  }

  async openWorkspacePath(path: string): Promise<boolean> {
    return this.switchWorkspacePath(path)
  }

  async listWorkspaceSessions(input: { path?: string; limit?: number; offset?: number; workspaceOffset?: number } = {}): Promise<UiResponse> {
    const payload: Record<string, JsonValue> = { limit: input.limit ?? 20 }
    if (input.path !== undefined) payload.path = input.path
    if (input.offset !== undefined) payload.offset = input.offset
    if (input.workspaceOffset !== undefined) payload.workspaceOffset = input.workspaceOffset
    return this.invoke({ type: 'workspace.sessions.list', payload, sessionId: null })
  }

  async openWorkspaceSession(path: string, sessionId: string): Promise<void> {
    const generation = ++this.workspaceSessionSwitchGeneration
    const run = this.workspaceSessionSwitch.catch(() => undefined).then(async () => {
      if (generation !== this.workspaceSessionSwitchGeneration) return
      const key = (value: string) => value.replace(/\\/g, '/').replace(/\/+$/, '').toLocaleLowerCase()
      const state = this.store.getState()
      const currentPath = typeof state.workspace?.path === 'string' ? state.workspace.path : ''
      if (key(path) !== key(currentPath)) {
        await this.switchWorkspacePath(path)
        if (generation !== this.workspaceSessionSwitchGeneration) return
        await this.bootstrap()
        const next = this.store.getState()
        if (typeof next.workspace?.path !== 'string' || key(next.workspace.path) !== key(path) || !next.runtime.ready) {
          throw new GatewayCommandError('workspace_switch_failed')
        }
      }
      if (generation === this.workspaceSessionSwitchGeneration) await this.openSession(sessionId)
    })
    this.workspaceSessionSwitch = run
    await run
  }

  async openWorkspace(): Promise<boolean> {
    const path = await this.api.selectWorkspace()
    if (!path) return false
    return this.switchWorkspacePath(path)
  }
  private async waitForWorkspaceActivation(path: string): Promise<void> {
    const expected = path.toLowerCase()
    const deadline = Date.now() + 10_000
    while (Date.now() < deadline) {
      if (this.expectedWorkspacePath !== path) return
      const state = this.store.getState()
      const currentPath = state.workspace?.path
      if (
        typeof currentPath === 'string' &&
        currentPath.toLowerCase() === expected &&
        state.runtime.ready &&
        state.runtime.state === 'ready'
      ) return
      if (state.runtime.state === 'failed' || state.runtime.state === 'stopped') return
      await new Promise((resolve) => setTimeout(resolve, 80))
    }
    // Recover a missed runtime.started event once at the end of the bounded
    // wait. The bootstrap snapshot is authoritative and avoids repeated
    // reconciliation requests while the host is still starting.
    await this.bootstrap().catch(() => undefined)
  }

  private async waitForStartupReadiness(): Promise<void> {
    // A renderer reload can happen while the sidecar is still restoring the
    // last workspace/session. Keep the composer in a recoverable loading state
    // instead of leaving the first draft attached to an unconfigured snapshot.
    const deadline = Date.now() + 10_000
    while (Date.now() < deadline) {
      const state = this.store.getState()
      if (!['switching', 'starting', 'stopping'].includes(state.runtime.state)) return
      await new Promise((resolve) => setTimeout(resolve, 80))
      await this.bootstrap().catch(() => undefined)
    }
  }

  async listSessions(limit = 50): Promise<UiResponse> {
    return this.invoke({
      type: 'session.list',
      payload: { limit },
      sessionId: this.selectedSessionId,
    })
  }

  async openSession(sessionId: string): Promise<void> {
    // Every switch establishes the newest activation target; late events from an older switch are ignored.
    // The gateway already serializes host replacement and keeps the latest pending target. Sending the
    // newest command immediately prevents an older activation waiter from making the UI feel unresponsive.
    this.expectedSessionActivationId = sessionId
    this.store.setSessionSwitchTarget(sessionId)
    this.settledSessionActivations.delete(sessionId)
    const run = (async () => {
      const response = await this.invoke(
        { type: 'session.open', payload: {}, sessionId },
        { expectedSessionId: sessionId },
      )
      if (response.type === 'session.open.result' && response.payload.switching === true) {
        await this.waitForSessionActivation(sessionId)
      }
    })()
    this.sessionSwitchInFlight.add(run)
    try {
      await run
    } finally {
      this.sessionSwitchInFlight.delete(run)
    }
  }
  async createSession(input: { title?: string; mode?: 'coding' | 'research' | 'task' } = {}): Promise<UiResponse> {
    const payload: { title?: string; mode?: 'coding' | 'research' | 'task' } = {}
    if (input.title !== undefined) payload.title = input.title
    if (input.mode !== undefined) payload.mode = input.mode
    return this.invoke({ type: 'session.create', payload, sessionId: null })
  }

  async setSessionPresentation(
    sessionId: string,
    update: { alias?: string | null; pinned?: boolean; archived?: boolean },
  ): Promise<UiResponse> {
    const payload: Record<string, JsonValue> = { sessionId }
    if (update.alias !== undefined) payload.alias = update.alias
    if (update.pinned !== undefined) payload.pinned = update.pinned
    if (update.archived !== undefined) payload.archived = update.archived
    return this.invoke({
      type: 'session.presentation.set',
      payload,
      sessionId: null,
    })
  }

  async exportSession(sessionId: string, path: string): Promise<UiResponse> {
    return this.invoke({ type: 'session.export', payload: { sessionId, path }, sessionId: null })
  }

  async importSession(path: string): Promise<UiResponse> {
    return this.invoke({ type: 'session.import', payload: { path }, sessionId: null })
  }

  /**
   * Continue a conversation from a user's message in a new one. keepReply keeps that turn's
   * answer; compareModel makes a fork that asks the same question of another model.
   */
  async forkSession(input: {
    sessionId: string
    messageId: string
    keepReply: boolean
    title?: string
    compareModel?: string
  }): Promise<UiResponse> {
    const payload: Record<string, JsonValue> = {
      sessionId: input.sessionId,
      messageId: input.messageId,
      keepReply: input.keepReply,
    }
    if (input.title) payload.title = input.title
    if (input.compareModel) payload.compareModel = input.compareModel
    return this.invoke({ type: 'session.fork', payload, sessionId: null })
  }

  async compareSession(sessionId: string): Promise<UiResponse> {
    return this.invoke({ type: 'session.compare', payload: { sessionId }, sessionId: null })
  }

  async estimateCost(messageChars: number, sessionId: string | null = this.selectedSessionId): Promise<UiResponse> {
    return this.invoke({ type: 'cost.estimate', payload: { messageChars, sessionId }, sessionId: null })
  }

  async deviceLinkStatus(): Promise<UiResponse> {
    return this.invoke({ type: 'devices.status', payload: {}, sessionId: null })
  }

  async configureDeviceLink(input: { enabled?: boolean; port?: number; secure?: boolean; wake?: boolean; clipboard?: boolean }): Promise<UiResponse> {
    const payload: Record<string, JsonValue> = {}
    if (input.enabled !== undefined) payload.enabled = input.enabled
    if (input.port !== undefined) payload.port = input.port
    if (input.secure !== undefined) payload.secure = input.secure
    if (input.wake !== undefined) payload.wake = input.wake
    if (input.clipboard !== undefined) payload.clipboard = input.clipboard
    return this.invoke({ type: 'devices.configure', payload, sessionId: null })
  }

  /** A paired phone's permissions, or whether it is told about turns finishing here. */
  async updateDevice(deviceId: string, input: { scopes?: readonly string[]; notifyTurns?: boolean }): Promise<UiResponse> {
    const payload: Record<string, JsonValue> = { deviceId }
    if (input.scopes !== undefined) payload.scopes = [...input.scopes]
    if (input.notifyTurns !== undefined) payload.notifyTurns = input.notifyTurns
    return this.invoke({ type: 'devices.update', payload, sessionId: null })
  }

  /** Let phones through Windows Firewall; Windows asks the user for administrator rights. */
  async allowDeviceLinkThroughFirewall(): Promise<UiResponse> {
    return this.invoke({ type: 'devices.firewall.allow', payload: {}, sessionId: null })
  }

  /** A new desktop id; every paired phone is removed. */
  async resetDeviceLink(): Promise<UiResponse> {
    return this.invoke({ type: 'devices.reset', payload: {}, sessionId: null })
  }

  /** Put a file of the open folder, a text or link, or a conversation in a phone's inbox. */
  async sendToPhone(
    deviceId: string,
    item: { kind: 'file'; path: string; sessionId?: string } | { kind: 'text'; text: string } | { kind: 'conversation'; sessionId: string },
  ): Promise<UiResponse> {
    return this.invoke({ type: 'devices.send', payload: { deviceId, ...item }, sessionId: null })
  }

  async startDevicePairing(scopes: readonly string[]): Promise<UiResponse> {
    return this.invoke({ type: 'devices.pairing.start', payload: { scopes: [...scopes] }, sessionId: null })
  }

  async createDeviceToken(name: string, scopes: readonly string[]): Promise<UiResponse> {
    return this.invoke({ type: 'devices.token.create', payload: { name, scopes: [...scopes] }, sessionId: null })
  }

  async revokeDevice(deviceId: string): Promise<UiResponse> {
    return this.invoke({ type: 'devices.revoke', payload: { deviceId }, sessionId: null })
  }

  async knowledgeStatus(): Promise<UiResponse> {
    return this.invoke({ type: 'knowledge.status', payload: {}, sessionId: null })
  }

  async configureKnowledge(input: { enabled?: boolean; auto?: boolean; synonyms?: string }): Promise<UiResponse> {
    const payload: Record<string, JsonValue> = {}
    if (input.enabled !== undefined) payload.enabled = input.enabled
    if (input.auto !== undefined) payload.auto = input.auto
    if (input.synonyms !== undefined) payload.synonyms = input.synonyms
    return this.invoke({ type: 'knowledge.configure', payload, sessionId: null })
  }

  async addKnowledge(source: { paths: readonly string[] } | { url: string }, collectionId?: string): Promise<UiResponse> {
    const payload: Record<string, JsonValue> = 'paths' in source ? { paths: [...source.paths] } : { url: source.url }
    if (collectionId) payload.collectionId = collectionId
    return this.invoke({ type: 'knowledge.add', payload, sessionId: null })
  }

  async updateKnowledgeDocument(documentId: string, change: { title?: string; collectionId?: string }): Promise<UiResponse> {
    const payload: Record<string, JsonValue> = { documentId }
    if (change.title !== undefined) payload.title = change.title
    if (change.collectionId !== undefined) payload.collectionId = change.collectionId
    return this.invoke({ type: 'knowledge.document.update', payload, sessionId: null })
  }

  async deleteKnowledgeDocument(documentId: string): Promise<UiResponse> {
    return this.invoke({ type: 'knowledge.document.delete', payload: { documentId }, sessionId: null })
  }

  async createKnowledgeCollection(name: string, defaultOn = true): Promise<UiResponse> {
    return this.invoke({ type: 'knowledge.collection.create', payload: { name, defaultOn }, sessionId: null })
  }

  async updateKnowledgeCollection(collectionId: string, change: { name?: string; defaultOn?: boolean }): Promise<UiResponse> {
    const payload: Record<string, JsonValue> = { collectionId }
    if (change.name !== undefined) payload.name = change.name
    if (change.defaultOn !== undefined) payload.defaultOn = change.defaultOn
    return this.invoke({ type: 'knowledge.collection.update', payload, sessionId: null })
  }

  async deleteKnowledgeCollection(collectionId: string): Promise<UiResponse> {
    return this.invoke({ type: 'knowledge.collection.delete', payload: { collectionId }, sessionId: null })
  }

  async knowledgeSession(sessionId: string): Promise<UiResponse> {
    return this.invoke({ type: 'knowledge.session.get', payload: { sessionId }, sessionId: null })
  }

  /** The knowledge bases a conversation uses; null goes back to the default ones. */
  async setKnowledgeSession(sessionId: string, collections: readonly string[] | null): Promise<UiResponse> {
    return this.invoke({ type: 'knowledge.session.set', payload: { sessionId, collections: collections ? [...collections] : null }, sessionId: null })
  }

  async searchKnowledge(query: string, collections?: readonly string[]): Promise<UiResponse> {
    const payload: Record<string, JsonValue> = { query }
    if (collections) payload.collections = [...collections]
    return this.invoke({ type: 'knowledge.search', payload, sessionId: null })
  }

  async taskLimits(): Promise<UiResponse> {
    return this.invoke({ type: 'limits.get', payload: {}, sessionId: null })
  }

  async setTaskLimits(input: { maxCostUsd: number | null; maxTokens: number | null }): Promise<UiResponse> {
    return this.invoke({ type: 'limits.set', payload: { maxCostUsd: input.maxCostUsd, maxTokens: input.maxTokens }, sessionId: null })
  }

  async listMemories(query = '', limit = 200): Promise<UiResponse> {
    return this.invoke({ type: 'memory.list', payload: { query, limit }, sessionId: null })
  }

  async updateMemory(memoryId: string, content: string, tags: readonly string[]): Promise<UiResponse> {
    return this.invoke({ type: 'memory.update', payload: { memoryId, content, tags: [...tags] }, sessionId: null })
  }

  async deleteMemory(memoryId: string): Promise<UiResponse> {
    return this.invoke({ type: 'memory.delete', payload: { memoryId }, sessionId: null })
  }

  async transcribeAudio(providerId: string, model: string, mediaType: string, data: string): Promise<UiResponse> {
    return this.invoke({ type: 'audio.transcribe', payload: { providerId, model, mediaType, data }, sessionId: null })
  }

  async inspectAgentSetup(): Promise<UiResponse> {
    return this.invoke({ type: 'workspace.agent.inspect', payload: {}, sessionId: null })
  }

  async getSessionUsage(sessionId: string): Promise<UiResponse> {
    return this.invoke({ type: 'session.usage', payload: { sessionId }, sessionId: null })
  }

  async searchSessions(query: string, limit = 20): Promise<UiResponse> {
    return this.invoke({ type: 'session.search', payload: { query, limit }, sessionId: null })
  }

  async getWorkspaceSummary(): Promise<UiResponse> {
    return this.invoke({ type: 'workspace.summary.get', payload: {}, sessionId: null })
  }

  async listChanges(limit = 20): Promise<UiResponse> {
    return this.invoke({
      type: 'changes.list', payload: { limit }, sessionId: this.selectedSessionId,
    })
  }

  async listResearchSources(offset = 0, limit = 25): Promise<UiResponse> {
    return this.invoke({
      type: 'research.sources.list', payload: { offset, limit }, sessionId: this.selectedSessionId,
    })
  }

  async readResearchSource(sourceId: string, offset = 0, maxChars = 16_000): Promise<UiResponse> {
    return this.invoke({
      type: 'research.source.read', payload: { sourceId, offset, maxChars }, sessionId: this.selectedSessionId,
    })
  }

  async listResearchCitations(offset = 0, limit = 20): Promise<UiResponse> {
    return this.invoke({
      type: 'research.citations.list', payload: { offset, limit }, sessionId: this.selectedSessionId,
    })
  }

  async inspectChange(
    changesetId: string, path: string, offsetBytes = 0, maxBytes = 65_536,
  ): Promise<UiResponse> {
    return this.invoke({
      type: 'changes.inspect',
      payload: { changesetId, path, offsetBytes, maxBytes },
      sessionId: this.selectedSessionId,
    })
  }

  async getWorkspaceFilesTree(path = '', maxDepth = 6, limit = 1000): Promise<UiResponse> {
    return this.invoke({
      type: 'workspace.files.tree',
      payload: { path, maxDepth, limit },
      sessionId: this.selectedSessionId,
    })
  }

  async readWorkspaceFile(path: string, offset = 0, maxBytes = 524_288): Promise<UiResponse> {
    return this.invoke({
      type: 'workspace.file.read',
      payload: { path, offset, maxBytes },
      sessionId: this.selectedSessionId,
    })
  }

  async writeWorkspaceFile(path: string, content: string, expectedSha256: string | null = null): Promise<UiResponse> {
    return this.invoke({
      type: 'workspace.file.write',
      payload: { path, content, expectedSha256 },
      sessionId: this.selectedSessionId,
    })
  }

  async getGitDiff(): Promise<UiResponse> {
    return this.invoke({
      type: 'workspace.git.diff',
      payload: {},
      sessionId: this.selectedSessionId,
    })
  }

  async revertGitDiff(filePath: string, hunkIndex: number | null = null): Promise<UiResponse> {
    return this.invoke({
      type: 'workspace.git.revert',
      payload: { filePath, hunkIndex },
      sessionId: this.selectedSessionId,
    })
  }

  async undoGitRevert(checkpointId: string): Promise<UiResponse> {
    return this.invoke({
      type: 'workspace.git.undo',
      payload: { checkpointId },
      sessionId: this.selectedSessionId,
    })
  }

  async deliverGitChanges(
    title: string,
    description = '',
    stageAll = false,
    selectedFiles?: string[],
  ): Promise<UiResponse> {
    const payload: Record<string, JsonValue> = { title, description, stageAll }
    if (selectedFiles !== undefined) {
      payload.selectedFiles = selectedFiles
    }
    return this.invoke({
      type: 'workspace.git.deliver',
      payload,
      sessionId: this.selectedSessionId,
    })
  }

  async getWorkspaceContext(): Promise<UiResponse> {
    return this.invoke({
      type: 'workspace.context.get',
      payload: {},
      sessionId: this.selectedSessionId,
    })
  }

  async runDoctor(workspace?: string): Promise<UiResponse> {
    const payload: Record<string, JsonValue> = {}
    if (workspace !== undefined) payload.workspace = workspace
    return this.invoke({
      type: 'system.doctor',
      payload,
      sessionId: this.selectedSessionId,
    })
  }

  async listTasks(sessionId?: string): Promise<UiResponse> {
    const targetSession = sessionId ?? this.selectedSessionId
    return this.invoke({
      type: 'workspace.tasks.list',
      payload: targetSession ? { sessionId: targetSession } : {},
      sessionId: targetSession,
    })
  }

  async createTask(
    content: string,
    status = 'pending',
    position = 0,
    sessionId?: string,
  ): Promise<UiResponse> {
    const targetSession = sessionId ?? this.selectedSessionId
    const payload: Record<string, JsonValue> = { content, status, position }
    if (targetSession) payload.sessionId = targetSession
    return this.invoke({
      type: 'workspace.tasks.create',
      payload,
      sessionId: targetSession,
    })
  }

  async updateTask(
    taskId: string,
    updates: { content?: string; status?: string; position?: number },
    sessionId?: string,
  ): Promise<UiResponse> {
    const targetSession = sessionId ?? this.selectedSessionId
    const payload: Record<string, JsonValue> = { taskId }
    if (updates.content !== undefined) payload.content = updates.content
    if (updates.status !== undefined) payload.status = updates.status
    if (updates.position !== undefined) payload.position = updates.position
    if (targetSession) payload.sessionId = targetSession
    return this.invoke({
      type: 'workspace.tasks.update',
      payload,
      sessionId: targetSession,
    })
  }

  async deleteTask(taskId: string, sessionId?: string): Promise<UiResponse> {
    const targetSession = sessionId ?? this.selectedSessionId
    const payload: Record<string, JsonValue> = { taskId }
    if (targetSession) payload.sessionId = targetSession
    return this.invoke({
      type: 'workspace.tasks.delete',
      payload,
      sessionId: targetSession,
    })
  }

  async listAgentRuns(options: { states?: string[]; limit?: number } = {}): Promise<UiResponse> {
    const payload: Record<string, JsonValue> = { limit: options.limit ?? 200 }
    if (options.states) payload.states = options.states
    return this.invoke({ type: 'workspace.runs.list', payload, sessionId: this.selectedSessionId })
  }

  async getAgentRun(runId: string): Promise<UiResponse> {
    return this.invoke({
      type: 'workspace.runs.get',
      payload: { runId },
      sessionId: this.selectedSessionId,
    })
  }

  async createAgentRun(input: {
    goal: string
    title?: string
    // auto: its own git worktree in a repository, the folder itself elsewhere
    isolation?: 'auto' | 'shared' | 'worktree'
    sessionId?: string
    parentRunId?: string
  }): Promise<UiResponse> {
    const payload: Record<string, JsonValue> = {
      goal: input.goal,
      isolation: input.isolation ?? 'worktree',
    }
    if (input.title) payload.title = input.title
    if (input.sessionId) payload.sessionId = input.sessionId
    if (input.parentRunId) payload.parentRunId = input.parentRunId
    return this.invoke({
      type: 'workspace.runs.create',
      payload,
      sessionId: input.sessionId ?? this.selectedSessionId,
    })
  }

  async updateAgentRun(
    runId: string,
    update: {
      state?: string
      title?: string
      goal?: string
      activeStepId?: string
      blockingReason?: string
    },
  ): Promise<UiResponse> {
    const payload: Record<string, JsonValue> = { runId }
    if (update.state !== undefined) payload.state = update.state
    if (update.title !== undefined) payload.title = update.title
    if (update.goal !== undefined) payload.goal = update.goal
    if (update.activeStepId !== undefined) payload.activeStepId = update.activeStepId
    if (update.blockingReason !== undefined) payload.blockingReason = update.blockingReason
    return this.invoke({
      type: 'workspace.runs.update',
      payload,
      sessionId: this.selectedSessionId,
    })
  }

  async startAgentRun(runId: string): Promise<UiResponse> {
    return this.invoke({
      type: 'workspace.runs.start',
      payload: { runId },
      sessionId: this.selectedSessionId,
    })
  }

  async pauseAgentRun(runId: string): Promise<UiResponse> {
    return this.invoke({
      type: 'workspace.runs.pause',
      payload: { runId },
      sessionId: this.selectedSessionId,
    })
  }

  async resumeAgentRun(runId: string): Promise<UiResponse> {
    return this.invoke({
      type: 'workspace.runs.resume',
      payload: { runId },
      sessionId: this.selectedSessionId,
    })
  }

  async cancelAgentRun(runId: string): Promise<UiResponse> {
    return this.invoke({
      type: 'workspace.runs.cancel',
      payload: { runId },
      sessionId: this.selectedSessionId,
    })
  }

  async cleanupAgentRun(runId: string): Promise<UiResponse> {
    return this.invoke({
      type: 'workspace.runs.cleanup',
      payload: { runId },
      sessionId: this.selectedSessionId,
    })
  }

  async listPlanSteps(runId: string): Promise<UiResponse> {
    return this.invoke({
      type: 'workspace.plan.list',
      payload: { runId },
      sessionId: this.selectedSessionId,
    })
  }

  async createPlanStep(
    runId: string,
    input: {
      title: string
      detail?: string
      acceptance?: string
      position?: number
      dependencies?: string[]
    },
  ): Promise<UiResponse> {
    const payload: Record<string, JsonValue> = { runId, title: input.title }
    if (input.detail !== undefined) payload.detail = input.detail
    if (input.acceptance !== undefined) payload.acceptance = input.acceptance
    if (input.position !== undefined) payload.position = input.position
    if (input.dependencies !== undefined) payload.dependencies = input.dependencies
    return this.invoke({
      type: 'workspace.plan.create',
      payload,
      sessionId: this.selectedSessionId,
    })
  }

  async updatePlanStep(
    stepId: string,
    update: {
      title?: string
      detail?: string
      acceptance?: string
      state?: string
      position?: number
      dependencies?: string[]
      evidence?: string[]
    },
  ): Promise<UiResponse> {
    const payload: Record<string, JsonValue> = { stepId }
    if (update.title !== undefined) payload.title = update.title
    if (update.detail !== undefined) payload.detail = update.detail
    if (update.acceptance !== undefined) payload.acceptance = update.acceptance
    if (update.state !== undefined) payload.state = update.state
    if (update.position !== undefined) payload.position = update.position
    if (update.dependencies !== undefined) payload.dependencies = update.dependencies
    if (update.evidence !== undefined) payload.evidence = update.evidence
    return this.invoke({
      type: 'workspace.plan.update',
      payload,
      sessionId: this.selectedSessionId,
    })
  }

  async deletePlanStep(stepId: string): Promise<UiResponse> {
    return this.invoke({
      type: 'workspace.plan.delete',
      payload: { stepId },
      sessionId: this.selectedSessionId,
    })
  }

  async listAttention(options: { runId?: string; state?: string; limit?: number } = {}): Promise<UiResponse> {
    const payload: Record<string, JsonValue> = {
      state: options.state ?? 'open',
      limit: options.limit ?? 500,
    }
    if (options.runId) payload.runId = options.runId
    return this.invoke({
      type: 'workspace.attention.list',
      payload,
      sessionId: this.selectedSessionId,
    })
  }

  async resolveAttention(
    attentionId: string,
    resolution: Record<string, JsonValue> = {},
    dismissed = false,
  ): Promise<UiResponse> {
    return this.invoke({
      type: 'workspace.attention.resolve',
      payload: { attentionId, resolution, dismissed },
      sessionId: this.selectedSessionId,
    })
  }

  async listReviewSnapshots(limit = 100): Promise<UiResponse> {
    return this.invoke({
      type: 'workspace.review.list',
      payload: { limit },
      sessionId: this.selectedSessionId,
    })
  }

  async getReviewSnapshot(snapshotId: string): Promise<UiResponse> {
    return this.invoke({
      type: 'workspace.review.get',
      payload: { snapshotId },
      sessionId: this.selectedSessionId,
    })
  }

  async createReviewSnapshot(input: { runId?: string; baseSha?: string } = {}): Promise<UiResponse> {
    const payload: Record<string, JsonValue> = {}
    if (input.runId) payload.runId = input.runId
    if (input.baseSha) payload.baseSha = input.baseSha
    return this.invoke({
      type: 'workspace.review.create',
      payload,
      sessionId: this.selectedSessionId,
    })
  }

  async createReviewComment(input: {
    snapshotId: string
    path: string
    side: 'old' | 'new'
    line: number
    body: string
  }): Promise<UiResponse> {
    return this.invoke({
      type: 'workspace.review.comments.create',
      payload: input,
      sessionId: this.selectedSessionId,
    })
  }

  async resolveReviewComment(commentId: string): Promise<UiResponse> {
    return this.invoke({
      type: 'workspace.review.comments.resolve',
      payload: { commentId },
      sessionId: this.selectedSessionId,
    })
  }

  async followupReviewComment(
    commentId: string,
    input: { sessionId?: string; isolation?: 'shared' | 'worktree'; start?: boolean } = {},
  ): Promise<UiResponse> {
    const payload: Record<string, JsonValue> = { commentId }
    if (input.sessionId !== undefined) payload.sessionId = input.sessionId
    if (input.isolation !== undefined) payload.isolation = input.isolation
    if (input.start !== undefined) payload.start = input.start
    return this.invoke({
      type: 'workspace.review.comments.followup',
      payload,
      sessionId: input.sessionId ?? this.selectedSessionId,
    })
  }

  async createDraftPullRequest(input: {
    snapshotId: string
    title: string
    baseBranch: string
    body?: string
    commitTitle?: string
  }): Promise<UiResponse> {
    const payload: Record<string, JsonValue> = {
      snapshotId: input.snapshotId, title: input.title, baseBranch: input.baseBranch,
    }
    if (input.body !== undefined) payload.body = input.body
    if (input.commitTitle !== undefined) payload.commitTitle = input.commitTitle
    return this.invoke({
      type: 'workspace.review.pr.create',
      payload,
      sessionId: this.selectedSessionId,
    })
  }

  async refreshPullRequest(snapshotId: string): Promise<UiResponse> {
    return this.invoke({
      type: 'workspace.review.pr.refresh',
      payload: { snapshotId },
      sessionId: this.selectedSessionId,
    })
  }

  async listJobs(
    options: { limit?: number; sessionScope?: 'selected' | 'workspace'; activeOnly?: boolean } = {},
  ): Promise<UiResponse> {
    return this.invoke({
      type: 'jobs.list',
      payload: {
        limit: options.limit ?? 50,
        sessionScope: options.sessionScope ?? 'selected',
        activeOnly: options.activeOnly ?? false,
      },
      sessionId: this.selectedSessionId,
    })
  }

  async getJobLogs(jobId: string, maxBytes = 65_536): Promise<UiResponse> {
    return this.invoke({
      type: 'jobs.logs', payload: { jobId, maxBytes }, sessionId: this.selectedSessionId,
    })
  }

  async stopJob(jobId: string): Promise<UiResponse> {
    return this.invoke({
      type: 'jobs.stop', payload: { jobId }, sessionId: this.selectedSessionId,
    })
  }

  async replayEvents(afterSequence: number, options: { limit?: number; epoch?: string } = {}): Promise<UiResponse> {
    const payload: Record<string, JsonValue> = { afterSequence, limit: options.limit ?? 200 }
    if (options.epoch) payload.epoch = options.epoch
    return this.invoke({ type: 'events.replay', payload, sessionId: this.selectedSessionId })
  }

  async listQueue(options: { status?: string; limit?: number } = {}): Promise<UiResponse> {
    const payload: Record<string, JsonValue> = { limit: options.limit ?? 200 }
    if (options.status) payload.status = options.status
    return this.invoke({ type: 'workspace.queue.list', payload, sessionId: this.selectedSessionId })
  }

  async getQueueItem(taskId: string): Promise<UiResponse> {
    return this.invoke({ type: 'workspace.queue.get', payload: { taskId }, sessionId: this.selectedSessionId })
  }

  /**
   * What a Word, Excel or PowerPoint file of the open folder shows; with the digest of the
   * content a change replaced, also that earlier version.
   */
  async previewDocument(path: string, change: { previousSha256?: string; resultSha256?: string } = {}): Promise<UiResponse> {
    const payload: Record<string, JsonValue> = { path }
    if (change.previousSha256) payload.previousSha256 = change.previousSha256
    if (change.resultSha256) payload.resultSha256 = change.resultSha256
    return this.invoke({ type: 'document.preview', payload, sessionId: this.selectedSessionId })
  }

  /** Scheduled tasks with their next run, last run and the inbox's unread count. */
  async listSchedules(): Promise<UiResponse> {
    return this.invoke({ type: 'schedules.list', payload: {}, sessionId: null })
  }

  /** Creates a schedule (no id) or changes the given fields of one. */
  async saveSchedule(schedule: Record<string, JsonValue>): Promise<UiResponse> {
    return this.invoke({ type: 'schedules.save', payload: { schedule }, sessionId: null })
  }

  async deleteSchedule(scheduleId: string): Promise<UiResponse> {
    return this.invoke({ type: 'schedules.delete', payload: { scheduleId }, sessionId: null })
  }

  async runSchedule(scheduleId: string): Promise<UiResponse> {
    return this.invoke({ type: 'schedules.run', payload: { scheduleId }, sessionId: null })
  }

  async listScheduleRuns(options: { scheduleId?: string; limit?: number } = {}): Promise<UiResponse> {
    const payload: Record<string, JsonValue> = { limit: options.limit ?? 50 }
    if (options.scheduleId) payload.scheduleId = options.scheduleId
    return this.invoke({ type: 'schedules.runs', payload, sessionId: null })
  }

  /** Marks the given finished runs, or every one, as read. */
  async markScheduleRunsRead(runIds?: readonly string[]): Promise<UiResponse> {
    return this.invoke({ type: 'schedules.read', payload: runIds ? { runIds: [...runIds] } : {}, sessionId: null })
  }

  /** Batches of file moves, copies and removals the agent made in this workspace, newest first. */
  async listFileBatches(limit = 50): Promise<UiResponse> {
    return this.invoke({ type: 'files.batches.list', payload: { limit }, sessionId: null })
  }

  /** Reverses what is still as the batch left it; the reply lists what was left alone. */
  async undoFileBatch(batchId: string): Promise<UiResponse> {
    return this.invoke({ type: 'files.batches.undo', payload: { batchId }, sessionId: null })
  }

  /** Estimated cost of a month's model calls (YYYY-MM; this month when omitted) and the cap. */
  async getUsageBill(month?: string): Promise<UiResponse> {
    return this.invoke({ type: 'usage.bill', payload: month ? { month } : {}, sessionId: null })
  }

  async setMonthlyCap(capUsd: number | null): Promise<UiResponse> {
    return this.invoke({ type: 'usage.cap.set', payload: { capUsd }, sessionId: null })
  }

  /** Watched folders, and WeChat or QQ download folders found on this computer. */
  async listWatchedFolders(): Promise<UiResponse> {
    return this.invoke({ type: 'knowledge.watch.list', payload: {}, sessionId: null })
  }

  async watchFolder(path: string, collectionId?: string): Promise<UiResponse> {
    return this.invoke({ type: 'knowledge.watch.add', payload: collectionId ? { path, collectionId } : { path }, sessionId: null })
  }

  async unwatchFolder(path: string): Promise<UiResponse> {
    return this.invoke({ type: 'knowledge.watch.remove', payload: { path }, sessionId: null })
  }

  /** Files the agent changed after a message: a preview, or (apply) put back as they were. */
  async rewindFiles(sessionId: string, messageId: string, apply: boolean): Promise<UiResponse> {
    return this.invoke({ type: 'session.rewind', payload: { sessionId, messageId, apply }, sessionId: null })
  }

  async scanWatchedFolders(): Promise<UiResponse> {
    return this.invoke({ type: 'knowledge.watch.scan', payload: {}, sessionId: null })
  }

  async listCollaborations(limit = 50): Promise<UiResponse> {
    return this.invoke({ type: 'workspace.collaborations.list', payload: { limit }, sessionId: this.selectedSessionId })
  }

  async getCollaboration(id: string, sessionId = this.selectedSessionId): Promise<UiResponse> {
    return this.invoke({ type: 'workspace.collaborations.get', payload: { id, sessionId }, sessionId })
  }

  async cancelCollaboration(id: string, sessionId = this.selectedSessionId, reason?: string): Promise<UiResponse> {
    const payload: Record<string, JsonValue> = { id, sessionId }
    if (reason) payload.reason = reason
    return this.invoke({ type: 'workspace.collaborations.cancel', payload, sessionId })
  }

  async resumeCollaboration(id: string, sessionId = this.selectedSessionId): Promise<UiResponse> {
    return this.invoke({ type: 'workspace.collaborations.resume', payload: { id, sessionId }, sessionId })
  }

  async listDeliveries(limit = 50): Promise<UiResponse> {
    return this.invoke({ type: 'workspace.deliveries.list', payload: { limit }, sessionId: this.selectedSessionId })
  }

  async getDelivery(id: string, sessionId = this.selectedSessionId): Promise<UiResponse> {
    return this.invoke({ type: 'workspace.deliveries.get', payload: { id, sessionId }, sessionId })
  }

  async cancelDelivery(id: string, sessionId = this.selectedSessionId, reason?: string): Promise<UiResponse> {
    const payload: Record<string, JsonValue> = { id, sessionId }
    if (reason) payload.reason = reason
    return this.invoke({ type: 'workspace.deliveries.cancel', payload, sessionId })
  }

  async resumeDelivery(
    id: string,
    sessionId = this.selectedSessionId,
    routeId?: string,
    options: { maxCycles?: number; resumeBlocked?: boolean } = {},
  ): Promise<UiResponse> {
    const payload: Record<string, JsonValue> = { id, sessionId }
    if (routeId) payload.routeId = routeId
    if (options.maxCycles !== undefined) payload.maxCycles = options.maxCycles
    if (options.resumeBlocked !== undefined) payload.resumeBlocked = options.resumeBlocked
    return this.invoke({ type: 'workspace.deliveries.resume', payload, sessionId })
  }

  async getRunHistory(runId: string, options: { limit?: number; before?: string; cutoff?: number } = {}): Promise<UiResponse> {
    const payload: Record<string, JsonValue> = { runId, limit: options.limit ?? 100, epoch: this.store.getState().runtime.epoch ?? '' }
    if (!payload.epoch) delete payload.epoch
    if (options.before) payload.before = options.before
    if (options.cutoff !== undefined) payload.cutoff = options.cutoff
    return this.invoke({ type: 'run.history.page', payload, sessionId: this.selectedSessionId })
  }

  async getRunEvidence(runId: string, options: { stepId?: string; limit?: number; cursor?: string } = {}): Promise<UiResponse> {
    const payload: Record<string, JsonValue> = { runId, limit: options.limit ?? 100 }
    if (options.stepId) payload.stepId = options.stepId
    if (options.cursor) payload.cursor = options.cursor
    return this.invoke({ type: 'run.evidence.page', payload, sessionId: this.selectedSessionId })
  }

  async retryPlanStep(stepId: string): Promise<UiResponse> {
    return this.invoke({ type: 'workspace.plan.retry', payload: { stepId, action: 'retry' }, sessionId: this.selectedSessionId })
  }

  async skipPlanStep(stepId: string): Promise<UiResponse> {
    return this.invoke({ type: 'workspace.plan.skip', payload: { stepId, action: 'skip' }, sessionId: this.selectedSessionId })
  }

  async applyFailureAction(stepId: string, action: 'retry' | 'skip'): Promise<UiResponse> {
    return this.invoke({ type: 'workspace.runs.failure.action', payload: { stepId, action }, sessionId: this.selectedSessionId })
  }

  async startTerminal(input: {
    argv: string[]
    cwd?: string
    owner?: string
    deadlineSeconds?: number
    maxOutputBytes?: number
  }): Promise<UiResponse> {
    const payload: Record<string, JsonValue> = { argv: input.argv }
    if (input.cwd !== undefined) payload.cwd = input.cwd
    if (input.owner !== undefined) payload.owner = input.owner
    if (input.deadlineSeconds !== undefined) payload.deadlineSeconds = input.deadlineSeconds
    if (input.maxOutputBytes !== undefined) payload.maxOutputBytes = input.maxOutputBytes
    return this.invoke({ type: 'terminal.start', payload, sessionId: this.selectedSessionId })
  }

  async sendTerminalInput(terminalId: string, data: string, owner?: string): Promise<UiResponse> {
    const payload: Record<string, JsonValue> = { terminalId, data }
    if (owner) payload.owner = owner
    return this.invoke({ type: 'terminal.input', payload, sessionId: this.selectedSessionId })
  }

  async resizeTerminal(terminalId: string, columns: number, rows: number, owner?: string): Promise<UiResponse> {
    const payload: Record<string, JsonValue> = { terminalId, columns, rows }
    if (owner) payload.owner = owner
    return this.invoke({ type: 'terminal.resize', payload, sessionId: this.selectedSessionId })
  }

  async getTerminalStatus(terminalId: string): Promise<UiResponse> {
    return this.invoke({ type: 'terminal.status', payload: { terminalId }, sessionId: this.selectedSessionId })
  }

  async listTerminals(limit = 32): Promise<UiResponse> {
    return this.invoke({ type: 'terminal.list', payload: { limit }, sessionId: this.selectedSessionId })
  }

  async replayTerminal(terminalId: string, offset = 0, maxBytes = 512 * 1024): Promise<UiResponse> {
    return this.invoke({ type: 'terminal.replay', payload: { terminalId, offset, maxBytes }, sessionId: this.selectedSessionId })
  }

  async stopTerminal(terminalId: string, reason = 'stopped', owner?: string): Promise<UiResponse> {
    const payload: Record<string, JsonValue> = { terminalId, reason }
    if (owner) payload.owner = owner
    return this.invoke({ type: 'terminal.stop', payload, sessionId: this.selectedSessionId })
  }

  async listProviders(): Promise<UiResponse> {
    return this.invoke({ type: 'provider.list', payload: {}, sessionId: null })
  }

  async getProvider(providerId: string): Promise<UiResponse> {
    return this.invoke({
      type: 'provider.get',
      payload: { providerId },
      sessionId: null,
    })
  }

  async setProvider(input: ProviderSettingsInput): Promise<UiResponse> {
    const payload: Record<string, string | boolean> = {
      providerId: input.providerId,
      name: input.name,
      protocol: input.protocol,
      baseUrl: input.baseUrl,
      model: input.model,
    }
    if (input.apiKey !== undefined) payload.apiKey = input.apiKey
    if (input.makeDefault !== undefined) payload.makeDefault = input.makeDefault
    return this.invoke({ type: 'provider.set', payload, sessionId: null })
  }

  async clearProvider(providerId: string): Promise<UiResponse> {
    return this.invoke({
      type: 'provider.clear',
      payload: { providerId },
      sessionId: null,
    })
  }

  async deleteProvider(providerId: string): Promise<UiResponse> {
    return this.invoke({ type: 'provider.delete', payload: { providerId }, sessionId: null })
  }

  async setDefaultProvider(providerId: string): Promise<UiResponse> {
    return this.invoke({ type: 'provider.default', payload: { providerId }, sessionId: null })
  }

  async testProvider(providerId?: string): Promise<UiResponse> {
    return this.invoke({
      type: 'provider.test',
      payload: providerId === undefined ? {} : { providerId },
      sessionId: null,
    })
  }

  async bootstrapProvider(providerId?: string): Promise<UiResponse> {
    return this.invoke({
      type: 'provider.bootstrap',
      payload: providerId === undefined ? {} : { providerId },
      sessionId: null,
    })
  }

  async healthProvider(providerId?: string): Promise<UiResponse> {
    return this.invoke({
      type: 'provider.health',
      payload: providerId === undefined ? {} : { providerId },
      sessionId: null,
    })
  }

  async history(sessionId: string, cursor: string): Promise<UiResponse> {
    const response = await this.invoke({
      type: 'session.history',
      payload: { cursor },
      sessionId,
    })
    // History is a read-only, content-addressed page. A concurrent resync can
    // legitimately advance the wire watermark past this response before the
    // promise callback runs, so merge it once more under epoch/session/cutoff
    // guards instead of silently losing the page.
    this.store.applyHistoryPage(response)
    return response
  }

  async startTurn(
    prompt: string,
    attachmentIds: readonly string[] = [],
    excludeImageDigests: readonly string[] = [],
    reasoningEffort?: 'off' | 'low' | 'medium' | 'high' | 'xhigh' | 'max',
    sessionId: string | null = this.selectedSessionId,
    model?: string,
    // Read-only tools and a plan for the user to approve before anything changes.
    planFirst = false,
  ): Promise<UiResponse> {
    return this.invoke({
      type: 'turn.start',
      payload: {
        prompt,
        ...(attachmentIds.length > 0 ? { attachmentIds: [...attachmentIds] } : {}),
        ...(excludeImageDigests.length > 0
          ? { excludeImageDigests: [...excludeImageDigests] }
          : {}),
        ...(reasoningEffort ? { reasoningEffort } : {}),
        ...(model ? { model } : {}),
        ...(planFirst ? { planFirst: true } : {}),
      },
      sessionId,
    })
  }

  async steerTurn(
    prompt: string,
    turnId: string,
    attachmentIds: readonly string[] = [],
    inputId?: string,
    sessionId: string | null = this.selectedSessionId,
  ): Promise<UiResponse> {
    return this.invoke({ type: 'turn.steer', sessionId,
      payload: { prompt, turnId,
        ...(attachmentIds.length > 0 ? { attachmentIds: [...attachmentIds] } : {}),
        ...(inputId ? { inputId } : {}) } })
  }

  async optimizePrompt(
    prompt: string,
    selection?: { providerId?: string; model?: string },
  ): Promise<string> {
    const payload: Record<string, JsonValue> = { prompt }
    if (selection?.providerId) payload.providerId = selection.providerId
    if (selection?.model) payload.model = selection.model
    const response = await this.invoke({
      type: 'prompt.optimize',
      payload,
      sessionId: this.selectedSessionId,
    })
    if (response.type === 'app.error') {
      const code = typeof response.payload.code === 'string' ? response.payload.code : 'prompt_optimization_failed'
      throw new GatewayCommandError(code)
    }
    if (response.type !== 'prompt.optimize.result' || typeof response.payload.optimizedPrompt !== 'string') {
      throw new GatewayCommandError('prompt_optimization_failed')
    }
    return response.payload.optimizedPrompt
  }

  async cancelTurn(sessionId: string | null = this.selectedSessionId, turnId?: string): Promise<UiResponse> {
    const actualTurnId = turnId && turnId !== 'pending' && turnId !== 'active' ? turnId : undefined
    return this.invoke({ type: 'turn.cancel', payload: actualTurnId ? { turnId: actualTurnId } : {}, sessionId })
  }

  async setMode(mode: 'coding' | 'research' | 'task'): Promise<UiResponse> {
    return this.invoke({
      type: 'runtime.mode.set',
      payload: { mode },
      sessionId: this.selectedSessionId,
    })
  }

  async resolveApproval(requestId: string, scope: 'once' | 'session' | null): Promise<UiResponse> {
    const approval = this.store.getState().approvals[requestId]
    const approvalSessionId = typeof approval?.sessionId === 'string'
      ? approval.sessionId
      : this.selectedSessionId
    return this.invoke({
      type: 'approval.resolve',
      payload: { requestId, scope },
      sessionId: approvalSessionId,
    })
  }

  async setAutonomy(autonomy: Autonomy): Promise<UiResponse> {
    return this.invoke({
      type: 'runtime.autonomy.set',
      payload: { autonomy },
      sessionId: this.selectedSessionId,
    })
  }

  private async waitForSessionActivation(sessionId: string): Promise<void> {
    const deadline = Date.now() + 8_000
    while (Date.now() < deadline) {
      if (this.expectedSessionActivationId !== sessionId) return
      if (this.settledSessionActivations.has(sessionId)) {
        this.settledSessionActivations.delete(sessionId)
        return
      }
      const state = this.store.getState()
      // A newer user choice may arrive while this activation is stopping the
      // old host. Still wait for the current lifecycle operation to settle;
      // sending the next switch before that point races two host replacements.
      if (
        state.runtime.hostSessionId === sessionId &&
        state.runtime.ready &&
        state.runtime.state === 'ready'
      ) return
      if (state.runtime.state === 'failed' || state.runtime.state === 'stopped') return
      await new Promise((resolve) => setTimeout(resolve, 80))
      if (this.expectedSessionActivationId !== sessionId) return
      if (this.settledSessionActivations.has(sessionId)) {
        this.settledSessionActivations.delete(sessionId)
        return
      }
      const settled = this.store.getState()
      if (
        settled.runtime.hostSessionId === sessionId &&
        settled.runtime.ready &&
        settled.runtime.state === 'ready'
      ) return
      if (settled.runtime.state === 'failed' || settled.runtime.state === 'stopped') return
    }
    // A single reconciliation after the bounded wait is enough to recover a missed lifecycle event.
    // Rebootstrapping on every polling tick resets the snapshot repeatedly and makes the composer flap between readiness states.
    await this.bootstrap().catch(() => undefined)
  }

  private activateViewedSessionWhenIdle(force = false): void {
    const state = this.store.getState()
    const selected = typeof state.selectedSession?.id === 'string' ? state.selectedSession.id : null
    if (
      !selected ||
      state.runtime.stale ||
      (!force && state.runtime.activeTurn !== null) ||
      (state.runtime.queuedTurnCount ?? 0) > 0 ||
      state.runtime.hostSessionId === selected ||
      this.activatingSessionId !== null
    ) {
      return
    }
    this.activatingSessionId = selected
    void this.openSession(selected)
      .then(() => {
        const after = this.store.getState()
        if (
          after.selectedSession?.id === selected &&
          after.runtime.hostSessionId !== selected &&
          this.sessionActivationRetryTimer === null
        ) {
          this.sessionActivationRetryTimer = setTimeout(() => {
            this.sessionActivationRetryTimer = null
            this.activateViewedSessionWhenIdle(true)
          }, 120)
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (this.activatingSessionId === selected) this.activatingSessionId = null
      })
  }

  private projectSessionActivationEvent(event: UiEvent): UiEvent {
    const expectedSessionId = this.expectedSessionActivationId
    if (event.type === 'session.opened') {
      if (event.payload.activated === false) return event
      const openedSessionId = event.sessionId ?? (
        typeof event.payload.sessionId === 'string' ? event.payload.sessionId : null
      )
      if (!openedSessionId || !expectedSessionId || openedSessionId === expectedSessionId) return event
      // A late activation event from an older switch must never undo the
      // user's newest explicit session choice.
      return {
        ...event,
        payload: { ...event.payload, activated: false, hostSettled: this.sessionSwitchInFlight.size > 0 },
      }
    }
    if (event.type === 'session.created' && expectedSessionId) {
      const createdSessionId = typeof event.payload.sessionId === 'string' ? event.payload.sessionId : null
      if (createdSessionId && createdSessionId !== expectedSessionId) {
        // Creation is still projected into the session list, but selection is
        // owned by the latest explicit choice or the create response.
        return {
          ...event,
          payload: { ...event.payload, selected: false },
        }
      }
    }
    return event
  }
  private get selectedSessionId(): string | null {
    const id = this.store.getState().selectedSession?.id
    return typeof id === 'string' ? id : null
  }

  private bootstrap(): Promise<void> {
    if (this.bootstrapInFlight) {
      this.bootstrapRetryRequested = true
      return this.bootstrapInFlight
    }
    const run = Promise.resolve().then(async () => {
      do {
        this.bootstrapRetryRequested = false
        await this.invoke({
          type: 'app.bootstrap',
          payload: {},
          sessionId: null,
        })
      } while (this.bootstrapRetryRequested)
    })
    this.bootstrapInFlight = run
    run.then(
      () => {
        if (this.bootstrapInFlight === run) this.bootstrapInFlight = null
      },
      () => {
        if (this.bootstrapInFlight === run) this.bootstrapInFlight = null
      },
    )
    return run
  }

  private invoke(
    command: Parameters<AgentWorkspaceApi['invoke']>[0],
    options: { expectedSessionId?: string } = {},
  ): Promise<UiResponse> {
    this.store.beginCommand(command.type, command.sessionId)
    return this.api.invoke(command).then(
      (response) => {
        const staleSessionOpen =
          command.type === 'session.open' &&
          response.type === 'session.open.result' &&
          options.expectedSessionId !== undefined &&
          this.expectedSessionActivationId !== options.expectedSessionId
        this.store.applyResponse(response, { suppressSessionActivation: staleSessionOpen })
        if (response.type === 'app.error') {
          throw new GatewayCommandError(response.payload.code)
        }
        return response
      },
      (error: unknown) => {
        this.store.commandFailed(command.type, command.sessionId)
        throw error
      },
    )
  }
}

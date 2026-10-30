import { ListChecks, ListPlus, LoaderCircle, Mic, Paperclip, Plus, RotateCcw, Send, Sparkles, Square, Users, X } from 'lucide-react'
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type ClipboardEvent, type CSSProperties, type DragEvent, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'

import type { ProviderProfile, UiCommand } from '../../../shared/api'
import type { AttachmentCapability } from '../../../shared/attachments'
import { attachmentErrorMessage, mergeAttachmentCapabilities } from './attachments'
import { useOptionalI18n, useText } from '../i18n/I18nProvider'
import { translate } from '../i18n/messages'
import type { MessageKey } from '../i18n/messages'
import { ComposerDraftStore, composerDraftScope } from '../state/composer-drafts'
import { libraryName } from '../team/catalog'
import { teamPayload, useTeamSettings } from '../team/team-settings'
import { hasDroppedFiles, splitDroppedItems } from '../workspace/folder-drop'
import { useVoiceRecorder, voiceInputSupported } from '../voice/voice'
import { formatMention, matchSlashCommands, mentionAtCaret, parseSlashDraft, rankMentionPaths, recallHistory, type SlashCommand } from './suggestions'

export type { AttachmentCapability } from '../../../shared/attachments'
export type { SlashCommand } from './suggestions'

type SuggestionOption =
  | { kind: 'command'; key: string; label: string; detail: string; command: SlashCommand }
  | { kind: 'mention'; key: string; label: string; detail: string; path: string }

const MIN_COMPOSER_HEIGHT = 132
/** Suggestion menus stay short enough never to scroll. */
const MAX_SUGGESTIONS = 8
const MAX_COMPOSER_HEIGHT = 420
type ReasoningEffort = 'default' | 'off' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
type ExplicitReasoningEffort = Exclude<ReasoningEffort, 'default'>
type ComposerProfile = ProviderProfile & { supportedReasoningEfforts: ExplicitReasoningEffort[] }
const EXPLICIT_REASONING_EFFORTS = ['off', 'low', 'medium', 'high', 'xhigh', 'max'] as const

function savedProfiles(response: unknown): ComposerProfile[] | null {
  if (!response || typeof response !== 'object' || !('type' in response) || response.type !== 'provider.list.result' || !('payload' in response)) return null
  const payload = response.payload
  if (!payload || typeof payload !== 'object' || !('providers' in payload) || !Array.isArray(payload.providers)) return null
  return payload.providers.filter((profile): profile is ProviderProfile =>
    profile !== null && typeof profile === 'object' &&
    typeof profile.id === 'string' && typeof profile.name === 'string' &&
    typeof profile.model === 'string' && typeof profile.protocol === 'string' &&
    typeof profile.hasCredential === 'boolean',
  ).map((profile) => {
    const advertised = 'supportedReasoningEfforts' in profile ? profile.supportedReasoningEfforts : null
    return {
      ...profile,
      supportedReasoningEfforts: EXPLICIT_REASONING_EFFORTS.filter(
        (effort) => Array.isArray(advertised) && advertised.includes(effort),
      ),
    }
  })
}

function modelOptionLabel(profile: ComposerProfile, profiles: readonly ComposerProfile[]): string {
  const sameModel = profiles.filter((item) => item.model === profile.model)
  if (sameModel.length < 2) return profile.model
  const sameName = sameModel.filter((item) => item.name === profile.name)
  return `${profile.model} · ${profile.name}${sameName.length > 1 ? ` (${profile.id})` : ''}`
}

function sendErrorCode(error: unknown): string | null {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') {
    return error.code
  }
  const message = error instanceof Error ? error.message : String(error)
  return /\b([a-z][a-z0-9_]*_[a-z0-9_]+)\s*$/.exec(message)?.[1] ?? null
}

interface ComposerProps {
  invoke: (command: UiCommand) => Promise<unknown>
  sessionId?: string | null
  workspacePath?: string | null
  draftStore?: ComposerDraftStore
  activeTurnId?: string | null
  /** Optional reference-scope model label shown in the compact ready line. */
  providerLabel?: string | null
  providerId?: string | null
  placeholder?: string
  queuedCount?: number
  pendingInputCount?: number
  attachments?: readonly AttachmentCapability[]
  onRemoveAttachment?: (id: string) => void
  onAttach?: () => void
  onPasteFiles?: (files: readonly File[]) => void
  /** Dropped folders are opened as projects rather than attached. */
  onDropFolders?: (folders: readonly File[]) => void
  onAccepted?:(attachmentIds: readonly string[]) => void
  onOptimizePrompt?: (prompt: string) => Promise<string>
  suggestedPrompt?: string | null
  onSuggestedPromptConsumed?: () => void
  disabled?: boolean
  disabledReason?: string | null
  /** Previously sent prompts, oldest first; ArrowUp in an empty composer recalls them. */
  history?: readonly string[]
  slashCommands?: readonly SlashCommand[]
  /** Workspace-relative paths offered after typing `@`. */
  loadMentionPaths?: () => Promise<readonly string[]>
  /** Turns a microphone recording into text; the mic button appears only when set. */
  onTranscribe?: (audio: { mediaType: string; data: string }) => Promise<string>
  /** A rough cost range for a task started with a message this long; null when not priced. */
  estimateCost?: (messageChars: number) => Promise<CostEstimate | null>
}

export interface CostEstimate {
  expectedUsd: number
  highUsd: number
  calls: number
  cacheRatio: number
  fromHistory: boolean
}

const COST_ESTIMATE_DELAY_MS = 700

function money(value: number): string {
  if (value > 0 && value < 0.0001) return '<$0.0001'
  return `$${value.toFixed(value > 0 && value < 0.01 ? 4 : 2)}`
}

export function Composer({
  invoke,
  sessionId = null,
  workspacePath = null,
  draftStore,
  activeTurnId = null,
  providerLabel = null,
  providerId = null,
  placeholder,
  queuedCount = 0,
  pendingInputCount = 0,
  attachments = [],
  onRemoveAttachment,
  onAttach,
  onPasteFiles,
  onDropFolders,
  onAccepted,
  onOptimizePrompt,
  suggestedPrompt = null,
  onSuggestedPromptConsumed,
  disabled = false,
  disabledReason = null,
  history = [],
  slashCommands = [],
  loadMentionPaths,
  onTranscribe,
  estimateCost,
}: ComposerProps) {
  const tx = useText()
  const { locale } = useOptionalI18n()
  const [localDrafts] = useState(() => new ComposerDraftStore())
  const drafts = draftStore ?? localDrafts
  const scope = composerDraftScope(workspacePath, sessionId)
  const composition = useSyncExternalStore(
    useCallback((listener) => drafts.subscribe(scope, listener), [drafts, scope]),
    useCallback(() => drafts.get(scope), [drafts, scope]),
    useCallback(() => drafts.get(scope), [drafts, scope]),
  )
  const { draft, submitting, cancelling, optimizing, previousDraft, optimizationStatus, submitError, submitErrorCode, attachmentImports, attachmentError } = composition
  const importing = attachmentImports > 0
  const hasContent = Boolean(draft.trim() || attachments.length > 0)
  const [profiles, setProfiles] = useState<ComposerProfile[]>([])
  const [modelSwitching, setModelSwitching] = useState(false)
  const [modelSwitchError, setModelSwitchError] = useState(false)
  const [selectedProfileOverride, setSelectedProfileOverride] = useState<string | null>(null)
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>('default')
  // Plan first: the next task only reads and proposes; the bar below offers to carry it out.
  const [planFirst, setPlanFirst] = useState(false)
  // Expert team: the next task is answered by the agent leading the experts from Settings.
  const [teamMode, setTeamMode] = useState(false)
  const teamSettings = useTeamSettings()
  const team = teamPayload(teamSettings, (id) => libraryName(id, locale) ?? id)
  const teamNames = team === 'auto' ? translate(locale, 'composer.teamAuto') : team.map((member) => member.name).join('、')
  const teamHint = translate(locale, 'composer.teamHint', { names: teamNames })
  const [planStage, setPlanStage] = useState<{ sessionId: string | null; stage: 'sent' | 'running' | 'ready' } | null>(null)
  const [height, setHeight] = useState(MIN_COMPOSER_HEIGHT)
  const [resizing, setResizing] = useState(false)
  const resizeStart = useRef<{ y: number; height: number } | null>(null)
  const composing = useRef(false)
  const previousScope = useRef(scope)
  const attachmentSignature = JSON.stringify(attachments.map((item) => item.id))
  const previousAttachments = useRef({ scope, signature: attachmentSignature })
  const startupHandoff = useRef(sessionId === null)
  const currentScope = useRef(scope)
  const mounted = useRef(true)
  currentScope.current = scope
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const invokeRef = useRef(invoke)
  invokeRef.current = invoke
  const listboxId = useId()
  const [historyIndex, setHistoryIndex] = useState<number | null>(null)
  const [caret, setCaret] = useState(0)
  const [activeOption, setActiveOption] = useState(0)
  const [dismissedDraft, setDismissedDraft] = useState<string | null>(null)
  const [mentionPaths, setMentionPaths] = useState<readonly string[] | null>(null)
  const [mentionLoading, setMentionLoading] = useState(false)
  const mentionGeneration = useRef(0)
  const slashDraft = slashCommands.length > 0 ? parseSlashDraft(draft) : null
  const mention = loadMentionPaths && !slashDraft ? mentionAtCaret(draft, caret) : null
  const options: SuggestionOption[] = dismissedDraft === draft ? []
    : slashDraft?.typingName
      ? matchSlashCommands(slashCommands, slashDraft.name).slice(0, MAX_SUGGESTIONS).map((command) => ({
        kind: 'command', key: command.name, command, detail: command.description,
        label: `/${command.name}${command.argumentHint ? ` ${command.argumentHint}` : ''}`,
      }))
      : mention && mentionPaths
        ? rankMentionPaths(mentionPaths, mention.query, MAX_SUGGESTIONS).map((path) => ({
          kind: 'mention', key: path, path, detail: path, label: path.slice(path.lastIndexOf('/') + 1),
        }))
        : []
  const menuOpen = options.length > 0
  const activeIndex = Math.min(activeOption, Math.max(0, options.length - 1))
  const mentionActive = mention !== null
  const [voiceError, setVoiceError] = useState<MessageKey | null>(null)
  const scopeRef = useRef(scope)
  scopeRef.current = scope
  const recorder = useVoiceRecorder(
    (audio) => {
      if (!onTranscribe) return
      const target = scopeRef.current
      void onTranscribe(audio)
        .then((text) => {
          const spoken = text.trim()
          if (!spoken) { setVoiceError('composer.voice.empty'); return }
          const current = drafts.get(target).draft
          drafts.edit(target, current.trim() ? `${current.replace(/\s+$/, '')} ${spoken}` : spoken)
          if (target === currentScope.current) requestAnimationFrame(() => textareaRef.current?.focus())
        })
        .catch(() => setVoiceError('composer.voice.failed'))
        .finally(() => recorder.finish())
    },
    (code) => setVoiceError(code === 'microphone' ? 'composer.voice.microphone' : 'composer.voice.unsupported'),
  )
  const voiceAvailable = Boolean(onTranscribe) && voiceInputSupported()
  const selectedProfileId = selectedProfileOverride
    ?? profiles.find((profile) => profile.id === providerId)?.id
    ?? profiles.find((profile) => profile.model === providerLabel)?.id
    ?? '__current'
  const activeProfile = profiles.find((profile) => profile.id === selectedProfileId)
  const supportedEfforts = activeProfile?.supportedReasoningEfforts ?? []
  const reasoningAvailable = supportedEfforts.length > 0
  const selectedReasoningEffort = reasoningEffort !== 'default' && supportedEfforts.includes(reasoningEffort)
    ? reasoningEffort
    : 'default'
  const referenceReady = Boolean(providerLabel && !disabled && !activeTurnId && !submitting)
  const [costEstimate, setCostEstimate] = useState<CostEstimate | null>(null)
  const typedChars = draft.trim().length
  const estimateWanted = Boolean(estimateCost) && typedChars > 0 && referenceReady
  useEffect(() => {
    if (!estimateWanted || !estimateCost) {
      setCostEstimate(null)
      return
    }
    let active = true
    const timer = setTimeout(() => {
      estimateCost(typedChars)
        .then((estimate) => { if (active) setCostEstimate(estimate) })
        .catch(() => { if (active) setCostEstimate(null) })
    }, COST_ESTIMATE_DELAY_MS)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [estimateCost, estimateWanted, typedChars, scope])
  const costText = estimateWanted && costEstimate
    ? translate(locale, 'composer.costEstimate', { expected: money(costEstimate.expectedUsd), high: money(costEstimate.highUsd) })
    : null
  const costDetail = costText && costEstimate
    ? costEstimate.fromHistory
      ? translate(locale, 'composer.costEstimateDetail', { calls: String(costEstimate.calls), cache: String(Math.round(costEstimate.cacheRatio * 100)) })
      : translate(locale, 'composer.costEstimateTypical')
    : undefined
  const statusText = importing
    ? translate(locale, 'composer.importingAttachments')
    : referenceReady
    ? translate(locale, 'composer.ready')
    : disabled && disabledReason
      ? disabledReason
      : cancelling ? tx('Stopping')
        : optimizing ? tx('Optimizing prompt')
          : optimizationStatus ? tx('Prompt optimized · review before sending')
            : submitting ? tx('Sending')
              : activeTurnId
                ? translate(locale, pendingInputCount > 0 ? 'composer.steerPending' : 'composer.steerHint', { count: pendingInputCount })
                : tx('Enter to send · Shift+Enter for newline')

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  useEffect(() => {
    setSelectedProfileOverride(null)
  }, [providerId])

  useEffect(() => {
    if (!providerLabel || !providerId) return undefined
    let cancelled = false
    void (async () => {
      try {
        const response = await invokeRef.current({ type: 'provider.list', payload: {}, sessionId: null })
        const next = savedProfiles(response)
        if (!cancelled && next) setProfiles(next)
      } catch { /* Keep the active model visible when saved profiles are unavailable. */ }
    })()
    return () => { cancelled = true }
  }, [providerId, providerLabel])

  useEffect(() => {
    if (reasoningEffort !== 'default' && !supportedEfforts.includes(reasoningEffort)) {
      setReasoningEffort('default')
    }
  }, [profiles, selectedProfileId, reasoningEffort])

  useLayoutEffect(() => {
    const previous = previousScope.current
    if (previous !== scope) {
      composing.current = false
      if (startupHandoff.current) drafts.migrateStartupDraft(previous, scope)
      previousScope.current = scope
    }
    if (sessionId !== null) startupHandoff.current = false
  }, [drafts, scope, sessionId])

  useLayoutEffect(() => {
    const previous = previousAttachments.current
    if (previous.scope === scope && previous.signature !== attachmentSignature && drafts.get(scope).retryInputId) {
      drafts.update(scope, (current) => ({ ...current, retryInputId: null, retryTurnId: null }))
    }
    previousAttachments.current = { scope, signature: attachmentSignature }
  }, [drafts, scope, attachmentSignature])

  useEffect(() => {
    if (!suggestedPrompt) return
    drafts.edit(scope, suggestedPrompt)
    onSuggestedPromptConsumed?.()
    requestAnimationFrame(() => textareaRef.current?.focus())
  }, [drafts, scope, onSuggestedPromptConsumed, suggestedPrompt])

  useEffect(() => {
    mentionGeneration.current += 1
    setMentionPaths(null)
    setMentionLoading(false)
  }, [workspacePath, loadMentionPaths])

  useEffect(() => {
    setHistoryIndex(null)
    setDismissedDraft(null)
  }, [scope])

  useEffect(() => {
    if (!mentionActive || !loadMentionPaths || mentionPaths !== null || mentionLoading) return
    const generation = mentionGeneration.current
    setMentionLoading(true)
    void loadMentionPaths().then((paths) => paths, () => [] as readonly string[]).then((paths) => {
      if (!mounted.current || generation !== mentionGeneration.current) return
      setMentionPaths(paths)
      setMentionLoading(false)
    })
  }, [mentionActive, loadMentionPaths, mentionPaths, mentionLoading])

  useEffect(() => {
    if (!resizing) return undefined
    const onPointerMove = (event: PointerEvent): void => {
      const start = resizeStart.current
      if (!start) return
      const next = Math.max(MIN_COMPOSER_HEIGHT, Math.min(MAX_COMPOSER_HEIGHT, start.height - (event.clientY - start.y)))
      setHeight(next)
    }
    const onPointerUp = (): void => {
      resizeStart.current = null
      setResizing(false)
    }
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
    }
  }, [resizing])

  const beginResize = (event: ReactPointerEvent<HTMLDivElement>): void => {
    event.preventDefault()
    resizeStart.current = { y: event.clientY, height }
    setResizing(true)
  }

  const adjustHeight = (delta: number): void => {
    setHeight((current) => Math.max(MIN_COMPOSER_HEIGHT, Math.min(MAX_COMPOSER_HEIGHT, current + delta)))
  }

  const onResizeKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'ArrowUp') { event.preventDefault(); adjustHeight(16) }
    else if (event.key === 'ArrowDown') { event.preventDefault(); adjustHeight(-16) }
    else if (event.key === 'Home') { event.preventDefault(); setHeight(MIN_COMPOSER_HEIGHT) }
    else if (event.key === 'End') { event.preventDefault(); setHeight(MAX_COMPOSER_HEIGHT) }
  }

  useEffect(() => {
    setPlanStage((current) => {
      if (!current || current.sessionId !== (sessionId ?? null)) return current
      if (current.stage === 'sent' && activeTurnId) return { ...current, stage: 'running' }
      if (current.stage === 'running' && !activeTurnId) return { ...current, stage: 'ready' }
      return current
    })
  }, [activeTurnId, sessionId])

  const planReady = planStage?.stage === 'ready' && planStage.sessionId === (sessionId ?? null) && !activeTurnId

  const carryOutPlan = async (): Promise<void> => {
    setPlanFirst(false)
    setPlanStage(null)
    try {
      await invoke({ type: 'turn.start', sessionId, payload: { prompt: translate(locale, 'composer.carryOutPrompt'), attachmentIds: [] } })
    } catch {
      setPlanStage({ sessionId: sessionId ?? null, stage: 'ready' })
      drafts.update(scope, (current) => ({ ...current, submitError: 'composer.error.send', submitErrorCode: null }))
    }
  }

  const submit = async (mode: 'primary' | 'queue' = 'primary'): Promise<void> => {
    if (disabled || modelSwitching || optimizing) return
    const submitted = drafts.get(scope)
    const prompt = submitted.draft.trim() || (attachments.length > 0 ? translate(locale, 'composer.attachmentPrompt') : '')
    if (!prompt || submitted.submitting || submitted.optimizing || submitted.attachmentImports > 0 || composing.current) return
    try { mergeAttachmentCapabilities([], attachments) } catch (error) {
      drafts.update(scope, current => ({ ...current, attachmentError: attachmentErrorMessage(error) }))
      return
    }
    const steering = Boolean(activeTurnId && mode === 'primary')
    const inputId = steering
      ? (submitted.retryTurnId === activeTurnId ? submitted.retryInputId : null) ?? crypto.randomUUID()
      : null
    const submittedAttachmentIds = attachments.map((item) => item.id)
    const optimisticRevision = submitted.revision + 1
    drafts.update(scope, (current) => ({ ...current, draft: '', revision: optimisticRevision,
      previousDraft: null, optimizationStatus: false, submitting: true,
      inFlightAttachmentIds: submittedAttachmentIds, attachmentError: null,
      submitError: null, submitErrorCode: null, retryInputId: inputId, retryTurnId: steering ? activeTurnId : null }))
    try {
      await invoke({
        type: steering ? 'turn.steer' : 'turn.start',
        sessionId,
        payload: {
          prompt,
          attachmentIds: submittedAttachmentIds,
          ...(steering ? { turnId: activeTurnId, inputId } : selectedReasoningEffort !== 'default' ? { reasoningEffort: selectedReasoningEffort } : {}),
          ...(!steering && planFirst ? { planFirst: true } : {}),
          ...(!steering && teamMode && team.length > 0
            ? { team: team === 'auto' ? 'auto' : team.map((member) => ({ ...member })), teamReview: teamSettings.review }
            : {}),
        },
      })
      if (!steering) setPlanStage(planFirst ? { sessionId: sessionId ?? null, stage: 'sent' } : null)
      drafts.consumeAttachments(scope, submittedAttachmentIds)
      drafts.update(scope, (current) => ({ ...current, retryInputId: null, retryTurnId: null }))
      if (mounted.current && currentScope.current === scope) {
        onAccepted?.(submittedAttachmentIds)
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      const error: MessageKey = message.includes('runtime_unconfigured') || message.includes('unconfigured')
        ? 'composer.error.unconfigured'
        : message.includes('invalid_workspace') || message.includes('no_workspace')
          ? 'composer.error.noWorkspace'
          : message.includes('monthly_cap_reached')
            ? 'composer.error.monthlyCap'
          : /image|attachment|workspace_changed/.test(sendErrorCode(err) ?? '')
            ? attachmentErrorMessage(err)
            : steering ? 'composer.error.steer' : 'composer.error.send'
      drafts.update(scope, (current) => ({ ...current,
        ...(current.revision === optimisticRevision ? { draft: submitted.draft } : {}),
        submitError: error, submitErrorCode: sendErrorCode(err) }))
    } finally {
      drafts.update(scope, (current) => ({ ...current, submitting: false, inFlightAttachmentIds: [] }))
    }
  }

  const switchModel = async (nextId: string): Promise<void> => {
    if (modelSwitching || activeTurnId || submitting || nextId === '__current' || nextId === selectedProfileId) return
    setModelSwitching(true)
    setModelSwitchError(false)
    try {
      const response = await invoke({ type: 'provider.default', payload: { providerId: nextId }, sessionId: null })
      if (response && typeof response === 'object' && 'type' in response && response.type !== 'provider.default.result') throw new Error('provider_switch_failed')
      if (response && typeof response === 'object' && 'payload' in response && response.payload && typeof response.payload === 'object' && 'applied' in response.payload && response.payload.applied !== true) throw new Error('provider_switch_deferred')
      setSelectedProfileOverride(nextId)
      const nextProfile = profiles.find((profile) => profile.id === nextId)
      setReasoningEffort((current) =>
        current === 'default' || nextProfile?.supportedReasoningEfforts.includes(current)
          ? current
          : 'default',
      )
    } catch {
      setModelSwitchError(true)
    } finally {
      setModelSwitching(false)
    }
  }

  const optimize = async (): Promise<void> => {
    const requested = drafts.get(scope)
    const prompt = requested.draft.trim()
    if (disabled || !onOptimizePrompt || !prompt || requested.submitting || requested.optimizing) return
    drafts.update(scope, (current) => ({ ...current, optimizing: true, submitError: null, submitErrorCode: null }))
    try {
      const optimized = (await onOptimizePrompt(prompt)).trim()
      if (!optimized) throw new Error('prompt_optimization_empty')
      drafts.update(scope, (current) => current.revision === requested.revision
        ? { ...current, previousDraft: requested.draft, draft: optimized, revision: current.revision + 1, optimizationStatus: true, retryInputId: null, retryTurnId: null }
        : current)
    } catch {
      drafts.update(scope, (current) => current.revision === requested.revision
        ? { ...current, submitError: 'composer.error.optimize' } : current)
    } finally {
      drafts.update(scope, (current) => ({ ...current, optimizing: false }))
    }
  }

  const restorePreviousDraft = (): void => {
    if (previousDraft === null) return
    drafts.edit(scope, previousDraft)
  }

  const cancel = async (): Promise<void> => {
    if (!activeTurnId || drafts.get(scope).cancelling) return
    drafts.update(scope, (current) => ({ ...current, cancelling: true, submitError: null, submitErrorCode: null }))
    try {
      await invoke({ type: 'turn.cancel', sessionId, payload: { turnId: activeTurnId } })
    } catch {
      drafts.update(scope, (current) => ({ ...current, submitError: 'composer.error.stop' }))
    } finally {
      drafts.update(scope, (current) => ({ ...current, cancelling: false }))
    }
  }

  const setDraftWithCaret = (text: string, nextCaret = text.length): void => {
    drafts.edit(scope, text)
    setCaret(nextCaret)
    requestAnimationFrame(() => {
      const node = textareaRef.current
      if (!node) return
      node.focus()
      node.setSelectionRange(nextCaret, nextCaret)
    })
  }

  const runCommand = async (command: SlashCommand, argument: string): Promise<void> => {
    drafts.update(scope, (current) => ({ ...current, submitError: null, submitErrorCode: null }))
    try {
      await command.run(argument)
      drafts.edit(scope, '')
      setCaret(0)
    } catch {
      drafts.update(scope, (current) => ({ ...current, submitError: 'composer.error.command' }))
    }
  }

  const acceptOption = (option: SuggestionOption): void => {
    setActiveOption(0)
    if (option.kind === 'command') {
      if (option.command.argumentHint) setDraftWithCaret(`/${option.command.name} `)
      else void runCommand(option.command, '')
      return
    }
    if (!mention) return
    const end = mention.start + 1 + mention.query.length
    const inserted = formatMention(option.path)
    setDraftWithCaret(draft.slice(0, mention.start) + inserted + draft.slice(end), mention.start + inserted.length)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (composing.current || event.nativeEvent.isComposing) return
    if (menuOpen) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        const step = event.key === 'ArrowDown' ? 1 : options.length - 1
        setActiveOption((activeIndex + step) % options.length)
        return
      }
      if ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Tab') {
        event.preventDefault()
        acceptOption(options[activeIndex])
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        setDismissedDraft(draft)
        return
      }
    }
    const recalled = historyIndex !== null && draft === history[historyIndex]
    if (!event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey &&
      ((event.key === 'ArrowUp' && (!draft || recalled)) || (event.key === 'ArrowDown' && recalled))) {
      const next = recallHistory(history, recalled ? historyIndex : null, event.key === 'ArrowUp' ? 'older' : 'newer')
      if (next) {
        event.preventDefault()
        setHistoryIndex(next.index)
        setDraftWithCaret(next.text)
      }
      return
    }
    if (event.key !== 'Enter' || event.shiftKey) return
    event.preventDefault()
    primaryAction()
  }

  /** Runs a fully typed `/command argument`, otherwise sends the draft. */
  const primaryAction = (): void => {
    const command = slashDraft && attachments.length === 0 && (!slashDraft.typingName || dismissedDraft !== draft)
      ? slashCommands.find((item) => item.name === slashDraft.name)
      : undefined
    if (command) {
      void runCommand(command, slashDraft!.argument)
      return
    }
    setHistoryIndex(null)
    void submit()
  }

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>): void => {
    if (!onPasteFiles) return
    const files = Array.from(event.clipboardData.files)
    let nativeAttachments = false
    if (files.length === 0) {
      try { nativeAttachments = window.agentWorkspace?.clipboardHasAttachments?.() === true } catch { /* Text paste stays native if the bridge is unavailable. */ }
    }
    if (files.length === 0 && !nativeAttachments) return
    event.preventDefault()
    onPasteFiles(files)
  }

  const onDrop = (event: DragEvent<HTMLElement>): void => {
    if (!hasDroppedFiles(event.dataTransfer)) return
    event.preventDefault()
    const { folders, files } = splitDroppedItems(event.dataTransfer)
    if (folders.length > 0) onDropFolders?.(folders)
    if (files.length > 0) onPasteFiles?.(files)
  }

  return (
    <section
      className="composer-shell composer-continuity glass-surface glass-interactive"
      aria-label={tx('Composer')}
      data-layout="bottom"
      aria-busy={importing}
      data-resizing={resizing ? 'true' : 'false'}
      data-has-attachments={attachments.length > 0 || planFirst || teamMode || planReady ? 'true' : 'false'}
      data-reference={providerLabel ? 'true' : 'false'}
      data-running={activeTurnId ? 'true' : 'false'}
      style={{ '--composer-height': `${height}px` } as CSSProperties}
      onDragOver={(event) => { if (hasDroppedFiles(event.dataTransfer)) event.preventDefault() }}
      onDrop={onDrop}
    >
      <div
        className="composer-resize-handle"
        role="separator"
        aria-label={tx('Resize composer')}
        aria-orientation="horizontal"
        aria-valuemin={MIN_COMPOSER_HEIGHT}
        aria-valuemax={MAX_COMPOSER_HEIGHT}
        aria-valuenow={height}
        tabIndex={0}
        onPointerDown={beginResize}
        onKeyDown={onResizeKeyDown}
      />
      <div className="composer-attachments" data-testid="composer-attachments-track">
        {planReady ? (
          <span className="composer-plan-ready" role="status">
            <ListChecks size={14} aria-hidden="true" />
            <span>{translate(locale, 'composer.planReady')}</span>
            <button type="button" className="provider-primary" disabled={disabled} onClick={() => void carryOutPlan()}>{translate(locale, 'composer.carryOut')}</button>
          </span>
        ) : null}
        {planFirst && !planReady ? (
          <span className="attachment-chip composer-plan-chip" title={translate(locale, 'composer.planFirstHint')}>
            <ListChecks size={14} aria-hidden="true" />
            <span className="attachment-name">{translate(locale, 'composer.planFirst')}</span>
            <button type="button" aria-label={translate(locale, 'composer.planFirstOff')} onClick={() => setPlanFirst(false)}><X size={13} /></button>
          </span>
        ) : null}
        {teamMode ? (
          <span className="attachment-chip composer-team-chip" title={teamHint}>
            <Users size={14} aria-hidden="true" />
            <span className="attachment-name">{translate(locale, 'composer.team')} · {teamNames}</span>
            <button type="button" aria-label={translate(locale, 'composer.teamOff')} onClick={() => setTeamMode(false)}><X size={13} /></button>
          </span>
        ) : null}
        {attachments.map((attachment) => (
          <span className="attachment-chip" key={attachment.id} title={attachment.name}>
            {attachment.previewDataUrl ? <img className="attachment-preview" src={attachment.previewDataUrl} alt={attachment.name} /> : <Paperclip size={14} aria-hidden="true" />}
            <span className="attachment-name">{attachment.name}</span>
            <button type="button" aria-label={translate(locale, 'composer.removeAttachment', { name: attachment.name })} onClick={() => onRemoveAttachment?.(attachment.id)}><X size={13} /></button>
          </span>
        ))}
      </div>
      <div className="composer-editor-row">
        <div className="composer-input-wrap">
          <textarea
            ref={textareaRef}
            aria-label={tx('Message')}
            value={draft}
            rows={1}
            placeholder={activeTurnId ? translate(locale, 'composer.steerPlaceholder') : placeholder ?? tx('Describe a task')}
            onChange={(event) => {
              drafts.edit(scope, event.target.value)
              setCaret(event.target.selectionStart ?? event.target.value.length)
              setHistoryIndex(null)
              setActiveOption(0)
            }}
            onSelect={(event) => setCaret(event.currentTarget.selectionStart ?? 0)}
            onCompositionStart={() => { composing.current = true }}
            onCompositionEnd={() => { composing.current = false }}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            aria-autocomplete={slashCommands.length > 0 || loadMentionPaths ? 'list' : undefined}
            aria-controls={menuOpen ? listboxId : undefined}
            aria-activedescendant={menuOpen ? `${listboxId}-${activeIndex}` : undefined}
          />
          {menuOpen ? (
            <ul className="composer-suggestions" id={listboxId} role="listbox"
              aria-label={translate(locale, options[0].kind === 'command' ? 'composer.commands' : 'composer.mentions')}>
              {options.map((option, index) => (
                <li key={option.key} id={`${listboxId}-${index}`} role="option" aria-selected={index === activeIndex}
                  className={index === activeIndex ? 'composer-suggestion is-active' : 'composer-suggestion'}
                  data-kind={option.kind}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActiveOption(index)}
                  onClick={() => acceptOption(option)}>
                  <strong>{option.label}</strong>
                  <span>{option.detail}</span>
                </li>
              ))}
            </ul>
          ) : null}
          <details className="composer-tool-menu">
            <summary className="composer-tool-trigger" aria-label={tx('Composer tools')} title={tx('Composer tools')}>
              {providerLabel ? <Paperclip size={16} /> : <Plus size={16} />}
            </summary>
            <div className="composer-inline-tools" aria-label={tx('Composer tools')}>
              <button type="button" className="icon-button" aria-label={tx('Attach files')} title={tx(onAttach ? 'Attach files' : 'Attachments unavailable')} disabled={!onAttach} onClick={onAttach}><Paperclip size={16} /></button>
              <button type="button" className="icon-button composer-plan-toggle" aria-pressed={planFirst}
                aria-label={translate(locale, 'composer.planFirst')} title={translate(locale, 'composer.planFirstHint')}
                onClick={() => { setPlanFirst((value) => !value); setTeamMode(false) }}><ListChecks size={16} /></button>
              <button type="button" className="icon-button composer-team-toggle" aria-pressed={teamMode}
                aria-label={translate(locale, 'composer.team')} title={teamHint}
                onClick={() => { setTeamMode((value) => !value); setPlanFirst(false) }}><Users size={16} /></button>
              <button type="button" className="icon-button composer-optimize-button" aria-label={tx('Optimize prompt')} title={tx('Optimize prompt')} disabled={disabled || submitting || optimizing || importing || !onOptimizePrompt || !draft.trim()} onClick={() => void optimize()}><Sparkles size={16} /></button>
              {previousDraft !== null ? <button type="button" className="icon-button" aria-label={tx('Restore original prompt')} title={tx('Restore original prompt')} disabled={submitting || optimizing} onClick={restorePreviousDraft}><RotateCcw size={15} /></button> : null}
              {activeTurnId ? <button type="button" className="composer-queue-action" aria-label={tx('Queue message')} title={translate(locale, 'composer.queueHint')} disabled={disabled || modelSwitching || optimizing || submitting || importing || !hasContent} onClick={(event) => {
                event.currentTarget.closest('details')?.removeAttribute('open')
                void submit('queue')
              }}><ListPlus size={15} /><span>{tx('Queue message')}</span></button> : null}
            </div>
          </details>
        </div>
        <div className="composer-actions">
          {voiceAvailable ? (
            recorder.state.status === 'recording' ? (
              <button type="button" className="composer-voice-button is-recording" aria-label={translate(locale, 'composer.voice.stop')} title={translate(locale, 'composer.voice.stop')}
                onClick={recorder.stop}>
                <Square size={12} fill="currentColor" aria-hidden="true" />
                <span className="composer-voice-time" aria-live="off">{Math.floor(recorder.state.seconds / 60)}:{String(recorder.state.seconds % 60).padStart(2, '0')}</span>
              </button>
            ) : (
              <button type="button" className="composer-voice-button" aria-label={translate(locale, 'composer.voice.start')} title={translate(locale, 'composer.voice.start')}
                disabled={recorder.state.status === 'transcribing'} aria-busy={recorder.state.status === 'transcribing'}
                onClick={() => { setVoiceError(null); void recorder.start() }}>
                {recorder.state.status === 'transcribing' ? <LoaderCircle className="provider-spinner" size={16} aria-hidden="true" /> : <Mic size={16} aria-hidden="true" />}
              </button>
            )
          ) : null}
          {activeTurnId ? (
          <>
            <button type="button" className="send-button steer-button" aria-label={tx('Supplement current task')} title={translate(locale, 'composer.steerHint')} disabled={disabled || modelSwitching || optimizing || submitting || importing || !hasContent} onClick={() => void submit()}><Send size={18} /></button>
            <button type="button" className="send-button stop-button" aria-label={tx('Stop turn')} title={tx('Stop')} disabled={cancelling} onClick={() => void cancel()}><Square size={14} fill="currentColor" /></button>
          </>
        ) : (
          <button type="button" className="send-button" aria-label={tx('Send message')} title={disabled && disabledReason ? disabledReason : tx('Send')} disabled={disabled || modelSwitching || optimizing || submitting || importing || !hasContent} onClick={primaryAction}><Send size={20} /></button>
        )}
        </div>
      </div>
      <div className="composer-status" data-testid="composer-status-track">
        <span className="composer-status-main">
          {providerLabel ? <span className={referenceReady ? 'composer-status-dot is-ready' : 'composer-status-dot'} aria-hidden="true" /> : null}
          <span aria-live="polite">{statusText}</span>
          {/* Outside the live region: the estimate changes while typing and is read on demand. */}
          {costText ? <span className="composer-cost" title={costDetail} data-testid="composer-cost-estimate">{costText}</span> : null}
        </span>
        {providerLabel ? (
          <div className="composer-selection-controls">
            <select
              className="composer-model-select"
              aria-label={translate(locale, 'composer.model')}
              title={activeProfile ? modelOptionLabel(activeProfile, profiles) : providerLabel}
              value={selectedProfileId}
              disabled={modelSwitching || submitting || Boolean(activeTurnId) || profiles.length < 2}
              onChange={(event) => void switchModel(event.target.value)}
            >
              {selectedProfileId === '__current' ? <option value="__current">{providerLabel}</option> : null}
              {profiles.map((profile) => <option key={profile.id} value={profile.id}>{modelOptionLabel(profile, profiles)}</option>)}
            </select>
            <select
              className="composer-reasoning-select"
              aria-label={translate(locale, 'composer.thinkingLevel')}
              title={reasoningAvailable ? translate(locale, activeTurnId ? 'composer.nextTaskThinking' : 'composer.thinkingLevel') : translate(locale, 'composer.thinkingUnsupported')}
              value={selectedReasoningEffort}
              disabled={!reasoningAvailable || modelSwitching}
              onChange={(event) => {
                const effort = event.target.value as ReasoningEffort
                if (effort === 'default' || supportedEfforts.includes(effort)) setReasoningEffort(effort)
              }}
            >
              {(['default', ...supportedEfforts] as ReasoningEffort[]).map((effort) => (
                <option key={effort} value={effort}>{translate(locale, `composer.thinking.${effort}`)}</option>
              ))}
            </select>
          </div>
        ) : !activeTurnId && !disabled && queuedCount === 0 ? (
          <span className="composer-shortcut"><kbd>Enter</kbd><span>{tx('Send')}</span></span>
        ) : null}
        {queuedCount > 0 ? <span className="composer-queue" aria-live="polite">{translate(locale, 'composer.queued', { count: queuedCount })}</span> : null}
      </div>
      {recorder.state.status === 'recording' ? <p className="visually-hidden" role="status">{translate(locale, 'composer.voice.recording')}</p> : null}
      {modelSwitchError || submitError || attachmentError || voiceError ? <div className="composer-errors">
        {voiceError ? <p className="composer-error" role="status">{translate(locale, voiceError)}</p> : null}
        {modelSwitchError ? <p className="composer-error" role="status">{translate(locale, 'composer.modelSwitchFailed')}</p> : null}
        {submitError ? <p className="composer-error" role="status" aria-live="polite" data-error-code={submitErrorCode ?? undefined}>{translate(locale, submitError)}</p> : null}
        {attachmentError ? <p className="composer-error" role="status" aria-live="polite">{translate(locale, attachmentError)}</p> : null}
      </div> : null}
    </section>
  )
}

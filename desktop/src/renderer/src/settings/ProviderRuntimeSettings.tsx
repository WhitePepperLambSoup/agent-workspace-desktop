import { Activity, KeyRound, LoaderCircle, LockKeyhole, PlugZap, Plus, RefreshCw, Save, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'

import {
  PROVIDER_PROTOCOLS,
  type ProviderProfile,
  type ProviderProtocol,
  type ProviderSettingsInput,
  type UiResponse,
} from '../../../shared/api'
import { useI18n, type I18nValue } from '../i18n/I18nProvider'
import type { MessageKey } from '../i18n/messages'
import type { WorkbenchBridgeClient } from '../bridge/client'
import type { WorkbenchState } from '../state/workbench-store'

type ProviderProtocolOption = (typeof PROVIDER_PROTOCOLS)[number]

interface ProviderDraft {
  providerId: string
  name: string
  protocol: ProviderProtocol
  baseUrl: string
  model: string
  apiKey: string
  isDefault: boolean
  hasCredential: boolean
}

/**
 * Local model servers. Loopback addresses use 127.0.0.1 because only a literal
 * loopback IP is trusted for provider egress without a prompt.
 */
export const LOCAL_PROVIDER_PRESETS: readonly { id: string; name: string; protocol: ProviderProtocol; baseUrl: string }[] = [
  { id: 'llama-cpp', name: 'llama.cpp', protocol: 'openai-compatible', baseUrl: 'http://127.0.0.1:8080/v1' },
  { id: 'lm-studio', name: 'LM Studio', protocol: 'openai-compatible', baseUrl: 'http://127.0.0.1:1234/v1' },
  { id: 'vllm', name: 'vLLM', protocol: 'openai-compatible', baseUrl: 'http://127.0.0.1:8000/v1' },
  { id: 'ollama-local', name: 'Ollama', protocol: 'ollama', baseUrl: 'http://127.0.0.1:11434' },
]

const EMPTY_DRAFT: ProviderDraft = {
  providerId: '',
  name: '',
  protocol: 'openai-compatible',
  baseUrl: '',
  model: '',
  apiKey: '',
  isDefault: false,
  hasCredential: false,
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function providerFrom(value: unknown): ProviderProfile | null {
  if (!isRecord(value)) return null
  const protocol = value.protocol
  if (
    typeof value.id !== 'string' ||
    typeof value.name !== 'string' ||
    typeof protocol !== 'string' ||
    !PROVIDER_PROTOCOLS.includes(protocol as ProviderProtocolOption) ||
    typeof value.baseUrl !== 'string' ||
    typeof value.model !== 'string' ||
    typeof value.isDefault !== 'boolean' ||
    typeof value.hasCredential !== 'boolean'
  ) return null
  return {
    id: value.id,
    name: value.name,
    protocol: protocol as ProviderProtocol,
    baseUrl: value.baseUrl,
    model: value.model,
    isDefault: value.isDefault,
    hasCredential: value.hasCredential,
  }
}

type ProviderResponseType =
  | 'provider.list.result'
  | 'provider.set.result'
  | 'provider.test.result'
  | 'provider.default.result'
  | 'provider.clear.result'
  | 'provider.delete.result'
  | 'provider.health.result'
  | 'provider.bootstrap.result'

class ProviderResponseError extends Error {
  readonly name = 'ProviderResponseError'

  constructor(readonly code: string) {
    super(code)
  }
}

function expectProviderResponse<T extends ProviderResponseType>(response: UiResponse, expectedType: T): UiResponse & { type: T } {
  if (response.type === 'app.error') {
    const code = isRecord(response.payload) && typeof response.payload.code === 'string'
      ? response.payload.code
      : 'provider_unexpected_response'
    throw new ProviderResponseError(code)
  }
  if (response.type !== expectedType) throw new ProviderResponseError('provider_unexpected_response')
  return response as UiResponse & { type: T }
}

interface ProviderHealthView {
  providerId: string
  model: string
  status: 'healthy' | 'degraded' | 'needs_setup' | 'needs_credential' | 'error'
  ok: boolean
  apiKeyPresent: boolean
  latencyMs: number | null
  capabilities: {
    streaming: boolean
    toolCalling: boolean | null
    vision: boolean | null
    reasoning: boolean | null
    contextWindow: number | null
  }
  errorCode: string | null
  message: string
  remediation: string
}

function healthFromResponse(response: UiResponse): ProviderHealthView {
  const payload = expectProviderResponse(response, 'provider.health.result').payload
  if (!isRecord(payload) || typeof payload.providerId !== 'string' || typeof payload.model !== 'string' ||
      !['healthy', 'degraded', 'needs_setup', 'needs_credential', 'error'].includes(String(payload.status)) ||
      typeof payload.ok !== 'boolean' || typeof payload.apiKeyPresent !== 'boolean' ||
      !(payload.latencyMs === null || typeof payload.latencyMs === 'number') ||
      !isRecord(payload.capabilities) || typeof payload.capabilities.streaming !== 'boolean' ||
      !(payload.capabilities.toolCalling === null || typeof payload.capabilities.toolCalling === 'boolean') ||
      !(payload.capabilities.vision === null || typeof payload.capabilities.vision === 'boolean') ||
      !(payload.capabilities.reasoning === null || typeof payload.capabilities.reasoning === 'boolean') ||
      !(payload.capabilities.contextWindow === null || typeof payload.capabilities.contextWindow === 'number') ||
      !(payload.errorCode === null || typeof payload.errorCode === 'string') ||
      typeof payload.message !== 'string' || typeof payload.remediation !== 'string') {
    throw new ProviderResponseError('provider_unexpected_response')
  }
  return {
    providerId: payload.providerId,
    model: payload.model,
    status: payload.status as ProviderHealthView['status'],
    ok: payload.ok,
    apiKeyPresent: payload.apiKeyPresent,
    latencyMs: payload.latencyMs,
    capabilities: {
      streaming: payload.capabilities.streaming,
      toolCalling: payload.capabilities.toolCalling,
      vision: payload.capabilities.vision,
      reasoning: payload.capabilities.reasoning,
      contextWindow: payload.capabilities.contextWindow,
    },
    errorCode: payload.errorCode,
    message: payload.message,
    remediation: payload.remediation,
  }
}

function capabilityLabel(value: boolean | null): string {
  return value === null ? '?' : value ? '✓' : '—'
}

function providersFromResponse(response: UiResponse): { providers: ProviderProfile[]; defaultProviderId: string | null } {
  const payload = expectProviderResponse(response, 'provider.list.result').payload
  if (
    !isRecord(payload) ||
    !Array.isArray(payload.providers) ||
    !(payload.defaultProviderId === null || typeof payload.defaultProviderId === 'string')
  ) {
    throw new ProviderResponseError('provider_unexpected_response')
  }
  const providers = payload.providers.map(providerFrom)
  if (providers.some((provider) => provider === null)) {
    throw new ProviderResponseError('provider_unexpected_response')
  }
  return {
    providers: providers as ProviderProfile[],
    defaultProviderId: payload.defaultProviderId,
  }
}

function draftFromProvider(provider: ProviderProfile): ProviderDraft {
  return {
    providerId: provider.id,
    name: provider.name,
    protocol: provider.protocol,
    baseUrl: provider.baseUrl,
    model: provider.model,
    apiKey: '',
    isDefault: provider.isDefault,
    hasCredential: provider.hasCredential,
  }
}

function providerOrigin(value: string): string | null {
  try {
    return new URL(value).origin.toLowerCase()
  } catch {
    return null
  }
}

const ERROR_KEYS: Record<string, MessageKey> = {
  invalid_provider: 'settings.provider.error.invalidProvider',
  invalid_provider_credential: 'settings.provider.error.invalidCredential',
  provider_settings_failed: 'settings.provider.error.settingsFailed',
  provider_settings_unavailable: 'settings.provider.error.settingsUnavailable',
  unknown_provider: 'settings.provider.error.unknownProvider',
  provider_unconfigured: 'settings.provider.error.unconfigured',
  provider_test_failed: 'settings.provider.error.testFailed',
  provider_in_use: 'settings.provider.error.inUse',
  runtime_busy: 'settings.provider.error.runtimeBusy',
  runtime_start_failed: 'settings.provider.error.runtimeStartFailed',
  provider_unexpected_response: 'settings.provider.error.unexpectedResponse',
}

const RUNTIME_MODE_KEYS: Record<string, MessageKey> = {
  coding: 'settings.provider.mode.coding',
  research: 'settings.provider.mode.research',
  task: 'settings.provider.mode.task',
}

function errorMessageKey(error: unknown, fallback: MessageKey): MessageKey {
  const code = isRecord(error) && typeof error.code === 'string'
    ? error.code
    : error instanceof Error
      ? error.message
      : ''
  return ERROR_KEYS[code] ?? fallback
}

type ProviderOperation = 'saving' | 'testing' | 'clearing' | 'confirmingDelete' | 'deleting' | 'refreshing'

type DeleteConfirmation = (provider: ProviderProfile) => boolean | Promise<boolean>

interface ProviderRuntimeSettingsProps {
  state: WorkbenchState
  client?: WorkbenchBridgeClient
  confirmDelete?: DeleteConfirmation
  i18n?: I18nValue
}

const OPERATION_LABELS: Record<ProviderOperation, MessageKey> = {
  saving: 'settings.provider.saving',
  testing: 'settings.provider.testing',
  clearing: 'settings.provider.clearingKey',
  deleting: 'settings.provider.deleting',
  confirmingDelete: 'settings.provider.confirmingDelete',
  refreshing: 'settings.provider.refreshing',
}

const OPERATION_STATUS: Record<ProviderOperation, MessageKey> = {
  saving: 'settings.provider.savingStatus',
  testing: 'settings.provider.testingStatus',
  clearing: 'settings.provider.clearingStatus',
  deleting: 'settings.provider.deletingStatus',
  confirmingDelete: 'settings.provider.confirmingDeleteStatus',
  refreshing: 'settings.provider.refreshingStatus',
}

function ProviderRuntimeSettingsView({ state, client, confirmDelete, i18n }: ProviderRuntimeSettingsProps & { i18n: I18nValue }) {
  const { t } = i18n
  const [providers, setProviders] = useState<ProviderProfile[]>([])
  const [draft, setDraft] = useState<ProviderDraft>({ ...EMPTY_DRAFT })
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<ProviderOperation | null>(null)
  const [message, setMessage] = useState<MessageKey | null>(null)
  const [error, setError] = useState<MessageKey | null>(null)
  const [refreshNeeded, setRefreshNeeded] = useState(false)
  const [health, setHealth] = useState<ProviderHealthView | null>(null)

  const replaceFromResponse = (response: UiResponse, preferredId?: string): void => {
    const result = providersFromResponse(response)
    const authoritative = result.providers.map((provider) => ({
      ...provider,
      isDefault: result.defaultProviderId !== null
        ? provider.id === result.defaultProviderId
        : provider.isDefault,
    }))
    setProviders(authoritative)
    const selected = authoritative.find((provider) => provider.id === preferredId)
      ?? authoritative.find((provider) => provider.id === result.defaultProviderId)
      ?? authoritative[0]
    setSelectedProviderId(selected?.id ?? null)
    setDraft(selected ? draftFromProvider(selected) : { ...EMPTY_DRAFT })
    setRefreshNeeded(false)
  }

  const reloadProviders = async (preferredId?: string): Promise<void> => {
    if (!client) return
    replaceFromResponse(await client.listProviders(), preferredId)
  }

  const reloadAfterMutation = async (preferredId: string | undefined, successMessage: MessageKey): Promise<void> => {
    setMessage(successMessage)
    setError(null)
    try {
      await reloadProviders(preferredId)
    } catch {
      setRefreshNeeded(true)
    }
  }

  useEffect(() => {
    if (!client) return
    let active = true
    setLoading(true)
    setError(null)
    void client.listProviders().then((response) => {
      if (active) replaceFromResponse(response)
    }).catch((reason: unknown) => {
      if (active) setError(errorMessageKey(reason, 'settings.provider.error.load'))
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => { active = false }
  }, [client])

  const updateDraft = <K extends keyof ProviderDraft>(key: K, value: ProviderDraft[K]): void => {
    setDraft((current) => ({ ...current, [key]: value }))
    setMessage(null)
    setError(null)
  }

  const applyPreset = (presetId: string): void => {
    const preset = LOCAL_PROVIDER_PRESETS.find((item) => item.id === presetId)
    if (!preset) return
    setDraft((current) => ({
      ...current,
      providerId: current.providerId.trim() ? current.providerId : preset.id,
      name: preset.name,
      protocol: preset.protocol,
      baseUrl: preset.baseUrl,
    }))
    setMessage(null)
    setError(null)
  }

  const resetFeedback = (): void => {
    setMessage(null)
    setError(null)
  }

  const selectProvider = (providerId: string): void => {
    const provider = providers.find((item) => item.id === providerId)
    setSelectedProviderId(provider?.id ?? null)
    setDraft(provider ? draftFromProvider(provider) : { ...EMPTY_DRAFT })
    setHealth(null)
    resetFeedback()
  }

  const saveProvider = async (): Promise<void> => {
    if (!client || busy) return
    resetFeedback()
    const selected = providers.find((provider) => provider.id === selectedProviderId)
    const providerId = selected?.id ?? draft.providerId.trim()
    if (!providerId || !draft.name.trim() || !draft.baseUrl.trim() || !draft.model.trim()) {
      setError('settings.provider.validationRequired')
      return
    }
    const input: ProviderSettingsInput = {
      providerId,
      name: draft.name.trim(),
      protocol: draft.protocol,
      baseUrl: draft.baseUrl.trim(),
      model: draft.model.trim(),
      ...(draft.apiKey ? { apiKey: draft.apiKey } : {}),
    }
    setBusy('saving')
    try {
      expectProviderResponse(await client.setProvider(input), 'provider.set.result')
      setDraft((current) => ({ ...current, apiKey: '' }))
      setHealth(null)
      const response = expectProviderResponse(
        await client.setDefaultProvider(providerId),
        'provider.default.result',
      )
      if (!isRecord(response.payload) || typeof response.payload.applied !== 'boolean') {
        throw new ProviderResponseError('provider_unexpected_response')
      }
      const successMessage: MessageKey = response.payload.applied
        ? 'settings.provider.defaultApplied'
        : 'settings.provider.defaultDeferred'
      await reloadAfterMutation(providerId, successMessage)
    } catch (reason: unknown) {
      setError(errorMessageKey(reason, 'settings.provider.error.save'))
    } finally {
      setBusy(null)
    }
  }

  const testProvider = async (): Promise<void> => {
    const providerId = providers.find((provider) => provider.id === selectedProviderId)?.id
    if (!client || busy || !providerId) return
    setBusy('testing')
    resetFeedback()
    try {
      expectProviderResponse(await client.testProvider(providerId), 'provider.test.result')
      setMessage('settings.provider.testSucceeded')
    } catch (reason: unknown) {
      setError(errorMessageKey(reason, 'settings.provider.error.test'))
    } finally {
      setBusy(null)
    }
  }

  const checkProviderHealth = async (): Promise<void> => {
    const providerId = providers.find((provider) => provider.id === selectedProviderId)?.id
    if (!client || busy || !providerId || typeof client.healthProvider !== 'function') return
    setBusy('testing')
    resetFeedback()
    try {
      setHealth(healthFromResponse(await client.healthProvider(providerId)))
    } catch (reason: unknown) {
      setHealth(null)
      setError(errorMessageKey(reason, 'settings.provider.error.health'))
    } finally {
      setBusy(null)
    }
  }

  const clearCredential = async (): Promise<void> => {
    const provider = providers.find((item) => item.id === selectedProviderId)
    if (!client || busy || !provider || !draft.hasCredential) return
    const providerId = provider.id
    setBusy('clearing')
    resetFeedback()
    try {
      expectProviderResponse(await client.clearProvider(providerId), 'provider.clear.result')
      setDraft((current) => ({ ...current, apiKey: '' }))
      await reloadAfterMutation(providerId, 'settings.provider.keyCleared')
    } catch (reason: unknown) {
      setError(errorMessageKey(reason, 'settings.provider.error.clear'))
    } finally {
      setBusy(null)
    }
  }

  const deleteProvider = async (): Promise<void> => {
    if (!client || busy) return
    const provider = providers.find((item) => item.id === selectedProviderId)
    if (!provider) return
    setBusy('confirmingDelete')
    try {
      const accepted = await (confirmDelete
        ? confirmDelete(provider)
        : window.confirm(t('settings.provider.deleteConfirm', { name: provider.name, id: provider.id })))
      if (!accepted) return
      setBusy('deleting')
      resetFeedback()
      expectProviderResponse(await client.deleteProvider(provider.id), 'provider.delete.result')
      setDraft((current) => ({ ...current, apiKey: '' }))
      await reloadAfterMutation(undefined, 'settings.provider.deleted')
    } catch (reason: unknown) {
      setError(errorMessageKey(reason, 'settings.provider.error.delete'))
    } finally {
      setBusy(null)
    }
  }

  const refreshProviders = async (): Promise<void> => {
    if (!client || busy) return
    setBusy('refreshing')
    setError(null)
    try {
      await reloadProviders(selectedProviderId ?? undefined)
    } catch (reason: unknown) {
      setRefreshNeeded(true)
      setError(errorMessageKey(reason, 'settings.provider.error.load'))
    } finally {
      setBusy(null)
    }
  }

  const selectedProvider = providers.find((provider) => provider.id === selectedProviderId)
  const disabled = !client || loading || busy !== null
  const operationLabel = busy ? t(OPERATION_LABELS[busy]) : null
  const providerDraftDirty = Boolean(selectedProvider && (
    draft.name !== selectedProvider.name
    || draft.protocol !== selectedProvider.protocol
    || draft.baseUrl !== selectedProvider.baseUrl
    || draft.model !== selectedProvider.model
    || draft.apiKey !== ''
  ))
  const savedOrigin = selectedProvider ? providerOrigin(selectedProvider.baseUrl) : null
  const draftOrigin = providerOrigin(draft.baseUrl)
  const endpointCredentialWillBeRemoved = Boolean(
    selectedProvider?.hasCredential
    && !draft.apiKey
    && savedOrigin
    && draftOrigin
    && savedOrigin !== draftOrigin,
  )
  const credentialDescription = [
    draft.protocol === 'ollama' ? 'ollama-key-hint' : null,
    endpointCredentialWillBeRemoved ? 'provider-endpoint-credential-warning' : null,
  ].filter(Boolean).join(' ') || undefined
  const runtimeMode = RUNTIME_MODE_KEYS[state.runtime.mode]
    ? t(RUNTIME_MODE_KEYS[state.runtime.mode])
    : state.runtime.mode

  return (
    <section className="settings-section provider-runtime-settings" aria-labelledby="provider-runtime-heading">
      <header>
        <div>
          <h2 id="provider-runtime-heading">{t('settings.provider.title')}</h2>
          <p>{t(client ? 'settings.provider.secureStore' : 'settings.provider.gatewayUnavailable')}</p>
        </div>
        <LockKeyhole size={16} aria-hidden="true" />
      </header>
      <dl className="fact-list provider-runtime-facts">
        <div><dt>{t('settings.provider.activeProvider')}</dt><dd>{String(state.provider?.id || t('common.unavailable'))}</dd></div>
        <div><dt>{t('settings.provider.activeModel')}</dt><dd>{String(state.provider?.model || t('common.unavailable'))}</dd></div>
        <div><dt>{t('settings.provider.runtimeMode')}</dt><dd>{runtimeMode}</dd></div>
      </dl>
      <form className="provider-form" onSubmit={(event) => { event.preventDefault(); void saveProvider() }}>
        <label className="provider-field provider-field-wide">
          <span>{t('settings.provider.profile')}</span>
          <select value={selectedProviderId ?? ''} disabled={disabled} onChange={(event) => selectProvider(event.target.value)}>
            <option value="">{t('settings.provider.new')}</option>
            {providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name} ({provider.id})</option>)}
          </select>
        </label>
        {selectedProvider === undefined ? (
          <label className="provider-field provider-field-wide">
            <span>{t('settings.provider.localPreset')}</span>
            <select value="" disabled={disabled} onChange={(event) => applyPreset(event.target.value)}>
              <option value="">{t('settings.provider.localPresetChoose')}</option>
              {LOCAL_PROVIDER_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.name} · {preset.baseUrl}</option>)}
            </select>
            <small className="provider-hint">{t('settings.provider.localPresetHint')}</small>
          </label>
        ) : null}
        <label className="provider-field">
          <span>{t('settings.provider.id')}</span>
          <input value={draft.providerId} disabled={disabled || selectedProvider !== undefined} onChange={(event) => updateDraft('providerId', event.target.value)} autoComplete="off" />
        </label>
        <label className="provider-field">
          <span>{t('settings.provider.name')}</span>
          <input value={draft.name} disabled={disabled} onChange={(event) => updateDraft('name', event.target.value)} />
        </label>
        <label className="provider-field">
          <span>{t('settings.provider.protocol')}</span>
          <select value={draft.protocol} disabled={disabled} onChange={(event) => updateDraft('protocol', event.target.value as ProviderProtocol)}>
            {PROVIDER_PROTOCOLS.map((protocol) => <option key={protocol} value={protocol}>{protocol}</option>)}
          </select>
        </label>
        <label className="provider-field provider-field-wide">
          <span>{t('settings.provider.baseUrl')}</span>
          <input type="text" inputMode="url" value={draft.baseUrl} disabled={disabled} onChange={(event) => updateDraft('baseUrl', event.target.value)} spellCheck={false} aria-describedby={endpointCredentialWillBeRemoved ? 'provider-endpoint-credential-warning' : undefined} />
        </label>
        <label className="provider-field provider-field-wide">
          <span>{t('settings.provider.model')}</span>
          <input value={draft.model} disabled={disabled} onChange={(event) => updateDraft('model', event.target.value)} spellCheck={false} />
        </label>
        <label className="provider-field provider-field-wide">
          <span>{t('settings.provider.apiKey')}</span>
          <input
            type="password"
            value={draft.apiKey}
            disabled={disabled}
            onChange={(event) => updateDraft('apiKey', event.target.value)}
            placeholder={t(draft.hasCredential ? 'settings.provider.apiKeyStoredPlaceholder' : 'settings.provider.apiKeyPlaceholder')}
            autoComplete="new-password"
            aria-label={t('settings.provider.apiKey')}
            aria-describedby={credentialDescription}
          />
          {draft.protocol === 'ollama' ? <small id="ollama-key-hint" className="provider-hint">{t('settings.provider.ollamaKeyOptional')}</small> : null}
          {endpointCredentialWillBeRemoved ? <small id="provider-endpoint-credential-warning" className="provider-hint" role="status">{t('settings.provider.endpointCredentialWarning')}</small> : null}
        </label>
        <dl className="fact-list provider-profile-facts">
          <div><dt>{t('settings.provider.profileStatus')}</dt><dd>{t(draft.isDefault ? 'settings.provider.default' : 'settings.provider.notDefault')}</dd></div>
          <div><dt>{t('settings.provider.credentialStatus')}</dt><dd>{t(draft.hasCredential ? 'settings.provider.credentialStored' : 'settings.provider.credentialMissing')}</dd></div>
        </dl>
        <div className="provider-actions">
          <button type="submit" className="provider-primary" disabled={disabled} aria-busy={busy === 'saving'}><Save size={14} aria-hidden="true" />{busy === 'saving' ? operationLabel : t('settings.provider.save')}</button>
          <button type="button" disabled={disabled || !selectedProvider || providerDraftDirty} aria-busy={busy === 'testing'} onClick={() => void testProvider()}><PlugZap size={14} aria-hidden="true" />{busy === 'testing' ? operationLabel : t('settings.provider.test')}</button>
          <button type="button" disabled={disabled || !selectedProvider || providerDraftDirty || typeof client?.healthProvider !== 'function'} aria-busy={busy === 'testing'} onClick={() => void checkProviderHealth()}><Activity size={14} aria-hidden="true" />{busy === 'testing' ? operationLabel : t('settings.provider.health')}</button>
          <button type="button" disabled={disabled || !draft.hasCredential} aria-busy={busy === 'clearing'} onClick={() => void clearCredential()}><KeyRound size={14} aria-hidden="true" />{busy === 'clearing' ? operationLabel : t('settings.provider.clearKey')}</button>
          <button type="button" className="provider-danger" disabled={disabled || !selectedProvider} aria-busy={busy === 'confirmingDelete' || busy === 'deleting'} onClick={() => void deleteProvider()}><Trash2 size={14} aria-hidden="true" />{busy === 'confirmingDelete' || busy === 'deleting' ? operationLabel : t('settings.provider.delete')}</button>
          <button type="button" className="provider-new" disabled={disabled} onClick={() => selectProvider('')}><Plus size={14} aria-hidden="true" />{t('settings.provider.new')}</button>
          {busy ? <LoaderCircle className="provider-spinner" size={15} aria-hidden="true" /> : null}
        </div>
      </form>
      {health ? (
        <div className={`provider-health provider-health-${health.status}`} data-testid="provider-health" role="status">
          <div className="provider-health-header">
            <strong>{t('settings.provider.healthResult')}</strong>
            <span>{t(`settings.provider.healthStatus.${health.status}` as MessageKey)}</span>
          </div>
          <p>{health.message}</p>
          <dl className="fact-list provider-health-facts">
            <div><dt>{t('settings.provider.healthLatency')}</dt><dd>{health.latencyMs === null ? '?' : `${health.latencyMs} ms`}</dd></div>
            <div><dt>{t('settings.provider.healthKey')}</dt><dd>{health.apiKeyPresent ? t('settings.provider.credentialStored') : t('settings.provider.credentialMissing')}</dd></div>
            <div><dt>{t('settings.provider.healthStreaming')}</dt><dd>{health.capabilities.streaming ? '✓' : '—'}</dd></div>
            <div><dt>{t('settings.provider.healthTools')}</dt><dd>{capabilityLabel(health.capabilities.toolCalling)}</dd></div>
            <div><dt>{t('settings.provider.healthVision')}</dt><dd>{capabilityLabel(health.capabilities.vision)}</dd></div>
            <div><dt>{t('settings.provider.healthContext')}</dt><dd>{health.capabilities.contextWindow === null ? '?' : health.capabilities.contextWindow.toLocaleString()}</dd></div>
          </dl>
          {health.remediation ? <p className="provider-hint">{health.remediation}</p> : null}
        </div>
      ) : null}
      {loading ? <p className="provider-status" role="status">{t('settings.provider.loading')}</p> : null}
      {busy ? <p className="provider-status" role="status">{t(OPERATION_STATUS[busy])}</p> : null}
      {refreshNeeded ? (
        <div className="provider-refresh-warning" data-testid="provider-refresh-needed" data-refresh-needed="true" role="status">
          <span>{t('settings.provider.refreshNeeded')}</span>
          <button type="button" disabled={disabled} aria-busy={busy === 'refreshing'} onClick={() => void refreshProviders()}>
            <RefreshCw size={13} aria-hidden="true" />{busy === 'refreshing' ? t('settings.provider.refreshing') : t('settings.provider.refresh')}
          </button>
        </div>
      ) : null}
      {!busy && message ? <p className="provider-status provider-status-success" role="status">{t(message)}</p> : null}
      {error ? <p className="provider-status provider-status-error" role="alert">{t(error)}</p> : null}
    </section>
  )
}

function LocalizedProviderRuntimeSettings(props: ProviderRuntimeSettingsProps) {
  return <ProviderRuntimeSettingsView {...props} i18n={useI18n()} />
}

export function ProviderRuntimeSettings(props: ProviderRuntimeSettingsProps) {
  return props.i18n
    ? <ProviderRuntimeSettingsView {...props} i18n={props.i18n} />
    : <LocalizedProviderRuntimeSettings {...props} />
}

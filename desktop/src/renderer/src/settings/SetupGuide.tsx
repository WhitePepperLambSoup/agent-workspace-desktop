import { CheckCircle2, ExternalLink, FolderOpen, FolderPlus, LoaderCircle, Plug, Settings as SettingsIcon } from 'lucide-react'
import { useEffect, useId, useState } from 'react'

import type { WorkbenchBridgeClient } from '../bridge/client'
import { useOptionalI18n } from '../i18n/I18nProvider'
import type { MessageKey } from '../i18n/messages'
import type { WorkbenchState } from '../state/workbench-store'
import {
  CLOUD_PROVIDER_PRESETS,
  CUSTOM_PROVIDER_PRESET,
  defaultPresetFor,
  healthErrorKey,
  isLocalPreset,
  LOCAL_PROVIDER_PRESETS,
  type ProviderPreset,
} from './provider-presets'

import './setup-guide.css'

/** What the first conversation still needs. Nothing is decided before the window knows the state. */
export function setupNeeded(state: WorkbenchState): boolean {
  return (state.bootstrapVersion ?? 0) > 0 && (!state.workspace || !state.provider)
}

type SetupClient = Pick<WorkbenchBridgeClient, 'setProvider' | 'healthProvider' | 'setDefaultProvider' | 'bootstrapProvider' | 'trustProvider' | 'refreshState' | 'openWorkspace' | 'switchWorkspacePath'>

const ALL_PRESETS = [...CLOUD_PROVIDER_PRESETS, ...LOCAL_PROVIDER_PRESETS, CUSTOM_PROVIDER_PRESET]

function ModelStep({ client, onReady, onOpenSettings }: { client: SetupClient; onReady: (name: string) => void; onOpenSettings?: () => void }) {
  const { t, locale } = useOptionalI18n()
  const noteId = useId()
  const [preset, setPreset] = useState<ProviderPreset>(() => defaultPresetFor(locale))
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState(preset.model)
  const [baseUrl, setBaseUrl] = useState(preset.baseUrl)
  const [status, setStatus] = useState<'idle' | 'connecting'>('idle')
  const [error, setError] = useState<MessageKey | null>(null)
  const local = isLocalPreset(preset)
  const custom = preset.id === CUSTOM_PROVIDER_PRESET.id
  const nameOf = (item: ProviderPreset): string => (item.nameKey ? t(item.nameKey) : item.name)

  const choose = (id: string): void => {
    const next = ALL_PRESETS.find((item) => item.id === id)
    if (!next) return
    setPreset(next)
    setModel(next.model)
    setBaseUrl(next.baseUrl)
    setError(null)
  }

  const connect = async (): Promise<void> => {
    if (status === 'connecting') return
    const key = apiKey.trim()
    if (!local && !key && !custom) { setError('setup.error.keyNeeded'); return }
    if (!baseUrl.trim()) { setError('setup.error.addressNeeded'); return }
    if (!model.trim()) { setError('setup.error.modelNeeded'); return }
    setError(null)
    setStatus('connecting')
    try {
      const saved = await client.setProvider({
        providerId: preset.id,
        name: custom ? t('setup.customName') : nameOf(preset),
        protocol: preset.protocol,
        baseUrl: baseUrl.trim(),
        model: model.trim(),
        ...(key ? { apiKey: key } : {}),
      })
      if (saved.type !== 'provider.set.result') throw new Error('save_failed')
      const health = (await client.healthProvider(preset.id)).payload as { ok?: unknown; errorCode?: unknown }
      if (health.ok !== true) {
        setError(healthErrorKey(typeof health.errorCode === 'string' ? health.errorCode : null))
        return
      }
      const applied = await client.setDefaultProvider(preset.id)
      if (applied.type !== 'provider.default.result') throw new Error('default_failed')
      // The service just chosen is where conversations go: they need not ask again each time.
      await client.trustProvider(baseUrl.trim()).catch(() => undefined)
      setApiKey('')
      await client.refreshState()
      onReady(custom ? t('setup.customName') : nameOf(preset))
    } catch {
      setError('setup.error.failed')
    } finally {
      setStatus('idle')
    }
  }

  return (
    <form className="setup-form" onSubmit={(event) => { event.preventDefault(); void connect() }}>
      <label className="setup-field">
        <span>{t('setup.provider')}</span>
        <select value={preset.id} disabled={status === 'connecting'} aria-describedby={noteId} onChange={(event) => choose(event.target.value)}>
          <optgroup label={t('setup.group.cloud')}>
            {CLOUD_PROVIDER_PRESETS.map((item) => <option key={item.id} value={item.id}>{nameOf(item)}</option>)}
          </optgroup>
          <optgroup label={t('setup.group.local')}>
            {LOCAL_PROVIDER_PRESETS.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </optgroup>
          <optgroup label={t('setup.group.other')}>
            <option value={CUSTOM_PROVIDER_PRESET.id}>{t('setup.customName')}</option>
          </optgroup>
        </select>
        <small id={noteId}>{t(preset.note)}</small>
      </label>
      {custom || local ? (
        <label className="setup-field">
          <span>{t('setup.address')}</span>
          <input type="text" inputMode="url" spellCheck={false} placeholder="https://" value={baseUrl} disabled={status === 'connecting'} onChange={(event) => setBaseUrl(event.target.value)} />
        </label>
      ) : null}
      {local ? null : (
        <label className="setup-field">
          <span className="setup-field-title">
            {t('settings.provider.apiKey')}
            {preset.keyUrl ? (
              <a href={preset.keyUrl} onClick={(event) => { event.preventDefault(); void window.agentWorkspace?.openExternal?.(preset.keyUrl!) }}>
                {t('setup.getKey')}<ExternalLink size={11} aria-hidden="true" />
              </a>
            ) : null}
          </span>
          <input type="password" autoComplete="new-password" spellCheck={false} placeholder={t('settings.provider.apiKeyPlaceholder')} value={apiKey} disabled={status === 'connecting'} onChange={(event) => setApiKey(event.target.value)} />
          <small>{t('setup.keyStored')}</small>
        </label>
      )}
      <label className="setup-field">
        <span>{t('settings.provider.model')}</span>
        <input type="text" spellCheck={false} placeholder={t('setup.modelPlaceholder')} value={model} disabled={status === 'connecting'} onChange={(event) => setModel(event.target.value)} />
      </label>
      {error ? <p className="setup-error" role="alert">{t(error)}</p> : null}
      <div className="provider-actions setup-actions">
        <button type="submit" className="provider-primary" disabled={status === 'connecting'} aria-busy={status === 'connecting'}>
          {status === 'connecting' ? <LoaderCircle className="provider-spinner" size={14} aria-hidden="true" /> : <Plug size={14} aria-hidden="true" />}
          <span>{t(status === 'connecting' ? 'setup.connecting' : 'setup.connect')}</span>
        </button>
        {onOpenSettings ? (
          <button type="button" className="provider-secondary" onClick={onOpenSettings}>
            <SettingsIcon size={14} aria-hidden="true" />
            <span>{t('setup.moreSettings')}</span>
          </button>
        ) : null}
      </div>
    </form>
  )
}

function FolderStep({ client }: { client: SetupClient }) {
  const { t } = useOptionalI18n()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const host = window.agentWorkspace?.desktop

  const run = async (open: () => Promise<unknown>): Promise<void> => {
    if (busy) return
    setBusy(true)
    setError(false)
    try {
      await open()
    } catch {
      setError(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="setup-form">
      <p className="setup-text">{t('setup.folder.body')}</p>
      {error ? <p className="setup-error" role="alert">{t('setup.folder.failed')}</p> : null}
      <div className="provider-actions setup-actions">
        <button type="button" className="provider-primary" disabled={busy} onClick={() => void run(() => client.openWorkspace())}>
          <FolderOpen size={14} aria-hidden="true" />
          <span>{t('setup.folder.choose')}</span>
        </button>
        {host?.defaultWorkspaceFolder ? (
          <button
            type="button"
            className="provider-secondary"
            disabled={busy}
            aria-busy={busy}
            onClick={() => void run(async () => {
              const folder = await host.defaultWorkspaceFolder()
              if (!folder) throw new Error('folder_unavailable')
              await client.switchWorkspacePath(folder)
            })}
          >
            {busy ? <LoaderCircle className="provider-spinner" size={14} aria-hidden="true" /> : <FolderPlus size={14} aria-hidden="true" />}
            <span>{t('setup.folder.default')}</span>
          </button>
        ) : null}
      </div>
    </div>
  )
}

/**
 * The first screen of a new install: a model that can answer and a folder to work in. It stands
 * where the conversation will be, and goes away by itself when both are there.
 */
export function SetupGuide({ state, client, onOpenSettings }: { state: WorkbenchState; client: SetupClient; onOpenSettings?: () => void }) {
  const { t } = useOptionalI18n()
  const [readyName, setReadyName] = useState<string | null>(null)
  const providerName = typeof state.provider?.name === 'string' ? state.provider.name : null
  const modelReady = Boolean(state.provider) || readyName !== null

  // With no folder open yet the window has no provider either; the saved default still counts.
  useEffect(() => {
    if (state.provider) return undefined
    let active = true
    void client.bootstrapProvider().then((response) => {
      const payload = response.payload as { ready?: unknown; provider?: { name?: unknown } | null }
      if (active && payload.ready === true && typeof payload.provider?.name === 'string') setReadyName(payload.provider.name)
    }).catch(() => undefined)
    return () => { active = false }
  }, [client, state.provider])

  return (
    <div className="setup-guide" data-testid="setup-guide">
      <header>
        <h1>{t('setup.title')}</h1>
        <p>{t('setup.lead')}</p>
      </header>
      <section className="setup-step" data-done={modelReady ? 'true' : 'false'} data-testid="setup-step-model" aria-labelledby="setup-model-title">
        <h2 id="setup-model-title">
          {modelReady ? <CheckCircle2 size={16} aria-hidden="true" /> : <span className="setup-step-number" aria-hidden="true">1</span>}
          {modelReady ? t('setup.model.done', { name: providerName ?? readyName ?? '' }) : t('setup.model.title')}
        </h2>
        {modelReady ? null : <ModelStep client={client} onReady={setReadyName} onOpenSettings={onOpenSettings} />}
      </section>
      <section className="setup-step" data-done={state.workspace ? 'true' : 'false'} data-testid="setup-step-folder" aria-labelledby="setup-folder-title">
        <h2 id="setup-folder-title">
          {state.workspace ? <CheckCircle2 size={16} aria-hidden="true" /> : <span className="setup-step-number" aria-hidden="true">2</span>}
          {t('setup.folder.title')}
        </h2>
        {state.workspace ? null : <FolderStep client={client} />}
      </section>
    </div>
  )
}

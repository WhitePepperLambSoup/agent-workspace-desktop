import { Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'

import { PROVIDER_PROTOCOLS, type ProviderProfile, type ProviderProtocol, type UiResponse } from '../../../shared/api'
import type { WorkbenchBridgeClient } from '../bridge/client'
import { useI18n, type I18nValue } from '../i18n/I18nProvider'
import type { WorkbenchState } from '../state/workbench-store'
import { readPromptOptimizationSelection, writePromptOptimizationSelection } from '../composer/promptOptimization'

interface PromptOptimizationSettingsProps {
  state: WorkbenchState
  client?: Pick<WorkbenchBridgeClient, 'listProviders'>
  i18n?: I18nValue
}

function parseProfiles(response: UiResponse): ProviderProfile[] {
  if (response.type !== 'provider.list.result' || !Array.isArray(response.payload.providers)) return []
  return (response.payload.providers as unknown[]).flatMap((item): ProviderProfile[] => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return []
    const profile = item as Record<string, unknown>
    const protocol = profile.protocol
    if (typeof profile.id !== 'string' || typeof profile.name !== 'string' ||
        typeof profile.baseUrl !== 'string' || typeof profile.model !== 'string' ||
        typeof profile.isDefault !== 'boolean' || typeof profile.hasCredential !== 'boolean' ||
        typeof protocol !== 'string' || !PROVIDER_PROTOCOLS.includes(protocol as ProviderProtocol)) return []
    return [{
      id: profile.id,
      name: profile.name,
      protocol: protocol as ProviderProtocol,
      baseUrl: profile.baseUrl,
      model: profile.model,
      isDefault: profile.isDefault,
      hasCredential: profile.hasCredential,
    }]
  })
}

function PromptOptimizationSettingsView({ state, client, i18n }: PromptOptimizationSettingsProps & { i18n: I18nValue }) {
  const { t } = i18n
  const [profiles, setProfiles] = useState<ProviderProfile[]>([])
  const [selection, setSelection] = useState(() => readPromptOptimizationSelection())
  const [loading, setLoading] = useState(false)
  const [unavailable, setUnavailable] = useState(false)

  useEffect(() => {
    if (!client) {
      setProfiles([])
      setUnavailable(true)
      return
    }
    let active = true
    setLoading(true)
    void client.listProviders().then((response) => {
      if (!active) return
      const nextProfiles = parseProfiles(response)
      setProfiles(nextProfiles)
      setUnavailable(response.type !== 'provider.list.result')
      const stored = readPromptOptimizationSelection()
      if (stored && !nextProfiles.some((profile) => profile.id === stored.providerId && profile.model === stored.model && profile.hasCredential)) {
        writePromptOptimizationSelection(null)
        setSelection(null)
      }
    }).catch(() => {
      if (active) setUnavailable(true)
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => { active = false }
  }, [client])

  const currentValue = selection ? `provider:${selection.providerId}:${selection.model}` : 'conversation'
  const choose = (value: string): void => {
    if (value === 'conversation') {
      writePromptOptimizationSelection(null)
      setSelection(null)
      return
    }
    const profile = profiles.find((item) => `provider:${item.id}:${item.model}` === value)
    if (!profile) return
    const next = { providerId: profile.id, model: profile.model }
    writePromptOptimizationSelection(next)
    setSelection(next)
  }

  return (
    <section className="settings-section" aria-labelledby="prompt-optimization-settings-title">
      <header className="settings-section-header">
        <Sparkles size={16} aria-hidden="true" />
        <div>
          <h2 id="prompt-optimization-settings-title">{t('settings.promptOptimization.title')}</h2>
          <p>{t('settings.promptOptimization.description')}</p>
        </div>
      </header>
      <div className="settings-row">
        <div className="setting-label">
          <strong>{t('settings.promptOptimization.model')}</strong>
          <span>{state.provider?.id && state.provider?.model ? `${state.provider.id} · ${state.provider.model}` : t('settings.promptOptimization.followConversation')}</span>
        </div>
        <select
          className="provider-select"
          aria-label={t('settings.promptOptimization.model')}
          value={currentValue}
          disabled={!client || loading}
          onChange={(event) => choose(event.currentTarget.value)}
        >
          <option value="conversation">{t('settings.promptOptimization.followConversation')}</option>
          {profiles.filter((profile) => profile.hasCredential).map((profile) => (
            <option key={`${profile.id}:${profile.model}`} value={`provider:${profile.id}:${profile.model}`}>
              {profile.name} ({profile.id}) · {profile.model}
            </option>
          ))}
        </select>
      </div>
      {loading ? <p className="settings-note" role="status">{t('settings.promptOptimization.loading')}</p> : null}
      {unavailable ? <p className="settings-note" role="status">{t('settings.promptOptimization.unavailable')}</p> : null}
    </section>
  )
}

export function PromptOptimizationSettings(props: PromptOptimizationSettingsProps) {
  return props.i18n
    ? <PromptOptimizationSettingsView {...props} i18n={props.i18n} />
    : <PromptOptimizationSettingsView {...props} i18n={useI18n()} />
}

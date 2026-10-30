import { Mic } from 'lucide-react'
import { useEffect, useId, useState } from 'react'

import type { WorkbenchBridgeClient } from '../bridge/client'
import { useI18n, type I18nValue } from '../i18n/I18nProvider'
import { useVoicePreference, writeVoicePreference } from '../voice/voice'

interface Profile { id: string; name: string }

function compatibleProfiles(payload: unknown): Profile[] {
  const providers = payload && typeof payload === 'object' ? (payload as { providers?: unknown }).providers : null
  if (!Array.isArray(providers)) return []
  return providers.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const record = item as Record<string, unknown>
    return record.protocol === 'openai-compatible' && typeof record.id === 'string' && typeof record.name === 'string'
      ? [{ id: record.id, name: record.name }]
      : []
  })
}

function VoiceSettingsView({ client, i18n }: { client?: Pick<WorkbenchBridgeClient, 'listProviders'>; i18n: I18nValue }) {
  const { t } = i18n
  const preference = useVoicePreference()
  const [profiles, setProfiles] = useState<Profile[] | null>(null)
  const [model, setModel] = useState(preference.model)
  const profileId = useId()
  const modelId = useId()

  useEffect(() => { setModel(preference.model) }, [preference.model])
  useEffect(() => {
    if (!client?.listProviders) return
    let active = true
    client.listProviders()
      .then((response) => { if (active) setProfiles(compatibleProfiles(response.payload)) })
      .catch(() => { if (active) setProfiles([]) })
    return () => { active = false }
  }, [client])

  return (
    <section className="settings-section voice-settings" aria-labelledby="voice-heading">
      <header className="doctor-header">
        <div>
          <h2 id="voice-heading">{t('settings.voice.title')}</h2>
          <p>{t('settings.voice.description')}</p>
        </div>
        <Mic size={16} aria-hidden="true" />
      </header>
      <div className="voice-settings-fields">
        <label className="provider-field" htmlFor={profileId}>
          <span>{t('settings.voice.profile')}</span>
          <select id={profileId} value={preference.providerId ?? ''} disabled={!profiles}
            onChange={(event) => writeVoicePreference({ providerId: event.target.value || null, model: model.trim() || 'whisper-1' })}>
            <option value="">{t('settings.voice.off')}</option>
            {(profiles ?? []).map((profile) => <option key={profile.id} value={profile.id}>{profile.name} ({profile.id})</option>)}
          </select>
        </label>
        <label className="provider-field" htmlFor={modelId}>
          <span>{t('settings.voice.model')}</span>
          <input id={modelId} value={model} maxLength={200} spellCheck={false} disabled={!preference.providerId}
            onChange={(event) => setModel(event.target.value)}
            onBlur={() => writeVoicePreference({ ...preference, model: model.trim() || 'whisper-1' })} />
        </label>
      </div>
      {profiles && profiles.length === 0 ? <p className="provider-hint">{t('settings.voice.noProfiles')}</p> : null}
      <p className="provider-hint">{t('settings.voice.privacy')}</p>
      <p className="provider-hint">{t('settings.voice.meetings')}</p>
    </section>
  )
}

function LocalizedVoiceSettings({ client }: { client?: Pick<WorkbenchBridgeClient, 'listProviders'> }) {
  return <VoiceSettingsView client={client} i18n={useI18n()} />
}

export function VoiceSettings({ client, i18n }: { client?: Pick<WorkbenchBridgeClient, 'listProviders'>; i18n?: I18nValue }) {
  return i18n ? <VoiceSettingsView client={client} i18n={i18n} /> : <LocalizedVoiceSettings client={client} />
}

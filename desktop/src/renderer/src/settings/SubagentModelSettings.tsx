import { Network } from 'lucide-react'
import { useEffect, useId, useState } from 'react'

import type { WorkbenchBridgeClient } from '../bridge/client'
import { useI18n, type I18nValue } from '../i18n/I18nProvider'

type SubagentClient = Pick<WorkbenchBridgeClient, 'subagentModel' | 'setSubagentModel'>

const EFFORTS = ['off', 'low', 'medium', 'high', 'xhigh', 'max'] as const
type Effort = (typeof EFFORTS)[number]

interface Profile {
  id: string
  name: string
  model: string
}

interface SubagentDocument {
  /** A saved provider profile, or null for the conversation's. */
  providerId: string | null
  /** Another model on that profile's provider, or null for the profile's own. */
  model: string | null
  /** null follows the effort of the turn that hands out the work. */
  effort: Effort | null
  /** What the sub-agents' model offers. */
  efforts: Effort[]
  providers: Profile[]
  /** The model just chosen does not offer the effort that was set, so it follows again. */
  effortReset: boolean
}

const isEffort = (value: unknown): value is Effort => typeof value === 'string' && (EFFORTS as readonly string[]).includes(value)

function documentFrom(payload: Record<string, unknown>): SubagentDocument | null {
  const text = (value: unknown): string | null => (typeof value === 'string' && value ? value : null)
  if (!Array.isArray(payload.providers) || !Array.isArray(payload.supportedReasoningEfforts)) return null
  const providers = payload.providers.flatMap((item): Profile[] => {
    if (!item || typeof item !== 'object') return []
    const { id, name, model } = item as Record<string, unknown>
    return typeof id === 'string' && typeof name === 'string' && typeof model === 'string' ? [{ id, name, model }] : []
  })
  return {
    providerId: text(payload.providerId),
    model: text(payload.model),
    effort: isEffort(payload.effort) ? payload.effort : null,
    efforts: payload.supportedReasoningEfforts.filter(isEffort),
    providers,
    effortReset: payload.effortReset === true,
  }
}

function SubagentModelSettingsView({ client, i18n }: { client?: SubagentClient; i18n: I18nValue }) {
  const { t } = i18n
  const [document, setDocument] = useState<SubagentDocument | null>(null)
  const [model, setModel] = useState('')
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'reset' | 'failed' | 'unavailable'>('idle')
  const providerField = useId()
  const modelField = useId()
  const effortField = useId()

  const take = (next: SubagentDocument): void => {
    setDocument(next)
    setModel(next.model ?? '')
  }

  useEffect(() => {
    if (!client) return
    let active = true
    client.subagentModel()
      .then((response) => {
        if (!active) return
        const next = response.type === 'subagents.model.get.result' ? documentFrom(response.payload) : null
        if (next) take(next)
        else setStatus('unavailable')
      })
      .catch(() => { if (active) setStatus('unavailable') })
    return () => { active = false }
  }, [client])

  const profile = document?.providers.find((item) => item.id === document.providerId) ?? null

  const save = (change: { providerId?: string | null; model?: string | null; effort?: Effort | null }): void => {
    if (!client || !document) return
    const next = { providerId: document.providerId, model: document.model, effort: document.effort as string | null, ...change }
    setStatus('saving')
    client.setSubagentModel(next)
      .then((response) => {
        const saved = response.type === 'subagents.model.set.result' ? documentFrom(response.payload) : null
        if (!saved) throw new Error('subagents.model.set')
        take(saved)
        setStatus(saved.effortReset ? 'reset' : 'saved')
      })
      .catch(() => {
        setModel(document.model ?? '')
        setStatus('failed')
      })
  }

  /** The model field is kept on leaving it or on Enter; blank or the profile's own model is no override. */
  const commitModel = (): void => {
    if (!profile) return
    const typed = model.trim()
    const next = typed && typed !== profile.model ? typed : null
    if (next !== document?.model) save({ model: next })
  }

  const busy = !document || status === 'saving'
  const statusText = status === 'saved' ? t('settings.subagents.saved')
    : status === 'reset' ? t('settings.subagents.effortReset')
    : status === 'failed' ? t('settings.subagents.failed')
    : status === 'unavailable' ? t('settings.subagents.unavailable')
    : null

  return (
    <section className="settings-section subagent-model-settings" aria-labelledby="subagent-model-heading">
      <header className="doctor-header">
        <div>
          <h2 id="subagent-model-heading">{t('settings.subagents.title')}</h2>
          <p>{t('settings.subagents.description')}</p>
        </div>
        <Network size={16} aria-hidden="true" />
      </header>
      <div className="voice-settings-fields">
        <label className="provider-field" htmlFor={providerField}>
          <span>{t('settings.subagents.model')}</span>
          <select id={providerField} value={document?.providerId ?? ''} disabled={busy}
            onChange={(event) => save({ providerId: event.target.value || null, model: null })}>
            <option value="">{t('settings.subagents.follow')}</option>
            {document?.providers.map((item) => <option key={item.id} value={item.id}>{`${item.name} · ${item.model}`}</option>)}
          </select>
        </label>
        {profile ? (
          <label className="provider-field" htmlFor={modelField}>
            <span>{t('settings.subagents.modelId')}</span>
            <input id={modelField} value={model} placeholder={profile.model} spellCheck={false} autoComplete="off" disabled={busy}
              onChange={(event) => { setModel(event.target.value); setStatus('idle') }}
              onBlur={commitModel}
              onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commitModel() } }} />
          </label>
        ) : null}
        <label className="provider-field" htmlFor={effortField}>
          <span>{t('settings.subagents.effort')}</span>
          <select id={effortField} value={document?.effort ?? ''} disabled={busy || document.efforts.length === 0}
            onChange={(event) => save({ effort: isEffort(event.target.value) ? event.target.value : null })}>
            <option value="">{t('settings.subagents.follow')}</option>
            {document?.efforts.map((effort) => <option key={effort} value={effort}>{t(`settings.subagents.effort.${effort}`)}</option>)}
          </select>
        </label>
      </div>
      {statusText ? (
        <p className={`provider-status${status === 'saved' ? ' provider-status-success' : status === 'reset' ? '' : ' provider-status-error'}`} role="status">{statusText}</p>
      ) : null}
      {document ? (
        <p className="provider-hint">{document.efforts.length === 0 ? t('settings.subagents.noEfforts') : t('settings.subagents.hint')}</p>
      ) : null}
    </section>
  )
}

function LocalizedSubagentModelSettings({ client }: { client?: SubagentClient }) {
  return <SubagentModelSettingsView client={client} i18n={useI18n()} />
}

export function SubagentModelSettings({ client, i18n }: { client?: SubagentClient; i18n?: I18nValue }) {
  return i18n ? <SubagentModelSettingsView client={client} i18n={i18n} /> : <LocalizedSubagentModelSettings client={client} />
}

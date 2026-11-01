import { ShieldCheck, X } from 'lucide-react'
import { useEffect, useState } from 'react'

import type { WorkbenchBridgeClient } from '../bridge/client'
import { useI18n, type I18nValue } from '../i18n/I18nProvider'
import type { MessageKey } from '../i18n/messages'
import type { WorkbenchState } from '../state/workbench-store'
import { confirmAutonomyChange } from './autonomy'

type Autonomy = 'ask' | 'workspace' | 'yolo' | 'full_access'
const AUTONOMY_VALUES: readonly Autonomy[] = ['ask', 'workspace', 'yolo', 'full_access']
const LABEL_KEYS: Record<Autonomy, MessageKey> = {
  ask: 'settings.autonomy.ask',
  workspace: 'settings.autonomy.workspace',
  yolo: 'settings.autonomy.yolo',
  full_access: 'settings.autonomy.fullAccess',
}
const HELP_KEYS: Record<Autonomy, MessageKey> = {
  ask: 'settings.autonomy.askHelp',
  workspace: 'settings.autonomy.workspaceHelp',
  yolo: 'settings.autonomy.yoloHelp',
  full_access: 'settings.autonomy.fullAccessHelp',
}

interface AutonomySettingsProps {
  state: WorkbenchState
  client?: Pick<WorkbenchBridgeClient, 'setAutonomy'> & Partial<Pick<WorkbenchBridgeClient, 'trustedProviders' | 'distrustProvider'>>
  i18n?: I18nValue
}

/** The model services conversations send to without asking; each can be asked about again. */
function TrustedProviders({ client, i18n }: { client: Required<Pick<NonNullable<AutonomySettingsProps['client']>, 'trustedProviders' | 'distrustProvider'>>; i18n: I18nValue }) {
  const { t } = i18n
  const [origins, setOrigins] = useState<readonly string[]>([])
  const load = (reply: { payload: Record<string, unknown> }): void => {
    const list = reply.payload.origins
    setOrigins(Array.isArray(list) ? list.filter((item): item is string => typeof item === 'string') : [])
  }
  useEffect(() => {
    let active = true
    void client.trustedProviders().then((reply) => { if (active) load(reply) }, () => undefined)
    return () => { active = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once for this client
  }, [client])
  if (origins.length === 0) return null
  return (
    <div className="settings-row trusted-providers" data-testid="trusted-providers">
      <div className="setting-label">
        <strong>{t('settings.autonomy.trusted')}</strong>
        <span>{t('settings.autonomy.trustedHelp')}</span>
      </div>
      <ul className="data-backups">
        {origins.map((origin) => (
          <li key={origin}>
            <span>{origin}</span>
            <span />
            <span className="provider-actions">
              <button type="button" aria-label={t('settings.autonomy.trustedRemove', { origin })} onClick={() => void client.distrustProvider(origin).then(load, () => undefined)}>
                <X size={13} aria-hidden="true" />
                <span>{t('settings.autonomy.trustedAsk')}</span>
              </button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function AutonomySettingsView({ state, client, i18n }: AutonomySettingsProps & { i18n: I18nValue }) {
  const { t } = i18n
  const [changing, setChanging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const current = AUTONOMY_VALUES.includes(state.runtime.autonomy as Autonomy)
    ? state.runtime.autonomy as Autonomy
    : 'workspace'
  const selected = (state.runtime.pendingAutonomy as Autonomy | null) ?? current
  const disabled = !client || !state.selectedSession || state.runtime.activeTurn !== null || changing

  const change = async (autonomy: Autonomy): Promise<void> => {
    if (!client || disabled || autonomy === current) return
    const confirmation = autonomy === 'full_access'
      ? t('settings.autonomy.fullAccessConfirmation')
      : t('settings.autonomy.yoloConfirmation')
    if (!confirmAutonomyChange(autonomy, confirmation)) return
    setChanging(true)
    setError(null)
    try {
      await client.setAutonomy(autonomy)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'runtime_start_failed')
    } finally {
      setChanging(false)
    }
  }

  return (
    <section className="settings-section" aria-labelledby="autonomy-settings-title">
      <header className="settings-section-header">
        <ShieldCheck size={16} />
        <div>
          <h2 id="autonomy-settings-title">{t('settings.autonomy.title')}</h2>
          <p>{t('settings.autonomy.description')}</p>
        </div>
      </header>
      <div className="settings-row">
        <div className="setting-label">
          <strong>{t('settings.autonomy.policy')}</strong>
          <span>{t(HELP_KEYS[selected])}</span>
        </div>
        <div className="segmented-control autonomy-segments" role="radiogroup" aria-label={t('runtime.autonomyPolicy')}>
          {AUTONOMY_VALUES.map((autonomy) => (
            <button
              key={autonomy}
              type="button"
              role="radio"
              aria-checked={selected === autonomy}
              disabled={disabled}
              onClick={() => void change(autonomy)}
            >
              {t(LABEL_KEYS[autonomy])}
            </button>
          ))}
        </div>
      </div>
      {client?.trustedProviders && client.distrustProvider ? <TrustedProviders client={client as never} i18n={i18n} /> : null}
      {state.runtime.activeTurn !== null ? <p className="settings-note">{t('settings.autonomy.busy')}</p> : null}
      {error ? <p className="route-error" role="status">{t('settings.autonomy.failed')}: {t(error === 'runtime_busy' ? 'settings.autonomy.busyNow' : error === 'session_not_active' ? 'settings.autonomy.sessionInactive' : error === 'runtime_start_failed' ? 'settings.autonomy.runtimeStartFailed' : 'settings.autonomy.tryAgain')}</p> : null}
    </section>
  )
}

export function AutonomySettings(props: AutonomySettingsProps) {
  return props.i18n
    ? <AutonomySettingsView {...props} i18n={props.i18n} />
    : <AutonomySettingsView {...props} i18n={useI18n()} />
}

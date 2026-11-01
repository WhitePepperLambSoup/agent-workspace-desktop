import { MonitorDown } from 'lucide-react'
import { useEffect, useId, useState } from 'react'

import type { DesktopHostApi } from '../../../shared/api'
import type { BackgroundSettings as Settings } from '../../../shared/desktop'
import { useI18n, type I18nValue } from '../i18n/I18nProvider'
import type { MessageKey } from '../i18n/messages'

const CLOSE_LABELS: Record<Settings['closeAction'], MessageKey> = {
  ask: 'settings.background.close.ask',
  background: 'settings.background.close.background',
  quit: 'settings.background.close.quit',
}

function BackgroundSettingsView({ host, i18n }: { host: DesktopHostApi; i18n: I18nValue }) {
  const { t } = i18n
  const closeId = useId()
  const loginId = useId()
  const awakeId = useId()
  const [settings, setSettings] = useState<Settings | null>(null)
  const [canOpenAtLogin, setCanOpenAtLogin] = useState(false)

  useEffect(() => {
    let active = true
    void host.getBackgroundSettings().then((current) => {
      if (!active) return
      setSettings(current.settings)
      setCanOpenAtLogin(current.canOpenAtLogin)
    }).catch(() => undefined)
    return () => { active = false }
  }, [host])

  if (!settings) return null

  const change = (next: Partial<Settings>): void => {
    const wanted = { ...settings, ...next }
    setSettings(wanted)
    void host.setBackgroundSettings(wanted).then((saved) => { if (saved) setSettings(saved) }).catch(() => undefined)
  }

  return (
    <section className="settings-section background-settings" aria-labelledby="background-heading">
      <header className="doctor-header">
        <div>
          <h2 id="background-heading">{t('settings.background.title')}</h2>
          <p>{t('settings.background.description')}</p>
        </div>
        <MonitorDown size={16} aria-hidden="true" />
      </header>
      <div className="settings-row">
        <label className="setting-label" htmlFor={closeId}><strong>{t('settings.background.close')}</strong></label>
        <select id={closeId} value={settings.closeAction} onChange={(event) => change({ closeAction: event.target.value as Settings['closeAction'] })}>
          {(['ask', 'background', 'quit'] as const).map((action) => <option key={action} value={action}>{t(CLOSE_LABELS[action])}</option>)}
        </select>
      </div>
      {canOpenAtLogin ? (
        <label className="settings-toggle" htmlFor={loginId}>
          <input id={loginId} type="checkbox" role="switch" checked={settings.openAtLogin} onChange={(event) => change({ openAtLogin: event.target.checked })} />
          <span>{t('settings.background.openAtLogin')}</span>
        </label>
      ) : null}
      <label className="settings-toggle" htmlFor={awakeId}>
        <input id={awakeId} type="checkbox" role="switch" checked={settings.keepAwake} onChange={(event) => change({ keepAwake: event.target.checked })} />
        <span>{t('settings.background.keepAwake')}</span>
      </label>
    </section>
  )
}

function LocalizedBackgroundSettings({ host }: { host: DesktopHostApi }) {
  return <BackgroundSettingsView host={host} i18n={useI18n()} />
}

/** Rendered only inside the desktop app. */
export function BackgroundSettings({ host, i18n }: { host?: DesktopHostApi; i18n?: I18nValue }) {
  if (!host) return null
  return i18n ? <BackgroundSettingsView host={host} i18n={i18n} /> : <LocalizedBackgroundSettings host={host} />
}

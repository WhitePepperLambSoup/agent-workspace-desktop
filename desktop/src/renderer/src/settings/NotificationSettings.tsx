import { Bell } from 'lucide-react'
import { useId } from 'react'

import { setNotificationsEnabled, useNotificationsEnabled } from '../notifications/attention'
import { useI18n, type I18nValue } from '../i18n/I18nProvider'

function NotificationSettingsView({ i18n }: { i18n: I18nValue }) {
  const { t } = i18n
  const enabled = useNotificationsEnabled()
  const toggleId = useId()
  return (
    <section className="settings-section notification-settings" aria-labelledby="notification-heading">
      <header className="doctor-header">
        <div>
          <h2 id="notification-heading">{t('settings.notifications.title')}</h2>
          <p>{t('settings.notifications.description')}</p>
        </div>
        <Bell size={16} aria-hidden="true" />
      </header>
      <label className="settings-toggle" htmlFor={toggleId}>
        <input id={toggleId} type="checkbox" role="switch" checked={enabled} onChange={(event) => setNotificationsEnabled(event.target.checked)} />
        <span>{t('settings.notifications.toggle')}</span>
      </label>
    </section>
  )
}

function LocalizedNotificationSettings() {
  return <NotificationSettingsView i18n={useI18n()} />
}

/** Rendered only inside the desktop app, where system notifications exist. */
export function NotificationSettings({ available, i18n }: { available: boolean; i18n?: I18nValue }) {
  if (!available) return null
  return i18n ? <NotificationSettingsView i18n={i18n} /> : <LocalizedNotificationSettings />
}

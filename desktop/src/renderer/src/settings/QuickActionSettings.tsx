import { RotateCcw, Zap } from 'lucide-react'
import { useEffect, useState, type KeyboardEvent } from 'react'

import { useI18n, type I18nValue } from '../i18n/I18nProvider'
import { DEFAULT_QUICK_SETTINGS, shortcutLabel, useQuickSettings, writeQuickSettings } from '../office/QuickActions'

const MODIFIERS = new Set(['Control', 'Alt', 'Shift', 'Meta'])

/** The pressed keys as an Electron accelerator ("Control+Alt+Q"); null for a lone modifier. */
export function acceleratorFrom(event: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>): string | null {
  if (MODIFIERS.has(event.key)) return null
  const parts: string[] = []
  if (event.ctrlKey) parts.push('Control')
  if (event.altKey) parts.push('Alt')
  if (event.shiftKey) parts.push('Shift')
  if (event.metaKey) parts.push('Super')
  // A shortcut without Ctrl or Alt would take an ordinary key from every program.
  if (!event.ctrlKey && !event.altKey && !event.metaKey) return null
  const key = /^Key[A-Z]$/.test(event.code) ? event.code.slice(3)
    : /^Digit[0-9]$/.test(event.code) ? event.code.slice(5)
      : /^F([1-9]|1[0-9]|2[0-4])$/.test(event.key) ? event.key
        : event.key === ' ' ? 'Space' : null
  return key ? [...parts, key].join('+') : null
}

function QuickActionSettingsView({ i18n }: { i18n: I18nValue }) {
  const { t } = i18n
  const settings = useQuickSettings()
  const [status, setStatus] = useState<{ ok: boolean; error?: string } | null>(null)
  const [recording, setRecording] = useState(false)

  useEffect(() => {
    const onStatus = (event: Event): void => setStatus((event as CustomEvent<{ ok: boolean; error?: string }>).detail)
    window.addEventListener('agent-workspace:quick-actions-status', onStatus)
    return () => window.removeEventListener('agent-workspace:quick-actions-status', onStatus)
  }, [])

  const capture = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key === 'Tab') return
    event.preventDefault()
    event.stopPropagation()
    if (event.key === 'Escape') { setRecording(false); return }
    const accelerator = acceleratorFrom(event)
    if (accelerator) {
      writeQuickSettings({ ...settings, accelerator })
      setRecording(false)
    }
  }

  const available = Boolean(window.agentWorkspace?.configureQuickActions)
  return (
    <section className="settings-section appearance-settings quick-action-settings" aria-labelledby="quick-heading">
      <header className="doctor-header">
        <div>
          <h2 id="quick-heading">{t('settings.quick.title')}</h2>
          <p>{t('settings.quick.description')}</p>
        </div>
        <Zap size={16} aria-hidden="true" />
      </header>

      <div className="settings-row compact-setting">
        <div className="setting-label">
          <strong>{t('settings.quick.enabled')}</strong>
          <span>{t('settings.quick.hint')}</span>
        </div>
        <label className="toggle-control">
          <input
            type="checkbox"
            aria-label={t('settings.quick.enabled')}
            checked={settings.enabled}
            disabled={!available}
            onChange={(event) => writeQuickSettings({ ...settings, enabled: event.target.checked })}
          />
          <span aria-hidden="true" />
        </label>
      </div>

      <div className="settings-row compact-setting">
        <div className="setting-label">
          <strong>{t('settings.quick.shortcut')}</strong>
          <span>{t('settings.quick.shortcutHint')}</span>
        </div>
        <div className="quick-shortcut-control">
          <button
            type="button"
            className="shortcut-capture"
            data-recording={recording ? 'true' : undefined}
            disabled={!available || !settings.enabled}
            aria-label={t('settings.quick.shortcut')}
            onClick={() => setRecording(!recording)}
            onKeyDown={recording ? capture : undefined}
            onBlur={() => setRecording(false)}
          >
            {recording ? t('settings.quick.press') : <kbd>{shortcutLabel(settings.accelerator)}</kbd>}
          </button>
          {settings.accelerator !== DEFAULT_QUICK_SETTINGS.accelerator ? (
            <button
              type="button"
              className="icon-button"
              aria-label={t('settings.quick.reset')}
              title={t('settings.quick.reset')}
              onClick={() => writeQuickSettings({ ...settings, accelerator: DEFAULT_QUICK_SETTINGS.accelerator })}
            >
              <RotateCcw size={13} />
            </button>
          ) : null}
        </div>
      </div>

      {status && !status.ok ? (
        <p className="provider-status provider-status-error" role="status">
          {t(status.error === 'taken' ? 'settings.quick.taken' : 'settings.quick.invalid')}
        </p>
      ) : null}
      {!available ? <p className="provider-hint">{t('settings.quick.unavailable')}</p> : null}
    </section>
  )
}

function LocalizedQuickActionSettings() {
  return <QuickActionSettingsView i18n={useI18n()} />
}

export function QuickActionSettings({ i18n }: { i18n?: I18nValue }) {
  return i18n ? <QuickActionSettingsView i18n={i18n} /> : <LocalizedQuickActionSettings />
}

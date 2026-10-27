import { Keyboard, RotateCcw } from 'lucide-react'
import { useState, type KeyboardEvent } from 'react'

import { useI18n, type I18nValue } from '../i18n/I18nProvider'
import type { MessageKey } from '../i18n/messages'
import {
  SHORTCUT_COMMANDS,
  readShortcutOverrides,
  resetShortcuts,
  setShortcut,
  shortcutFromEvent,
  shortcutOwner,
  shortcutProblem,
  useShortcuts,
} from '../shortcuts/keymap'

function ShortcutSettingsView({ i18n }: { i18n: I18nValue }) {
  const { t } = i18n
  const shortcuts = useShortcuts()
  const [recording, setRecording] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const titleOf = (id: string): string => {
    const command = SHORTCUT_COMMANDS.find((item) => item.id === id)
    return command ? t(command.titleKey) : id
  }

  const capture = (commandId: string, event: KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key === 'Tab') return
    event.preventDefault()
    event.stopPropagation()
    if (event.key === 'Escape') {
      setRecording(null)
      setMessage(null)
      return
    }
    if ((event.key === 'Backspace' || event.key === 'Delete') && !event.ctrlKey && !event.altKey && !event.metaKey) {
      setShortcut(commandId, null)
      setRecording(null)
      setMessage(null)
      return
    }
    const shortcut = shortcutFromEvent(event)
    if (!shortcut) return
    const problem = shortcutProblem(shortcut)
    if (problem) {
      setMessage(t(problem === 'reserved' ? 'settings.shortcuts.reserved' : 'settings.shortcuts.needsModifier', { shortcut }))
      return
    }
    const owner = shortcutOwner(shortcut, readShortcutOverrides(), commandId)
    if (owner) {
      setMessage(t('settings.shortcuts.inUse', { shortcut, command: titleOf(owner) }))
      return
    }
    setShortcut(commandId, shortcut)
    setRecording(null)
    setMessage(null)
  }

  return (
    <section className="settings-section shortcut-settings" aria-labelledby="shortcut-heading">
      <header className="doctor-header">
        <div>
          <h2 id="shortcut-heading">{t('settings.shortcuts.title')}</h2>
          <p>{t('settings.shortcuts.description')}</p>
        </div>
        <Keyboard size={16} aria-hidden="true" />
      </header>
      <table className="shortcut-table">
        <thead><tr><th scope="col">{t('settings.shortcuts.command')}</th><th scope="col">{t('settings.shortcuts.keys')}</th></tr></thead>
        <tbody>
          {SHORTCUT_COMMANDS.map((command) => {
            const current = shortcuts[command.id]
            const active = recording === command.id
            return (
              <tr key={command.id}>
                <th scope="row">{t(command.titleKey as MessageKey)}</th>
                <td>
                  <button type="button" className="shortcut-capture" data-recording={active ? 'true' : undefined}
                    aria-label={t('settings.shortcuts.change', { command: t(command.titleKey) })}
                    onClick={() => { setRecording(active ? null : command.id); setMessage(null) }}
                    onKeyDown={active ? (event) => capture(command.id, event) : undefined}
                    onBlur={() => { if (active) setRecording(null) }}>
                    {active ? t('settings.shortcuts.pressKeys') : current ? <kbd>{current}</kbd> : <span className="shortcut-none">{t('settings.shortcuts.none')}</span>}
                  </button>
                  {current !== command.defaultShortcut ? (
                    <button type="button" className="icon-button" aria-label={t('settings.shortcuts.resetOne', { command: t(command.titleKey) })}
                      title={t('settings.shortcuts.resetOne', { command: t(command.titleKey) })} onClick={() => setShortcut(command.id, command.defaultShortcut)}>
                      <RotateCcw size={13} />
                    </button>
                  ) : null}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {message ? <p className="route-error" role="alert">{message}</p> : null}
      <div className="provider-actions">
        <button type="button" onClick={() => { resetShortcuts(); setMessage(null) }}><RotateCcw size={14} aria-hidden="true" />{t('settings.shortcuts.resetAll')}</button>
      </div>
    </section>
  )
}

function LocalizedShortcutSettings() {
  return <ShortcutSettingsView i18n={useI18n()} />
}

export function ShortcutSettings({ i18n }: { i18n?: I18nValue }) {
  return i18n ? <ShortcutSettingsView i18n={i18n} /> : <LocalizedShortcutSettings />
}

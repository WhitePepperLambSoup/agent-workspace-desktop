import type { I18nValue } from '../i18n/I18nProvider'
import type { InterfaceMode } from '../workbench/interface-mode'

const MODES: readonly InterfaceMode[] = ['simple', 'full']

export function InterfaceSettings({ mode, onChange, i18n }: { mode: InterfaceMode; onChange: (mode: InterfaceMode) => void; i18n: I18nValue }) {
  const { t } = i18n
  return (
    <section className="settings-section interface-settings" aria-labelledby="interface-heading">
      <h2 id="interface-heading">{t('settings.interface.title')}</h2>
      <div className="settings-row">
        <div className="setting-label">
          <strong>{t('settings.interface.title')}</strong>
          <span>{t('settings.interface.description')}</span>
        </div>
        <div className="segmented-control interface-segments" role="radiogroup" aria-label={t('settings.interface.title')}>
          {MODES.map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={mode === value}
              tabIndex={mode === value ? 0 : -1}
              className={mode === value ? 'is-selected' : undefined}
              onKeyDown={(event) => {
                if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
                event.preventDefault()
                const next = value === 'simple' ? 'full' : 'simple'
                onChange(next)
                const sibling = event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`button:nth-child(${MODES.indexOf(next) + 1})`)
                sibling?.focus()
              }}
              onClick={() => onChange(value)}
            >
              {t(value === 'simple' ? 'settings.interface.simple' : 'settings.interface.full')}
            </button>
          ))}
        </div>
      </div>
    </section>
  )
}

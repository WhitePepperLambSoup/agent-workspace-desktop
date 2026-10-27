import { LOCALES, type Locale } from '../i18n/locales'
import { useI18n, type I18nValue } from '../i18n/I18nProvider'

// Each language in its own script, as system language pickers show them: a
// reader finds their language whatever the current one is.
const LANGUAGE_NAMES: Record<Locale, string> = {
  'zh-CN': '简体中文',
  'zh-TW': '繁體中文',
  'en-US': 'English',
  'ja-JP': '日本語',
}

interface LanguageSettingsProps {
  i18n?: I18nValue
}

function LanguageSettingsView({ i18n }: { i18n: I18nValue }) {
  const { locale, setLocale, t } = i18n
  const focusLocale = (index: number, currentTarget: HTMLButtonElement): void => {
    const buttons = currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('button[role="radio"]')
    const next = buttons?.[index]
    if (!next) return
    setLocale(LOCALES[index])
    next.focus()
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number): void => {
    let nextIndex: number | null = null
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (index + 1) % LOCALES.length
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = (index + LOCALES.length - 1) % LOCALES.length
    if (event.key === 'Home') nextIndex = 0
    if (event.key === 'End') nextIndex = LOCALES.length - 1
    if (nextIndex === null) return
    event.preventDefault()
    focusLocale(nextIndex, event.currentTarget)
  }

  return (
    <section className="settings-section language-settings" aria-labelledby="language-heading">
      <h2 id="language-heading">{t('settings.language.title')}</h2>
      <div className="settings-row">
        <div className="setting-label">
          <strong>{t('settings.language.title')}</strong>
          <span>{t('settings.language.description')}</span>
        </div>
        <div className="segmented-control language-segments" role="radiogroup" aria-label={t('settings.language.title')}>
          {LOCALES.map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              value={value}
              lang={value}
              aria-checked={locale === value}
              tabIndex={locale === value ? 0 : -1}
              className={locale === value ? 'is-selected' : undefined}
              onKeyDown={(event) => handleKeyDown(event, LOCALES.indexOf(value))}
              onClick={() => setLocale(value)}
            >
              {LANGUAGE_NAMES[value]}
            </button>
          ))}
        </div>
      </div>
    </section>
  )
}

function LocalizedLanguageSettings() {
  return <LanguageSettingsView i18n={useI18n()} />
}

export function LanguageSettings({ i18n }: LanguageSettingsProps) {
  return i18n ? <LanguageSettingsView i18n={i18n} /> : <LocalizedLanguageSettings />
}

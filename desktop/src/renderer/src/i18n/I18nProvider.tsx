import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react'

import type { Locale } from './locales'
import { hasMessages, loadMessages, type MessageKey, translate, translateText, type TranslationVariables } from './messages'
import { loadLocale, saveLocale } from './storage'

export interface I18nValue {
  locale: Locale
  setLocale: (locale: Locale) => void
  t: (key: MessageKey, variables?: TranslationVariables) => string
}

const I18nContext = createContext<I18nValue | null>(null)

const standaloneI18n: I18nValue = {
  locale: 'en-US',
  setLocale: () => undefined,
  t: (key, variables) => translate('en-US', key, variables),
}

function setDocumentLocale(locale: Locale): void {
  document.documentElement.lang = locale
}

export function I18nProvider({ children }: PropsWithChildren): React.JSX.Element {
  const [locale, setLocaleState] = useState<Locale>(loadLocale)

  useEffect(() => {
    setDocumentLocale(locale)
  }, [locale])

  const setLocale = useCallback((nextLocale: Locale) => {
    saveLocale(nextLocale)
    const apply = (): void => {
      setLocaleState(nextLocale)
      setDocumentLocale(nextLocale)
    }
    // A language loaded before switches at once; another switches when its messages arrive.
    if (hasMessages(nextLocale)) apply()
    else void loadMessages(nextLocale).then(apply, apply)
  }, [])

  const t = useCallback((key: MessageKey, variables?: TranslationVariables) => translate(locale, key, variables), [locale])
  const value = useMemo<I18nValue>(() => ({ locale, setLocale, t }), [locale, setLocale, t])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext)
  if (!value) throw new Error('i18n_provider_missing')
  return value
}

export function useOptionalI18n(): I18nValue {
  return useContext(I18nContext) ?? standaloneI18n
}

export function useProvidedI18n(): I18nValue | null {
  return useContext(I18nContext)
}

export function useText(): (text: string, variables?: TranslationVariables) => string {
  const { locale } = useOptionalI18n()
  return useCallback((text, variables) => translateText(locale, text, variables), [locale])
}

import { DEFAULT_LOCALE, isLocale, LOCALE_STORAGE_KEY, type Locale } from './locales'

type LocaleReader = Pick<Storage, 'getItem'>
type LocaleWriter = Pick<Storage, 'setItem'>

export function loadLocale(storage?: LocaleReader): Locale {
  try {
    const locale = (storage ?? localStorage).getItem(LOCALE_STORAGE_KEY)
    return isLocale(locale) ? locale : DEFAULT_LOCALE
  } catch {
    return DEFAULT_LOCALE
  }
}

export function saveLocale(locale: Locale, storage?: LocaleWriter): void {
  try {
    ;(storage ?? localStorage).setItem(LOCALE_STORAGE_KEY, locale)
  } catch {
    // Persistence is optional; switching language must remain available.
  }
}

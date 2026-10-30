import { EXPERT_DOMAINS, type CatalogDomain, type CatalogExpert, type CatalogLocale } from './expert-catalog'

export { EXPERT_DOMAINS, type CatalogDomain, type CatalogExpert }

/** Every library expert by id. */
export const CATALOG: ReadonlyMap<string, CatalogExpert> = new Map(
  EXPERT_DOMAINS.flatMap((domain) => domain.experts.map((expert) => [expert.id, expert] as const)),
)

const DOMAINS_BY_ID: ReadonlyMap<string, CatalogDomain> = new Map(EXPERT_DOMAINS.map((domain) => [domain.id, domain] as const))

export function catalogLocale(locale: string): CatalogLocale {
  return locale === 'zh-CN' || locale === 'zh-TW' || locale === 'ja-JP' ? locale : 'en-US'
}

export function isLibraryExpert(id: string): boolean {
  return CATALOG.has(id)
}

/** A library expert's name in the window's language, or undefined for one not in the library. */
export function libraryName(id: string, locale: string): string | undefined {
  return CATALOG.get(id)?.names[catalogLocale(locale)]
}

export function librarySummary(id: string, locale: string): string | undefined {
  return CATALOG.get(id)?.summaries[catalogLocale(locale)]
}

/** The colour of an expert's field, for their shirt in the studio. */
export function domainColor(id: string): string | undefined {
  const expert = CATALOG.get(id)
  return expert ? DOMAINS_BY_ID.get(expert.domain)?.color : undefined
}

import { Search, WifiOff } from 'lucide-react'
import { useEffect, useState } from 'react'

import type { WorkbenchBridgeClient } from '../bridge/client'
import type { WorkbenchState } from '../state/workbench-store'
import { useOptionalI18n } from '../i18n/I18nProvider'
import { translate, type MessageKey } from '../i18n/messages'

type SearchClient = Pick<WorkbenchBridgeClient, 'searchSessions' | 'openSession'>

export function SearchRoute({ state, client }: { state: WorkbenchState; client?: SearchClient }) {
  const { locale, t } = useOptionalI18n()
  const projection = state.operational.search
  const [query, setQuery] = useState(projection.query)
  const [error, setError] = useState<MessageKey | null>(null)
  useEffect(() => {
    const trimmed = query.trim()
    if (!client || !trimmed) return
    const timer = window.setTimeout(() => {
      setError(null)
      void client.searchSessions(trimmed, 20).catch(() => setError('search.failed'))
    }, 300)
    return () => window.clearTimeout(timer)
  }, [client, query])
  const visibleResults = query.trim() && projection.query === query.trim()
    ? projection.results
    : []
  return <main className="route-column reading-surface" aria-label={t('workbench.search')}><header className="route-header"><div><p className="section-kicker">{t('workbench.workspace')}</p><h1 tabIndex={-1}>{t('workbench.search')}</h1></div><span className="route-context">{t('search.index')}</span></header><div className="route-content">
    <label className="route-search"><Search size={15} /><input type="search" role="searchbox" aria-label={t('search.allSessions')} placeholder={t('search.allSessions')} value={query} onChange={(event) => { setQuery(event.target.value); if (!event.target.value.trim()) setError(null) }} /></label>
    {projection.state === 'unavailable' ? <p role="status" className="route-unavailable"><WifiOff size={15} />{t('search.unavailable')}</p> : null}
    {error ? <p role="status" className="route-error">{translate(locale, error)}</p> : null}
    <section className="route-section"><header><div><h2>{t('search.results')}</h2><span>{t('search.matches', { count: visibleResults.length })}</span></div></header><div className="route-list" role="list">{visibleResults.map((result) => <div role="listitem" key={result.id}><button type="button" className="route-list-row" aria-label={t('search.openResult', { title: result.title })} onClick={() => { setError(null); void client?.openSession(result.id).catch(() => setError('workbench.sessionOpenFailed')) }}><span><strong>{result.title}</strong><small>{result.snippet}</small></span><span className="route-list-state">{result.documentKind}</span></button></div>)}</div>{projection.state === 'ready' && visibleResults.length === 0 ? <p className="route-note">{t('search.noIndexedMatches')}</p> : null}</section>
  </div></main>
}

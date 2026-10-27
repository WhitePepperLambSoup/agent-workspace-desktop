import { ArrowLeft, ExternalLink, FileText, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { WorkbenchBridgeClient } from '../bridge/client'
import { useOptionalI18n } from '../i18n/I18nProvider'
import './research-inspector.css'

type ResearchClient = Pick<WorkbenchBridgeClient, 'listResearchSources' | 'readResearchSource' | 'listResearchCitations'>

interface SavedSource {
  id: string
  url: string
  title: string
  summary: string
  mediaType: string
  fetchedAt: string
  truncated: boolean
}

interface SavedCitation {
  id: string
  sourceId: string
  claim: string
  locator: string
  quote: string
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function pageOffset(value: unknown, current: number): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > current ? value : null
}

function sourcesFromPayload(value: unknown, offset: number): { items: SavedSource[]; next: number | null } {
  const payload = record(value)
  if (!payload || !Array.isArray(payload.sources)) throw new Error('invalid_research_sources')
  const items = payload.sources.flatMap((value): SavedSource[] => {
    const source = record(value)
    if (!source || typeof source.id !== 'string' || typeof source.url !== 'string') return []
    return [{
      id: source.id,
      url: source.url,
      title: typeof source.title === 'string' && source.title.trim() ? source.title : source.url,
      summary: typeof source.summary === 'string' ? source.summary : '',
      mediaType: typeof source.mediaType === 'string' ? source.mediaType : '',
      fetchedAt: typeof source.fetchedAt === 'string' ? source.fetchedAt : '',
      truncated: source.truncated === true,
    }]
  })
  return { items, next: pageOffset(payload.nextOffset, offset) }
}

function citationsFromPayload(value: unknown, offset: number): { items: SavedCitation[]; next: number | null } {
  const payload = record(value)
  if (!payload || !Array.isArray(payload.citations)) throw new Error('invalid_research_citations')
  const items = payload.citations.flatMap((value): SavedCitation[] => {
    const citation = record(value)
    if (!citation || typeof citation.id !== 'string' || typeof citation.sourceId !== 'string' || typeof citation.claim !== 'string') return []
    return [{
      id: citation.id,
      sourceId: citation.sourceId,
      claim: citation.claim,
      locator: typeof citation.locator === 'string' ? citation.locator : '',
      quote: typeof citation.quote === 'string' ? citation.quote : '',
    }]
  })
  return { items, next: pageOffset(payload.nextOffset, offset) }
}

function externalSourceUrl(raw: string): string | null {
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null
  } catch {
    return null
  }
}

const NON_CONTENT_TAGS = new Set([
  'SCRIPT', 'STYLE', 'NAV', 'HEADER', 'FOOTER', 'ASIDE', 'FORM', 'NOSCRIPT',
  'SVG', 'CANVAS', 'TEMPLATE', 'IFRAME', 'OBJECT', 'EMBED',
])
const BLOCK_TAGS = new Set([
  'ARTICLE', 'BLOCKQUOTE', 'BR', 'DD', 'DIV', 'DL', 'DT', 'H1', 'H2', 'H3',
  'H4', 'H5', 'H6', 'HR', 'LI', 'MAIN', 'OL', 'P', 'PRE', 'SECTION', 'TABLE',
  'TR', 'UL',
])

function readableHtml(raw: string): string {
  const document = new DOMParser().parseFromString(raw, 'text/html')
  const root = document.querySelector('main, article, [role="main"]') ?? document.body
  if (!root) return ''
  const parts: string[] = []
  const visit = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      parts.push((node.textContent ?? '').replace(/\s+/g, ' '))
      return
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return
    const element = node as Element
    if (
      NON_CONTENT_TAGS.has(element.tagName) ||
      element.hasAttribute('hidden') ||
      element.getAttribute('aria-hidden') === 'true'
    ) return
    const block = BLOCK_TAGS.has(element.tagName)
    if (block) parts.push('\n')
    for (const child of element.childNodes) visit(child)
    if (block) parts.push('\n')
  }
  visit(root)
  return parts.join('').replace(/ *\n+ */g, '\n').trim()
}

function fetchedAtLabel(raw: string, locale: string): string {
  const timestamp = new Date(raw)
  return Number.isNaN(timestamp.getTime()) ? raw : timestamp.toLocaleString(locale)
}

export function ResearchInspectorPage({
  sessionId,
  client,
  refreshSignal,
}: {
  sessionId: string | null
  client?: ResearchClient
  refreshSignal: string
}) {
  const { locale, t } = useOptionalI18n()
  const [view, setView] = useState<'sources' | 'citations'>('sources')
  const [sourceFormat, setSourceFormat] = useState<'readable' | 'original'>('readable')
  const [sources, setSources] = useState<SavedSource[]>([])
  const [citations, setCitations] = useState<SavedCitation[]>([])
  const [nextSources, setNextSources] = useState<number | null>(null)
  const [nextCitations, setNextCitations] = useState<number | null>(null)
  const [selectedSource, setSelectedSource] = useState<SavedSource | null>(null)
  const [sourceText, setSourceText] = useState('')
  const [nextText, setNextText] = useState<number | null>(null)
  const [sourcesLoading, setSourcesLoading] = useState(false)
  const [citationsLoading, setCitationsLoading] = useState(false)
  const [textLoading, setTextLoading] = useState(false)
  const [sourcesError, setSourcesError] = useState(false)
  const [citationsError, setCitationsError] = useState(false)
  const [textError, setTextError] = useState(false)
  const sourcesRequest = useRef(0)
  const citationsRequest = useRef(0)
  const textRequest = useRef(0)

  const loadSources = useCallback(async (offset: number): Promise<void> => {
    if (!client || !sessionId) return
    const request = ++sourcesRequest.current
    setSourcesLoading(true)
    setSourcesError(false)
    try {
      const response = await client.listResearchSources(offset, 25)
      if (request !== sourcesRequest.current) return
      const page = sourcesFromPayload(response.payload, offset)
      setSources((current) => offset === 0 ? page.items : [...current, ...page.items])
      setNextSources(page.next)
    } catch {
      if (request === sourcesRequest.current) setSourcesError(true)
    } finally {
      if (request === sourcesRequest.current) setSourcesLoading(false)
    }
  }, [client, sessionId])

  const loadCitations = useCallback(async (offset: number): Promise<void> => {
    if (!client || !sessionId) return
    const request = ++citationsRequest.current
    setCitationsLoading(true)
    setCitationsError(false)
    try {
      const response = await client.listResearchCitations(offset, 20)
      if (request !== citationsRequest.current) return
      const page = citationsFromPayload(response.payload, offset)
      setCitations((current) => offset === 0 ? page.items : [...current, ...page.items])
      setNextCitations(page.next)
    } catch {
      if (request === citationsRequest.current) setCitationsError(true)
    } finally {
      if (request === citationsRequest.current) setCitationsLoading(false)
    }
  }, [client, sessionId])

  const loadText = useCallback(async (source: SavedSource, offset: number): Promise<void> => {
    if (!client || !sessionId) return
    const request = ++textRequest.current
    setTextLoading(true)
    setTextError(false)
    try {
      const html = source.mediaType === 'text/html'
      const chunks: string[] = []
      let currentOffset: number | null = offset
      for (let page = 0; currentOffset !== null && page < (html ? 8 : 1); page += 1) {
        const response = await client.readResearchSource(source.id, currentOffset, html ? 32_768 : 16_000)
        if (request !== textRequest.current) return
        const payload = record(response.payload)
        if (!payload || payload.sourceId !== source.id || typeof payload.content !== 'string') throw new Error('invalid_research_text')
        chunks.push(payload.content)
        currentOffset = pageOffset(payload.nextOffset, currentOffset)
      }
      setSourceText((current) => offset === 0 ? chunks.join('') : current + chunks.join(''))
      setNextText(currentOffset)
    } catch {
      if (request === textRequest.current) setTextError(true)
    } finally {
      if (request === textRequest.current) setTextLoading(false)
    }
  }, [client, sessionId])

  const readableText = useMemo(() => {
    if (selectedSource?.mediaType !== 'text/html' || !sourceText || nextText !== null) return ''
    // web_fetch saves a page as its readable text; only saved markup has an original to switch to.
    if (!/<(?:!doctype|html|head|body|div|p|article|main|section)[\s>]/i.test(sourceText)) return ''
    return readableHtml(sourceText)
  }, [nextText, selectedSource?.mediaType, sourceText])

  useEffect(() => {
    setSources([])
    setCitations([])
    setNextSources(null)
    setNextCitations(null)
    void loadSources(0)
    void loadCitations(0)
  }, [loadSources, loadCitations, refreshSignal])

  useEffect(() => () => {
    sourcesRequest.current += 1
    citationsRequest.current += 1
    textRequest.current += 1
  }, [])

  const openSource = (source: SavedSource): void => {
    setSelectedSource(source)
    setSourceFormat('readable')
    setSourceText('')
    setNextText(null)
    void loadText(source, 0)
  }

  if (!sessionId) return <p className="research-empty">{t('inspector.researchNoSession')}</p>
  if (!client) return <p className="research-empty">{t('inspector.researchUnavailable')}</p>

  return (
    <div className="research-inspector">
      <div className="research-switch" aria-label={t('inspector.research')}>
        <button type="button" aria-pressed={view === 'sources'} onClick={() => setView('sources')}>{t('inspector.researchSources')}</button>
        <button type="button" aria-pressed={view === 'citations'} onClick={() => setView('citations')}>{t('inspector.researchCitations')}</button>
      </div>

      {view === 'sources' && selectedSource ? (
        <section className="research-reader">
          <div className="research-reader-header">
            <button type="button" className="research-back" aria-label={t('inspector.researchBack')} title={t('inspector.researchBack')} onClick={() => { textRequest.current += 1; setSelectedSource(null) }}><ArrowLeft size={16} /></button>
            <h3>{selectedSource.title}</h3>
            {externalSourceUrl(selectedSource.url) ? <a href={externalSourceUrl(selectedSource.url) ?? undefined} target="_blank" rel="noreferrer" aria-label={selectedSource.url} title={selectedSource.url}><ExternalLink size={15} /></a> : null}
          </div>
          <p className="research-url">{selectedSource.url}</p>
          {selectedSource.summary ? <p className="research-summary">{selectedSource.summary}</p> : null}
          {selectedSource.fetchedAt ? <time className="research-fetched" dateTime={selectedSource.fetchedAt}>{t('inspector.researchFetchedAt', { date: fetchedAtLabel(selectedSource.fetchedAt, locale) })}</time> : null}
          {selectedSource.truncated ? <p className="research-notice">{t('inspector.researchTruncated')}</p> : null}
          {textError ? <p role="alert" className="research-error">{t('inspector.researchReadFailed')} <button type="button" onClick={() => void loadText(selectedSource, sourceText.length ? nextText ?? 0 : 0)}>{t('inspector.researchRetry')}</button></p> : null}
          {textLoading && !sourceText ? <p role="status" className="research-empty">{t('inspector.researchSources')}...</p> : null}
          {readableText ? <div className="research-format-switch" aria-label={t('inspector.researchFormat')}>
            <button type="button" aria-pressed={sourceFormat === 'readable'} onClick={() => setSourceFormat('readable')}>{t('inspector.researchReadable')}</button>
            <button type="button" aria-pressed={sourceFormat === 'original'} onClick={() => setSourceFormat('original')}>{t('inspector.researchOriginal')}</button>
          </div> : null}
          {sourceText ? <pre className="research-source-text" data-testid="research-source-content">{readableText && sourceFormat === 'readable' ? readableText : sourceText}</pre> : null}
          {nextText !== null ? <button type="button" className="research-more" disabled={textLoading} onClick={() => void loadText(selectedSource, nextText)}>{t('inspector.researchMoreText')}</button> : null}
        </section>
      ) : view === 'sources' ? (
        <section className="research-list" aria-label={t('inspector.researchSources')}>
          {sources.map((source) => <article className="research-row" key={source.id}>
            <button type="button" className="research-source-title" aria-label={t('inspector.researchViewSource', { title: source.title })} onClick={() => openSource(source)}><FileText size={16} aria-hidden="true" /><strong>{source.title}</strong></button>
            <span className="research-url">{source.url}</span>
            {source.summary ? <p>{source.summary}</p> : null}
          </article>)}
          {sourcesError ? <p role="alert" className="research-error">{t('inspector.researchLoadFailed')} <button type="button" onClick={() => void loadSources(sources.length ? nextSources ?? 0 : 0)}><RefreshCw size={14} aria-hidden="true" />{t('inspector.researchRetry')}</button></p> : null}
          {!sourcesLoading && !sourcesError && sources.length === 0 ? <p className="research-empty">{t('inspector.researchNoSources')}</p> : null}
          {sourcesLoading && sources.length === 0 ? <p role="status" className="research-empty">{t('inspector.researchSources')}...</p> : null}
          {nextSources !== null ? <button type="button" className="research-more" disabled={sourcesLoading} onClick={() => void loadSources(nextSources)}>{t('inspector.researchMoreSources')}</button> : null}
        </section>
      ) : (
        <section className="research-list" aria-label={t('inspector.researchCitations')}>
          {citations.map((citation) => {
            const source = sources.find((item) => item.id === citation.sourceId)
            const citedSource = source ?? {
              id: citation.sourceId,
              url: '',
              title: citation.sourceId.slice(0, 12),
              summary: '',
              mediaType: '',
              fetchedAt: '',
              truncated: false,
            }
            return <article className="research-row" key={citation.id}>
              <strong>{citation.claim}</strong>
              {citation.quote ? <blockquote>{citation.quote}</blockquote> : null}
              {citation.locator ? <p className="research-url">{t('inspector.researchLocator', { locator: citation.locator })}</p> : null}
              <button type="button" className="research-citation-source" aria-label={source ? t('inspector.researchViewSource', { title: source.title }) : t('inspector.researchViewCitedSource')} onClick={() => { setView('sources'); openSource(citedSource) }}>{source?.title ?? t('inspector.researchViewCitedSource')}</button>
            </article>
          })}
          {citationsError ? <p role="alert" className="research-error">{t('inspector.researchLoadFailed')} <button type="button" onClick={() => void loadCitations(citations.length ? nextCitations ?? 0 : 0)}><RefreshCw size={14} aria-hidden="true" />{t('inspector.researchRetry')}</button></p> : null}
          {!citationsLoading && !citationsError && citations.length === 0 ? <p className="research-empty">{t('inspector.researchNoCitations')}</p> : null}
          {citationsLoading && citations.length === 0 ? <p role="status" className="research-empty">{t('inspector.researchCitations')}...</p> : null}
          {nextCitations !== null ? <button type="button" className="research-more" disabled={citationsLoading} onClick={() => void loadCitations(nextCitations)}>{t('inspector.researchMoreCitations')}</button> : null}
        </section>
      )}
    </div>
  )
}

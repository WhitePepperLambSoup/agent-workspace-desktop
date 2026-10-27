import { BookOpen, FilePlus2, Globe, RefreshCw, Search, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent } from 'react'

import type { UiResponse } from '../../../shared/api'
import type { WorkbenchBridgeClient } from '../bridge/client'
import { useOptionalI18n } from '../i18n/I18nProvider'
import type { MessageKey } from '../i18n/messages'
import {
  collectionLabel,
  isIndexing,
  KNOWLEDGE_CHANGED_EVENT,
  knowledgeErrorCode,
  parseFailures,
  parseResults,
  parseSnapshot,
  type KnowledgeCollection,
  type KnowledgeDocument,
  type KnowledgeResult,
  type KnowledgeSnapshot,
} from './model'
import { WatchedFolders, type WatchClient } from './WatchedFolders'
import './knowledge.css'

export type KnowledgeClient = Pick<
  WorkbenchBridgeClient,
  | 'knowledgeStatus'
  | 'configureKnowledge'
  | 'addKnowledge'
  | 'updateKnowledgeDocument'
  | 'deleteKnowledgeDocument'
  | 'createKnowledgeCollection'
  | 'updateKnowledgeCollection'
  | 'deleteKnowledgeCollection'
  | 'searchKnowledge'
> & Partial<WatchClient>

const ERROR_KEYS: Record<string, MessageKey> = {
  binary: 'knowledge.error.binary',
  pdf_locked: 'knowledge.error.pdfLocked',
  pdf_unreadable: 'knowledge.error.unreadable',
  epub_unreadable: 'knowledge.error.unreadable',
  unreadable: 'knowledge.error.unreadable',
  unsupported_type: 'knowledge.error.unsupportedType',
  page_unavailable: 'knowledge.error.pageUnavailable',
  page_not_text: 'knowledge.error.pageNotText',
  page_empty: 'knowledge.error.pageEmpty',
  url_invalid: 'knowledge.error.urlInvalid',
  name_taken: 'knowledge.error.nameTaken',
  name_invalid: 'knowledge.error.nameInvalid',
  too_many_bases: 'knowledge.error.tooManyBases',
  default_kept: 'knowledge.error.defaultKept',
  busy: 'knowledge.error.busy',
  unknown_base: 'knowledge.error.unknownBase',
  not_found: 'knowledge.error.notFound',
  file_too_large: 'knowledge.error.fileTooLarge',
  file_empty: 'knowledge.error.fileEmpty',
  full: 'knowledge.error.full',
  no_text: 'knowledge.error.noText',
  interrupted: 'knowledge.error.interrupted',
  synonyms_invalid: 'knowledge.error.synonymsInvalid',
}

type Notice = { tone: 'ok' | 'error'; text: string }

function fileSize(bytes: number, locale: string): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024)).toLocaleString(locale)} KB`
  return `${(bytes / (1024 * 1024)).toLocaleString(locale, { maximumFractionDigits: 1 })} MB`
}

export function KnowledgeRoute({ client }: { client?: KnowledgeClient }) {
  const { locale, t } = useOptionalI18n()
  const [snapshot, setSnapshot] = useState<KnowledgeSnapshot | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [filter, setFilter] = useState('all')
  const [target, setTarget] = useState('default')
  const [pageUrl, setPageUrl] = useState('')
  const [newBase, setNewBase] = useState('')
  const [renaming, setRenaming] = useState<{ kind: 'document' | 'collection'; id: string; value: string } | null>(null)
  const [synonyms, setSynonyms] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<KnowledgeResult[] | null>(null)
  const [dragging, setDragging] = useState(false)
  const readingBefore = useRef(false)

  const reason = useCallback((code: string | null): string =>
    t(ERROR_KEYS[code ?? ''] ?? 'knowledge.error.invalid'), [t])
  const label = useCallback((collection: KnowledgeCollection): string =>
    collectionLabel(collection, t('knowledge.defaultBase')), [t])

  const load = useCallback(async (): Promise<void> => {
    if (!client) return
    try {
      const next = parseSnapshot((await client.knowledgeStatus()).payload)
      const wasReading = readingBefore.current
      readingBefore.current = next.documents.some(isIndexing)
      // A document finished reading: views that list knowledge bases count it now.
      if (wasReading && !readingBefore.current) window.dispatchEvent(new Event(KNOWLEDGE_CHANGED_EVENT))
      setSnapshot(next)
      setLoadFailed(false)
    } catch {
      setLoadFailed(true)
    }
  }, [client])

  useEffect(() => { void load() }, [load])

  // Documents being read report their progress; check again until none is left.
  const reading = snapshot?.documents.some(isIndexing) ?? false
  useEffect(() => {
    if (!reading) return
    const timer = window.setTimeout(() => { void load() }, 1000)
    return () => window.clearTimeout(timer)
  }, [load, reading, snapshot])

  const run = async (action: () => Promise<UiResponse>, done?: (response: UiResponse) => void): Promise<boolean> => {
    if (!client || busy) return false
    setBusy(true)
    setNotice(null)
    try {
      const response = await action()
      const payload = response.payload as Record<string, unknown>
      if (Array.isArray(payload.documents)) {
        const next = parseSnapshot(payload)
        readingBefore.current = next.documents.some(isIndexing)
        setSnapshot(next)
      }
      window.dispatchEvent(new Event(KNOWLEDGE_CHANGED_EVENT))
      done?.(response)
      return true
    } catch (error) {
      setNotice({ tone: 'error', text: reason(knowledgeErrorCode(error)) })
      return false
    } finally {
      setBusy(false)
    }
  }

  const reportAdded = (response: UiResponse): void => {
    const added = Array.isArray((response.payload as { added?: unknown }).added)
      ? (response.payload as { added: Array<{ duplicate?: unknown }> }).added
      : []
    const failures = parseFailures(response.payload)
    const duplicates = added.filter((item) => item.duplicate === true).length
    const lines = []
    if (added.length > duplicates) lines.push(t('knowledge.added', { count: added.length - duplicates }))
    if (duplicates) lines.push(t('knowledge.alreadyAdded', { count: duplicates }))
    for (const failure of failures) lines.push(t('knowledge.addFailed', { name: failure.name, reason: reason(failure.code) }))
    setNotice({ tone: failures.length && !added.length ? 'error' : 'ok', text: lines.join(' ') })
  }

  const addPaths = (paths: readonly string[]): void => {
    if (!client || paths.length === 0) return
    void run(() => client.addKnowledge({ paths }, target), reportAdded)
  }

  const pickFiles = async (): Promise<void> => {
    const select = window.agentWorkspace?.selectKnowledgeFiles
    if (!select || !snapshot) return
    addPaths(await select(snapshot.suffixes))
  }

  const savePage = (event: FormEvent): void => {
    event.preventDefault()
    if (!client || !pageUrl.trim()) return
    void run(() => client.addKnowledge({ url: pageUrl.trim() }, target), (response) => { setPageUrl(''); reportAdded(response) })
  }

  const drop = (event: DragEvent<HTMLElement>): void => {
    event.preventDefault()
    setDragging(false)
    const pathFor = window.agentWorkspace?.getPathForFile
    if (!pathFor) return
    addPaths([...event.dataTransfer.files].map((file) => pathFor(file)).filter((path): path is string => Boolean(path)))
  }

  const createBase = (event: FormEvent): void => {
    event.preventDefault()
    if (!client || !newBase.trim()) return
    void run(() => client.createKnowledgeCollection(newBase.trim()), () => setNewBase(''))
  }

  const finishRename = (event: FormEvent): void => {
    event.preventDefault()
    if (!client || !renaming) return
    const { kind, id, value } = renaming
    void run(
      () => kind === 'document'
        ? client.updateKnowledgeDocument(id, { title: value })
        : client.updateKnowledgeCollection(id, { name: value }),
      () => setRenaming(null),
    )
  }

  const removeDocument = (document: KnowledgeDocument): void => {
    if (!client || !window.confirm(t('knowledge.confirmRemoveDocument', { title: document.title }))) return
    void run(() => client.deleteKnowledgeDocument(document.id))
  }

  const search = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (!client || !query.trim()) return
    try {
      setResults(parseResults((await client.searchKnowledge(query.trim(), filter === 'all' ? undefined : [filter])).payload))
    } catch (error) {
      setResults(null)
      setNotice({ tone: 'error', text: reason(knowledgeErrorCode(error)) })
    }
  }

  const labels = useMemo(() => new Map(snapshot?.collections.map((item) => [item.id, label(item)]) ?? []), [label, snapshot])
  const shown = snapshot?.documents.filter((document) => filter === 'all' || document.collectionId === filter) ?? []
  const several = (snapshot?.collections.length ?? 0) > 1
  const canPick = Boolean(window.agentWorkspace?.selectKnowledgeFiles) && snapshot !== null

  const state = (document: KnowledgeDocument): string => {
    if (document.state === 'queued') return t('knowledge.state.queued')
    if (document.state === 'indexing') return t('knowledge.state.indexing', { percent: Math.round(document.progress * 100) })
    if (document.state === 'failed') return t('knowledge.state.failed', { reason: document.errorCode ? reason(document.errorCode) : document.error ?? '' })
    return document.pages
      ? t('knowledge.state.readyPages', { pages: document.pages, passages: document.passages })
      : t('knowledge.state.ready', { passages: document.passages })
  }

  return <main className="route-column reading-surface knowledge-route" aria-label={t('workbench.knowledge')}>
    <header className="route-header">
      <div><p className="section-kicker">{t('knowledge.kicker')}</p><h1 tabIndex={-1}>{t('workbench.knowledge')}</h1></div>
      <div className="knowledge-header-actions">
        <button type="button" className="icon-button" aria-label={t('knowledge.refresh')} title={t('knowledge.refresh')} disabled={!client} onClick={() => void load()}><RefreshCw size={15} /></button>
        <button type="button" className="primary-button" disabled={!canPick || busy} onClick={() => void pickFiles()}><FilePlus2 size={14} />{t('knowledge.addFiles')}</button>
      </div>
    </header>
    <div
      className="route-content knowledge-content"
      data-dragging={dragging ? 'true' : undefined}
      onDragOver={(event) => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); setDragging(true) } }}
      onDragLeave={() => setDragging(false)}
      onDrop={drop}
    >
      <p className="route-note">{t('knowledge.lede')}</p>
      {loadFailed ? <p role="alert" className="route-error">{t('knowledge.loadFailed')}</p> : null}
      <div className="knowledge-feedback" aria-live="polite">
        {notice ? <p role="status" className={notice.tone === 'error' ? 'route-error' : 'route-note knowledge-ok'}>{notice.text}</p> : null}
      </div>
      {snapshot ? <>
        <p className="knowledge-totals">{t('knowledge.totals', {
          documents: snapshot.totals.documents,
          passages: snapshot.totals.passages,
          size: fileSize(snapshot.totals.storageBytes, locale),
        })}</p>

        <section className="route-section" aria-labelledby="knowledge-use">
          <header><div><h2 id="knowledge-use">{t('knowledge.useTitle')}</h2></div></header>
          <label className="knowledge-check"><input type="checkbox" checked={snapshot.enabled} disabled={busy} onChange={(event) => { const enabled = event.currentTarget.checked; void run(() => client!.configureKnowledge({ enabled })) }} /><span>{t('knowledge.enabled')}</span></label>
          <label className="knowledge-check"><input type="checkbox" checked={snapshot.auto} disabled={busy || !snapshot.enabled} onChange={(event) => { const auto = event.currentTarget.checked; void run(() => client!.configureKnowledge({ auto })) }} /><span>{t('knowledge.auto')}</span></label>
          <p className="route-note">{t('knowledge.autoHelp')}</p>
        </section>

        <section className="route-section" aria-labelledby="knowledge-bases">
          <header><div><h2 id="knowledge-bases">{t('knowledge.bases')}</h2><span>{t('knowledge.basesHelp')}</span></div></header>
          <ul className="knowledge-list">
            {snapshot.collections.map((collection) => <li key={collection.id} className="knowledge-row">
              {renaming?.kind === 'collection' && renaming.id === collection.id
                ? <form className="knowledge-inline-form" onSubmit={finishRename}>
                  <input aria-label={t('knowledge.baseName')} value={renaming.value} maxLength={40} autoFocus onChange={(event) => setRenaming({ ...renaming, value: event.currentTarget.value })} />
                  <button type="submit" className="secondary-button" disabled={busy}>{t('knowledge.save')}</button>
                  <button type="button" className="secondary-button" onClick={() => setRenaming(null)}>{t('knowledge.cancel')}</button>
                </form>
                : <div className="knowledge-row-main">
                  <strong>{label(collection)}</strong>
                  <small>{t('knowledge.baseCount', { count: collection.documents })}</small>
                </div>}
              <label className="knowledge-check"><input type="checkbox" checked={collection.defaultOn} disabled={busy} onChange={(event) => { const defaultOn = event.currentTarget.checked; void run(() => client!.updateKnowledgeCollection(collection.id, { defaultOn })) }} /><span>{t('knowledge.defaultOn')}</span></label>
              <div className="knowledge-row-actions">
                <button type="button" className="secondary-button" disabled={busy} onClick={() => setRenaming({ kind: 'collection', id: collection.id, value: collection.name || label(collection) })}>{t('knowledge.rename')}</button>
                {collection.id === 'default' ? null : <button
                  type="button"
                  className="icon-button"
                  aria-label={t('knowledge.removeBase', { name: label(collection) })}
                  title={t('knowledge.removeBase', { name: label(collection) })}
                  disabled={busy}
                  onClick={() => {
                    const confirm = collection.documents
                      ? t('knowledge.confirmRemoveBaseWithDocuments', { name: label(collection), count: collection.documents })
                      : t('knowledge.confirmRemoveBase', { name: label(collection) })
                    if (window.confirm(confirm)) void run(() => client!.deleteKnowledgeCollection(collection.id), () => { if (filter === collection.id) setFilter('all'); if (target === collection.id) setTarget('default') })
                  }}
                ><Trash2 size={14} /></button>}
              </div>
            </li>)}
          </ul>
          <form className="knowledge-inline-form" onSubmit={createBase}>
            <input aria-label={t('knowledge.newBaseName')} placeholder={t('knowledge.newBaseName')} value={newBase} maxLength={40} onChange={(event) => setNewBase(event.currentTarget.value)} />
            <button type="submit" className="secondary-button" disabled={busy || !newBase.trim()}>{t('knowledge.newBase')}</button>
          </form>
        </section>

        <section className="route-section" aria-labelledby="knowledge-documents">
          <header>
            <div><h2 id="knowledge-documents">{t('knowledge.documents')}</h2><span>{t('knowledge.dropHint')}</span></div>
            {several ? <select aria-label={t('knowledge.show')} value={filter} onChange={(event) => setFilter(event.currentTarget.value)}>
              <option value="all">{t('knowledge.allBases')}</option>
              {snapshot.collections.map((collection) => <option key={collection.id} value={collection.id}>{label(collection)}</option>)}
            </select> : null}
          </header>
          <div className="knowledge-add">
            {several ? <label className="knowledge-target"><span>{t('knowledge.addTo')}</span><select value={target} onChange={(event) => setTarget(event.currentTarget.value)}>
              {snapshot.collections.map((collection) => <option key={collection.id} value={collection.id}>{label(collection)}</option>)}
            </select></label> : null}
            <form className="knowledge-inline-form" onSubmit={savePage}>
              <Globe size={14} aria-hidden="true" />
              <input type="url" aria-label={t('knowledge.pageAddress')} placeholder={t('knowledge.pageAddress')} value={pageUrl} onChange={(event) => setPageUrl(event.currentTarget.value)} />
              <button type="submit" className="secondary-button" disabled={busy || !pageUrl.trim()}>{t('knowledge.savePage')}</button>
            </form>
          </div>
          {shown.length === 0 ? <p className="route-note knowledge-empty"><BookOpen size={15} aria-hidden="true" />{t(snapshot.documents.length ? 'knowledge.emptyBase' : 'knowledge.empty')}</p> : null}
          <ul className="knowledge-list">
            {shown.map((document) => <li key={document.id} className="knowledge-row" data-state={document.state}>
              {renaming?.kind === 'document' && renaming.id === document.id
                ? <form className="knowledge-inline-form" onSubmit={finishRename}>
                  <input aria-label={t('knowledge.documentTitle')} value={renaming.value} maxLength={180} autoFocus onChange={(event) => setRenaming({ ...renaming, value: event.currentTarget.value })} />
                  <button type="submit" className="secondary-button" disabled={busy}>{t('knowledge.save')}</button>
                  <button type="button" className="secondary-button" onClick={() => setRenaming(null)}>{t('knowledge.cancel')}</button>
                </form>
                : <div className="knowledge-row-main">
                  <strong title={document.originPath ?? document.title}>{document.title}</strong>
                  <small>{several ? `${labels.get(document.collectionId) ?? document.collectionId} · ` : ''}{document.origin === 'phone' ? `${t('timeline.fromPhoneUnnamed')} · ` : ''}{state(document)}</small>
                  {document.warnings.map((warning) => <small key={warning} className="knowledge-warning">{describeWarning(warning, t)}</small>)}
                </div>}
              <div className="knowledge-row-actions">
                {several ? <select aria-label={t('knowledge.moveTo', { title: document.title })} value={document.collectionId} disabled={busy || isIndexing(document)} onChange={(event) => { const collectionId = event.currentTarget.value; void run(() => client!.updateKnowledgeDocument(document.id, { collectionId })) }}>
                  {snapshot.collections.map((collection) => <option key={collection.id} value={collection.id}>{label(collection)}</option>)}
                </select> : null}
                <button type="button" className="secondary-button" disabled={busy || document.state !== 'ready'} onClick={() => setRenaming({ kind: 'document', id: document.id, value: document.title })}>{t('knowledge.rename')}</button>
                <button type="button" className="icon-button" aria-label={t('knowledge.removeDocument', { title: document.title })} title={t('knowledge.removeDocument', { title: document.title })} disabled={busy || isIndexing(document)} onClick={() => removeDocument(document)}><Trash2 size={14} /></button>
              </div>
            </li>)}
          </ul>
        </section>

        <WatchedFolders client={client} collections={snapshot.collections} target={target} label={label} onChanged={() => void load()} />

        <section className="route-section" aria-labelledby="knowledge-search">
          <header><div><h2 id="knowledge-search">{t('knowledge.searchTitle')}</h2><span>{t('knowledge.searchHelp')}</span></div></header>
          <form className="knowledge-inline-form" onSubmit={(event) => void search(event)}>
            <Search size={14} aria-hidden="true" />
            <input type="search" aria-label={t('knowledge.searchQuery')} placeholder={t('knowledge.searchQuery')} value={query} maxLength={500} onChange={(event) => setQuery(event.currentTarget.value)} />
            <button type="submit" className="secondary-button" disabled={!query.trim()}>{t('knowledge.searchButton')}</button>
          </form>
          {results === null ? null : results.length === 0
            ? <p className="route-note">{t('knowledge.noResults')}</p>
            : <ol className="knowledge-results">{results.map((result, index) => <li key={`${result.documentId}-${index}`}>
              <strong>{[result.document, result.page ? t('knowledge.page', { page: result.page }) : null, result.section].filter(Boolean).join(' · ')}</strong>
              <p>{result.passage}</p>
            </li>)}</ol>}
        </section>

        <details className="route-section knowledge-synonyms">
          <summary>{t('knowledge.synonyms')}</summary>
          <p className="route-note">{t('knowledge.synonymsHelp', { count: snapshot.builtinSynonymGroups })}</p>
          <textarea aria-label={t('knowledge.mySynonyms')} rows={5} value={synonyms ?? snapshot.synonyms} onChange={(event) => setSynonyms(event.currentTarget.value)} />
          <button type="button" className="secondary-button" disabled={busy || synonyms === null} onClick={() => { const text = synonyms ?? ''; void run(() => client!.configureKnowledge({ synonyms: text }), () => { setSynonyms(null); setNotice({ tone: 'ok', text: t('knowledge.synonymsSaved') }) }) }}>{t('knowledge.saveSynonyms')}</button>
        </details>
      </> : null}
    </div>
  </main>
}

/** The reader's notes about a document in the window's language; others are shown as they are. */
export function describeWarning(warning: string, t: (key: MessageKey, variables?: Record<string, string | number>) => string): string {
  const skipped = /^(\d+) of (\d+) pages have no readable text .*skipped: (.+)$/.exec(warning)
  if (skipped) return t('knowledge.warning.skippedPages', { count: skipped[1], total: skipped[2], pages: skipped[3] })
  const truncated = /^only the first ([\d,]+) characters were added/.exec(warning)
  if (truncated) return t('knowledge.warning.truncated', { chars: truncated[1] })
  const recognized = /^(\d+) scanned pages were read with text recognition/.exec(warning)
  if (recognized) return t('knowledge.warning.recognized', { count: recognized[1] })
  if (warning.startsWith('text recognition stopped')) return t('knowledge.warning.ocrStopped')
  return warning
}

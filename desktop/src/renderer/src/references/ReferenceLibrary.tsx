import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  ClipboardCopy,
  Download,
  FileInput,
  Library,
  Loader2,
  Search,
  ShieldCheck,
  Trash2,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { GatewayCommandError, type WorkbenchBridgeClient } from '../bridge/client'
import { useOptionalI18n } from '../i18n/I18nProvider'
import type { MessageKey } from '../i18n/messages'
import { openWorkspaceFile, requestPreview } from '../preview/preview-request'
import './references.css'

export type LibraryClient = Pick<
  WorkbenchBridgeClient,
  | 'listReferences'
  | 'searchReferences'
  | 'zoteroReferences'
  | 'addReferences'
  | 'removeReferences'
  | 'importReferences'
  | 'exportReferences'
  | 'checkReferences'
>

export interface LibraryWork {
  key?: string
  id?: string
  title: string
  authors?: string[]
  year?: number
  venue?: string
  doi?: string
  type?: string
  retracted?: boolean
  volume?: string
  issue?: string
  pages?: string
  publisher?: string
  url?: string
  pdf?: string
  arxiv?: string
  pmid?: string
  abstract?: string
  note?: string
}

interface Check { status: string; problems?: string[]; doi?: string }

const STYLES = ['gb7714-numeric', 'gb7714-author-year', 'apa', 'ieee', 'vancouver', 'nature'] as const
const IMPORT_TYPES = ['.bib', '.ris', '.enw', '.txt', '.json'] as const

function errorCode(error: unknown): string {
  return error instanceof GatewayCommandError ? error.code : 'failed'
}

function errorKey(code: string): MessageKey {
  switch (code) {
    case 'references_offline': return 'library.error.offline'
    case 'zotero_unavailable': return 'library.error.zotero'
    case 'references_none_found': return 'library.error.noneFound'
    case 'references_full': return 'library.error.full'
    case 'references_empty': return 'library.error.empty'
    case 'unsupported_type': return 'library.error.type'
    case 'file_too_large': return 'library.error.tooLarge'
    default: return 'library.error.failed'
  }
}

/** Authors · year · venue, volume(issue): pages. */
function describe(work: LibraryWork): string {
  const issue = work.volume ? `${work.volume}${work.issue ? `(${work.issue})` : ''}${work.pages ? `: ${work.pages}` : ''}` : work.pages ?? ''
  return [(work.authors ?? []).join(', '), work.year, work.venue, issue].filter(Boolean).join(' · ')
}

function link(url: string): void {
  requestPreview({ kind: 'url', url })
}

/** The folder's reference library: browse, add from the databases or Zotero, import, export, check. */
export function ReferenceLibrary({ client, workspaceKey }: { client: LibraryClient; workspaceKey: string | null }) {
  const { t } = useOptionalI18n()
  const [works, setWorks] = useState<LibraryWork[]>([])
  const [filter, setFilter] = useState('')
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set())
  const [open, setOpen] = useState<string | null>(null)
  const [checks, setChecks] = useState<Record<string, Check>>({})
  const [panel, setPanel] = useState<'online' | 'zotero' | null>(null)
  const [found, setFound] = useState<LibraryWork[]>([])
  const [query, setQuery] = useState('')
  const [style, setStyle] = useState<(typeof STYLES)[number]>('gb7714-numeric')
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ kind: 'error' | 'info'; text: string } | null>(null)
  const [confirming, setConfirming] = useState(false)

  const load = useCallback(async (): Promise<void> => {
    try {
      const response = await client.listReferences()
      setWorks((response.payload as { works?: LibraryWork[] }).works ?? [])
    } catch (error) {
      setNotice({ kind: 'error', text: t(errorKey(errorCode(error))) })
    }
  }, [client, t])

  useEffect(() => {
    setSelected(new Set())
    setChecks({})
    setOpen(null)
    void load()
  }, [load, workspaceKey])

  const shown = useMemo(() => {
    const words = filter.trim().toLowerCase().split(/\s+/).filter(Boolean)
    if (!words.length) return works
    return works.filter((work) => {
      const text = `${work.key ?? ''} ${work.title} ${(work.authors ?? []).join(' ')} ${work.year ?? ''} ${work.venue ?? ''} ${work.doi ?? ''}`.toLowerCase()
      return words.every((word) => text.includes(word))
    })
  }, [filter, works])
  const chosen = useMemo(() => works.filter((work) => work.key && selected.has(work.key)).map((work) => work.key as string), [selected, works])
  // What an action applies to: the ticked works, or every work shown.
  const targets = chosen.length ? chosen : shown.map((work) => work.key).filter((key): key is string => Boolean(key))

  const run = async (name: string, action: () => Promise<void>): Promise<void> => {
    setBusy(name)
    setNotice(null)
    try {
      await action()
    } catch (error) {
      setNotice({ kind: 'error', text: t(errorKey(errorCode(error))) })
    } finally {
      setBusy(null)
    }
  }

  const toggle = (key: string): void => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const searchOnline = (): Promise<void> => run('online', async () => {
    if (panel === 'online' && !query.trim()) return
    const response = panel === 'zotero' ? await client.zoteroReferences() : await client.searchReferences(query.trim(), 15)
    const rows = (response.payload as { works?: LibraryWork[] }).works ?? []
    const words = query.trim().toLowerCase()
    setFound(panel === 'zotero' ? rows.filter((row) => `${row.title} ${(row.authors ?? []).join(' ')} ${row.year ?? ''}`.toLowerCase().includes(words)) : rows)
  })

  const openZotero = (): Promise<void> => run('zotero', async () => {
    setPanel('zotero')
    setQuery('')
    const response = await client.zoteroReferences()
    setFound((response.payload as { works?: LibraryWork[] }).works ?? [])
  })

  const add = (ids: string[]): Promise<void> => run('add', async () => {
    if (!ids.length) return
    const response = await client.addReferences(ids)
    const added = (response.payload as { added?: number }).added ?? 0
    setNotice({ kind: 'info', text: t('library.added', { count: added }) })
    setFound((rows) => rows.filter((row) => !row.id || !ids.includes(row.id)))
    await load()
  })

  const importFiles = (): Promise<void> => run('import', async () => {
    const files = await window.agentWorkspace?.selectKnowledgeFiles?.(IMPORT_TYPES) ?? []
    let added = 0
    for (const file of files) {
      const response = await client.importReferences(file)
      added += (response.payload as { added?: number }).added ?? 0
    }
    if (files.length) {
      setNotice({ kind: 'info', text: t('library.imported', { count: added }) })
      await load()
    }
  })

  const copyList = (): Promise<void> => run('copy', async () => {
    const response = await client.exportReferences('list', { style, keys: targets })
    const text = (response.payload as { text?: string }).text ?? ''
    const copied = await window.agentWorkspace?.copyText?.(text)
    setNotice(copied ? { kind: 'info', text: t('library.copied', { count: targets.length }) } : { kind: 'error', text: t('library.error.failed') })
  })

  const save = (format: 'bibtex' | 'ris'): Promise<void> => run(format, async () => {
    const response = await client.exportReferences(format, { keys: targets, save: true })
    const path = (response.payload as { path?: string }).path
    if (!path) return
    setNotice({ kind: 'info', text: t('library.saved', { path }) })
    openWorkspaceFile(path)
  })

  const check = (): Promise<void> => run('check', async () => {
    const response = await client.checkReferences(targets)
    const payload = response.payload as { results?: Array<Check & { key: string }>; counts?: Record<string, number> }
    setChecks((current) => ({ ...current, ...Object.fromEntries((payload.results ?? []).map(({ key, ...rest }) => [key, rest])) }))
    const counts = payload.counts ?? {}
    setNotice({
      kind: 'info',
      text: t('library.checked', {
        verified: counts.verified ?? 0,
        mismatch: counts.mismatch ?? 0,
        missing: (counts.not_found ?? 0) + (counts.unverifiable ?? 0),
        retracted: counts.retracted ?? 0,
      }),
    })
  })

  const remove = (): Promise<void> => run('remove', async () => {
    setConfirming(false)
    const response = await client.removeReferences(chosen)
    const removed = (response.payload as { removed?: string[] }).removed ?? []
    setSelected(new Set())
    setNotice({ kind: 'info', text: t('library.removed', { count: removed.length }) })
    await load()
  })

  const spinner = (name: string) => (busy === name ? <Loader2 size={13} className="library-spin" aria-hidden="true" /> : null)

  return (
    <section className="reference-library" aria-label={t('library.title')}>
      <div className="library-toolbar" role="toolbar" aria-label={t('library.actions')}>
        <input type="search" className="library-filter" value={filter} maxLength={200} placeholder={t('library.filter')} aria-label={t('library.filter')} onChange={(event) => setFilter(event.target.value)} />
        <button type="button" className={`toolbar-action-btn ${panel === 'online' ? 'active' : ''}`} aria-pressed={panel === 'online'}
          onClick={() => { setPanel(panel === 'online' ? null : 'online'); setFound([]); setQuery('') }}>
          <Search size={13} /><span>{t('library.searchOnline')}</span>
        </button>
        <button type="button" className={`toolbar-action-btn ${panel === 'zotero' ? 'active' : ''}`} aria-pressed={panel === 'zotero'} disabled={busy !== null}
          onClick={() => (panel === 'zotero' ? setPanel(null) : void openZotero())}>
          {spinner('zotero') ?? <Library size={13} />}<span>{t('library.zotero')}</span>
        </button>
        <button type="button" className="toolbar-action-btn" disabled={busy !== null || !window.agentWorkspace?.selectKnowledgeFiles} onClick={() => void importFiles()}>
          {spinner('import') ?? <FileInput size={13} />}<span>{t('library.import')}</span>
        </button>
        <span className="library-spacer" />
        <label className="library-style">
          <span>{t('library.style')}</span>
          <select value={style} onChange={(event) => setStyle(event.target.value as (typeof STYLES)[number])}>
            {STYLES.map((entry) => <option key={entry} value={entry}>{t(`library.style.${entry}`)}</option>)}
          </select>
        </label>
        <button type="button" className="toolbar-action-btn" disabled={busy !== null || targets.length === 0} onClick={() => void copyList()}>
          {spinner('copy') ?? <ClipboardCopy size={13} />}<span>{t('library.copy')}</span>
        </button>
        <button type="button" className="toolbar-action-btn" disabled={busy !== null || targets.length === 0} onClick={() => void save('bibtex')}>
          {spinner('bibtex') ?? <Download size={13} />}<span>BibTeX</span>
        </button>
        <button type="button" className="toolbar-action-btn" disabled={busy !== null || targets.length === 0} onClick={() => void save('ris')}>
          {spinner('ris') ?? <Download size={13} />}<span>RIS</span>
        </button>
        <button type="button" className="toolbar-action-btn" disabled={busy !== null || targets.length === 0} onClick={() => void check()}>
          {spinner('check') ?? <ShieldCheck size={13} />}<span>{t('library.check')}</span>
        </button>
        <button type="button" className="toolbar-action-btn" disabled={busy !== null || chosen.length === 0} onClick={() => setConfirming(true)}>
          <Trash2 size={13} /><span>{t('library.remove')}</span>
        </button>
      </div>

      {confirming ? (
        <div className="library-confirm" role="alert">
          <span>{t('library.removeConfirm', { count: chosen.length })}</span>
          <button type="button" className="toolbar-action-btn danger" onClick={() => void remove()}>{t('library.remove')}</button>
          <button type="button" className="toolbar-action-btn" onClick={() => setConfirming(false)}>{t('library.cancel')}</button>
        </div>
      ) : null}

      {panel ? (
        <div className="library-panel" aria-label={panel === 'online' ? t('library.searchOnline') : t('library.zotero')}>
          <form className="library-search" onSubmit={(event) => { event.preventDefault(); void searchOnline() }}>
            <input type="search" value={query} maxLength={300} placeholder={panel === 'online' ? t('library.onlineHint') : t('library.filter')}
              aria-label={panel === 'online' ? t('library.onlineHint') : t('library.filter')} onChange={(event) => setQuery(event.target.value)} autoFocus />
            <button type="submit" className="toolbar-action-btn primary" disabled={busy !== null || (panel === 'online' && !query.trim())}>
              {spinner('online') ?? <Search size={13} />}<span>{t('library.find')}</span>
            </button>
          </form>
          <ul className="library-found">
            {found.map((work, index) => (
              <li key={work.id ?? `${work.title}:${index}`}>
                <div>
                  <strong>{work.title}</strong>
                  <small>{describe(work)}</small>
                  {work.retracted ? <small className="library-retracted">{t('library.retracted')}</small> : null}
                </div>
                <button type="button" className="toolbar-action-btn" disabled={busy !== null || !work.id} onClick={() => void add(work.id ? [work.id] : [])}>
                  {t('library.add')}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {notice ? <p className={notice.kind === 'error' ? 'route-error' : 'library-notice'} role="status">{notice.text}</p> : null}

      <div className="library-count">
        <label className="library-check">
          <input type="checkbox" checked={shown.length > 0 && shown.every((work) => work.key && selected.has(work.key))} aria-label={t('library.selectAll')}
            onChange={(event) => setSelected(event.target.checked ? new Set(shown.map((work) => work.key).filter((key): key is string => Boolean(key))) : new Set())} />
        </label>
        <span>{chosen.length ? t('library.selected', { count: chosen.length, total: works.length }) : t('library.count', { count: works.length })}</span>
      </div>

      {works.length === 0 ? (
        <div className="library-empty">
          <BookOpen size={22} aria-hidden="true" />
          <p>{t('library.empty')}</p>
        </div>
      ) : (
        <ul className="library-list" aria-label={t('library.title')}>
          {shown.map((work) => {
            const key = work.key ?? work.title
            const state = work.key ? checks[work.key] : undefined
            const expanded = open === key
            return (
              <li key={key} className={expanded ? 'open' : ''}>
                <div className="library-row">
                  <label className="library-check">
                    <input type="checkbox" checked={Boolean(work.key && selected.has(work.key))} aria-label={t('library.select', { title: work.title })}
                      onChange={() => work.key && toggle(work.key)} />
                  </label>
                  <button type="button" className="library-title" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : key)}>
                    {expanded ? <ChevronDown size={13} aria-hidden="true" /> : <ChevronRight size={13} aria-hidden="true" />}
                    <span>
                      <strong>{work.title}</strong>
                      <small>{describe(work)}</small>
                    </span>
                  </button>
                  {work.retracted || state?.status === 'retracted' ? <span className="library-badge bad">{t('library.retracted')}</span> : null}
                  {state && state.status !== 'retracted' ? (
                    <span className={`library-badge ${state.status === 'verified' ? 'good' : 'warn'}`}>{t(`library.status.${state.status === 'unverifiable' ? 'not_found' : state.status}` as MessageKey)}</span>
                  ) : null}
                  {work.key ? <code className="library-key">{work.key}</code> : null}
                </div>
                {expanded ? (
                  <div className="library-detail">
                    {state?.problems?.length ? <ul className="library-problems">{state.problems.map((problem) => <li key={problem}>{problem}</li>)}</ul> : null}
                    {work.abstract ? <p>{work.abstract}</p> : <p className="library-muted">{t('library.noAbstract')}</p>}
                    <div className="library-links">
                      {work.doi ? <button type="button" className="toolbar-action-btn" onClick={() => link(`https://doi.org/${work.doi}`)}>DOI {work.doi}</button> : null}
                      {work.pdf ? <button type="button" className="toolbar-action-btn" onClick={() => link(work.pdf as string)}>{t('library.pdf')}</button> : null}
                      {work.url && !work.doi ? <button type="button" className="toolbar-action-btn" onClick={() => link(work.url as string)}>{t('library.page')}</button> : null}
                      {work.arxiv ? <button type="button" className="toolbar-action-btn" onClick={() => link(`https://arxiv.org/abs/${work.arxiv}`)}>arXiv {work.arxiv}</button> : null}
                      {work.pmid ? <button type="button" className="toolbar-action-btn" onClick={() => link(`https://pubmed.ncbi.nlm.nih.gov/${work.pmid}/`)}>PubMed {work.pmid}</button> : null}
                    </div>
                  </div>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

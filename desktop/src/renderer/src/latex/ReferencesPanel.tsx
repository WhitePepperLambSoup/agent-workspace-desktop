import { Loader2, Search, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import { GatewayCommandError, type WorkbenchBridgeClient } from '../bridge/client'
import { useOptionalI18n } from '../i18n/I18nProvider'

export type ReferencesClient = Pick<
  WorkbenchBridgeClient,
  'listReferences' | 'searchReferences' | 'zoteroReferences' | 'addReferences' | 'citeReferences'
>

interface ReferenceRow {
  title: string
  authors?: string[]
  year?: number
  venue?: string
  doi?: string
  key?: string
  id?: string
  retracted?: boolean
}

type Source = 'library' | 'online' | 'zotero'

interface ReferencesPanelProps {
  client: ReferencesClient
  /** The .tex file being edited; its document's .bib file receives the entries. */
  path: string
  onCite(keys: string[]): void
  onClose(): void
}

function errorCode(error: unknown): string {
  return error instanceof GatewayCommandError ? error.code : 'failed'
}

export function ReferencesPanel({ client, path, onCite, onClose }: ReferencesPanelProps) {
  const { t } = useOptionalI18n()
  const [source, setSource] = useState<Source>('library')
  const [query, setQuery] = useState('')
  const [rows, setRows] = useState<ReferenceRow[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ kind: 'error' | 'info'; text: string } | null>(null)

  const load = useCallback(async (which: Source, text: string): Promise<void> => {
    if (which === 'online' && !text.trim()) {
      setRows([])
      return
    }
    setBusy(true)
    setMessage(null)
    try {
      const response = which === 'library'
        ? await client.listReferences(text.trim())
        : which === 'online'
          ? await client.searchReferences(text.trim())
          : await client.zoteroReferences()
      const works = (response.payload as { works?: ReferenceRow[] }).works ?? []
      const filtered = which === 'zotero' && text.trim()
        ? works.filter((row) => `${row.title} ${(row.authors ?? []).join(' ')} ${row.year ?? ''}`.toLowerCase().includes(text.trim().toLowerCase()))
        : works
      setRows(filtered)
    } catch (error) {
      const code = errorCode(error)
      setRows([])
      setMessage({
        kind: 'error',
        text: code === 'references_offline' ? t('latex.refs.offline')
          : code === 'zotero_unavailable' ? t('latex.refs.zoteroUnavailable')
            : t('latex.refs.failed'),
      })
    } finally {
      setBusy(false)
    }
  }, [client, t])

  useEffect(() => {
    if (source !== 'online') void load(source, '')
    else setRows([])
  }, [load, source])

  const cite = async (row: ReferenceRow): Promise<void> => {
    setBusy(true)
    setMessage(null)
    try {
      let key = row.key
      if (!key && row.id) {
        const added = await client.addReferences([row.id])
        key = ((added.payload as { works?: ReferenceRow[] }).works ?? [])[0]?.key
      }
      if (!key) throw new Error('no_key')
      const response = await client.citeReferences(path, [key])
      const result = response.payload as { bib?: string; bibliographyNamed?: boolean }
      onCite([key])
      setMessage({
        kind: 'info',
        text: result.bibliographyNamed === false
          ? t('latex.refs.noBibliography', { bib: result.bib ?? 'refs.bib' })
          : t('latex.refs.cited', { key, bib: result.bib ?? '' }),
      })
    } catch {
      setMessage({ kind: 'error', text: t('latex.refs.failed') })
    } finally {
      setBusy(false)
    }
  }

  return (
    <aside className="latex-refs" aria-label={t('latex.refs.title')}>
      <header>
        <div className="latex-refs-tabs" role="tablist">
          {(['library', 'online', 'zotero'] as const).map((which) => (
            <button key={which} type="button" role="tab" aria-selected={source === which} className={source === which ? 'active' : ''} onClick={() => setSource(which)}>
              {t(`latex.refs.${which}`)}
            </button>
          ))}
        </div>
        <button type="button" className="toolbar-action-btn" aria-label={t('latex.refs.close')} title={t('latex.refs.close')} onClick={onClose}><X size={13} /></button>
      </header>
      <form className="latex-refs-search" onSubmit={(event) => { event.preventDefault(); void load(source, query) }}>
        <input
          type="search"
          value={query}
          maxLength={300}
          aria-label={t('latex.refs.search')}
          placeholder={source === 'online' ? t('latex.refs.searchOnline') : t('latex.refs.search')}
          onChange={(event) => setQuery(event.target.value)}
        />
        <button type="submit" className="toolbar-action-btn" aria-label={t('latex.refs.search')} disabled={busy}>
          {busy ? <Loader2 size={13} className="latex-spin" /> : <Search size={13} />}
        </button>
      </form>
      {message ? <p className={message.kind === 'error' ? 'route-error' : 'latex-notice'} role="status">{message.text}</p> : null}
      <ul className="latex-refs-list">
        {rows.length === 0 && !busy ? <li className="latex-muted">{source === 'online' ? t('latex.refs.onlineHint') : t('latex.refs.empty')}</li> : null}
        {rows.map((row, index) => (
          <li key={row.id ?? row.key ?? `${row.title}:${index}`}>
            <div className="latex-refs-text">
              <strong>{row.title}</strong>
              <small>{[(row.authors ?? []).join(', '), row.year, row.venue].filter(Boolean).join(' · ')}</small>
              {row.retracted ? <small className="latex-refs-retracted">{t('latex.refs.retracted')}</small> : null}
            </div>
            <button type="button" className="toolbar-action-btn" disabled={busy} onClick={() => void cite(row)}>
              {t('latex.refs.cite')}
            </button>
          </li>
        ))}
      </ul>
    </aside>
  )
}

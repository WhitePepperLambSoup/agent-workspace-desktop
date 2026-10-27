import { Check, PencilLine, RefreshCw, Search, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import type { WorkbenchBridgeClient } from '../bridge/client'
import { useOptionalI18n } from '../i18n/I18nProvider'
import type { MessageKey } from '../i18n/messages'

export interface MemoryRecord {
  id: string
  content: string
  tags: string[]
  updatedAt: string | null
  expiresAt: string | null
}

type MemoryClient = Pick<WorkbenchBridgeClient, 'listMemories' | 'updateMemory' | 'deleteMemory'>

function parseMemories(payload: unknown): { memories: MemoryRecord[]; truncated: boolean } {
  const value = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
  const raw = Array.isArray(value.memories) ? value.memories : []
  const memories = raw.flatMap((item): MemoryRecord[] => {
    if (!item || typeof item !== 'object') return []
    const record = item as Record<string, unknown>
    if (typeof record.id !== 'string' || typeof record.content !== 'string') return []
    return [{
      id: record.id,
      content: record.content,
      tags: Array.isArray(record.tags) ? record.tags.filter((tag): tag is string => typeof tag === 'string') : [],
      updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : null,
      expiresAt: typeof record.expiresAt === 'string' ? record.expiresAt : null,
    }]
  })
  return { memories, truncated: value.truncated === true }
}

function errorCode(reason: unknown): string | null {
  return reason && typeof reason === 'object' && 'code' in reason && typeof reason.code === 'string' ? reason.code : null
}

/** Lists, edits and deletes the open workspace's long-term memory. */
export function MemoryManager({ client, workspaceKey }: { client?: Partial<MemoryClient>; workspaceKey: string | null }) {
  const { locale, t } = useOptionalI18n()
  const [query, setQuery] = useState('')
  const [memories, setMemories] = useState<MemoryRecord[] | null>(null)
  const [truncated, setTruncated] = useState(false)
  const [error, setError] = useState<MessageKey | null>(null)
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState<{ id: string; content: string; tags: string } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const available = Boolean(client?.listMemories && workspaceKey)

  const load = useCallback(async (search: string): Promise<void> => {
    if (!client?.listMemories) return
    setLoading(true)
    try {
      const parsed = parseMemories((await client.listMemories(search.trim())).payload)
      setMemories(parsed.memories)
      setTruncated(parsed.truncated)
      setError(null)
    } catch {
      setError('memory.loadFailed')
    } finally {
      setLoading(false)
    }
  }, [client])

  useEffect(() => {
    setMemories(null)
    setEditing(null)
    setConfirmDelete(null)
    if (!available) return
    const timer = setTimeout(() => void load(query), query ? 200 : 0)
    return () => clearTimeout(timer)
  }, [available, load, query, workspaceKey])

  const save = async (): Promise<void> => {
    if (!editing || !client?.updateMemory || busy) return
    const content = editing.content.trim()
    if (!content) return
    const tags = editing.tags.split(',').map((tag) => tag.trim()).filter(Boolean)
    setBusy(editing.id)
    try {
      await client.updateMemory(editing.id, content, tags)
      setEditing(null)
      await load(query)
    } catch (reason) {
      setError(errorCode(reason) === 'session_required' ? 'memory.sessionRequired' : 'memory.saveFailed')
    } finally {
      setBusy(null)
    }
  }

  const remove = async (id: string): Promise<void> => {
    if (!client?.deleteMemory || busy) return
    setBusy(id)
    try {
      await client.deleteMemory(id)
      setConfirmDelete(null)
      setMemories((current) => current?.filter((memory) => memory.id !== id) ?? null)
    } catch (reason) {
      setError(errorCode(reason) === 'session_required' ? 'memory.sessionRequired' : 'memory.deleteFailed')
    } finally {
      setBusy(null)
    }
  }

  const date = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' })
  const formatDate = (value: string | null): string => {
    if (!value) return ''
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? value : date.format(parsed)
  }

  return (
    <section className="route-section memory-manager" aria-labelledby="memory-heading">
      <header>
        <div>
          <h2 id="memory-heading">{t('memory.title')}</h2>
          <span>{t('memory.description')}</span>
        </div>
        <button type="button" className="icon-button" aria-label={t('memory.refresh')} title={t('memory.refresh')}
          disabled={!available || loading} aria-busy={loading} onClick={() => void load(query)}><RefreshCw size={14} /></button>
      </header>
      {!available ? <p className="route-note">{t('memory.unavailable')}</p> : <>
        <label className="route-search memory-search"><Search size={14} aria-hidden="true" />
          <input type="search" aria-label={t('memory.search')} placeholder={t('memory.search')} value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>
        {error ? <p role="status" className="route-error">{t(error)}</p> : null}
        {memories === null ? <p className="route-note" role="status">{t('memory.loading')}</p>
          : memories.length === 0 ? <p className="route-note">{t(query ? 'memory.noMatches' : 'memory.empty')}</p>
            : <ul className="memory-list">
              {memories.map((memory) => (
                <li key={memory.id} className="memory-item" data-editing={editing?.id === memory.id ? 'true' : undefined}>
                  {editing?.id === memory.id ? (
                    <form className="memory-edit" onSubmit={(event) => { event.preventDefault(); void save() }}>
                      <textarea aria-label={t('memory.content')} value={editing.content} maxLength={10_000} rows={4}
                        onChange={(event) => setEditing({ ...editing, content: event.target.value })} />
                      <input aria-label={t('memory.tags')} value={editing.tags} placeholder={t('memory.tagsPlaceholder')}
                        onChange={(event) => setEditing({ ...editing, tags: event.target.value })} />
                      <div className="memory-actions">
                        <button type="submit" className="memory-primary" disabled={busy === memory.id || !editing.content.trim()}><Check size={14} /><span>{t('memory.save')}</span></button>
                        <button type="button" onClick={() => setEditing(null)}><X size={14} /><span>{t('memory.cancel')}</span></button>
                      </div>
                    </form>
                  ) : <>
                    <p className="memory-content">{memory.content}</p>
                    <div className="memory-meta">
                      {memory.tags.map((tag) => <span className="memory-tag" key={tag}>{tag}</span>)}
                      {memory.updatedAt ? <time dateTime={memory.updatedAt}>{formatDate(memory.updatedAt)}</time> : null}
                      {memory.expiresAt ? <span className="memory-expiry">{t('memory.expires', { date: formatDate(memory.expiresAt) })}</span> : null}
                    </div>
                    <div className="memory-actions">
                      {confirmDelete === memory.id ? <>
                        <span role="status">{t('memory.confirmDelete')}</span>
                        <button type="button" className="memory-danger" disabled={busy === memory.id} onClick={() => void remove(memory.id)}><Trash2 size={14} /><span>{t('memory.delete')}</span></button>
                        <button type="button" onClick={() => setConfirmDelete(null)}><span>{t('memory.cancel')}</span></button>
                      </> : <>
                        <button type="button" aria-label={t('memory.editItem')} title={t('memory.editItem')} disabled={!client?.updateMemory}
                          onClick={() => { setConfirmDelete(null); setEditing({ id: memory.id, content: memory.content, tags: memory.tags.join(', ') }) }}><PencilLine size={14} /></button>
                        <button type="button" aria-label={t('memory.deleteItem')} title={t('memory.deleteItem')} disabled={!client?.deleteMemory}
                          onClick={() => { setEditing(null); setConfirmDelete(memory.id) }}><Trash2 size={14} /></button>
                      </>}
                    </div>
                  </>}
                </li>
              ))}
            </ul>}
        {truncated ? <p className="route-note">{t('memory.truncated')}</p> : null}
      </>}
    </section>
  )
}

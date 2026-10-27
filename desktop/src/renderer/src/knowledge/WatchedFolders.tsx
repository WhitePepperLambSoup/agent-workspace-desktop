import { FolderPlus, FolderSync, RefreshCw, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import type { WorkbenchBridgeClient } from '../bridge/client'
import { useOptionalI18n } from '../i18n/I18nProvider'
import type { KnowledgeCollection } from './model'

export type WatchClient = Pick<WorkbenchBridgeClient, 'listWatchedFolders' | 'watchFolder' | 'unwatchFolder' | 'scanWatchedFolders'>

interface WatchedFolderView {
  path: string
  collectionId: string
  lastScan: string | null
  added: number
  error: string | null
}

interface SuggestedFolder {
  label: string
  path: string
}

function folders(value: unknown): WatchedFolderView[] {
  return Array.isArray(value) ? value.flatMap((item: unknown) => {
    const folder = item && typeof item === 'object' ? item as Record<string, unknown> : null
    return folder && typeof folder.path === 'string' && typeof folder.collectionId === 'string'
      ? [{
          path: folder.path,
          collectionId: folder.collectionId,
          lastScan: typeof folder.lastScan === 'string' ? folder.lastScan : null,
          added: typeof folder.added === 'number' ? folder.added : 0,
          error: typeof folder.error === 'string' ? folder.error : null,
        }]
      : []
  }) : []
}

function suggestions(value: unknown): SuggestedFolder[] {
  return Array.isArray(value) ? value.flatMap((item: unknown) => {
    const folder = item && typeof item === 'object' ? item as Record<string, unknown> : null
    return folder && typeof folder.path === 'string' && typeof folder.label === 'string' ? [{ label: folder.label, path: folder.path }] : []
  }) : []
}

/** Folders whose new documents join a knowledge base by themselves (WeChat or QQ downloads, say). */
export function WatchedFolders({ client, collections, target, label, onChanged }: {
  client?: Partial<WatchClient>
  collections: readonly KnowledgeCollection[]
  target: string
  label: (collection: KnowledgeCollection) => string
  onChanged: () => void
}) {
  const { locale, t } = useOptionalI18n()
  const [watched, setWatched] = useState<WatchedFolderView[] | null>(null)
  const [offered, setOffered] = useState<SuggestedFolder[]>([])
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  const load = useCallback(async (): Promise<void> => {
    if (!client?.listWatchedFolders) return
    try {
      const payload = (await client.listWatchedFolders()).payload as Record<string, unknown>
      setWatched(folders(payload.folders))
      setOffered(suggestions(payload.suggested))
    } catch {
      setNotice({ tone: 'error', text: t('knowledge.watch.failed') })
    }
  }, [client, t])

  useEffect(() => { void load() }, [load])

  if (!client?.listWatchedFolders || watched === null) return null
  const names = new Map(collections.map((collection) => [collection.id, label(collection)]))

  const act = async (action: () => Promise<unknown>, success?: () => string): Promise<void> => {
    setBusy(true)
    setNotice(null)
    try {
      await action()
      if (success) setNotice({ tone: 'ok', text: success() })
      await load()
      onChanged()
    } catch {
      setNotice({ tone: 'error', text: t('knowledge.watch.failed') })
    } finally {
      setBusy(false)
    }
  }

  const watch = (path: string): void => {
    if (!client.watchFolder) return
    void act(() => client.watchFolder!(path, target))
  }

  const pick = async (): Promise<void> => {
    const path = await window.agentWorkspace?.selectWorkspace?.()
    if (path) watch(path)
  }

  const scan = (): void => {
    if (!client.scanWatchedFolders) return
    let added = 0
    let waiting = 0
    void act(async () => {
      const payload = (await client.scanWatchedFolders!()).payload as Record<string, unknown>
      added = typeof payload.added === 'number' ? payload.added : 0
      waiting = typeof payload.waiting === 'number' ? payload.waiting : 0
    }, () => t('knowledge.watch.scanned', { added, waiting }))
  }

  const known = new Set(watched.map((folder) => folder.path.toLocaleLowerCase()))
  const unwatched = offered.filter((folder) => !known.has(folder.path.toLocaleLowerCase()))

  return (
    <section className="route-section knowledge-watch" aria-labelledby="knowledge-watch">
      <header>
        <div><h2 id="knowledge-watch">{t('knowledge.watch.title')}</h2><span>{t('knowledge.watch.hint')}</span></div>
        {watched.length > 0 ? <button type="button" className="secondary-button" disabled={busy} onClick={scan}><RefreshCw size={13} />{t('knowledge.watch.scan')}</button> : null}
      </header>
      {notice ? <p role="status" className={notice.tone === 'error' ? 'route-error' : 'route-note knowledge-ok'}>{notice.text}</p> : null}
      {watched.length > 0 ? (
        <ul className="knowledge-list">
          {watched.map((folder) => (
            <li key={folder.path} className="knowledge-row">
              <div className="knowledge-row-main">
                <strong title={folder.path}>{folder.path}</strong>
                <small>
                  {names.get(folder.collectionId) ?? folder.collectionId} · {folder.error === 'missing' ? t('knowledge.watch.missing')
                    : folder.error === 'full' ? t('knowledge.watch.full')
                    : t('knowledge.watch.stats', {
                      added: folder.added,
                      time: folder.lastScan ? new Date(folder.lastScan).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' }) : t('knowledge.watch.never'),
                    })}
                </small>
              </div>
              <div className="knowledge-row-actions">
                <button type="button" className="icon-button" aria-label={t('knowledge.watch.remove')} title={t('knowledge.watch.remove')} disabled={busy}
                  onClick={() => { if (client.unwatchFolder) void act(() => client.unwatchFolder!(folder.path)) }}><Trash2 size={14} /></button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      {unwatched.length > 0 ? (
        <div className="knowledge-watch-offered">
          <small>{t('knowledge.watch.suggested')}</small>
          <ul className="knowledge-list">
            {unwatched.map((folder) => (
              <li key={folder.path} className="knowledge-row">
                <div className="knowledge-row-main">
                  <strong>{t(folder.label === 'QQ' ? 'knowledge.watch.suggestQQ' : 'knowledge.watch.suggestWeChat')}</strong>
                  <small title={folder.path}>{folder.path}</small>
                </div>
                <div className="knowledge-row-actions">
                  <button type="button" className="secondary-button" disabled={busy} onClick={() => watch(folder.path)}><FolderSync size={13} />{t('knowledge.watch.watch')}</button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {window.agentWorkspace ? (
        <button type="button" className="secondary-button" disabled={busy} onClick={() => void pick()}>
          <FolderPlus size={13} />{t('knowledge.watch.add', { base: names.get(target) ?? target })}
        </button>
      ) : null}
    </section>
  )
}

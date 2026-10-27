import { BookOpen } from 'lucide-react'
import { useEffect, useState } from 'react'

import type { WorkbenchBridgeClient } from '../bridge/client'
import { useOptionalI18n } from '../i18n/I18nProvider'
import { collectionLabel, KNOWLEDGE_CHANGED_EVENT, parseSelection, type KnowledgeSelection } from './model'
import './knowledge.css'

export type KnowledgeSessionClient = Pick<WorkbenchBridgeClient, 'knowledgeSession' | 'setKnowledgeSession'>

/**
 * Which knowledge bases this conversation searches; the default ones until the user chooses.
 * Read again when refreshKey changes (a turn ran) and after the Knowledge page changed something.
 */
export function KnowledgeSessionSection({ sessionId, client, refreshKey = '' }: { sessionId: string | null; client?: Partial<KnowledgeSessionClient>; refreshKey?: string }) {
  const { t } = useOptionalI18n()
  const [selection, setSelection] = useState<KnowledgeSelection | null>(null)
  const [failed, setFailed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [changes, setChanges] = useState(0)

  useEffect(() => {
    const changed = (): void => setChanges((value) => value + 1)
    window.addEventListener(KNOWLEDGE_CHANGED_EVENT, changed)
    return () => window.removeEventListener(KNOWLEDGE_CHANGED_EVENT, changed)
  }, [])

  useEffect(() => {
    setSelection(null)
    setFailed(false)
  }, [client, sessionId])

  useEffect(() => {
    if (!sessionId || !client?.knowledgeSession) return
    let active = true
    client.knowledgeSession(sessionId)
      .then((response) => { if (active) { setSelection(parseSelection(response.payload)); setFailed(false) } })
      .catch(() => { if (active) setFailed(true) })
    return () => { active = false }
  }, [changes, client, refreshKey, sessionId])

  if (!sessionId || !client?.knowledgeSession || (!selection && !failed)) return null
  const choose = async (collections: string[] | null): Promise<void> => {
    if (!client.setKnowledgeSession || saving) return
    setSaving(true)
    setFailed(false)
    try {
      setSelection(parseSelection((await client.setKnowledgeSession(sessionId, collections)).payload))
    } catch {
      setFailed(true)
    } finally {
      setSaving(false)
    }
  }
  const withDocuments = selection?.available.filter((item) => item.documents > 0) ?? []

  return <section className="inspector-section knowledge-session" aria-labelledby="knowledge-session-title">
    <h3 id="knowledge-session-title"><BookOpen size={13} /><span>{t('knowledge.sessionTitle')}</span></h3>
    {failed ? <p role="status" className="route-error">{t('knowledge.sessionFailed')}</p> : null}
    {selection && !selection.enabled ? <p className="inspector-empty-text">{t('knowledge.sessionOff')}</p> : null}
    {selection?.enabled && withDocuments.length === 0 ? <p className="inspector-empty-text">{t('knowledge.sessionEmpty')}</p> : null}
    {selection?.enabled && withDocuments.length > 0 ? <>
      <div className="knowledge-session-options">
        {withDocuments.map((collection) => {
          const checked = selection.collections.includes(collection.id)
          return <label key={collection.id} className="knowledge-check">
            <input
              type="checkbox"
              checked={checked}
              disabled={saving}
              onChange={() => void choose(checked
                ? selection.collections.filter((id) => id !== collection.id)
                : [...selection.collections, collection.id])}
            />
            <span>{collectionLabel(collection, t('knowledge.defaultBase'))}</span>
            <small>{t('knowledge.baseCount', { count: collection.ready })}</small>
          </label>
        })}
      </div>
      {selection.explicit
        ? <button type="button" className="secondary-button" disabled={saving} onClick={() => void choose(null)}>{t('knowledge.sessionUseDefault')}</button>
        : <p className="inspector-empty-text">{t('knowledge.sessionDefault')}</p>}
    </> : null}
  </section>
}

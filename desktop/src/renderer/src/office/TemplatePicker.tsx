import { FileSpreadsheet, FileText, FolderOpen, Loader2, Presentation, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import type { WorkbenchBridgeClient } from '../bridge/client'
import { useOptionalI18n } from '../i18n/I18nProvider'
import './templates.css'

export type TemplateClient = Pick<WorkbenchBridgeClient, 'listTemplates' | 'createFromTemplate' | 'openTemplatesFolder'>

export interface DocumentTemplate {
  id: string
  name: string
  category: string
  kind: 'docx' | 'xlsx' | 'pptx'
  fields: string[]
  source: 'builtin' | 'user'
}

const MAX_FIELDS = 40

function kindIcon(kind: DocumentTemplate['kind']) {
  if (kind === 'xlsx') return <FileSpreadsheet size={14} aria-hidden />
  if (kind === 'pptx') return <Presentation size={14} aria-hidden />
  return <FileText size={14} aria-hidden />
}

/** Built-in templates (official documents, forms, letters, reports, workbooks) and the user's
 * own: pick one, fill its fields, and a new file is made in the open folder. */
export function TemplatePicker({ client, onCreated, onClose }: {
  client: TemplateClient
  onCreated: (path: string) => void
  onClose: () => void
}) {
  const { t } = useOptionalI18n()
  const [templates, setTemplates] = useState<DocumentTemplate[] | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [values, setValues] = useState<Record<string, string>>({})
  const [folder, setFolder] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null)

  const load = (): void => {
    setLoadFailed(false)
    client.listTemplates()
      .then((response) => {
        const listed = (response.payload as { templates?: DocumentTemplate[] }).templates
        setTemplates(Array.isArray(listed) ? listed : [])
      })
      .catch(() => setLoadFailed(true))
  }

  useEffect(load, [client])

  const groups = useMemo(() => {
    const out = new Map<string, DocumentTemplate[]>()
    for (const item of templates ?? []) {
      const list = out.get(item.category) ?? []
      list.push(item)
      out.set(item.category, list)
    }
    return [...out.entries()]
  }, [templates])

  const current = templates?.find((item) => item.id === selected) ?? null

  const choose = (id: string): void => {
    setSelected(id)
    setValues({})
    setMessage(null)
  }

  const create = async (): Promise<void> => {
    if (!current) return
    setBusy(true)
    setMessage(null)
    try {
      const filled = Object.fromEntries(Object.entries(values).filter(([, value]) => value.trim()))
      const response = await client.createFromTemplate(current.id, filled, folder.trim())
      const path = (response.payload as { path?: string }).path
      if (path) {
        setMessage({ text: t('templates.created', { path }), error: false })
        onCreated(path)
      }
    } catch {
      setMessage({ text: t('templates.createFailed'), error: true })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="template-picker" aria-label={t('templates.title')}>
      <header className="template-picker-header">
        <h2>{t('templates.title')}</h2>
        <button type="button" className="toolbar-action-btn" onClick={() => void client.openTemplatesFolder().catch(() => undefined)} title={t('templates.ownHint', { example: '{{姓名}}' })}>
          <FolderOpen size={14} aria-hidden />{t('templates.own')}
        </button>
        <button type="button" className="icon-button" aria-label={t('templates.cancel')} onClick={onClose}>
          <X size={14} aria-hidden />
        </button>
      </header>
      <p className="template-picker-note">{t('templates.ownHint', { example: '{{姓名}}' })}</p>
      {templates === null && !loadFailed ? (
        <p className="template-picker-note"><Loader2 size={14} className="template-spin" aria-hidden /> {t('templates.loading')}</p>
      ) : null}
      {loadFailed ? (
        <p className="route-error" role="status">
          {t('templates.loadFailed')} <button type="button" className="link-button" onClick={load}>{t('templates.retry')}</button>
        </p>
      ) : null}
      {templates ? (
        <div className="template-picker-body">
          <nav className="template-list" aria-label={t('templates.choose')}>
            {groups.map(([category, items]) => (
              <div key={category} className="template-group">
                <h3>{category}</h3>
                {items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`template-item${item.id === selected ? ' active' : ''}`}
                    aria-pressed={item.id === selected}
                    onClick={() => choose(item.id)}
                  >
                    {kindIcon(item.kind)}<span>{item.name}</span>
                  </button>
                ))}
              </div>
            ))}
          </nav>
          <form className="template-form" onSubmit={(event) => { event.preventDefault(); void create() }}>
            {current ? (
              <>
                <h3>{current.name}</h3>
                {current.fields.length ? (
                  <>
                    <p className="template-picker-note">{t('templates.fieldsHint')}</p>
                    <div className="template-fields">
                      {current.fields.slice(0, MAX_FIELDS).map((field) => (
                        <label key={field}>
                          <span>{field}</span>
                          <input
                            type="text"
                            maxLength={2000}
                            value={values[field] ?? ''}
                            onChange={(event) => setValues({ ...values, [field]: event.target.value })}
                          />
                        </label>
                      ))}
                    </div>
                  </>
                ) : <p className="template-picker-note">{t('templates.noFields')}</p>}
                <label className="template-folder">
                  <span>{t('templates.folder')}</span>
                  <input type="text" maxLength={500} value={folder} placeholder={t('templates.folderHint')} onChange={(event) => setFolder(event.target.value)} />
                </label>
                <div className="template-actions">
                  <button type="submit" className="toolbar-action-btn primary" disabled={busy}>{t('templates.create')}</button>
                  <button type="button" className="toolbar-action-btn" onClick={onClose}>{t('templates.cancel')}</button>
                </div>
              </>
            ) : <p className="template-picker-note">{t('templates.choose')}</p>}
            {message ? <p className={message.error ? 'route-error' : 'template-picker-note'} role="status">{message.text}</p> : null}
          </form>
        </div>
      ) : null}
    </section>
  )
}

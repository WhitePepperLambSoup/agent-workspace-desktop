import { Braces, Download } from 'lucide-react'
import { useEffect, useState } from 'react'

import type { WorkbenchBridgeClient } from '../bridge/client'
import { setCodeCompletion, useCodeCompletion } from '../editor/code-assist'
import { useI18n, type I18nValue } from '../i18n/I18nProvider'

type CodeClient = Pick<WorkbenchBridgeClient, 'codeServers' | 'installCodeServer'>

interface ServerRow {
  id: string
  name: string
  extensions: string[]
  available: boolean
  source: 'path' | 'installed' | null
  installable: boolean
  hint: string
}

function serversFrom(payload: Record<string, unknown>): ServerRow[] | null {
  if (!Array.isArray(payload.servers)) return null
  const rows: ServerRow[] = []
  for (const raw of payload.servers) {
    if (!raw || typeof raw !== 'object') continue
    const item = raw as Record<string, unknown>
    if (typeof item.id !== 'string' || typeof item.name !== 'string') continue
    rows.push({
      id: item.id,
      name: item.name,
      extensions: Array.isArray(item.extensions) ? item.extensions.filter((value): value is string => typeof value === 'string') : [],
      available: item.available === true,
      source: item.source === 'path' || item.source === 'installed' ? item.source : null,
      installable: item.installable === true,
      hint: typeof item.hint === 'string' ? item.hint : '',
    })
  }
  return rows
}

function CodeSettingsView({ client, i18n }: { client: CodeClient; i18n: I18nValue }) {
  const { t } = i18n
  const [servers, setServers] = useState<ServerRow[] | null>(null)
  const [installing, setInstalling] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ kind: 'done' | 'failed' | 'unavailable'; name?: string } | null>(null)
  const completion = useCodeCompletion()

  useEffect(() => {
    let active = true
    client.codeServers()
      .then((response) => {
        if (!active) return
        const rows = response.type === 'code.servers.result' ? serversFrom(response.payload) : null
        if (rows) setServers(rows)
        else setNotice({ kind: 'unavailable' })
      })
      .catch(() => { if (active) setNotice({ kind: 'unavailable' }) })
    return () => { active = false }
  }, [client])

  const install = (server: ServerRow): void => {
    setInstalling(server.id)
    setNotice(null)
    client.installCodeServer(server.id)
      .then((response) => {
        const rows = response.type === 'code.servers.install.result' ? serversFrom(response.payload) : null
        if (rows) {
          setServers(rows)
          setNotice({ kind: 'done', name: server.name })
        } else setNotice({ kind: 'failed' })
      })
      .catch(() => setNotice({ kind: 'failed' }))
      .finally(() => setInstalling(null))
  }

  return (
    <section className="settings-section code-settings" aria-labelledby="code-settings-heading">
      <header className="doctor-header">
        <div>
          <h2 id="code-settings-heading">{t('settings.code.title')}</h2>
          <p>{t('settings.code.description')}</p>
        </div>
        <Braces size={16} aria-hidden="true" />
      </header>
      {servers ? (
        <ul className="code-server-list">
          {servers.map((server) => (
            <li key={server.id} data-server={server.id} data-available={server.available ? 'true' : 'false'}>
              <span className="code-server-text">
                <span className="code-server-name">{server.name}</span>
                <span className="code-server-files">{t('settings.code.files', { extensions: server.extensions.join(' ') })}</span>
              </span>
              <span className="code-server-state">
                {server.available
                  ? t(server.source === 'installed' ? 'settings.code.installedHere' : 'settings.code.onComputer')
                  : t('settings.code.missing')}
              </span>
              {!server.available && server.installable ? (
                <button type="button" className="provider-secondary" disabled={installing !== null} onClick={() => install(server)}>
                  <Download size={13} aria-hidden="true" />
                  {installing === server.id ? t('settings.code.installing') : t('settings.code.install')}
                </button>
              ) : null}
              {!server.available && !server.installable && server.hint ? (
                <span className="code-server-hint">{t('settings.code.hint', { hint: server.hint })}</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      <label className="settings-toggle code-completion-toggle">
        <input type="checkbox" role="switch" checked={completion} onChange={(event) => setCodeCompletion(event.target.checked)} />
        <span>{t('settings.code.completion')}</span>
      </label>
      <p className="provider-hint">{t('settings.code.editorHint')}</p>
      {notice ? (
        <p className={`provider-status${notice.kind === 'done' ? '' : ' provider-status-error'}`} role="status">
          {notice.kind === 'done'
            ? t('settings.code.installedNotice', { name: notice.name ?? '' })
            : t(notice.kind === 'failed' ? 'settings.code.failed' : 'settings.code.unavailable')}
        </p>
      ) : null}
    </section>
  )
}

function LocalizedCodeSettings({ client }: { client: CodeClient }) {
  return <CodeSettingsView client={client} i18n={useI18n()} />
}

export function CodeSettings({ client, i18n }: { client: CodeClient; i18n?: I18nValue }) {
  return i18n ? <CodeSettingsView client={client} i18n={i18n} /> : <LocalizedCodeSettings client={client} />
}

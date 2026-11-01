import { AlertTriangle, Archive, FolderOpen, HardDrive, LoaderCircle, RotateCcw } from 'lucide-react'
import { useCallback, useEffect, useState, type ReactNode } from 'react'

import type { WorkbenchBridgeClient } from '../bridge/client'
import { useI18n, useOptionalI18n, type I18nValue } from '../i18n/I18nProvider'
import type { MessageKey } from '../i18n/messages'

import './setup-guide.css'

type DataClient = Pick<WorkbenchBridgeClient, 'dataStatus' | 'backupNow' | 'restoreBackup' | 'startFresh'>

export interface DataBackup {
  name: string
  createdAt: string
  bytes: number
}

export interface DataStatus {
  folder: string
  health: 'ok' | 'damaged' | 'missing'
  usage: { conversations: number; backups: number; other: number }
  backups: readonly DataBackup[]
  lastRestore: { ok: boolean; backup: string | null } | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function dataStatusFrom(payload: unknown): DataStatus | null {
  if (!isRecord(payload) || typeof payload.folder !== 'string' || !isRecord(payload.usage) || !Array.isArray(payload.backups)) return null
  const number = (value: unknown): number => (typeof value === 'number' ? value : 0)
  const last = payload.lastRestore
  return {
    folder: payload.folder,
    health: payload.health === 'damaged' ? 'damaged' : payload.health === 'missing' ? 'missing' : 'ok',
    usage: { conversations: number(payload.usage.conversations), backups: number(payload.usage.backups), other: number(payload.usage.other) },
    backups: payload.backups.filter(isRecord).map((item) => ({ name: String(item.name), createdAt: String(item.createdAt), bytes: number(item.bytes) })),
    lastRestore: isRecord(last) ? { ok: last.ok === true, backup: typeof last.backup === 'string' ? last.backup : null } : null,
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = -1
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`
}

function backupDate(backup: DataBackup, locale: string): string {
  const date = new Date(backup.createdAt)
  return Number.isNaN(date.getTime()) ? backup.createdAt : date.toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })
}

const ERROR_KEYS: Record<string, MessageKey> = {
  runtime_busy: 'settings.data.error.busy',
  backup_damaged: 'settings.data.error.backupDamaged',
  backup_failed: 'settings.data.error.backupFailed',
  database_missing: 'settings.data.error.nothingYet',
}

function errorKey(error: unknown): MessageKey {
  const code = isRecord(error) && typeof error.code === 'string' ? error.code : error instanceof Error ? error.message : ''
  return ERROR_KEYS[code] ?? 'settings.data.error.failed'
}

/** The app starts again, so that the next start can put the backup back. */
function restartNow(): void {
  void window.agentWorkspace?.desktop?.relaunch?.()
}

function DataSettingsView({ client, i18n, confirmRestore }: { client: DataClient; i18n: I18nValue; confirmRestore: (message: string) => boolean }) {
  const { t, locale } = i18n
  const [status, setStatus] = useState<DataStatus | null>(null)
  const [busy, setBusy] = useState<'backup' | 'restore' | null>(null)
  const [error, setError] = useState<MessageKey | null>(null)
  const [saved, setSaved] = useState(false)

  const reload = useCallback(async (): Promise<void> => {
    const response = await client.dataStatus()
    setStatus(dataStatusFrom(response.payload))
  }, [client])

  useEffect(() => {
    void reload().catch(() => setError('settings.data.error.failed'))
  }, [reload])

  const backupNow = async (): Promise<void> => {
    if (busy) return
    setBusy('backup')
    setError(null)
    setSaved(false)
    try {
      await client.backupNow()
      await reload()
      setSaved(true)
    } catch (reason) {
      setError(errorKey(reason))
    } finally {
      setBusy(null)
    }
  }

  const restore = async (backup: DataBackup): Promise<void> => {
    if (busy || !confirmRestore(t('settings.data.restoreConfirm', { date: backupDate(backup, locale) }))) return
    setBusy('restore')
    setError(null)
    try {
      await client.restoreBackup(backup.name)
      restartNow()
    } catch (reason) {
      setError(errorKey(reason))
      setBusy(null)
    }
  }

  return (
    <section className="settings-section data-settings" aria-labelledby="data-heading">
      <header className="doctor-header">
        <div>
          <h2 id="data-heading">{t('settings.data.title')}</h2>
          <p>{t('settings.data.description')}</p>
        </div>
        <HardDrive size={16} aria-hidden="true" />
      </header>
      {status ? (
        <dl className="fact-list" data-testid="data-usage">
          <div><dt>{t('settings.data.usage.conversations')}</dt><dd>{formatBytes(status.usage.conversations)}</dd></div>
          <div><dt>{t('settings.data.usage.backups')}</dt><dd>{formatBytes(status.usage.backups)}</dd></div>
          <div><dt>{t('settings.data.usage.other')}</dt><dd>{formatBytes(status.usage.other)}</dd></div>
        </dl>
      ) : null}
      {status?.lastRestore ? (
        <p className="provider-status" role="status">{t(status.lastRestore.ok ? 'settings.data.restored' : 'settings.data.restoreFailed')}</p>
      ) : null}
      <div className="provider-actions">
        <button type="button" className="provider-primary" disabled={busy !== null} aria-busy={busy === 'backup'} onClick={() => void backupNow()}>
          {busy === 'backup' ? <LoaderCircle className="provider-spinner" size={14} aria-hidden="true" /> : <Archive size={14} aria-hidden="true" />}
          <span>{t(busy === 'backup' ? 'settings.data.backingUp' : 'settings.data.backupNow')}</span>
        </button>
        {status ? (
          <button type="button" onClick={() => void window.agentWorkspace?.openPath?.(status.folder)}>
            <FolderOpen size={14} aria-hidden="true" />
            <span>{t('settings.data.openFolder')}</span>
          </button>
        ) : null}
      </div>
      {saved ? <p className="provider-status provider-status-success" role="status">{t('settings.data.backedUp')}</p> : null}
      {error ? <p className="provider-status provider-status-error" role="alert">{t(error)}</p> : null}
      <h3 className="about-subheading">{t('settings.data.backups')}</h3>
      {status && status.backups.length === 0 ? <p>{t('settings.data.noBackups')}</p> : null}
      <ul className="data-backups" data-testid="data-backups">
        {status?.backups.map((backup) => (
          <li key={backup.name}>
            <span>{backupDate(backup, locale)}</span>
            <small>{formatBytes(backup.bytes)}</small>
            <span className="provider-actions">
              <button type="button" disabled={busy !== null} onClick={() => void restore(backup)}>
                <RotateCcw size={13} aria-hidden="true" />
                <span>{t('settings.data.restore')}</span>
              </button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function LocalizedDataSettings(props: { client: DataClient; confirmRestore: (message: string) => boolean }) {
  return <DataSettingsView {...props} i18n={useI18n()} />
}

export function DataSettings({ client, i18n, confirmRestore = (message) => window.confirm(message) }: { client: DataClient; i18n?: I18nValue; confirmRestore?: (message: string) => boolean }) {
  return i18n
    ? <DataSettingsView client={client} i18n={i18n} confirmRestore={confirmRestore} />
    : <LocalizedDataSettings client={client} confirmRestore={confirmRestore} />
}

/**
 * Stands where the conversation would be when the app could not start on its database, in place
 * of what would otherwise show: a damaged file is put back from the latest backup, or set aside
 * for a new start. Neither deletes it.
 */
export function DatabaseRecovery({ client, children = null }: { client: DataClient; children?: ReactNode }) {
  const { t, locale } = useOptionalI18n()
  const [status, setStatus] = useState<DataStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let active = true
    void client.dataStatus().then((response) => { if (active) setStatus(dataStatusFrom(response.payload)) }).catch(() => undefined)
    return () => { active = false }
  }, [client])

  if (status?.health !== 'damaged') return <>{children}</>
  const latest = status.backups[0]
  const act = (work: () => Promise<unknown>): void => {
    setBusy(true)
    setFailed(false)
    void work().then(restartNow, () => {
      setFailed(true)
      setBusy(false)
    })
  }
  return (
    <div className="database-recovery" data-testid="database-recovery" role="alert">
      <AlertTriangle size={22} aria-hidden="true" />
      <h1>{t('recovery.title')}</h1>
      <p>{t(latest ? 'recovery.bodyBackup' : 'recovery.bodyNoBackup', latest ? { date: backupDate(latest, locale) } : undefined)}</p>
      {failed ? <p className="setup-error">{t('settings.data.error.failed')}</p> : null}
      <div className="provider-actions setup-actions">
        {latest ? (
          <button type="button" className="provider-primary" disabled={busy} aria-busy={busy} onClick={() => act(() => client.restoreBackup(latest.name))}>
            <RotateCcw size={14} aria-hidden="true" />
            <span>{t('recovery.restore')}</span>
          </button>
        ) : null}
        <button type="button" disabled={busy} onClick={() => act(() => client.startFresh())}>{t('recovery.fresh')}</button>
        <button type="button" onClick={() => void window.agentWorkspace?.openPath?.(status.folder)}>
          <FolderOpen size={14} aria-hidden="true" />
          <span>{t('settings.data.openFolder')}</span>
        </button>
      </div>
    </div>
  )
}

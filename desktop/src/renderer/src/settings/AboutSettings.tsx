import { Download, FileText, FolderOpen, Info, LoaderCircle, RefreshCw, RotateCw } from 'lucide-react'
import { useEffect, useId, useState } from 'react'

import type { DesktopHostApi } from '../../../shared/api'
import { isValidUpdateFeedUrl, type AppInfo, type UpdateStatus } from '../../../shared/desktop'
import { useI18n, type I18nValue } from '../i18n/I18nProvider'

export interface AboutSettingsProps {
  /** Desktop host bridge; the section renders nothing when it is absent. */
  host?: DesktopHostApi
  i18n?: I18nValue
  /** Gathers non-secret workbench facts to include in an exported diagnostics report. */
  collectDiagnostics?: () => Promise<Record<string, unknown>>
}

function statusText(status: UpdateStatus, t: I18nValue['t']): string {
  switch (status.state) {
    case 'unsupported':
      return t(`settings.about.update.unsupported.${status.reason}`)
    case 'idle':
      return t('settings.about.update.idle')
    case 'checking':
      return t('settings.about.update.checking')
    case 'available':
      return t('settings.about.update.available', { version: status.version })
    case 'not-available':
      return t('settings.about.update.latest')
    case 'downloading':
      return t('settings.about.update.downloading', { percent: Math.round(status.percent) })
    case 'downloaded':
      return t('settings.about.update.downloaded', { version: status.version })
    case 'error':
      return t('settings.about.update.error', { message: status.message })
  }
}

function AboutSettingsView({ host, i18n, collectDiagnostics }: { host: DesktopHostApi; i18n: I18nValue; collectDiagnostics?: AboutSettingsProps['collectDiagnostics'] }) {
  const { t } = i18n
  const feedId = useId()
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  const [feed, setFeed] = useState('')
  const [savedFeed, setSavedFeed] = useState<string | null>(null)
  const [feedError, setFeedError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [diagnostics, setDiagnostics] = useState<{ state: 'idle' | 'working' | 'saved' | 'failed'; path?: string }>({ state: 'idle' })

  const exportDiagnostics = async (): Promise<void> => {
    if (diagnostics.state === 'working') return
    setDiagnostics({ state: 'working' })
    try {
      let workbench: Record<string, unknown> = {}
      try {
        workbench = (await collectDiagnostics?.()) ?? {}
      } catch (error) {
        workbench = { collectionError: String(error instanceof Error ? error.message : error).slice(0, 300) }
      }
      const path = await host.exportDiagnostics(workbench)
      setDiagnostics(path ? { state: 'saved', path } : { state: 'idle' })
    } catch {
      setDiagnostics({ state: 'failed' })
    }
  }

  useEffect(() => {
    let active = true
    void Promise.allSettled([host.getAppInfo(), host.getUpdateStatus(), host.getUpdateFeed()]).then(([appInfo, update, url]) => {
      if (!active) return
      if (appInfo.status === 'fulfilled') setInfo(appInfo.value)
      if (update.status === 'fulfilled') setStatus(update.value)
      if (url.status === 'fulfilled') {
        setSavedFeed(url.value)
        setFeed(url.value ?? '')
      }
    })
    const unsubscribe = host.onUpdateStatus((next) => { if (active) setStatus(next) })
    return () => {
      active = false
      unsubscribe()
    }
  }, [host])

  const run = async (action: () => Promise<UpdateStatus | boolean>): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      const result = await action()
      if (typeof result === 'object') setStatus(result)
    } catch (error) {
      setStatus({ state: 'error', message: String(error instanceof Error ? error.message : error).slice(0, 500) })
    } finally {
      setBusy(false)
    }
  }

  const saveFeed = async (): Promise<void> => {
    const value = feed.trim()
    if (value && !isValidUpdateFeedUrl(value)) {
      setFeedError(t('settings.about.feedInvalid'))
      return
    }
    setFeedError(null)
    const next = value || null
    if (await host.setUpdateFeed(next)) {
      setSavedFeed(next)
      setStatus(await host.getUpdateStatus())
    } else {
      setFeedError(t('settings.about.feedRejected'))
    }
  }

  const unsupported = status?.state === 'unsupported' && status.reason !== 'no-feed'
  const canCheck = !busy && status !== null && !unsupported && savedFeed !== null &&
    status.state !== 'checking' && status.state !== 'downloading'

  return (
    <section className="settings-section about-settings" aria-labelledby="about-heading">
      <header className="doctor-header">
        <div>
          <h2 id="about-heading">{t('settings.about.title')}</h2>
          <p>{t('settings.about.desc')}</p>
        </div>
        <Info size={16} aria-hidden="true" />
      </header>

      <dl className="about-facts" data-testid="about-facts">
        <div><dt>{t('settings.about.version')}</dt><dd>{info?.version ?? '—'}</dd></div>
        <div><dt>Electron</dt><dd>{info?.electron ?? '—'}</dd></div>
        <div><dt>Chromium</dt><dd>{info?.chrome ?? '—'}</dd></div>
        <div><dt>{t('settings.about.platform')}</dt><dd>{info?.platform ?? '—'}</dd></div>
      </dl>

      <div className="provider-actions about-actions">
        <button type="button" className="provider-secondary" onClick={() => void host.openLogFolder()}>
          <FolderOpen size={14} aria-hidden="true" />
          <span>{t('settings.about.openLogs')}</span>
        </button>
        <button type="button" className="provider-secondary" disabled={diagnostics.state === 'working'} aria-busy={diagnostics.state === 'working'} onClick={() => void exportDiagnostics()}>
          {diagnostics.state === 'working' ? <LoaderCircle className="provider-spinner" size={14} aria-hidden="true" /> : <FileText size={14} aria-hidden="true" />}
          <span>{t('settings.about.exportDiagnostics')}</span>
        </button>
      </div>
      {diagnostics.state === 'saved' ? (
        <p className="about-update-status" role="status">{t('settings.about.diagnosticsSaved', { name: diagnostics.path?.split(/[\\/]/).at(-1) ?? '' })}</p>
      ) : diagnostics.state === 'failed' ? (
        <p className="route-error" role="alert">{t('settings.about.diagnosticsFailed')}</p>
      ) : null}
      <p className="about-diagnostics-note">{t('settings.about.diagnosticsNote')}</p>

      <h3 className="about-subheading">{t('settings.about.updates')}</h3>
      {unsupported ? null : (
        <form
          className="settings-row about-feed"
          onSubmit={(event) => {
            event.preventDefault()
            void saveFeed()
          }}
        >
          <label className="setting-label" htmlFor={feedId}>
            <strong>{t('settings.about.feed')}</strong>
            <span>{t('settings.about.feedHelp')}</span>
          </label>
          <div className="about-feed-input">
            <input
              id={feedId}
              type="url"
              inputMode="url"
              spellCheck={false}
              placeholder="https://"
              value={feed}
              aria-invalid={feedError ? true : undefined}
              onChange={(event) => setFeed(event.target.value)}
            />
            <button type="submit" className="provider-secondary" disabled={feed.trim() === (savedFeed ?? '')}>
              {t('settings.about.feedSave')}
            </button>
          </div>
          {feedError ? <p className="route-error" role="alert">{feedError}</p> : null}
        </form>
      )}

      <p className="about-update-status" role="status" aria-live="polite">
        {status ? statusText(status, t) : t('settings.about.update.loading')}
      </p>

      {status?.state === 'downloading' ? (
        <progress className="about-update-progress" max={100} value={status.percent} aria-label={t('settings.about.update.progress')} />
      ) : null}

      <div className="provider-actions about-actions">
        {status?.state === 'available' ? (
          <button type="button" className="provider-primary" disabled={busy} onClick={() => void run(() => host.downloadUpdate())}>
            <Download size={14} aria-hidden="true" />
            <span>{t('settings.about.download')}</span>
          </button>
        ) : status?.state === 'downloaded' ? (
          <button type="button" className="provider-primary" disabled={busy} onClick={() => void run(() => host.installUpdate())}>
            <RotateCw size={14} aria-hidden="true" />
            <span>{t('settings.about.install')}</span>
          </button>
        ) : unsupported ? null : (
          <button type="button" className="provider-primary" disabled={!canCheck} aria-busy={status?.state === 'checking'} onClick={() => void run(() => host.checkForUpdates())}>
            {status?.state === 'checking'
              ? <LoaderCircle className="provider-spinner" size={14} aria-hidden="true" />
              : <RefreshCw size={14} aria-hidden="true" />}
            <span>{t('settings.about.check')}</span>
          </button>
        )}
      </div>
    </section>
  )
}

function LocalizedAboutSettings({ host, collectDiagnostics }: { host: DesktopHostApi; collectDiagnostics?: AboutSettingsProps['collectDiagnostics'] }) {
  return <AboutSettingsView host={host} i18n={useI18n()} collectDiagnostics={collectDiagnostics} />
}

export function AboutSettings({ host, i18n, collectDiagnostics }: AboutSettingsProps) {
  if (!host) return null
  return i18n
    ? <AboutSettingsView host={host} i18n={i18n} collectDiagnostics={collectDiagnostics} />
    : <LocalizedAboutSettings host={host} collectDiagnostics={collectDiagnostics} />
}

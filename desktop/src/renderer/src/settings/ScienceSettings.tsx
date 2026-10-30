import { FlaskConical, Loader2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { GatewayCommandError, type WorkbenchBridgeClient } from '../bridge/client'
import { useI18n, type I18nValue } from '../i18n/I18nProvider'
import type { MessageKey } from '../i18n/messages'
import { zhCN } from '../i18n/messages'
import '../figures/figures.css'

type ScienceClient = Pick<WorkbenchBridgeClient, 'scienceStatus' | 'installScience' | 'cancelScience' | 'removeScience'>

interface ScienceStatus {
  installed: boolean
  installable: boolean
  python?: string
  pythonVersion?: string
  packages?: Record<string, string>
  root?: string
  running?: { job: string; stage: string; detail: string; seconds: number } | null
  error?: { code: string; detail: string }
}

function hasKey(key: string): key is MessageKey {
  return Object.prototype.hasOwnProperty.call(zhCN, key)
}

function ScienceSettingsView({ client, i18n }: { client: ScienceClient; i18n: I18nValue }) {
  const { t } = i18n
  const [status, setStatus] = useState<ScienceStatus | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const polling = useRef<number | null>(null)

  const load = useCallback(async (): Promise<ScienceStatus | null> => {
    try {
      const next = (await client.scienceStatus()).payload as unknown as ScienceStatus
      setStatus(next)
      return next
    } catch {
      return null
    }
  }, [client])

  const stopPolling = (): void => {
    if (polling.current !== null) window.clearInterval(polling.current)
    polling.current = null
  }

  useEffect(() => {
    void load().then((next) => {
      if (next?.running) polling.current = window.setInterval(() => void load(), 1000)
    })
    return stopPolling
  }, [load])

  const install = async (): Promise<void> => {
    setFailure(null)
    stopPolling()
    polling.current = window.setInterval(() => void load(), 1000)
    try {
      await client.installScience()
    } catch (error) {
      const code = error instanceof GatewayCommandError ? error.code : 'science_failed'
      setFailure(hasKey(`settings.science.error.${code}`) ? t(`settings.science.error.${code}` as MessageKey) : t('settings.science.error.science_failed'))
    } finally {
      stopPolling()
      await load()
    }
  }

  const remove = async (): Promise<void> => {
    setConfirmRemove(false)
    setFailure(null)
    try {
      setStatus((await client.removeScience()).payload as unknown as ScienceStatus)
    } catch {
      setFailure(t('settings.science.error.science_failed'))
    }
  }

  const running = status?.running ?? null
  const stage = running?.stage && hasKey(`settings.science.stage.${running.stage}`) ? t(`settings.science.stage.${running.stage}` as MessageKey) : running?.stage ?? ''

  return (
    <section className="settings-section science-settings" aria-labelledby="science-heading">
      <header className="doctor-header">
        <div>
          <h2 id="science-heading">{t('settings.science.title')}</h2>
          <p>{t('settings.science.description')}</p>
        </div>
        <FlaskConical size={16} aria-hidden="true" />
      </header>
      {status?.installed ? (
        <>
          <p className="provider-hint">{t('settings.science.installed', { version: status.pythonVersion ?? '3' })}</p>
          <ul className="science-packages">
            {Object.entries(status.packages ?? {}).map(([name, version]) => <li key={name}><span>{name}</span> <small>{version}</small></li>)}
          </ul>
          <p className="provider-hint science-path">{status.python}</p>
        </>
      ) : status ? (
        <p className="provider-hint">{status.installable ? t('settings.science.notInstalled') : t('settings.science.unsupported')}</p>
      ) : null}
      {running ? (
        <p className="provider-status" role="status">
          <Loader2 size={13} className="figure-spin" aria-hidden="true" /> {t('settings.science.running', { stage, seconds: Math.round(running.seconds) })}
          {running.detail ? <small className="science-detail"> {running.detail}</small> : null}
        </p>
      ) : null}
      <div className="provider-actions">
        {running ? (
          <button type="button" className="provider-secondary" onClick={() => void client.cancelScience()}>{t('settings.science.stop')}</button>
        ) : status?.installable ? (
          <button type="button" className="provider-primary" onClick={() => void install()}>
            {status.installed ? t('settings.science.repair') : t('settings.science.install')}
          </button>
        ) : null}
        {status?.installed && !running ? (
          confirmRemove ? (
            <>
              <button type="button" className="provider-secondary" onClick={() => void remove()}>{t('settings.science.removeConfirm')}</button>
              <button type="button" className="provider-secondary" onClick={() => setConfirmRemove(false)}>{t('settings.science.keep')}</button>
            </>
          ) : (
            <button type="button" className="provider-secondary" onClick={() => setConfirmRemove(true)}>{t('settings.science.remove')}</button>
          )
        ) : null}
      </div>
      {failure ? <p className="provider-status provider-status-error" role="status">{failure}</p> : null}
    </section>
  )
}

function LocalizedScienceSettings({ client }: { client: ScienceClient }) {
  return <ScienceSettingsView client={client} i18n={useI18n()} />
}

export function ScienceSettings({ client, i18n }: { client: ScienceClient; i18n?: I18nValue }) {
  return i18n ? <ScienceSettingsView client={client} i18n={i18n} /> : <LocalizedScienceSettings client={client} />
}

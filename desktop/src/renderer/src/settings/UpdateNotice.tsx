import { Download, ExternalLink, RotateCw, Sparkles, X } from 'lucide-react'
import { useEffect, useState } from 'react'

import { releaseNotesUrl, type UpdateStatus } from '../../../shared/desktop'
import { useOptionalI18n } from '../i18n/I18nProvider'
import '../devices/devices.css'

const DISMISSED_KEY = 'agent-workspace.update-dismissed.v1'

function dismissedVersion(): string | null {
  try {
    return localStorage.getItem(DISMISSED_KEY)
  } catch {
    return null
  }
}

/** A new version, in the corner of the window: what it is, and the way to it. Nothing downloads by itself. */
export function UpdateNotice() {
  const { t } = useOptionalI18n()
  const host = typeof window === 'undefined' ? undefined : window.agentWorkspace?.desktop
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  const [dismissed, setDismissed] = useState(dismissedVersion)

  useEffect(() => {
    if (!host?.onUpdateStatus) return undefined
    let active = true
    void host.getUpdateStatus().then((current) => { if (active) setStatus(current) }, () => undefined)
    const unsubscribe = host.onUpdateStatus((next) => { if (active) setStatus(next) })
    return () => {
      active = false
      unsubscribe()
    }
  }, [host])

  if (!host || !status) return null
  if (status.state !== 'available' && status.state !== 'downloading' && status.state !== 'downloaded') return null
  const version = status.state === 'downloading' ? null : status.version
  if (version !== null && dismissed === version) return null

  const dismiss = (): void => {
    if (version === null) return
    setDismissed(version)
    try {
      localStorage.setItem(DISMISSED_KEY, version)
    } catch {
      // It comes back at the next start, which is no harm.
    }
  }

  return (
    <ul className="device-notices update-notice" aria-live="polite" data-testid="update-notice">
      <li className="device-notice">
        <Sparkles size={15} aria-hidden="true" />
        <div className="device-notice-body">
          <strong>
            {status.state === 'available' ? t('settings.about.update.available', { version: status.version })
              : status.state === 'downloading' ? t('settings.about.update.downloading', { percent: Math.round(status.percent) })
                : t('settings.about.update.downloaded', { version: status.version })}
          </strong>
          <div className="device-notice-actions">
            {status.state === 'available' ? (
              <>
                <button type="button" onClick={() => void host.downloadUpdate()}><Download size={13} aria-hidden="true" />{t('settings.about.download')}</button>
                <button type="button" onClick={() => void window.agentWorkspace?.openExternal?.(releaseNotesUrl(status.version))}><ExternalLink size={13} aria-hidden="true" />{t('settings.about.notes')}</button>
              </>
            ) : null}
            {status.state === 'downloaded' ? (
              <button type="button" onClick={() => void host.installUpdate()}><RotateCw size={13} aria-hidden="true" />{t('settings.about.install')}</button>
            ) : null}
          </div>
        </div>
        {version !== null ? (
          <button type="button" className="icon-button device-notice-close" aria-label={t('devices.dismiss')} title={t('devices.dismiss')} onClick={dismiss}>
            <X size={14} />
          </button>
        ) : null}
      </li>
    </ul>
  )
}

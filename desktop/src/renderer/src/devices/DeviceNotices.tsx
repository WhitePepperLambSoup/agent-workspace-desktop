import { Check, Copy, ExternalLink, FileText, FolderOpen, Link2, MessageSquareText, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { useOptionalI18n } from '../i18n/I18nProvider'
import { openWorkspaceFile, requestPreview } from '../preview/preview-request'
import type { DeviceNotice } from '../state/workbench-store'
import './devices.css'

// Pictures and documents a phone sent open in the window's preview (or their default app); anything
// else is only shown in its folder, so a received program never runs from here.
const OPENABLE = /\.(pdf|docx|xlsx|pptx|png|jpe?g|gif|webp)$/i

async function copy(text: string): Promise<boolean> {
  try {
    if (window.agentWorkspace?.copyText) return await window.agentWorkspace.copyText(text)
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

function NoticeCard({ notice, onDismiss }: { notice: DeviceNotice; onDismiss: () => void }) {
  const { t } = useOptionalI18n()
  const [copied, setCopied] = useState(false)
  const autoCopied = useRef(false)
  useEffect(() => {
    // Text from a phone goes to the clipboard when the user chose that (on by default).
    if (!notice.copy || autoCopied.current || !notice.text || notice.kind === 'file') return
    autoCopied.current = true
    void copy(notice.text).then(setCopied)
  }, [notice])
  const api = window.agentWorkspace
  const title = notice.kind === 'file'
    ? t('devices.receivedFile', { device: notice.device, name: notice.name ?? '' })
    : t(notice.kind === 'link' ? 'devices.receivedLink' : 'devices.receivedText', { device: notice.device })
  const Icon = notice.kind === 'file' ? FileText : notice.kind === 'link' ? Link2 : MessageSquareText
  return (
    <li className="device-notice" data-kind={notice.kind}>
      <Icon size={15} aria-hidden="true" />
      <div className="device-notice-body">
        <strong>{title}</strong>
        {notice.text ? <p className="device-notice-text">{notice.text}</p> : null}
        <div className="device-notice-actions">
          {notice.kind === 'file' && notice.path && OPENABLE.test(notice.path) && (api?.preview || api?.openPath) ? (
            <button type="button" onClick={() => {
              // In the window's own preview when it has one, else in the default app.
              if (api.preview) openWorkspaceFile(notice.path!)
              else void api.openPath(notice.path!)
            }}><ExternalLink size={13} aria-hidden="true" />{t('devices.openFile')}</button>
          ) : null}
          {notice.kind === 'file' && notice.path && api?.revealPath ? (
            <button type="button" onClick={() => void api.revealPath!(notice.path!)}><FolderOpen size={13} aria-hidden="true" />{t('devices.openFolder')}</button>
          ) : null}
          {notice.kind !== 'file' && notice.text ? (
            <button type="button" onClick={() => void copy(notice.text!).then(setCopied)}>
              {copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
              {t(copied ? 'devices.copied' : 'devices.copy')}
            </button>
          ) : null}
          {notice.kind === 'link' && notice.text && /^https:\/\//i.test(notice.text) && (api?.preview || api?.openExternal) ? (
            <button type="button" onClick={() => {
              if (api.preview) requestPreview({ kind: 'url', url: notice.text! })
              else void api.openExternal(notice.text!)
            }}><ExternalLink size={13} aria-hidden="true" />{t('devices.openLink')}</button>
          ) : null}
        </div>
      </div>
      <button type="button" className="icon-button device-notice-close" aria-label={t('devices.dismiss')} title={t('devices.dismiss')} onClick={onDismiss}>
        <X size={14} />
      </button>
    </li>
  )
}

/** What phones sent while the window is open: files saved to the open folder, text and links. */
export function DeviceNotices({ notices }: { notices: readonly DeviceNotice[] }) {
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set())
  const shown = notices.filter((notice) => !dismissed.has(notice.id)).slice(-3)
  if (shown.length === 0) return null
  return (
    <ul className="device-notices" aria-live="polite">
      {shown.map((notice) => (
        <NoticeCard key={notice.id} notice={notice}
          onDismiss={() => setDismissed((current) => new Set([...current, notice.id]))} />
      ))}
    </ul>
  )
}

import { History, LoaderCircle, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { useOptionalI18n } from '../i18n/I18nProvider'
import type { MessageKey } from '../i18n/messages'

export interface RewindFile {
  path: string
  action: 'restore' | 'remove'
  // Why it is left alone: changed since, earlier content not kept, unsafe path, or a failure.
  reason: string | null
}

export function rewindFilesFrom(payload: Record<string, unknown>): RewindFile[] {
  return Array.isArray(payload.files) ? payload.files.flatMap((item: unknown) => {
    const file = item && typeof item === 'object' ? item as Record<string, unknown> : null
    if (!file || typeof file.path !== 'string' || (file.action !== 'restore' && file.action !== 'remove')) return []
    return [{ path: file.path, action: file.action, reason: typeof file.reason === 'string' ? file.reason : null }]
  }) : []
}

const REASONS: Record<string, MessageKey> = {
  changed: 'rewind.reason.changed',
  not_kept: 'rewind.reason.notKept',
  unsafe: 'rewind.reason.unsafe',
  failed: 'rewind.reason.failed',
}

/**
 * Puts the files the agent changed after a message back as they were: a preview first, then
 * the restore. The conversation itself stays as it is.
 */
export function RewindDialog({ rewind, onClose }: {
  rewind: (apply: boolean) => Promise<RewindFile[]>
  onClose: () => void
}) {
  const { t } = useOptionalI18n()
  const [files, setFiles] = useState<RewindFile[] | null>(null)
  const [stage, setStage] = useState<'loading' | 'preview' | 'restoring' | 'done' | 'failed'>('loading')
  const panel = useRef<HTMLElement>(null)
  // The opener passes a new function on each render; the preview is taken once.
  const rewindRef = useRef(rewind)
  rewindRef.current = rewind

  useEffect(() => {
    let active = true
    rewindRef.current(false).then(
      (preview) => { if (active) { setFiles(preview); setStage('preview') } },
      () => { if (active) setStage('failed') },
    )
    return () => { active = false }
  }, [])

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    panel.current?.focus()
    return () => { if (opener?.isConnected) opener.focus() }
  }, [])

  // Escape closes the dialog wherever focus is (the confirm button goes away once it is done).
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') { event.stopPropagation(); closeRef.current() }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    if (stage === 'done') panel.current?.querySelector<HTMLButtonElement>('.provider-actions button')?.focus()
  }, [stage])

  const restore = (): void => {
    setStage('restoring')
    rewindRef.current(true).then(
      (result) => { setFiles(result); setStage('done') },
      () => setStage('failed'),
    )
  }

  const ready = files?.filter((file) => file.reason === null) ?? []
  const target = document.querySelector('.workbench') ?? document.body
  return createPortal(
    <div className="command-overlay compare-overlay" role="presentation"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section ref={panel} tabIndex={-1} className="compare-dialog rewind-dialog" role="dialog" aria-modal="true" aria-label={t('rewind.title')}>
        <header>
          <History size={15} aria-hidden="true" />
          <strong>{t('rewind.title')}</strong>
          <button type="button" className="icon-button" aria-label={t('compare.close')} title={t('compare.close')} onClick={onClose}><X size={15} /></button>
        </header>
        <div className="rewind-body">
          <p>{t(stage === 'done' ? 'rewind.done' : 'rewind.description', { count: ready.length })}</p>
          {stage === 'loading' ? <p className="provider-hint"><LoaderCircle size={13} className="provider-spinner" aria-hidden="true" /> {t('rewind.loading')}</p> : null}
          {stage === 'failed' ? <p className="provider-status provider-status-error" role="status">{t('rewind.failed')}</p> : null}
          {files && files.length === 0 ? <p className="provider-hint">{t('rewind.nothing')}</p> : null}
          {files && files.length > 0 ? (
            <ul className="rewind-files">
              {files.map((file) => (
                <li key={file.path} data-left-alone={file.reason ? 'true' : undefined}>
                  <code>{file.path}</code>
                  <small>
                    {file.reason
                      ? t(REASONS[file.reason] ?? 'rewind.reason.failed')
                      : t(file.action === 'remove' ? 'rewind.remove' : 'rewind.restore')}
                  </small>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="provider-actions">
            <button type="button" onClick={onClose}>{t(stage === 'done' ? 'compare.close' : 'compare.cancel')}</button>
            {stage === 'preview' || stage === 'restoring' ? (
              <button type="button" className="provider-primary" disabled={ready.length === 0 || stage === 'restoring'} onClick={restore}>
                {stage === 'restoring' ? <LoaderCircle size={13} className="provider-spinner" aria-hidden="true" /> : null}
                {t('rewind.confirm', { count: ready.length })}
              </button>
            ) : null}
          </div>
        </div>
      </section>
    </div>,
    target,
  )
}

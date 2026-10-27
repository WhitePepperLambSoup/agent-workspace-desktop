import { Check, Copy, GitBranch, GitCompare, History, Paperclip, PencilLine, RefreshCw, Smartphone, SquarePen, Volume2, VolumeX } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { SafeMarkdown } from '../markdown/SafeMarkdown'
import { DiffBlock } from './DiffBlock'
import { NoticeRow, type NoticeActions } from './NoticeRow'
import { ToolRow } from './ToolRow'
import type { MessageEntry, TimelineEntry } from './types'
import { useOptionalI18n } from '../i18n/I18nProvider'
import type { MessageKey } from '../i18n/messages'
import { parseUserAttachmentReferences } from './user-attachments'
import { speak } from '../voice/voice'
import './user-attachments.css'

const ROLE_KEYS: Record<'user' | 'assistant' | 'reasoning' | 'system', MessageKey> = {
  user: 'timeline.user',
  assistant: 'timeline.assistant',
  reasoning: 'timeline.reasoning',
  system: 'timeline.system',
}

/** Per-message actions; absent callbacks hide their buttons. */
export interface MessageActions {
  onEdit?: () => void
  onRetry?: () => void
  retryKind?: 'resend' | 'regenerate'
  retryDisabled?: boolean
  /** A user message: rewrite it in a new conversation that ends before it. */
  onFork?: () => void
  /** An answer: continue in a new conversation that keeps everything up to it. */
  onBranch?: () => void
  /** An answer: ask the same question of another model in a new conversation. */
  onCompare?: () => void
  forkDisabled?: boolean
  /** A user message: put the files the agent changed after it back as they were. */
  onRewind?: () => void
  /** Put the message's text in a paired phone's inbox. */
  onSendToPhone?: (text: string) => void
}

const ORIGIN_KEYS: Record<string, MessageKey> = {
  broad_autonomy: 'timeline.originBroad',
  private: 'timeline.originPrivate',
  subtask: 'timeline.originSubtask',
  handoff: 'timeline.originHandoff',
}

/** A message a paired phone handed over, and how: confirmed auto-approval, private details. */
function PhoneOrigin({ origin }: { origin: NonNullable<MessageEntry['origin']> }) {
  const { t } = useOptionalI18n()
  const parts = [
    origin.device ? t('timeline.fromPhone', { device: origin.device }) : t('timeline.fromPhoneUnnamed'),
    ...origin.labels.flatMap((label) => ORIGIN_KEYS[label] ? [t(ORIGIN_KEYS[label])] : []),
  ]
  return (
    <span className="message-origin" data-labels={origin.labels.join(' ') || undefined}>
      <Smartphone size={12} aria-hidden="true" />{parts.join(' · ')}
    </span>
  )
}

function MessageActionBar({ text, actions, readable }: { text: string; actions?: MessageActions; readable: boolean }) {
  const { t } = useOptionalI18n()
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [reading, setReading] = useState(false)
  const stopReading = useRef<(() => void) | null>(null)
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (resetTimer.current) clearTimeout(resetTimer.current)
    stopReading.current?.()
  }, [])
  const canRead = readable && typeof window !== 'undefined' && 'speechSynthesis' in window
  const toggleReading = (): void => {
    if (reading) {
      stopReading.current?.()
      return
    }
    stopReading.current = speak(text, () => { stopReading.current = null; setReading(false) })
    setReading(stopReading.current !== null)
  }

  const copy = async (): Promise<void> => {
    let next: 'copied' | 'failed' = 'failed'
    try {
      await navigator.clipboard.writeText(text)
      next = 'copied'
    } catch { /* Clipboard access can be denied; report it inline. */ }
    setCopyState(next)
    if (resetTimer.current) clearTimeout(resetTimer.current)
    resetTimer.current = setTimeout(() => setCopyState('idle'), 1600)
  }
  const copyLabel = t(copyState === 'copied' ? 'timeline.copied' : copyState === 'failed' ? 'timeline.copyFailed' : 'timeline.copy')
  const retryLabel = t(actions?.retryKind === 'regenerate' ? 'timeline.regenerate' : 'timeline.resend')

  return (
    <div className="message-actions" role="toolbar" aria-label={t('timeline.messageActions')}>
      <button type="button" className="message-action" aria-label={copyLabel} title={copyLabel} data-state={copyState} onClick={() => void copy()}>
        {copyState === 'copied' ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
      </button>
      {canRead ? (
        <button type="button" className="message-action" aria-label={t(reading ? 'timeline.stopReading' : 'timeline.readAloud')}
          title={t(reading ? 'timeline.stopReading' : 'timeline.readAloud')} aria-pressed={reading} onClick={toggleReading}>
          {reading ? <VolumeX size={13} aria-hidden="true" /> : <Volume2 size={13} aria-hidden="true" />}
        </button>
      ) : null}
      {actions?.onEdit ? (
        <button type="button" className="message-action" aria-label={t('timeline.edit')} title={t('timeline.edit')} onClick={actions.onEdit}>
          <PencilLine size={13} aria-hidden="true" />
        </button>
      ) : null}
      {actions?.onRetry ? (
        <button type="button" className="message-action" aria-label={retryLabel} title={retryLabel} disabled={actions.retryDisabled} onClick={actions.onRetry}>
          <RefreshCw size={13} aria-hidden="true" />
        </button>
      ) : null}
      {actions?.onFork ? (
        <button type="button" className="message-action" aria-label={t('timeline.forkRewrite')} title={t('timeline.forkRewrite')} disabled={actions.forkDisabled} onClick={actions.onFork}>
          <SquarePen size={13} aria-hidden="true" />
        </button>
      ) : null}
      {actions?.onRewind ? (
        <button type="button" className="message-action" aria-label={t('timeline.rewindFiles')} title={t('timeline.rewindFiles')} disabled={actions.forkDisabled} onClick={actions.onRewind}>
          <History size={13} aria-hidden="true" />
        </button>
      ) : null}
      {actions?.onBranch ? (
        <button type="button" className="message-action" aria-label={t('timeline.branch')} title={t('timeline.branch')} disabled={actions.forkDisabled} onClick={actions.onBranch}>
          <GitBranch size={13} aria-hidden="true" />
        </button>
      ) : null}
      {actions?.onCompare ? (
        <button type="button" className="message-action" aria-label={t('timeline.compare')} title={t('timeline.compare')} disabled={actions.forkDisabled} onClick={actions.onCompare}>
          <GitCompare size={13} aria-hidden="true" />
        </button>
      ) : null}
      {actions?.onSendToPhone ? (
        <button type="button" className="message-action" aria-label={t('devices.sendToPhone')} title={t('devices.sendToPhone')}
          onClick={() => {
            // Text selected in this message goes on its own; otherwise the whole message.
            const picked = window.getSelection?.()?.toString().trim() ?? ''
            actions.onSendToPhone?.(picked && text.includes(picked) ? picked : text)
          }}>
          <Smartphone size={13} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  )
}

export function TimelineRow({ entry, onOpenExternal, actions, noticeActions }: {
  entry: TimelineEntry
  onOpenExternal?: (url: string) => void
  actions?: MessageActions
  noticeActions?: NoticeActions
}) {
  const { t } = useOptionalI18n()
  const completedUserText = entry.type === 'message' && entry.role === 'user' && entry.open === false ? entry.text : null
  const userDisplay = useMemo(() => completedUserText === null ? null : parseUserAttachmentReferences(completedUserText), [completedUserText])
  if (entry.type === 'tool') return <ToolRow entry={entry} />
  if (entry.type === 'diff') return <DiffBlock source={entry.source} />
  if (entry.type === 'notice') return <NoticeRow entry={entry} actions={noticeActions} />
  if (entry.role === 'reasoning') {
    const snippet = entry.text.trimStart().slice(0, 240).replace(/\s+/g, ' ').trim()
    const preview = snippet
      ? `${snippet.slice(0, 160)}${snippet.length > 160 || entry.text.length > 240 ? '…' : ''}`
      : t('timeline.reasoning')
    return (
      <div className="reasoning-block">
        <span className="reasoning-label">{t(ROLE_KEYS[entry.role])}</span>
        <details>
          <summary title={preview}>{preview}</summary>
          <div className="reasoning-content"><SafeMarkdown source={entry.text} resources={entry.resources} streaming={entry.open === true} onOpenExternal={onOpenExternal} /></div>
        </details>
      </div>
    )
  }
  const body = userDisplay?.body ?? entry.text
  const showActions = entry.open === false && (entry.role === 'user' || entry.role === 'assistant') && body.trim().length > 0
  return (
    <>
      <header className="message-header">
        <span>{t(ROLE_KEYS[entry.role])}</span>
        {entry.origin ? <PhoneOrigin origin={entry.origin} /> : null}
        {showActions ? <MessageActionBar text={body} actions={actions} readable={entry.role === 'assistant'} /> : null}
      </header>
      <SafeMarkdown source={body} resources={entry.resources} streaming={entry.open === true} onOpenExternal={onOpenExternal} />
      {userDisplay?.filenames.length ? <ul className="user-attachment-labels">
        {userDisplay.filenames.map((filename, index) => (
          <li className="user-attachment-label" key={`${index}:${filename}`}>
            <Paperclip size={14} aria-hidden="true" />
            <span title={filename}>{filename}</span>
          </li>
        ))}
      </ul> : null}
    </>
  )
}

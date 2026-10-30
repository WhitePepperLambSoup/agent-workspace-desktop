import { MessageSquare, Send, Undo2 } from 'lucide-react'
import { useState } from 'react'

import { useOptionalI18n } from '../i18n/I18nProvider'
import { DiffBlock } from '../timeline/DiffBlock'

/** A unified diff cut into its file header and its hunks (each starting with its @@ line). */
export function splitHunks(diff: string): { header: string; hunks: string[] } {
  const lines = diff.split('\n')
  const first = lines.findIndex((line) => line.startsWith('@@'))
  if (first < 0) return { header: diff, hunks: [] }
  const hunks: string[] = []
  let current: string[] = []
  for (const line of lines.slice(first)) {
    if (line.startsWith('@@') && current.length) {
      hunks.push(current.join('\n'))
      current = []
    }
    current.push(line)
  }
  if (current.length) hunks.push(current.join('\n').replace(/\n$/, ''))
  return { header: lines.slice(0, first).join('\n'), hunks }
}

/** A comment form under a part of a change: what the user wants done about it. */
export function HunkComment({ onSend, onCancel, placeholder }: {
  onSend(comment: string): Promise<boolean>
  onCancel(): void
  placeholder?: string
}) {
  const { t } = useOptionalI18n()
  const [comment, setComment] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'failed'>('idle')
  const send = async (): Promise<void> => {
    if (!comment.trim()) return
    setState('sending')
    setState(await onSend(comment.trim()) ? 'idle' : 'failed')
  }
  return (
    <div className="hunk-comment">
      <textarea
        autoFocus
        rows={2}
        aria-label={t('changes.hunkComment')}
        placeholder={placeholder ?? t('changes.hunkCommentPlaceholder')}
        value={comment}
        disabled={state === 'sending'}
        onChange={(event) => setComment(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void send() }
          if (event.key === 'Escape') { event.preventDefault(); onCancel() }
        }}
      />
      <div className="hunk-comment-actions">
        {state === 'failed' ? <span className="provider-status-error" role="status">{t('changes.hunkCommentFailed')}</span> : null}
        <button type="button" className="provider-secondary" onClick={onCancel}>{t('changes.hunkCommentCancel')}</button>
        <button type="button" className="provider-primary" disabled={!comment.trim() || state === 'sending'} onClick={() => void send()}>
          <Send size={12} aria-hidden="true" />{t('changes.hunkCommentSend')}
        </button>
      </div>
    </div>
  )
}

/**
 * A change shown part by part, each with "undo this part" and "comment on it" (the comment goes
 * to the conversation with the part's diff).
 */
export function HunkDiff({ diff, onUndo, onAsk }: {
  diff: string
  onUndo?: (index: number) => Promise<void>
  onAsk?: (hunk: string, comment: string) => Promise<boolean>
}) {
  const { t } = useOptionalI18n()
  const { header, hunks } = splitHunks(diff)
  const [asking, setAsking] = useState<number | null>(null)
  const [busy, setBusy] = useState<number | null>(null)
  if (hunks.length < 1 || (!onUndo && !onAsk)) return <DiffBlock source={diff} />
  return (
    <div className="hunk-diff">
      {hunks.map((hunk, index) => (
        <section key={`${index}:${hunk.slice(0, 40)}`} className="hunk-diff-part" aria-label={t('changes.hunkPart', { index: String(index + 1), count: String(hunks.length) })}>
          <div className="hunk-diff-actions">
            {onUndo ? (
              <button type="button" className="text-btn" disabled={busy !== null} onClick={() => {
                setBusy(index)
                void onUndo(index).finally(() => setBusy(null))
              }}>
                <Undo2 size={12} aria-hidden="true" />{t('changes.undoHunk')}
              </button>
            ) : null}
            {onAsk ? (
              <button type="button" className="text-btn" aria-expanded={asking === index} onClick={() => setAsking(asking === index ? null : index)}>
                <MessageSquare size={12} aria-hidden="true" />{t('changes.commentHunk')}
              </button>
            ) : null}
          </div>
          <DiffBlock source={`${header}\n${hunk}\n`} />
          {asking === index && onAsk ? (
            <HunkComment onCancel={() => setAsking(null)} onSend={async (comment) => {
              const sent = await onAsk(hunk, comment)
              if (sent) setAsking(null)
              return sent
            }} />
          ) : null}
        </section>
      ))}
    </div>
  )
}

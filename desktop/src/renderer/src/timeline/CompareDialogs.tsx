import { GitCompare, LoaderCircle, X } from 'lucide-react'
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { useOptionalI18n } from '../i18n/I18nProvider'
import { SafeMarkdown } from '../markdown/SafeMarkdown'

export interface ComparedAnswer {
  state: 'running' | 'completed' | 'failed' | 'cancelled' | 'missing'
  model: string | null
  answer: string
  answerTruncated: boolean
  modelSeconds: number
  inputTokens: number
  outputTokens: number
  cachedTokens: number
}

export interface ComparisonDocument {
  question: string | null
  compareModel: string | null
  original: ComparedAnswer
  candidate: ComparedAnswer
}

function answerFrom(value: unknown): ComparedAnswer {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const number = (key: string): number => typeof record[key] === 'number' && Number.isFinite(record[key]) ? record[key] as number : 0
  const state = record.state
  return {
    state: state === 'running' || state === 'completed' || state === 'failed' || state === 'cancelled' ? state : 'missing',
    model: typeof record.model === 'string' ? record.model : null,
    answer: typeof record.answer === 'string' ? record.answer : '',
    answerTruncated: record.answerTruncated === true,
    modelSeconds: number('modelSeconds'),
    inputTokens: number('inputTokens'),
    outputTokens: number('outputTokens'),
    cachedTokens: number('cachedTokens'),
  }
}

export function comparisonFrom(payload: Record<string, unknown>): ComparisonDocument {
  return {
    question: typeof payload.question === 'string' ? payload.question : null,
    compareModel: typeof payload.compareModel === 'string' ? payload.compareModel : null,
    original: answerFrom(payload.original),
    candidate: answerFrom(payload.candidate),
  }
}

function Dialog({ label, onClose, className, children }: { label: string; onClose: () => void; className: string; children: ReactNode }) {
  const panel = useRef<HTMLElement>(null)
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const first = panel.current?.querySelector<HTMLElement>('input')
    ;(first ?? panel.current)?.focus()
    return () => { if (opener?.isConnected) opener.focus() }
  }, [])
  // The panes blur their backdrop and clip overflow, which would hold a fixed overlay inside
  // one; like the command palette, the dialog sits directly in the workbench.
  const target = document.querySelector('.workbench') ?? document.body
  return createPortal(
    <div className="command-overlay compare-overlay" role="presentation"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}
      onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); onClose() } }}>
      <section ref={panel} tabIndex={-1} className={`compare-dialog ${className}`} role="dialog" aria-modal="true" aria-label={label}>
        {children}
      </section>
    </div>,
    target,
  )
}

export function CompareModelDialog({ currentModel, sourceModel, onSubmit, onClose }: {
  currentModel: string | null
  sourceModel: string | null
  onSubmit: (model: string) => Promise<void>
  onClose: () => void
}) {
  const { t } = useOptionalI18n()
  const [model, setModel] = useState('')
  const [state, setState] = useState<'idle' | 'starting' | 'failed'>('idle')
  const inputId = useId()
  const submit = (event: FormEvent): void => {
    event.preventDefault()
    const value = model.trim()
    if (!value || state === 'starting') return
    setState('starting')
    onSubmit(value).then(onClose, () => setState('failed'))
  }
  const answeredBy = sourceModel ?? currentModel
  return (
    <Dialog label={t('compare.title')} onClose={onClose} className="compare-model-dialog">
      <header>
        <GitCompare size={15} aria-hidden="true" />
        <strong>{t('compare.title')}</strong>
        <button type="button" className="icon-button" data-dialog-close aria-label={t('compare.close')} title={t('compare.close')} onClick={onClose}><X size={15} /></button>
      </header>
      <form onSubmit={submit}>
        <p>{t('compare.description')}</p>
        {answeredBy ? <p className="compare-answered-by">{t('compare.answeredBy', { model: answeredBy })}</p> : null}
        <label className="provider-field" htmlFor={inputId}>
          <span>{t('compare.model')}</span>
          <input id={inputId} value={model} maxLength={200} spellCheck={false} autoComplete="off"
            placeholder={currentModel ?? undefined} onChange={(event) => { setModel(event.target.value); setState('idle') }} />
        </label>
        <p className="provider-hint">{t('compare.modelHint')}</p>
        {state === 'failed' ? <p className="provider-status provider-status-error" role="status">{t('compare.startFailed')}</p> : null}
        <div className="provider-actions">
          <button type="button" onClick={onClose}>{t('compare.cancel')}</button>
          <button type="submit" className="provider-primary" disabled={!model.trim() || state === 'starting'}>
            {state === 'starting' ? <LoaderCircle size={13} className="provider-spinner" aria-hidden="true" /> : null}
            {t('compare.start')}
          </button>
        </div>
      </form>
    </Dialog>
  )
}

function AnswerColumn({ heading, answer: shown, pendingWhenMissing = false }: { heading: string; answer: ComparedAnswer; pendingWhenMissing?: boolean }) {
  const { t, locale } = useOptionalI18n()
  const number = new Intl.NumberFormat(locale)
  const seconds = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 })
  // The comparison's own turn has not started yet right after the fork.
  const answer = pendingWhenMissing && shown.state === 'missing' ? { ...shown, state: 'running' as const } : shown
  return (
    <article className="compare-column" data-state={answer.state}>
      <header>
        <span className="compare-column-label">{heading}</span>
        <strong title={answer.model ?? undefined}>{answer.model ?? t('compare.unknownModel')}</strong>
      </header>
      {answer.state === 'completed' || (answer.answer && answer.state !== 'running') ? (
        <dl className="compare-facts">
          <div><dt>{t('compare.modelTime')}</dt><dd>{t('compare.seconds', { value: seconds.format(answer.modelSeconds) })}</dd></div>
          <div><dt>{t('compare.tokens')}</dt><dd>{number.format(answer.inputTokens)} / {number.format(answer.outputTokens)}</dd></div>
          {answer.cachedTokens > 0 ? <div><dt>{t('compare.cached')}</dt><dd>{number.format(answer.cachedTokens)}</dd></div> : null}
        </dl>
      ) : null}
      <div className="compare-answer">
        {answer.state === 'running' && !answer.answer ? (
          <p className="compare-pending" role="status"><LoaderCircle size={13} className="provider-spinner" aria-hidden="true" />{t('compare.running')}</p>
        ) : answer.answer ? (
          <SafeMarkdown source={answer.answer} streaming={false} />
        ) : (
          <p className="compare-pending">{t(answer.state === 'failed' ? 'compare.failed' : answer.state === 'cancelled' ? 'compare.cancelled' : 'compare.missing')}</p>
        )}
        {answer.answerTruncated ? <p className="provider-hint">{t('compare.truncated')}</p> : null}
      </div>
    </article>
  )
}

const POLL_MS = 1500

export function ComparisonSheet({ load, onClose, onOpenSource, pendingApprovals = 0 }: {
  load: () => Promise<ComparisonDocument>
  onClose: () => void
  onOpenSource?: () => void
  /** Approvals the comparison's conversation waits for; they are answered below the sheet. */
  pendingApprovals?: number
}) {
  const { t } = useOptionalI18n()
  const [document, setDocument] = useState<ComparisonDocument | null>(null)
  const [failed, setFailed] = useState(false)
  const loadRef = useRef(load)
  loadRef.current = load

  useEffect(() => {
    let active = true
    let timer: ReturnType<typeof setTimeout> | null = null
    const refresh = (): void => {
      loadRef.current()
        .then((next) => {
          if (!active) return
          setDocument(next)
          setFailed(false)
          if (next.candidate.state === 'running' || next.candidate.state === 'missing') timer = setTimeout(refresh, POLL_MS)
        })
        .catch(() => { if (active) setFailed(true) })
    }
    refresh()
    return () => {
      active = false
      if (timer !== null) clearTimeout(timer)
    }
  }, [])

  return (
    <Dialog label={t('compare.sheetTitle')} onClose={onClose} className="compare-sheet">
      <header>
        <GitCompare size={15} aria-hidden="true" />
        <strong>{t('compare.sheetTitle')}</strong>
        {onOpenSource ? <button type="button" className="compare-source-button" onClick={onOpenSource}>{t('notice.openSource')}</button> : null}
        <button type="button" className="icon-button" data-dialog-close aria-label={t('compare.close')} title={t('compare.close')} onClick={onClose}><X size={15} /></button>
      </header>
      {document?.question ? <p className="compare-question" title={document.question}>{document.question}</p> : null}
      {pendingApprovals > 0 ? (
        <p className="compare-approval" role="status">
          <span>{t('compare.approvalPending')}</span>
          <button type="button" className="compare-source-button" onClick={onClose}>{t('compare.reviewApproval')}</button>
        </p>
      ) : null}
      {failed && !document ? <p className="provider-status provider-status-error" role="status">{t('compare.loadFailed')}</p> : null}
      {document ? (
        <div className="compare-columns">
          <AnswerColumn heading={t('compare.original')} answer={document.original} />
          <AnswerColumn heading={t('compare.candidate')} answer={document.candidate} pendingWhenMissing />
        </div>
      ) : !failed ? (
        <p className="compare-pending" role="status"><LoaderCircle size={13} className="provider-spinner" aria-hidden="true" />{t('compare.loading')}</p>
      ) : null}
      <p className="provider-hint compare-note">{t('compare.note')}</p>
    </Dialog>
  )
}

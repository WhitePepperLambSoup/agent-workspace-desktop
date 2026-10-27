import { FolderInput, RefreshCw, Undo2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import type { WorkbenchBridgeClient } from '../bridge/client'
import { useOptionalI18n } from '../i18n/I18nProvider'
import type { MessageKey } from '../i18n/messages'
import { parseFileBatch, parseUndo, stepVerb, visibleSteps, type FileBatchProblem, type FileBatchView } from './model'

type BatchClient = Pick<WorkbenchBridgeClient, 'listFileBatches' | 'undoFileBatch'>

const STATE_KEYS: Record<string, MessageKey> = {
  done: 'files.batch.state.done',
  undone: 'files.batch.state.undone',
  partly_undone: 'files.batch.state.partly_undone',
  failed: 'files.batch.state.failed',
  interrupted: 'files.batch.state.interrupted',
  running: 'files.batch.state.running',
}

const REASON_KEYS: Record<string, MessageKey> = {
  changed: 'files.batch.reason.changed',
  missing: 'files.batch.reason.missing',
  occupied: 'files.batch.reason.occupied',
  not_empty: 'files.batch.reason.not_empty',
  recycled_missing: 'files.batch.reason.recycled_missing',
  failed: 'files.batch.reason.failed',
}

function when(value: string, locale: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })
}

/** The agent's file batches in this workspace, each with what it changed and Undo. */
export function FileBatchList({ client, workspaceKey }: { client?: Partial<BatchClient>; workspaceKey: string | null }) {
  const { locale, t } = useOptionalI18n()
  const [batches, setBatches] = useState<FileBatchView[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [skipped, setSkipped] = useState<Record<string, FileBatchProblem[]>>({})

  const load = useCallback(async (): Promise<void> => {
    if (!client?.listFileBatches) return
    try {
      const reply = await client.listFileBatches(50)
      const list = (reply.payload as { batches?: unknown[] }).batches
      setBatches(Array.isArray(list) ? list.flatMap((item) => parseFileBatch(item) ?? []) : [])
      setFailed(false)
    } catch {
      setFailed(true)
    }
  }, [client])

  useEffect(() => {
    setBatches(null)
    void load()
  }, [load, workspaceKey])

  const undo = async (batch: FileBatchView): Promise<void> => {
    if (!client?.undoFileBatch || busy) return
    setBusy(batch.id)
    try {
      const outcome = parseUndo((await client.undoFileBatch(batch.id)).payload)
      if (outcome) {
        setBatches((current) => current?.map((item) => item.id === batch.id ? outcome.batch : item) ?? null)
        setSkipped((current) => ({ ...current, [batch.id]: outcome.skipped }))
      }
    } catch {
      setFailed(true)
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="route-section file-batches" aria-label={t('files.batch.tab')}>
      <header>
        <div>
          <h2>{t('files.batch.tab')}</h2>
          <span>{t('files.batch.empty')}</span>
        </div>
        <button type="button" className="icon-button" aria-label={t('runs.refresh')} onClick={() => void load()}><RefreshCw size={14} /></button>
      </header>
      {failed ? <p className="route-error" role="status">{t('files.batch.loadFailed')}</p> : null}
      {batches?.length === 0 ? <p className="route-note">{t('files.batch.none')}</p> : null}
      <ol className="file-batch-list">
        {batches?.map((batch) => {
          const steps = visibleSteps(batch)
          const problems = skipped[batch.id] ?? batch.problems
          return (
            <li key={batch.id} className="file-batch" data-state={batch.state}>
              <header>
                <FolderInput size={14} aria-hidden="true" />
                <div>
                  <strong>{batch.summary || t('files.batch.changes', { count: steps.length })}</strong>
                  <small>{when(batch.createdAt, locale)} · {t(STATE_KEYS[batch.state] ?? 'files.batch.state.done')}</small>
                </div>
                {batch.undoable ? (
                  <button type="button" className="secondary-button" disabled={busy !== null} onClick={() => void undo(batch)}>
                    <Undo2 size={13} />{t(busy === batch.id ? 'files.batch.undoing' : 'files.batch.undo')}
                  </button>
                ) : null}
              </header>
              <details>
                <summary>{t('files.batch.changes', { count: steps.length })}</summary>
                <ul>
                  {steps.map((step, index) => (
                    <li key={`${step.path}:${index}`} data-undone={step.undone || undefined}>
                      <em>{t(`files.action.${stepVerb(step)}` as MessageKey)}</em>
                      <code>{step.path}</code>
                      {step.to && step.action !== 'recycle' ? <> → <code>{step.to}</code></> : null}
                    </li>
                  ))}
                </ul>
              </details>
              {problems.length > 0 ? (
                <ul className="file-batch-problems" aria-label={t('files.batch.leftAlone')}>
                  {problems.map((problem) => (
                    <li key={problem.path}><code>{problem.path}</code> {t(REASON_KEYS[problem.reason] ?? 'files.batch.reason.failed')}</li>
                  ))}
                </ul>
              ) : null}
            </li>
          )
        })}
      </ol>
    </section>
  )
}

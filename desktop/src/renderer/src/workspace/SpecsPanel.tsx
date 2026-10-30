import { Check, ClipboardList, FilePen, Hammer, Plus, RefreshCw, Undo2, Wand2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { WorkbenchBridgeClient } from '../bridge/client'
import { useOptionalI18n } from '../i18n/I18nProvider'
import type { MessageKey } from '../i18n/messages'
import { SafeMarkdown } from '../markdown/SafeMarkdown'

export type SpecClient = Pick<
  WorkbenchBridgeClient,
  'listSpecs' | 'createSpec' | 'getSpec' | 'approveSpec' | 'reopenSpec' | 'specPrompt'
>

type Step = 'requirements' | 'design' | 'tasks' | 'build' | 'done'
type DocumentName = 'requirements' | 'design' | 'tasks'
const DOCUMENTS: DocumentName[] = ['requirements', 'design', 'tasks']

interface SpecSummary {
  id: string
  title: string
  step: Step
  tasksDone: number
  tasksTotal: number
  path: string
}

interface SpecTask {
  number: string
  text: string
  done: boolean
}

interface SpecDetail extends SpecSummary {
  goal: string
  approved: Record<string, number>
  documents: Record<DocumentName, string | null>
  tasks: SpecTask[]
  nextTask: SpecTask | null
}

const ERRORS: Record<string, MessageKey> = {
  spec_document_missing: 'specs.error.documentMissing',
  spec_tasks_missing: 'specs.error.tasksMissing',
  spec_step_mismatch: 'specs.error.stepMismatch',
  invalid_spec: 'specs.error.invalid',
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function errorKey(reason: unknown): MessageKey {
  return ERRORS[reason instanceof Error ? reason.message : String(reason)] ?? 'specs.error.failed'
}

function documentOf(step: Step): DocumentName {
  return step === 'build' || step === 'done' ? 'tasks' : step
}

function stepIndex(step: Step): number {
  return step === 'done' ? 3 : ['requirements', 'design', 'tasks', 'build'].indexOf(step)
}

/** The Workspace page's Specs tab: a feature written down and approved, then built. */
export function SpecsPanel({
  client,
  onAsk,
  onOpenFile,
  refreshKey,
}: {
  client: SpecClient
  /** Sends a request to the current conversation; false when it could not. */
  onAsk?: (prompt: string) => Promise<boolean>
  onOpenFile?: (path: string) => void
  /** Changes when a turn ends: the agent may have written a document. */
  refreshKey?: string
}) {
  const { locale, t } = useOptionalI18n()
  const [specs, setSpecs] = useState<SpecSummary[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [spec, setSpec] = useState<SpecDetail | null>(null)
  const [view, setView] = useState<DocumentName>('requirements')
  const [creating, setCreating] = useState(false)
  const [title, setTitle] = useState('')
  const [goal, setGoal] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<MessageKey | null>(null)
  const [notice, setNotice] = useState<MessageKey | null>(null)
  const shownId = useRef<string | null>(null)

  const show = useCallback((detail: SpecDetail) => {
    setSpec(detail)
    setSelected(detail.id)
    setSpecs((current) => {
      const summary: SpecSummary = { id: detail.id, title: detail.title, step: detail.step, tasksDone: detail.tasksDone, tasksTotal: detail.tasksTotal, path: detail.path }
      return current.some((item) => item.id === detail.id)
        ? current.map((item) => (item.id === detail.id ? summary : item))
        : [summary, ...current]
    })
  }, [])

  const load = useCallback(async () => {
    try {
      const list = record((await client.listSpecs()).payload).specs
      const found = Array.isArray(list) ? (list as SpecSummary[]) : []
      setSpecs(found)
      setSelected((current) => current && found.some((item) => item.id === current) ? current : (found[0]?.id ?? null))
    } catch (reason) {
      setError(errorKey(reason))
    }
  }, [client])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  useEffect(() => {
    if (!selected) {
      setSpec(null)
      return
    }
    let current = true
    void client.getSpec(selected).then((reply) => {
      if (!current) return
      const detail = record(reply.payload).spec as SpecDetail
      setSpec(detail)
      // Another spec opens at its current step; the same one, read again, stays where it was.
      if (shownId.current !== detail.id) {
        shownId.current = detail.id
        setView(documentOf(detail.step))
      }
    }, (reason: unknown) => {
      if (current) setError(errorKey(reason))
    })
    return () => {
      current = false
    }
  }, [client, selected, refreshKey])

  const run = async (work: () => Promise<void>): Promise<void> => {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await work()
    } catch (reason) {
      setError(errorKey(reason))
    } finally {
      setBusy(false)
    }
  }

  const create = (): Promise<void> => run(async () => {
    const detail = record((await client.createSpec(title.trim(), goal.trim())).payload).spec as SpecDetail
    setCreating(false)
    setTitle('')
    setGoal('')
    shownId.current = detail.id
    show(detail)
    setView('requirements')
  })

  const ask = (step: string, task?: string): Promise<void> => run(async () => {
    if (!spec || !onAsk) return
    const prompt = String(record((await client.specPrompt(spec.id, step, locale, task)).payload).prompt ?? '')
    if (await onAsk(prompt)) setNotice('specs.sent')
    else setError('changes.hunkCommentFailed')
  })

  const approve = (): Promise<void> => run(async () => {
    if (!spec) return
    const detail = record((await client.approveSpec(spec.id, spec.step)).payload).spec as SpecDetail
    show(detail)
    setView(documentOf(detail.step))
  })

  const reopen = (document: DocumentName): Promise<void> => run(async () => {
    if (!spec || !window.confirm(t('specs.reopenConfirm'))) return
    show(record((await client.reopenSpec(spec.id, document)).payload).spec as SpecDetail)
    setView(document)
  })

  const current = spec ? stepIndex(spec.step) : 0
  const document = spec?.documents[view] ?? null
  const viewIndex = DOCUMENTS.indexOf(view)
  const isCurrentDocument = spec !== null && spec.step === view

  return (
    <section className="specs-panel" aria-label={t('specs.tab')}>
      <aside className="specs-list">
        <header>
          <strong>{t('specs.tab')}</strong>
          <button type="button" className="icon-button" aria-label={t('changes.refresh')} onClick={() => void load()}>
            <RefreshCw size={13} />
          </button>
          <button type="button" className="icon-button" aria-label={t('specs.new')} title={t('specs.new')} onClick={() => setCreating(true)}>
            <Plus size={14} />
          </button>
        </header>
        {specs.map((item) => (
          <button key={item.id} type="button" className={`specs-item${item.id === selected ? ' active' : ''}`} aria-pressed={item.id === selected} onClick={() => setSelected(item.id)}>
            <ClipboardList size={13} aria-hidden="true" />
            <span>
              <strong>{item.title}</strong>
              <small>
                {t(`specs.step.${item.step}` as MessageKey)}
                {item.tasksTotal > 0 ? ` · ${item.tasksDone}/${item.tasksTotal}` : ''}
              </small>
            </span>
          </button>
        ))}
        {specs.length === 0 && !creating ? <p className="route-note">{t('specs.empty')}</p> : null}
      </aside>

      <div className="specs-detail">
        {error ? <p className="route-error" role="status">{t(error)}</p> : null}
        {notice ? <p className="review-notice" role="status">{t(notice)}</p> : null}
        {creating ? (
          <form className="specs-new" onSubmit={(event) => { event.preventDefault(); void create() }}>
            <h3>{t('specs.new')}</h3>
            <input aria-label={t('specs.title')} placeholder={t('specs.titlePlaceholder')} value={title} onChange={(event) => setTitle(event.target.value)} autoFocus />
            <textarea aria-label={t('specs.goal')} placeholder={t('specs.goalPlaceholder')} value={goal} rows={5} onChange={(event) => setGoal(event.target.value)} />
            <div className="git-row-actions">
              <button type="button" className="secondary-button" onClick={() => setCreating(false)}>{t('git.close')}</button>
              <button type="submit" className="primary-button" disabled={!title.trim() || busy}>{t('specs.create')}</button>
            </div>
          </form>
        ) : spec ? (
          <>
            <header className="specs-head">
              <h2>{spec.title}</h2>
              <ol className="specs-steps">
                {(['requirements', 'design', 'tasks', 'build'] as const).map((step, index) => (
                  <li key={step} className={index < current || spec.step === 'done' ? 'done' : index === current ? 'current' : ''}>
                    {index < DOCUMENTS.length ? (
                      <button type="button" aria-pressed={view === step} disabled={!spec.documents[step as DocumentName] && index !== current} onClick={() => setView(step as DocumentName)}>
                        {index < current ? <Check size={11} aria-hidden="true" /> : null}{t(`specs.step.${step}` as MessageKey)}
                      </button>
                    ) : (
                      <span>{t(`specs.step.${spec.step === 'done' ? 'done' : 'build'}` as MessageKey)}{spec.tasksTotal > 0 ? ` ${spec.tasksDone}/${spec.tasksTotal}` : ''}</span>
                    )}
                  </li>
                ))}
              </ol>
            </header>

            <div className="specs-actions">
              {isCurrentDocument && onAsk ? (
                <button type="button" className={document ? 'secondary-button' : 'primary-button'} disabled={busy} onClick={() => void ask(view)}>
                  <Wand2 size={13} aria-hidden="true" />{t(document ? `specs.rewrite.${view}` as MessageKey : `specs.write.${view}` as MessageKey)}
                </button>
              ) : null}
              {isCurrentDocument && document ? (
                <button type="button" className="primary-button" disabled={busy} onClick={() => void approve()}>
                  <Check size={13} aria-hidden="true" />{t(`specs.approve.${view}` as MessageKey)}
                </button>
              ) : null}
              {!isCurrentDocument && document && viewIndex < current ? (
                <button type="button" className="secondary-button" disabled={busy} onClick={() => void reopen(view)}>
                  <Undo2 size={13} aria-hidden="true" />{t('specs.reopen')}
                </button>
              ) : null}
              {document && onOpenFile ? (
                <button type="button" className="secondary-button" onClick={() => onOpenFile(`${spec.path}/${view}.md`)}>
                  <FilePen size={13} aria-hidden="true" />{t('specs.edit')}
                </button>
              ) : null}
            </div>

            {(spec.step === 'build' || spec.step === 'done') && view === 'tasks' ? (
              <div className="specs-build">
                <div className="specs-actions">
                  {spec.nextTask && onAsk ? (
                    <>
                      <button type="button" className="primary-button" disabled={busy} onClick={() => void ask('build', spec.nextTask!.number)}>
                        <Hammer size={13} aria-hidden="true" />{t('specs.doTask', { task: spec.nextTask.number })}
                      </button>
                      <button type="button" className="secondary-button" disabled={busy} onClick={() => void ask('build')}>
                        {t('specs.buildRest')}
                      </button>
                    </>
                  ) : null}
                  {spec.step === 'done' ? <span className="specs-done">{t('specs.allDone')}</span> : null}
                </div>
                <ul className="specs-tasks">
                  {spec.tasks.map((task) => (
                    <li key={task.number} className={task.done ? 'done' : ''}>
                      <input type="checkbox" checked={task.done} readOnly aria-label={t('specs.taskDone', { task: task.number })} />
                      <span><strong>{task.number}.</strong> {task.text}</span>
                      {!task.done && onAsk && task.number !== spec.nextTask?.number ? (
                        <button type="button" className="text-btn" disabled={busy} onClick={() => void ask('build', task.number)}>{t('specs.doThis')}</button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {document ? (
              <article className="specs-document">
                <SafeMarkdown source={document} />
              </article>
            ) : (
              <p className="route-note">{t(`specs.missing.${view}` as MessageKey)}</p>
            )}
          </>
        ) : (
          <p className="route-note">{t('specs.intro')}</p>
        )}
      </div>
    </section>
  )
}

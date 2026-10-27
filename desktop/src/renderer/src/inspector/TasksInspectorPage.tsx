import { CheckSquare, Clock, ListTodo, Plus, Square, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { WorkbenchBridgeClient } from '../bridge/client'
import { useOptionalI18n } from '../i18n/I18nProvider'
import type { MessageKey } from '../i18n/messages'
import type { WorkbenchState } from '../state/workbench-store'

interface ParsedTask {
  id: string
  text: string
  completed: boolean
}

export interface PersistentTask {
  id: string
  sessionId: string
  content: string
  status: string
  position?: number
  createdAt: string
  updatedAt: string
}

type TasksClient = Pick<
  WorkbenchBridgeClient,
  'listTasks' | 'createTask' | 'updateTask' | 'deleteTask'
>

export function TasksInspectorPage({
  state,
  client,
}: {
  state: WorkbenchState
  client?: TasksClient
}) {
  const { t } = useOptionalI18n()
  const [persistentTasks, setPersistentTasks] = useState<PersistentTask[]>([])
  const [newTaskTitle, setNewTaskTitle] = useState('')
  const [loadingTasks, setLoadingTasks] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [taskError, setTaskError] = useState<MessageKey | null>(null)
  const taskRequestGeneration = useRef(0)

  const rawSessionId = state.selectedSession?.id
  const sessionId = typeof rawSessionId === 'string' && rawSessionId.trim() ? rawSessionId : null

  const loadTasks = useCallback(async (): Promise<void> => {
    const generation = ++taskRequestGeneration.current
    if (!client?.listTasks || !sessionId) {
      setPersistentTasks([])
      setLoadingTasks(false)
      setTaskError(null)
      return
    }
    setLoadingTasks(true)
    setTaskError(null)
    try {
      const res = await client.listTasks(sessionId)
      if (generation !== taskRequestGeneration.current) return
      const data = res.payload as unknown as { tasks?: PersistentTask[] }
      if (Array.isArray(data?.tasks)) {
        setPersistentTasks(data.tasks)
      }
    } catch {
      if (generation === taskRequestGeneration.current) {
        setPersistentTasks([])
        setTaskError('inspector.tasksLoadFailed')
      }
    } finally {
      if (generation === taskRequestGeneration.current) setLoadingTasks(false)
    }
  }, [client, sessionId])

  useEffect(() => {
    void loadTasks()
  }, [loadTasks])

  const handleAddTask = async (): Promise<void> => {
    const content = newTaskTitle.trim()
    if (!client?.createTask || !sessionId || !content || submitting) return
    setSubmitting(true)
    setTaskError(null)
    try {
      await client.createTask(content, 'pending', 0, sessionId)
      setNewTaskTitle('')
      await loadTasks()
    } catch {
      setTaskError('inspector.taskSaveFailed')
    } finally {
      setSubmitting(false)
    }
  }

  const handleToggleTask = async (task: PersistentTask): Promise<void> => {
    if (!client?.updateTask || !sessionId) return
    const nextStatus = task.status === 'completed' ? 'pending' : 'completed'
    setTaskError(null)
    try {
      await client.updateTask(task.id, { status: nextStatus }, sessionId)
      await loadTasks()
    } catch {
      setTaskError('inspector.taskSaveFailed')
    }
  }

  const handleDeleteTask = async (taskId: string): Promise<void> => {
    if (!client?.deleteTask || !sessionId) return
    setTaskError(null)
    try {
      await client.deleteTask(taskId, sessionId)
      await loadTasks()
    } catch {
      setTaskError('inspector.taskSaveFailed')
    }
  }

  // Parse read-only checklist items directly from assistant markdown messages
  const markdownTasks = useMemo(() => {
    const list: ParsedTask[] = []
    let index = 0

    for (const item of state.timeline) {
      if (item.text && item.role === 'assistant') {
        const lines = item.text.split('\n')
        for (const line of lines) {
          const trimmed = line.trim()
          const checkMatch = trimmed.match(/^[-*]\s+\[([ xX])\]\s+(.+)$/)
          if (checkMatch) {
            index++
            const isDone = checkMatch[1].toLowerCase() === 'x'
            const text = checkMatch[2].trim()
            list.push({
              id: `task-item-${index}`,
              text,
              completed: isDone,
            })
          }
        }
      }
    }
    return list
  }, [state.timeline])

  return (
    <div className="tasks-inspector-content">
      {/* Persistent Task Graph */}
      <section className="inspector-section">
        <header className="tasks-section-header">
          <h3>
            <ListTodo size={13} />
            <span>{t('inspector.persistentTasksTitle')}</span>
          </h3>
          {persistentTasks.length > 0 ? (
            <span className="tasks-progress-badge">
              {persistentTasks.filter((t) => t.status === 'completed').length}/{persistentTasks.length}
            </span>
          ) : null}
        </header>

        {sessionId ? (
          <>
            {taskError ? (
              <p role="status" className="route-error">
                {t(taskError)}
              </p>
            ) : null}
            <form
              className="persistent-task-form"
              onSubmit={(e) => {
                e.preventDefault()
                void handleAddTask()
              }}
            >
              <input
                type="text"
                placeholder={t('inspector.addTaskPlaceholder')}
                aria-label={t('inspector.addTaskPlaceholder')}
                value={newTaskTitle}
                onChange={(e) => setNewTaskTitle(e.target.value)}
                disabled={submitting}
              />
              <button
                type="submit"
                className="icon-button"
                aria-label={t('inspector.addTask')}
                title={t('inspector.addTask')}
                disabled={!newTaskTitle.trim() || submitting}
              >
                <Plus size={14} />
              </button>
            </form>

            {loadingTasks ? (
              <p className="route-note">{t('settings.provider.loading')}</p>
            ) : persistentTasks.length > 0 ? (
              <div className="tasks-checklist" role="list">
                {persistentTasks.map((task) => {
                  const isCompleted = task.status === 'completed'
                  return (
                    <div
                      key={task.id}
                      role="listitem"
                      className={`task-check-item ${isCompleted ? 'completed' : ''}`}
                    >
                      <button
                        type="button"
                        className="task-checkbox-btn"
                        aria-label={isCompleted ? t('inspector.taskCompleted') : t('inspector.taskPending')}
                        onClick={() => void handleToggleTask(task)}
                      >
                        {isCompleted ? <CheckSquare size={14} /> : <Square size={14} />}
                      </button>
                      <span className="task-text">{task.content}</span>
                      <button
                        type="button"
                        className="icon-button task-delete-btn"
                        aria-label={t('inspector.deleteTask')}
                        title={t('inspector.deleteTask')}
                        onClick={() => void handleDeleteTask(task.id)}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  )
                })}
              </div>
            ) : (
              <p className="inspector-empty-text">{t('inspector.noPersistentTasks')}</p>
            )}
          </>
        ) : (
          <p className="inspector-empty-text">{t('composer.readiness.noSession')}</p>
        )}
      </section>

      {/* Turn Facts */}
      <section className="inspector-section">
        <h3>
          <Clock size={13} />
          <span>{t('inspector.turn')}</span>
        </h3>
        <dl className="fact-list">
          <div>
            <dt>{t('inspector.active')}</dt>
            <dd>{state.runtime.activeTurn ? t('status.running') : t('inspector.idle')}</dd>
          </div>
          <div>
            <dt>{t('inspector.timeline')}</dt>
            <dd>{state.timeline.length}</dd>
          </div>
          <div>
            <dt>{t('inspector.approvals')}</dt>
            <dd>{Object.keys(state.approvals).length}</dd>
          </div>
        </dl>
      </section>

      {/* Read-Only Checklist Reference */}
      <section className="inspector-section">
        <header className="tasks-section-header">
          <h3>
            <ListTodo size={13} />
            <span>{t('inspector.markdownChecklistTitle')}</span>
          </h3>
          {markdownTasks.length > 0 ? (
            <span className="tasks-progress-badge">
              {markdownTasks.filter((t) => t.completed).length}/{markdownTasks.length}
            </span>
          ) : null}
        </header>
        <p className="route-note" style={{ margin: '4px 0 8px 0', fontSize: '11px' }}>
          {t('inspector.markdownChecklistNotice')}
        </p>

        {markdownTasks.length > 0 ? (
          <div className="tasks-checklist" role="list">
            {markdownTasks.map((task) => (
              <div
                key={task.id}
                role="listitem"
                className={`task-check-item ${task.completed ? 'completed' : ''}`}
                style={{ cursor: 'default' }}
              >
                <span className="task-checkbox">
                  {task.completed ? <CheckSquare size={14} /> : <Square size={14} />}
                </span>
                <span className="task-text">{task.text}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="inspector-empty-text">{t('inspector.noPlanTasks')}</p>
        )}
      </section>
    </div>
  )
}

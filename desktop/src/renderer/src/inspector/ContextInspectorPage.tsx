import { Brain, CheckCircle, FileText, Shield, RefreshCw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import type { WorkbenchBridgeClient } from '../bridge/client'
import { useOptionalI18n } from '../i18n/I18nProvider'
import { KnowledgeSessionSection } from '../knowledge/KnowledgeSessionSection'
import { SessionUsageCard } from './SessionUsageCard'
import { localizeKnownStatus } from '../i18n/messages'
import type { WorkbenchState } from '../state/workbench-store'
import { ModelContextDetails, type ModelContextManifest, type ModelUsage } from './ModelContextDetails'

interface BudgetBreakdown {
  systemTokens: number
  historyTokens: number
  memoryTokens: number
  toolsTokens: number
}

interface AvailableContextBudget {
  available: true
  maxTokens: number
  estimatedUsedTokens: number
  percentage: number
  source?: string
  breakdown?: BudgetBreakdown
}

interface UnavailableContextBudget {
  available: false
  source?: string
}

type ContextBudget = AvailableContextBudget | UnavailableContextBudget

interface ContextData {
  manifest?: ModelContextManifest | null
  lastUsage?: ModelUsage | null
  memory?: Array<{ id: string; type: string; summary: string; createdAt: string }>
  skills?: string[]
  budget?: ContextBudget
  instructions?: Array<{ title: string; detail: string }>
}

const isNonNegativeInteger = (value: unknown): value is number => (
  typeof value === 'number' && Number.isInteger(value) && Number.isFinite(value) && value >= 0
)

function parseBreakdown(value: unknown): BudgetBreakdown | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const breakdown = value as Partial<BudgetBreakdown>
  if (!isNonNegativeInteger(breakdown.systemTokens) ||
    !isNonNegativeInteger(breakdown.historyTokens) ||
    !isNonNegativeInteger(breakdown.memoryTokens) ||
    !isNonNegativeInteger(breakdown.toolsTokens)) return undefined
  return {
    systemTokens: breakdown.systemTokens,
    historyTokens: breakdown.historyTokens,
    memoryTokens: breakdown.memoryTokens,
    toolsTokens: breakdown.toolsTokens,
  }
}

function parseBudget(value: unknown): ContextBudget | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const budget = value as {
    available?: unknown
    source?: unknown
    maxTokens?: unknown
    estimatedUsedTokens?: unknown
    percentage?: unknown
    breakdown?: unknown
  }
  const source = typeof budget.source === 'string' && budget.source.trim() ? budget.source : undefined
  if (budget.available !== true) return { available: false, source }
  if (!isNonNegativeInteger(budget.maxTokens) || budget.maxTokens <= 0 ||
    !isNonNegativeInteger(budget.estimatedUsedTokens) ||
    typeof budget.percentage !== 'number' || !Number.isFinite(budget.percentage)) {
    return { available: false, source: 'invalid_budget' }
  }
  return {
    available: true,
    maxTokens: budget.maxTokens,
    estimatedUsedTokens: budget.estimatedUsedTokens,
    percentage: Math.min(100, Math.max(0, Math.round(budget.percentage))),
    source,
    breakdown: parseBreakdown(budget.breakdown),
  }
}

function formatMemoryTime(value: string, locale: string, fallback: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? fallback
    : date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
}

export function ContextInspectorPage({
  state,
  client,
  onExcludeAttachment,
}: {
  state: WorkbenchState
  client?: Pick<WorkbenchBridgeClient, 'getWorkspaceContext'> & Partial<Pick<WorkbenchBridgeClient, 'getSessionUsage' | 'knowledgeSession' | 'setKnowledgeSession'>>
  onExcludeAttachment?: (digest: string) => Promise<unknown> | unknown
}) {
  const { locale, t } = useOptionalI18n()
  const [contextData, setContextData] = useState<ContextData | null>(null)
  const [contextError, setContextError] = useState(false)
  const [contextLoading, setContextLoading] = useState(false)
  const [retry, setRetry] = useState(0)
  const [excludingDigest, setExcludingDigest] = useState<string | null>(null)
  const [excludeError, setExcludeError] = useState(false)

  // The wire sequence advances for every runtime event. Refreshing the
  // context inspector for all of them causes request storms and makes the
  // panel flicker. Use only events that can change the model request or its
  // accounting, while keeping the ordinary sequence out of the dependency
  // list so command responses do not trigger redundant reads.
  const sessionId = typeof state.selectedSession?.id === 'string' ? state.selectedSession.id : null
  const workspacePath = typeof state.workspace?.path === 'string' ? state.workspace.path : null
  const runtimeEpoch = state.runtime.epoch
  const contextSignalKey = `${runtimeEpoch ?? ''}:${sessionId ?? ''}:${workspacePath ?? ''}`
  const contextSignalRef = useRef({ key: contextSignalKey, sequence: 0 })
  if (contextSignalRef.current.key !== contextSignalKey) {
    contextSignalRef.current = { key: contextSignalKey, sequence: 0 }
  }
  const observedContextSignal = [...state.operational.logs]
    .reverse()
    .find((entry) => {
      const belongsToSession = sessionId === null
        ? entry.sessionId === null
        : entry.sessionId === sessionId
      return belongsToSession && (
        entry.type === 'model.requested' ||
        entry.type === 'usage.updated' ||
        entry.type === 'context.compacted'
      )
    })?.sequence ?? 0
  contextSignalRef.current.sequence = Math.max(
    contextSignalRef.current.sequence,
    observedContextSignal,
  )
  const latestContextSignal = contextSignalRef.current.sequence
  useEffect(() => {
    setContextData(null)
    setContextError(false)
  }, [client, sessionId, workspacePath, runtimeEpoch])

  useEffect(() => {
    setContextError(false)
    if (!client?.getWorkspaceContext) return
    let active = true
    setContextLoading(true)
    client
      .getWorkspaceContext()
      .then((res) => {
        if (active) {
          const payload = res.payload
          if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
            const record = payload as Record<string, unknown>
            setContextData({ ...record, budget: parseBudget(record.budget) } as ContextData)
          } else {
            setContextData(null)
          }
        }
      })
      .catch(() => { if (active) setContextError(true) })
      .finally(() => { if (active) setContextLoading(false) })
    return () => {
      active = false
    }
  }, [
    client,
    sessionId,
    workspacePath,
    runtimeEpoch,
    state.runtime.activeTurn,
    latestContextSignal,
    retry,
  ])

  const handleExcludeAttachment = async (digest: string): Promise<void> => {
    if (!onExcludeAttachment || excludingDigest !== null) return
    setExcludingDigest(digest)
    setExcludeError(false)
    try {
      await onExcludeAttachment(digest)
      setRetry((value) => value + 1)
    } catch {
      setExcludeError(true)
    } finally {
      setExcludingDigest(null)
    }
  }

  const budget = contextData?.budget
  const memory = contextData?.memory ?? []
  const skills = contextData?.skills ?? []
  const loadedUserTurns = state.timeline.filter(
    (item) => item.type === 'message.created' && item.role === 'user',
  ).length
  const instructions = contextData?.instructions ?? [
    {
      title: t('settings.provider.runtimeMode'),
      detail: t('inspector.runtimeModeActive', { mode: localizeKnownStatus(locale, state.runtime.mode) }),
    },
  ]

  return (
    <div className="context-inspector-content">
      {contextLoading ? <p role="status">{t('inspector.contextLoading')}</p> : null}
      {contextError ? <div role="alert" className="route-error">
        <p>{t('inspector.contextFailed')}</p>
        <button type="button" className="secondary-button" onClick={() => setRetry((value) => value + 1)}>
          <RefreshCw size={13} />{t('inspector.contextRetry')}
        </button>
      </div> : null}
      {/* Token Budget Meter & Breakdown */}
      {excludeError ? (
        <div role="alert" className="route-error">
          <p>{t('context.excludeImageFailed')}</p>
        </div>
      ) : null}
      <SessionUsageCard
        sessionId={sessionId}
        client={client}
        refreshKey={`${runtimeEpoch ?? ''}:${state.runtime.activeTurn ?? ''}:${latestContextSignal}`}
      />
      <KnowledgeSessionSection sessionId={sessionId} client={client} refreshKey={`${runtimeEpoch ?? ''}:${state.runtime.activeTurn ?? ''}`} />
      <ModelContextDetails
        manifest={contextData?.manifest}
        usage={contextData?.lastUsage}
        onExcludeAttachment={onExcludeAttachment ? handleExcludeAttachment : undefined}
        excludingDigest={excludingDigest}
      />
      <section className="inspector-section">
        <h3>{t('inspector.tokenBudget')}</h3>
        {budget?.available === true ? (
          <div className="budget-meter">
            <div className="budget-bar-track">
              <div
                className="budget-bar-fill"
                style={{ width: `${Math.max(4, Math.min(100, budget.percentage))}%` }}
              />
            </div>
            <div className="budget-stats">
              <span>
                {t('context.inputBudget', {
                  used: budget.estimatedUsedTokens.toLocaleString(locale),
                  max: budget.maxTokens.toLocaleString(locale),
                })}
              </span>
              <strong>{budget.percentage}%</strong>
            </div>
            <small>{t('context.budgetNote')}</small>

            {budget.breakdown ? (
              <div className="budget-breakdown-grid">
                <div className="breakdown-item">
                  <span className="breakdown-label">{t('inspector.tokenSystem')}</span>
                  <strong className="breakdown-val">{budget.breakdown.systemTokens.toLocaleString(locale)}</strong>
                </div>
                <div className="breakdown-item">
                  <span className="breakdown-label">{t('inspector.tokenHistory')}</span>
                  <strong className="breakdown-val">{budget.breakdown.historyTokens.toLocaleString(locale)}</strong>
                </div>
                <div className="breakdown-item">
                  <span className="breakdown-label">{t('inspector.tokenMemory')}</span>
                  <strong className="breakdown-val">{budget.breakdown.memoryTokens.toLocaleString(locale)}</strong>
                </div>
                <div className="breakdown-item">
                  <span className="breakdown-label">{t('inspector.tokenTools')}</span>
                  <strong className="breakdown-val">{budget.breakdown.toolsTokens.toLocaleString(locale)}</strong>
                </div>
              </div>
            ) : null}

            {budget.source ? (
              <small className="budget-source-tag">
                {t('inspector.tokenSource', { source: budget.source })}
              </small>
            ) : null}
          </div>
        ) : (
          <p className="inspector-empty-text">{t('context.budgetUnavailable')}</p>
        )}
      </section>

      {/* Runtime & Model facts */}
      <section className="inspector-section">
        <h3>{t('inspector.runtime')}</h3>
        <dl className="fact-list">
          <div>
            <dt>{t('inspector.status')}</dt>
            <dd className={state.runtime.ready ? 'status-ok' : undefined}>
              <CheckCircle size={12} />
              {state.runtime.stale
                ? t('workbench.resyncing')
                : localizeKnownStatus(locale, state.runtime.state)}
            </dd>
          </div>
          <div>
            <dt>{t('inspector.provider')}</dt>
            <dd>{String(state.provider?.id ?? t('common.unavailable'))}</dd>
          </div>
          <div>
            <dt>{t('inspector.model')}</dt>
            <dd>{String(state.provider?.model ?? t('common.unavailable'))}</dd>
          </div>
          <div>
            <dt>{t('inspector.mode')}</dt>
            <dd>{localizeKnownStatus(locale, state.runtime.mode)}</dd>
          </div>
        </dl>
      </section>

      <section className="inspector-section">
        <h3>{t('inspector.localHistory')}</h3>
        <dl className="fact-list">
          <div>
            <dt>{t('inspector.loadedTurns')}</dt>
            <dd>{loadedUserTurns}</dd>
          </div>
          <div>
            <dt>{t('inspector.loadedEvents')}</dt>
            <dd>{state.timeline.length}</dd>
          </div>
          <div>
            <dt>{t('inspector.earlierHistory')}</dt>
            <dd>{t(state.history.hasMore ? 'common.yes' : 'common.no')}</dd>
          </div>
        </dl>
        <p className="inspector-empty-text">{t('inspector.localHistoryHelp')}</p>
      </section>

      {/* Workspace facts */}
      <section className="inspector-section">
        <h3>{t('inspector.workspace')}</h3>
        <dl className="fact-list">
          <div>
            <dt>{t('inspector.name')}</dt>
            <dd>{String(state.workspace?.name ?? t('common.unavailable'))}</dd>
          </div>
          <div>
            <dt>{t('inspector.sessions')}</dt>
            <dd>{state.sessions.length}</dd>
          </div>
          <div>
            <dt>{t('inspector.sequence')}</dt>
            <dd>{state.runtime.sequence}</dd>
          </div>
        </dl>
      </section>

      {/* Memory facts */}
      <section className="inspector-section">
        <h3>
          <Brain size={13} />
          <span>{t('inspector.memoryFacts')}</span>
        </h3>
        {memory.length === 0 ? (
          <p className="inspector-empty-text">{t('inspector.noMemory')}</p>
        ) : (
          <div className="memory-fact-list">
            {memory.map((m) => (
              <div key={m.id} className="memory-fact-item">
                <span className="memory-fact-summary">{m.summary}</span>
                <small className="memory-fact-time">
                  {formatMemoryTime(m.createdAt, locale, t('context.noTimestamp'))}
                </small>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Active Skills & Tool permissions */}
      <section className="inspector-section">
        <h3>
          <Shield size={13} />
          <span>{t('inspector.skillsAndPermissions')}</span>
        </h3>
        <div className="skill-badges">
          {skills.length === 0 ? (
            <span className="skill-badge-empty">{t('inspector.defaultCapabilities')}</span>
          ) : (
            skills.map((skill) => (
              <span key={skill} className="skill-badge">
                {skill}
              </span>
            ))
          )}
        </div>
      </section>

      {/* Instructions & Prompt Rules */}
      <section className="inspector-section">
        <h3>
          <FileText size={13} />
          <span>{t('inspector.instructions')}</span>
        </h3>
        <div className="instruction-list">
          {instructions.map((inst, idx) => (
            <div key={idx} className="instruction-card">
              <strong>{inst.title === 'Runtime Mode' ? t('settings.provider.runtimeMode') : inst.title}</strong>
              <p>{inst.title === 'Runtime Mode' && inst.detail === `Agent Workspace ${state.runtime.mode} mode active.`
                ? t('inspector.runtimeModeActive', { mode: localizeKnownStatus(locale, state.runtime.mode) })
                : inst.detail}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

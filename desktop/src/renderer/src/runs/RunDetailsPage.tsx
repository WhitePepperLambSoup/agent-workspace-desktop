import { AlertTriangle, CheckCircle, CircleDot, RotateCcw } from 'lucide-react'

import { useOptionalI18n } from '../i18n/I18nProvider'
import { localizeKnownStatus } from '../i18n/messages'

export interface RunPhaseView {
  id: string
  label: string
  state: string
  progress?: number
  attempts?: number
  failureClass?: string | null
  failureReason?: string | null
  requiresUserAction?: boolean
}

export function RunDetailsPage({
  phases,
  onRetry,
  compact = false,
}: {
  phases: RunPhaseView[]
  onRetry?: (phase: RunPhaseView) => void
  compact?: boolean
}) {
  const { locale, t } = useOptionalI18n()
  return (
    <section className={`run-phase-timeline${compact ? ' is-compact' : ''}`} aria-label={t('runs.phases')} data-testid="run-phase-timeline">
      <header className="run-plan-heading">
        <h3>{t('runs.phases')}</h3>
        <span>{phases.filter((phase) => phase.state === 'completed').length}/{phases.length}</span>
      </header>
      <div className="run-phase-list">
        {phases.map((phase) => {
          const failed = phase.state === 'failed' || phase.state === 'paused'
          return (
            <article key={phase.id} className={`run-phase state-${phase.state}`} data-testid={`run-phase-${phase.id}`} aria-label={compact ? phase.label : undefined}>
              <span className="run-phase-icon">
                {phase.state === 'completed' ? <CheckCircle size={14} /> : failed ? <AlertTriangle size={14} /> : <CircleDot size={14} />}
              </span>
              <div className="run-phase-body">
                {compact ? null : <strong>{phase.label}</strong>}
                <small>{localizeKnownStatus(locale, phase.state)}{phase.attempts ? ` · ${t('runs.phaseAttempt', { count: phase.attempts })}` : ''}</small>
                {phase.failureClass || phase.failureReason ? <small className="run-phase-failure">{phase.failureClass ?? t('status.failure')}{phase.failureReason ? `: ${phase.failureReason}` : ''}</small> : null}
                {phase.requiresUserAction ? <small className="run-phase-action">{t('runs.userActionRequired')}</small> : null}
              </div>
              {onRetry && failed && !phase.requiresUserAction ? (
                <button type="button" className="secondary-button" onClick={() => onRetry(phase)}>
                  <RotateCcw size={12} /> {t('runs.retryPhase')}
                </button>
              ) : null}
            </article>
          )
        })}
        {phases.length === 0 ? <p className="route-note">{t('runs.noPhases')}</p> : null}
      </div>
    </section>
  )
}

import { Armchair, Check, CircleAlert, CircleDot, Loader2, Square, Users } from 'lucide-react'

import { useOptionalI18n, useText } from '../i18n/I18nProvider'
import type { MessageKey } from '../i18n/messages'
import { FINISHED_RUN_STATES, type SubagentView } from '../state/workbench-store'
import { activityKind } from '../team/activity'

const STATE_LABELS: Record<string, string> = {
  draft: 'Waiting to start',
  queued: 'Waiting to start',
  starting: 'Starting',
  running: 'Working',
  needs_attention: 'Needs you',
  succeeded: 'Done',
  failed: 'Failed',
  cancelled: 'Stopped',
}

function StateIcon({ state }: { state: string }) {
  if (state === 'succeeded') return <Check size={12} aria-hidden="true" />
  if (state === 'failed' || state === 'needs_attention') return <CircleAlert size={12} aria-hidden="true" />
  if (state === 'cancelled') return <Square size={11} aria-hidden="true" />
  if (state === 'running' || state === 'starting') return <Loader2 size={12} className="is-spinning" aria-hidden="true" />
  return <CircleDot size={12} aria-hidden="true" />
}

/**
 * The sub-agents the selected conversation is waiting on; each opens its run. On an expert
 * team's turn the strip names the round and says what each expert is doing.
 */
export function SubagentStrip({ subagents, onOpen, onWatch }: {
  subagents: readonly SubagentView[]
  onOpen: (runId: string) => void
  /** Watch the team in the studio. */
  onWatch?: () => void
}) {
  const tx = useText()
  const { t } = useOptionalI18n()
  if (!subagents.some((item) => !FINISHED_RUN_STATES.has(item.state))) return null
  const done = subagents.filter((item) => FINISHED_RUN_STATES.has(item.state)).length
  const team = subagents.some((item) => item.expert)
  const reviewing = subagents.some((item) => item.phase === 'review')
  return (
    <section className="subagent-strip" aria-label={tx('Sub-agents')} data-team={team ? 'true' : 'false'}>
      <header>
        <Users size={13} aria-hidden="true" />
        <strong>{team ? t('team.strip.title') : tx('Sub-agents working')}</strong>
        {team ? <span className="subagent-phase">{t(reviewing ? 'team.phase.review' : 'team.phase.work')}</span> : null}
        <span>{tx('{done} of {total} finished', { done, total: subagents.length })}</span>
        {team && onWatch ? (
          <button type="button" className="subagent-watch" onClick={onWatch}>
            <Armchair size={12} aria-hidden="true" />
            {t('team.strip.watch')}
          </button>
        ) : null}
      </header>
      <ul>
        {subagents.map((item) => (
          <li key={item.runId} data-state={item.state}>
            <button type="button" onClick={() => onOpen(item.runId)} title={tx('Open in Agent runs')}>
              <StateIcon state={item.state} />
              <span className="subagent-title">{item.title}</span>
              <small>
                {item.state === 'running' && item.activity
                  ? t(`team.activity.${item.activity === 'tool' ? activityKind(item.tool) : 'thinking'}` as MessageKey)
                  : tx(STATE_LABELS[item.state] ?? item.state)}
              </small>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

import { Check, CircleAlert, CircleDot, Loader2, Square, Users } from 'lucide-react'

import { useText } from '../i18n/I18nProvider'
import { FINISHED_RUN_STATES, type SubagentView } from '../state/workbench-store'

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

/** The sub-agents the selected conversation is waiting on; each opens its run. */
export function SubagentStrip({ subagents, onOpen }: { subagents: readonly SubagentView[]; onOpen: (runId: string) => void }) {
  const tx = useText()
  if (!subagents.some((item) => !FINISHED_RUN_STATES.has(item.state))) return null
  const done = subagents.filter((item) => FINISHED_RUN_STATES.has(item.state)).length
  return (
    <section className="subagent-strip" aria-label={tx('Sub-agents')}>
      <header>
        <Users size={13} aria-hidden="true" />
        <strong>{tx('Sub-agents working')}</strong>
        <span>{tx('{done} of {total} finished', { done, total: subagents.length })}</span>
      </header>
      <ul>
        {subagents.map((item) => (
          <li key={item.runId} data-state={item.state}>
            <button type="button" onClick={() => onOpen(item.runId)} title={tx('Open in Agent runs')}>
              <StateIcon state={item.state} />
              <span className="subagent-title">{item.title}</span>
              <small>{tx(STATE_LABELS[item.state] ?? item.state)}</small>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

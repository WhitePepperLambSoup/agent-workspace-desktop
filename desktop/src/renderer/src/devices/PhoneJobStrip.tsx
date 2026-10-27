import { Check, CircleAlert, CircleDot, Loader2, Smartphone, Square } from 'lucide-react'

import { useOptionalI18n } from '../i18n/I18nProvider'
import type { MessageKey } from '../i18n/messages'
import { FINISHED_PHONE_JOB_STATES, type PhoneJobView } from '../state/workbench-store'
import './devices.css'

const STATE_KEYS: Record<string, MessageKey> = {
  waiting: 'phoneJobs.waiting',
  accepted: 'phoneJobs.accepted',
  running: 'phoneJobs.running',
  succeeded: 'phoneJobs.succeeded',
  failed: 'phoneJobs.failed',
  rejected: 'phoneJobs.rejected',
  expired: 'phoneJobs.expired',
  cancelled: 'phoneJobs.cancelled',
}

function StateIcon({ state }: { state: string }) {
  if (state === 'succeeded') return <Check size={12} aria-hidden="true" />
  if (state === 'failed' || state === 'rejected' || state === 'expired') return <CircleAlert size={12} aria-hidden="true" />
  if (state === 'cancelled') return <Square size={11} aria-hidden="true" />
  if (state === 'running' || state === 'accepted') return <Loader2 size={12} className="is-spinning" aria-hidden="true" />
  return <CircleDot size={12} aria-hidden="true" />
}

/** What the selected conversation asked a paired phone to do, while any of it is open. */
export function PhoneJobStrip({ jobs }: { jobs: readonly PhoneJobView[] }) {
  const { t } = useOptionalI18n()
  if (!jobs.some((job) => !FINISHED_PHONE_JOB_STATES.has(job.state))) return null
  return (
    <section className="subagent-strip phone-job-strip" aria-label={t('phoneJobs.title')}>
      <header>
        <Smartphone size={13} aria-hidden="true" />
        <strong>{t('phoneJobs.title')}</strong>
      </header>
      <ul>
        {jobs.map((job) => (
          <li key={job.jobId} data-state={job.state}>
            <span className="phone-job-row" title={job.prompt}>
              <StateIcon state={job.state} />
              <span className="subagent-title">{job.prompt}</span>
              <small>{job.device ? `${job.device} · ` : ''}{t(STATE_KEYS[job.state] ?? 'phoneJobs.waiting')}</small>
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

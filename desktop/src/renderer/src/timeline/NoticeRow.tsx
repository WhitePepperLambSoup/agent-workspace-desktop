import { CircleAlert, GitBranch, GitCompare, ShieldAlert } from 'lucide-react'

import { useOptionalI18n } from '../i18n/I18nProvider'
import { FAILURE_KEYS, failureKind, type FailureKind } from './turn-failure'
import type { NoticeEntry } from './types'

export interface NoticeActions {
  /** Title of the conversation a fork came from, when it still exists. */
  sourceTitle?: string
  onOpenSource?: () => void
  onShowComparison?: () => void
  /** Settings, for a stop only they can lift (a key, a balance, a limit). */
  onOpenSettings?: () => void
  /** Send the request again, for the turn that just stopped. */
  onRetry?: () => void
  retryDisabled?: boolean
}

const SETTINGS_FAILURES = new Set<FailureKind>(['auth', 'billing', 'cost', 'tokens'])
const RETRY_FAILURES = new Set<FailureKind>(['rateLimit', 'network', 'provider', 'other', 'egress'])

export function NoticeRow({ entry, actions }: { entry: NoticeEntry; actions?: NoticeActions }) {
  const { t } = useOptionalI18n()
  if (entry.kind === 'failed') {
    const kind = failureKind(entry.errorType, entry.message)
    return (
      <div className="timeline-notice" data-kind="failed" data-reason={kind} role="note">
        <CircleAlert size={14} aria-hidden="true" />
        <div className="timeline-notice-body">
          <span>{t(FAILURE_KEYS[kind])}</span>
          <span className="timeline-notice-actions">
            {SETTINGS_FAILURES.has(kind) && actions?.onOpenSettings ? (
              <button type="button" onClick={actions.onOpenSettings}>{t('notice.openSettings')}</button>
            ) : null}
            {RETRY_FAILURES.has(kind) && actions?.onRetry ? (
              <button type="button" disabled={actions.retryDisabled} onClick={actions.onRetry}>{t('notice.retry')}</button>
            ) : null}
          </span>
          {entry.message ? (
            <details>
              <summary>{t('notice.details')}</summary>
              <code>{entry.message}</code>
            </details>
          ) : null}
        </div>
      </div>
    )
  }
  if (entry.kind === 'untrusted') {
    return (
      <div className="timeline-notice" data-kind="untrusted" role="note">
        <ShieldAlert size={14} aria-hidden="true" />
        <div className="timeline-notice-body">
          <span>{t('notice.untrusted')}</span>
          {entry.message ? (
            <details>
              <summary>{t('notice.details')}</summary>
              <code>{entry.tool ? `${entry.tool}: ` : ''}{entry.message}</code>
            </details>
          ) : null}
        </div>
      </div>
    )
  }
  const compare = Boolean(entry.compareModel)
  const label = compare
    ? t('notice.compared', { source: entry.sourceModel ?? t('compare.unknownModel'), model: entry.compareModel ?? '' })
    : actions?.sourceTitle
      ? t('notice.forkedFrom', { title: actions.sourceTitle })
      : t('notice.forked')
  return (
    <div className="timeline-notice" data-kind={compare ? 'compare' : 'forked'} role="note">
      {compare ? <GitCompare size={14} aria-hidden="true" /> : <GitBranch size={14} aria-hidden="true" />}
      <div className="timeline-notice-body">
        <span>{label}</span>
        <span className="timeline-notice-actions">
          {compare && actions?.onShowComparison ? (
            <button type="button" onClick={actions.onShowComparison}>{t('notice.showComparison')}</button>
          ) : null}
          {actions?.onOpenSource ? (
            <button type="button" onClick={actions.onOpenSource}>{t('notice.openSource')}</button>
          ) : null}
        </span>
      </div>
    </div>
  )
}

import { ShieldCheck } from 'lucide-react'
import { useRef, useState } from 'react'

import { stepVerb } from '../files/model'
import type { ApprovalItem } from './types'
import { useOptionalI18n } from '../i18n/I18nProvider'
import { zhCN, type MessageKey } from '../i18n/messages'

function toolLabelKey(toolName: string): MessageKey | null {
  const key = `approval.tool.${toolName}`
  return key in zhCN ? key as MessageKey : null
}

interface ApprovalShelfProps {
  approvals: readonly ApprovalItem[]
  resolve: (requestId: string, scope: 'once' | 'session' | null) => Promise<unknown>
}

export function ApprovalShelf({ approvals, resolve }: ApprovalShelfProps) {
  const { t } = useOptionalI18n()
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set())
  const [failedRequestId, setFailedRequestId] = useState<string | null>(null)
  const inFlight = useRef(new Set<string>())

  const decide = async (requestId: string, scope: 'once' | 'session' | null): Promise<void> => {
    if (inFlight.current.has(requestId)) return
    setFailedRequestId(null)
    inFlight.current.add(requestId)
    setPending((current) => new Set(current).add(requestId))
    try {
      await resolve(requestId, scope)
    } catch {
      setFailedRequestId(requestId)
      inFlight.current.delete(requestId)
      setPending((current) => {
        const next = new Set(current)
        next.delete(requestId)
        return next
      })
    }
  }

  if (approvals.length === 0) return null
  return (
    <section className="approval-shelf reading-surface" aria-label={t('approval.title')}>
      {approvals.map((approval) => {
        const disabled = pending.has(approval.requestId)
        const labelKey = toolLabelKey(approval.title)
        const label = labelKey ? t(labelKey) : approval.title
        return (
          <article key={approval.requestId} aria-label={label}>
            <ShieldCheck size={18} />
            <div>
              {approval.subagent ? <small className="approval-subagent">{t('approval.subagent', { title: approval.subagent })}</small> : null}
              <strong>{label}{labelKey ? <code className="approval-tool-id">{approval.title}</code> : null}</strong>
              <span title={approval.detail}>{approval.detail}</span>
              {approval.plan?.length ? (
                <details className="approval-plan">
                  <summary>{t('approval.planShow', { count: approval.planTotal ?? approval.plan.length })}</summary>
                  <ol>
                    {approval.plan.map((item, index) => (
                      <li key={`${item.path}:${index}`}>
                        <em>{t(`files.action.${stepVerb(item)}` as MessageKey)}</em>
                        <code>{item.path}</code>
                        {item.to ? <> → <code>{item.to}</code></> : null}
                      </li>
                    ))}
                  </ol>
                  {(approval.planTotal ?? 0) > approval.plan.length ? <small>{t('files.batch.more', { count: (approval.planTotal ?? 0) - approval.plan.length })}</small> : null}
                </details>
              ) : null}
            </div>
            <div className="approval-actions">
              <button type="button" disabled={disabled} onClick={() => void decide(approval.requestId, null)}>{t('approval.deny')}</button>
              <button type="button" className="approval-primary" disabled={disabled} onClick={() => void decide(approval.requestId, 'once')}>{t('approval.allowOnce')}</button>
              {approval.supportsSessionScope ? <button type="button" disabled={disabled} onClick={() => void decide(approval.requestId, 'session')}>{t('approval.allowSession')}</button> : null}
            </div>
            {failedRequestId === approval.requestId ? <p className="route-error" role="status">{t('approval.resolveFailed')}</p> : null}
          </article>
        )
      })}
    </section>
  )
}

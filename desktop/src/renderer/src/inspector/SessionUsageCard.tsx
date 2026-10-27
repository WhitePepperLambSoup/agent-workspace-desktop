import { useEffect, useState } from 'react'

import type { WorkbenchBridgeClient } from '../bridge/client'
import { useOptionalI18n } from '../i18n/I18nProvider'

export interface SessionUsage {
  modelCalls: number
  inputTokens: number
  outputTokens: number
  cachedTokens: number
  estimated: boolean
  costUsd: number
  priced: boolean
  models: string[]
}

function parseUsage(payload: unknown): SessionUsage | null {
  if (!payload || typeof payload !== 'object') return null
  const value = payload as Record<string, unknown>
  const numbers = ['modelCalls', 'inputTokens', 'outputTokens', 'cachedTokens', 'costUsd'] as const
  if (numbers.some((key) => typeof value[key] !== 'number' || !Number.isFinite(value[key] as number) || (value[key] as number) < 0)) return null
  return {
    modelCalls: value.modelCalls as number,
    inputTokens: value.inputTokens as number,
    outputTokens: value.outputTokens as number,
    cachedTokens: value.cachedTokens as number,
    costUsd: value.costUsd as number,
    estimated: value.estimated === true,
    priced: value.priced === true,
    models: Array.isArray(value.models) ? value.models.filter((model): model is string => typeof model === 'string') : [],
  }
}

/** Token totals and the estimated price for the selected session. */
export function SessionUsageCard({ sessionId, client, refreshKey }: {
  sessionId: string | null
  client?: Partial<Pick<WorkbenchBridgeClient, 'getSessionUsage'>>
  refreshKey: string
}) {
  const { locale, t } = useOptionalI18n()
  const [usage, setUsage] = useState<SessionUsage | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => { setUsage(null) }, [sessionId])

  useEffect(() => {
    if (!sessionId || !client?.getSessionUsage) return
    let active = true
    client.getSessionUsage(sessionId)
      .then((response) => {
        if (!active) return
        setUsage(parseUsage(response.payload))
        setFailed(false)
      })
      .catch(() => { if (active) setFailed(true) })
    return () => { active = false }
  }, [client, sessionId, refreshKey])

  if (!sessionId || !client?.getSessionUsage) return null
  const tokens = new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 })
  const cost = usage && usage.priced
    ? `${usage.estimated ? '≈ ' : ''}${new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD', minimumFractionDigits: usage.costUsd < 0.01 ? 4 : 2, maximumFractionDigits: 4 }).format(usage.costUsd)}`
    : t('inspector.usage.unpriced')

  return (
    <section className="inspector-section session-usage" aria-labelledby="session-usage-heading">
      <h3 id="session-usage-heading">{t('inspector.usage.title')}</h3>
      {failed && !usage ? <p className="route-note" role="status">{t('inspector.usage.failed')}</p> : null}
      {usage ? (
        <>
          <dl className="session-usage-facts">
            <div><dt>{t('inspector.usage.calls')}</dt><dd>{usage.modelCalls}</dd></div>
            <div><dt>{t('inspector.usage.input')}</dt><dd title={String(usage.inputTokens)}>{tokens.format(usage.inputTokens)}</dd></div>
            <div><dt>{t('inspector.usage.output')}</dt><dd title={String(usage.outputTokens)}>{tokens.format(usage.outputTokens)}</dd></div>
            <div><dt>{t('inspector.usage.cached')}</dt><dd title={String(usage.cachedTokens)}>{tokens.format(usage.cachedTokens)}</dd></div>
            <div className="session-usage-cost"><dt>{t('inspector.usage.cost')}</dt><dd>{cost}</dd></div>
          </dl>
          {usage.estimated || usage.priced ? <p className="session-usage-note">{t(usage.estimated ? 'inspector.usage.estimatedNote' : 'inspector.usage.listPriceNote')}</p> : null}
        </>
      ) : !failed ? <p className="route-note" role="status">{t('inspector.usage.loading')}</p> : null}
    </section>
  )
}

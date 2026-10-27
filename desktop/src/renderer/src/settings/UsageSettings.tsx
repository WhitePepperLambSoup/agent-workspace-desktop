import { Receipt } from 'lucide-react'
import { useCallback, useEffect, useId, useState, type FormEvent } from 'react'

import type { WorkbenchBridgeClient } from '../bridge/client'
import { useI18n, type I18nValue } from '../i18n/I18nProvider'

type UsageClient = Pick<WorkbenchBridgeClient, 'getUsageBill' | 'setMonthlyCap'>

interface ModelLine {
  model: string
  calls: number
  inputTokens: number
  outputTokens: number
  costUsd: number
  priced: boolean
}

export interface UsageBill {
  month: string
  costUsd: number
  calls: number
  inputTokens: number
  outputTokens: number
  cacheRatio: number
  models: ModelLine[]
  days: Array<{ day: string; costUsd: number }>
  unpricedCalls: number
  capUsd: number | null
  monthToDateUsd: number
}

const MAX_CAP_USD = 100_000

function number(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

export function usageBillFrom(payload: Record<string, unknown>): UsageBill | null {
  if (typeof payload.month !== 'string') return null
  const models = Array.isArray(payload.models) ? payload.models.flatMap((item: unknown) => {
    const line = item && typeof item === 'object' ? item as Record<string, unknown> : null
    return line && typeof line.model === 'string'
      ? [{ model: line.model, calls: number(line.calls), inputTokens: number(line.inputTokens), outputTokens: number(line.outputTokens), costUsd: number(line.costUsd), priced: line.priced === true }]
      : []
  }) : []
  const days = Array.isArray(payload.days) ? payload.days.flatMap((item: unknown) => {
    const day = item && typeof item === 'object' ? item as Record<string, unknown> : null
    return day && typeof day.day === 'string' ? [{ day: day.day, costUsd: number(day.costUsd) }] : []
  }) : []
  return {
    month: payload.month,
    costUsd: number(payload.costUsd),
    calls: number(payload.calls),
    inputTokens: number(payload.inputTokens),
    outputTokens: number(payload.outputTokens),
    cacheRatio: number(payload.cacheRatio),
    models,
    days,
    unpricedCalls: number(payload.unpricedCalls),
    capUsd: typeof payload.capUsd === 'number' ? payload.capUsd : null,
    monthToDateUsd: number(payload.monthToDateUsd),
  }
}

function previousMonth(month: string): string {
  const [year, value] = month.split('-').map(Number)
  const date = new Date(year, value - 2, 1)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function UsageSettingsView({ client, i18n }: { client?: UsageClient; i18n: I18nValue }) {
  const { t, locale } = i18n
  const [bill, setBill] = useState<UsageBill | null>(null)
  const [current, setCurrent] = useState<string | null>(null)
  const [month, setMonth] = useState<string | undefined>(undefined)
  const [cap, setCap] = useState('')
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'invalid' | 'failed' | 'unavailable'>('idle')
  const capId = useId()

  const money = useCallback((value: number): string => new Intl.NumberFormat(locale, {
    style: 'currency', currency: 'USD', minimumFractionDigits: value > 0 && value < 1 ? 4 : 2, maximumFractionDigits: value > 0 && value < 1 ? 4 : 2,
  }).format(value), [locale])
  const compact = useCallback((value: number): string => new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(value), [locale])

  useEffect(() => {
    if (typeof client?.getUsageBill !== 'function') return
    let active = true
    client.getUsageBill(month)
      .then((response) => {
        if (!active) return
        const document = response.type === 'usage.bill.result' ? usageBillFrom(response.payload) : null
        if (!document) { setStatus('unavailable'); return }
        setBill(document)
        if (month === undefined) {
          setCurrent(document.month)
          setCap(document.capUsd === null ? '' : String(document.capUsd))
        }
      })
      .catch(() => { if (active) setStatus('unavailable') })
    return () => { active = false }
  }, [client, month])

  const save = (event: FormEvent): void => {
    event.preventDefault()
    if (!client) return
    const trimmed = cap.trim().replace(/[,_\s$]/g, '')
    const value = trimmed ? Number(trimmed) : null
    if (value !== null && (!Number.isFinite(value) || value <= 0 || value > MAX_CAP_USD)) { setStatus('invalid'); return }
    setStatus('saving')
    client.setMonthlyCap(value)
      .then((response) => {
        if (response.type !== 'usage.cap.set.result') { setStatus('failed'); return }
        const saved = typeof response.payload.capUsd === 'number' ? response.payload.capUsd : null
        setCap(saved === null ? '' : String(saved))
        setBill((existing) => existing ? { ...existing, capUsd: saved } : existing)
        setStatus('saved')
      })
      .catch(() => setStatus('failed'))
  }

  const shownCurrent = bill !== null && bill.month === current
  const peak = Math.max(0, ...(bill?.days.map((day) => day.costUsd) ?? []))
  const statusText = status === 'saved' ? t('usage.capSaved')
    : status === 'invalid' ? t('usage.capInvalid')
    : status === 'failed' ? t('usage.capFailed')
    : status === 'unavailable' ? t('usage.loadFailed')
    : null

  return (
    <section className="settings-section usage-settings" aria-labelledby="usage-heading">
      <header className="doctor-header">
        <div>
          <h2 id="usage-heading">{t('usage.title')}</h2>
          <p>{t('usage.estimateNote')}</p>
        </div>
        <Receipt size={16} aria-hidden="true" />
      </header>
      {current ? (
        <div className="usage-months" role="group" aria-label={t('usage.month')}>
          <button type="button" aria-pressed={bill?.month === current} onClick={() => setMonth(current)}>{t('usage.thisMonth')}</button>
          <button type="button" aria-pressed={bill?.month === previousMonth(current)} onClick={() => setMonth(previousMonth(current))}>{t('usage.lastMonth')}</button>
        </div>
      ) : null}
      {bill ? (
        <>
          <dl className="usage-facts">
            <div><dt>{t('usage.total')}</dt><dd>{money(bill.costUsd)}</dd></div>
            <div><dt>{t('usage.calls')}</dt><dd>{bill.calls}</dd></div>
            <div><dt>{t('usage.cacheRatio')}</dt><dd>{Math.round(bill.cacheRatio * 100)}%</dd></div>
            <div><dt>{t('usage.tokens')}</dt><dd>{compact(bill.inputTokens)} / {compact(bill.outputTokens)}</dd></div>
          </dl>
          {bill.calls === 0 ? <p className="provider-hint">{t('usage.empty')}</p> : null}
          {bill.days.length > 0 ? (
            <div className="usage-days" role="img" aria-label={t('usage.daysLabel', { days: bill.days.length })}>
              {bill.days.map((day) => (
                <span key={day.day} title={`${day.day} · ${money(day.costUsd)}`} style={{ height: `${peak > 0 ? Math.max(6, Math.round(day.costUsd / peak * 100)) : 6}%` }} />
              ))}
            </div>
          ) : null}
          {bill.models.length > 0 ? (
            <table className="usage-models">
              <caption>{t('usage.byModel')}</caption>
              <thead><tr><th scope="col">{t('usage.model')}</th><th scope="col">{t('usage.calls')}</th><th scope="col">{t('usage.total')}</th></tr></thead>
              <tbody>
                {bill.models.map((line) => (
                  <tr key={line.model}><th scope="row">{line.model}</th><td>{line.calls}</td><td>{line.priced ? money(line.costUsd) : t('usage.notPriced')}</td></tr>
                ))}
              </tbody>
            </table>
          ) : null}
          {bill.unpricedCalls > 0 ? <p className="provider-hint">{t('usage.unpriced', { count: bill.unpricedCalls })}</p> : null}
        </>
      ) : null}
      <form className="voice-settings-fields" onSubmit={save} noValidate>
        <label className="provider-field" htmlFor={capId}>
          <span>{t('usage.cap')}</span>
          <input id={capId} inputMode="decimal" value={cap} placeholder={t('usage.capNone')}
            disabled={!bill || status === 'saving'} onChange={(event) => { setCap(event.target.value); setStatus('idle') }} />
        </label>
        <div className="provider-actions">
          <button type="submit" className="provider-primary" disabled={!bill || status === 'saving'}>{t('usage.saveCap')}</button>
        </div>
      </form>
      {statusText ? (
        <p className={`provider-status ${status === 'saved' ? 'provider-status-success' : 'provider-status-error'}`} role="status">{statusText}</p>
      ) : null}
      <p className="provider-hint">
        {bill?.capUsd && shownCurrent
          ? t('usage.capUsed', { percent: Math.min(999, Math.round(bill.monthToDateUsd / bill.capUsd * 100)) })
          : t('usage.capHint')}
      </p>
    </section>
  )
}

function LocalizedUsageSettings({ client }: { client?: UsageClient }) {
  return <UsageSettingsView client={client} i18n={useI18n()} />
}

export function UsageSettings({ client, i18n }: { client?: UsageClient; i18n?: I18nValue }) {
  return i18n ? <UsageSettingsView client={client} i18n={i18n} /> : <LocalizedUsageSettings client={client} />
}

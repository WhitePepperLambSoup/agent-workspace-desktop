import { Gauge } from 'lucide-react'
import { useEffect, useId, useState, type FormEvent } from 'react'

import type { WorkbenchBridgeClient } from '../bridge/client'
import { useI18n, type I18nValue } from '../i18n/I18nProvider'

type LimitsClient = Pick<WorkbenchBridgeClient, 'taskLimits' | 'setTaskLimits'>

interface LimitsDocument {
  maxCostUsd: number | null
  maxTokens: number | null
  maxCostLimitUsd: number
  maxTokenLimit: number
  defaultCostUsd: number
}

function limitsFrom(payload: Record<string, unknown>): LimitsDocument | null {
  const number = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null
  const maxCostLimitUsd = number(payload.maxCostLimitUsd)
  const maxTokenLimit = number(payload.maxTokenLimit)
  const defaultCostUsd = number(payload.defaultCostUsd)
  if (maxCostLimitUsd === null || maxTokenLimit === null || defaultCostUsd === null) return null
  return { maxCostUsd: number(payload.maxCostUsd), maxTokens: number(payload.maxTokens), maxCostLimitUsd, maxTokenLimit, defaultCostUsd }
}

/** A blank field is no limit; anything else must be a positive number within the bound. */
function parsed(text: string, max: number, integer: boolean): number | null | undefined {
  const trimmed = text.trim().replace(/[,_\s]/g, '')
  if (!trimmed) return null
  const value = Number(trimmed)
  if (!Number.isFinite(value) || value <= 0 || value > max || (integer && !Number.isInteger(value))) return undefined
  return value
}

function TaskLimitSettingsView({ client, i18n }: { client?: LimitsClient; i18n: I18nValue }) {
  const { t, locale } = i18n
  const [limits, setLimits] = useState<LimitsDocument | null>(null)
  const [cost, setCost] = useState('')
  const [tokens, setTokens] = useState('')
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'invalid' | 'failed' | 'unavailable'>('idle')
  const costId = useId()
  const tokensId = useId()

  useEffect(() => {
    if (!client) return
    let active = true
    client.taskLimits()
      .then((response) => {
        if (!active) return
        const document = response.type === 'limits.get.result' ? limitsFrom(response.payload) : null
        if (!document) { setStatus('unavailable'); return }
        setLimits(document)
        setCost(document.maxCostUsd === null ? '' : String(document.maxCostUsd))
        setTokens(document.maxTokens === null ? '' : String(document.maxTokens))
      })
      .catch(() => { if (active) setStatus('unavailable') })
    return () => { active = false }
  }, [client])

  const save = (event: FormEvent): void => {
    event.preventDefault()
    if (!client || !limits) return
    const maxCostUsd = parsed(cost, limits.maxCostLimitUsd, false)
    const maxTokens = parsed(tokens, limits.maxTokenLimit, true)
    if (maxCostUsd === undefined || maxTokens === undefined) { setStatus('invalid'); return }
    setStatus('saving')
    client.setTaskLimits({ maxCostUsd, maxTokens })
      .then((response) => {
        const document = response.type === 'limits.set.result' ? limitsFrom(response.payload) : null
        if (!document) { setStatus('failed'); return }
        setLimits(document)
        setCost(document.maxCostUsd === null ? '' : String(document.maxCostUsd))
        setTokens(document.maxTokens === null ? '' : String(document.maxTokens))
        setStatus('saved')
      })
      .catch(() => setStatus('failed'))
  }

  const statusText = status === 'saved' ? t('settings.limits.saved')
    : status === 'invalid' ? t('settings.limits.invalid')
    : status === 'failed' ? t('settings.limits.failed')
    : status === 'unavailable' ? t('settings.limits.unavailable')
    : null

  return (
    <section className="settings-section task-limit-settings" aria-labelledby="task-limit-heading">
      <header className="doctor-header">
        <div>
          <h2 id="task-limit-heading">{t('settings.limits.title')}</h2>
          <p>{t('settings.limits.description')}</p>
        </div>
        <Gauge size={16} aria-hidden="true" />
      </header>
      <form className="voice-settings-fields" onSubmit={save} noValidate>
        <label className="provider-field" htmlFor={costId}>
          <span>{t('settings.limits.cost')}</span>
          <input id={costId} inputMode="decimal" value={cost} placeholder={t('settings.limits.none')}
            disabled={!limits || status === 'saving'} onChange={(event) => { setCost(event.target.value); setStatus('idle') }} />
        </label>
        <label className="provider-field" htmlFor={tokensId}>
          <span>{t('settings.limits.tokens')}</span>
          <input id={tokensId} inputMode="numeric" value={tokens} placeholder={t('settings.limits.none')}
            disabled={!limits || status === 'saving'} onChange={(event) => { setTokens(event.target.value); setStatus('idle') }} />
        </label>
        <div className="provider-actions">
          <button type="submit" className="provider-primary" disabled={!limits || status === 'saving'}>{t('settings.limits.save')}</button>
        </div>
      </form>
      {statusText ? (
        <p className={`provider-status ${status === 'saved' ? 'provider-status-success' : 'provider-status-error'}`} role="status">{statusText}</p>
      ) : null}
      {limits ? (
        <p className="provider-hint">
          {t('settings.limits.hint', {
            amount: new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
              .format(limits.defaultCostUsd),
          })}
        </p>
      ) : null}
    </section>
  )
}

function LocalizedTaskLimitSettings({ client }: { client?: LimitsClient }) {
  return <TaskLimitSettingsView client={client} i18n={useI18n()} />
}

export function TaskLimitSettings({ client, i18n }: { client?: LimitsClient; i18n?: I18nValue }) {
  return i18n ? <TaskLimitSettingsView client={client} i18n={i18n} /> : <LocalizedTaskLimitSettings client={client} />
}

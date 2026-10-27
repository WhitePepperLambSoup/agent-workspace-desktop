import { Activity, AlertTriangle, CheckCircle, LoaderCircle, Wrench, XCircle } from 'lucide-react'
import { useState } from 'react'

import type { WorkbenchBridgeClient } from '../bridge/client'
import { useI18n, type I18nValue } from '../i18n/I18nProvider'

export interface DoctorCheckItem {
  id?: string
  name: string
  status: 'ok' | 'warn' | 'warning' | 'error'
  detail: string
  message?: string
  remediation?: string
  category?: string
  diagnosticLayer?: string
  diagnosticCode?: string
  diagnostic_layer?: string
  diagnostic_code?: string
  capability?: string
  riskBoundary?: string[]
  risk_boundary?: string[]
}

export interface DoctorReport {
  overallStatus: 'ok' | 'warn' | 'warning' | 'error'
  checks: Record<string, DoctorCheckItem> | DoctorCheckItem[]
}

export interface SystemDoctorSettingsProps {
  client?: Pick<WorkbenchBridgeClient, 'runDoctor'>
  i18n?: I18nValue
}

function SystemDoctorSettingsView({ client, i18n }: { client?: Pick<WorkbenchBridgeClient, 'runDoctor'>; i18n: I18nValue }) {
  const { t } = i18n
  const [report, setReport] = useState<DoctorReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleRunDoctor = async (): Promise<void> => {
    if (!client?.runDoctor || loading) return
    setLoading(true)
    setError(null)
    setReport(null)
    try {
      const res = await client.runDoctor()
      const data = res.payload as unknown as { report?: DoctorReport } & DoctorReport
      const raw = data?.report ?? data
      if (!raw || !['ok', 'warn', 'warning', 'error'].includes(raw.overallStatus) ||
          !raw.checks || typeof raw.checks !== 'object') {
        throw new Error(t('settings.doctor.failed'))
      }
      const checks = Array.isArray(raw.checks)
        ? Object.fromEntries(raw.checks.map((check) => [check.id ?? check.name, check]))
        : raw.checks
      if (Object.values(checks).some((check) => !check || typeof check.name !== 'string' ||
          !['ok', 'warn', 'warning', 'error'].includes(check.status))) {
        throw new Error(t('settings.doctor.failed'))
      }
      setReport({ ...raw, checks })
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }

  const checksList = report ? Object.entries(report.checks) : []

  return (
    <section className="settings-section system-doctor-settings" aria-labelledby="doctor-heading">
      <header className="doctor-header">
        <div>
          <h2 id="doctor-heading">{t('settings.doctor.title')}</h2>
          <p>{t('settings.doctor.desc')}</p>
        </div>
        <Activity size={16} aria-hidden="true" />
      </header>

      <div className="doctor-actions">
        <button
          type="button"
          className="provider-primary doctor-run-btn"
          disabled={!client || loading}
          aria-busy={loading}
          onClick={() => void handleRunDoctor()}
        >
          {loading ? (
            <>
              <LoaderCircle className="provider-spinner" size={14} aria-hidden="true" />
              <span>{t('settings.doctor.running')}</span>
            </>
          ) : (
            <>
              <Wrench size={14} aria-hidden="true" />
              <span>{t('settings.doctor.run')}</span>
            </>
          )}
        </button>
      </div>

      {error ? (
        <p className="route-error" role="alert">
          {error}
        </p>
      ) : null}

      {report ? (
        <div className="doctor-report" data-testid="doctor-report">
          <div className="doctor-overall">
            {report.overallStatus === 'ok' ? (
              <span className="doctor-badge doctor-badge-ok">
                <CheckCircle size={14} />
                <span>{t('settings.doctor.healthy')}</span>
              </span>
            ) : report.overallStatus === 'warn' || report.overallStatus === 'warning' ? (
              <span className="doctor-badge doctor-badge-warning">
                <AlertTriangle size={14} />
                <span>{t('settings.doctor.hasWarnings')}</span>
              </span>
            ) : (
              <span className="doctor-badge doctor-badge-error">
                <XCircle size={14} />
                <span>{t('settings.doctor.failed')}</span>
              </span>
            )}
          </div>

          <div className="doctor-checks-list" role="list">
            {checksList.map(([key, check]) => {
              const status = check.status === 'warn' ? 'warning' : check.status
              const diagnosticLayer = check.diagnosticLayer ?? check.diagnostic_layer
              const diagnosticCode = check.diagnosticCode ?? check.diagnostic_code
              return (
              <div key={key} role="listitem" className={`doctor-check-card check-${status}`}>
                <div className="doctor-check-top">
                  <span className="check-icon">
                    {status === 'ok' ? (
                      <CheckCircle size={14} className="icon-ok" />
                    ) : status === 'warning' ? (
                      <AlertTriangle size={14} className="icon-warning" />
                    ) : (
                      <XCircle size={14} className="icon-error" />
                    )}
                  </span>
                  <strong className="check-name">{check.name}</strong>
                  <span className={`check-status-tag tag-${status}`}>{t(`settings.doctor.status.${status}`)}</span>
                </div>
                <p className="check-detail">{check.message || check.detail}</p>
                {check.message && check.detail ? <small className="check-detail">{check.detail}</small> : null}
                {check.remediation ? (
                  <div className="doctor-remediation">
                    <strong>{t('settings.doctor.remediation')}:</strong>
                    <span>{check.remediation}</span>
                  </div>
                ) : null}
                {check.capability ? (
                  <div className="doctor-capability" data-testid={`doctor-capability-${key}`}>
                    <span>{t('settings.doctor.capability')}</span>
                    <code>{check.capability}</code>
                  </div>
                ) : null}
                {(check.riskBoundary ?? check.risk_boundary)?.length ? (
                  <div className="doctor-risk" data-testid={`doctor-risk-${key}`}>
                    <span>{t('settings.doctor.riskBoundary')}</span>
                    <code>{(check.riskBoundary ?? check.risk_boundary)?.join(', ')}</code>
                  </div>
                ) : null}
                {diagnosticLayer || diagnosticCode ? (
                  <div className="doctor-diagnostic" data-testid={`doctor-diagnostic-${key}`}>
                    <span>{t('settings.doctor.diagnostic')}</span>
                    {diagnosticLayer ? <code>{diagnosticLayer}</code> : null}
                    {diagnosticCode ? <code>{diagnosticCode}</code> : null}
                  </div>
                ) : null}
              </div>
              )
            })}
          </div>
        </div>
      ) : null}
    </section>
  )
}

function LocalizedSystemDoctorSettings(props: SystemDoctorSettingsProps) {
  return <SystemDoctorSettingsView {...props} i18n={useI18n()} />
}

export function SystemDoctorSettings(props: SystemDoctorSettingsProps) {
  return props.i18n
    ? <SystemDoctorSettingsView {...props} i18n={props.i18n} />
    : <LocalizedSystemDoctorSettings {...props} />
}

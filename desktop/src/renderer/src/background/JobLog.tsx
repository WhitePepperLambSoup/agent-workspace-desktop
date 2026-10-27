import type { JsonValue } from '../../../shared/protocol'
import { useOptionalI18n } from '../i18n/I18nProvider'
import { localizeKnownStatus } from '../i18n/messages'

function processOutput(data: string): { stdout: string; stderr: string; exitCode: number | null } | null {
  try {
    const value: unknown = JSON.parse(data)
    if (!value || typeof value !== 'object') return null
    const item = value as Record<string, unknown>
    const stream = (raw: unknown): string | null => raw && typeof raw === 'object' && typeof (raw as {text?: unknown}).text === 'string'
      ? (raw as {text: string}).text : null
    const stdout = stream(item.stdout), stderr = stream(item.stderr)
    if (stdout === null && stderr === null) return null
    return {stdout: stdout ?? '', stderr: stderr ?? '', exitCode: typeof item.exit_code === 'number' ? item.exit_code : null}
  } catch { return null }
}

export function JobLog({ value }: { value: Record<string, JsonValue> | null }) {
  const { locale, t } = useOptionalI18n()
  if (!value) return <p className="route-note">{t('jobs.selectPrompt')}</p>
  const data = String(value.data ?? '')
  const output = processOutput(data)
  const terminalOutput = typeof value.output === 'string' ? value.output : null
  const terminalExitCode = typeof value.exitCode === 'number' ? value.exitCode : null
  const terminalReason = typeof value.reason === 'string' ? value.reason : null
  const terminalEvent = typeof value.type === 'string' && value.type.startsWith('terminal.')
  return <section className="job-log reading-surface" aria-label={t('jobs.log')}>
    <header><strong>{String(value.sessionId ?? value.jobId ?? t('jobs.job'))}</strong><span>{value.state == null ? t('common.unknown') : localizeKnownStatus(locale, String(value.state))}</span></header>
    {terminalEvent && terminalOutput !== null ? <>
      {terminalExitCode !== null ? <p>{t('jobs.exitCode', {code: terminalExitCode})}</p> : null}
      {terminalReason ? <p>{terminalReason}</p> : null}
      <pre>{terminalOutput}</pre>
    </> : output ? <>
      {output.exitCode !== null ? <p>{t('jobs.exitCode', {code: output.exitCode})}</p> : null}
      <h3>stdout</h3><pre>{output.stdout}</pre>
      {output.stderr ? <><h3>stderr</h3><pre>{output.stderr}</pre></> : null}
    </> : <pre>{data}</pre>}
    <footer>{t('jobs.bytes', {count: String(value.bytes ?? (terminalOutput?.length ?? 0))})}{value.truncated === true ? <span role="status">{t('jobs.logTruncated')}</span> : null}</footer>
  </section>
}

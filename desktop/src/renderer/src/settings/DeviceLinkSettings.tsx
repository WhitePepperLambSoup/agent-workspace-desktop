import { Check, Copy, ExternalLink, Smartphone } from 'lucide-react'
import qrcode from 'qrcode-generator'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'

import type { WorkbenchBridgeClient } from '../bridge/client'
import { useI18n, type I18nValue } from '../i18n/I18nProvider'
import type { MessageKey } from '../i18n/messages'
import './device-link.css'

type DeviceClient = Pick<WorkbenchBridgeClient,
  'deviceLinkStatus' | 'configureDeviceLink' | 'startDevicePairing' | 'createDeviceToken' | 'revokeDevice'>
  & Partial<Pick<WorkbenchBridgeClient, 'updateDevice' | 'resetDeviceLink' | 'allowDeviceLinkThroughFirewall'>>

interface LinkAddress { address: string; kind: string; url: string }
interface DeviceActivity { at: string; action: string; detail: string }
interface PairedDevice {
  deviceId: string
  name: string
  scopes: string[]
  lastSeenAt: string | null
  lastAddress: string | null
  acceptsJobs: boolean
  notifyTurns: boolean
  activity: DeviceActivity[]
}
interface PhoneMessage { id: string; kind: string; text: string; createdAt: string; device: string }
interface LinkStatus {
  enabled: boolean
  running: boolean
  error: string | null
  port: number
  secure: boolean
  wake: boolean
  clipboard: boolean
  announced: boolean
  // Windows Firewall: open, blocked, checking, fixing, declined, unknown; null when it does not apply.
  firewall: string | null
  fingerprint: string | null
  fingerprintShort: string | null
  addresses: LinkAddress[]
  devices: PairedDevice[]
  messages: PhoneMessage[]
  pairing: { code: string; expiresAt: string; uri: string; url: string } | null
}
interface CreatedDevice { name: string; token: string; url: string | null }

const ERROR_KEYS: Record<string, MessageKey> = {
  port_unavailable: 'settings.devices.portUnavailable',
  certificate_unavailable: 'settings.devices.certificateUnavailable',
}
// What a phone may do besides reading this computer's conversations, in the order shown.
const OPTIONAL_SCOPES: ReadonlyArray<{ scope: string; allow: MessageKey; short: MessageKey }> = [
  { scope: 'tasks', allow: 'settings.devices.allowTasks', short: 'settings.devices.scopeTasks' },
  { scope: 'approvals', allow: 'settings.devices.allowApprovals', short: 'settings.devices.scopeApprovals' },
  { scope: 'files', allow: 'settings.devices.allowFiles', short: 'settings.devices.scopeFiles' },
  { scope: 'knowledge', allow: 'settings.devices.allowKnowledge', short: 'settings.devices.scopeKnowledge' },
  { scope: 'broad_autonomy', allow: 'settings.devices.allowBroad', short: 'settings.devices.scopeBroad' },
]
const ACTIVITY_KEYS: Record<string, MessageKey> = {
  paired: 'settings.devices.action.paired',
  task_sent: 'settings.devices.action.task_sent',
  task_finished: 'settings.devices.action.task_finished',
  approval_decided: 'settings.devices.action.approval_decided',
  turn_stopped: 'settings.devices.action.turn_stopped',
  file_received: 'settings.devices.action.file_received',
  file_sent: 'settings.devices.action.file_sent',
  text_received: 'settings.devices.action.text_received',
  text_sent: 'settings.devices.action.text_sent',
  conversation_received: 'settings.devices.action.conversation_received',
  conversation_sent: 'settings.devices.action.conversation_sent',
  job_sent: 'settings.devices.action.job_sent',
  job_finished: 'settings.devices.action.job_finished',
  knowledge_synced: 'settings.devices.action.knowledge_synced',
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function statusFrom(payload: Record<string, unknown>): LinkStatus | null {
  if (typeof payload.enabled !== 'boolean' || typeof payload.port !== 'number') return null
  const text = (value: unknown): string | null => typeof value === 'string' ? value : null
  const addresses = Array.isArray(payload.addresses) ? payload.addresses.flatMap((item) => {
    const entry = record(item)
    return entry && typeof entry.url === 'string' && typeof entry.address === 'string'
      ? [{ address: entry.address, kind: text(entry.kind) ?? 'lan', url: entry.url }] : []
  }) : []
  const devices = Array.isArray(payload.devices) ? payload.devices.flatMap((item) => {
    const entry = record(item)
    if (!entry || typeof entry.deviceId !== 'string' || typeof entry.name !== 'string') return []
    const activity = Array.isArray(entry.activity) ? entry.activity.flatMap((value) => {
      const step = record(value)
      return step && typeof step.at === 'string' && typeof step.action === 'string'
        ? [{ at: step.at, action: step.action, detail: text(step.detail) ?? '' }] : []
    }) : []
    return [{
      deviceId: entry.deviceId, name: entry.name, scopes: strings(entry.scopes),
      lastSeenAt: text(entry.lastSeenAt), lastAddress: text(entry.lastAddress),
      acceptsJobs: entry.acceptsJobs === true, notifyTurns: entry.notifyTurns !== false, activity,
    }]
  }) : []
  const messages = Array.isArray(payload.messages) ? payload.messages.flatMap((item) => {
    const entry = record(item)
    return entry && typeof entry.id === 'string' && typeof entry.text === 'string'
      ? [{ id: entry.id, kind: text(entry.kind) ?? 'text', text: entry.text, createdAt: text(entry.createdAt) ?? '', device: text(entry.device) ?? '' }]
      : []
  }) : []
  const pairing = record(payload.pairing)
  return {
    enabled: payload.enabled,
    running: payload.running === true,
    error: text(payload.error),
    port: payload.port,
    secure: payload.secure === true,
    wake: payload.wake === true,
    clipboard: payload.clipboard !== false,
    announced: payload.announced === true,
    firewall: text(payload.firewall),
    fingerprint: text(payload.fingerprint),
    fingerprintShort: text(payload.fingerprintShort),
    addresses,
    devices,
    messages,
    pairing: pairing && typeof pairing.code === 'string' && typeof pairing.uri === 'string'
      ? { code: pairing.code, uri: pairing.uri, url: text(pairing.url) ?? '', expiresAt: text(pairing.expiresAt) ?? '' }
      : null,
  }
}

/** A QR code drawn as one SVG path; light background in either theme so cameras read it. */
export function QrCode({ value, label }: { value: string; label: string }) {
  const { size, path } = useMemo(() => {
    const code = qrcode(0, 'M')
    code.addData(value)
    code.make()
    const count = code.getModuleCount()
    let d = ''
    for (let row = 0; row < count; row += 1) {
      for (let column = 0; column < count; column += 1) {
        if (code.isDark(row, column)) d += `M${column + 4} ${row + 4}h1v1h-1z`
      }
    }
    return { size: count + 8, path: d }
  }, [value])
  return (
    <svg className="device-qr" viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label} shapeRendering="crispEdges">
      <rect width={size} height={size} fill="#ffffff" />
      <path d={path} fill="#000000" />
    </svg>
  )
}

function CopyButton({ text, label, t }: { text: string; label: string; t: I18nValue['t'] }) {
  const [copied, setCopied] = useState(false)
  return (
    <button type="button" className="message-action" aria-label={label} title={label}
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 1600)
        }, () => undefined)
      }}>
      {copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
      <span className="visually-hidden">{copied ? t('timeline.copied') : null}</span>
    </button>
  )
}

function scopeSummary(scopes: readonly string[], t: I18nValue['t']): string {
  const parts = [t(scopes.includes('tasks') ? 'settings.devices.scopeTasks' : 'settings.devices.scopeRead')]
  for (const option of OPTIONAL_SCOPES) {
    if (option.scope !== 'tasks' && scopes.includes(option.scope)) parts.push(t(option.short))
  }
  return parts.join(' · ')
}

function DeviceLinkSettingsView({ client, i18n }: { client: DeviceClient; i18n: I18nValue }) {
  const { t, locale } = i18n
  const [status, setStatus] = useState<LinkStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<MessageKey | null>(null)
  const [allowed, setAllowed] = useState<ReadonlySet<string>>(() => new Set(['tasks', 'files', 'knowledge']))
  const [phoneName, setPhoneName] = useState('')
  const [created, setCreated] = useState<CreatedDevice | null>(null)
  const [portText, setPortText] = useState('')
  const [confirmReset, setConfirmReset] = useState(false)
  const mounted = useRef(true)
  // Counts the changes made on this page, so a status read started before one cannot undo it.
  const changes = useRef(0)
  const portId = useId()
  const nameId = useId()
  const modeId = useId()
  useEffect(() => () => { mounted.current = false }, [])

  const apply = useCallback(async (run: () => Promise<{ type: string; payload: Record<string, unknown> }>, failed: MessageKey = 'settings.devices.failed') => {
    changes.current += 1
    setBusy(true)
    setFailure(null)
    try {
      const response = await run()
      const next = response.type.endsWith('.result') ? statusFrom(response.payload) : null
      if (!mounted.current) return response
      if (!next) setFailure(failed)
      else {
        setStatus(next)
        setPortText(String(next.port))
      }
      return response
    } catch {
      if (mounted.current) setFailure(failed)
      return null
    } finally {
      if (mounted.current) setBusy(false)
    }
  }, [])

  useEffect(() => { void apply(() => client.deviceLinkStatus(), 'settings.devices.unavailable') }, [apply, client])

  // While a pairing code is shown, watch for the phone that uses it; while the firewall is being
  // checked or set up, watch for the outcome; otherwise, while phones may connect, keep the list
  // current (a phone may remove this computer on its side, or connect from another address).
  const pairingActive = Boolean(status?.pairing)
  const firewallPending = status?.firewall === 'checking' || status?.firewall === 'fixing'
  const every = firewallPending ? 1500 : pairingActive ? 3000 : status?.enabled ? 10_000 : 0
  useEffect(() => {
    if (!every) return
    const timer = setInterval(() => {
      const before = changes.current
      void client.deviceLinkStatus().then((response) => {
        const next = statusFrom(response.payload)
        if (next && mounted.current && changes.current === before) setStatus(next)
      }, () => undefined)
    }, every)
    return () => clearInterval(timer)
  }, [client, every])

  const scopes = ['read', ...OPTIONAL_SCOPES.map((option) => option.scope).filter((scope) => allowed.has(scope))]
  const dateFormat = useMemo(() => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }), [locale])
  const fingerprint = status?.fingerprint?.match(/.{1,4}/g)?.join(' ').toUpperCase() ?? null
  const toggleAllowed = (scope: string, on: boolean): void => {
    setAllowed((current) => {
      const next = new Set(current)
      if (on) next.add(scope)
      else next.delete(scope)
      return next
    })
  }
  const updateDevice = client.updateDevice
  const resetDeviceLink = client.resetDeviceLink
  const allowFirewall = client.allowDeviceLinkThroughFirewall
  const openExternal = typeof window !== 'undefined' ? window.agentWorkspace?.openExternal : undefined
  const showQr = (): void => { setCreated(null); void apply(() => client.startDevicePairing(scopes)) }
  const firewallStuck = status?.firewall === 'blocked' || status?.firewall === 'declined' || status?.firewall === 'fixing'

  return (
    <section className="settings-section device-link-settings" aria-labelledby="device-link-heading">
      <header className="doctor-header">
        <div>
          <h2 id="device-link-heading">{t('settings.devices.title')}</h2>
          <p>{t('settings.devices.description')}</p>
        </div>
        <Smartphone size={16} aria-hidden="true" />
      </header>
      <label className="settings-toggle">
        <input type="checkbox" checked={status?.enabled ?? false} disabled={!status || busy}
          onChange={(event) => {
            const enabled = event.target.checked
            void apply(() => client.configureDeviceLink({ enabled })).then((response) => {
              // Turned on with no phone yet: the QR code to scan comes up straight away.
              const next = response ? statusFrom(response.payload) : null
              if (enabled && next?.running && next.devices.length === 0 && mounted.current) {
                void apply(() => client.startDevicePairing(scopes))
              }
            })
          }} />
        <span>{t('settings.devices.enable')}</span>
      </label>
      {status?.enabled ? (
        <div className="device-link-body">
          {!status.running ? (
            <p className="provider-status provider-status-error" role="status">
              {t(ERROR_KEYS[status.error ?? ''] ?? 'settings.devices.stopped')}
            </p>
          ) : null}
          {status.running && firewallStuck && allowFirewall ? (
            <div className="device-link-warning device-link-firewall" role="status">
              <p>{t(status.firewall === 'fixing' ? 'settings.devices.firewallFixing'
                : status.firewall === 'declined' ? 'settings.devices.firewallDeclined' : 'settings.devices.firewall')}</p>
              {status.firewall !== 'fixing' ? (
                <div className="provider-actions">
                  <button type="button" className="provider-primary" disabled={busy}
                    onClick={() => { void apply(() => allowFirewall.call(client)) }}>
                    {t('settings.devices.firewallAllow')}
                  </button>
                  <span className="provider-hint">{t('settings.devices.firewallAllowHint')}</span>
                </div>
              ) : null}
            </div>
          ) : null}

          {status.running ? (
            <>
              <h3 className="device-link-subtitle">{t('settings.devices.addPhone')}</h3>
              {status.pairing ? (
                <div className="device-pairing">
                  <QrCode value={status.pairing.uri} label={t('settings.devices.qrLabel')} />
                  <div>
                    <p>{t('settings.devices.qrSteps')}</p>
                    <p className="device-pairing-code">{status.pairing.code}</p>
                    {status.fingerprintShort ? (
                      <p className="device-pairing-fingerprint">{t('settings.devices.fingerprintCheck', { code: status.fingerprintShort })}</p>
                    ) : null}
                    <p className="provider-hint">{t('settings.devices.qrExpires', { time: dateFormat.format(new Date(status.pairing.expiresAt)) })}</p>
                  </div>
                </div>
              ) : (
                <div className="provider-actions">
                  <button type="button" className="provider-primary" disabled={busy} onClick={showQr}>
                    {t('settings.devices.showQr')}
                  </button>
                </div>
              )}
              <details className="device-link-details">
                <summary>{t('settings.devices.permissionsOptional')}</summary>
                {OPTIONAL_SCOPES.map((option) => (
                  <label className="settings-toggle" key={option.scope}>
                    <input type="checkbox" checked={allowed.has(option.scope)} onChange={(event) => toggleAllowed(option.scope, event.target.checked)} />
                    <span>{t(option.allow)}</span>
                  </label>
                ))}
                {allowed.has('broad_autonomy') ? <p className="device-link-warning" role="note">{t('settings.devices.broadWarning')}</p> : null}
              </details>
            </>
          ) : null}

          <h3 className="device-link-subtitle">{t('settings.devices.paired')}</h3>
          {status.devices.length ? (
            <ul className="device-link-devices">
              {status.devices.map((device) => (
                <li key={device.deviceId}>
                  <div className="device-link-device-head">
                    <div>
                      <strong>{device.name}</strong>
                      <span className="provider-hint">
                        {scopeSummary(device.scopes, t)}
                        {device.acceptsJobs ? ` · ${t('settings.devices.acceptsJobs')}` : ''}
                        {' · '}
                        {device.lastSeenAt
                          ? t('settings.devices.lastSeen', { time: dateFormat.format(new Date(device.lastSeenAt)), address: device.lastAddress ?? '' })
                          : t('settings.devices.neverSeen')}
                      </span>
                    </div>
                    <button type="button" className="provider-danger" disabled={busy}
                      onClick={() => { void apply(() => client.revokeDevice(device.deviceId)) }}>
                      {t('settings.devices.remove')}
                    </button>
                  </div>
                  {updateDevice ? (
                    <label className="settings-toggle">
                      <input type="checkbox" checked={device.notifyTurns} disabled={busy}
                        onChange={(event) => { const notifyTurns = event.target.checked; void apply(() => updateDevice.call(client, device.deviceId, { notifyTurns })) }} />
                      <span>{t('settings.devices.notifyTurns')}</span>
                    </label>
                  ) : null}
                  <details className="device-link-details">
                    <summary>{t('settings.devices.permissions')}</summary>
                    {OPTIONAL_SCOPES.map((option) => (
                      <label className="settings-toggle" key={option.scope}>
                        <input type="checkbox" checked={device.scopes.includes(option.scope)} disabled={busy || !updateDevice}
                          onChange={(event) => {
                            if (!updateDevice) return
                            const on = event.target.checked
                            const next = ['read', ...OPTIONAL_SCOPES.map((item) => item.scope)
                              .filter((scope) => scope === option.scope ? on : device.scopes.includes(scope))]
                            void apply(() => updateDevice.call(client, device.deviceId, { scopes: next }))
                          }} />
                        <span>{t(option.allow)}</span>
                      </label>
                    ))}
                    {device.scopes.includes('broad_autonomy') ? <p className="device-link-warning" role="note">{t('settings.devices.broadWarning')}</p> : null}
                  </details>
                  <details className="device-link-details">
                    <summary>{t('settings.devices.activity')}</summary>
                    {device.activity.length ? (
                      <ul className="device-link-activity">
                        {device.activity.map((step, index) => (
                          <li key={`${step.at}:${index}`}>
                            <time dateTime={step.at}>{dateFormat.format(new Date(step.at))}</time>
                            <span>{ACTIVITY_KEYS[step.action] ? t(ACTIVITY_KEYS[step.action]!) : step.action}</span>
                            {step.detail ? <small title={step.detail}>{step.detail}</small> : null}
                          </li>
                        ))}
                      </ul>
                    ) : <p className="provider-hint">{t('settings.devices.noActivity')}</p>}
                  </details>
                </li>
              ))}
            </ul>
          ) : <p className="provider-hint">{t('settings.devices.noDevices')}</p>}

          <h3 className="device-link-subtitle">{t('settings.devices.messages')}</h3>
          {status.messages.length ? (
            <ul className="device-link-messages">
              {status.messages.map((message) => (
                <li key={message.id}>
                  <div>
                    <span className="device-link-message-text">{message.text}</span>
                    <small className="provider-hint">
                      {message.device}{message.createdAt ? ` · ${dateFormat.format(new Date(message.createdAt))}` : ''}
                    </small>
                  </div>
                  <CopyButton text={message.text} label={t('devices.copy')} t={t} />
                  {message.kind === 'link' && /^https:\/\//i.test(message.text) && openExternal ? (
                    <button type="button" className="message-action" aria-label={t('settings.devices.openLink')} title={t('settings.devices.openLink')}
                      onClick={() => void openExternal(message.text)}>
                      <ExternalLink size={13} aria-hidden="true" />
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : <p className="provider-hint">{t('settings.devices.noMessages')}</p>}
          <label className="settings-toggle">
            <input type="checkbox" checked={status.clipboard} disabled={busy}
              onChange={(event) => { const clipboard = event.target.checked; void apply(() => client.configureDeviceLink({ clipboard })) }} />
            <span>{t('settings.devices.clipboard')}</span>
          </label>
          <p className="provider-hint">{t('settings.devices.remote')}</p>

          <details className="device-link-details device-link-advanced">
            <summary>{t('settings.devices.advanced')}</summary>
            {status.running ? (
              <p className="provider-status provider-status-success">{t('settings.devices.listening', { port: String(status.port) })}</p>
            ) : null}
            <div className="voice-settings-fields">
              <label className="provider-field" htmlFor={modeId}>
                <span>{t('settings.devices.mode')}</span>
                <select id={modeId} value={status.secure ? 'https' : 'http'} disabled={busy}
                  onChange={(event) => { const secure = event.target.value === 'https'; void apply(() => client.configureDeviceLink({ secure })) }}>
                  <option value="https">{t('settings.devices.modeHttps')}</option>
                  <option value="http">{t('settings.devices.modeHttp')}</option>
                </select>
              </label>
              <label className="provider-field" htmlFor={portId}>
                <span>{t('settings.devices.port')}</span>
                <input id={portId} inputMode="numeric" value={portText} disabled={busy}
                  onChange={(event) => setPortText(event.target.value)}
                  onBlur={() => {
                    const port = Number(portText)
                    if (port === status.port) return
                    if (!Number.isInteger(port) || port < 1024 || port > 65535) { setFailure('settings.devices.invalidPort'); setPortText(String(status.port)); return }
                    void apply(() => client.configureDeviceLink({ port }))
                  }} />
              </label>
            </div>
            {status.running ? (
              <>
                <h3 className="device-link-subtitle">{t('settings.devices.addresses')}</h3>
                {status.addresses.length ? (
                  <ul className="device-link-addresses">
                    {status.addresses.map((item) => (
                      <li key={item.url}>
                        <code>{item.url}</code>
                        <span className="device-link-kind">{t(item.kind === 'tailscale' ? 'settings.devices.kindTailscale' : 'settings.devices.kindLan')}</span>
                        <CopyButton text={item.url} label={t('settings.devices.copyAddress')} t={t} />
                      </li>
                    ))}
                  </ul>
                ) : <p className="provider-hint">{t('settings.devices.noAddress')}</p>}
                {status.announced ? <p className="provider-hint">{t('settings.devices.announced')}</p> : null}
                {fingerprint ? <p className="provider-hint">{t('settings.devices.fingerprint')} <code>{fingerprint}</code></p> : null}
                <h3 className="device-link-subtitle">{t('settings.devices.manualPairing')}</h3>
                <div className="voice-settings-fields device-token-form">
                  <label className="provider-field" htmlFor={nameId}>
                    <span>{t('settings.devices.phoneName')}</span>
                    <input id={nameId} value={phoneName} maxLength={100} placeholder={t('settings.devices.phoneNamePlaceholder')}
                      onChange={(event) => setPhoneName(event.target.value)} />
                  </label>
                  <div className="provider-actions">
                    <button type="button" disabled={busy} onClick={() => {
                      const name = phoneName.trim() || t('settings.devices.phoneNamePlaceholder')
                      void apply(() => client.createDeviceToken(name, scopes)).then((response) => {
                        const entry = record(record(response?.payload)?.created)
                        const token = typeof entry?.deviceToken === 'string' ? entry.deviceToken : null
                        if (token && mounted.current) {
                          const next = statusFrom(response?.payload ?? {})
                          setCreated({ name, token, url: next?.addresses.find((item) => item.kind === 'lan')?.url ?? next?.addresses[0]?.url ?? null })
                          setPhoneName('')
                        }
                      })
                    }}>
                      {t('settings.devices.createToken')}
                    </button>
                  </div>
                </div>
                {created ? (
                  <div className="device-created" role="status">
                    <p>{t('settings.devices.tokenSteps', { name: created.name })}</p>
                    {created.url ? <p className="device-created-row"><span>{t('settings.devices.address')}</span><code>{created.url}</code><CopyButton text={created.url} label={t('settings.devices.copyAddress')} t={t} /></p> : null}
                    <p className="device-created-row"><span>{t('settings.devices.token')}</span><code>{created.token}</code><CopyButton text={created.token} label={t('settings.devices.copyToken')} t={t} /></p>
                    {fingerprint ? <p className="device-created-row"><span>{t('settings.devices.fingerprint')}</span><code>{status.fingerprint}</code><CopyButton text={status.fingerprint ?? ''} label={t('common.copy')} t={t} /></p> : null}
                    <p className="provider-hint">{t('settings.devices.tokenOnce')}</p>
                  </div>
                ) : null}
              </>
            ) : null}
            <label className="settings-toggle">
              <input type="checkbox" checked={status.wake} disabled={busy}
                onChange={(event) => { const wake = event.target.checked; void apply(() => client.configureDeviceLink({ wake })) }} />
              <span>{t('settings.devices.wake')}</span>
            </label>
            {status.wake ? <p className="provider-hint">{t('settings.devices.wakeHint')}</p> : null}
            <p className="provider-hint">{t('settings.devices.policy')}</p>
            {resetDeviceLink ? (
              <div className="provider-actions device-link-reset">
                {confirmReset ? (
                  <>
                    <button type="button" className="provider-danger" disabled={busy}
                      onClick={() => { setConfirmReset(false); void apply(() => resetDeviceLink.call(client)) }}>
                      {t('settings.devices.resetConfirm')}
                    </button>
                    <button type="button" disabled={busy} onClick={() => setConfirmReset(false)}>{t('devices.cancel')}</button>
                  </>
                ) : (
                  <button type="button" disabled={busy} onClick={() => setConfirmReset(true)}>{t('settings.devices.reset')}</button>
                )}
                <span className="provider-hint">{t('settings.devices.resetHint')}</span>
              </div>
            ) : null}
          </details>
        </div>
      ) : null}
      {failure ? <p className="provider-status provider-status-error" role="status">{t(failure)}</p> : null}
    </section>
  )
}

function LocalizedDeviceLinkSettings({ client }: { client: DeviceClient }) {
  return <DeviceLinkSettingsView client={client} i18n={useI18n()} />
}

export function DeviceLinkSettings({ client, i18n }: { client: DeviceClient; i18n?: I18nValue }) {
  return i18n ? <DeviceLinkSettingsView client={client} i18n={i18n} /> : <LocalizedDeviceLinkSettings client={client} />
}

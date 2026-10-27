import { Smartphone, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import type { WorkbenchBridgeClient } from '../bridge/client'
import { useOptionalI18n } from '../i18n/I18nProvider'
import type { MessageKey, TranslationVariables } from '../i18n/messages'
import './devices.css'

export type PhoneItem = Parameters<WorkbenchBridgeClient['sendToPhone']>[1]
type SendClient = Partial<Pick<WorkbenchBridgeClient, 'deviceLinkStatus' | 'sendToPhone'>>
interface Phone { deviceId: string; name: string }

function phonesFrom(payload: Record<string, unknown>): Phone[] {
  const devices = Array.isArray(payload.devices) ? payload.devices : []
  return devices.flatMap((item: unknown) => {
    const entry = item && typeof item === 'object' ? item as Record<string, unknown> : null
    return entry && typeof entry.deviceId === 'string' && typeof entry.name === 'string'
      ? [{ deviceId: entry.deviceId, name: entry.name }]
      : []
  })
}

function PhonePicker({ phones, onPick, onClose }: { phones: readonly Phone[]; onPick: (phone: Phone) => void; onClose: () => void }) {
  const { t } = useOptionalI18n()
  const panel = useRef<HTMLElement>(null)
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    panel.current?.querySelector<HTMLButtonElement>('.phone-picker-list button')?.focus()
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') { event.stopPropagation(); onClose() }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      if (opener?.isConnected) opener.focus()
    }
  }, [onClose])
  return createPortal(
    <div className="command-overlay compare-overlay" role="presentation"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section ref={panel} tabIndex={-1} className="compare-dialog phone-picker" role="dialog" aria-modal="true" aria-label={t('devices.choosePhone')}>
        <header>
          <Smartphone size={15} aria-hidden="true" />
          <strong>{t('devices.choosePhone')}</strong>
          <button type="button" className="icon-button" aria-label={t('devices.cancel')} title={t('devices.cancel')} onClick={onClose}><X size={15} /></button>
        </header>
        <ul className="phone-picker-list">
          {phones.map((phone) => (
            <li key={phone.deviceId}>
              <button type="button" onClick={() => onPick(phone)}><Smartphone size={14} aria-hidden="true" />{phone.name}</button>
            </li>
          ))}
        </ul>
      </section>
    </div>,
    document.querySelector('.workbench') ?? document.body,
  )
}

/**
 * "Send to phone" for messages, files and conversations: with one paired phone it goes there,
 * with several the user picks one. ``ui`` holds the picker and the outcome line.
 */
export function useSendToPhone(client?: SendClient): {
  available: boolean
  send: (item: PhoneItem) => void
  ui: ReactNode
} {
  const { t } = useOptionalI18n()
  const [choosing, setChoosing] = useState<{ item: PhoneItem; phones: Phone[] } | null>(null)
  const [outcome, setOutcome] = useState<{ key: MessageKey; variables?: TranslationVariables; failed: boolean } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  const report = useCallback((key: MessageKey, failed: boolean, variables?: TranslationVariables) => {
    setOutcome({ key, failed, variables })
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setOutcome(null), 5000)
  }, [])

  const deliver = useCallback(async (phone: Phone, item: PhoneItem) => {
    setChoosing(null)
    try {
      const response = await client!.sendToPhone!(phone.deviceId, item)
      if (!response.type.endsWith('.result')) throw new Error('send_failed')
      report('devices.sentTo', false, { name: phone.name })
    } catch {
      report('devices.sendFailed', true)
    }
  }, [client, report])

  const send = useCallback((item: PhoneItem) => {
    if (!client?.deviceLinkStatus || !client.sendToPhone) return
    void client.deviceLinkStatus().then((response) => {
      const phones = phonesFrom(response.payload as Record<string, unknown>)
      if (phones.length === 0) report('devices.noPhone', true)
      else if (phones.length === 1) void deliver(phones[0]!, item)
      else setChoosing({ item, phones })
    }, () => report('devices.sendFailed', true))
  }, [client, deliver, report])

  const ui = (
    <>
      {choosing ? (
        <PhonePicker phones={choosing.phones} onPick={(phone) => void deliver(phone, choosing.item)} onClose={() => setChoosing(null)} />
      ) : null}
      {outcome ? (
        <p className={`phone-send-outcome${outcome.failed ? ' is-failed' : ''}`} role="status">{t(outcome.key, outcome.variables)}</p>
      ) : null}
    </>
  )
  return { available: Boolean(client?.deviceLinkStatus && client.sendToPhone), send, ui }
}

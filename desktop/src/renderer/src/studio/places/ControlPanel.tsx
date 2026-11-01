import { ArrowLeft, CircleStop, MessageSquare } from 'lucide-react'
import { useState, type CSSProperties } from 'react'

import type { WorkbenchBridgeClient } from '../../bridge/client'
import { useOptionalI18n, useText } from '../../i18n/I18nProvider'
import type { WorkbenchState } from '../../state/workbench-types'
import type { TeamSettings } from '../../team/team-settings'
import { ApprovalShelf } from '../../timeline/ApprovalShelf'
import { approvalItems } from '../../timeline/approval-items'
import { turnRunning } from '../cast'
import { controlSummary, costText, stationLine, stationPeople, stationTitle } from './control-view'
import { byUrgency, type ControlModel, type ControlStation } from './models'

/**
 * Beside the control room: every conversation at work, the most urgent first; one of them up
 * close with its people, its questions to approve or deny, and a way to stop it or open it.
 */
export function ControlPanel({ model, state, client, team, names, focus, onFocus, onOpenSession, onOpenAgent, onOpenRun, onOpenRoute }: {
  model: ControlModel
  state: WorkbenchState
  client?: WorkbenchBridgeClient
  team: TeamSettings
  names: { lead: string; expert: (id: string) => string; helper?: string }
  focus: string | null
  onFocus: (sessionId: string | null) => void
  onOpenSession?: (workspace: string, sessionId: string) => void
  onOpenAgent?: () => void
  onOpenRun?: (runId: string) => void
  onOpenRoute?: (route: string) => void
}) {
  const { t, locale } = useOptionalI18n()
  const station = focus ? model.stations.find((item) => item.sessionId === focus) ?? null : null
  if (station) {
    return (
      <aside className="control-panel" aria-label={stationTitle(station, t)}>
        <StationDetail station={station} state={state} client={client} team={team} names={names} onBack={() => onFocus(null)}
          onOpenSession={onOpenSession} onOpenAgent={onOpenAgent} onOpenRun={onOpenRun} />
      </aside>
    )
  }
  const stations = byUrgency(model.stations)
  const summary = controlSummary(model, t, locale)
  return (
    <aside className="control-panel" aria-label={t('places.control.title')}>
      <header className="control-summary">
        <h2>{summary.title}</h2>
        <p>{summary.detail}</p>
      </header>
      <ul className="control-list">
        {stations.map((item) => {
          const cost = costText(item.cost, t, locale)
          return (
            <li key={item.sessionId} data-state={item.state}>
              <button type="button" onClick={() => onFocus(item.sessionId)}>
                <span className="studio-floor-dot" aria-hidden="true" />
                <strong>{stationTitle(item, t)}</strong>
                <span>{stationLine(item, t)}</span>
                {cost ? <small>{cost}</small> : null}
              </button>
            </li>
          )
        })}
        {stations.length === 0 ? <li className="control-empty">{t('places.control.empty')}</li> : null}
      </ul>
      {model.more > 0 ? <p className="control-note">{t('places.control.more', { count: model.more })}</p> : null}
      <div className="control-extras">
        <button type="button" onClick={() => onOpenRoute?.('jobs')}>
          {t('places.control.jobs', { count: model.jobs.running })}
          {model.jobs.failed > 0 ? <em>{t('places.control.jobsFailed', { count: model.jobs.failed })}</em> : null}
        </button>
        {model.phones > 0 ? <button type="button" onClick={() => onOpenRoute?.('settings')}>{t('places.control.phones', { count: model.phones })}</button> : null}
      </div>
    </aside>
  )
}

function StationDetail({ station, state, client, team, names, onBack, onOpenSession, onOpenAgent, onOpenRun }: {
  station: ControlStation
  state: WorkbenchState
  client?: WorkbenchBridgeClient
  team: TeamSettings
  names: { lead: string; expert: (id: string) => string; helper?: string }
  onBack: () => void
  onOpenSession?: (workspace: string, sessionId: string) => void
  onOpenAgent?: () => void
  onOpenRun?: (runId: string) => void
}) {
  const { t, locale } = useOptionalI18n()
  const tx = useText()
  const [stopping, setStopping] = useState(false)
  const [stopFailed, setStopFailed] = useState(false)
  const people = stationPeople(state, station, team, names, t)
  const approvals = approvalItems(state, tx, station.sessionId)
  const cost = costText(station.cost, t, locale)
  // A failed expert does not end the turn; a failed turn has nothing left to stop.
  const running = ['approval', 'quiet', 'working', 'queued'].includes(station.state) || turnRunning(state, station.sessionId)
  const open = (): void => {
    if (station.selected) onOpenAgent?.()
    else if (station.workspace) onOpenSession?.(station.workspace, station.sessionId)
  }
  const stop = async (): Promise<void> => {
    if (!client) return
    setStopping(true)
    setStopFailed(false)
    try {
      await client.cancelTurn(station.sessionId, state.runtime.activeSessions?.[station.sessionId]?.activeTurn ?? undefined)
    } catch {
      setStopFailed(true)
    } finally {
      setStopping(false)
    }
  }
  return (
    <>
      <header className="control-detail-header">
        <button type="button" className="icon-button" aria-label={t('places.control.all')} title={t('places.control.all')} onClick={onBack}><ArrowLeft size={15} /></button>
        <div>
          <h2>{stationTitle(station, t)}</h2>
          <p data-state={station.state}>{stationLine(station, t)}</p>
          {cost ? <p className="control-cost">{cost}</p> : null}
        </div>
      </header>
      <div className="control-actions">
        <button type="button" disabled={!station.workspace && !station.selected} onClick={open}><MessageSquare size={14} aria-hidden="true" />{t('places.control.open')}</button>
        {running ? <button type="button" disabled={!client || stopping} onClick={() => void stop()}><CircleStop size={14} aria-hidden="true" />{t('places.control.stop')}</button> : null}
      </div>
      {stopFailed ? <p className="route-error" role="status">{t('places.control.stopFailed')}</p> : null}
      {approvals.length > 0 && client ? <ApprovalShelf approvals={approvals} resolve={(requestId, scope) => client.resolveApproval(requestId, scope)} /> : null}
      <h3>{t('places.control.people')}</h3>
      <ul className="control-people">
        {people.map((person) => (
          <li key={person.id} data-state={person.state}>
            <button type="button" disabled={!person.lead && !person.runId}
              onClick={() => (person.lead ? open() : person.runId && onOpenRun?.(person.runId))}>
              <span className="studio-swatch" style={{ '--swatch': person.look.shirt } as CSSProperties} aria-hidden="true" />
              <strong>{person.name}</strong>
              <span>{person.stateLabel}</span>
            </button>
          </li>
        ))}
      </ul>
    </>
  )
}

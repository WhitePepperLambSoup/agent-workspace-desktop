import {
  Activity,
  AlertTriangle,
  Check,
  ChevronDown,
  CircleDot,
  Clock3,
  ExternalLink,
  ListRestart,
  MonitorDown,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  Square,
  Terminal as TerminalIcon,
  Users,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { JsonValue, ResponseEnvelope } from '../../../shared/protocol'
import { GatewayCommandError, type WorkbenchBridgeClient } from '../bridge/client'
import type {
  OrchestrationView,
  QueueTaskView,
  TerminalView,
  WorkbenchState,
} from '../state/workbench-store'
import { useText } from '../i18n/I18nProvider'

type OperationsTab = 'overview' | 'queue' | 'orchestration' | 'terminal' | 'events'

interface OperationsRouteProps {
  state: WorkbenchState
  client?: WorkbenchBridgeClient
}

interface TerminalDraft {
  argv: string
  cwd: string
  input: string
}

const EMPTY_TERMINAL: TerminalDraft = {
  argv: 'node -e "console.log(\'Agent Workspace terminal ready\')"',
  cwd: '',
  input: '',
}

function responsePayload(response: ResponseEnvelope | undefined): Record<string, JsonValue> {
  if (!response || response.type === 'app.error') return {}
  return response.payload
}

function textValue(value: JsonValue | undefined, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function numberValue(value: JsonValue | undefined, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function statusTone(status: string): string {
  const normalized = status.toLowerCase()
  if (['completed', 'succeeded', 'delivered', 'healthy', 'exited'].includes(normalized)) return 'success'
  if (['failed', 'blocked', 'cancelled', 'error'].includes(normalized)) return 'danger'
  if (['running', 'claimed', 'active'].includes(normalized)) return 'active'
  return 'idle'
}

function formatTime(value?: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

function operationError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message
  return fallback
}

function Metric({ label, value, icon }: { label: string; value: string | number; icon: React.ReactNode }) {
  return (
    <div className="operations-metric">
      <span className="operations-metric-icon">{icon}</span>
      <span><small>{label}</small><strong>{value}</strong></span>
    </div>
  )
}

function StatusPill({ status }: { status: string }) {
  const tx = useText()
  return <span className={`operations-status-pill tone-${statusTone(status)}`}><CircleDot size={11} />{tx(status.replaceAll('_', ' '))}</span>
}

function EmptyState({ icon, title, detail }: { icon: React.ReactNode; title: string; detail: string }) {
  return <div className="operations-empty"><span>{icon}</span><strong>{title}</strong><small>{detail}</small></div>
}

function QueueTable({
  tasks,
  counts,
  onInspect,
}: {
  tasks: QueueTaskView[]
  counts: Record<string, number>
  onInspect: (task: QueueTaskView) => void
}) {
  const tx = useText()
  return (
    <section className="operations-section glass-surface" aria-label={tx('Run queue')}>
      <header className="operations-section-header">
        <div><p className="section-kicker">{tx('Durable execution')}</p><h2>{tx('Run queue')}</h2></div>
        <div className="operations-counts">
          {Object.entries(counts).map(([key, value]) => <span key={key}>{tx(key.replaceAll('_', ' '))}: <b>{value}</b></span>)}
        </div>
      </header>
      {tasks.length === 0 ? <EmptyState icon={<ListRestart size={22} />} title={tx('Queue is empty')} detail={tx('Scheduled and queued turns will appear here with retry state and lease information.')} /> : (
        <div className="operations-table-wrap">
          <table className="operations-table"><thead><tr><th>{tx('Task')}</th><th>{tx('Status')}</th><th>{tx('Priority')}</th><th>{tx('Attempt')}</th><th>{tx('Updated')}</th><th /></tr></thead>
            <tbody>{tasks.map((task) => <tr key={task.id}>
              <td><button type="button" className="operations-link-button" onClick={() => onInspect(task)}><strong>{task.id.slice(0, 12)}</strong><small>{task.prompt || task.model || task.workspace || tx('Queued work')}</small></button></td>
              <td><StatusPill status={task.status} />{task.error ? <small className="operations-error-inline">{task.error}</small> : null}</td>
              <td>{task.priority ?? 0}</td><td>{task.attempt ?? 0}</td><td>{formatTime(task.updatedAt ?? task.createdAt)}</td>
              <td><button type="button" className="icon-button" aria-label={tx('Inspect queue task')} onClick={() => onInspect(task)}><ExternalLink size={14} /></button></td>
            </tr>)}</tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function QueueInspector({
  task,
  onClose,
}: {
  task: QueueTaskView | null
  onClose: () => void
}) {
  const tx = useText()
  if (!task) return null
  return <aside className="operations-inspector glass-surface" aria-label={tx('Queue task details')}>
    <header><div><p className="section-kicker">{tx('Queue task')}</p><h3>{task.id}</h3></div><button type="button" className="icon-button" onClick={onClose} aria-label={tx('Close')}><X size={15} /></button></header>
    <dl className="operations-details"><div><dt>{tx('Status')}</dt><dd><StatusPill status={task.status} /></dd></div><div><dt>{tx('Workspace')}</dt><dd>{task.workspace || '—'}</dd></div><div><dt>{tx('Model')}</dt><dd>{task.model || '—'}</dd></div><div><dt>{tx('Priority')}</dt><dd>{task.priority ?? 0}</dd></div><div><dt>{tx('Lease')}</dt><dd>{formatTime(task.leaseUntil)}</dd></div><div><dt>{tx('Created')}</dt><dd>{formatTime(task.createdAt)}</dd></div></dl>
    {task.prompt ? <div className="operations-code-block"><small>{tx('Prompt')}</small><p>{task.prompt}</p></div> : null}
    {task.error ? <p className="route-error"><AlertTriangle size={14} />{task.error}</p> : null}
  </aside>
}

function OrchestrationCard({
  item,
  onInspect,
  onCancel,
  onResume,
}: {
  item: OrchestrationView
  onInspect: () => void
  onCancel: () => void
  onResume: () => void
}) {
  const tx = useText()
  return <article className="operations-orchestration-card">
    <header><div><span className="operations-kind"><Users size={12} />{tx(item.kind)}</span><h3>{item.title || item.id}</h3></div><StatusPill status={item.state} /></header>
    <p>{item.goal || item.detail || tx('No description')}</p>
    <div className="operations-orchestration-meta"><span>{item.phase ? tx(item.phase.replaceAll('_', ' ')) : tx('No phase')}</span><span>{formatTime(item.updatedAt)}</span>{item.members?.length ? <span>{item.members.length} {tx('members')}</span> : null}</div>
    <div className="operations-action-row"><button type="button" className="secondary-button" onClick={onInspect}><Search size={13} />{tx('Inspect')}</button>{item.canResume ? <button type="button" className="secondary-button" onClick={onResume}><Play size={13} />{tx('Resume')}</button> : null}{item.canCancel ? <button type="button" className="secondary-button danger-button" onClick={onCancel}><Square size={13} />{tx('Cancel')}</button> : null}</div>
  </article>
}

function TerminalPanel({
  terminals,
  draft,
  setDraft,
  activeTerminal,
  onStart,
  onInput,
  onStop,
  onReplay,
  onSelect,
  busy,
}: {
  terminals: Record<string, TerminalView>
  draft: TerminalDraft
  setDraft: (value: TerminalDraft) => void
  activeTerminal: TerminalView | null
  onStart: () => void
  onInput: () => void
  onStop: () => void
  onReplay: () => void
  onSelect: (terminalId: string) => void
  busy: boolean
}) {
  const tx = useText()
  const terminalItems = Object.values(terminals)
  return <div className="operations-terminal-layout">
    <section className="operations-section glass-surface"><header className="operations-section-header"><div><p className="section-kicker">{tx('Persistent sessions')}</p><h2>{tx('Terminal')}</h2></div><TerminalIcon size={18} /></header>
      <form className="operations-form terminal-form" onSubmit={(event) => { event.preventDefault(); onStart() }}><label><span>{tx('Command')}</span><input value={draft.argv} onChange={(event) => setDraft({ ...draft, argv: event.target.value })} /></label><label><span>{tx('Working directory')}</span><input value={draft.cwd} onChange={(event) => setDraft({ ...draft, cwd: event.target.value })} placeholder={tx('Workspace root')} /></label><button type="submit" className="primary-button" disabled={busy || !draft.argv.trim()}><Play size={14} />{tx('Start terminal')}</button></form>
      <div className="operations-terminal-list">{terminalItems.map((terminal) => <button key={terminal.id} type="button" className={`operations-terminal-row ${activeTerminal?.id === terminal.id ? 'is-selected' : ''}`} onClick={() => onSelect(terminal.id)}><span className={`run-state-dot state-${terminal.state}`} /><span><strong>{terminal.id}</strong><small>{terminal.argv?.join(' ') || terminal.cwd || tx('Terminal session')}</small></span><StatusPill status={terminal.state} /></button>)}{terminalItems.length === 0 ? <EmptyState icon={<MonitorDown size={22} />} title={tx('No terminal sessions')} detail={tx('Start a bounded persistent terminal to inspect output and replay it after reconnect.')} /> : null}</div>
    </section>
    <section className="operations-section glass-surface operations-terminal-output"><header className="operations-section-header"><div><p className="section-kicker">{activeTerminal?.id || tx('Select a session')}</p><h2>{tx('Output')}</h2></div><div className="operations-action-row">{activeTerminal ? <><button type="button" className="icon-button" onClick={onReplay} aria-label={tx('Replay output')}><RotateCcw size={14} /></button><button type="button" className="icon-button danger-button" onClick={onStop} aria-label={tx('Stop terminal')}><Square size={14} /></button></> : null}</div></header>
      <pre className="operations-terminal-pre">{activeTerminal?.output || tx('Terminal output will appear here.')}</pre>{activeTerminal ? <form className="operations-terminal-input" onSubmit={(event) => { event.preventDefault(); onInput() }}><input value={draft.input} onChange={(event) => setDraft({ ...draft, input: event.target.value })} placeholder={tx('Send input')} /><button type="submit" className="icon-button" disabled={!draft.input.trim()} aria-label={tx('Send')}><Send size={14} /></button></form> : null}</section>
  </div>
}

export function OperationsRoute({ state, client }: OperationsRouteProps) {
  const tx = useText()
  const workspacePath = state.workspace?.path ?? null
  const selectedSessionId = typeof state.selectedSession?.id === 'string' ? state.selectedSession.id : null
  const bootstrapVersion = state.bootstrapVersion ?? 0
  const loadContext = { client, workspacePath, selectedSessionId, bootstrapVersion }
  const previousLoadContext = useRef<typeof loadContext | null>(null)
  const loadGeneration = useRef(0)
  const [tab, setTab] = useState<OperationsTab>('overview')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [orchestrationUnavailable, setOrchestrationUnavailable] = useState({ collaboration: false, delivery: false })
  const [selectedQueue, setSelectedQueue] = useState<QueueTaskView | null>(null)
  const [selectedOrchestration, setSelectedOrchestration] = useState<OrchestrationView | null>(null)
  const [selectedTerminalId, setSelectedTerminalId] = useState<string | null>(null)
  const [terminalDraft, setTerminalDraft] = useState<TerminalDraft>(EMPTY_TERMINAL)
  const replayCursor = useRef({
    cursor: state.operational.eventReplayCursor ?? 0,
    epoch: state.operational.eventReplayEpoch,
  })
  replayCursor.current = {
    cursor: state.operational.eventReplayCursor ?? 0,
    epoch: state.operational.eventReplayEpoch,
  }

  const load = useCallback(async (showNotice = true) => {
    const generation = ++loadGeneration.current
    if (!client || !workspacePath) return
    setBusy(true)
    if (showNotice) { setError(null); setNotice(null) }
    const loadOrchestration = async (kind: OrchestrationView['kind'], list: () => Promise<unknown>) => {
      let unavailable = false
      try {
        await list()
      } catch (reason) {
        if (!(reason instanceof GatewayCommandError) || reason.code !== 'orchestration_unavailable') throw reason
        unavailable = true
      }
      if (generation === loadGeneration.current) {
        setOrchestrationUnavailable((current) => current[kind] === unavailable ? current : { ...current, [kind]: unavailable })
      }
    }
    try {
      await Promise.all([
        client.listQueue(),
        loadOrchestration('collaboration', () => client.listCollaborations()),
        loadOrchestration('delivery', () => client.listDeliveries()),
        client.listTerminals?.(),
        client.replayEvents(replayCursor.current.cursor, {
          limit: 500,
          epoch: replayCursor.current.epoch ?? undefined,
        }),
      ])
      if (generation === loadGeneration.current && showNotice) setNotice(tx('Operations refreshed'))
    } catch (reason) {
      if (generation !== loadGeneration.current) return
      const message = operationError(reason, tx('Unable to refresh operations'))
      setError((current) => showNotice ? message : current ?? message)
    } finally {
      if (generation === loadGeneration.current) setBusy(false)
    }
  }, [client, workspacePath, selectedSessionId, tx])

  useEffect(() => {
    const previous = previousLoadContext.current
    const recovering = previous !== null && previous.client === client &&
      previous.workspacePath === workspacePath && previous.selectedSessionId === selectedSessionId &&
      previous.bootstrapVersion !== bootstrapVersion
    previousLoadContext.current = { client, workspacePath, selectedSessionId, bootstrapVersion }
    void load(!recovering)
    return () => { loadGeneration.current += 1 }
  }, [bootstrapVersion, client, load, selectedSessionId, workspacePath])

  useEffect(() => {
    if (tab !== 'events' || !client || !workspacePath) return
    void client.replayEvents(replayCursor.current.cursor, {
      limit: 500,
      epoch: replayCursor.current.epoch ?? undefined,
    }).catch((reason) => setError(operationError(reason, tx('Unable to replay events'))))
  }, [client, workspacePath, tab, tx])

  const activeTerminal = selectedTerminalId ? state.operational.terminals[selectedTerminalId] ?? null : Object.values(state.operational.terminals)[0] ?? null

  useEffect(() => {
    if (tab !== 'terminal' || !client || !activeTerminal) return
    void client.replayTerminal(activeTerminal.id, 0).catch((reason) => setError(operationError(reason, tx('Unable to replay terminal output'))))
  }, [activeTerminal?.id, client, tab, tx])

  const runAction = useCallback(async (action: () => Promise<unknown>, success: string) => {
    if (!client) {
      setError(tx('Operations bridge is unavailable'))
      setNotice(null)
      return
    }
    setBusy(true); setError(null); setNotice(null)
    try {
      const result = await action()
      await load(false)
      setNotice(typeof result === 'string' ? result : success)
    } catch (reason) {
      setError(operationError(reason, tx('Operation failed')))
    } finally { setBusy(false) }
  }, [client, load, tx])

  const startTerminal = () => void runAction(async () => {
    const argv = terminalDraft.argv.match(/(?:[^\s"]+|"[^"]*")+/g)?.map((item) => item.replace(/^"|"$/g, '')) ?? []
    const response = await client?.startTerminal({ argv, cwd: terminalDraft.cwd.trim() || undefined })
    const terminal = responsePayload(response).terminal
    if (terminal && typeof terminal === 'object' && !Array.isArray(terminal)) {
      const id = textValue((terminal as Record<string, JsonValue>).id) || textValue((terminal as Record<string, JsonValue>).terminalId)
      if (id) setSelectedTerminalId(id)
    }
  }, tx('Terminal started'))

  const selectedOrchestrationItems = useMemo(() => [
    ...(orchestrationUnavailable.collaboration ? [] : state.operational.collaborations),
    ...(orchestrationUnavailable.delivery ? [] : state.operational.deliveries),
  ], [orchestrationUnavailable, state.operational.collaborations, state.operational.deliveries])

  const tabs: Array<{ id: OperationsTab; label: string; icon: React.ReactNode }> = [
    { id: 'overview', label: tx('Overview'), icon: <Activity size={15} /> },
    { id: 'queue', label: tx('Queue'), icon: <ListRestart size={15} /> },
    { id: 'orchestration', label: tx('Collaboration'), icon: <Users size={15} /> },
    { id: 'terminal', label: tx('Terminal'), icon: <TerminalIcon size={15} /> },
    { id: 'events', label: tx('Events'), icon: <Clock3 size={15} /> },
  ]

  if (!state.workspace) return <main className="route-column reading-surface operations-route operations-route-empty"><header className="route-header"><div><p className="section-kicker">{tx('Operations')}</p><h1>{tx('Control center')}</h1></div></header><div className="operations-content"><EmptyState icon={<AlertTriangle size={22} />} title={tx('Open a workspace first')} detail={tx('Operations are scoped to the active workspace and session.')} /></div></main>

  return <main className="route-column reading-surface operations-route" aria-label={tx('Operations')}>
    <header className="route-header operations-header"><div><p className="section-kicker">{tx('Runtime operations')}</p><h1 tabIndex={-1}>{tx('Control center')}</h1><p className="route-description">{tx('Inspect durable work, collaboration, persistent terminals and replayable evidence from one place.')}</p></div><div className="operations-header-actions"><StatusPill status={state.runtime.ready ? 'ready' : state.runtime.state} /><button type="button" className="icon-button" onClick={() => void load()} disabled={busy} aria-label={tx('Refresh')}><RefreshCw size={15} className={busy ? 'is-spinning' : undefined} /></button></div></header>
    <nav className="operations-tabs" aria-label={tx('Operations views')}>{tabs.map((item) => <button key={item.id} type="button" className={tab === item.id ? 'is-selected' : ''} onClick={() => setTab(item.id)}>{item.icon}<span>{item.label}</span></button>)}</nav>
    <div className="operations-content">
    {error ? <p className="route-error" role="alert"><AlertTriangle size={14} /><span>{error}</span></p> : null}{notice ? <p className="review-notice" role="status"><Check size={14} />{notice}</p> : null}
    {tab === 'overview' ? <div className="operations-overview-grid"><section className="operations-summary glass-surface"><header className="operations-section-header"><div><p className="section-kicker">{tx('Workspace pulse')}</p><h2>{tx('At a glance')}</h2></div><Activity size={18} /></header><div className="operations-metrics"><Metric label={tx('Queued')} value={state.operational.queueCounts.queued ?? state.operational.queue.length} icon={<ListRestart size={16} />} /><Metric label={tx('Collaborations')} value={selectedOrchestrationItems.length} icon={<Users size={16} />} /><Metric label={tx('Terminals')} value={Object.keys(state.operational.terminals).length} icon={<TerminalIcon size={16} />} /></div></section><section className="operations-section glass-surface"><header className="operations-section-header"><div><p className="section-kicker">{tx('Latest activity')}</p><h2>{tx('Operational events')}</h2></div><button type="button" className="secondary-button" onClick={() => setTab('events')}>{tx('View all')}</button></header><div className="operations-event-list">{state.operational.operationalEvents.slice(-8).reverse().map((event) => <div key={`${event.sequence}-${event.type}`}><span>#{event.sequence}</span><strong>{event.type}</strong><small>{event.text}</small></div>)}{state.operational.operationalEvents.length === 0 ? <EmptyState icon={<Clock3 size={22} />} title={tx('No events yet')} detail={tx('Events appear as runs, queue items and phases change state.')} /> : null}</div></section><section className="operations-section glass-surface"><header className="operations-section-header"><div><p className="section-kicker">{tx('Recovery')}</p><h2>{tx('Reconnect posture')}</h2></div><RotateCcw size={18} /></header><div className="operations-recovery"><StatusPill status={state.runtime.stale ? 'recovering' : 'connected'} /><p>{state.runtime.stale ? tx('The event stream is being reconciled from the durable gateway.') : tx('The renderer is following the gateway event cursor.')}</p><button type="button" className="secondary-button" onClick={() => void client?.replayEvents(replayCursor.current.cursor, { epoch: replayCursor.current.epoch ?? undefined })}><RotateCcw size={13} />{tx('Replay from cursor')}</button></div></section></div> : null}
    {tab === 'queue' ? <div className="operations-split"><QueueTable tasks={state.operational.queue} counts={state.operational.queueCounts} onInspect={setSelectedQueue} /><QueueInspector task={selectedQueue} onClose={() => setSelectedQueue(null)} /></div> : null}
    {tab === 'orchestration' && (orchestrationUnavailable.collaboration || orchestrationUnavailable.delivery) ? <p className="route-note" data-testid="operations-orchestration-unavailable">
      {orchestrationUnavailable.collaboration ? <span>{tx('Collaboration workflows are unavailable in this runtime.')}</span> : null}
      {orchestrationUnavailable.collaboration && orchestrationUnavailable.delivery ? ' ' : null}
      {orchestrationUnavailable.delivery ? <span>{tx('Delivery workflows are unavailable in this runtime.')}</span> : null}
    </p> : null}
    {tab === 'orchestration' ? <div className="operations-orchestration-grid">
      <section className="operations-section glass-surface">
        <header className="operations-section-header"><div><p className="section-kicker">{tx('Multi-agent workflows')}</p><h2>{tx('Collaborations')}</h2></div><Users size={18} /></header>
        <div className="operations-card-list">{!orchestrationUnavailable.collaboration ? <>
          {state.operational.collaborations.map((item) => <OrchestrationCard key={item.id} item={item} onInspect={() => setSelectedOrchestration(item)} onCancel={() => void runAction(() => client?.cancelCollaboration(item.id, item.sessionId ?? selectedSessionId) ?? Promise.resolve(), tx('Collaboration cancelled'))} onResume={() => void runAction(() => client?.resumeCollaboration(item.id, item.sessionId ?? selectedSessionId) ?? Promise.resolve(), tx('Collaboration resumed'))} />)}
          {state.operational.collaborations.length === 0 ? <EmptyState icon={<Users size={22} />} title={tx('No collaborations')} detail={tx('Collaboration state will appear when multi-agent work is active.')} /> : null}
        </> : null}</div>
      </section>
      <section className="operations-section glass-surface">
        <header className="operations-section-header"><div><p className="section-kicker">{tx('Delivery workflows')}</p><h2>{tx('Deliveries')}</h2></div><Send size={18} /></header>
        <div className="operations-card-list">{!orchestrationUnavailable.delivery ? <>
          {state.operational.deliveries.map((item) => <OrchestrationCard key={item.id} item={item} onInspect={() => setSelectedOrchestration(item)} onCancel={() => void runAction(() => client?.cancelDelivery(item.id, item.sessionId ?? selectedSessionId) ?? Promise.resolve(), tx('Delivery cancelled'))} onResume={() => { const routeId = item.routeId; if (!routeId) { setError(tx('Delivery route is missing')); setNotice(null); return }; void runAction(() => client?.resumeDelivery(item.id, item.sessionId ?? selectedSessionId, routeId) ?? Promise.resolve(), tx('Delivery resumed')) }} />)}
          {state.operational.deliveries.length === 0 ? <EmptyState icon={<Send size={22} />} title={tx('No deliveries')} detail={tx('Delivery progress and recovery actions will appear here.')} /> : null}
        </> : null}</div>
      </section>
      {selectedOrchestration && !orchestrationUnavailable[selectedOrchestration.kind] ? <aside className="operations-inspector glass-surface"><header><div><p className="section-kicker">{selectedOrchestration.kind}</p><h3>{selectedOrchestration.id}</h3></div><button type="button" className="icon-button" onClick={() => setSelectedOrchestration(null)} aria-label={tx('Close')}><X size={15} /></button></header><dl className="operations-details"><div><dt>{tx('State')}</dt><dd><StatusPill status={selectedOrchestration.state} /></dd></div><div><dt>{tx('Phase')}</dt><dd>{selectedOrchestration.phase || '—'}</dd></div><div><dt>{tx('Session')}</dt><dd>{selectedOrchestration.sessionId || '—'}</dd></div><div><dt>{tx('Updated')}</dt><dd>{formatTime(selectedOrchestration.updatedAt)}</dd></div></dl>{selectedOrchestration.finalText ? <div className="operations-code-block"><small>{tx('Final output')}</small><p>{selectedOrchestration.finalText}</p></div> : null}</aside> : null}
    </div> : null}
    {tab === 'terminal' ? <TerminalPanel terminals={state.operational.terminals} draft={terminalDraft} setDraft={setTerminalDraft} activeTerminal={activeTerminal} onSelect={setSelectedTerminalId} onStart={startTerminal} onInput={() => activeTerminal && void runAction(() => client?.sendTerminalInput(activeTerminal.id, terminalDraft.input) ?? Promise.resolve(), tx('Input sent'))} onStop={() => activeTerminal && void runAction(() => client?.stopTerminal(activeTerminal.id) ?? Promise.resolve(), tx('Terminal stopped'))} onReplay={() => activeTerminal && void runAction(() => client?.replayTerminal(activeTerminal.id) ?? Promise.resolve(), tx('Terminal replayed'))} busy={busy} /> : null}
    {tab === 'events' ? <section className="operations-section glass-surface"><header className="operations-section-header"><div><p className="section-kicker">{tx('Durable cursor')}</p><h2>{tx('Event stream')}</h2></div><button type="button" className="secondary-button" onClick={() => void client?.replayEvents(replayCursor.current.cursor, { limit: 500, epoch: replayCursor.current.epoch ?? undefined })}><RotateCcw size={13} />{tx('Replay')}</button></header><div className="operations-event-list operations-event-list-large">{state.operational.operationalEvents.slice().reverse().map((event) => <article key={`${event.sequence}-${event.type}`}><header><span>#{event.sequence}</span><strong>{event.type}</strong><time>{formatTime(event.createdAt)}</time></header><p>{event.text}</p></article>)}{state.operational.operationalEvents.length === 0 ? <EmptyState icon={<Clock3 size={22} />} title={tx('No operational events')} detail={tx('Run a task or refresh the gateway to populate the event stream.')} /> : null}</div></section> : null}
    </div>
  </main>
}

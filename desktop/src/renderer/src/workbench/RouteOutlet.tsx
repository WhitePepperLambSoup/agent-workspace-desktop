import { Bot } from 'lucide-react'
import { Suspense } from 'react'

import type { WorkbenchBridgeClient } from '../bridge/client'
import type { ActivityRoute, WorkbenchState, WorkbenchStore } from '../state/workbench-store'
import { useText } from '../i18n/I18nProvider'
import {
  LazyBackgroundJobsRoute,
  LazyChangesRoute,
  LazyKnowledgeRoute,
  LazyOperationsRoute,
  LazyRunControlCenter,
  LazySchedulesRoute,
  LazySearchRoute,
  LazySettingsRoute,
  LazyWorkspaceRoute,
} from './lazy-routes'

export type { ActivityRoute }

function AgentRoute() {
  const tx = useText()
  return <main className="route-column reading-surface" aria-label={tx('Agent')}><header className="route-header"><div><p className="section-kicker">{tx('Runtime')}</p><h1 tabIndex={-1}>{tx('Agent')}</h1></div></header><div className="route-empty"><Bot size={18} /><strong>{tx('Agent conversation')}</strong></div></main>
}

export function RouteLoading() {
  return <main className="route-column reading-surface" aria-busy="true" />
}

type OpenSession = (workspace: string, sessionId: string) => void

function RouteBody({ route, state, client, onOpenSession }: { route: ActivityRoute; state: WorkbenchState; client?: WorkbenchBridgeClient; onOpenSession?: OpenSession }) {
  if (route === 'agent') return <AgentRoute />
  if (route === 'runs') return <LazyRunControlCenter state={state} client={client} />
  if (route === 'workspace') return <LazyWorkspaceRoute state={state} client={client} />
  if (route === 'knowledge') return <LazyKnowledgeRoute client={client} />
  if (route === 'schedules') return <LazySchedulesRoute state={state} client={client} onOpenSession={onOpenSession} />
  if (route === 'search') return <LazySearchRoute state={state} client={client} />
  if (route === 'changes') return <LazyChangesRoute state={state} client={client} />
  if (route === 'jobs') return <LazyBackgroundJobsRoute state={state} client={client} />
  if (route === 'operations') return <LazyOperationsRoute state={state} client={client} />
  return <LazySettingsRoute state={state} />
}

export function RouteOutlet({ route, state, store: _store, client, onOpenSession }: { route: ActivityRoute; state: WorkbenchState; store: WorkbenchStore; client?: WorkbenchBridgeClient; onOpenSession?: OpenSession }) {
  return <Suspense fallback={<RouteLoading />}><RouteBody route={route} state={state} client={client} onOpenSession={onOpenSession} /></Suspense>
}

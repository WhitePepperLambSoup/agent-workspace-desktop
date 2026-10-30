import { lazy, type LazyExoticComponent } from 'react'

// Routes other than the conversation load on demand so the first paint only
// parses the agent workbench. preloadRoutes() warms them once the app is idle.
const loaders = {
  settings: () => import('../settings/SettingsRoute').then((module) => ({ default: module.SettingsRoute })),
  runs: () => import('../runs/RunControlCenter').then((module) => ({ default: module.RunControlCenter })),
  // The route alone; its three.js scene loads when the studio opens.
  studio: () => import('../studio/StudioRoute').then((module) => ({ default: module.StudioRoute })),
  workspace: () => import('../workspace/WorkspaceRoute').then((module) => ({ default: module.WorkspaceRoute })),
  knowledge: () => import('../knowledge/KnowledgeRoute').then((module) => ({ default: module.KnowledgeRoute })),
  schedules: () => import('../schedules/SchedulesRoute').then((module) => ({ default: module.SchedulesRoute })),
  search: () => import('../search/SearchRoute').then((module) => ({ default: module.SearchRoute })),
  changes: () => import('../changes/ChangesRoute').then((module) => ({ default: module.ChangesRoute })),
  jobs: () => import('../background/BackgroundJobsRoute').then((module) => ({ default: module.BackgroundJobsRoute })),
  operations: () => import('../operations/OperationsRoute').then((module) => ({ default: module.OperationsRoute })),
}

type RouteKey = keyof typeof loaders
type RouteModule<K extends RouteKey> = Awaited<ReturnType<(typeof loaders)[K]>>

const loaded: { [K in RouteKey]?: RouteModule<K> } = {}

function load<K extends RouteKey>(key: K): Promise<RouteModule<K>> {
  return (loaders[key]() as Promise<RouteModule<K>>).then((module) => {
    loaded[key] = module as (typeof loaded)[K]
    return module
  })
}

/**
 * A lazy route that renders at once when preloadRoutes() already fetched it. React.lazy otherwise
 * suspends on every route's first render, even with the module cached, and the route surface is
 * swapped for an empty placeholder for a frame.
 */
function preloadable<K extends RouteKey>(key: K): LazyExoticComponent<RouteModule<K>['default']> {
  return lazy((): Promise<RouteModule<K>> => {
    const module = loaded[key]
    if (module) {
      // A thenable that settles synchronously: React reads the module without suspending.
      const settled = { then: (resolve: (value: RouteModule<K>) => void) => resolve(module) }
      return settled as unknown as Promise<RouteModule<K>>
    }
    return load(key)
  })
}

export const LazySettingsRoute = preloadable('settings')
export const LazyRunControlCenter = preloadable('runs')
export const LazyStudioRoute = preloadable('studio')
export const LazyWorkspaceRoute = preloadable('workspace')
export const LazyKnowledgeRoute = preloadable('knowledge')
export const LazySchedulesRoute = preloadable('schedules')
export const LazySearchRoute = preloadable('search')
export const LazyChangesRoute = preloadable('changes')
export const LazyBackgroundJobsRoute = preloadable('jobs')
export const LazyOperationsRoute = preloadable('operations')

let preloaded = false

export function preloadRoutes(): void {
  if (preloaded) return
  preloaded = true
  for (const key of Object.keys(loaders) as RouteKey[]) void load(key).catch(() => undefined)
}

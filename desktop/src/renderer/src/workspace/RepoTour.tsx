import { FileText, Loader2, Map as MapIcon, RefreshCw, Wand2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import type { WorkbenchBridgeClient } from '../bridge/client'
import { useOptionalI18n } from '../i18n/I18nProvider'
import type { MessageKey } from '../i18n/messages'
import { SafeMarkdown } from '../markdown/SafeMarkdown'
import { layoutModules, type MapEdge, type MapModule, NODE_HEIGHT, NODE_WIDTH, shortNames } from './module-layout'

export type TourClient = Pick<WorkbenchBridgeClient, 'tourMap' | 'tourGet' | 'writeTour'>

interface RepoMap {
  files: number
  languages?: Record<string, number>
  modules: MapModule[]
  edges: MapEdge[]
  cycles: string[][]
  externals: Array<{ name: string; uses: number }>
  entryPoints?: string[]
}

interface Tour {
  text: string | null
  path: string
}

const ERRORS: Record<string, MessageKey> = {
  tour_no_code: 'tour.error.noCode',
  tour_timeout: 'tour.error.timeout',
  provider_unconfigured: 'review.aiNoProvider',
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

/** The Workspace page's Tour tab: the repository's modules and how they use one another, and a
 * tour of it written by the model. */
export function RepoTour({ client, onOpenFile }: { client: TourClient; onOpenFile?: (path: string) => void }) {
  const { locale, t } = useOptionalI18n()
  const [map, setMap] = useState<RepoMap | null>(null)
  const [tour, setTour] = useState<Tour | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [writing, setWriting] = useState(false)
  const [error, setError] = useState<MessageKey | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [mapped, written] = await Promise.all([client.tourMap(), client.tourGet()])
      setMap(record(mapped.payload).map as RepoMap)
      setTour(record(written.payload).tour as Tour)
    } catch {
      setError('tour.error.failed')
    } finally {
      setLoading(false)
    }
  }, [client])

  useEffect(() => {
    void load()
  }, [load])

  const write = async (): Promise<void> => {
    setWriting(true)
    setError(null)
    try {
      setTour(record((await client.writeTour(locale)).payload).tour as Tour)
    } catch (reason) {
      setError(ERRORS[reason instanceof Error ? reason.message : String(reason)] ?? 'tour.error.failed')
    } finally {
      setWriting(false)
    }
  }

  const layout = useMemo(() => (map ? layoutModules(map.modules, map.edges) : null), [map])
  const names = useMemo(() => shortNames(map?.modules.map((module) => module.id) ?? []), [map])
  const inCycle = useMemo(() => new Set(map?.cycles.flat() ?? []), [map])
  const module = map?.modules.find((item) => item.id === selected) ?? null
  const maxWeight = Math.max(1, ...(map?.edges.map((edge) => edge.weight) ?? [1]))

  return (
    <section className="repo-tour" aria-label={t('tour.tab')}>
      <header className="repo-tour-head">
        <MapIcon size={15} aria-hidden="true" />
        {map ? (
          <span>
            {t('tour.summary', { files: map.files, modules: map.modules.length })}
            {map.languages ? ` · ${Object.entries(map.languages).slice(0, 4).map(([language, count]) => `${language} ${count}`).join(', ')}` : ''}
          </span>
        ) : <span>{t('tour.loading')}</span>}
        <button type="button" className="icon-button" aria-label={t('changes.refresh')} onClick={() => void load()} disabled={loading}>
          <RefreshCw size={13} className={loading ? 'is-spinning' : undefined} />
        </button>
      </header>
      {error ? <p className="route-error" role="status">{t(error)}</p> : null}

      {map && layout && map.modules.length > 0 ? (
        <div className="repo-tour-map">
          <div className="repo-tour-graph">
            <svg
              role="group"
              aria-label={t('tour.graph')}
              viewBox={`0 0 ${layout.width} ${layout.height}`}
              width={layout.width}
              height={layout.height}
              onClick={() => setSelected(null)}
            >
              <defs>
                <marker id="repo-tour-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M0,0 L8,4 L0,8 z" className="repo-tour-arrowhead" />
                </marker>
              </defs>
              {map.edges.map((edge) => {
                const from = layout.placed.get(edge.from)
                const to = layout.placed.get(edge.to)
                if (!from || !to) return null
                const active = selected === null || selected === edge.from || selected === edge.to
                // A use that closes a circle points back to the left: from below, dashed.
                const back = layout.backward.has(`${edge.from}->${edge.to}`)
                const y1 = from.y + NODE_HEIGHT / 2
                const y2 = to.y + NODE_HEIGHT / 2
                const x1 = back ? from.x + NODE_WIDTH / 2 : from.x + NODE_WIDTH
                const x2 = back ? to.x + NODE_WIDTH / 2 : to.x
                const bend = Math.max(30, Math.abs(x2 - x1) / 2)
                const path = back
                  ? `M${x1},${from.y + NODE_HEIGHT} C${x1},${from.y + NODE_HEIGHT + 40} ${x2},${to.y + NODE_HEIGHT + 40} ${x2},${to.y + NODE_HEIGHT}`
                  : `M${x1},${y1} C${x1 + bend},${y1} ${x2 - bend},${y2} ${x2},${y2}`
                return (
                  <path
                    key={`${edge.from}->${edge.to}`}
                    d={path}
                    className={`repo-tour-edge${back ? ' is-back' : ''}${active ? '' : ' is-faded'}${selected && active ? ' is-active' : ''}`}
                    strokeWidth={1 + 2.5 * Math.log1p(edge.weight) / Math.log1p(maxWeight)}
                    markerEnd="url(#repo-tour-arrow)"
                  >
                    <title>{`${edge.from} → ${edge.to} (${edge.weight})`}</title>
                  </path>
                )
              })}
              {map.modules.map((item) => {
                const place = layout.placed.get(item.id)!
                const faded = selected !== null && selected !== item.id && !map.edges.some((edge) => (edge.from === selected && edge.to === item.id) || (edge.to === selected && edge.from === item.id))
                return (
                  <g
                    key={item.id}
                    transform={`translate(${place.x},${place.y})`}
                    className={`repo-tour-node${selected === item.id ? ' is-selected' : ''}${faded ? ' is-faded' : ''}${inCycle.has(item.id) ? ' in-cycle' : ''}`}
                    role="button"
                    tabIndex={0}
                    aria-label={item.id}
                    aria-pressed={selected === item.id}
                    onClick={(event) => {
                      event.stopPropagation()
                      setSelected(item.id === selected ? null : item.id)
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        setSelected(item.id === selected ? null : item.id)
                      }
                    }}
                  >
                    <rect width={NODE_WIDTH} height={NODE_HEIGHT} rx={6} />
                    <text x={10} y={NODE_HEIGHT / 2 + 4}>{names.get(item.id)}</text>
                    <text x={NODE_WIDTH - 8} y={NODE_HEIGHT / 2 + 4} textAnchor="end" className="repo-tour-count">{item.files}</text>
                    <title>{item.id}</title>
                  </g>
                )
              })}
            </svg>
          </div>
          <aside className="repo-tour-side">
            {module ? (
              <>
                <h3>{module.id}</h3>
                <p className="route-note">{t('tour.moduleFacts', { files: module.files, lines: module.lines })}</p>
                <h4>{t('tour.usedBy')}</h4>
                <ul>{map.edges.filter((edge) => edge.to === module.id).map((edge) => <li key={edge.from}><button type="button" className="text-btn" onClick={() => setSelected(edge.from)}>{edge.from}</button> <small>{edge.weight}</small></li>)}</ul>
                <h4>{t('tour.uses')}</h4>
                <ul>{map.edges.filter((edge) => edge.from === module.id).map((edge) => <li key={edge.to}><button type="button" className="text-btn" onClick={() => setSelected(edge.to)}>{edge.to}</button> <small>{edge.weight}</small></li>)}</ul>
                <h4>{t('tour.startWith')}</h4>
                <ul>{module.keyFiles.map((file) => <li key={file}><button type="button" className="text-btn" disabled={!onOpenFile} onClick={() => onOpenFile?.(file)}>{file}</button></li>)}</ul>
              </>
            ) : (
              <>
                <p className="route-note">{t('tour.pickModule')}</p>
                {map.cycles.length > 0 ? <p className="repo-tour-cycles">{t('tour.cycles', { count: map.cycles.length })}</p> : null}
                {map.externals.length > 0 ? (
                  <>
                    <h4>{t('tour.externals')}</h4>
                    <p className="repo-tour-externals">{map.externals.slice(0, 15).map((item) => item.name).join(', ')}</p>
                  </>
                ) : null}
              </>
            )}
          </aside>
        </div>
      ) : map && map.modules.length === 0 ? <p className="route-note">{t('tour.noCode')}</p> : null}

      <div className="repo-tour-text">
        <div className="specs-actions">
          <button type="button" className={tour?.text ? 'secondary-button' : 'primary-button'} disabled={writing || !map?.modules.length} onClick={() => void write()}>
            {writing ? <Loader2 size={13} className="spin-animation" /> : <Wand2 size={13} aria-hidden="true" />}
            {writing ? t('tour.writing') : tour?.text ? t('tour.rewrite') : t('tour.write')}
          </button>
          {tour?.text && onOpenFile ? (
            <button type="button" className="secondary-button" onClick={() => onOpenFile(tour.path)}>
              <FileText size={13} aria-hidden="true" />{t('specs.edit')}
            </button>
          ) : null}
        </div>
        {tour?.text ? <article className="specs-document"><SafeMarkdown source={tour.text} /></article> : <p className="route-note">{t('tour.intro')}</p>}
      </div>
    </section>
  )
}

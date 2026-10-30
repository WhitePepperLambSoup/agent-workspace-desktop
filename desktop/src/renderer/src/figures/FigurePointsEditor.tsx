import { Lock, Redo2, Save, Undo2, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { WorkbenchBridgeClient } from '../bridge/client'
import { useOptionalI18n } from '../i18n/I18nProvider'
import { editsOf, fromPixel, handlesOf, roundToAxis, toPixel, type FigurePoints, type Handle } from './point-geometry'
import './figures.css'

export type FiguresClient = Pick<WorkbenchBridgeClient, 'figurePoints' | 'correctFigure'>

type LockMode = 'free' | 'x' | 'y'
type Positions = Record<string, { x: number; y: number; missing: boolean }>

interface FigurePointsEditorProps {
  client: FiguresClient
  /** The figure (a PNG of the open folder). */
  path: string
  onClose(): void
}

function snapshot(handles: readonly Handle[]): Positions {
  return Object.fromEntries(handles.map((handle) => [handle.key, { x: handle.x, y: handle.y, missing: handle.missing }]))
}

export function FigurePointsEditor({ client, path, onClose }: FigurePointsEditorProps) {
  const { t } = useOptionalI18n()
  const [points, setPoints] = useState<FigurePoints | null>(null)
  const [image, setImage] = useState<string | null>(null)
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)
  const [handles, setHandles] = useState<Handle[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [lock, setLock] = useState<LockMode>('free')
  const [past, setPast] = useState<Positions[]>([])
  const [future, setFuture] = useState<Positions[]>([])
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ kind: 'error' | 'info'; text: string } | null>(null)
  const [band, setBand] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const svg = useRef<SVGSVGElement>(null)
  const drag = useRef<{ startX: number; startY: number; start: Positions; moved: boolean } | null>(null)
  const dialog = useRef<HTMLDivElement>(null)

  const load = useCallback(async (): Promise<void> => {
    setMessage(null)
    try {
      const response = await client.figurePoints(path)
      const payload = response.payload as unknown as FigurePoints & { available: boolean }
      if (!payload.available) {
        setMessage({ kind: 'error', text: t('figures.editor.noMap') })
        return
      }
      setPoints(payload)
      const found = handlesOf(payload)
      setHandles(found)
      setSelected(new Set())
      setPast([])
      setFuture([])
      if (found.length === 0) setMessage({ kind: 'info', text: t('figures.editor.nothingEditable') })
      const picture = await window.agentWorkspace?.readFigure?.(payload.image ?? path)
      setImage(picture ?? null)
    } catch {
      setMessage({ kind: 'error', text: t('figures.editor.failed') })
    }
  }, [client, path, t])

  useEffect(() => { void load() }, [load])
  useEffect(() => { dialog.current?.focus() }, [])

  const record = (before: Positions): void => {
    setPast((list) => [...list.slice(-99), before])
    setFuture([])
  }

  const apply = (positions: Positions): void => {
    setHandles((list) => list.map((handle) => positions[handle.key] ? { ...handle, ...positions[handle.key] } : handle))
  }

  const undo = (): void => {
    const previous = past.at(-1)
    if (!previous) return
    setFuture((list) => [snapshot(handles), ...list])
    setPast((list) => list.slice(0, -1))
    apply(previous)
  }

  const redo = (): void => {
    const next = future[0]
    if (!next) return
    setPast((list) => [...list, snapshot(handles)])
    setFuture((list) => list.slice(1))
    apply(next)
  }

  const imagePoint = (event: { clientX: number; clientY: number }): [number, number] => {
    const box = svg.current?.getBoundingClientRect()
    if (!box || !size) return [0, 0]
    return [((event.clientX - box.left) * size.width) / box.width, ((event.clientY - box.top) * size.height) / box.height]
  }

  /** Move the given handles by an image-pixel offset from their positions in ``from``. */
  const moveBy = (from: Positions, keys: Set<string>, dx: number, dy: number): void => {
    if (!points || !size) return
    setHandles((list) => list.map((handle) => {
      if (!keys.has(handle.key)) return handle
      const geometry = points.axes[handle.set.axes]
      const start = from[handle.key]
      if (!geometry || !start) return handle
      const [px, py] = toPixel(geometry, handle.set, start.x, start.y, size.width, size.height)
      const [nx, ny] = fromPixel(geometry, handle.set, px + dx, py + dy, size.width, size.height)
      const x = handle.editX && lock !== 'y' ? roundToAxis(nx, geometry.xlim, handle.set.x.scale) : start.x
      const y = handle.editY && lock !== 'x' ? roundToAxis(ny, geometry.ylim, handle.set.y.scale) : start.y
      return { ...handle, x, y, missing: false }
    }))
  }

  const onPointerDownHandle = (event: React.PointerEvent, key: string): void => {
    event.stopPropagation()
    const next = event.shiftKey ? new Set(selected) : selected.has(key) ? new Set(selected) : new Set<string>()
    next.add(key)
    setSelected(next)
    const [x, y] = imagePoint(event)
    drag.current = { startX: x, startY: y, start: snapshot(handles), moved: false }
    ;(event.target as Element).setPointerCapture?.(event.pointerId)
  }

  const onPointerDownStage = (event: React.PointerEvent): void => {
    const [x, y] = imagePoint(event)
    if (!event.shiftKey) setSelected(new Set())
    setBand({ x0: x, y0: y, x1: x, y1: y })
  }

  const onPointerMove = (event: React.PointerEvent): void => {
    const [x, y] = imagePoint(event)
    if (drag.current) {
      drag.current.moved = true
      moveBy(drag.current.start, selected, x - drag.current.startX, y - drag.current.startY)
    } else if (band) {
      setBand({ ...band, x1: x, y1: y })
    }
  }

  const onPointerUp = (): void => {
    if (drag.current?.moved) record(drag.current.start)
    drag.current = null
    if (band && points && size) {
      const [left, right] = [Math.min(band.x0, band.x1), Math.max(band.x0, band.x1)]
      const [top, bottom] = [Math.min(band.y0, band.y1), Math.max(band.y0, band.y1)]
      if (right - left > 2 || bottom - top > 2) {
        const inside = handles.filter((handle) => {
          const geometry = points.axes[handle.set.axes]
          if (!geometry) return false
          const [px, py] = toPixel(geometry, handle.set, handle.x, handle.y, size.width, size.height)
          return px >= left && px <= right && py >= top && py <= bottom
        })
        setSelected((current) => new Set([...current, ...inside.map((handle) => handle.key)]))
      }
    }
    setBand(null)
  }

  const nudge = (dx: number, dy: number): void => {
    if (selected.size === 0) return
    const before = snapshot(handles)
    moveBy(before, selected, dx, dy)
    record(before)
  }

  const setMissing = (): void => {
    if (selected.size === 0) return
    record(snapshot(handles))
    setHandles((list) => list.map((handle) => selected.has(handle.key) ? { ...handle, x: handle.x0, y: handle.y0, missing: true } : handle))
  }

  const setExact = (key: string, axis: 'x' | 'y', text: string): void => {
    const value = Number(text)
    if (!Number.isFinite(value)) return
    record(snapshot(handles))
    setHandles((list) => list.map((handle) => handle.key === key ? { ...handle, [axis]: value, missing: false } : handle))
  }

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if ((event.target as HTMLElement).tagName === 'INPUT') return
    const step = event.shiftKey ? 10 : 1
    const keys: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }
    const move = keys[event.key]
    if (move) {
      event.preventDefault()
      nudge(move[0], move[1])
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault()
      if (event.shiftKey) redo()
      else undo()
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
      event.preventDefault()
      redo()
    } else if (event.key === 'Delete') {
      setMissing()
    } else if (event.key === 'Escape') {
      if (selected.size) setSelected(new Set())
      else onClose()
    }
  }

  const edits = useMemo(() => editsOf(handles), [handles])

  const save = async (): Promise<void> => {
    if (!points || edits.length === 0) return
    setBusy(true)
    setMessage(null)
    try {
      const response = await client.correctFigure(points.points, edits, note.trim())
      const result = response.payload as { ok?: boolean; error?: string; corrected?: string; log?: string; changed?: number; rerun?: { ok: boolean; output: string } }
      if (!result.ok) {
        setMessage({ kind: 'error', text: t('figures.editor.saveFailed', { reason: result.error ?? '' }) })
        return
      }
      await load()
      const saved = t('figures.editor.saved', { count: result.changed ?? edits.length, corrected: result.corrected ?? '', log: result.log ?? '' })
      if (result.rerun && !result.rerun.ok) setMessage({ kind: 'error', text: `${saved} ${t('figures.editor.rerunFailed', { output: result.rerun.output.slice(-400) })}` })
      else setMessage({ kind: 'info', text: result.rerun ? `${saved} ${t('figures.editor.redrawn')}` : saved })
      setNote('')
    } catch {
      setMessage({ kind: 'error', text: t('figures.editor.saveFailed', { reason: '' }) })
    } finally {
      setBusy(false)
    }
  }

  const single = selected.size === 1 ? handles.find((handle) => selected.has(handle.key)) : undefined

  return (
    <div className="figure-editor-backdrop">
      <div ref={dialog} className="figure-editor" role="dialog" aria-modal="true" aria-label={t('figures.editor.title', { path })} tabIndex={-1} onKeyDown={onKeyDown}>
        <header className="figure-editor-header">
          <strong>{t('figures.editor.title', { path })}</strong>
          <span className="figure-editor-spacer" />
          <button type="button" className="toolbar-action-btn" disabled={past.length === 0} aria-label={t('figures.editor.undo')} title={t('figures.editor.undo')} onClick={undo}><Undo2 size={13} /></button>
          <button type="button" className="toolbar-action-btn" disabled={future.length === 0} aria-label={t('figures.editor.redo')} title={t('figures.editor.redo')} onClick={redo}><Redo2 size={13} /></button>
          <label className="figure-editor-lock">
            <Lock size={12} aria-hidden="true" />
            <select aria-label={t('figures.editor.lock')} value={lock} onChange={(event) => setLock(event.target.value as LockMode)}>
              <option value="free">{t('figures.editor.lockFree')}</option>
              <option value="y">{t('figures.editor.lockY')}</option>
              <option value="x">{t('figures.editor.lockX')}</option>
            </select>
          </label>
          <button type="button" className="toolbar-action-btn" disabled={selected.size === 0} onClick={setMissing}>{t('figures.editor.missing')}</button>
          <button type="button" className="toolbar-action-btn" aria-label={t('figures.editor.close')} title={t('figures.editor.close')} onClick={onClose}><X size={13} /></button>
        </header>
        <p className="figure-editor-hint">{t('figures.editor.hint')}</p>
        <div className="figure-editor-stage">
          {image ? (
            <div className="figure-editor-canvas">
              <img src={image} alt={path} draggable={false} onLoad={(event) => setSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} />
              {size && points ? (
                <svg
                  ref={svg}
                  viewBox={`0 0 ${size.width} ${size.height}`}
                  role="group"
                  aria-label={t('figures.editor.points', { count: handles.length })}
                  onPointerDown={onPointerDownStage}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                >
                  {handles.map((handle) => {
                    const geometry = points.axes[handle.set.axes]
                    if (!geometry) return null
                    const [px, py] = toPixel(geometry, handle.set, handle.x, handle.y, size.width, size.height)
                    const moved = handle.x !== handle.x0 || handle.y !== handle.y0
                    const [ox, oy] = moved ? toPixel(geometry, handle.set, handle.x0, handle.y0, size.width, size.height) : [px, py]
                    const radius = Math.max(5, size.width / 160)
                    return (
                      <g key={handle.key}>
                        {moved ? <line x1={ox} y1={oy} x2={px} y2={py} className="figure-editor-trail" /> : null}
                        <circle
                          cx={px}
                          cy={py}
                          r={radius}
                          data-key={handle.key}
                          data-testid="figure-point"
                          className={`figure-editor-handle${selected.has(handle.key) ? ' selected' : ''}${moved ? ' moved' : ''}${handle.missing ? ' missing' : ''}`}
                          aria-label={t('figures.editor.point', { row: handle.row + 1, x: String(handle.x), y: String(handle.y) })}
                          onPointerDown={(event) => onPointerDownHandle(event, handle.key)}
                        />
                      </g>
                    )
                  })}
                  {band ? (
                    <rect
                      x={Math.min(band.x0, band.x1)}
                      y={Math.min(band.y0, band.y1)}
                      width={Math.abs(band.x1 - band.x0)}
                      height={Math.abs(band.y1 - band.y0)}
                      className="figure-editor-band"
                    />
                  ) : null}
                </svg>
              ) : null}
            </div>
          ) : null}
        </div>
        {single ? (
          <div className="figure-editor-exact">
            <span>{t('figures.editor.row', { row: single.row + 1 })}</span>
            {single.editX ? (
              <label>{single.set.x.column}<input key={`x:${single.key}:${single.x}`} type="number" step="any" defaultValue={single.x} onBlur={(event) => setExact(single.key, 'x', event.target.value)} /></label>
            ) : null}
            {single.editY ? (
              <label>{single.set.y.column}<input key={`y:${single.key}:${single.y}`} type="number" step="any" defaultValue={single.y} onBlur={(event) => setExact(single.key, 'y', event.target.value)} /></label>
            ) : null}
          </div>
        ) : null}
        <footer className="figure-editor-footer">
          <span>{t('figures.editor.pending', { count: edits.length })}</span>
          <input type="text" value={note} maxLength={300} placeholder={t('figures.editor.note')} aria-label={t('figures.editor.note')} onChange={(event) => setNote(event.target.value)} />
          <button type="button" className="toolbar-action-btn primary" disabled={busy || edits.length === 0 || !points?.environment} onClick={() => void save()}>
            <Save size={13} /><span>{busy ? t('figures.editor.saving') : t('figures.editor.save')}</span>
          </button>
        </footer>
        {points && !points.environment ? <p className="route-error" role="status">{t('figures.editor.noEnvironment')}</p> : null}
        {message ? <p className={message.kind === 'error' ? 'route-error' : 'figure-editor-notice'} role="status">{message.text}</p> : null}
      </div>
    </div>
  )
}

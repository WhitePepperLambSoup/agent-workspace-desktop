import { Maximize2, Minus, Plus } from 'lucide-react'
import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

import { useOptionalI18n } from '../i18n/I18nProvider'

export interface PdfHighlight {
  page: number
  x: number
  y: number
  width: number
  height: number
  /** Changes for each new request, so the same place can be shown twice. */
  serial: number
}

interface PdfViewProps {
  /** A PDF of the open folder. */
  path: string
  /** Changes when the file was written again (its digest). */
  version: string
  highlight: PdfHighlight | null
  /** Double click: the point in PDF points from the page's top left. */
  onInverse?(page: number, x: number, y: number): void
}

interface PageSize { width: number; height: number }

const MAX_PAGES = 2000
let workerReady = false

export function ensurePdfWorker(): void {
  if (workerReady) return
  pdfjs.GlobalWorkerOptions.workerPort = new Worker(workerUrl, { type: 'module' })
  workerReady = true
}

export function PdfView({ path, version, highlight, onInverse }: PdfViewProps) {
  const { t } = useOptionalI18n()
  const scroller = useRef<HTMLDivElement>(null)
  const [pdf, setPdf] = useState<pdfjs.PDFDocumentProxy | null>(null)
  const [sizes, setSizes] = useState<PageSize[]>([])
  const [failed, setFailed] = useState(false)
  const [zoom, setZoom] = useState<'fit' | number>('fit')
  const [width, setWidth] = useState(0)
  const [current, setCurrent] = useState(1)
  const [flash, setFlash] = useState<PdfHighlight | null>(null)
  // Where the reader was, kept across a recompile.
  const scrollRatio = useRef(0)

  useEffect(() => {
    let cancelled = false
    let loaded: pdfjs.PDFDocumentProxy | null = null
    let adopted = false
    const discard = (): void => {
      if (adopted || !loaded) return
      void loaded.loadingTask.destroy()
      loaded = null
    }
    setFailed(false)
    void (async () => {
      try {
        const data = await window.agentWorkspace?.readPdf?.(path)
        if (!data || cancelled) {
          if (!cancelled) {
            setFailed(true)
            setPdf(null)
            setSizes([])
          }
          return
        }
        ensurePdfWorker()
        loaded = await pdfjs.getDocument({ data, useWorkerFetch: false, disableAutoFetch: true }).promise
        const count = Math.min(loaded.numPages, MAX_PAGES)
        const measured: PageSize[] = []
        for (let number = 1; number <= count && !cancelled; number++) {
          const viewport = (await loaded.getPage(number)).getViewport({ scale: 1 })
          measured.push({ width: viewport.width, height: viewport.height })
        }
        if (cancelled) {
          discard()
          return
        }
        const element = scroller.current
        if (element && element.scrollHeight > element.clientHeight) {
          scrollRatio.current = element.scrollTop / (element.scrollHeight - element.clientHeight)
        }
        adopted = true
        setPdf(loaded)
        setSizes(measured)
      } catch {
        discard()
        if (!cancelled) {
          setFailed(true)
          setPdf(null)
          setSizes([])
        }
      }
    })()
    return () => {
      cancelled = true
      // A newer version took over before this one was shown.
      discard()
    }
  }, [path, version])

  useEffect(() => () => { void pdf?.loadingTask.destroy() }, [pdf])

  useLayoutEffect(() => {
    const element = scroller.current
    if (!element) return undefined
    const observer = new ResizeObserver(() => setWidth(element.clientWidth))
    observer.observe(element)
    setWidth(element.clientWidth)
    return () => observer.disconnect()
  }, [])

  const firstWidth = sizes[0]?.width ?? 595
  const scale = zoom === 'fit' ? Math.max(0.25, (width - 32) / firstWidth) : zoom

  // Back to where the reader was once the new pages have their size.
  useLayoutEffect(() => {
    const element = scroller.current
    if (!element || sizes.length === 0) return
    element.scrollTop = scrollRatio.current * Math.max(0, element.scrollHeight - element.clientHeight)
  }, [sizes])

  useEffect(() => {
    if (!highlight || !pdf) return
    const element = scroller.current
    const page = element?.querySelector<HTMLElement>(`[data-page="${highlight.page}"]`)
    if (element && page) {
      element.scrollTop = Math.max(0, page.offsetTop + highlight.y * scale - element.clientHeight / 3)
    }
    setFlash(highlight)
    const timer = window.setTimeout(() => setFlash(null), 2500)
    return () => window.clearTimeout(timer)
  }, [highlight, pdf, scale])

  const onScroll = useCallback(() => {
    const element = scroller.current
    if (!element) return
    if (element.scrollHeight > element.clientHeight) {
      scrollRatio.current = element.scrollTop / (element.scrollHeight - element.clientHeight)
    }
    const middle = element.scrollTop + element.clientHeight / 2
    const pages = element.querySelectorAll<HTMLElement>('[data-page]')
    for (const page of pages) {
      if (page.offsetTop + page.offsetHeight >= middle) {
        setCurrent(Number(page.dataset.page))
        break
      }
    }
  }, [])

  const step = (factor: number): void => setZoom(Math.min(4, Math.max(0.25, Math.round(scale * factor * 100) / 100)))

  return (
    <div className="latex-pdf">
      <div className="latex-pdf-toolbar" role="toolbar" aria-label={t('latex.pdf.toolbar')}>
        <span className="latex-pdf-page">{sizes.length > 0 ? t('latex.pdf.page', { page: current, pages: sizes.length }) : ''}</span>
        <button type="button" className="toolbar-action-btn" aria-label={t('latex.pdf.zoomOut')} title={t('latex.pdf.zoomOut')} onClick={() => step(1 / 1.2)}><Minus size={13} /></button>
        <span className="latex-pdf-zoom">{Math.round(scale * 100)}%</span>
        <button type="button" className="toolbar-action-btn" aria-label={t('latex.pdf.zoomIn')} title={t('latex.pdf.zoomIn')} onClick={() => step(1.2)}><Plus size={13} /></button>
        <button type="button" className={`toolbar-action-btn ${zoom === 'fit' ? 'active' : ''}`} aria-pressed={zoom === 'fit'} aria-label={t('latex.pdf.fitWidth')} title={t('latex.pdf.fitWidth')} onClick={() => setZoom('fit')}><Maximize2 size={13} /></button>
      </div>
      <div ref={scroller} className="latex-pdf-pages" onScroll={onScroll} aria-label={t('latex.pdf.label', { path })} role="document">
        {failed ? <p className="latex-pdf-empty">{t('latex.pdf.unavailable')}</p> : null}
        {pdf ? sizes.map((size, index) => (
          <PdfPage
            key={index}
            pdf={pdf}
            number={index + 1}
            size={size}
            scale={scale}
            flash={flash?.page === index + 1 ? flash : null}
            onInverse={onInverse}
            hint={t('latex.pdf.inverseHint')}
          />
        )) : null}
      </div>
    </div>
  )
}

/** The place a forward search found, at least big enough to see, centred on it. */
function FlashMark({ flash, scale }: { flash: PdfHighlight; scale: number }) {
  const width = flash.width * scale
  const height = flash.height * scale
  const shownWidth = Math.max(width, 24) + 8
  const shownHeight = Math.max(height, 12) + 6
  return (
    <div
      className="latex-pdf-flash"
      data-testid="latex-pdf-flash"
      style={{
        left: flash.x * scale + width / 2 - shownWidth / 2,
        top: flash.y * scale + height / 2 - shownHeight / 2,
        width: shownWidth,
        height: shownHeight,
      }}
    />
  )
}

interface PdfPageProps {
  pdf: pdfjs.PDFDocumentProxy
  number: number
  size: PageSize
  scale: number
  flash: PdfHighlight | null
  hint: string
  onInverse?(page: number, x: number, y: number): void
}

function PdfPage({ pdf, number, size, scale, flash, hint, onInverse }: PdfPageProps) {
  const holder = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const element = holder.current
    if (!element) return undefined
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setVisible(true)
    }, { rootMargin: '600px 0px' })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!visible || !canvas.current) return undefined
    let task: pdfjs.RenderTask | null = null
    let cancelled = false
    void (async () => {
      try {
        const page = await pdf.getPage(number)
        if (cancelled || !canvas.current) return
        const ratio = window.devicePixelRatio || 1
        const viewport = page.getViewport({ scale: scale * ratio })
        const target = canvas.current
        target.width = Math.floor(viewport.width)
        target.height = Math.floor(viewport.height)
        task = page.render({ canvas: target, viewport })
        await task.promise
      } catch {
        // A render replaced by a newer one (zoom, recompile) is cancelled.
      }
    })()
    return () => {
      cancelled = true
      task?.cancel()
    }
  }, [pdf, number, scale, visible])

  return (
    <div
      ref={holder}
      className="latex-pdf-page-frame"
      data-page={number}
      title={onInverse ? hint : undefined}
      style={{ width: Math.round(size.width * scale), height: Math.round(size.height * scale) }}
      onDoubleClick={(event) => {
        if (!onInverse) return
        const box = event.currentTarget.getBoundingClientRect()
        onInverse(number, (event.clientX - box.left) / scale, (event.clientY - box.top) / scale)
      }}
    >
      <canvas ref={canvas} className="latex-pdf-canvas" aria-hidden="true" />
      {flash ? <FlashMark flash={flash} scale={scale} /> : null}
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'

import type { ResolvedAppearance } from '../design/appearance'
import { createLiquidRenderer } from './liquid-shader'

export interface LiquidRenderer {
  resize(width: number, height: number): void
  render(seconds: number): void
  dispose(): void
}

interface ControllerOptions {
  devicePixelRatio: () => number
  requestFrame: (callback: FrameRequestCallback) => number
  cancelFrame: (handle: number) => void
  maxDimension: number
  onFailure?: () => void
}

export interface LiquidBackdropController {
  start(): void
  stop(): void
  resize(): void
  renderOnce(): void
  setVisible(visible: boolean): void
  handleContextLost(): void
  handleContextRestored(): void
  dispose(): void
}

const MAX_BACKING_DIMENSION = 1280
const FRAME_INTERVAL_MS = 1000 / 24

const browserControllerOptions: ControllerOptions = {
  devicePixelRatio: () => window.devicePixelRatio || 1,
  requestFrame: (callback) => window.requestAnimationFrame(callback),
  cancelFrame: (handle) => window.cancelAnimationFrame(handle),
  maxDimension: MAX_BACKING_DIMENSION,
}

export function createLiquidBackdropController(
  canvas: HTMLCanvasElement,
  rendererFactory: () => LiquidRenderer,
  options: ControllerOptions = browserControllerOptions,
): LiquidBackdropController {
  let renderer: LiquidRenderer | null = rendererFactory()
  let frameHandle: number | null = null
  let desiredRunning = false
  let visible = true
  let contextAvailable = true
  let failed = false
  let disposed = false
  let lastFrameTimestamp: number | null = null
  let lastRenderTimestamp: number | null = null
  let elapsedSeconds = 0

  const schedule = (): void => {
    frameHandle = options.requestFrame(frame)
  }
  const canDraw = (): boolean =>
    visible && contextAvailable && renderer !== null && !failed && !disposed
  const canRun = (): boolean => desiredRunning && canDraw()
  const reconcile = (): void => {
    if (canRun()) {
      if (frameHandle === null) schedule()
      return
    }
    lastFrameTimestamp = null
    lastRenderTimestamp = null
    if (frameHandle !== null) {
      options.cancelFrame(frameHandle)
      frameHandle = null
    }
  }
  const frame = (timestamp: number): void => {
    frameHandle = null
    if (!canRun() || !renderer) return
    if (lastFrameTimestamp !== null) elapsedSeconds += Math.max(0, timestamp - lastFrameTimestamp) / 1000
    lastFrameTimestamp = timestamp
    if (lastRenderTimestamp === null || timestamp - lastRenderTimestamp >= FRAME_INTERVAL_MS) {
      lastRenderTimestamp = timestamp
      renderer.render(elapsedSeconds)
    }
    reconcile()
  }
  const stop = (): void => {
    desiredRunning = false
    reconcile()
  }
  const resize = (): void => {
    if (!renderer) return
    const rect = canvas.getBoundingClientRect()
    const pixelRatio = Math.max(1, options.devicePixelRatio())
    const rawWidth = Math.max(1, rect.width * pixelRatio)
    const rawHeight = Math.max(1, rect.height * pixelRatio)
    const capScale = Math.min(1, options.maxDimension / Math.max(rawWidth, rawHeight))
    const width = Math.max(1, Math.floor(rawWidth * capScale))
    const height = Math.max(1, Math.floor(rawHeight * capScale))
    if (canvas.width !== width) canvas.width = width
    if (canvas.height !== height) canvas.height = height
    renderer.resize(width, height)
  }

  return {
    start() {
      desiredRunning = true
      reconcile()
    },
    stop,
    resize,
    renderOnce() {
      if (canDraw()) renderer?.render(elapsedSeconds)
    },
    setVisible(nextVisible) {
      visible = nextVisible
      reconcile()
    },
    handleContextLost() {
      contextAvailable = false
      reconcile()
    },
    handleContextRestored() {
      if (disposed || failed) return
      let replacement: LiquidRenderer | null = null
      try {
        renderer?.dispose()
        renderer = null
        replacement = rendererFactory()
        renderer = replacement
        contextAvailable = true
        resize()
        reconcile()
      } catch {
        try {
          replacement?.dispose()
        } catch {
          // The controller is terminal after a failed restoration.
        }
        renderer = null
        contextAvailable = false
        failed = true
        desiredRunning = false
        reconcile()
        options.onFailure?.()
      }
    },
    dispose() {
      disposed = true
      stop()
      renderer?.dispose()
      renderer = null
    },
  }
}

interface LiquidBackdropProps {
  appearance: ResolvedAppearance
  createRenderer?: (canvas: HTMLCanvasElement) => LiquidRenderer
}

const FALLBACK_COLORS: Record<ResolvedAppearance['palette'], readonly [string, string, string]> = {
  polar: ['#101a24', '#254c63', '#3e3561'],
  verdigris: ['#102329', '#21645d', '#76653b'],
  amethyst: ['#1a172c', '#593d72', '#315e6f'],
  cobalt: ['#101b31', '#2e4f87', '#2d706f'],
  garnet: ['#25161d', '#71313f', '#4b5667'],
}

const DESKTOP_GLOW_COLORS: Record<ResolvedAppearance['palette'], readonly [string, string]> = {
  polar: ['#65e4ff', '#d8abff'],
  verdigris: ['#64efd1', '#efdf9b'],
  amethyst: ['#d39bff', '#76e6e2'],
  cobalt: ['#73b7ff', '#70ecd5'],
  garnet: ['#ffabc6', '#8fdaec'],
}

function paintStaticGlass(
  canvas: HTMLCanvasElement, palette: ResolvedAppearance['palette'], intensity: number,
  desktopTransparent: boolean,
): void {
  const context = canvas.getContext('2d')
  if (!context) return
  const [base, edgeA, edgeB] = FALLBACK_COLORS[palette]
  const width = Math.max(1, canvas.width || 1)
  const height = Math.max(1, canvas.height || 1)
  context.globalAlpha = 1
  context.clearRect(0, 0, width, height)
  if (!desktopTransparent) {
    const gradient = context.createLinearGradient(0, 0, width, height)
    gradient.addColorStop(0, base)
    gradient.addColorStop(Math.min(0.72, 0.35 + intensity * 0.25), edgeA)
    gradient.addColorStop(1, edgeB)
    context.fillStyle = gradient
    context.fillRect(0, 0, width, height)
  }
  // Eight fully overlapping fallback glows still leave over 76% of the desktop.
  context.globalAlpha = desktopTransparent
    ? Math.min(0.033, 0.03 + Math.sqrt(intensity) * 0.003)
    : Math.min(0.22, 0.08 + intensity * 0.08)
  const glowColors = desktopTransparent ? DESKTOP_GLOW_COLORS[palette] : [edgeA, edgeB]
  for (let index = 0; index < 8; index += 1) {
    const x = ((index * 37) % 100) / 100 * width
    const y = ((index * 61) % 100) / 100 * height
    const radius = Math.max(width, height) * (desktopTransparent ? 0.12 + (index % 3) * 0.03 : 0.08 + (index % 3) * 0.025)
    const glow = context.createRadialGradient(x, y, 0, x, y, radius)
    glow.addColorStop(0, glowColors[index % 2]!)
    glow.addColorStop(1, 'transparent')
    context.fillStyle = glow
    context.fillRect(0, 0, width, height)
  }
  context.globalAlpha = 1
}

function resizeStaticGlass(canvas: HTMLCanvasElement): void {
  const rect = canvas.getBoundingClientRect()
  const pixelRatio = Math.max(1, window.devicePixelRatio || 1)
  const rawWidth = Math.max(1, (rect.width || window.innerWidth || 1) * pixelRatio)
  const rawHeight = Math.max(1, (rect.height || window.innerHeight || 1) * pixelRatio)
  const capScale = Math.min(1, MAX_BACKING_DIMENSION / Math.max(rawWidth, rawHeight))
  const width = Math.max(1, Math.floor(rawWidth * capScale))
  const height = Math.max(1, Math.floor(rawHeight * capScale))
  if (canvas.width !== width) canvas.width = width
  if (canvas.height !== height) canvas.height = height
}

export function LiquidBackdrop({ appearance, createRenderer }: LiquidBackdropProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [diagnostic, setDiagnostic] = useState<string | null>(null)
  const [systemReduceMotion, setSystemReduceMotion] = useState(() =>
    typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )
  const animateOptics = appearance.animateOptics && !systemReduceMotion
  const renderedColorMode = appearance.colorMode === 'system'
    ? (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
    : appearance.colorMode

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = (event: MediaQueryListEvent): void => setSystemReduceMotion(event.matches)
    setSystemReduceMotion(query.matches)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || appearance.effectiveMode !== 'liquid') return
    if (diagnostic) {
      const resize = (): void => {
        resizeStaticGlass(canvas)
        paintStaticGlass(canvas, appearance.palette, appearance.intensity, appearance.effectiveTransparentDesktop)
      }
      const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize)
      resizeObserver?.observe(canvas)
      window.addEventListener('resize', resize)
      resize()
      return () => {
        resizeObserver?.disconnect()
        window.removeEventListener('resize', resize)
      }
    }

    let controller: LiquidBackdropController
    try {
      controller = createLiquidBackdropController(
        canvas,
        () =>
          createRenderer
            ? createRenderer(canvas)
            : createLiquidRenderer(
              canvas,
              appearance.palette,
              renderedColorMode === 'light' && !appearance.effectiveTransparentDesktop
                ? Math.min(1, appearance.intensity * 1.55)
                : appearance.intensity,
              renderedColorMode === 'light' ? 'light' : 'dark',
              appearance.effectiveTransparentDesktop,
              appearance.effectiveRefraction ? 1 : 0,
            ),
        {
          ...browserControllerOptions,
          onFailure: () => setDiagnostic('context-restore-failed'),
        },
      )
    } catch {
      setDiagnostic('canvas2d-fallback')
      return
    }

    const resize = (): void => {
      controller.resize()
      if (!animateOptics) controller.renderOnce()
    }
    const resizeObserver =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize)
    const onVisibility = (): void => {
      controller.setVisible(!document.hidden)
      if (!animateOptics) controller.renderOnce()
    }
    const onContextLost = (event: Event): void => {
      event.preventDefault()
      controller.handleContextLost()
    }
    const onContextRestored = (): void => {
      controller.handleContextRestored()
      if (!animateOptics) controller.renderOnce()
    }

    resizeObserver?.observe(canvas)
    window.addEventListener('resize', resize)
    document.addEventListener('visibilitychange', onVisibility)
    canvas.addEventListener('webglcontextlost', onContextLost)
    canvas.addEventListener('webglcontextrestored', onContextRestored)
    controller.setVisible(!document.hidden)
    resize()
    if (animateOptics) controller.start()

    return () => {
      resizeObserver?.disconnect()
      window.removeEventListener('resize', resize)
      document.removeEventListener('visibilitychange', onVisibility)
      canvas.removeEventListener('webglcontextlost', onContextLost)
      canvas.removeEventListener('webglcontextrestored', onContextRestored)
      controller.dispose()
    }
  }, [animateOptics, appearance.effectiveMode, appearance.effectiveRefraction, appearance.intensity, appearance.palette, appearance.effectiveTransparentDesktop, createRenderer, diagnostic, renderedColorMode])

  return (
    <canvas
      key={`${diagnostic ?? 'webgl'}-${appearance.effectiveTransparentDesktop ? 'desktop' : 'workbench'}`}
      ref={canvasRef}
      className="liquid-backdrop"
      data-active={animateOptics && !diagnostic ? 'true' : 'false'}
      data-fallback={diagnostic ? 'static' : undefined}
      data-diagnostic={diagnostic ?? undefined}
      aria-hidden="true"
    />
  )
}

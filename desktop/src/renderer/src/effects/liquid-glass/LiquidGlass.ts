import { displacementMap, highlightMap, pixelsToDataUrl, type BezelProfile, type GlassShape, type Highlight } from './maps'

/** How a kind of surface bends and lights its backdrop. Blur comes from CSS (reference.css). */
export interface GlassPreset {
  bezel: number
  thickness: number
  refractiveIndex: number
  profile: BezelProfile
  saturate: number
  /** Multiplies the measured shift (1 = physical). */
  refraction: number
  /** Red bends this much more, blue this much less (a coloured fringe at the rim); 0 for none. */
  dispersion: number
  /** The bend grows in when the surface appears (dialogs). */
  reveal: boolean
  /** The rim light follows the pointer; large panes keep it still (moving it repaints them). */
  followsPointer: boolean
  highlight: Highlight
}

/** Light from the upper left, as the window's own shadows assume. */
const LIGHT = -128

export const GLASS_PRESETS = {
  // Panes hold text: a narrow rim, a quiet glow.
  pane: { bezel: 14, thickness: 80, refractiveIndex: 1.5, profile: 'squircle', saturate: 1.5, refraction: 1.2, dispersion: 0, reveal: false, followsPointer: false, highlight: { angle: LIGHT, rim: 2, strength: 0.7, glow: 12, glowStrength: 0.07 } },
  // Dialogs and palettes float over the workbench: a wider rim that bends what passes under it.
  float: { bezel: 24, thickness: 110, refractiveIndex: 1.5, profile: 'squircle', saturate: 1.6, refraction: 1.3, dispersion: 0.08, reveal: true, followsPointer: true, highlight: { angle: LIGHT, rim: 2.2, strength: 0.85, glow: 16, glowStrength: 0.09 } },
  // Small controls: clear glass, a rounder lens.
  control: { bezel: 18, thickness: 56, refractiveIndex: 1.45, profile: 'circle', saturate: 1.4, refraction: 1.1, dispersion: 0.07, reveal: false, followsPointer: true, highlight: { angle: LIGHT, rim: 1.8, strength: 0.75, glow: 10, glowStrength: 0.06 } },
} as const satisfies Record<string, GlassPreset>

export type GlassPresetName = keyof typeof GLASS_PRESETS
export type GlassTone = 'dark' | 'light'

/** On a light backdrop a white rim barely shows: a brighter rim and glow, and a darker far rim
 * that together read as a bevel. */
const LIGHT_TONE = { strength: 1, glowStrength: 0.32, shade: 0.3 } as const

export function highlightFor(preset: GlassPresetName, tone: GlassTone): Highlight {
  const highlight: Highlight = GLASS_PRESETS[preset].highlight
  return tone === 'light' ? { ...highlight, ...LIGHT_TONE } : highlight
}

let motionQuery: MediaQueryList | null = null

function reducedMotion(element: HTMLElement): boolean {
  if (!motionQuery && typeof window.matchMedia === 'function') motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
  return Boolean(motionQuery?.matches) || element.closest('[data-reduced-motion="true"]') !== null
}

function toneOf(element: HTMLElement): GlassTone {
  return element.closest('[data-color-mode]')?.getAttribute('data-color-mode') === 'light' ? 'light' : 'dark'
}

/** Larger surfaces keep the plain frosted glass (the filter's cost grows with the area). */
export const MAX_AREA = 3_200_000
const SVG = 'http://www.w3.org/2000/svg'
const SETTLE_MS = 160
const CACHE_SIZE = 24

interface Maps {
  displacement: string
  highlight: string
  shift: number
}

interface Entry {
  id: string
  preset: GlassPresetName
  filter: SVGFilterElement
  lens: SVGFEImageElement
  /** One bend, or three (red, green, blue) with dispersion. */
  bends: SVGFEDisplacementMapElement[]
  /** The bend's full scale, and how much of it shows (0..1, rising as the surface appears). */
  scale: number
  shown: number
  size: { width: number; height: number; radius: number } | null
  timer: ReturnType<typeof setTimeout> | null
  /** The element was static and is made a positioning box for its highlight layer. */
  positioned: boolean
}

function setAttributes(element: Element, attributes: Record<string, string | number>): void {
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, String(value))
}

/** The corner radius an element is drawn with, px. */
export function cornerRadius(element: HTMLElement): number {
  const value = parseFloat(getComputedStyle(element).borderTopLeftRadius)
  return Number.isFinite(value) ? value : 0
}

/**
 * Gives elements a refracting rim: an SVG filter each (the displacement map from Snell's law over
 * a curved bezel, split into red, green and blue bends where the preset disperses, then
 * saturation) used in their backdrop-filter through --lg-filter, and a rim highlight drawn over
 * the surface through --lg-rim. Maps follow the element's size; while it is being resized the last
 * maps stretch, and new ones are drawn once it settles.
 */
export class LiquidGlassManager {
  private readonly defs: SVGSVGElement
  private readonly entries = new Map<HTMLElement, Entry>()
  private readonly cache = new Map<string, Maps>()
  private readonly observer: ResizeObserver | null
  private counter = 0
  private frame: number | null = null

  constructor(host: HTMLElement) {
    this.defs = document.createElementNS(SVG, 'svg')
    setAttributes(this.defs, { width: 0, height: 0, 'aria-hidden': 'true', focusable: 'false' })
    this.defs.classList.add('liquid-glass-defs')
    host.appendChild(this.defs)
    this.observer = typeof ResizeObserver === 'function'
      ? new ResizeObserver((records) => {
        for (const record of records) {
          const element = record.target as HTMLElement
          if (this.entries.has(element)) this.measure(element)
        }
      })
      : null
  }

  has(element: HTMLElement): boolean {
    return this.entries.has(element)
  }

  get size(): number {
    return this.entries.size
  }

  attach(element: HTMLElement, preset: GlassPresetName): void {
    const existing = this.entries.get(element)
    if (existing?.preset === preset) return
    if (existing) this.detach(element)
    const id = `liquid-glass-${++this.counter}`
    const filter = document.createElementNS(SVG, 'filter')
    setAttributes(filter, { id, x: 0, y: 0, width: 1, height: 1, filterUnits: 'userSpaceOnUse', 'color-interpolation-filters': 'sRGB' })
    const lens = document.createElementNS(SVG, 'feImage')
    setAttributes(lens, { x: 0, y: 0, width: 1, height: 1, preserveAspectRatio: 'none', result: 'lens' })
    const bend = (result: string): SVGFEDisplacementMapElement => {
      const element = document.createElementNS(SVG, 'feDisplacementMap')
      setAttributes(element, { in: 'SourceGraphic', in2: 'lens', scale: 0, xChannelSelector: 'R', yChannelSelector: 'G', result })
      return element
    }
    const values = GLASS_PRESETS[preset]
    const bends: SVGFEDisplacementMapElement[] = []
    filter.append(lens)
    if (values.dispersion > 0) {
      // Each colour bends by its own amount and is kept alone; screen adds them back together.
      const only = ['1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0', '0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0', '0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0']
      for (const [index, name] of ['red', 'green', 'blue'].entries()) {
        const bent = bend(`${name}-bent`)
        const channel = document.createElementNS(SVG, 'feColorMatrix')
        setAttributes(channel, { in: `${name}-bent`, type: 'matrix', values: only[index]!, result: name })
        bends.push(bent)
        filter.append(bent, channel)
      }
      const first = document.createElementNS(SVG, 'feBlend')
      setAttributes(first, { in: 'red', in2: 'green', mode: 'screen', result: 'red-green' })
      const second = document.createElementNS(SVG, 'feBlend')
      setAttributes(second, { in: 'red-green', in2: 'blue', mode: 'screen', result: 'bent' })
      filter.append(first, second)
    } else {
      const bent = bend('bent')
      bends.push(bent)
      filter.append(bent)
    }
    const saturate = document.createElementNS(SVG, 'feColorMatrix')
    setAttributes(saturate, { in: 'bent', type: 'saturate', values: values.saturate })
    filter.append(saturate)
    this.defs.appendChild(filter)
    const positioned = getComputedStyle(element).position === 'static'
    if (positioned) element.style.position = 'relative'
    this.entries.set(element, { id, preset, filter, lens, bends, scale: 0, shown: values.reveal && !reducedMotion(element) ? 0 : 1, size: null, timer: null, positioned })
    this.observer?.observe(element)
    this.measure(element)
  }

  detach(element: HTMLElement): void {
    const entry = this.entries.get(element)
    if (!entry) return
    if (entry.timer) clearTimeout(entry.timer)
    this.observer?.unobserve(element)
    entry.filter.remove()
    this.entries.delete(element)
    this.off(element)
    if (entry.positioned) element.style.removeProperty('position')
  }

  /** Draw every surface again (the colour mode changed). */
  refresh(): void {
    for (const element of this.entries.keys()) this.draw(element)
  }

  /** Drop elements no longer in the page. */
  prune(): void {
    for (const element of [...this.entries.keys()]) {
      if (!element.isConnected) this.detach(element)
    }
  }

  dispose(): void {
    if (this.frame !== null) cancelAnimationFrame(this.frame)
    this.frame = null
    for (const element of [...this.entries.keys()]) this.detach(element)
    this.observer?.disconnect()
    this.defs.remove()
    this.cache.clear()
  }

  private measure(element: HTMLElement): void {
    const entry = this.entries.get(element)
    if (!entry) return
    const width = Math.round(element.offsetWidth)
    const height = Math.round(element.offsetHeight)
    const radius = cornerRadius(element)
    const previous = entry.size
    entry.size = { width, height, radius }
    if (width < 8 || height < 8 || width * height > MAX_AREA) {
      this.off(element)
      return
    }
    // The filter region and lens follow the size at once; the maps stretch until redrawn.
    setAttributes(entry.filter, { width, height })
    setAttributes(entry.lens, { width, height })
    if (!previous || !element.dataset.liquidGlass) {
      this.draw(element)
      return
    }
    if (previous.width === width && previous.height === height && previous.radius === radius) return
    if (entry.timer) clearTimeout(entry.timer)
    entry.timer = setTimeout(() => {
      entry.timer = null
      this.draw(element)
    }, SETTLE_MS)
  }

  private draw(element: HTMLElement): void {
    const entry = this.entries.get(element)
    if (!entry?.size) return
    const maps = this.maps(entry.preset, entry.size, toneOf(element))
    if (!maps) {
      this.off(element)
      return
    }
    entry.lens.setAttribute('href', maps.displacement)
    // feDisplacementMap moves by scale × (channel − 0.5); the map stores shift / maxShift × 127,
    // so a scale of twice the largest shift moves pixels by their shift.
    entry.scale = 2 * maps.shift * GLASS_PRESETS[entry.preset].refraction
    this.applyScale(entry)
    if (entry.shown < 1) this.animate()
    element.style.setProperty('--lg-filter', `url(#${entry.id})`)
    element.style.setProperty('--lg-rim', `url("${maps.highlight}")`)
    element.dataset.liquidGlass = entry.preset
  }

  private applyScale(entry: Entry): void {
    const scale = entry.scale * entry.shown
    const spread = GLASS_PRESETS[entry.preset].dispersion
    if (entry.bends.length === 3) {
      entry.bends[0]!.setAttribute('scale', (scale * (1 + spread)).toFixed(2))
      entry.bends[1]!.setAttribute('scale', scale.toFixed(2))
      entry.bends[2]!.setAttribute('scale', (scale * (1 - spread)).toFixed(2))
    } else {
      entry.bends[0]!.setAttribute('scale', scale.toFixed(2))
    }
  }

  /** Surfaces that appeared bend in over about half a second. */
  private animate(): void {
    if (this.frame !== null || typeof requestAnimationFrame !== 'function') return
    let last = performance.now()
    const step = (now: number): void => {
      const seconds = Math.min(0.05, (now - last) / 1000)
      last = now
      let moving = false
      for (const entry of this.entries.values()) {
        if (entry.shown >= 1) continue
        entry.shown = Math.min(1, entry.shown + (1 - entry.shown) * (1 - Math.exp(-seconds * 7)) + 0.004)
        this.applyScale(entry)
        if (entry.shown < 1) moving = true
      }
      this.frame = moving ? requestAnimationFrame(step) : null
    }
    this.frame = requestAnimationFrame(step)
  }

  /** The surfaces whose rim light follows the pointer. */
  lit(): HTMLElement[] {
    return [...this.entries]
      .filter(([element, entry]) => GLASS_PRESETS[entry.preset].followsPointer && element.dataset.liquidGlass !== undefined)
      .map(([element]) => element)
  }

  private off(element: HTMLElement): void {
    for (const name of ['--lg-filter', '--lg-rim', '--lg-a', '--lg-ring', '--lg-sheen', '--lg-mx', '--lg-my']) element.style.removeProperty(name)
    delete element.dataset.liquidGlass
  }

  private maps(preset: GlassPresetName, size: { width: number; height: number; radius: number }, tone: GlassTone): Maps | null {
    const key = `${preset}:${tone}:${size.width}x${size.height}:${size.radius.toFixed(1)}`
    const cached = this.cache.get(key)
    if (cached) {
      this.cache.delete(key)
      this.cache.set(key, cached)
      return cached
    }
    const values = GLASS_PRESETS[preset]
    const shape: GlassShape = {
      width: size.width,
      height: size.height,
      radius: Math.max(size.radius, 4),
      bezel: values.bezel,
      thickness: values.thickness,
      refractiveIndex: values.refractiveIndex,
      profile: values.profile,
    }
    const lens = displacementMap(shape)
    const displacement = pixelsToDataUrl(size.width, size.height, lens.pixels)
    const highlight = pixelsToDataUrl(size.width, size.height, highlightMap(shape, highlightFor(preset, tone)))
    if (!displacement || !highlight) return null
    const maps = { displacement, highlight, shift: lens.maxShift }
    this.cache.set(key, maps)
    while (this.cache.size > CACHE_SIZE) this.cache.delete(this.cache.keys().next().value!)
    return maps
  }
}

/** The surfaces that get a refracting rim, most specific first. */
export const GLASS_TARGETS: ReadonlyArray<[string, GlassPresetName]> = [
  ['.command-overlay > [role="dialog"], .command-overlay > .command-palette, .command-palette', 'float'],
  ['.composer-shell[data-layout="bottom"]', 'control'],
  ['.workbench > :is(.activity-rail, .session-sidebar, .conversation-column, .settings-column, .route-column, .inspector)', 'pane'],
]

/** Whether this browser can use an SVG filter as a backdrop filter (Chromium can). */
export function supportsRefraction(): boolean {
  if (typeof CSS === 'undefined' || typeof CSS.supports !== 'function') return false
  return CSS.supports('backdrop-filter', 'url(#a)') || CSS.supports('-webkit-backdrop-filter', 'url(#a)')
}

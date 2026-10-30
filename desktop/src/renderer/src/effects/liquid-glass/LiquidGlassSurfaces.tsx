import { useEffect } from 'react'

import { GLASS_TARGETS, LiquidGlassManager, supportsRefraction } from './LiquidGlass'

/** Where the rim light sits with no pointer near: the upper left, as the shadows assume. */
const REST_ANGLE = 315
const REST_RING = 0.42
/** How far from a surface the pointer starts to light its rim, px. */
const REACH = 380
const RECT_MS = 250
/** Each change to a surface redraws the glass behind it (the panes' filters too), so the light is
 * written about as often as the field behind it moves (24 frames a second), not every frame. */
const WRITE_MS = 1000 / 30

interface Light {
  angle: number
  ring: number
  sheen: number
  written: Record<string, string>
  rect: DOMRect | null
  measured: number
}

function write(element: HTMLElement, light: Light, name: string, value: string): void {
  if (light.written[name] === value) return
  light.written[name] = value
  element.style.setProperty(name, value)
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

/**
 * Gives the workbench's panes, the composer and floating dialogs a refracting glass rim while the
 * liquid material is on. Surfaces that come and go (dialogs, routes) are picked up as they appear.
 * On the composer and dialogs the hairline rim light turns toward the pointer and brightens as it
 * nears (--lg-a, --lg-ring), and a soft glare follows it over the surface (--lg-sheen, --lg-mx,
 * --lg-my); panes keep theirs still.
 */
export function LiquidGlassSurfaces({ enabled }: { enabled: boolean }) {
  useEffect(() => {
    if (!enabled || !supportsRefraction()) return
    const root = document.querySelector<HTMLElement>('.workbench')
    if (!root) return
    const manager = new LiquidGlassManager(document.body)
    let frame: number | null = null

    const scan = (): void => {
      frame = null
      manager.prune()
      for (const [selector, preset] of GLASS_TARGETS) {
        for (const element of root.querySelectorAll<HTMLElement>(selector)) {
          if (!manager.has(element)) manager.attach(element, preset)
        }
      }
      wake()
    }
    const schedule = (): void => {
      if (frame === null) frame = requestAnimationFrame(scan)
    }
    // Text streaming into the timeline changes the page constantly; only elements coming and
    // going can add or remove a surface.
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of [...record.addedNodes, ...record.removedNodes]) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            schedule()
            return
          }
        }
      }
    })
    observer.observe(root, { childList: true, subtree: true })
    // Light and dark glass are lit differently.
    const shell = root.closest('[data-color-mode]')
    const tone = new MutationObserver(() => manager.refresh())
    if (shell) tone.observe(shell, { attributes: true, attributeFilter: ['data-color-mode'] })

    // The light runs only while something moves toward its target.
    const pointer = { x: 0, y: 0, seen: false }
    const lights = new WeakMap<HTMLElement, Light>()
    let light: number | null = null
    let last = 0
    let written = 0
    const tick = (now: number): void => {
      if (last && now - written < WRITE_MS) {
        light = requestAnimationFrame(tick)
        return
      }
      written = now
      const seconds = last ? Math.min(0.1, (now - last) / 1000) : 1 / 60
      last = now
      const ease = still ? 1 : 1 - Math.exp(-seconds * 6)
      let moving = false
      for (const element of manager.lit()) {
        const state = lights.get(element) ?? { angle: REST_ANGLE, ring: REST_RING, sheen: 0, written: {}, rect: null, measured: 0 }
        // The manager clears the values when it takes the glass off.
        if (!element.style.getPropertyValue('--lg-ring')) state.written = {}
        // Reading the box forces a layout; surfaces move rarely, so it is read a few times a second.
        if (!state.rect || now - state.measured > RECT_MS) {
          state.rect = element.getBoundingClientRect()
          state.measured = now
        }
        const rect = state.rect
        let angle = REST_ANGLE
        let near = 0
        let inside = 0
        if (pointer.seen) {
          const dx = Math.max(rect.left - pointer.x, 0, pointer.x - rect.right)
          const dy = Math.max(rect.top - pointer.y, 0, pointer.y - rect.bottom)
          const distance = Math.hypot(dx, dy)
          near = 1 - smoothstep(0, REACH, distance)
          inside = distance < 1 ? 1 : 0
          // Clockwise from the top, as conic-gradient counts.
          if (near > 0.04) angle = Math.atan2(pointer.x - (rect.left + rect.width / 2), -(pointer.y - (rect.top + rect.height / 2))) * 180 / Math.PI
        }
        const turn = ((angle - state.angle + 540) % 360) - 180
        const ring = REST_RING + (1 - REST_RING) * near
        if (Math.abs(turn) > 0.5 || Math.abs(ring - state.ring) > 0.004 || Math.abs(inside - state.sheen) > 0.004) {
          state.angle = (state.angle + turn * ease + 360) % 360
          state.ring += (ring - state.ring) * ease
          state.sheen += (inside - state.sheen) * ease
          moving = true
        } else {
          state.angle = (angle + 360) % 360
          state.ring = ring
          state.sheen = inside
        }
        lights.set(element, state)
        // Every write restyles and repaints the surface, so only changed values are written.
        write(element, state, '--lg-a', `${state.angle.toFixed(1)}deg`)
        write(element, state, '--lg-ring', state.ring.toFixed(3))
        write(element, state, '--lg-sheen', state.sheen.toFixed(3))
        if (state.sheen > 0.01) {
          write(element, state, '--lg-mx', `${Math.min(rect.width, Math.max(0, pointer.x - rect.left)).toFixed(0)}px`)
          write(element, state, '--lg-my', `${Math.min(rect.height, Math.max(0, pointer.y - rect.top)).toFixed(0)}px`)
        }
      }
      light = moving ? requestAnimationFrame(tick) : null
      if (!moving) last = 0
    }
    // Pointer moves wake the light often: the query is made once and read on each wake.
    const motion = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null
    let still = false
    function wake(): void {
      if (light !== null) return
      still = Boolean(motion?.matches) || shell?.getAttribute('data-reduced-motion') === 'true'
      light = requestAnimationFrame(tick)
    }
    const onMove = (event: PointerEvent): void => {
      pointer.x = event.clientX
      pointer.y = event.clientY
      pointer.seen = true
      wake()
    }
    const onLeave = (): void => {
      pointer.seen = false
      wake()
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    document.documentElement.addEventListener('pointerleave', onLeave)
    scan()
    return () => {
      observer.disconnect()
      tone.disconnect()
      window.removeEventListener('pointermove', onMove)
      document.documentElement.removeEventListener('pointerleave', onLeave)
      if (frame !== null) cancelAnimationFrame(frame)
      if (light !== null) cancelAnimationFrame(light)
      manager.dispose()
    }
  }, [enabled])
  return null
}

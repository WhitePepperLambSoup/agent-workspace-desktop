/**
 * Spring timing shared with the Android app: a damped spring sampled into CSS
 * linear() points, so every transition and animation runs on the same curves.
 * Stylesheets read `--spring-<name>` and `--spring-<name>-ms`; without these
 * properties they fall back to plain linear timing.
 */

export type SpringName = 'snappy' | 'bouncy' | 'gentle'

export interface SpringTiming {
  easing: string
  duration: number
}

const SPRINGS: Record<SpringName, { stiffness: number; damping: number }> = {
  snappy: { stiffness: 520, damping: 42 },
  bouncy: { stiffness: 340, damping: 21 },
  gentle: { stiffness: 190, damping: 26 },
}

const POINTS = 40

export function sampleSpring(stiffness: number, damping: number, mass = 1): SpringTiming {
  const w0 = Math.sqrt(stiffness / mass)
  const zeta = damping / (2 * Math.sqrt(stiffness * mass))
  const position = (t: number): number => {
    if (zeta < 1) {
      const wd = w0 * Math.sqrt(1 - zeta * zeta)
      return 1 - Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + (zeta * w0 / wd) * Math.sin(wd * t))
    }
    return 1 - Math.exp(-w0 * t) * (1 + w0 * t)
  }
  // The curve ends where the spring stays within 0.15% of rest.
  let settle = 0.12
  for (let t = 0; t < 3; t += 0.004) if (Math.abs(1 - position(t)) > 0.0015) settle = t
  const points: number[] = []
  for (let index = 0; index <= POINTS; index += 1) points.push(Number(position((settle * index) / POINTS).toFixed(4)))
  points[POINTS] = 1
  return { easing: `linear(${points.join(', ')})`, duration: Math.round(settle * 1000) }
}

export function springTimings(): Record<SpringName, SpringTiming> {
  const timings = {} as Record<SpringName, SpringTiming>
  for (const [name, { stiffness, damping }] of Object.entries(SPRINGS) as [SpringName, typeof SPRINGS[SpringName]][]) {
    timings[name] = sampleSpring(stiffness, damping)
  }
  return timings
}

/** Publishes the spring curves as custom properties on the document root. */
export function installSpringTokens(root: HTMLElement = document.documentElement): void {
  const supported = typeof CSS !== 'undefined' && typeof CSS.supports === 'function' &&
    CSS.supports('animation-timing-function', 'linear(0, 1)')
  if (!supported) return
  for (const [name, timing] of Object.entries(springTimings())) {
    root.style.setProperty(`--spring-${name}`, timing.easing)
    root.style.setProperty(`--spring-${name}-ms`, `${timing.duration}ms`)
  }
}

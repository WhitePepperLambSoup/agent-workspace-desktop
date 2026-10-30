/**
 * Refraction and highlight maps for liquid glass: a rounded rectangle whose rim is a curved
 * bezel. Light passing the bezel bends by Snell's law, so the backdrop seen near the edge comes
 * from further in; the displacement map stores that shift per pixel (red = x, green = y, 128 =
 * none) for feDisplacementMap. The highlight map is a thin rim lit from one direction.
 *
 * The approach follows liquid-glass by xiaojiaenen (MIT); this is our own implementation.
 */

export type BezelProfile = 'squircle' | 'circle' | 'flat'

export interface GlassShape {
  width: number
  height: number
  /** Corner radius of the element, px. */
  radius: number
  /** Width of the curved rim, px (at most the radius). */
  bezel: number
  /** Thickness of the glass under the rim, px: thicker bends more. */
  thickness: number
  refractiveIndex: number
  profile: BezelProfile
}

export interface Highlight {
  /** Direction the light comes from, degrees (0 = from the right, 90 = from below, -90 = from above). */
  angle: number
  /** Width of the lit rim, px. */
  rim: number
  /** 0..1 */
  strength: number
  /** Width of the soft light inside the rim (the glass's thickness), px. */
  glow: number
  /** 0..1 */
  glowStrength: number
  /** Darkness of the rim facing away from the light, 0..1 (a bevel on light backgrounds, where
   * a white highlight alone does not show). */
  shade?: number
}

const SAMPLES = 96

/** Height of the bezel surface at t (0 = outer edge, 1 = where the flat top begins), 0..1. */
export function surfaceHeight(profile: BezelProfile, t: number): number {
  const x = Math.min(1, Math.max(0, t))
  if (profile === 'flat') return x
  if (profile === 'circle') return Math.sqrt(1 - (1 - x) * (1 - x))
  return Math.pow(1 - Math.pow(1 - x, 4), 0.25)
}

/**
 * Inward shift (px) of the backdrop seen through the bezel at SAMPLES points from the outer edge
 * to the flat top. A ray from the viewer meets the curved surface, refracts into the glass and
 * travels through it to the backdrop; the shift is how far sideways it lands.
 */
export function refractionProfile(shape: Pick<GlassShape, 'bezel' | 'thickness' | 'refractiveIndex' | 'profile'>): Float32Array {
  const curve = new Float32Array(SAMPLES)
  const eta = 1 / Math.max(1.0001, shape.refractiveIndex)
  const step = 1e-3
  for (let index = 0; index < SAMPLES; index++) {
    const t = index / (SAMPLES - 1)
    const height = surfaceHeight(shape.profile, t)
    // Slope of the surface (its height is height(t) × bezel over a run of t × bezel: the
    // bezel width cancels).
    const before = Math.max(0, t - step)
    const after = Math.min(1, t + step)
    const slope = (surfaceHeight(shape.profile, after) - surfaceHeight(shape.profile, before)) / (after - before)
    // Outward normal of the surface z = height(u); the ray comes straight down (0, 1).
    const length = Math.hypot(slope, 1)
    const nu = -slope / length
    const nv = -1 / length
    const cosine = -nv
    const k = 1 - eta * eta * (1 - cosine * cosine)
    if (k < 0) { curve[index] = 0; continue }
    const factor = eta * cosine - Math.sqrt(k)
    const tu = factor * nu
    const tv = eta + factor * nv
    const depth = height * shape.bezel + shape.thickness
    curve[index] = tv > 1e-6 ? (tu / tv) * depth : 0
  }
  return curve
}

interface Geometry {
  width: number
  height: number
  radius: number
}

/** Offset of (x, y) from the nearest point of the rectangle inset by the radius, and its length. */
function radial(geometry: Geometry, x: number, y: number): [number, number, number] {
  const { width, height, radius } = geometry
  const cx = Math.min(Math.max(x, radius), width - radius)
  const cy = Math.min(Math.max(y, radius), height - radius)
  const ox = x - cx
  const oy = y - cy
  return [ox, oy, Math.hypot(ox, oy)]
}

export function clampShape(shape: GlassShape): GlassShape {
  const width = Math.max(1, Math.round(shape.width))
  const height = Math.max(1, Math.round(shape.height))
  const radius = Math.max(1, Math.min(shape.radius, width / 2, height / 2))
  return { ...shape, width, height, radius, bezel: Math.max(1, Math.min(shape.bezel, radius)) }
}

/**
 * The refraction curve as the eye reads it, 0..1 from the outer edge inwards: a steep profile
 * bends hardest at its very edge, so the outer EDGE share of the bezel is held at the strongest
 * bend and the rest follows the physical curve below it. (Normalized by the very edge alone,
 * the bend would show on one or two pixels only.)
 */
const EDGE = 0.08

export function perceivedCurve(shape: Pick<GlassShape, 'bezel' | 'thickness' | 'refractiveIndex' | 'profile'>): Float32Array {
  const physical = refractionProfile(shape)
  const reference = Math.abs(physical[Math.ceil(EDGE * (SAMPLES - 1))]!)
  const curve = new Float32Array(SAMPLES)
  if (reference < 1e-6) return curve
  for (let index = 0; index < SAMPLES; index++) curve[index] = Math.min(1, Math.abs(physical[index]!) / reference)
  return curve
}

/** RGBA pixels of the displacement map, and the largest shift in px (the filter's scale): the
 * bezel width, so the rim bends what is under it by up to its own width. */
export function displacementMap(input: GlassShape): { pixels: Uint8ClampedArray; maxShift: number } {
  const shape = clampShape(input)
  const { width, height, radius, bezel } = shape
  const curve = perceivedCurve(shape)
  const maxShift = curve[0]! > 0 ? bezel : 0
  const pixels = new Uint8ClampedArray(width * height * 4)
  // Neutral everywhere: no shift (128, 128), opaque.
  new Uint32Array(pixels.buffer).fill(0xff008080)
  if (maxShift === 0) return { pixels, maxShift: 0 }
  const geometry = { width, height, radius }
  const inner = radius - bezel
  const visit = (x: number, y: number): void => {
    const [ox, oy, distance] = radial(geometry, x + 0.5, y + 0.5)
    if (distance <= inner || distance === 0) return
    // Pixels on the very edge fade out so the outline stays smooth.
    const coverage = Math.min(1, Math.max(0, radius + 0.5 - distance))
    if (coverage <= 0) return
    const t = Math.min(1, Math.max(0, (radius - distance) / bezel))
    const value = curve[Math.min(SAMPLES - 1, Math.floor(t * (SAMPLES - 1)))]!
    // The backdrop is taken from further in: against the outward direction.
    const dx = -(ox / distance) * value * coverage
    const dy = -(oy / distance) * value * coverage
    const offset = (y * width + x) * 4
    pixels[offset] = 128 + dx * 127
    pixels[offset + 1] = 128 + dy * 127
  }
  // Only the rim band can shift: the outer `radius` pixels of each side.
  const band = Math.ceil(radius) + 1
  for (let y = 0; y < height; y++) {
    if (y < band || y >= height - band) {
      for (let x = 0; x < width; x++) visit(x, y)
    } else {
      for (let x = 0; x < Math.min(band, width); x++) visit(x, y)
      for (let x = Math.max(band, width - band); x < width; x++) visit(x, y)
    }
  }
  return { pixels, maxShift }
}

/** RGBA pixels of the rim highlight: white, its alpha strongest where the rim faces the light. */
export function highlightMap(input: GlassShape, light: Highlight): Uint8ClampedArray {
  const shape = clampShape(input)
  const { width, height, radius } = shape
  const pixels = new Uint8ClampedArray(width * height * 4)
  const geometry = { width, height, radius }
  const lx = Math.cos((light.angle * Math.PI) / 180)
  const ly = Math.sin((light.angle * Math.PI) / 180)
  const rim = Math.max(0.5, light.rim)
  const glow = Math.max(0, Math.min(light.glow, radius))
  const reach = Math.max(rim, glow)
  const visit = (x: number, y: number): void => {
    const [ox, oy, distance] = radial(geometry, x + 0.5, y + 0.5)
    if (distance === 0 || distance < radius - reach - 1) return
    const inside = radius - distance
    const coverage = Math.min(1, Math.max(0, inside + 0.5))
    if (coverage <= 0) return
    // Facing the light (and, more faintly, away from it: light passing through the far rim).
    // (ox, oy) points out of the glass, (lx, ly) towards the light.
    const facing = (ox * lx + oy * ly) / distance
    const shade = light.shade ?? 0
    const lit = Math.max(facing, 0) + Math.max(-facing, 0) * (shade > 0 ? 0 : 0.45)
    const across = Math.min(1, Math.max(0, inside / rim))
    const profile = inside <= rim ? Math.sin(Math.PI * across) ** 0.8 : 0
    const line = profile * Math.pow(lit, 1.6) * light.strength
    // The soft light fades from the rim inwards, brighter on the lit side.
    const fade = glow > 0 ? Math.max(0, 1 - inside / glow) ** 2 : 0
    const soft = fade * (0.35 + 0.65 * Math.max(facing, 0)) * light.glowStrength
    const bright = Math.max(line, soft) * coverage
    const dark = profile * Math.pow(Math.max(-facing, 0), 1.4) * shade * coverage
    const alpha = Math.max(bright, dark)
    if (alpha <= 0.004) return
    const offset = (y * width + x) * 4
    const value = bright >= dark ? 255 : 0
    pixels[offset] = value
    pixels[offset + 1] = value
    pixels[offset + 2] = value
    pixels[offset + 3] = Math.round(Math.min(1, alpha) * 255)
  }
  const band = Math.ceil(radius) + 1
  for (let y = 0; y < height; y++) {
    if (y < band || y >= height - band) {
      for (let x = 0; x < width; x++) visit(x, y)
    } else {
      for (let x = 0; x < Math.min(band, width); x++) visit(x, y)
      for (let x = Math.max(band, width - band); x < width; x++) visit(x, y)
    }
  }
  return pixels
}

/** The highlight's pixels whose alpha a rendering would show: for checks and tests. */
export function alphaAt(pixels: Uint8ClampedArray, width: number, x: number, y: number): number {
  return pixels[(y * width + x) * 4 + 3]!
}

/** A PNG data URL of the pixels; null where the page has no 2D canvas (tests). */
export function pixelsToDataUrl(width: number, height: number, pixels: Uint8ClampedArray): string | null {
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  let context: CanvasRenderingContext2D | null = null
  try {
    context = canvas.getContext('2d')
  } catch {
    return null
  }
  if (!context) return null
  const image = context.createImageData(width, height)
  image.data.set(pixels)
  context.putImageData(image, 0, 0)
  try {
    return canvas.toDataURL('image/png')
  } catch {
    return null
  }
}

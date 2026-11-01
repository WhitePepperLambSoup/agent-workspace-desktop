import * as THREE from 'three'

import { Batch, boxShape, capsuleShape, cylinderShape, latheShape, sphereShape, torusShape } from './mesh-kit'

/**
 * The furniture of the high graphics setting: the same pieces as the standard rooms, modelled
 * the way they are built (an office chair's five-star base and casters, gas lift and contoured
 * seat; a desk's steel frame, drawers and cable tray; a monitor's thin bezel and stand; a
 * keyboard's keys; a plant's leaves). Each piece is built in its own frame and set where it goes,
 * so every room and place can use it. Sizes match the standard pieces, so people still sit, type
 * and reach the same.
 */

export interface FineColours {
  deskTop: string
  deskFrame: string
  chair: string
  seat: string
  pot: string
  soil: string
  leaf: string
  leafLight: string
}

const STEEL = '#3a3f4b'
const DARK = '#24272e'
const CHROME = '#c3c9d2'
const PLASTIC = '#2a2d35'

/** A colour a little lighter (amount > 0) or darker. */
export function tone(color: string, amount: number): string {
  return `#${new THREE.Color(color).offsetHSL(0, 0, amount).getHexString()}`
}

/** Steady numbers in 0..1 from a seed, for leaves and books that look placed by hand. */
export function seeded(seed: number): () => number {
  let state = Math.abs(Math.floor(seed * 9973)) % 2147483646 + 1
  return () => {
    state = (state * 16807) % 2147483647
    return (state - 1) / 2147483646
  }
}

/**
 * A wooden floor for the high setting, painted on a canvas of 512 units: staggered planks each a
 * shade of its own, grain running along them, a knot here and there, the joints between them and
 * a light catch on each plank's edge.
 */
export function paintFineWood(context: CanvasRenderingContext2D, dark: boolean): void {
  const random = seeded(dark ? 41 : 17)
  const base = new THREE.Color(dark ? '#76604b' : '#c9a37c')
  context.fillStyle = `#${base.getHexString()}`
  context.fillRect(0, 0, 512, 512)
  const plank = new THREE.Color()
  for (let row = 0; row < 8; row += 1) {
    const offset = ((row * 5) % 4) * 64
    for (let column = -1; column < 3; column += 1) {
      const x = column * 256 + offset
      const y = row * 64
      plank.copy(base).offsetHSL((random() - 0.5) * 0.02, (random() - 0.5) * 0.06, (random() - 0.5) * 0.08)
      context.fillStyle = `#${plank.getHexString()}`
      context.fillRect(x + 1, y + 1, 254, 62)
      // Grain: long, gently waving lines.
      for (let line = 0; line < 14; line += 1) {
        const ly = y + 4 + random() * 56
        const wave = 1 + random() * 3
        context.strokeStyle = dark ? `rgba(20,12,6,${0.08 + random() * 0.12})` : `rgba(90,55,25,${0.06 + random() * 0.1})`
        context.lineWidth = 0.5 + random() * 1.1
        context.beginPath()
        context.moveTo(x + 2, ly)
        for (let step = 1; step <= 8; step += 1) context.quadraticCurveTo(x + step * 32 - 16, ly + (random() - 0.5) * wave * 2, x + step * 32, ly + (random() - 0.5) * wave)
        context.stroke()
      }
      if (random() < 0.3) {
        const kx = x + 30 + random() * 196
        const ky = y + 14 + random() * 36
        for (let ring = 0; ring < 3; ring += 1) {
          context.strokeStyle = dark ? 'rgba(15,8,4,0.22)' : 'rgba(80,45,20,0.22)'
          context.lineWidth = 0.8
          context.beginPath()
          context.ellipse(kx, ky, 4 + ring * 3, 2 + ring * 1.6, 0, 0, Math.PI * 2)
          context.stroke()
        }
      }
      context.fillStyle = dark ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.18)'
      context.fillRect(x + 2, y + 2, 252, 1.5)
      context.fillStyle = dark ? 'rgba(0,0,0,0.45)' : 'rgba(60,35,15,0.35)'
      context.fillRect(x, y, 1.5, 64)
    }
    context.fillStyle = dark ? 'rgba(0,0,0,0.5)' : 'rgba(60,35,15,0.4)'
    context.fillRect(0, row * 64, 512, 1.5)
  }
}

/**
 * Panelling on the lower part of a wall for the high setting: a rail on top and frames along it.
 * `along` is the wall's direction ('x' for the back wall at `at`, 'z' for the left wall at `at`).
 */
export function wainscot(batch: Batch, colour: string, along: 'x' | 'z', at: number, from: number, to: number, height = 0.95): void {
  const panel = 0.8
  const count = Math.max(1, Math.round((to - from) / panel))
  const step = (to - from) / count
  const place = (u: number, y: number, w: number, h: number): void => {
    if (along === 'x') batch.add(boxShape(w, h, 0.016, 0.004), colour, { x: u, y, z: at }, 'satin', false)
    else batch.add(boxShape(0.016, h, w, 0.004), colour, { x: at, y, z: u }, 'satin', false)
  }
  for (let index = 0; index < count; index += 1) {
    const centre = from + step * (index + 0.5)
    const inner = step - 0.18
    place(centre, 0.24, inner, 0.018)
    place(centre, height - 0.14, inner, 0.018)
    for (const side of [-1, 1]) place(centre + side * inner / 2, (0.24 + height - 0.14) / 2, 0.018, height - 0.38 + 0.018)
  }
}

/**
 * An office chair whose sitter faces +z (turn it with `ry`): five-star base on casters, a gas lift
 * in its sleeve, the seat on its shell with a rolled front edge, a curved back with a lumbar pad,
 * and armrests. The cushion's top is where the standard chair's is.
 */
export function fineChair(batch: Batch, colours: Pick<FineColours, 'chair' | 'seat'>, at: { x: number; z: number; ry?: number }): void {
  batch.within({ x: at.x, z: at.z, ry: at.ry ?? 0 }, () => {
    batch.add(cylinderShape(0.05, 0.055, 0.05, 20), DARK, { y: 0.075 }, 'satin')
    for (let leg = 0; leg < 5; leg += 1) {
      const angle = (leg / 5) * Math.PI * 2 + Math.PI / 5
      const sx = Math.sin(angle)
      const sz = Math.cos(angle)
      batch.add(boxShape(0.042, 0.028, 0.24, 0.012), DARK, { x: sx * 0.14, y: 0.068, z: sz * 0.14, ry: angle }, 'satin')
      batch.add(boxShape(0.03, 0.032, 0.036, 0.008), DARK, { x: sx * 0.255, y: 0.052, z: sz * 0.255, ry: angle }, 'satin', false)
      batch.add(cylinderShape(0.026, 0.026, 0.028, 16), '#16181d', { x: sx * 0.262, y: 0.027, z: sz * 0.262, ry: angle, rz: Math.PI / 2 }, 'satin', false)
    }
    batch.add(cylinderShape(0.034, 0.038, 0.11, 20), DARK, { y: 0.15 }, 'satin')
    batch.add(cylinderShape(0.021, 0.021, 0.08, 16), CHROME, { y: 0.24 }, 'metal')
    batch.add(boxShape(0.2, 0.04, 0.22, 0.01), DARK, { y: 0.29 }, 'satin', false)
    // The seat: its shell, the cushion, the front edge rolled down.
    batch.add(boxShape(0.48, 0.025, 0.46, 0.01), DARK, { y: 0.307 }, 'satin')
    batch.add(boxShape(0.47, 0.06, 0.43, 0.03), colours.seat, { y: 0.335, z: -0.01 }, 'matte')
    batch.add(capsuleShape(0.03, 0.41, 16), colours.seat, { y: 0.33, z: 0.2, rz: Math.PI / 2 }, 'matte')
    // The back: a spine from under the seat, a shell and cushion leaning back, the lumbar pad.
    batch.add(boxShape(0.07, 0.028, 0.18, 0.01), DARK, { y: 0.29, z: -0.24 }, 'satin', false)
    batch.add(boxShape(0.07, 0.24, 0.03, 0.012), DARK, { y: 0.4, z: -0.32, rx: -0.12 }, 'satin')
    batch.add(boxShape(0.46, 0.52, 0.03, 0.014), DARK, { y: 0.64, z: -0.33, rx: -0.12 }, 'satin')
    batch.add(boxShape(0.42, 0.48, 0.055, 0.026), colours.chair, { y: 0.64, z: -0.3, rx: -0.12 }, 'matte')
    batch.add(boxShape(0.36, 0.1, 0.03, 0.014), tone(colours.chair, 0.05), { y: 0.5, z: -0.265, rx: -0.12 }, 'matte', false)
    for (let row = 0; row < 3; row += 1) {
      batch.add(boxShape(0.38, 0.006, 0.004), tone(colours.chair, -0.06), { y: 0.62 + row * 0.12, z: -0.271 + row * 0.014, rx: -0.12 }, 'matte', false)
    }
    // Armrests: a bracket from under the seat, a post, a soft pad.
    for (const side of [-1, 1]) {
      batch.add(boxShape(0.07, 0.022, 0.05, 0.008), DARK, { x: side * 0.22, y: 0.296, z: -0.04 }, 'satin', false)
      batch.add(boxShape(0.032, 0.15, 0.05, 0.012), DARK, { x: side * 0.255, y: 0.375, z: -0.04 }, 'satin')
      batch.add(boxShape(0.07, 0.028, 0.25, 0.013), '#1d1f25', { x: side * 0.255, y: 0.462, z: -0.01 }, 'matte')
    }
  })
}

/**
 * A desk whose sitter is at -z (turn it with `ry`): a slab top with an edge band, a steel frame
 * with feet and rails, a modesty panel, a cable tray, and (if wide enough) a pedestal of three
 * drawers on the left. The top is at the standard desk's height.
 */
export function fineDesk(batch: Batch, colours: Pick<FineColours, 'deskTop' | 'deskFrame'>, at: { x: number; z: number; width: number; depth?: number; ry?: number }): void {
  const width = at.width
  const depth = at.depth ?? 0.7
  batch.within({ x: at.x, z: at.z, ry: at.ry ?? 0 }, () => {
    batch.add(boxShape(width, 0.034, depth, 0.008), colours.deskTop, { y: 0.65 }, 'satin')
    batch.add(boxShape(width - 0.01, 0.012, depth - 0.01, 0.004), tone(colours.deskTop, -0.14), { y: 0.629 }, 'satin', false)
    for (const side of [-1, 1]) {
      const x = side * (width / 2 - 0.06)
      for (const end of [-1, 1]) batch.add(boxShape(0.045, 0.6, 0.045, 0.01), colours.deskFrame, { x, y: 0.32, z: end * (depth / 2 - 0.07) }, 'metal')
      batch.add(boxShape(0.05, 0.028, depth - 0.06, 0.01), colours.deskFrame, { x, y: 0.03, z: 0 }, 'metal')
      batch.add(boxShape(0.04, 0.03, depth - 0.12), colours.deskFrame, { x, y: 0.6, z: 0 }, 'metal', false)
      for (const end of [-1, 1]) batch.add(cylinderShape(0.018, 0.02, 0.016, 12), '#16181d', { x, y: 0.008, z: end * (depth / 2 - 0.07) }, 'satin', false)
    }
    batch.add(boxShape(width - 0.16, 0.04, 0.03), colours.deskFrame, { y: 0.6, z: depth / 2 - 0.07 }, 'metal', false)
    batch.add(boxShape(width - 0.2, 0.26, 0.012, 0.004), tone(colours.deskFrame, -0.04), { y: 0.45, z: depth / 2 - 0.09 }, 'metal')
    batch.add(boxShape(Math.max(0.3, width - 0.5), 0.05, 0.1, 0.006), STEEL, { y: 0.585, z: depth / 2 - 0.17 }, 'metal', false)
    if (width >= 1.1) {
      const px = -(width / 2 - 0.27)
      const pd = depth - 0.16
      batch.add(boxShape(0.38, 0.52, pd, 0.012), tone(colours.deskFrame, 0.06), { x: px, y: 0.3, z: 0.02 }, 'satin')
      for (const [y, h] of [[0.13, 0.16], [0.3, 0.15], [0.46, 0.13]] as const) {
        batch.add(boxShape(0.355, h, 0.012, 0.004), tone(colours.deskFrame, 0.1), { x: px, y, z: 0.02 - pd / 2 - 0.006 }, 'satin', false)
        batch.add(boxShape(0.12, 0.012, 0.02, 0.005), CHROME, { x: px, y: y + h / 2 - 0.03, z: 0.02 - pd / 2 - 0.02 }, 'metal', false)
      }
      batch.add(cylinderShape(0.012, 0.012, 0.01, 10), '#16181d', { x: px, y: 0.04, z: 0.02 - pd / 2 + 0.03 }, 'satin', false)
    }
  })
}

/**
 * A monitor whose screen faces -z, its panel centred at `at` (the lit screen goes on its front):
 * a thin bezel, the housing at the back, a neck down to a base plate on the desk top at
 * `deskTop`, and a power light.
 */
export function fineMonitor(batch: Batch, at: { x: number; y: number; z: number; deskTop?: number; ry?: number }): void {
  const top = at.deskTop ?? 0.667
  batch.within({ x: at.x, y: 0, z: at.z, ry: at.ry ?? 0 }, () => {
    batch.add(boxShape(0.645, 0.405, 0.02, 0.008), '#15171c', { y: at.y }, 'satin')
    batch.add(boxShape(0.42, 0.27, 0.04, 0.018), DARK, { y: at.y - 0.01, z: 0.028 }, 'satin')
    batch.add(boxShape(0.2, 0.12, 0.012, 0.005), '#1d2027', { y: at.y - 0.01, z: 0.052 }, 'satin', false)
    const neck = at.y - 0.09 - top
    batch.add(boxShape(0.055, neck, 0.022, 0.008), '#59606c', { y: top + neck / 2 + 0.005, z: 0.07 }, 'metal')
    batch.add(boxShape(0.26, 0.012, 0.18, 0.006), '#59606c', { y: top + 0.006, z: 0.05 }, 'metal')
    batch.add(cylinderShape(0.035, 0.04, 0.012, 20), '#4a515c', { y: top + 0.016, z: 0.07 }, 'metal', false)
    batch.add(boxShape(0.01, 0.005, 0.004), '#7cf0c0', { x: 0.29, y: at.y - 0.196, z: -0.011 }, 'glow', false)
  })
}

/** A keyboard and mouse in front of the sitter (at -z of the desk centre `at`). */
export function fineKeyboard(batch: Batch, at: { x: number; z: number; ry?: number }, top = 0.667): void {
  batch.within({ x: at.x, z: at.z, ry: at.ry ?? 0 }, () => {
    batch.add(boxShape(0.4, 0.016, 0.135, 0.006), DARK, { y: top + 0.008 }, 'satin')
    const key = '#4a4f5a'
    for (let row = 0; row < 5; row += 1) {
      const z = -0.05 + row * 0.025
      if (row === 0) {
        batch.add(boxShape(0.13, 0.008, 0.019, 0.003), key, { y: top + 0.019, z }, 'satin', false)
        for (let column = 0; column < 4; column += 1) {
          for (const side of [-1, 1]) batch.add(boxShape(0.021, 0.008, 0.019, 0.003), key, { x: side * (0.09 + column * 0.025), y: top + 0.019, z }, 'satin', false)
        }
        continue
      }
      for (let column = 0; column < 15; column += 1) batch.add(boxShape(0.021, 0.008, 0.019, 0.003), key, { x: -0.175 + column * 0.025, y: top + 0.019, z }, 'satin', false)
    }
    batch.add(boxShape(0.22, 0.003, 0.18, 0.001), '#2b3040', { x: 0.31, y: top + 0.0015, z: 0.01 }, 'matte', false)
    batch.add(sphereShape(0.03, 16, 10), PLASTIC, { x: 0.31, y: top + 0.006, z: 0.0, sx: 0.85, sy: 0.42, sz: 1.35 }, 'satin', false)
  })
}

/**
 * A plant in a turned pot on a saucer, pebbles on the soil, and leaves fanned out from the middle;
 * a tall one is a small tree whose broad leaves sit on a bending stem. `seed` varies the leaves.
 */
export function finePlant(batch: Batch, colours: Pick<FineColours, 'pot' | 'soil' | 'leaf' | 'leafLight'>, at: { x: number; z: number; y?: number; tall?: boolean; scale?: number; seed?: number }): void {
  const random = seeded(at.seed ?? at.x * 31 + at.z * 17)
  const scale = at.scale ?? 1
  const pot = latheShape('pot', [[0, 0], [0.145, 0], [0.155, 0.012], [0.2, 0.33], [0.218, 0.34], [0.218, 0.375], [0.198, 0.375], [0.19, 0.35], [0, 0.35]], 40)
  const greens = [colours.leaf, colours.leafLight, tone(colours.leaf, 0.06), tone(colours.leafLight, -0.05)]
  batch.within({ x: at.x, y: at.y ?? 0, z: at.z, sx: scale, sy: scale, sz: scale }, () => {
    batch.add(cylinderShape(0.2, 0.185, 0.02, 32), tone(colours.pot, -0.12), { y: 0.01 }, 'satin', false)
    batch.add(pot, colours.pot, { y: 0.02 }, 'satin')
    batch.add(cylinderShape(0.188, 0.188, 0.012, 28), colours.soil, { y: 0.365 }, 'matte', false)
    for (let pebble = 0; pebble < 6; pebble += 1) {
      const angle = random() * Math.PI * 2
      const reach = 0.06 + random() * 0.1
      batch.add(sphereShape(0.014 + random() * 0.008, 8, 6), '#b9b2a6', { x: Math.sin(angle) * reach, y: 0.373, z: Math.cos(angle) * reach, sy: 0.6 }, 'matte', false)
    }
    const leaf = sphereShape(1, 8, 6)
    if (at.tall) {
      // A trunk that leans a little one way then the other, leaves in three tiers along it.
      let x = 0
      let z = 0
      let y = 0.37
      for (const [dx, dz, length] of [[0.03, -0.01, 0.34], [-0.04, 0.02, 0.3], [0.02, 0.03, 0.3]] as const) {
        batch.add(cylinderShape(0.016, 0.02, length, 10), '#5b4636', { x: x + dx / 2, y: y + length / 2, z: z + dz / 2, rz: -dx * 2, rx: dz * 2 }, 'matte')
        x += dx
        z += dz
        y += length
      }
      for (let index = 0; index < 18; index += 1) {
        const tier = index % 3
        const angle = index * 2.39996 + random() * 0.4
        const height = 0.85 + tier * 0.17 + random() * 0.08
        const size = 0.9 + random() * 0.3
        batch.within({ x: x * (height / y), y: height, z: z * (height / y), ry: angle }, () => {
          batch.add(leaf, greens[index % greens.length]!, { z: 0.09 * size, rx: -(0.35 + random() * 0.5), sx: 0.06 * size, sy: 0.009, sz: 0.1 * size }, 'matte')
        })
      }
      return
    }
    // A full crown of long leaves, the inner ones upright, the outer ones arching out.
    for (let index = 0; index < 26; index += 1) {
      const outer = index / 26
      const angle = index * 2.39996 + random() * 0.3
      const rise = 1.25 - outer * 0.85 + random() * 0.12
      const length = 0.15 + outer * 0.08 + random() * 0.04
      batch.within({ y: 0.37 + random() * 0.03, ry: angle }, () => {
        batch.add(leaf, greens[index % greens.length]!, { y: Math.sin(rise) * length, z: Math.cos(rise) * length, rx: -rise, sx: 0.034, sy: 0.007, sz: length }, 'matte')
      })
    }
  })
}

/** A desk lamp on the desk top: weighted base, two arm sections with their joints, and a shade. */
export function fineDeskLamp(batch: Batch, at: { x: number; z: number; ry?: number }, shade: string, lit: boolean, top = 0.667): void {
  batch.within({ x: at.x, z: at.z, ry: at.ry ?? 0 }, () => {
    batch.add(cylinderShape(0.07, 0.078, 0.022, 28), PLASTIC, { y: top + 0.011 }, 'metal')
    batch.add(sphereShape(0.016, 12, 8), CHROME, { y: top + 0.03 }, 'metal', false)
    batch.add(cylinderShape(0.009, 0.009, 0.24, 10), '#5d6470', { y: top + 0.14, z: 0.03, rx: 0.25 }, 'metal')
    batch.add(sphereShape(0.014, 12, 8), CHROME, { y: top + 0.255, z: 0.06 }, 'metal', false)
    batch.add(cylinderShape(0.008, 0.008, 0.2, 10), '#5d6470', { y: top + 0.29, z: -0.03, rx: -1.2 }, 'metal')
    batch.add(latheShape('desk-lamp-shade', [[0.012, 0], [0.03, 0.01], [0.075, 0.09], [0.08, 0.1]], 32), shade, { y: top + 0.28, z: -0.13, rx: Math.PI * 0.8 }, lit ? 'glow' : 'satin', false)
    if (lit) batch.add(sphereShape(0.022, 12, 8), '#fff4d6', { y: top + 0.24, z: -0.17 }, 'glow', false)
  })
}

/** A mug, its handle and the coffee in it. */
export function fineMug(batch: Batch, at: { x: number; z: number; ry?: number }, colour = '#fbfaf7', top = 0.667): void {
  batch.within({ x: at.x, z: at.z, ry: at.ry ?? 0 }, () => {
    batch.add(latheShape('mug', [[0, 0], [0.036, 0], [0.04, 0.006], [0.042, 0.095], [0.038, 0.095], [0.036, 0.012], [0, 0.012]], 28), colour, { y: top }, 'satin', false)
    batch.add(cylinderShape(0.036, 0.036, 0.004, 24), '#4a2e1f', { y: top + 0.08 }, 'satin', false)
    batch.add(torusShape(0.024, 0.006, Math.PI, 8, 16), colour, { x: 0.042, y: top + 0.05, rz: -Math.PI / 2 }, 'satin', false)
  })
}

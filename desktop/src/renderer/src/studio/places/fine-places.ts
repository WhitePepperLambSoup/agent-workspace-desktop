import * as THREE from 'three'

import { seeded, tone } from '../fine'
import { Batch, boxShape, capsuleShape, coneShape, cylinderShape, latheShape, sphereShape, torusShape } from '../mesh-kit'
import type { palette } from './kit'

/**
 * The places' own pieces in the high graphics setting: a bookcase with its plinth, pilasters and
 * crown; a reading table on turned legs with banker's lamps; a server rack that is a frame, a door
 * and rack units; a tower crane of lattice; campus buildings with steps, columns and cornices.
 * Each stands where the standard piece stands, at the same size, so people, books, lights and
 * labels keep their places.
 */

type Colours = ReturnType<typeof palette>

const BRASS = '#b08d3c'
const GLASS_GREEN = '#2f6b48'

// ---- Library ------------------------------------------------------------------------------------

/** A bookcase whose shelves are at 0.06 + level * levelHeight; it faces +z from its own origin. */
export function fineBookcase(batch: Batch, c: Colours, at: { x: number; z: number; ry?: number }, size: { width: number; height: number; depth: number; levels: number; levelHeight: number }): void {
  const { width, height, depth, levels, levelHeight } = size
  const dark = tone(c.wood, -0.03)
  const light = tone(c.wood, 0.03)
  batch.within({ x: at.x, z: at.z, ry: at.ry ?? 0 }, () => {
    // The plinth, set back a little, and the back boards with their joints.
    batch.add(boxShape(width + 0.02, 0.07, depth - 0.02, 0.008), dark, { y: 0.035 }, 'satin')
    batch.add(boxShape(width, height, 0.025), c.woodLight, { y: height / 2, z: -depth / 2 + 0.014 }, 'matte', false)
    const boards = Math.max(3, Math.round(width / 0.32))
    for (let board = 1; board < boards; board += 1) {
      batch.add(boxShape(0.004, height - 0.1, 0.002), tone(c.woodLight, -0.05), { x: -width / 2 + (width / boards) * board, y: height / 2, z: -depth / 2 + 0.028 }, 'matte', false)
    }
    // Sides with a pilaster on the front: a base, a fluted shaft, a capital.
    for (const side of [-1, 1]) {
      const x = side * (width / 2)
      batch.add(boxShape(0.05, height, depth, 0.008), c.wood, { x, y: height / 2 }, 'satin')
      batch.add(boxShape(0.075, height - 0.2, 0.018, 0.005), light, { x, y: height / 2 + 0.02, z: depth / 2 + 0.008 }, 'satin', false)
      batch.add(boxShape(0.09, 0.09, 0.03, 0.006), dark, { x, y: 0.1, z: depth / 2 + 0.01 }, 'satin', false)
      batch.add(boxShape(0.09, 0.05, 0.03, 0.006), dark, { x, y: height - 0.06, z: depth / 2 + 0.01 }, 'satin', false)
      for (const flute of [-0.018, 0, 0.018]) batch.add(boxShape(0.006, height - 0.36, 0.004), dark, { x: x + flute, y: height / 2 + 0.02, z: depth / 2 + 0.018 }, 'satin', false)
    }
    // Shelves with a lip on the front edge.
    for (let level = 0; level <= levels; level += 1) {
      const y = 0.06 + level * levelHeight
      batch.add(boxShape(width, 0.03, depth - 0.01, 0.006), c.wood, { y }, 'satin')
      batch.add(boxShape(width - 0.04, 0.018, 0.012, 0.004), light, { y: y + 0.002, z: depth / 2 - 0.002 }, 'satin', false)
    }
    // The crown: a frieze and two stepped mouldings.
    batch.add(boxShape(width + 0.08, 0.05, depth + 0.02, 0.008), c.wood, { y: height + 0.025 }, 'satin')
    batch.add(boxShape(width + 0.13, 0.025, depth + 0.05, 0.008), light, { y: height + 0.062 }, 'satin', false)
    batch.add(boxShape(width + 0.18, 0.03, depth + 0.08, 0.01), c.wood, { y: height + 0.09 }, 'satin')
  })
}

const LEG_PROFILE: ReadonlyArray<readonly [number, number]> = [
  [0, 0], [0.028, 0], [0.034, 0.02], [0.024, 0.06], [0.022, 0.2], [0.032, 0.26], [0.024, 0.3],
  [0.03, 0.46], [0.038, 0.52], [0.038, 0.58], [0.03, 0.62], [0.034, 0.7], [0, 0.7],
]
const STOOL_LEG: ReadonlyArray<readonly [number, number]> = [
  [0, 0], [0.016, 0], [0.019, 0.02], [0.014, 0.1], [0.017, 0.26], [0.022, 0.38], [0.022, 0.44], [0, 0.44],
]

/** A library chair whose sitter faces +z: turned legs, a padded seat, a curved back with splats. */
function libraryChair(batch: Batch, c: Colours, at: { x: number; z: number; ry: number }): void {
  batch.within(at, () => {
    for (const [x, z] of [[-0.17, 0.16], [0.17, 0.16], [-0.17, -0.16], [0.17, -0.16]] as const) {
      batch.add(latheShape('library-chair-leg', STOOL_LEG, 12), c.woodLight, { x, z }, 'satin', z > 0)
    }
    batch.add(boxShape(0.42, 0.03, 0.4, 0.012), c.wood, { y: 0.45 }, 'satin')
    batch.add(boxShape(0.38, 0.045, 0.36, 0.02), c.seat, { y: 0.485 }, 'matte')
    for (const side of [-1, 1]) batch.add(boxShape(0.03, 0.46, 0.03, 0.01), c.wood, { x: side * 0.18, y: 0.68, z: -0.19, rx: -0.09 }, 'satin')
    batch.add(boxShape(0.42, 0.06, 0.028, 0.012), c.wood, { y: 0.9, z: -0.21, rx: -0.09 }, 'satin')
    for (const dx of [-0.1, 0, 0.1]) batch.add(boxShape(0.05, 0.26, 0.012, 0.004), c.woodLight, { x: dx, y: 0.72, z: -0.195, rx: -0.09 }, 'satin', false)
  })
}

/** A banker's lamp: a brass foot and stem, a green glass shade. */
function bankersLamp(batch: Batch, x: number, z: number, lit: boolean): void {
  batch.add(latheShape('banker-foot', [[0, 0], [0.075, 0], [0.078, 0.008], [0.05, 0.022], [0.016, 0.03], [0, 0.03]], 24), BRASS, { x, y: 0.75, z }, 'metal', false)
  batch.add(cylinderShape(0.008, 0.008, 0.22, 10), BRASS, { x, y: 0.88, z }, 'metal', false)
  batch.add(capsuleShape(0.007, 0.3, 8), BRASS, { x, y: 0.985, z, rz: Math.PI / 2 }, 'metal', false)
  // The shade: half a cylinder, closed at its ends with brass.
  batch.add(cylinderShape(0.055, 0.055, 0.3, 20), GLASS_GREEN, { x, y: 1.035, z, rz: Math.PI / 2, sy: 1 }, lit ? 'glow' : 'satin', false)
  for (const side of [-1, 1]) batch.add(cylinderShape(0.058, 0.058, 0.008, 20), BRASS, { x: x + side * 0.152, y: 1.035, z, rz: Math.PI / 2 }, 'metal', false)
}

/** A reading table at the height of the standard one (top at 0.75), with chairs and lamps. */
export function fineReadingTable(batch: Batch, c: Colours, at: { x: number; z: number }, dark: boolean): void {
  const { x, z } = at
  // The top with a thumbnail edge, the apron and turned legs joined by a stretcher.
  batch.add(boxShape(2.4, 0.04, 0.95, 0.016), tone(c.wood, 0.02), { x, y: 0.73, z }, 'satin')
  batch.add(boxShape(2.44, 0.018, 0.99, 0.008), c.wood, { x, y: 0.712, z }, 'satin', false)
  batch.add(boxShape(2.1, 0.09, 0.72, 0.008), c.wood, { x, y: 0.655, z }, 'satin')
  for (const [dx, dz] of [[-1.1, -0.38], [1.1, -0.38], [-1.1, 0.38], [1.1, 0.38]] as const) {
    batch.add(latheShape('reading-table-leg', LEG_PROFILE, 16), c.woodLight, { x: x + dx, z: z + dz }, 'satin')
  }
  batch.add(boxShape(2.2, 0.03, 0.04, 0.01), c.woodLight, { x, y: 0.16, z }, 'satin', false)
  for (const dx of [-1.1, 1.1]) batch.add(boxShape(0.03, 0.03, 0.76, 0.01), c.woodLight, { x: x + dx, y: 0.16, z }, 'satin', false)
  // A leather inlay at each place, a chair on each side and a lamp between them.
  for (const dx of [-0.5, 0.5]) {
    for (const side of [-1, 1]) {
      batch.add(boxShape(0.5, 0.002, 0.26, 0.001), dark ? '#2f4436' : '#3f6b52', { x: x + dx, y: 0.751, z: z + side * 0.26 }, 'satin', false)
      libraryChair(batch, c, { x: x + dx, z: z + side * 0.72, ry: side > 0 ? Math.PI : 0 })
    }
    bankersLamp(batch, x + dx, z, dark)
  }
}

/** The cart of documents: tubular frame, two shelves with rails, a push bar, swivel casters. */
export function fineCart(batch: Batch, c: Colours, x: number, z: number): void {
  for (const y of [0.35, 0.75]) {
    batch.add(boxShape(0.9, 0.022, 0.5, 0.008), c.metal, { x, y, z }, 'metal')
    for (const side of [-1, 1]) batch.add(capsuleShape(0.008, 0.84, 8), tone(c.metal, 0.06), { x, y: y + 0.045, z: z + side * 0.24, rz: Math.PI / 2 }, 'metal', false)
    for (const side of [-1, 1]) batch.add(capsuleShape(0.008, 0.44, 8), tone(c.metal, 0.06), { x: x + side * 0.44, y: y + 0.045, z, rx: Math.PI / 2 }, 'metal', false)
  }
  for (const [dx, dz] of [[-0.43, -0.23], [0.43, -0.23], [-0.43, 0.23], [0.43, 0.23]] as const) {
    batch.add(cylinderShape(0.012, 0.012, 0.8, 10), c.metal, { x: x + dx, y: 0.47, z: z + dz }, 'metal', false)
    batch.add(boxShape(0.03, 0.03, 0.04, 0.006), '#3a3f4b', { x: x + dx, y: 0.075, z: z + dz }, 'satin', false)
    batch.add(cylinderShape(0.038, 0.038, 0.026, 16), '#2a2d35', { x: x + dx, y: 0.038, z: z + dz, rz: Math.PI / 2 }, 'satin', false)
  }
  batch.add(capsuleShape(0.012, 0.42, 10), '#2a2d35', { x: x + 0.45, y: 0.98, z, rx: Math.PI / 2 }, 'satin', false)
  for (const side of [-1, 1]) batch.add(cylinderShape(0.01, 0.01, 0.2, 8), c.metal, { x: x + 0.45, y: 0.88, z: z + side * 0.2 }, 'metal', false)
}

/** The scanner: a cabinet with a lid on hinges, its glass, a feed tray and a status light. */
export function fineScanner(batch: Batch, x: number, z: number, dark: boolean): void {
  const body = dark ? '#c9ccd2' : '#eef0f3'
  batch.add(boxShape(0.72, 0.06, 0.62, 0.01), '#2a2d35', { x, y: 0.03, z }, 'satin')
  batch.add(boxShape(0.7, 0.82, 0.6, 0.025), body, { x, y: 0.47, z }, 'satin')
  batch.add(boxShape(0.003, 0.74, 0.5), tone(body, -0.1), { x: x - 0.352, y: 0.47, z }, 'matte', false)
  batch.add(boxShape(0.5, 0.24, 0.006, 0.002), tone(body, -0.08), { x, y: 0.3, z: z + 0.301 }, 'matte', false)
  batch.add(boxShape(0.16, 0.012, 0.012, 0.004), '#7a808c', { x, y: 0.36, z: z + 0.308 }, 'metal', false)
  batch.add(boxShape(0.66, 0.012, 0.54), '#1d2027', { x, y: 0.885, z }, 'metal', false)
  batch.add(boxShape(0.68, 0.04, 0.56, 0.012), tone(body, -0.04), { x, y: 0.915, z, rx: -0.03 }, 'satin')
  batch.add(boxShape(0.4, 0.008, 0.2, 0.002), tone(body, -0.14), { x, y: 0.94, z: z + 0.1 }, 'matte', false)
  batch.add(boxShape(0.13, 0.08, 0.008, 0.002), '#16181d', { x: x + 0.22, y: 0.76, z: z + 0.302 }, 'satin', false)
  batch.add(sphereShape(0.01, 8, 6), '#38d39f', { x: x + 0.22, y: 0.7, z: z + 0.304 }, 'glow', false)
}

// ---- Server room --------------------------------------------------------------------------------

/**
 * A server rack: posts, top and base frames, a plinth, a vented door with a handle, and behind the
 * door's mesh the fronts of the rack units. Its status lights stay where the standard rack has them.
 */
export function fineRack(batch: Batch, at: { x: number; z: number }, size: { width: number; height: number; depth: number }, local: boolean, accent: string): void {
  const { width, height, depth } = size
  const steel = local ? '#2b3140' : '#23262e'
  const front = depth / 2
  batch.within({ x: at.x, z: at.z }, () => {
    batch.add(boxShape(width + 0.02, 0.07, depth + 0.02, 0.008), '#16181d', { y: 0.035 }, 'satin')
    batch.add(boxShape(width, height - 0.07, depth, 0.012), steel, { y: 0.07 + (height - 0.07) / 2 }, 'satin')
    // The roof with its vent slots, and a cable brush.
    batch.add(boxShape(width + 0.012, 0.03, depth + 0.012, 0.008), tone(steel, 0.03), { y: height + 0.012 }, 'satin', false)
    for (let slot = 0; slot < 5; slot += 1) batch.add(boxShape(width - 0.16, 0.004, 0.022), '#101216', { y: height + 0.028, z: -depth / 2 + 0.2 + slot * 0.1 }, 'matte', false)
    batch.add(boxShape(0.2, 0.008, 0.08, 0.002), '#090a0c', { x: -width / 4, y: height + 0.03, z: -depth / 2 + 0.1 }, 'matte', false)
    // The door: a frame, a dark mesh, and the units behind it.
    for (const side of [-1, 1]) batch.add(boxShape(0.04, height - 0.1, 0.022, 0.006), tone(steel, 0.05), { x: side * (width / 2 - 0.02), y: height / 2 + 0.02, z: front + 0.008 }, 'satin', false)
    for (const y of [0.09, height - 0.03]) batch.add(boxShape(width, 0.04, 0.022, 0.006), tone(steel, 0.05), { y, z: front + 0.008 }, 'satin', false)
    batch.add(boxShape(width - 0.08, height - 0.14, 0.006), '#0d0e11', { y: height / 2 + 0.02, z: front + 0.002 }, 'matte', false)
    for (let unit = 0; unit < 10; unit += 1) {
      const y = 0.17 + unit * 0.18
      batch.add(boxShape(width - 0.12, 0.15, 0.008, 0.002), unit % 3 === 0 ? '#2a2f39' : '#1f2229', { y, z: front + 0.008 }, 'satin', false)
      for (const side of [-1, 1]) batch.add(boxShape(0.012, 0.03, 0.004), '#7a808c', { x: side * (width / 2 - 0.075), y, z: front + 0.014 }, 'metal', false)
      if (unit % 3 !== 1) for (let bay = 0; bay < 6; bay += 1) batch.add(boxShape(0.05, 0.018, 0.003), '#343945', { x: -0.2 + bay * 0.08, y: y - 0.05, z: front + 0.014 }, 'matte', false)
    }
    batch.add(boxShape(0.022, 0.2, 0.024, 0.008), '#aeb5bf', { x: width / 2 - 0.02, y: height / 2 + 0.05, z: front + 0.026 }, 'metal', false)
    batch.add(boxShape(0.16, 0.05, 0.002), '#e9e4dc', { x: -width / 2 + 0.12, y: height - 0.075, z: front + 0.021 }, 'satin', false)
    if (local) batch.add(boxShape(width + 0.02, 0.018, 0.012), accent, { y: height - 0.008, z: front + 0.022 }, 'glow', false)
    // Cables up to the tray.
    for (let cable = 0; cable < 3; cable += 1) {
      batch.add(cylinderShape(0.008, 0.008, 2.36 - height, 6), ['#3f88c5', '#e0a13a', '#4f8a5b'][cable]!, { x: -width / 4 + cable * 0.03, y: (2.36 + height) / 2, z: -depth / 2 + 0.1 }, 'satin', false)
    }
  })
}

/** The air conditioner on the left wall: a cabinet, its louvres, a display and a pipe to the ceiling. */
export function fineCooler(batch: Batch, x: number, z: number, dark: boolean): void {
  const body = dark ? '#c9ccd2' : '#eef0f3'
  batch.add(boxShape(0.5, 0.08, 1.3, 0.01), '#3a3f4b', { x, y: 0.04, z }, 'satin')
  batch.add(boxShape(0.5, 1.82, 1.3, 0.03), body, { x, y: 0.99, z }, 'satin')
  batch.add(boxShape(0.006, 0.86, 1.14, 0.002), tone(body, -0.12), { x: x + 0.253, y: 1.42, z }, 'matte', false)
  for (let slat = 0; slat < 11; slat += 1) batch.add(boxShape(0.022, 0.028, 1.1, 0.004), tone(body, -0.03), { x: x + 0.262, y: 1.04 + slat * 0.075, z, rz: -0.35 }, 'satin', false)
  batch.add(boxShape(0.006, 0.6, 1.14, 0.002), tone(body, -0.05), { x: x + 0.253, y: 0.45, z }, 'matte', false)
  for (let row = 0; row < 8; row += 1) batch.add(boxShape(0.004, 0.012, 1.02), tone(body, -0.2), { x: x + 0.257, y: 0.2 + row * 0.072, z }, 'matte', false)
  batch.add(boxShape(0.008, 0.1, 0.22, 0.002), '#16181d', { x: x + 0.256, y: 0.86, z: z - 0.34 }, 'satin', false)
  batch.add(boxShape(0.003, 0.05, 0.14), '#38d39f', { x: x + 0.261, y: 0.87, z: z - 0.34 }, 'glow', false)
  batch.add(cylinderShape(0.05, 0.05, 0.48, 14), '#aeb5bf', { x: x - 0.1, y: 2.14, z: z - 0.4 }, 'metal', false)
}

// ---- Building site ------------------------------------------------------------------------------

/** The site office: a cabin of ribbed steel on blocks, with a framed window, a door and steps. */
export function fineCabin(batch: Batch, c: Colours, x: number, z: number, dark: boolean): void {
  const steel = dark ? '#c9a43a' : '#e8c547'
  const trim = tone(steel, -0.12)
  for (const dx of [-0.85, 0.85]) batch.add(boxShape(0.3, 0.18, 1.0, 0.01), '#7a7a7a', { x: x + dx, y: 0.09, z }, 'matte')
  batch.add(boxShape(2.14, 0.06, 1.24, 0.006), trim, { x, y: 0.2, z }, 'satin')
  batch.add(boxShape(2.1, 1.2, 1.2, 0.01), steel, { x, y: 0.82, z }, 'satin')
  // Ribs of the steel skin on the front and the end the camera sees.
  for (let rib = 0; rib < 22; rib += 1) batch.add(boxShape(0.022, 1.16, 0.008, 0.002), tone(steel, rib % 2 ? 0.03 : -0.03), { x: x - 1.02 + rib * 0.097, y: 0.82, z: z + 0.603 }, 'satin', false)
  for (let rib = 0; rib < 12; rib += 1) batch.add(boxShape(0.008, 1.16, 0.022, 0.002), tone(steel, rib % 2 ? 0.03 : -0.03), { x: x + 1.053, y: 0.82, z: z - 0.55 + rib * 0.1 }, 'satin', false)
  // The roof, a little over the walls, and corner posts.
  batch.add(boxShape(2.22, 0.06, 1.32, 0.008), c.trim, { x, y: 1.45, z }, 'satin')
  batch.add(boxShape(2.1, 0.05, 1.2, 0.008), tone(c.trim, -0.05), { x, y: 1.5, z }, 'satin', false)
  for (const [dx, dz] of [[-1.05, 0.6], [1.05, 0.6], [1.05, -0.6]] as const) batch.add(boxShape(0.05, 1.28, 0.05, 0.006), trim, { x: x + dx, y: 0.84, z: z + dz }, 'satin', false)
  // The window: frame, glass, a middle bar and a sill.
  batch.add(boxShape(0.8, 0.55, 0.018, 0.004), '#3a3f4b', { x: x - 0.35, y: 0.95, z: z + 0.612 }, 'satin', false)
  batch.add(boxShape(0.7, 0.45, 0.004), c.sky, { x: x - 0.35, y: 0.95, z: z + 0.622 }, 'glow', false)
  batch.add(boxShape(0.02, 0.46, 0.01), '#3a3f4b', { x: x - 0.35, y: 0.95, z: z + 0.625 }, 'satin', false)
  batch.add(boxShape(0.86, 0.022, 0.05, 0.004), trim, { x: x - 0.35, y: 0.665, z: z + 0.63 }, 'satin', false)
  // The door: frame, panel, a handle, and steel steps with a rail.
  batch.add(boxShape(0.46, 1.0, 0.016, 0.004), '#3a3f4b', { x: x + 0.6, y: 0.7, z: z + 0.612 }, 'satin', false)
  batch.add(boxShape(0.38, 0.92, 0.012, 0.004), '#5d6470', { x: x + 0.6, y: 0.69, z: z + 0.62 }, 'satin', false)
  batch.add(boxShape(0.22, 0.26, 0.004), c.sky, { x: x + 0.6, y: 0.95, z: z + 0.628 }, 'glow', false)
  batch.add(capsuleShape(0.008, 0.08, 8), '#c3c9d2', { x: x + 0.75, y: 0.68, z: z + 0.635 }, 'metal', false)
  for (const [step, y] of [[0, 0.17], [1, 0.08]] as const) batch.add(boxShape(0.52, 0.03, 0.2, 0.004), '#6b7280', { x: x + 0.6, y, z: z + 0.71 + step * 0.17 }, 'metal')
  for (const side of [-1, 1]) {
    batch.add(cylinderShape(0.01, 0.01, 0.62, 8), '#c3c9d2', { x: x + 0.6 + side * 0.26, y: 0.34, z: z + 0.9 }, 'metal', false)
    batch.add(capsuleShape(0.01, 0.28, 8), '#c3c9d2', { x: x + 0.6 + side * 0.26, y: 0.65, z: z + 0.78, rx: Math.PI / 2 + 0.12 }, 'metal', false)
  }
}

/** The fence of the site: posts on feet, mesh panels with a top and a bottom rail. */
export function fineFence(batch: Batch, dark: boolean, along: 'x' | 'z', at: number, from: number, to: number): void {
  const steel = dark ? '#8a93a3' : '#9aa1ab'
  const place = (u: number, offsetAcross = 0): { x: number; z: number } => (along === 'x' ? { x: u, z: at + offsetAcross } : { x: at + offsetAcross, z: u })
  const length = to - from
  const panels = Math.max(1, Math.round(length / 1.2))
  const step = length / panels
  for (let index = 0; index <= panels; index += 1) {
    const u = from + index * step
    batch.add(cylinderShape(0.02, 0.022, 1.25, 10), steel, { ...place(u), y: 0.65 }, 'metal')
    batch.add(boxShape(0.2, 0.05, 0.28, 0.01), '#4a4f5a', { ...place(u), y: 0.025 }, 'matte', false)
  }
  for (const y of [0.14, 1.22]) {
    const size = along === 'x' ? boxShape(length, 0.022, 0.022) : boxShape(0.022, 0.022, length)
    batch.add(size, steel, { ...place((from + to) / 2), y }, 'metal', false)
  }
  const wires = Math.round(length / 0.12)
  for (let wire = 1; wire < wires; wire += 1) {
    const u = from + (length / wires) * wire
    batch.add(boxShape(0.004, 1.08, 0.004), steel, { ...place(u), y: 0.68 }, 'metal', false)
  }
  for (let row = 1; row < 8; row += 1) {
    const size = along === 'x' ? boxShape(length, 0.004, 0.004) : boxShape(0.004, 0.004, length)
    batch.add(size, steel, { ...place((from + to) / 2), y: 0.14 + row * 0.135 }, 'metal', false)
  }
}

const CRANE_YELLOW = '#e0a13a'

/** The crane's mast: four chords tied with rungs and braces, on a ballasted base. */
export function fineCraneMast(batch: Batch, x: number, z: number, height: number): void {
  batch.add(boxShape(1.0, 0.12, 1.0, 0.01), '#4a4f5a', { x, y: 0.06, z }, 'metal')
  for (const [dx, dz] of [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]] as const) batch.add(boxShape(0.34, 0.24, 0.34, 0.012), '#7a7a7a', { x: x + dx, y: 0.24, z: z + dz }, 'matte')
  const half = 0.18
  for (const [dx, dz] of [[-half, -half], [half, -half], [-half, half], [half, half]] as const) {
    batch.add(boxShape(0.035, height - 0.3, 0.035, 0.004), CRANE_YELLOW, { x: x + dx, y: 0.3 + (height - 0.3) / 2, z: z + dz }, 'metal')
  }
  const bay = 0.42
  const brace = Math.hypot(half * 2, bay)
  const angle = Math.atan2(half * 2, bay)
  for (let y = 0.3; y < height - 0.05; y += bay) {
    for (const side of [-1, 1]) {
      batch.add(boxShape(half * 2, 0.016, 0.016), CRANE_YELLOW, { x, y, z: z + side * half }, 'metal', false)
      batch.add(boxShape(0.016, 0.016, half * 2), CRANE_YELLOW, { x: x + side * half, y, z }, 'metal', false)
      batch.add(boxShape(0.012, brace, 0.012), CRANE_YELLOW, { x, y: y + bay / 2, z: z + side * half, rz: side * angle }, 'metal', false)
      batch.add(boxShape(0.012, brace, 0.012), CRANE_YELLOW, { x: x + side * half, y: y + bay / 2, z, rx: side * angle }, 'metal', false)
    }
  }
}

/**
 * The turning part, in its own frame (the jib toward -x, the counter-jib toward +x): the slewing
 * ring, the operator's cab, a triangular lattice jib with its tie to the tower head, and the
 * counterweights.
 */
export function fineCraneJib(batch: Batch, dark: boolean): void {
  const length = 6.4
  const height = 0.3
  batch.add(cylinderShape(0.3, 0.3, 0.1, 24), '#4a4f5a', { y: -0.1 }, 'metal')
  // The tower head and its ties.
  batch.add(boxShape(0.04, 0.9, 0.04, 0.004), CRANE_YELLOW, { x: -0.1, y: 0.45, z: -0.1 }, 'metal')
  batch.add(boxShape(0.04, 0.9, 0.04, 0.004), CRANE_YELLOW, { x: -0.1, y: 0.45, z: 0.1 }, 'metal')
  batch.add(boxShape(0.04, 0.9, 0.04, 0.004), CRANE_YELLOW, { x: 0.1, y: 0.45, z: 0 }, 'metal')
  const tieLong = Math.hypot(4.6, 0.72)
  batch.add(cylinderShape(0.006, 0.006, tieLong, 5), '#2a2d35', { x: -2.3, y: 0.56, rz: Math.atan2(4.6, 0.72) }, 'metal', false)
  const tieShort = Math.hypot(1.8, 0.8)
  batch.add(cylinderShape(0.006, 0.006, tieShort, 5), '#2a2d35', { x: 0.9, y: 0.5, rz: -Math.atan2(1.8, 0.8) }, 'metal', false)
  // The jib: two bottom chords, one on top, rungs and diagonals along it.
  for (const side of [-1, 1]) batch.add(boxShape(length, 0.026, 0.026, 0.004), CRANE_YELLOW, { x: -length / 2, y: 0, z: side * 0.11 }, 'metal')
  batch.add(boxShape(length, 0.026, 0.026, 0.004), CRANE_YELLOW, { x: -length / 2, y: height }, 'metal')
  const bay = 0.4
  const diagonal = Math.hypot(0.11, height)
  const lean = Math.atan2(0.11, height)
  const run = Math.hypot(bay / 2, height)
  const runLean = Math.atan2(bay / 2, height)
  for (let u = 0; u < length - 0.01; u += bay) {
    batch.add(boxShape(0.012, 0.012, 0.22), CRANE_YELLOW, { x: -u, y: 0 }, 'metal', false)
    for (const side of [-1, 1]) {
      batch.add(boxShape(0.01, diagonal, 0.01), CRANE_YELLOW, { x: -u, y: height / 2, z: side * 0.055, rx: side * lean }, 'metal', false)
      batch.add(boxShape(0.01, run, 0.01), CRANE_YELLOW, { x: -u - bay / 4, y: height / 2, z: side * 0.055, rz: runLean }, 'metal', false)
    }
  }
  // The counter-jib with a walkway and blocks of concrete, and the winch.
  for (const side of [-1, 1]) batch.add(boxShape(1.9, 0.03, 0.03, 0.004), CRANE_YELLOW, { x: 0.95, y: 0, z: side * 0.16 }, 'metal')
  batch.add(boxShape(1.8, 0.012, 0.3), '#6b7280', { x: 0.95, y: 0.01 }, 'metal', false)
  for (let block = 0; block < 3; block += 1) batch.add(boxShape(0.22, 0.42, 0.42, 0.012), '#8a8a8a', { x: 1.42 + block * 0.23, y: -0.18 }, 'matte')
  batch.add(cylinderShape(0.09, 0.09, 0.22, 16), '#3a3f4b', { x: 0.75, y: 0.12, rx: Math.PI / 2 }, 'metal', false)
  batch.add(boxShape(0.3, 0.2, 0.3, 0.012), '#6b7280', { x: 0.42, y: 0.12 }, 'metal', false)
  // The cab under the jib: a shell, tinted glass on three sides, a handrail.
  const shell = dark ? '#c9ccd2' : '#eef0f3'
  batch.add(boxShape(0.48, 0.5, 0.42, 0.024), shell, { x: -0.2, y: -0.32, z: 0.2 }, 'satin')
  batch.add(boxShape(0.3, 0.3, 0.006), dark ? '#1d2e5c' : '#9fc9e6', { x: -0.24, y: -0.26, z: 0.412 }, 'glass', false)
  batch.add(boxShape(0.006, 0.3, 0.3), dark ? '#1d2e5c' : '#9fc9e6', { x: -0.442, y: -0.26, z: 0.2 }, 'glass', false)
}

/** A hook block: two sheaves in side plates, a shank and the hook itself. */
export function fineHook(batch: Batch): void {
  batch.add(boxShape(0.1, 0.08, 0.05, 0.008), '#e0a13a', { y: 0.02 }, 'metal')
  for (const side of [-1, 1]) batch.add(cylinderShape(0.03, 0.03, 0.008, 14), '#2a2d35', { y: 0.035, z: side * 0.028, rx: Math.PI / 2 }, 'metal', false)
  batch.add(cylinderShape(0.007, 0.007, 0.05, 8), '#2a2d35', { y: -0.04 }, 'metal', false)
  batch.add(torusShape(0.024, 0.006, Math.PI * 1.5, 8, 16), '#2a2d35', { y: -0.082, rz: Math.PI / 4 }, 'metal', false)
}

/** The site's truck: a cab with its windscreen and a box body on a chassis, wheels with hubs. */
export function fineTruck(batch: Batch, x: number, z: number, skyColour: string): void {
  batch.add(boxShape(0.64, 0.05, 1.7, 0.01), '#2a2d35', { x, y: 0.2, z: z + 0.2 }, 'metal')
  batch.add(boxShape(0.75, 0.6, 1.02, 0.012), '#f2f2f2', { x, y: 0.53, z }, 'satin')
  for (let rib = 0; rib < 7; rib += 1) batch.add(boxShape(0.76, 0.58, 0.012, 0.002), '#dfe2e6', { x, y: 0.53, z: z - 0.45 + rib * 0.15 }, 'satin', false)
  batch.add(boxShape(0.72, 0.4, 0.44, 0.05), '#3f88c5', { x, y: 0.42, z: z + 0.74 }, 'satin')
  batch.add(boxShape(0.68, 0.22, 0.36, 0.05), '#3f88c5', { x, y: 0.68, z: z + 0.7 }, 'satin')
  batch.add(boxShape(0.6, 0.18, 0.006, 0.002), skyColour, { x, y: 0.69, z: z + 0.882 }, 'glow', false)
  for (const side of [-1, 1]) {
    batch.add(boxShape(0.006, 0.15, 0.26), skyColour, { x: x + side * 0.343, y: 0.7, z: z + 0.7 }, 'glow', false)
    batch.add(sphereShape(0.03, 10, 8), '#fff3c4', { x: x + side * 0.26, y: 0.32, z: z + 0.962, sz: 0.4 }, 'glow', false)
  }
  batch.add(boxShape(0.74, 0.06, 0.04, 0.01), '#2a2d35', { x, y: 0.24, z: z + 0.96 }, 'metal', false)
  for (const [dx, dz] of [[-0.36, -0.28], [0.36, -0.28], [-0.36, 0.72], [0.36, 0.72]] as const) {
    batch.add(cylinderShape(0.12, 0.12, 0.08, 20), '#1d2027', { x: x + dx, y: 0.12, z: z + dz, rz: Math.PI / 2 }, 'satin')
    batch.add(cylinderShape(0.06, 0.06, 0.084, 14), '#aeb5bf', { x: x + dx, y: 0.12, z: z + dz, rz: Math.PI / 2 }, 'metal', false)
  }
}

/**
 * Windows and floors on the buildings of the site, whatever their size: worked out per pixel from
 * the world position, so an instanced box of any height has the same storeys and none is stretched.
 */
export function addFacades(material: THREE.MeshStandardMaterial): void {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFacadePosition;\nvarying vec3 vFacadeNormal;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vFacadePosition = (modelMatrix * instanceMatrix * vec4(position, 1.0)).xyz;
        #else
          vFacadePosition = (modelMatrix * vec4(position, 1.0)).xyz;
        #endif
        vFacadeNormal = normal;`)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFacadePosition;\nvarying vec3 vFacadeNormal;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        if (abs(vFacadeNormal.y) < 0.5) {
          float across = abs(vFacadeNormal.z) > 0.5 ? vFacadePosition.x : vFacadePosition.z;
          vec2 cell = fract(vec2(across / 0.052, vFacadePosition.y / 0.078));
          vec2 pane = smoothstep(vec2(0.2, 0.26), vec2(0.27, 0.32), cell) * (1.0 - smoothstep(vec2(0.73, 0.68), vec2(0.8, 0.74), cell));
          float glass = pane.x * pane.y * step(0.07, vFacadePosition.y);
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.28 + vec3(0.05, 0.08, 0.13), glass);
        } else {
          diffuseColor.rgb *= 0.72;
        }`)
  }
  material.customProgramCacheKey = () => 'site-facades'
}

// ---- Campus -------------------------------------------------------------------------------------

const COLUMN_PROFILE: ReadonlyArray<readonly [number, number]> = [
  [0, 0], [0.2, 0], [0.2, 0.05], [0.16, 0.08], [0.145, 0.12], [0.138, 1.2], [0.118, 2.0], [0.13, 2.04], [0.18, 2.1], [0.18, 2.15], [0, 2.15],
]

/** The library's front: steps, a portico of columns, an entablature and a pediment over it. */
export function fineLibraryFront(batch: Batch, x: number, z: number, stone: string, wall: string, roof: string): void {
  for (let step = 0; step < 3; step += 1) batch.add(boxShape(5.5 - step * 0.2, 0.1, 3.9 - step * 0.2, 0.012), tone(stone, step * 0.01), { x, y: 0.05 + step * 0.1, z }, 'matte')
  batch.add(boxShape(4.6, 2.2, 2.8, 0.012), wall, { x, y: 1.4, z: z - 0.2 }, 'satin')
  batch.add(boxShape(4.7, 0.12, 2.9, 0.01), stone, { x, y: 0.36, z: z - 0.2 }, 'satin', false)
  for (let index = 0; index < 6; index += 1) batch.add(latheShape('campus-column', COLUMN_PROFILE, 20), stone, { x: x - 2.0 + index * 0.8, y: 0.3, z: z + 1.45 }, 'satin')
  batch.add(boxShape(4.96, 0.1, 3.3, 0.01), stone, { x, y: 2.5, z }, 'satin')
  batch.add(boxShape(5.06, 0.08, 3.4, 0.01), tone(stone, 0.03), { x, y: 2.6, z }, 'satin')
  batch.add(boxShape(5.16, 0.06, 3.5, 0.01), stone, { x, y: 2.67, z }, 'satin')
  // The pediment: a prism, its tympanum set back.
  const shape = new THREE.Shape()
  shape.moveTo(-2.6, 0)
  shape.lineTo(2.6, 0)
  shape.lineTo(0, 0.78)
  shape.closePath()
  const prism = new THREE.ExtrudeGeometry(shape, { depth: 3.5, bevelEnabled: false })
  prism.translate(0, 0, -1.75)
  batch.add(prism, roof, { x, y: 2.7, z }, 'satin')
  prism.dispose()
  const face = new THREE.Shape()
  face.moveTo(-2.25, 0.06)
  face.lineTo(2.25, 0.06)
  face.lineTo(0, 0.68)
  face.closePath()
  const tympanum = new THREE.ExtrudeGeometry(face, { depth: 0.02, bevelEnabled: false })
  batch.add(tympanum, stone, { x, y: 2.7, z: z + 1.74 }, 'satin', false)
  tympanum.dispose()
  batch.add(boxShape(0.9, 1.5, 0.04, 0.01), tone(wall, -0.2), { x, y: 1.05, z: z + 1.215 }, 'satin', false)
  batch.add(boxShape(0.8, 1.42, 0.02, 0.006), '#4e3b2c', { x, y: 1.03, z: z + 1.235 }, 'satin', false)
}

/** A tree of several rounded crowns with a trunk that forks, rather than two dodecahedra. */
export function fineTree(batch: Batch, leaf: string, leafLight: string, x: number, z: number, scale: number, seed: number): void {
  const random = seeded(seed + 1)
  batch.add(latheShape('tree-trunk', [[0, 0], [0.13, 0], [0.09, 0.14], [0.075, 0.5], [0.05, 0.92], [0, 0.92]], 10), '#5b4636', { x, z, ry: seed, sx: scale, sy: scale, sz: scale }, 'matte')
  for (const side of [-1, 1]) batch.add(cylinderShape(0.015, 0.03, 0.42, 6), '#5b4636', { x: x + side * 0.1 * scale, y: 0.98 * scale, z, rz: -side * 0.5 }, 'matte', false)
  const crowns = 7
  for (let index = 0; index < crowns; index += 1) {
    const angle = (index / crowns) * Math.PI * 2 + random()
    const reach = index === 0 ? 0 : 0.28 + random() * 0.2
    const size = (index === 0 ? 0.58 : 0.3 + random() * 0.14) * scale
    batch.add(sphereShape(1, 12, 9), index % 2 === 0 ? leaf : leafLight, {
      x: x + Math.sin(angle) * reach * scale,
      y: (1.25 + (index === 0 ? 0.12 : (random() - 0.4) * 0.5)) * scale,
      z: z + Math.cos(angle) * reach * scale,
      sx: size, sy: size * 0.86, sz: size,
    }, 'matte', index < 3)
  }
}

/** A street lamp: a stepped foot, a tapering pole, an arm and a glass globe in its collar. */
export function fineStreetLamp(batch: Batch, c: Colours, x: number, z: number, lit: boolean): void {
  batch.add(latheShape('lamp-post', [[0, 0], [0.13, 0], [0.13, 0.06], [0.08, 0.1], [0.07, 0.34], [0.05, 0.38], [0.035, 2.4], [0, 2.4]], 16), c.metal, { x, z }, 'metal')
  batch.add(torusShape(0.08, 0.012, Math.PI * 2, 8, 16), c.metal, { x, y: 2.42, z, rx: Math.PI / 2 }, 'metal', false)
  batch.add(sphereShape(0.15, 20, 14), '#ffe2a8', { x, y: 2.58, z }, lit ? 'glow' : 'satin', false)
  batch.add(coneShape(0.11, 0.06, 16), c.metal, { x, y: 2.76, z }, 'metal', false)
}

/** The fountain in the plaza: a turned basin, water, a second bowl on a stem. */
export function fineFountain(batch: Batch, stone: string, water: string): void {
  batch.add(latheShape('fountain-basin', [[0, 0], [1.02, 0], [1.02, 0.1], [0.94, 0.14], [0.94, 0.32], [1.0, 0.36], [0.88, 0.38], [0.84, 0.16], [0, 0.16]], 40), stone, {}, 'satin')
  batch.add(cylinderShape(0.86, 0.86, 0.02, 36), water, { y: 0.32 }, 'glass', false)
  batch.add(latheShape('fountain-stem', [[0, 0], [0.16, 0], [0.09, 0.1], [0.07, 0.42], [0.12, 0.5], [0.34, 0.6], [0.36, 0.66], [0.26, 0.62], [0, 0.6]], 24), stone, { y: 0.16 }, 'satin')
  batch.add(cylinderShape(0.26, 0.26, 0.01, 20), water, { y: 0.8 }, 'glass', false)
}

/** A cornice and a band of frames on a plain block: it reads as built, not as a box. */
export function fineBlockTrim(batch: Batch, at: { x: number; z: number; width: number; depth: number; height: number }, wall: string, roof: string): void {
  const { x, z, width, depth, height } = at
  batch.add(boxShape(width + 0.08, 0.12, depth + 0.08, 0.01), tone(wall, -0.1), { x, y: 0.06, z }, 'satin', false)
  batch.add(boxShape(width + 0.1, 0.05, depth + 0.1, 0.01), tone(wall, 0.04), { x, y: height - 0.02, z }, 'satin', false)
  batch.add(boxShape(width + 0.18, 0.05, depth + 0.18, 0.01), roof, { x, y: height + 0.03, z }, 'satin', false)
  for (const [dx, dz] of [[-width / 2, depth / 2], [width / 2, depth / 2]] as const) {
    batch.add(boxShape(0.08, height - 0.14, 0.08, 0.008), tone(wall, 0.03), { x: x + dx, y: height / 2, z: z + dz }, 'satin', false)
  }
}

/** A frame around a window or door on the front wall. */
export function fineFrame(batch: Batch, x: number, y: number, z: number, width: number, height: number, colour: string): void {
  for (const side of [-1, 1]) batch.add(boxShape(0.05, height + 0.1, 0.03, 0.006), colour, { x: x + side * (width / 2 + 0.025), y, z }, 'satin', false)
  batch.add(boxShape(width + 0.18, 0.05, 0.05, 0.006), colour, { x, y: y + height / 2 + 0.05, z }, 'satin', false)
  batch.add(boxShape(width + 0.14, 0.04, 0.06, 0.006), colour, { x, y: y - height / 2 - 0.04, z }, 'satin', false)
}

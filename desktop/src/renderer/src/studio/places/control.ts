import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

import type { ActorLook } from '../cast'
import type { Place } from '../layout'
import { fineChair } from '../fine'
import { Batch, boxShape, cylinderShape, shapeDetail, type Finishes } from '../mesh-kit'
import { FloorGrid } from '../paths'
import type { Action } from '../person'
import { CONTROL_STATIONS, type StationState } from './models'
import { ROOM_BOX, disposeGeometry, floor, group, palette, plant, walls } from './kit'
import type { CrowdActor, PlaceBuilder, PlaceLabel } from './stage'
import type { PlaceInput } from './types'

/**
 * The control room: one console for each conversation at work, its agent seated at it facing a
 * wall of screens and its experts and helpers beside it. Each console's monitors and its tile on
 * the wall are lit in the console's state. A click on a console or anyone at it shows that
 * conversation beside the room.
 */

export interface ControlPersonView {
  id: string
  name: string
  state: CrowdActor['state']
  stateLabel: string
  look: ActorLook
  action: Action
  bubble?: string
}

export interface ControlStationView {
  sessionId: string
  title: string
  detail: string
  tone?: 'busy' | 'alert'
  state: StationState
  people: ControlPersonView[]
}

export interface ControlView {
  /** One per console; null where a console is free. */
  slots: Array<ControlStationView | null>
  empty: string | null
}

const consoleAt = (index: number): { x: number; z: number } => ({ x: -3.8 + (index % 3) * 3.8, z: index < 3 ? -1.4 : 2.0 })
const WALL = { y: 1.72, z: ROOM_BOX.z0 + 0.07, width: 1.5, height: 0.82, gap: 0.16 }
const tileX = (index: number): number => (index - (CONTROL_STATIONS - 1) / 2) * (WALL.width + WALL.gap)
/** The operator at the console facing the wall, then beside it: left, right, behind. */
const SPOTS = [[0, 0.75, true], [-1.2, 0.45, false], [1.2, 0.45, false], [0.65, 1.3, false]] as const
/** A console's two monitors, either side of its middle, turned a little toward the operator. */
const MONITORS = [[-0.36, 0.16], [0.36, -0.16]] as const

const seat = (index: number, spot: number): Place => {
  const { x, z } = consoleAt(index)
  const [dx, dz, sit] = SPOTS[spot]!
  return { x: x + dx, z: z + dz, face: { x, z: z - 2 }, sit }
}

const TILE: Record<StationState, string> = {
  approval: '#f2b33d', failed: '#d1495b', quiet: '#c98a2b', working: '#4b8fe6', queued: '#6d7f99', done: '#4f9a6a', stopped: '#7d8796',
}

/** A control console facing -z: graphite top, a front panel, a slanted strip of keys, two monitors on a bar, a chair. */
function controlConsole(batch: Batch, dark: boolean, x: number, z: number): void {
  const c = palette(dark)
  const top = dark ? '#3a404c' : '#c9ced6'
  const body = dark ? '#262a33' : '#9aa1ab'
  batch.add(boxShape(1.9, 0.05, 0.78, 0.02), top, { x, y: 0.72, z }, 'satin')
  batch.add(boxShape(1.9, 0.66, 0.05), body, { x, y: 0.36, z: z - 0.37 }, 'satin')
  for (const side of [-1, 1]) batch.add(boxShape(0.05, 0.7, 0.74), body, { x: x + side * 0.92, y: 0.35, z }, 'satin')
  // The keys, in front of the operator: a strip rising away from them, with a row of lit buttons.
  batch.add(boxShape(1.1, 0.03, 0.2), '#1d2129', { x, y: 0.76, z: z + 0.14, rx: 0.32 }, 'satin', false)
  ;['#4fd18b', '#4b8fe6', '#4b8fe6', '#f2b33d', '#4fd18b'].forEach((colour, index) => {
    batch.add(boxShape(0.06, 0.012, 0.04), colour, { x: x - 0.4 + index * 0.2, y: 0.781, z: z + 0.146, rx: 0.32 }, 'glow', false)
  })
  batch.add(boxShape(0.2, 0.012, 0.16), '#2a2d35', { x: x + 0.7, y: 0.751, z: z + 0.16 }, 'satin', false)
  // The monitors' bar and their backs; the screens themselves are lit with the console's state.
  batch.add(boxShape(0.05, 0.3, 0.05), c.metal, { x, y: 0.9, z: z - 0.22 }, 'metal')
  batch.add(boxShape(1.36, 0.04, 0.04), c.metal, { x, y: 1.05, z: z - 0.22 }, 'metal')
  for (const [dx, ry] of MONITORS) batch.add(boxShape(0.66, 0.42, 0.035, 0.012), '#1d2027', { x: x + dx, y: 1.07, z: z - 0.2, ry }, 'satin')
  // The operator's chair, behind the console.
  const seatZ = z + 0.75
  if (shapeDetail() === 'high') {
    fineChair(batch, c, { x, z: seatZ, ry: Math.PI })
    return
  }
  batch.add(boxShape(0.46, 0.07, 0.44, 0.03), c.seat, { x, y: 0.29, z: seatZ }, 'matte')
  batch.add(boxShape(0.44, 0.5, 0.06, 0.03), c.chair, { x, y: 0.64, z: seatZ + 0.23, rx: 0.08 }, 'matte')
  batch.add(cylinderShape(0.025, 0.025, 0.2, 8), '#5d6470', { x, y: 0.16, z: seatZ }, 'metal')
  batch.add(cylinderShape(0.2, 0.22, 0.03, 10), '#3a3f4b', { x, y: 0.03, z: seatZ }, 'metal', false)
}

/**
 * The lit panels of the room in one mesh, coloured per vertex: each console's two screens and its
 * tile on the wall. One draw call for all of them; a console's colours are written only when they
 * change. The screens are a little dimmer than the tiles.
 */
function panels(finishes: Finishes): { mesh: THREE.Mesh; paint(index: number, colour: THREE.Color, strength: number): void } {
  const parts: THREE.BufferGeometry[] = []
  const ranges: Array<Array<[start: number, count: number, weight: number]>> = []
  const matrix = new THREE.Matrix4()
  let offset = 0
  const add = (index: number, weight: number, width: number, height: number, depth: number, x: number, y: number, z: number, ry = 0): void => {
    const geometry = new THREE.BoxGeometry(width, height, depth).toNonIndexed()
    geometry.deleteAttribute('uv')
    geometry.applyMatrix4(matrix.makeRotationY(ry).setPosition(x, y, z))
    const count = geometry.getAttribute('position').count
    parts.push(geometry)
    ;(ranges[index] ??= []).push([offset, count, weight])
    offset += count
  }
  for (let index = 0; index < CONTROL_STATIONS; index += 1) {
    const { x, z } = consoleAt(index)
    // On the front of each monitor, turned with it.
    for (const [dx, ry] of MONITORS) add(index, 0.8, 0.6, 0.36, 0.006, x + dx + Math.sin(ry) * 0.022, 1.07, z - 0.2 + Math.cos(ry) * 0.022, ry)
    add(index, 1, WALL.width, WALL.height, 0.02, tileX(index), WALL.y, WALL.z)
  }
  const geometry = mergeGeometries(parts, false)!
  for (const part of parts) part.dispose()
  const colours = new THREE.BufferAttribute(new Float32Array(offset * 3), 3)
  geometry.setAttribute('color', colours)
  geometry.computeBoundingSphere()
  const mesh = new THREE.Mesh(geometry, finishes.glow)
  mesh.matrixAutoUpdate = false
  return {
    mesh,
    paint(index, colour, strength) {
      for (const [start, count, weight] of ranges[index] ?? []) {
        const scale = strength * weight
        for (let vertex = start; vertex < start + count; vertex += 1) colours.setXYZ(vertex, colour.r * scale, colour.g * scale, colour.b * scale)
      }
      colours.needsUpdate = true
    },
  }
}

export const buildControl: PlaceBuilder<PlaceInput<ControlView>> = (context) => {
  const { root, finishes, options, still } = context
  const dark = options.dark
  const c = palette(dark)
  const slab = floor('raised', dark, ROOM_BOX, 2.4)
  root.add(slab.mesh)

  const batch = new Batch()
  walls(batch, dark)
  // The wall of screens: a frame with a header bar and a line of the accent colour along it.
  const span = CONTROL_STATIONS * (WALL.width + WALL.gap) + 0.2
  const frame = dark ? '#2a2e37' : '#9aa1ab'
  batch.add(boxShape(span, WALL.height + 0.3, 0.06, 0.02), frame, { y: WALL.y, z: ROOM_BOX.z0 + 0.03 }, 'metal', false)
  batch.add(boxShape(span + 0.1, 0.16, 0.12, 0.02), dark ? '#1f232b' : '#7d8796', { y: WALL.y + WALL.height / 2 + 0.24, z: ROOM_BOX.z0 + 0.07 }, 'metal', false)
  batch.add(boxShape(span - 0.6, 0.025, 0.01), options.accent, { y: WALL.y + WALL.height / 2 + 0.2, z: ROOM_BOX.z0 + 0.135 }, 'glow', false)
  // A cove of light along the top of the two walls.
  batch.add(boxShape(ROOM_BOX.x1 - ROOM_BOX.x0, 0.03, 0.06), dark ? '#cfe0ff' : '#fff6e2', { y: 2.5, z: ROOM_BOX.z0 + 0.05 }, 'glow', false)
  batch.add(boxShape(0.06, 0.03, ROOM_BOX.z1 - ROOM_BOX.z0), dark ? '#cfe0ff' : '#fff6e2', { x: ROOM_BOX.x0 + 0.05, y: 2.5 }, 'glow', false)
  // A status board on the side wall: three bars of the room's own colours.
  batch.add(boxShape(0.05, 0.9, 2.2, 0.02), frame, { x: ROOM_BOX.x0 + 0.04, y: 1.55, z: 0.4 }, 'metal', false)
  batch.add(boxShape(0.02, 0.78, 2.06), '#0e1420', { x: ROOM_BOX.x0 + 0.075, y: 1.55, z: 0.4 }, 'satin', false)
  ;[['#4b8fe6', 1.5], ['#4fd18b', 1.1], ['#f2b33d', 0.6]].forEach(([colour, length], index) => {
    batch.add(boxShape(0.01, 0.1, Number(length)), String(colour), { x: ROOM_BOX.x0 + 0.09, y: 1.8 - index * 0.25, z: 0.4 - (1.9 - Number(length)) / 2 }, 'glow', false)
  })
  // The walkway in front of the wall.
  batch.add(boxShape(ROOM_BOX.x1 - ROOM_BOX.x0 - 0.4, 0.004, 0.05), dark ? '#5b6a86' : '#aeb7c4', { y: 0.002, z: -3.05 }, 'matte', false)
  for (let index = 0; index < CONTROL_STATIONS; index += 1) controlConsole(batch, dark, consoleAt(index).x, consoleAt(index).z)
  plant(batch, dark, -5.4, 3.9, true)
  plant(batch, dark, 5.4, 3.9, true)
  plant(batch, dark, 5.5, -3.9)
  // A water cooler by the door.
  batch.add(boxShape(0.36, 0.95, 0.36, 0.03), '#e8ecf0', { x: -5.3, y: 0.48, z: -3.8 }, 'satin')
  batch.add(cylinderShape(0.15, 0.15, 0.36, 16), '#9fc9e6', { x: -5.3, y: 1.13, z: -3.8 }, 'glass', false)
  root.add(group(batch, finishes))

  // Each console's screens and its tile on the wall show its state.
  const lit = panels(finishes)
  root.add(lit.mesh)
  const painted: string[] = []
  const colour = new THREE.Color()
  const tileGeometry = new THREE.BoxGeometry(WALL.width, WALL.height, 0.02)

  let slots: Array<ControlStationView | null> = []
  const hitMaterial = new THREE.MeshBasicMaterial({ visible: false })
  const hitGeometry = new THREE.BoxGeometry(3.2, 1.6, 2.2)
  for (let index = 0; index < CONTROL_STATIONS; index += 1) {
    const hit = new THREE.Mesh(hitGeometry, hitMaterial)
    hit.position.set(consoleAt(index).x, 0.8, consoleAt(index).z + 0.4)
    root.add(hit)
    context.pickable(hit, () => (slots[index] ? `station:${slots[index]!.sessionId}` : undefined))
    const tile = new THREE.Mesh(tileGeometry, hitMaterial)
    tile.position.set(tileX(index), WALL.y, WALL.z + 0.02)
    root.add(tile)
    context.pickable(tile, () => (slots[index] ? `station:${slots[index]!.sessionId}` : undefined))
  }

  return {
    // The consoles and the wall of screens behind them; the empty front of the room is left out.
    frame: { min: { x: ROOM_BOX.x0, y: 0, z: ROOM_BOX.z0 }, max: { x: ROOM_BOX.x1, y: 2.6, z: 3.4 }, polar: 0.98, azimuth: 0.5 },
    lamps: [{ x: -3.8, y: 2.2, z: -1.4 }, { x: 3.8, y: 2.2, z: -1.4 }, { x: -3.8, y: 2.2, z: 2.0 }, { x: 3.8, y: 2.2, z: 2.0 }],
    floor: {
      grid: new FloorGrid([
        ...Array.from({ length: CONTROL_STATIONS }, (_, index) => ({ x0: consoleAt(index).x - 0.98, x1: consoleAt(index).x + 0.98, z0: consoleAt(index).z - 0.4, z1: consoleAt(index).z + 0.4 })),
        { x0: -5.5, x1: -5.1, z0: -4.0, z1: -3.6 },
      ]),
      door: { x: 5.2, z: 4.2 },
    },
    update({ model }) {
      slots = model.slots
      const people: CrowdActor[] = []
      const labels: Record<string, PlaceLabel> = {}
      model.slots.forEach((station, index) => {
        if (!station) return
        const pick = `station:${station.sessionId}`
        station.people.slice(0, SPOTS.length).forEach((person, spot) => {
          people.push({
            id: `${station.sessionId}:${person.id}`,
            name: person.name,
            state: person.state,
            stateLabel: person.stateLabel,
            look: person.look,
            place: seat(index, spot),
            action: person.action,
            ...(person.bubble ? { bubble: person.bubble } : {}),
            pick,
          })
        })
        const { x, z } = consoleAt(index)
        // Above the heads and their tags.
        labels[`station-${station.sessionId}`] = {
          at: { x, y: 2.55, z: z - 0.2 },
          title: station.title,
          detail: station.detail,
          ...(station.tone ? { tone: station.tone } : {}),
          pick,
        }
      })
      if (model.empty) labels.empty = { at: { x: 0, y: 1.3, z: 0.3 }, title: model.empty }
      return { people, labels }
    },
    tick(now) {
      for (let index = 0; index < CONTROL_STATIONS; index += 1) {
        const station = slots[index]
        const urgent = station?.state === 'approval' || station?.state === 'quiet'
        const pulse = still || !urgent ? 1 : 0.8 + Math.sin(now * 3 + index) * 0.2
        const hue = station ? TILE[station.state] : c.dim
        // A free console's panels glow faintly; a busy one's at full colour.
        const strength = Math.round((station ? 0.85 * pulse : 0.7) * 50) / 50
        const key = `${hue}|${strength}`
        if (painted[index] === key) continue
        painted[index] = key
        lit.paint(index, colour.set(hue), strength)
      }
      return slots.some((station) => station?.state === 'approval' || station?.state === 'quiet') && !still
    },
    dispose() {
      slab.dispose()
      for (const child of [...root.children]) disposeGeometry(child)
      tileGeometry.dispose()
      hitGeometry.dispose()
      hitMaterial.dispose()
    },
  }
}

import * as THREE from 'three'

import { lookFor } from '../cast'
import type { Place } from '../layout'
import { Batch, boxShape, cylinderShape } from '../mesh-kit'
import { FloorGrid } from '../paths'
import { SERVER_RACKS, type ServerModel, type ServerRack } from './models'
import { ROOM_BOX, desk, disposeGeometry, floor, group, palette, walls } from './kit'
import type { CrowdActor, PlaceBuilder, PlaceLabel } from './stage'
import type { PlaceInput } from './types'

/**
 * The server room: a rack for this computer and one for each server of ~/.ssh/config. Their
 * lights show what runs there: steady green at rest, blinking while the conversation runs
 * something there, a blue slot per Slurm job running, red when the last thing run there failed.
 * Jobs waiting in the Slurm queue stand on a cart in front. The agent works at the console, or
 * at a rack while it runs something on that server.
 */

const RACK = { width: 0.72, height: 2.0, depth: 1.0, z: -2.6 }
const rackX = (index: number): number => -3.6 + index * 1.45
const LED_ROWS = 10
const LED_COLUMNS = 3
const CONSOLE = { x: -3.9, z: 2.7 }
const CONSOLE_PLACE: Place = { x: CONSOLE.x, z: CONSOLE.z - 0.75, face: { x: CONSOLE.x, z: 6 }, sit: true }
const rackPlace = (index: number): Place => ({ x: rackX(index), z: RACK.z + RACK.depth / 2 + 0.55, face: { x: rackX(index), z: -9 }, sit: false })

export const buildServers: PlaceBuilder<PlaceInput<ServerModel>> = (context) => {
  const { root, finishes, options, still } = context
  const dark = options.dark
  const c = palette(dark)
  const slab = floor('raised', dark, ROOM_BOX, 2.4)
  root.add(slab.mesh)

  const batch = new Batch()
  walls(batch, dark, { wall: dark ? '#3a3f4d' : '#dfe3ea', low: dark ? '#333845' : '#d3d8e0' })
  // Cable trays under the ceiling, and the air conditioner on the left wall.
  batch.add(boxShape(10.5, 0.06, 0.4), c.metal, { y: 2.35, z: RACK.z }, 'metal', false)
  for (let x = -5; x <= 5; x += 0.5) batch.add(boxShape(0.03, 0.08, 0.4), c.metal, { x, y: 2.39, z: RACK.z }, 'metal', false)
  for (let line = 0; line < 4; line += 1) batch.add(boxShape(10.4, 0.025, 0.025), ['#3f88c5', '#e0a13a', '#4f8a5b', '#c06c84'][line]!, { y: 2.4, z: RACK.z - 0.12 + line * 0.08 }, 'satin', false)
  batch.add(boxShape(0.5, 1.9, 1.3, 0.04), dark ? '#c9ccd2' : '#eef0f3', { x: ROOM_BOX.x0 + 0.3, y: 0.95, z: 0.4 }, 'satin')
  for (let slat = 0; slat < 8; slat += 1) batch.add(boxShape(0.02, 0.025, 1.1), '#8a919c', { x: ROOM_BOX.x0 + 0.56, y: 1.2 + slat * 0.07, z: 0.4 }, 'metal', false)
  // Racks: a cabinet with a door frame, a perforated front and a little screen on top.
  for (let index = 0; index < SERVER_RACKS; index += 1) {
    const x = rackX(index)
    batch.add(boxShape(RACK.width, RACK.height, RACK.depth, 0.02), index === 0 ? '#2b3140' : '#23262e', { x, y: RACK.height / 2, z: RACK.z }, 'satin')
    batch.add(boxShape(RACK.width - 0.08, RACK.height - 0.12, 0.02), '#16181d', { x, y: RACK.height / 2, z: RACK.z + RACK.depth / 2 + 0.005 }, 'matte', false)
    for (let slot = 0; slot < 9; slot += 1) batch.add(boxShape(RACK.width - 0.14, 0.012, 0.012), '#30343e', { x, y: 0.2 + slot * 0.2, z: RACK.z + RACK.depth / 2 + 0.018 }, 'matte', false)
    if (index === 0) batch.add(boxShape(RACK.width + 0.02, 0.04, 0.02), options.accent, { x, y: RACK.height - 0.04, z: RACK.z + RACK.depth / 2 + 0.02 }, 'glow', false)
  }
  const screenAt = desk(batch, dark, CONSOLE.x, CONSOLE.z, 1.5)
  root.add(group(batch, finishes))

  // Lights on the racks' fronts: one instanced mesh, coloured every frame from the model.
  const ledMaterial = new THREE.MeshBasicMaterial({ toneMapped: false })
  const leds = new THREE.InstancedMesh(boxShape(0.05, 0.03, 0.012), ledMaterial, SERVER_RACKS * LED_ROWS * LED_COLUMNS)
  leds.userData.shared = true
  const matrix = new THREE.Matrix4()
  for (let rack = 0; rack < SERVER_RACKS; rack += 1) {
    for (let row = 0; row < LED_ROWS; row += 1) {
      for (let column = 0; column < LED_COLUMNS; column += 1) {
        matrix.makeTranslation(rackX(rack) - 0.18 + column * 0.18, 0.18 + row * 0.18, RACK.z + RACK.depth / 2 + 0.03)
        leds.setMatrixAt((rack * LED_ROWS + row) * LED_COLUMNS + column, matrix)
      }
    }
  }
  root.add(leds)
  const queue = new THREE.Group()
  root.add(queue)
  const screenMaterial = new THREE.MeshStandardMaterial({ color: '#0e1420', emissive: c.dim, emissiveIntensity: 0.4, roughness: 0.3 })
  const screen = new THREE.Mesh(boxShape(0.58, 0.34, 0.008), screenMaterial)
  screen.userData.shared = true
  screen.position.copy(screenAt)
  root.add(screen)
  const hits: THREE.Mesh[] = []
  for (let index = 0; index < SERVER_RACKS; index += 1) {
    const hit = new THREE.Mesh(new THREE.BoxGeometry(RACK.width, RACK.height, RACK.depth), new THREE.MeshBasicMaterial({ visible: false }))
    hit.position.set(rackX(index), RACK.height / 2, RACK.z)
    root.add(hit)
    hits.push(hit)
  }

  let racks: ServerRack[] = []
  context.pickable(hits[0]!, 'route:jobs')
  const colour = new THREE.Color()
  let queueSignature = ''
  let working = false

  return {
    frame: { min: { x: ROOM_BOX.x0, y: 0, z: ROOM_BOX.z0 }, max: { x: ROOM_BOX.x1, y: 2.5, z: ROOM_BOX.z1 }, polar: 0.98, azimuth: 0.62 },
    lamps: [{ x: -2.2, y: 2.3, z: -1.2, colour: '#cfe3ff' }, { x: 2.2, y: 2.3, z: -1.2, colour: '#cfe3ff' }, { x: -3.9, y: 1.9, z: 2.5 }],
    floor: {
      grid: new FloorGrid([
        ...Array.from({ length: SERVER_RACKS }, (_, index) => ({ x0: rackX(index) - RACK.width / 2, x1: rackX(index) + RACK.width / 2, z0: RACK.z - RACK.depth / 2, z1: RACK.z + RACK.depth / 2 })),
        { x0: CONSOLE.x - 0.75, x1: CONSOLE.x + 0.75, z0: CONSOLE.z - 0.35, z1: CONSOLE.z + 0.35 },
        { x0: ROOM_BOX.x0, x1: ROOM_BOX.x0 + 0.55, z0: -0.25, z1: 1.05 },
      ]),
      door: { x: 5.4, z: 4.2 },
    },
    update({ model, t, lead, visitors = [] }) {
      racks = model.racks
      // Jobs waiting in a server's queue: boxes on a cart in front of its rack.
      const signature = racks.map((rack) => rack.queued).join(',')
      if (signature !== queueSignature) {
        queueSignature = signature
        for (const child of [...queue.children]) {
          child.removeFromParent()
          disposeGeometry(child)
        }
        const carts = new Batch()
        racks.forEach((rack, index) => {
          if (rack.queued === 0) return
          const x = rackX(index)
          const z = RACK.z + RACK.depth / 2 + 1.25
          carts.add(boxShape(0.6, 0.04, 0.45, 0.01), c.metal, { x, y: 0.3, z }, 'metal')
          for (const [dx, dz] of [[-0.26, -0.18], [0.26, -0.18], [-0.26, 0.18], [0.26, 0.18]] as const) carts.add(cylinderShape(0.03, 0.03, 0.03, 8), '#2a2d35', { x: x + dx, y: 0.03, z: z + dz, rz: Math.PI / 2 }, 'satin', false)
          carts.add(boxShape(0.02, 0.3, 0.02), c.metal, { x: x - 0.28, y: 0.15, z }, 'metal', false)
          for (let box = 0; box < Math.min(4, rack.queued); box += 1) carts.add(boxShape(0.5, 0.08, 0.36, 0.01), '#2b2f38', { x, y: 0.37 + box * 0.09, z }, 'satin')
        })
        if (racks.some((rack) => rack.queued > 0)) queue.add(group(carts, finishes))
      }
      const index = racks.findIndex((rack) => rack.id === model.technician.rack)
      working = model.technician.state === 'working'
      const people: CrowdActor[] = [{
        id: 'technician',
        name: lead,
        state: model.technician.state === 'idle' ? 'idle' : model.technician.state === 'waiting' ? 'waiting' : 'working',
        stateLabel: t(`places.servers.technician.${model.technician.state}`),
        look: lookFor('lead'),
        place: working && index >= 0 ? rackPlace(index) : CONSOLE_PLACE,
        action: model.technician.state === 'waiting' ? 'raise' : working ? 'operate' : 'rest',
        ...(model.technician.state === 'waiting' ? { bubble: '?' } : {}),
        pick: 'agent',
      }]
      // Experts of any team working on a server: at the racks, from the first remote one.
      const order = racks.map((_, slot) => slot).filter((slot) => !(working && slot === index))
      visitors.slice(0, order.length).forEach((visitor, position) => {
        const slot = order[(position + 1) % order.length]!
        people.push({ id: visitor.id, name: visitor.name, state: 'working', stateLabel: visitor.stateLabel, look: visitor.look, place: rackPlace(slot), action: 'operate', pick: visitor.pick })
      })
      const labels: Record<string, PlaceLabel> = {}
      racks.forEach((rack, slot) => {
        const parts = [
          rack.running > 0 ? t('places.servers.running', { count: rack.running }) : '',
          rack.queued > 0 ? t('places.servers.queued', { count: rack.queued }) : '',
        ].filter(Boolean)
        labels[`rack-${rack.id}`] = {
          at: { x: rackX(slot), y: RACK.height + 0.2, z: RACK.z },
          title: rack.local ? t('places.servers.local') : rack.name,
          detail: rack.failed ? t('places.servers.failed') : parts.length > 0 ? parts.join(' · ') : rack.busy ? t('places.servers.busy') : t('places.servers.idle'),
          ...(rack.failed ? { tone: 'alert' as const } : rack.busy || rack.running > 0 ? { tone: 'busy' as const } : {}),
          ...(rack.local ? { pick: 'route:jobs' } : {}),
        }
      })
      if (racks.length === 1) {
        labels.none = { at: { x: rackX(2), y: 1.2, z: RACK.z }, title: t('places.servers.none'), detail: t('places.servers.noneHint') }
      }
      if (!model.ssh) labels.ssh = { at: { x: CONSOLE.x, y: 1.6, z: CONSOLE.z }, title: t('places.servers.noSsh'), tone: 'alert' }
      if (model.more > 0) labels.more = { at: { x: rackX(SERVER_RACKS - 1) + 1.0, y: 0.6, z: RACK.z }, title: t('places.servers.more', { count: model.more }) }
      return { people, labels }
    },
    tick(now) {
      for (let rack = 0; rack < SERVER_RACKS; rack += 1) {
        const model = racks[rack]
        for (let row = 0; row < LED_ROWS; row += 1) {
          for (let column = 0; column < LED_COLUMNS; column += 1) {
            const index = (rack * LED_ROWS + row) * LED_COLUMNS + column
            if (!model) colour.set('#1a1d24')
            else if (model.failed && column === 0) colour.set(still || Math.sin(now * 5 + row) > 0 ? '#ff4a3d' : '#4a1712')
            else if (row < model.running && column === 1) colour.set('#4aa3ff')
            else if (model.busy) colour.set(still || Math.sin(now * 11 + row * 1.7 + column * 2.3) > 0.2 ? '#38d39f' : '#0f3a2b')
            else colour.set(column === 2 && row % 3 === 0 ? '#f2c230' : '#2a8f63').multiplyScalar(0.7)
            leds.setColorAt(index, colour)
          }
        }
      }
      if (leds.instanceColor) leds.instanceColor.needsUpdate = true
      screenMaterial.emissive.set(working ? (dark ? '#1f6f5a' : '#2f8f74') : c.dim)
      screenMaterial.emissiveIntensity = working ? 0.9 : 0.35
      return false
    },
    dispose() {
      slab.dispose()
      for (const child of [...root.children]) disposeGeometry(child)
      ledMaterial.dispose()
      screenMaterial.dispose()
      for (const hit of hits) {
        hit.geometry.dispose()
        ;(hit.material as THREE.Material).dispose()
      }
    },
  }
}

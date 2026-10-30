/** Where each module of the repository map goes in the drawing: modules that use others on the
 * left, what they build on to the right (layered by the longest chain of uses), and each column
 * ordered to keep lines short. */

export interface MapModule {
  id: string
  files: number
  lines: number
  usedBy: number
  uses: number
  keyFiles: string[]
  allFiles: string[]
}

export interface MapEdge {
  from: string
  to: string
  weight: number
}

export interface Placed {
  id: string
  x: number
  y: number
  column: number
}

export const NODE_WIDTH = 168
export const NODE_HEIGHT = 30
const COLUMN_GAP = 92
const ROW_GAP = 14
const MARGIN = 16

/** The parts of the graph where every module reaches every other (Tarjan). */
export function components(ids: string[], edges: MapEdge[]): Map<string, number> {
  const next = new Map<string, string[]>(ids.map((id) => [id, []]))
  for (const edge of edges) next.get(edge.from)?.push(edge.to)
  const index = new Map<string, number>()
  const low = new Map<string, number>()
  const onStack = new Set<string>()
  const stack: string[] = []
  const part = new Map<string, number>()
  let counter = 0
  let parts = 0
  const visit = (node: string): void => {
    index.set(node, counter)
    low.set(node, counter)
    counter += 1
    stack.push(node)
    onStack.add(node)
    for (const target of next.get(node) ?? []) {
      if (!index.has(target)) {
        visit(target)
        low.set(node, Math.min(low.get(node)!, low.get(target)!))
      } else if (onStack.has(target)) {
        low.set(node, Math.min(low.get(node)!, index.get(target)!))
      }
    }
    if (low.get(node) === index.get(node)) {
      let item: string
      do {
        item = stack.pop()!
        onStack.delete(item)
        part.set(item, parts)
      } while (item !== node)
      parts += 1
    }
  }
  for (const id of ids) if (!index.has(id)) visit(id)
  return part
}

/** An order of the modules with as few uses pointing back as can be found quickly (Eades, Lin
 * and Smyth): what nothing uses first, what uses nothing last, and in between whatever is used
 * least for how much it uses. Uses that point back in this order are the ones closing circles. */
export function moduleOrder(ids: string[], edges: MapEdge[]): string[] {
  const left = new Set(ids)
  const out = new Map<string, Map<string, number>>(ids.map((id) => [id, new Map()]))
  const into = new Map<string, Map<string, number>>(ids.map((id) => [id, new Map()]))
  for (const edge of edges) {
    out.get(edge.from)!.set(edge.to, (out.get(edge.from)!.get(edge.to) ?? 0) + edge.weight)
    into.get(edge.to)!.set(edge.from, (into.get(edge.to)!.get(edge.from) ?? 0) + edge.weight)
  }
  const weight = (links: Map<string, number>): number => {
    let total = 0
    for (const [other, value] of links) if (left.has(other)) total += value
    return total
  }
  const first: string[] = []
  const last: string[] = []
  const take = (id: string, list: string[], front: boolean): void => {
    left.delete(id)
    if (front) list.unshift(id)
    else list.push(id)
  }
  while (left.size) {
    let changed = true
    while (changed) {
      changed = false
      for (const id of [...left].sort()) {
        if (weight(out.get(id)!) === 0) { take(id, last, true); changed = true }
        else if (weight(into.get(id)!) === 0) { take(id, first, false); changed = true }
      }
    }
    if (!left.size) break
    const best = [...left].sort((a, b) => (weight(out.get(b)!) - weight(into.get(b)!)) - (weight(out.get(a)!) - weight(into.get(a)!)) || a.localeCompare(b))[0]!
    take(best, first, false)
  }
  return [...first, ...last]
}

export function layoutModules(modules: MapModule[], edges: MapEdge[]): { placed: Map<string, Placed>; width: number; height: number; backward: Set<string> } {
  const ids = modules.map((module) => module.id)
  const known = new Set(ids)
  const usable = edges.filter((edge) => known.has(edge.from) && known.has(edge.to) && edge.from !== edge.to)
  const order = moduleOrder(ids, usable)
  const position = new Map(order.map((id, index) => [id, index]))
  const backward = new Set(usable.filter((edge) => position.get(edge.from)! > position.get(edge.to)!).map((edge) => `${edge.from}->${edge.to}`))
  // Columns by the longest chain of forward uses: users on the left, what they build on to the right.
  const column = new Map<string, number>()
  for (const id of order) {
    let at = 0
    for (const edge of usable) {
      if (edge.to === id && !backward.has(`${edge.from}->${edge.to}`)) at = Math.max(at, (column.get(edge.from) ?? 0) + 1)
    }
    column.set(id, at)
  }
  const deepest = Math.max(0, ...column.values())
  const columns: string[][] = Array.from({ length: deepest + 1 }, () => [])
  for (const id of order) columns[column.get(id)!]!.push(id)

  // Order each column by where its neighbours sit, a few times over.
  const neighbours = new Map<string, string[]>(ids.map((id) => [id, []]))
  for (const edge of usable) {
    neighbours.get(edge.from)!.push(edge.to)
    neighbours.get(edge.to)!.push(edge.from)
  }
  const row = new Map<string, number>()
  columns.forEach((items) => items.forEach((id, index) => row.set(id, index)))
  for (let sweep = 0; sweep < 6; sweep += 1) {
    const sweepOrder = sweep % 2 === 0 ? columns : [...columns].reverse()
    for (const items of sweepOrder) {
      const centre = (id: string): number => {
        const around = neighbours.get(id)!.map((other) => row.get(other)!).filter((value) => value !== undefined)
        return around.length ? around.reduce((sum, value) => sum + value, 0) / around.length : row.get(id)!
      }
      items.sort((a, b) => centre(a) - centre(b) || a.localeCompare(b))
      items.forEach((id, index) => row.set(id, index))
    }
  }
  const tallest = Math.max(1, ...columns.map((items) => items.length))
  const height = MARGIN * 2 + tallest * NODE_HEIGHT + (tallest - 1) * ROW_GAP
  const placed = new Map<string, Placed>()
  columns.forEach((items, columnIndex) => {
    const top = (height - (items.length * NODE_HEIGHT + (items.length - 1) * ROW_GAP)) / 2
    items.forEach((id, index) => {
      placed.set(id, {
        id,
        column: columnIndex,
        x: MARGIN + columnIndex * (NODE_WIDTH + COLUMN_GAP),
        y: top + index * (NODE_HEIGHT + ROW_GAP),
      })
    })
  })
  return { placed, width: MARGIN * 2 + columns.length * NODE_WIDTH + (columns.length - 1) * COLUMN_GAP, height, backward }
}

/** A short name for a module: its last folder, or the last two when the last is shared. */
export function shortNames(ids: string[]): Map<string, string> {
  const last = (id: string, count: number): string => id.split('/').slice(-count).join('/')
  const counts = new Map<string, number>()
  for (const id of ids) counts.set(last(id, 1), (counts.get(last(id, 1)) ?? 0) + 1)
  return new Map(ids.map((id) => [id, (counts.get(last(id, 1)) ?? 0) > 1 ? last(id, 2) : last(id, 1)]))
}

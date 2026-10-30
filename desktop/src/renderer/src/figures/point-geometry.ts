// Where a figure's data points are in its image, and back: the point map aw_sciplot.save() writes
// beside a figure gives each axes' box (fractions of the image), its limits and scale, and the
// marks matched to data rows. Follows Quick SciPlot's point editor (MIT, WhitePepperLambSoup).

export interface AxisSpec { column: string | null; kind: string; scale: string; editable: boolean; index?: boolean }

export interface PointSet {
  id: string
  axes: number
  kind: 'line' | 'scatter' | 'bar'
  label: string
  x: AxisSpec
  y: AxisSpec
  rows: number[]
  xs: number[]
  ys: number[]
  orientation?: 'v' | 'h'
  bases?: number[]
  x_display?: string[]
  y_display?: string[]
}

export interface AxesGeometry { box: [number, number, number, number]; xlim: [number, number]; ylim: [number, number] }

export interface FigurePoints {
  points: string
  image: string | null
  axes: Array<AxesGeometry | null>
  sets: PointSet[]
  data?: string
  script?: string | null
  environment: boolean
}

/** One draggable point: its data position now and where it started. */
export interface Handle {
  key: string
  set: PointSet
  index: number
  row: number
  x: number
  y: number
  x0: number
  y0: number
  editX: boolean
  editY: boolean
  missing: boolean
}

function fraction(value: number, limits: [number, number], scale: string): number {
  if (scale === 'log') {
    const low = Math.log10(limits[0])
    return (Math.log10(value) - low) / (Math.log10(limits[1]) - low)
  }
  return (value - limits[0]) / (limits[1] - limits[0])
}

function fromFraction(part: number, limits: [number, number], scale: string): number {
  if (scale === 'log') {
    const low = Math.log10(limits[0])
    return 10 ** (low + part * (Math.log10(limits[1]) - low))
  }
  return limits[0] + part * (limits[1] - limits[0])
}

/** The image pixel of a data point (image of width × height). */
export function toPixel(axes: AxesGeometry, set: PointSet, x: number, y: number, width: number, height: number): [number, number] {
  const [left, top, boxWidth, boxHeight] = axes.box
  const fx = fraction(x, axes.xlim, set.x.scale)
  const fy = fraction(y, axes.ylim, set.y.scale)
  return [width * (left + boxWidth * fx), height * (top + boxHeight * (1 - fy))]
}

/** The data position of an image pixel. */
export function fromPixel(axes: AxesGeometry, set: PointSet, px: number, py: number, width: number, height: number): [number, number] {
  const [left, top, boxWidth, boxHeight] = axes.box
  const fx = (px / width - left) / boxWidth
  const fy = 1 - (py / height - top) / boxHeight
  return [fromFraction(fx, axes.xlim, set.x.scale), fromFraction(fy, axes.ylim, set.y.scale)]
}

/** A value rounded to about a two-thousandth of the axis, so a drag does not invent digits. */
export function roundToAxis(value: number, limits: [number, number], scale: string): number {
  if (scale === 'log') return Number(value.toPrecision(4))
  const step = Math.abs(limits[1] - limits[0]) / 2000
  if (!Number.isFinite(step) || step === 0) return value
  const decimals = Math.max(0, Math.min(10, -Math.floor(Math.log10(step))))
  return Number(value.toFixed(decimals))
}

/** The draggable points of a figure (sets with at least one editable axis). */
export function handlesOf(points: FigurePoints): Handle[] {
  const handles: Handle[] = []
  for (const set of points.sets) {
    if (!points.axes[set.axes] || !(set.x.editable || set.y.editable)) continue
    set.rows.forEach((row, index) => {
      let x = set.xs[index] ?? 0
      let y = set.ys[index] ?? 0
      // A bar's handle is its end: base + value.
      if (set.kind === 'bar' && set.bases) {
        if (set.orientation === 'h') x += set.bases[index] ?? 0
        else y += set.bases[index] ?? 0
      }
      handles.push({ key: `${set.id}:${index}`, set, index, row, x, y, x0: x, y0: y, editX: set.x.editable, editY: set.y.editable, missing: false })
    })
  }
  return handles
}

export interface CellEdit { row: number; column: string; value: number | null }

// A stacked bar's value is its end less its base; drop the float noise the subtraction leaves.
const clean = (value: number): number => Number(value.toPrecision(12))

/** The cell changes the moved and cleared handles make. */
export function editsOf(handles: readonly Handle[]): CellEdit[] {
  const edits: CellEdit[] = []
  for (const handle of handles) {
    const { set } = handle
    const base = set.kind === 'bar' && set.bases ? set.bases[handle.index] ?? 0 : 0
    const horizontalBar = set.kind === 'bar' && set.orientation === 'h'
    const verticalBar = set.kind === 'bar' && set.orientation !== 'h'
    if (handle.editX && set.x.column && (handle.missing || handle.x !== handle.x0)) {
      edits.push({ row: handle.row, column: set.x.column, value: handle.missing ? null : clean(handle.x - (horizontalBar ? base : 0)) })
    }
    if (handle.editY && set.y.column && (handle.missing || handle.y !== handle.y0)) {
      edits.push({ row: handle.row, column: set.y.column, value: handle.missing ? null : clean(handle.y - (verticalBar ? base : 0)) })
    }
  }
  return edits
}

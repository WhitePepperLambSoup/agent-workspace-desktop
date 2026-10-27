import type { JsonValue } from '../../../shared/protocol'

export interface TextRun { text: string; bold?: boolean; italic?: boolean }

export type DocBlock =
  | { type: 'heading'; level: number; text: string }
  | { type: 'paragraph'; runs: TextRun[]; style?: 'quote' | 'code' }
  | { type: 'list'; ordered: boolean; level: number; runs: TextRun[] }
  | { type: 'table'; rows: string[][] }
  | { type: 'image' }

export interface SheetCell { c: number; v: string; f?: string }
export interface SheetRow { r: number; cells: SheetCell[] }
export interface Sheet { name: string; rows: SheetRow[]; merges: string[]; rowCount: number; columnsTruncated?: boolean }

export interface SlideParagraph { text: string; level: number }
export interface SlideView { index: number; title: string; paragraphs: SlideParagraph[]; tables: string[][][]; images: number; notes?: string }

export type OfficePreview =
  | { kind: 'docx'; blocks: DocBlock[]; truncated: boolean }
  | { kind: 'xlsx'; sheets: Sheet[]; truncated: boolean }
  | { kind: 'pptx'; slides: SlideView[]; aspect: number; truncated: boolean }

export const OFFICE_SUFFIXES = ['.docx', '.xlsx', '.pptx'] as const

export function isOfficePath(path: string): boolean {
  const lower = path.toLowerCase()
  return OFFICE_SUFFIXES.some((suffix) => lower.endsWith(suffix))
}

function record(value: JsonValue | undefined): Record<string, JsonValue> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null
}

function strings(value: JsonValue | undefined): string[] {
  return Array.isArray(value) ? value.map((item) => (typeof item === 'string' ? item : '')) : []
}

function runs(value: JsonValue | undefined): TextRun[] {
  return Array.isArray(value)
    ? value.flatMap((item) => {
      const run = record(item)
      if (!run || typeof run.text !== 'string') return []
      return [{ text: run.text, ...(run.bold === true ? { bold: true } : {}), ...(run.italic === true ? { italic: true } : {}) }]
    })
    : []
}

function block(value: JsonValue): DocBlock | null {
  const item = record(value)
  if (!item) return null
  if (item.type === 'heading' && typeof item.text === 'string') return { type: 'heading', level: typeof item.level === 'number' ? item.level : 1, text: item.text }
  if (item.type === 'paragraph') return { type: 'paragraph', runs: runs(item.runs), ...(item.style === 'quote' || item.style === 'code' ? { style: item.style } : {}) }
  if (item.type === 'list') return { type: 'list', ordered: item.ordered === true, level: typeof item.level === 'number' ? item.level : 0, runs: runs(item.runs) }
  if (item.type === 'table') return { type: 'table', rows: Array.isArray(item.rows) ? item.rows.map(strings) : [] }
  if (item.type === 'image') return { type: 'image' }
  return null
}

export function parsePreview(value: JsonValue | undefined): OfficePreview | null {
  const item = record(value)
  if (!item) return null
  const truncated = item.truncated === true
  if (item.kind === 'docx' && Array.isArray(item.blocks)) {
    return { kind: 'docx', blocks: item.blocks.flatMap((entry) => block(entry) ?? []), truncated }
  }
  if (item.kind === 'xlsx' && Array.isArray(item.sheets)) {
    const sheets = item.sheets.flatMap((entry) => {
      const sheet = record(entry)
      if (!sheet) return []
      const rows = Array.isArray(sheet.rows) ? sheet.rows.flatMap((rowValue) => {
        const row = record(rowValue)
        if (!row || typeof row.r !== 'number' || !Array.isArray(row.cells)) return []
        const cells = row.cells.flatMap((cellValue) => {
          const cell = record(cellValue)
          if (!cell || typeof cell.c !== 'number') return []
          return [{ c: cell.c, v: typeof cell.v === 'string' ? cell.v : '', ...(typeof cell.f === 'string' ? { f: cell.f } : {}) }]
        })
        return [{ r: row.r, cells }]
      }) : []
      return [{
        name: typeof sheet.name === 'string' ? sheet.name : '',
        rows,
        merges: strings(sheet.merges),
        rowCount: typeof sheet.rowCount === 'number' ? sheet.rowCount : rows.length,
        ...(sheet.columnsTruncated === true ? { columnsTruncated: true } : {}),
      }]
    })
    return { kind: 'xlsx', sheets, truncated }
  }
  if (item.kind === 'pptx' && Array.isArray(item.slides)) {
    const slides = item.slides.flatMap((entry) => {
      const slide = record(entry)
      if (!slide) return []
      const paragraphs = Array.isArray(slide.paragraphs) ? slide.paragraphs.flatMap((paragraphValue) => {
        const paragraph = record(paragraphValue)
        return paragraph && typeof paragraph.text === 'string' ? [{ text: paragraph.text, level: typeof paragraph.level === 'number' ? paragraph.level : 0 }] : []
      }) : []
      return [{
        index: typeof slide.index === 'number' ? slide.index : 0,
        title: typeof slide.title === 'string' ? slide.title : '',
        paragraphs,
        tables: Array.isArray(slide.tables) ? slide.tables.map((table) => (Array.isArray(table) ? table.map(strings) : [])) : [],
        images: typeof slide.images === 'number' ? slide.images : 0,
        ...(typeof slide.notes === 'string' ? { notes: slide.notes } : {}),
      }]
    })
    return { kind: 'pptx', slides, aspect: typeof item.aspect === 'number' && item.aspect > 0 ? item.aspect : 16 / 9, truncated }
  }
  return null
}

export function columnName(index: number): string {
  let name = ''
  let value = index + 1
  while (value > 0) {
    const remainder = (value - 1) % 26
    name = String.fromCharCode(65 + remainder) + name
    value = Math.floor((value - 1) / 26)
  }
  return name
}

/** "B3:D4" as zero-based row/column bounds (rows are sheet row numbers). */
export function parseRange(range: string): { top: number; left: number; bottom: number; right: number } | null {
  const match = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(range)
  if (!match) return null
  const column = (letters: string) => [...letters].reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0) - 1
  return { top: Number(match[2]), left: column(match[1]), bottom: Number(match[4]), right: column(match[3]) }
}

export function blockText(value: DocBlock): string {
  if (value.type === 'heading') return value.text
  if (value.type === 'table') return value.rows.map((row) => row.join('\t')).join('\n')
  if (value.type === 'image') return '[image]'
  return value.runs.map((run) => run.text).join('')
}

/**
 * Which items of the second list are new and which of the first are gone, by a longest common
 * subsequence of their texts (kept to sizes that stay fast in the window).
 */
export function changedItems(before: readonly string[], after: readonly string[]): { removed: Set<number>; added: Set<number> } {
  const removed = new Set<number>()
  const added = new Set<number>()
  if (before.length * after.length > 4_000_000) {
    const kept = new Set(before)
    after.forEach((text, index) => { if (!kept.has(text)) added.add(index) })
    const now = new Set(after)
    before.forEach((text, index) => { if (!now.has(text)) removed.add(index) })
    return { removed, added }
  }
  const lengths: number[][] = Array.from({ length: before.length + 1 }, () => new Array<number>(after.length + 1).fill(0))
  for (let i = before.length - 1; i >= 0; i -= 1) {
    for (let j = after.length - 1; j >= 0; j -= 1) {
      lengths[i][j] = before[i] === after[j] ? lengths[i + 1][j + 1] + 1 : Math.max(lengths[i + 1][j], lengths[i][j + 1])
    }
  }
  let i = 0
  let j = 0
  while (i < before.length && j < after.length) {
    if (before[i] === after[j]) { i += 1; j += 1 }
    else if (lengths[i + 1][j] >= lengths[i][j + 1]) { removed.add(i); i += 1 }
    else { added.add(j); j += 1 }
  }
  for (; i < before.length; i += 1) removed.add(i)
  for (; j < after.length; j += 1) added.add(j)
  return { removed, added }
}

/** Cells whose shown value or formula differs between two versions of a sheet, as "row:column". */
export function changedCells(before: Sheet | undefined, after: Sheet): Set<string> {
  const values = (sheet: Sheet | undefined) => {
    const map = new Map<string, string>()
    for (const row of sheet?.rows ?? []) for (const cell of row.cells) map.set(`${row.r}:${cell.c}`, `${cell.v}\u0000${cell.f ?? ''}`)
    return map
  }
  const old = values(before)
  const now = values(after)
  const changed = new Set<string>()
  for (const [key, value] of now) if (old.get(key) !== value) changed.add(key)
  for (const key of old.keys()) if (!now.has(key)) changed.add(key)
  return changed
}

export function slideText(slide: SlideView): string {
  return [slide.title, ...slide.paragraphs.map((paragraph) => paragraph.text)].join('\n')
}

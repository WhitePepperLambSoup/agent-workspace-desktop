import { ExternalLink, Image as ImageIcon, RefreshCw, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import type { WorkbenchBridgeClient } from '../bridge/client'
import { useOptionalI18n } from '../i18n/I18nProvider'
import type { MessageKey } from '../i18n/messages'
import {
  blockText,
  changedCells,
  changedItems,
  columnName,
  parsePreview,
  parseRange,
  slideText,
  type DocBlock,
  type OfficePreview,
  type Sheet,
  type SlideView,
  type TextRun,
} from './model'
import './office.css'

type Mark = 'added' | 'removed' | undefined

function Runs({ runs }: { runs: TextRun[] }) {
  return <>{runs.map((run, index) => {
    let node: ReactNode = run.text
    if (run.italic) node = <em>{node}</em>
    if (run.bold) node = <strong>{node}</strong>
    return <span key={index}>{node}</span>
  })}</>
}

function DocBlocks({ blocks, marks, mark }: { blocks: DocBlock[]; marks?: Set<number>; mark?: Mark }) {
  const { t } = useOptionalI18n()
  // Numbered items count per level, restarting after anything that is not a list item.
  const numbers: number[] = []
  return <div className="office-doc">
    {blocks.map((block, index) => {
      const marked = marks?.has(index) ? mark : undefined
      if (block.type !== 'list') numbers.length = 0
      if (block.type === 'heading') {
        const level = Math.min(Math.max(block.level, 0), 6)
        return <div key={index} className={`office-heading office-heading-${level}`} data-mark={marked}>{block.text}</div>
      }
      if (block.type === 'list') {
        numbers.length = block.level + 1
        numbers[block.level] = (numbers[block.level] ?? 0) + 1
        return <div key={index} className="office-list-item" style={{ paddingInlineStart: `${1.4 + block.level * 1.4}em` }} data-mark={marked}>
          <span className="office-list-marker" aria-hidden="true">{block.ordered ? `${numbers[block.level]}.` : '•'}</span>
          <Runs runs={block.runs} />
        </div>
      }
      if (block.type === 'table') {
        return <div key={index} className="office-table-wrap" data-mark={marked}><table className="office-table"><tbody>
          {block.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => rowIndex === 0
            ? <th key={cellIndex}>{cell}</th>
            : <td key={cellIndex}>{cell}</td>)}</tr>)}
        </tbody></table></div>
      }
      if (block.type === 'image') return <div key={index} className="office-image" data-mark={marked}><ImageIcon size={14} aria-hidden="true" />{t('office.image')}</div>
      if (block.style === 'code') return <pre key={index} className="office-code" data-mark={marked}><Runs runs={block.runs} /></pre>
      return <p key={index} className={block.style === 'quote' ? 'office-quote' : 'office-paragraph'} data-mark={marked}><Runs runs={block.runs} /></p>
    })}
  </div>
}

function SheetGrid({ sheet, changed }: { sheet: Sheet; changed?: Set<string> }) {
  const { t } = useOptionalI18n()
  const { width, cells, covered, spans } = useMemo(() => {
    const map = new Map<string, { v: string; f?: string }>()
    let columns = 0
    for (const row of sheet.rows) for (const cell of row.cells) {
      map.set(`${row.r}:${cell.c}`, cell)
      columns = Math.max(columns, cell.c + 1)
    }
    const hidden = new Set<string>()
    const spanning = new Map<string, { rows: number; columns: number }>()
    for (const merge of sheet.merges) {
      const range = parseRange(merge)
      if (!range) continue
      spanning.set(`${range.top}:${range.left}`, { rows: range.bottom - range.top + 1, columns: range.right - range.left + 1 })
      for (let r = range.top; r <= range.bottom; r += 1) for (let c = range.left; c <= range.right; c += 1) {
        if (r !== range.top || c !== range.left) hidden.add(`${r}:${c}`)
      }
      columns = Math.max(columns, range.right + 1)
    }
    return { width: Math.max(columns, 1), cells: map, covered: hidden, spans: spanning }
  }, [sheet])
  const rowNumbers = useMemo(() => {
    const numbers = sheet.rows.map((row) => row.r)
    for (const merge of sheet.merges) {
      const range = parseRange(merge)
      if (range) for (let r = range.top; r <= range.bottom; r += 1) numbers.push(r)
    }
    return [...new Set(numbers)].sort((a, b) => a - b).slice(0, 500)
  }, [sheet])
  if (rowNumbers.length === 0) return <p className="route-note">{t('office.emptySheet')}</p>
  return <div className="office-sheet-wrap"><table className="office-sheet">
    <thead><tr><th aria-hidden="true" />{Array.from({ length: width }, (_, index) => <th key={index} scope="col">{columnName(index)}</th>)}</tr></thead>
    <tbody>{rowNumbers.map((r) => <tr key={r}>
      <th scope="row">{r}</th>
      {Array.from({ length: width }, (_, c) => {
        const key = `${r}:${c}`
        if (covered.has(key)) return null
        const cell = cells.get(key)
        const span = spans.get(key)
        return <td key={c} rowSpan={span?.rows} colSpan={span?.columns} title={cell?.f}
          data-changed={changed?.has(key) ? 'true' : undefined} data-number={cell && /^-?[\d.,]+%?$/.test(cell.v) ? 'true' : undefined}>
          {cell?.v ?? ''}
        </td>
      })}
    </tr>)}</tbody>
  </table></div>
}

function SheetTabs({ sheets, changed }: { sheets: Sheet[]; changed?: Map<string, Set<string>> }) {
  const { t } = useOptionalI18n()
  const [active, setActive] = useState(0)
  const sheet = sheets[Math.min(active, sheets.length - 1)]
  if (!sheet) return <p className="route-note">{t('office.emptySheet')}</p>
  return <div className="office-sheets">
    {sheets.length > 1 ? <div className="office-sheet-tabs" role="tablist" aria-label={t('office.sheets')}>
      {sheets.map((item, index) => <button key={`${item.name}-${index}`} type="button" role="tab" aria-selected={index === active}
        data-changed={changed?.get(item.name)?.size ? 'true' : undefined} onClick={() => setActive(index)}>{item.name || `#${index + 1}`}</button>)}
    </div> : null}
    <SheetGrid sheet={sheet} changed={changed?.get(sheet.name)} />
    {sheet.rowCount > 500 || sheet.columnsTruncated ? <p className="route-note">{t('office.sheetTruncated', { count: sheet.rowCount })}</p> : null}
  </div>
}

function Slides({ slides, aspect, marks, mark }: { slides: SlideView[]; aspect: number; marks?: Set<number>; mark?: Mark }) {
  const { t } = useOptionalI18n()
  return <ol className="office-slides">
    {slides.map((slide, index) => <li key={`${slide.index}-${index}`} className="office-slide-item" data-mark={marks?.has(index) ? mark : undefined}>
      <span className="office-slide-number">{t('office.slide', { index: slide.index || index + 1 })}</span>
      <div className="office-slide" style={{ aspectRatio: String(aspect) }}>
        {slide.title ? <div className="office-slide-title">{slide.title}</div> : null}
        {slide.paragraphs.length ? <ul className="office-slide-points">
          {slide.paragraphs.map((paragraph, paragraphIndex) => <li key={paragraphIndex} style={{ marginInlineStart: `${paragraph.level * 1.2}em` }}>{paragraph.text}</li>)}
        </ul> : null}
        {slide.tables.map((rows, tableIndex) => <table key={tableIndex} className="office-table"><tbody>
          {rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)}
        </tbody></table>)}
        {slide.images ? <span className="office-slide-images"><ImageIcon size={12} aria-hidden="true" />{t('office.images', { count: slide.images })}</span> : null}
      </div>
      {slide.notes ? <p className="office-slide-notes"><strong>{t('office.notes')}</strong> {slide.notes}</p> : null}
    </li>)}
  </ol>
}

export function OfficeView({ preview, marks, mark, changedSheets }: {
  preview: OfficePreview
  marks?: Set<number>
  mark?: Mark
  changedSheets?: Map<string, Set<string>>
}) {
  const { t } = useOptionalI18n()
  return <div className="office-view" data-kind={preview.kind}>
    {preview.kind === 'docx' ? <DocBlocks blocks={preview.blocks} marks={marks} mark={mark} /> : null}
    {preview.kind === 'xlsx' ? <SheetTabs sheets={preview.sheets} changed={changedSheets} /> : null}
    {preview.kind === 'pptx' ? <Slides slides={preview.slides} aspect={preview.aspect} marks={marks} mark={mark} /> : null}
    {preview.truncated ? <p className="route-note">{t('office.truncated')}</p> : null}
  </div>
}

/** Two versions side by side: what this change removed on the left, what it added on the right. */
export function OfficeCompare({ before, after }: { before: OfficePreview | null; after: OfficePreview }) {
  const { t } = useOptionalI18n()
  const comparison = useMemo(() => {
    if (after.kind === 'docx') {
      const old = before?.kind === 'docx' ? before.blocks.map(blockText) : []
      const { removed, added } = changedItems(old, after.blocks.map(blockText))
      return { removed, added, count: removed.size + added.size }
    }
    if (after.kind === 'pptx') {
      const old = before?.kind === 'pptx' ? before.slides.map(slideText) : []
      const { removed, added } = changedItems(old, after.slides.map(slideText))
      return { removed, added, count: removed.size + added.size }
    }
    const sheets = new Map<string, Set<string>>()
    let count = 0
    for (const sheet of after.sheets) {
      const old = before?.kind === 'xlsx' ? before.sheets.find((item) => item.name === sheet.name) : undefined
      const changed = changedCells(old, sheet)
      sheets.set(sheet.name, changed)
      count += changed.size
    }
    return { removed: new Set<number>(), added: new Set<number>(), sheets, count }
  }, [after, before])
  return <div className="office-compare">
    <p className="route-note office-compare-summary">{comparison.count ? t('office.changes', { count: comparison.count }) : t('office.noChanges')}</p>
    <div className="office-compare-columns">
      <section aria-label={t('office.before')}>
        <h3>{t('office.before')}</h3>
        {before ? <OfficeView preview={before} marks={comparison.removed} mark="removed" /> : <p className="route-note">{t('office.beforeMissing')}</p>}
      </section>
      <section aria-label={t('office.after')}>
        <h3>{t('office.after')}</h3>
        <OfficeView preview={after} marks={comparison.added} mark="added" changedSheets={'sheets' in comparison ? comparison.sheets : undefined} />
      </section>
    </div>
  </div>
}

export interface PreviewRequest { path: string; previousSha256?: string; resultSha256?: string }

const ERROR_KEYS: Record<string, MessageKey> = {
  not_office: 'office.error.notOffice',
  too_large: 'office.error.tooLarge',
  unreadable: 'office.error.unreadable',
  unsupported_type: 'office.error.unsupported',
  file_not_found: 'office.error.notFound',
  invalid_path: 'office.error.notFound',
  unknown_change: 'office.error.unknownChange',
}

/** A dialog that shows an Office file of the open folder, and how one change altered it. */
export function OfficePreviewDialog({ request, client, onClose }: {
  request: PreviewRequest
  client: Pick<WorkbenchBridgeClient, 'previewDocument'>
  onClose: () => void
}) {
  const { t } = useOptionalI18n()
  const [state, setState] = useState<{ after: OfficePreview; before: OfficePreview | null; hasBefore: boolean; changedLater: boolean } | null>(null)
  const [error, setError] = useState<{ text: string; code: string } | null>(null)
  const [view, setView] = useState<'current' | 'compare'>(request.previousSha256 ? 'compare' : 'current')
  const panel = useRef<HTMLElement>(null)
  const load = async () => {
    setError(null)
    try {
      const reply = await client.previewDocument(request.path, { previousSha256: request.previousSha256, resultSha256: request.resultSha256 })
      const after = parsePreview(reply.payload.preview)
      if (!after) throw Object.assign(new Error('not_office'), { code: 'not_office' })
      setState({
        after,
        before: parsePreview(reply.payload.before),
        hasBefore: reply.payload.beforeAvailable === true,
        changedLater: reply.payload.changedLater === true,
      })
    } catch (reason) {
      const code = reason && typeof reason === 'object' && 'code' in reason && typeof reason.code === 'string' ? reason.code : ''
      setError({ text: t(ERROR_KEYS[code] ?? 'office.error.generic'), code })
    }
  }
  useEffect(() => { void load() }, [request.path, request.previousSha256, request.resultSha256])
  useEffect(() => { panel.current?.focus() }, [])
  const name = request.path.split(/[\\/]/).at(-1) ?? request.path
  const canOpen = Boolean(window.agentWorkspace?.openPath)
  return <div className="command-overlay office-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section ref={panel} tabIndex={-1} className="office-dialog" role="dialog" aria-modal="true" aria-label={t('office.title', { name })}
      onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); onClose() } }}>
      <header>
        <strong title={request.path}>{name}</strong>
        {request.previousSha256 ? <div className="segmented-control office-view-switch" role="radiogroup" aria-label={t('office.view')}>
          {(['compare', 'current'] as const).map((value) => <button key={value} type="button" role="radio" aria-checked={view === value}
            className={view === value ? 'is-selected' : undefined} onClick={() => setView(value)}>{t(value === 'compare' ? 'office.compare' : 'office.current')}</button>)}
        </div> : null}
        <button type="button" className="icon-button" aria-label={t('office.refresh')} title={t('office.refresh')} onClick={() => void load()}><RefreshCw size={14} /></button>
        {canOpen ? <button type="button" className="secondary-button" onClick={() => void window.agentWorkspace?.openPath(request.path)}><ExternalLink size={13} />{t('office.open')}</button> : null}
        <button type="button" className="icon-button" aria-label={t('office.close')} title={t('office.close')} onClick={onClose}><X size={15} /></button>
      </header>
      <div className="office-dialog-body">
        {error ? <p role="alert" className="route-error" data-code={error.code || undefined}>{error.text}</p> : null}
        {!state && !error ? <p className="route-note">{t('office.loading')}</p> : null}
        {state && state.changedLater && view === 'compare' ? <p className="route-note">{t('office.changedLater')}</p> : null}
        {state ? view === 'compare' && request.previousSha256
          ? <OfficeCompare before={state.hasBefore ? state.before : null} after={state.after} />
          : <OfficeView preview={state.after} /> : null}
      </div>
    </section>
  </div>
}

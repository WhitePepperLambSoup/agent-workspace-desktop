// Visual (Word-like) editing of a .tex file, from TeXButler 1.0.0. The file stays the source: it is
// parsed into a ProseMirror document, edits are written back (untouched blocks byte for byte), and
// a file that would not survive the round trip unchanged is not edited here.
import {
  BookMarked,
  Bold,
  Braces,
  Code,
  Columns3,
  FileCode2,
  Footprints,
  ImagePlus,
  IndentDecrease,
  IndentIncrease,
  Italic,
  Link2,
  List,
  ListOrdered,
  Redo2,
  Rows3,
  Sigma,
  SquareFunction,
  Table,
  Trash2,
  Underline,
  Undo2,
} from 'lucide-react'
import { keymap } from 'prosemirror-keymap'
import { EditorState, TextSelection, type Command } from 'prosemirror-state'
import { addColumnAfter, addRowAfter, deleteColumn, deleteRow, deleteTable, isInTable } from 'prosemirror-tables'
import { EditorView } from 'prosemirror-view'
import 'prosemirror-view/style/prosemirror.css'
import 'prosemirror-tables/style/tables.css'
import 'prosemirror-gapcursor/style/gapcursor.css'
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode } from 'react'

import { useOptionalI18n } from '../i18n/I18nProvider'
import { zhCN, type MessageKey } from '../i18n/messages'
import type { LatexCitation, LatexLabel } from './latex-language'
import type { LatexEditorHandle } from './LatexEditor'
import {
  buildPlugins,
  currentStyle,
  indent,
  insertDisplayMath,
  insertFigure,
  insertFootnote,
  insertInlineMath,
  insertLatex,
  insertRawBlock,
  insertTable,
  listActive,
  markActive,
  outdent,
  redo,
  setStyle,
  toggle,
  toggleList,
  undo,
} from './visual/commands'
import { parseDocument } from './visual/parse'
import { closePopover, openPopover } from './visual/popover'
import { serialize, serializeDocument } from './visual/serialize'
import { createNodeViews, preambleArg, type FigureSource } from './visual/views'
import './latex-visual.css'

/** The document, or null when writing it back would change the file. */
export function visualDocFor(source: string): ReturnType<typeof parseDocument> | null {
  const doc = parseDocument(source)
  return serialize(doc) === source ? doc : null
}

interface VisualEditorProps {
  path: string
  value: string
  readOnly?: boolean
  labels: readonly LatexLabel[]
  citations: readonly LatexCitation[]
  onChange(value: string): void
  onSave(): void
  onCompile(): void
  onForward(): void
  onCursor?(line: number): void
  onOpenFile(path: string): void
  onSource(): void
}

const MARKS: Record<string, 'bold' | 'italic' | 'underline' | 'code'> = { textbf: 'bold', textit: 'italic', emph: 'italic', underline: 'underline', texttt: 'code' }
const STYLES = ['body', 'chapter', 'section', 'subsection', 'subsubsection', 'paragraph'] as const

function hasKey(key: string): key is MessageKey {
  return Object.prototype.hasOwnProperty.call(zhCN, key)
}

/** `a/b/../c` → `a/c`; null when it leaves the folder. */
function normalize(path: string): string | null {
  const parts: string[] = []
  for (const part of path.replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (!parts.length) return null
      parts.pop()
    } else parts.push(part)
  }
  return parts.join('/')
}

/** Where \includegraphics looks: the document's folder and its \graphicspath folders. */
function figureFolders(path: string, preamble: string): string[] {
  const folder = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
  const listed = /\\graphicspath\s*\{((?:\s*\{[^{}]*\})+)\s*\}/.exec(preamble)?.[1] ?? ''
  const extra = [...listed.matchAll(/\{([^{}]*)\}/g)].map((match) => match[1])
  return ['', ...extra].map((entry) => (folder ? `${folder}/${entry}` : entry))
}

async function readFigure(path: string): Promise<FigureSource | null> {
  const api = window.agentWorkspace
  if (/\.pdf$/i.test(path)) {
    const bytes = await api?.readPdf?.(path)
    return bytes ? { pdf: bytes } : null
  }
  if (/\.(png|jpe?g)$/i.test(path)) {
    const url = await api?.readFigure?.(path)
    return url ? { url } : null
  }
  return null
}

function blockLines(view: EditorView): { lines: number[]; positions: number[] } {
  const { text, offsets } = serializeDocument(view.state.doc)
  const positions: number[] = []
  view.state.doc.forEach((_node, offset) => positions.push(offset))
  const lines: number[] = []
  let line = 1
  let at = 0
  for (const offset of offsets) {
    for (; at < offset; at++) if (text[at] === '\n') line++
    // The block's own first line, past the indentation of its source.
    let k = offset
    let shown = line
    while (k < text.length && /\s/.test(text[k])) {
      if (text[k] === '\n') shown++
      k++
    }
    lines.push(shown)
  }
  return { lines, positions }
}

function revealLine(view: EditorView, line: number): void {
  if (view.isDestroyed) return
  const { lines, positions } = blockLines(view)
  let index = 0
  for (let i = 0; i < lines.length; i++) if (lines[i] <= line) index = i
  const pos = positions[index] ?? 0
  const doc = view.state.doc
  view.dispatch(view.state.tr.setSelection(TextSelection.near(doc.resolve(Math.min(pos + 1, doc.content.size)))).scrollIntoView())
  view.focus()
  const dom = view.nodeDOM(pos)
  if (dom instanceof HTMLElement) {
    dom.classList.add('vis-flash')
    window.setTimeout(() => dom.classList.remove('vis-flash'), 1600)
  }
}

function cursorLineOf(view: EditorView): number {
  return blockLines(view).lines[view.state.selection.$from.index(0)] ?? 1
}

export const VisualEditor = forwardRef<LatexEditorHandle, VisualEditorProps>(function VisualEditor(props, ref) {
  const { t } = useOptionalI18n()
  const mount = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const written = useRef<string | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const [unsupported, setUnsupported] = useState(false)
  const [, setTick] = useState(0)
  const latest = useRef(props)
  latest.current = props

  // The views' strings: TeXButler's keys, "common.*" kept under "vis.*".
  const tText = useRef(t)
  tText.current = t
  const translate = useCallback((key: string, variables?: Record<string, string | number>): string => {
    const own = key.startsWith('common.') ? `vis.${key.slice('common.'.length)}` : key
    return hasKey(own) ? tText.current(own, variables) : key
  }, [])

  const flush = useCallback((): boolean => {
    if (timer.current === undefined) return false
    window.clearTimeout(timer.current)
    timer.current = undefined
    const editor = view.current
    if (!editor) return false
    const source = serialize(editor.state.doc)
    if (source === written.current) return false
    written.current = source
    latest.current.onChange(source)
    return true
  }, [])

  const plugins = useMemo(() => {
    const run = (action: () => void): Command => () => {
      flush()
      action()
      return true
    }
    return [
      keymap({
        'Mod-Enter': run(() => latest.current.onCompile()),
        'Mod-j': run(() => latest.current.onForward()),
      }),
      ...buildPlugins(() => {
        flush()
        latest.current.onSave()
      }),
    ]
  }, [flush])

  const image = useCallback(async (path: string): Promise<FigureSource | null> => {
    // The first figures are drawn while the view is being made: the file's text has the preamble too.
    const preamble: string = view.current?.state.doc.attrs.pre ?? latest.current.value
    const extensions = /\.[A-Za-z0-9]{2,4}$/.test(path) ? [''] : ['.pdf', '.png', '.jpg', '.jpeg']
    for (const folder of figureFolders(latest.current.path, preamble)) {
      for (const extension of extensions) {
        const candidate = normalize(`${folder}${folder && !folder.endsWith('/') ? '/' : ''}${path}${extension}`)
        if (!candidate) continue
        const found = await readFigure(candidate).catch(() => null)
        if (found) return found
      }
    }
    return null
  }, [])

  useEffect(() => {
    const doc = visualDocFor(props.value)
    if (!doc || !mount.current) {
      setUnsupported(true)
      return undefined
    }
    written.current = props.value
    const editor = new EditorView(mount.current, {
      state: EditorState.create({ doc, plugins }),
      nodeViews: createNodeViews({
        image,
        pre: () => view.current?.state.doc.attrs.pre ?? '',
        t: translate,
        openFile: (file) => {
          const folder = latest.current.path.includes('/') ? latest.current.path.slice(0, latest.current.path.lastIndexOf('/') + 1) : ''
          const target = normalize(`${folder}${file}`)
          if (target) latest.current.onOpenFile(target)
        },
      }),
      editable: () => !latest.current.readOnly,
      attributes: { class: 'vis-doc', spellcheck: 'false', 'aria-label': props.path },
      dispatchTransaction(transaction) {
        const current = view.current
        if (!current) return
        current.updateState(current.state.apply(transaction))
        if (transaction.docChanged) {
          window.clearTimeout(timer.current)
          timer.current = window.setTimeout(flush, 300)
        }
        if (transaction.docChanged || transaction.selectionSet) {
          setTick((tick) => tick + 1)
          latest.current.onCursor?.(cursorLineOf(current))
        }
      },
    })
    view.current = editor
    setTick((tick) => tick + 1)
    return () => {
      flush()
      closePopover(true)
      editor.destroy()
      view.current = null
    }
    // One editor per file: the parent keys this component by the tab.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Text changed outside the editor (the agent, a fix, a reload): parse it again.
  useEffect(() => {
    const editor = view.current
    if (!editor || props.value === written.current) return
    window.clearTimeout(timer.current)
    timer.current = undefined
    const doc = visualDocFor(props.value)
    if (!doc) {
      setUnsupported(true)
      return
    }
    written.current = props.value
    editor.updateState(EditorState.create({ doc, plugins, selection: TextSelection.atStart(doc) }))
    setTick((tick) => tick + 1)
  }, [plugins, props.value])

  useImperativeHandle(ref, () => ({
    insert(text) {
      if (view.current) insertLatex(view.current, text.replace('§', ''))
    },
    wrap(command) {
      const editor = view.current
      if (!editor) return
      const mark = MARKS[command]
      if (mark) {
        toggle(mark)(editor.state, editor.dispatch)
        editor.focus()
        return
      }
      const { from, to } = editor.state.selection
      insertLatex(editor, `\\${command}{${editor.state.doc.textBetween(from, to, ' ')}}`)
    },
    goTo(line) {
      if (view.current) revealLine(view.current, line)
    },
    cursorLine() {
      return view.current ? cursorLineOf(view.current) : 1
    },
    focus() {
      view.current?.focus()
    },
    flush,
  }), [flush])

  if (unsupported) {
    return (
      <div className="vis-unsupported" role="status">
        <FileCode2 size={30} aria-hidden="true" />
        <strong>{t('vis.unsupportedTitle')}</strong>
        <p>{t('vis.unsupportedBody')}</p>
        <button type="button" className="toolbar-action-btn primary" onClick={props.onSource}>{t('vis.toSource')}</button>
      </div>
    )
  }

  const cjk = /\\documentclass[^\n]*\{ctex|\\usepackage[^\n]*\{(ctex|xeCJK)/.test(props.value)
  return (
    <div className="vis-shell">
      <Toolbar view={view.current} labels={props.labels} citations={props.citations} readOnly={Boolean(props.readOnly)} />
      <div className="vis-scroll">
        <div className="vis-paper" data-cjk={cjk ? '1' : undefined}>
          <PreambleBar view={view.current} readOnly={Boolean(props.readOnly)} />
          <div ref={mount} className="vis-mount" />
        </div>
      </div>
    </div>
  )
})

function PreambleBar({ view, readOnly }: { view: EditorView | null; readOnly: boolean }) {
  const { t } = useOptionalI18n()
  const button = useRef<HTMLButtonElement>(null)
  const pre: string = view?.state.doc.attrs.pre ?? ''
  if (!pre.trim()) return null
  const documentClass = /\\documentclass\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}/.exec(pre)?.[1]
  const packages = [...pre.matchAll(/\\usepackage\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}/g)].flatMap((match) => match[1].split(',')).length
  const title = preambleArg(pre, 'title')
  const edit = (): void => {
    if (!view || !button.current) return
    openPopover({
      anchor: button.current,
      title: t('vis.preamble'),
      fields: [{ key: 'pre', label: t('vis.preambleHint'), value: pre, mono: true, multiline: true }],
      saveLabel: t('vis.done'),
      cancelLabel: t('vis.cancel'),
      onSave: (values) => {
        const next = values.pre
        if (next === pre) return
        view.dispatch(view.state.tr.setDocAttribute('pre', next.endsWith('\n') || !pre.endsWith('\n') ? next : `${next}\n`))
      },
    })
  }
  return (
    <div className="vis-preamble" contentEditable={false}>
      <span className="vis-preamble-label">{t('vis.preamble')}</span>
      {documentClass ? <code>{documentClass}</code> : null}
      <span>{t('vis.packages', { count: packages })}</span>
      {title ? <span className="vis-preamble-title">{title.replace(/\\\\/g, ' ').replace(/\s+/g, ' ').slice(0, 60)}</span> : null}
      {readOnly ? null : (
        <button ref={button} type="button" className="toolbar-action-btn vis-preamble-edit" onClick={edit}>{t('vis.editPreamble')}</button>
      )}
    </div>
  )
}

interface ToolbarProps {
  view: EditorView | null
  labels: readonly LatexLabel[]
  citations: readonly LatexCitation[]
  readOnly: boolean
}

function Toolbar({ view, labels, citations, readOnly }: ToolbarProps) {
  const { t } = useOptionalI18n()
  const [menu, setMenu] = useState<'table' | 'cite' | 'ref' | null>(null)
  const [filter, setFilter] = useState('')
  const figureButton = useRef<HTMLButtonElement>(null)
  if (!view || readOnly) return <div className="vis-toolbar" />
  const state = view.state
  const run = (command: Command) => () => {
    command(view.state, view.dispatch)
    view.focus()
  }
  const style = currentStyle(state)
  const pre: string = state.doc.attrs.pre ?? ''
  const chapters = /\\documentclass\s*(\[[^\]]*\])?\s*\{(report|book|ctexrep|ctexbook|memoir|scrbook|scrreprt)/.test(pre) || style === 'chapter'
  const inTable = isInTable(state)
  const query = filter.trim().toLowerCase()
  const button = (key: MessageKey, icon: ReactNode, onClick: () => void, active = false) => (
    <button type="button" className="vis-tool" aria-pressed={active} title={t(key)} aria-label={t(key)} onMouseDown={(event) => event.preventDefault()} onClick={onClick}>
      {icon}
    </button>
  )
  const pick = (which: 'table' | 'cite' | 'ref') => {
    setFilter('')
    setMenu(menu === which ? null : which)
  }
  const insertImage = (): void => {
    if (!figureButton.current) return
    openPopover({
      anchor: figureButton.current,
      title: t('vis.insertFigure'),
      fields: [{ key: 'path', label: t('vis.imagePath'), value: '', mono: true, placeholder: 'figures/result.pdf' }],
      saveLabel: t('vis.done'),
      cancelLabel: t('vis.cancel'),
      onSave: (values) => {
        const path = values.path.trim()
        if (path) insertFigure(view, path.replace(/\\/g, '/'))
      },
    })
  }
  return (
    <div className="vis-toolbar" role="toolbar" aria-label={t('vis.toolbar')}>
      <select className="vis-style" value={style === 'paragraph' ? 'body' : style} title={t('vis.style')} aria-label={t('vis.style')}
        onChange={(event) => { setStyle(event.target.value === 'body' ? 'paragraph' : event.target.value)(view.state, view.dispatch); view.focus() }}>
        {STYLES.filter((entry) => entry !== 'chapter' || chapters).map((entry) => <option key={entry} value={entry}>{t(`vis.style.${entry}`)}</option>)}
      </select>
      <span className="vis-divider" />
      {button('vis.bold', <Bold size={15} />, run(toggle('bold')), markActive(state, 'bold'))}
      {button('vis.italic', <Italic size={15} />, run(toggle('italic')), markActive(state, 'italic'))}
      {button('vis.underline', <Underline size={15} />, run(toggle('underline')), markActive(state, 'underline'))}
      {button('vis.code', <Code size={15} />, run(toggle('code')), markActive(state, 'code'))}
      <span className="vis-divider" />
      {button('vis.bulletList', <List size={15} />, run(toggleList('bullet')), listActive(state, 'bullet'))}
      {button('vis.orderedList', <ListOrdered size={15} />, run(toggleList('ordered')), listActive(state, 'ordered'))}
      {button('vis.outdent', <IndentDecrease size={15} />, run(outdent))}
      {button('vis.indent', <IndentIncrease size={15} />, run(indent))}
      <span className="vis-divider" />
      {button('vis.inlineMath', <Sigma size={15} />, () => insertInlineMath(view))}
      {button('vis.displayMath', <SquareFunction size={15} />, () => insertDisplayMath(view))}
      <button ref={figureButton} type="button" className="vis-tool" title={t('vis.insertFigure')} aria-label={t('vis.insertFigure')} onMouseDown={(event) => event.preventDefault()} onClick={insertImage}>
        <ImagePlus size={15} />
      </button>
      <span className="vis-menu-anchor">
        {button('vis.table', <Table size={15} />, () => pick('table'), menu === 'table')}
        {menu === 'table' ? <GridPicker onPick={(rows, columns) => { setMenu(null); insertTable(view, rows, columns) }} /> : null}
      </span>
      <span className="vis-menu-anchor">
        {button('vis.cite', <BookMarked size={15} />, () => pick('cite'), menu === 'cite')}
        {menu === 'cite' ? (
          <div className="vis-pick" role="menu">
            <input className="vis-pick-filter" placeholder={t('vis.filter')} aria-label={t('vis.filter')} value={filter} onChange={(event) => setFilter(event.target.value)} autoFocus />
            <div className="vis-pick-list">
              {citations.filter((entry) => !query || `${entry.key} ${entry.title} ${entry.author}`.toLowerCase().includes(query)).slice(0, 80).map((entry) => (
                <button key={entry.key} type="button" role="menuitem" onClick={() => { setMenu(null); insertLatex(view, `\\cite{${entry.key}}`) }}>
                  <code>{entry.key}</code><span>{entry.title || entry.author}</span>
                </button>
              ))}
              {citations.length === 0 ? <p className="vis-pick-empty">{t('vis.noBib')}</p> : null}
            </div>
          </div>
        ) : null}
      </span>
      <span className="vis-menu-anchor">
        {button('vis.ref', <Link2 size={15} />, () => pick('ref'), menu === 'ref')}
        {menu === 'ref' ? (
          <div className="vis-pick" role="menu">
            <input className="vis-pick-filter" placeholder={t('vis.filter')} aria-label={t('vis.filter')} value={filter} onChange={(event) => setFilter(event.target.value)} autoFocus />
            <div className="vis-pick-list">
              {labels.filter((entry) => !query || entry.key.toLowerCase().includes(query)).slice(0, 80).map((entry) => (
                <button key={`${entry.key}:${entry.file}:${entry.line}`} type="button" role="menuitem"
                  onClick={() => { setMenu(null); insertLatex(view, `\\${entry.key.startsWith('eq:') ? 'eqref' : 'ref'}{${entry.key}}`) }}>
                  <code>{entry.key}</code><span>{entry.file}:{entry.line}</span>
                </button>
              ))}
              {labels.length === 0 ? <p className="vis-pick-empty">{t('vis.noLabels')}</p> : null}
            </div>
          </div>
        ) : null}
      </span>
      {button('vis.footnote', <Footprints size={15} />, () => insertFootnote(view))}
      {button('vis.rawBlock', <Braces size={15} />, () => insertRawBlock(view))}
      {inTable ? (
        <>
          <span className="vis-divider" />
          {button('vis.addRow', <Rows3 size={15} />, run(addRowAfter))}
          {button('vis.addColumn', <Columns3 size={15} />, run(addColumnAfter))}
          {button('vis.deleteRow', <Rows3 size={15} className="vis-minus" />, run(deleteRow))}
          {button('vis.deleteColumn', <Columns3 size={15} className="vis-minus" />, run(deleteColumn))}
          {button('vis.deleteTable', <Trash2 size={15} />, run(deleteTable))}
        </>
      ) : null}
      <span className="vis-divider" />
      {button('vis.undo', <Undo2 size={15} />, run(undo))}
      {button('vis.redo', <Redo2 size={15} />, run(redo))}
    </div>
  )
}

/** A Word-style table size picker. */
function GridPicker({ onPick }: { onPick(rows: number, columns: number): void }) {
  const { t } = useOptionalI18n()
  const [hover, setHover] = useState<[number, number]>([0, 0])
  return (
    <div className="vis-grid" role="menu" aria-label={t('vis.tableSize')} onMouseLeave={() => setHover([0, 0])}>
      <div className="vis-grid-cells">
        {Array.from({ length: 8 }, (_row, row) => Array.from({ length: 8 }, (_column, column) => (
          <button key={`${row}-${column}`} type="button" className={`vis-grid-cell ${row < hover[0] && column < hover[1] ? 'on' : ''}`}
            aria-label={`${row + 1} × ${column + 1}`} onMouseEnter={() => setHover([row + 1, column + 1])} onClick={() => onPick(row + 1, column + 1)} />
        )))}
      </div>
      <span>{hover[0] ? `${hover[0]} × ${hover[1]}` : t('vis.tableSize')}</span>
    </div>
  )
}

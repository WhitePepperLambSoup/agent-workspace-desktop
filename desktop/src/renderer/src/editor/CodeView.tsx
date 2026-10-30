import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { bracketMatching, foldGutter, foldKeymap, foldService, HighlightStyle, indentOnInput, syntaxHighlighting } from '@codemirror/language'
import { linter, lintGutter, type Diagnostic } from '@codemirror/lint'
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search'
import { EditorSelection, EditorState, Prec, RangeSet, StateEffect, StateField, type Extension } from '@codemirror/state'
import {
  crosshairCursor,
  Decoration,
  drawSelection,
  dropCursor,
  EditorView,
  gutter,
  GutterMarker,
  highlightActiveLine,
  highlightActiveLineGutter,
  hoverTooltip,
  keymap,
  lineNumbers,
  rectangularSelection,
  WidgetType,
} from '@codemirror/view'
import { tags } from '@lezer/highlight'
import { Check, Loader2, Sparkles, Undo2, X } from 'lucide-react'
import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'

import { useOptionalI18n } from '../i18n/I18nProvider'
import { languageFor, streamLanguageFor } from './code-languages'

/** A problem the language server found, positions 0-based in UTF-16 units (as CodeMirror counts). */
export interface CodeProblem {
  line: number
  character: number
  endLine: number
  endCharacter: number
  severity: number
  message: string
  source?: string | null
}

export interface CodeLocation {
  path: string
  inside: boolean
  line: number
  character: number
}

/** The language server's answers for the open folder. */
export interface CodeIntel {
  diagnostics(path: string, text: string): Promise<{ available: boolean; problems: CodeProblem[] }>
  definition(path: string, line: number, character: number): Promise<CodeLocation[]>
  hover(path: string, line: number, character: number): Promise<string>
}

/** The model's help in the editor: rewriting a selection, completing at the cursor. */
export interface CodeAi {
  rewrite(request: { path: string; language: string; before: string; selection: string; after: string; instruction: string }): Promise<string>
  complete?(path: string, prefix: string, suffix: string): Promise<{ available: boolean; text: string }>
}

export interface CodeViewHandle {
  goTo(line: number, character?: number): void
  focus(): void
}

interface CodeViewProps {
  path: string
  value: string
  readOnly?: boolean
  label: string
  onChange(value: string): void
  onSave(): void
  intel?: CodeIntel
  ai?: CodeAi
  /** Whether the model completes code as you type (Tab accepts). */
  completion?: boolean
  onOpenLocation?(location: CodeLocation): void
  /** Breakpoints (1-based lines): a gutter to set them is shown when this is given. */
  breakpoints?: readonly number[]
  onBreakpointsChange?(lines: number[]): void
  /** Where the debugger stopped in this file (1-based), highlighted. */
  pausedLine?: number | null
}

const highlight = HighlightStyle.define([
  { tag: [tags.keyword, tags.controlKeyword, tags.operatorKeyword, tags.modifier], color: 'var(--accent)', fontWeight: '600' },
  { tag: [tags.definition(tags.variableName), tags.function(tags.variableName), tags.function(tags.propertyName)], color: 'var(--accent-strong, var(--accent))' },
  { tag: [tags.typeName, tags.className, tags.namespace], color: 'var(--info, var(--accent))' },
  { tag: [tags.string, tags.special(tags.string), tags.regexp], color: 'var(--success, #3a9a5b)' },
  { tag: [tags.number, tags.bool, tags.atom, tags.null], color: 'var(--warning)' },
  { tag: [tags.comment, tags.lineComment, tags.blockComment], color: 'var(--faint)', fontStyle: 'italic' },
  { tag: [tags.meta, tags.annotation], color: 'var(--text-muted)' },
  { tag: [tags.tagName], color: 'var(--accent)' },
  { tag: [tags.attributeName, tags.propertyName], color: 'var(--text)' },
  { tag: tags.invalid, color: 'var(--danger)' },
])

const theme = EditorView.theme({
  '&': { height: '100%', fontSize: '13px', color: 'var(--text)', backgroundColor: 'transparent' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.55' },
  '.cm-content': { caretColor: 'var(--accent)' },
  '.cm-gutters': { backgroundColor: 'transparent', color: 'var(--faint)', border: 'none' },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'var(--accent-soft)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': { backgroundColor: 'var(--accent-soft) !important' },
  '.cm-tooltip': { backgroundColor: 'var(--reading)', color: 'var(--text)', border: '1px solid var(--divider)', borderRadius: '6px' },
  '.cm-tooltip-lint': { maxWidth: '560px' },
  '.cm-hover-info pre': { margin: '0', padding: '6px 8px', maxWidth: '640px', maxHeight: '280px', overflow: 'auto', whiteSpace: 'pre-wrap', font: '12px/1.45 var(--font-mono)' },
  '.cm-panels': { backgroundColor: 'var(--raised)', color: 'var(--text)' },
  '.cm-searchMatch': { backgroundColor: 'var(--accent-soft)' },
  '.cm-foldGutter span': { color: 'var(--faint)' },
  '.cm-ghost': { color: 'var(--faint)', whiteSpace: 'pre', opacity: '0.85' },
  '.cm-ai-line': { backgroundColor: 'color-mix(in srgb, var(--success, #3a9a5b) 14%, transparent)' },
  '.cm-breakpoint-gutter .cm-gutterElement': { width: '14px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  '.cm-breakpoint': { display: 'inline-block', width: '9px', height: '9px', borderRadius: '50%', backgroundColor: 'var(--danger)' },
  '.cm-paused-line': { backgroundColor: 'color-mix(in srgb, var(--warning) 26%, transparent)' },
})

/** Folding by indentation: what is indented under a line folds into it. */
const indentFolding = foldService.of((state, lineStart) => {
  const line = state.doc.lineAt(lineStart)
  if (!line.text.trim()) return null
  const indent = /^\s*/.exec(line.text)![0].length
  let end = line.number
  const last = Math.min(state.doc.lines, line.number + 3000)
  for (let number = line.number + 1; number <= last; number += 1) {
    const next = state.doc.line(number)
    if (!next.text.trim()) continue
    if (/^\s*/.exec(next.text)![0].length <= indent) break
    end = number
  }
  return end > line.number ? { from: line.to, to: state.doc.line(end).to } : null
})

// -- breakpoints in a gutter, and the line the debugger stopped at --------------------------------

class BreakpointMarker extends GutterMarker {
  override toDOM(): Node {
    const dot = document.createElement('span')
    dot.className = 'cm-breakpoint'
    return dot
  }
}
const breakpointMarker = new BreakpointMarker()
// Sizes the gutter (its width is set in the theme) without a dot of its own.
class SpacerMarker extends GutterMarker {}
const spacerMarker = new SpacerMarker()
const setBreakpoints = StateEffect.define<readonly number[]>()
const toggleBreakpoint = StateEffect.define<number>()

// Kept as positions so a breakpoint moves with its line as text is added above it.
const breakpointField = StateField.define<RangeSet<GutterMarker>>({
  create: () => RangeSet.empty,
  update(set, transaction) {
    let next = set.map(transaction.changes)
    for (const effect of transaction.effects) {
      if (effect.is(setBreakpoints)) {
        const doc = transaction.state.doc
        const lines = [...new Set(effect.value)].filter((line) => line >= 1 && line <= doc.lines).sort((a, b) => a - b)
        next = RangeSet.of(lines.map((line) => breakpointMarker.range(doc.line(line).from)))
      } else if (effect.is(toggleBreakpoint)) {
        let present = false
        next.between(effect.value, effect.value, (from) => { if (from === effect.value) present = true })
        next = present
          ? next.update({ filter: (from) => from !== effect.value })
          : next.update({ add: [breakpointMarker.range(effect.value)] })
      }
    }
    return next
  },
})

function breakpointLines(state: EditorState): number[] {
  const lines: number[] = []
  state.field(breakpointField).between(0, state.doc.length, (from) => { lines.push(state.doc.lineAt(from).number) })
  return [...new Set(lines)]
}

const breakpointGutter = [
  breakpointField,
  gutter({
    class: 'cm-breakpoint-gutter',
    markers: (target) => target.state.field(breakpointField),
    initialSpacer: () => spacerMarker,
    domEventHandlers: {
      mousedown(target, line) {
        target.dispatch({ effects: toggleBreakpoint.of(line.from) })
        return true
      },
    },
  }),
]

const setPausedLine = StateEffect.define<number | null>()
const pausedField = StateField.define<number | null>({
  create: () => null,
  update(value, transaction) {
    for (const effect of transaction.effects) if (effect.is(setPausedLine)) return effect.value
    return value !== null && transaction.docChanged ? transaction.changes.mapPos(value) : value
  },
})
const pausedLineDecoration = EditorView.decorations.compute([pausedField], (state) => {
  const at = state.field(pausedField, false)
  return at === null || at === undefined ? Decoration.none : Decoration.set([Decoration.line({ class: 'cm-paused-line' }).range(state.doc.lineAt(at).from)])
})

// -- completion shown as grey text at the cursor ------------------------------------------------

interface Ghost { pos: number; text: string }
const setGhost = StateEffect.define<Ghost | null>()

class GhostWidget extends WidgetType {
  constructor(readonly text: string) { super() }
  eq(other: GhostWidget): boolean { return other.text === this.text }
  toDOM(): HTMLElement {
    const span = document.createElement('span')
    span.className = 'cm-ghost'
    span.textContent = this.text
    return span
  }
  ignoreEvent(): boolean { return true }
}

const ghostField = StateField.define<Ghost | null>({
  create: () => null,
  update(value, transaction) {
    for (const effect of transaction.effects) if (effect.is(setGhost)) return effect.value
    return transaction.docChanged || transaction.selection ? null : value
  },
  provide: (field) => EditorView.decorations.from(field, (ghost) =>
    ghost ? Decoration.set([Decoration.widget({ widget: new GhostWidget(ghost.text), side: 1 }).range(ghost.pos)]) : Decoration.none),
})

function acceptGhost(view: EditorView): boolean {
  const ghost = view.state.field(ghostField, false)
  if (!ghost) return false
  view.dispatch({ changes: { from: ghost.pos, insert: ghost.text }, selection: EditorSelection.cursor(ghost.pos + ghost.text.length), userEvent: 'input.complete' })
  return true
}

// -- the model's rewrite of a selection, kept marked until accepted ------------------------------

interface Pending { from: number; to: number; original: string }
const setPending = StateEffect.define<Pending | null>()

const pendingField = StateField.define<Pending | null>({
  create: () => null,
  update(value, transaction) {
    for (const effect of transaction.effects) if (effect.is(setPending)) return effect.value
    if (value && transaction.docChanged) {
      return { ...value, from: transaction.changes.mapPos(value.from, -1), to: transaction.changes.mapPos(value.to, 1) }
    }
    return value
  },
})

const pendingLines = EditorView.decorations.compute([pendingField], (state) => {
  const pending = state.field(pendingField, false)
  if (!pending || pending.to <= pending.from) return Decoration.none
  const ranges = []
  const last = state.doc.lineAt(Math.max(pending.from, pending.to - 1)).number
  for (let number = state.doc.lineAt(pending.from).number; number <= last; number += 1) {
    ranges.push(Decoration.line({ class: 'cm-ai-line' }).range(state.doc.line(number).from))
  }
  return Decoration.set(ranges)
})

function stripFences(text: string): string {
  return text.replace(/^```[\w-]*\n?/gm, '').replace(/^```$/gm, '').trim()
}

/** The model's replacement without Markdown fences or blank lines around it; the indentation of
 * its first line stays (the code sits where the selection was). */
function replacementOf(text: string): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  if (lines.length >= 2 && /^\s*```/.test(lines[0]!) && /^\s*```\s*$/.test(lines[lines.length - 1]!)) {
    lines.shift()
    lines.pop()
  }
  while (lines.length && !lines[0]!.trim()) lines.shift()
  while (lines.length && !lines[lines.length - 1]!.trim()) lines.pop()
  return lines.join('\n')
}

type Overlay =
  | { kind: 'ask'; from: number; to: number; top: number; left: number }
  | { kind: 'working'; from: number; to: number; top: number; left: number }
  | { kind: 'review'; top: number; left: number; added: number; removed: number }

export const CodeView = forwardRef<CodeViewHandle, CodeViewProps>(function CodeView(props, ref) {
  const { t } = useOptionalI18n()
  const shell = useRef<HTMLDivElement>(null)
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const latest = useRef(props)
  latest.current = props
  const [overlay, setOverlay] = useState<Overlay | null>(null)
  const [instruction, setInstruction] = useState('')
  const [failed, setFailed] = useState(false)
  const overlayRef = useRef<Overlay | null>(null)
  overlayRef.current = overlay
  // No server for this kind of file: stop asking.
  const intelOff = useRef(false)
  const completionOff = useRef(false)
  const completionTimer = useRef<number | null>(null)

  const placeAt = (pos: number): { top: number; left: number } => {
    const editor = view.current
    const box = shell.current?.getBoundingClientRect()
    let coords: { top: number; left: number } | null = null
    try {
      coords = editor?.coordsAtPos(pos) ?? null
    } catch {
      coords = null  // not laid out (a hidden tab)
    }
    if (!editor || !box || !coords) return { top: 8, left: 48 }
    return { top: Math.max(4, coords.top - box.top - 40), left: Math.max(40, Math.min(coords.left - box.left, box.width - 380)) }
  }

  const openAsk = (): boolean => {
    const editor = view.current
    if (!editor || !latest.current.ai || latest.current.readOnly) return false
    if (editor.state.field(pendingField, false)) return true
    const range = editor.state.selection.main
    setInstruction('')
    setFailed(false)
    setOverlay({ kind: 'ask', from: range.from, to: range.to, ...placeAt(range.from) })
    return true
  }

  const settle = (accept: boolean): boolean => {
    const editor = view.current
    const pending = editor?.state.field(pendingField, false)
    if (!editor || !pending) return false
    editor.dispatch(accept
      ? { effects: setPending.of(null) }
      : { changes: { from: pending.from, to: pending.to, insert: pending.original }, effects: setPending.of(null), userEvent: 'input.reject' })
    setOverlay(null)
    editor.focus()
    return true
  }

  const submit = async (): Promise<void> => {
    const editor = view.current
    const current = overlayRef.current
    const ai = latest.current.ai
    if (!editor || !ai || !current || current.kind !== 'ask' || !instruction.trim()) return
    const { from, to } = current
    const doc = editor.state.doc
    setOverlay({ ...current, kind: 'working' })
    setFailed(false)
    try {
      const replacement = replacementOf(await ai.rewrite({
        path: latest.current.path,
        language: languageFor(latest.current.path)?.name ?? '',
        before: doc.sliceString(0, from),
        selection: doc.sliceString(from, to),
        after: doc.sliceString(to),
        instruction: instruction.trim(),
      }))
      if (view.current !== editor) return
      // Keep the selection's own indentation: the model returns its lines as they sit in the file.
      const original = editor.state.doc.sliceString(from, to)
      editor.dispatch({
        changes: { from, to, insert: replacement },
        effects: setPending.of({ from, to: from + replacement.length, original }),
        userEvent: 'input.rewrite',
        scrollIntoView: true,
      })
      const removed = original ? original.split('\n').length : 0
      setOverlay({ kind: 'review', ...placeAt(from), added: replacement ? replacement.split('\n').length : 0, removed })
    } catch {
      setFailed(true)
      setOverlay({ ...current, kind: 'ask' })
    }
  }

  const goToDefinition = async (pos: number): Promise<boolean> => {
    const editor = view.current
    const intel = latest.current.intel
    if (!editor || !intel) return false
    const line = editor.state.doc.lineAt(pos)
    const found = await intel.definition(latest.current.path, line.number - 1, pos - line.from).catch(() => [])
    const target = found[0]
    if (!target) return false
    if (target.inside && target.path === latest.current.path) {
      const at = editor.state.doc.line(Math.min(editor.state.doc.lines, target.line + 1))
      const head = Math.min(at.from + target.character, at.to)
      editor.dispatch({ selection: { anchor: head }, effects: EditorView.scrollIntoView(head, { y: 'center' }) })
      editor.focus()
    } else latest.current.onOpenLocation?.(target)
    return true
  }

  const askCompletion = (editor: EditorView): void => {
    if (completionTimer.current !== null) window.clearTimeout(completionTimer.current)
    const ai = latest.current.ai
    if (!ai?.complete || !latest.current.completion || completionOff.current) return
    completionTimer.current = window.setTimeout(() => {
      completionTimer.current = null
      const state = editor.state
      const range = state.selection.main
      if (!range.empty || state.field(pendingField, false)) return
      const line = state.doc.lineAt(range.head)
      // Only at the end of what is typed on the line: no suggestion in the middle of a word.
      if (state.doc.sliceString(range.head, line.to).trim()) return
      const doc = state.doc
      void ai.complete!(latest.current.path, doc.sliceString(Math.max(0, range.head - 6000), range.head), doc.sliceString(range.head, range.head + 3000))
        .then((answer) => {
          if (!answer.available) { completionOff.current = true; return }
          if (view.current !== editor || editor.state.doc !== doc || editor.state.selection.main.head !== range.head || !answer.text) return
          editor.dispatch({ effects: setGhost.of({ pos: range.head, text: answer.text }) })
        })
        .catch(() => undefined)
    }, 650)
  }

  useEffect(() => {
    if (!host.current) return undefined
    const language = streamLanguageFor(props.path)
    const assistKeys = Prec.highest(keymap.of([
      { key: 'Tab', run: (target) => acceptGhost(target) },
      { key: 'Escape', run: (target) => {
        if (target.state.field(ghostField, false)) { target.dispatch({ effects: setGhost.of(null) }); return true }
        if (target.state.field(pendingField, false)) return settle(false)
        return false
      } },
      { key: 'Mod-Enter', run: () => settle(true) },
      // Only when the box opens: otherwise Ctrl+K stays the window's command palette.
      { key: 'Mod-k', run: () => openAsk() },
      { key: 'F12', preventDefault: true, run: (target) => { void goToDefinition(target.state.selection.main.head); return true } },
      { key: 'Mod-s', preventDefault: true, run: () => { latest.current.onSave(); return true } },
    ]))
    const extensions: Extension[] = [
      assistKeys,
      ...(props.onBreakpointsChange ? breakpointGutter : []),
      lineNumbers(),
      foldGutter(),
      highlightActiveLineGutter(),
      history(),
      drawSelection(),
      dropCursor(),
      EditorState.allowMultipleSelections.of(true),
      rectangularSelection(),
      crosshairCursor(),
      indentOnInput(),
      bracketMatching(),
      closeBrackets(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      search({ top: true }),
      indentFolding,
      keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...foldKeymap, indentWithTab]),
      ...(language ? [language, syntaxHighlighting(highlight)] : []),
      ghostField,
      pendingField,
      pendingLines,
      pausedField,
      pausedLineDecoration,
      theme,
      EditorState.readOnly.of(Boolean(props.readOnly)),
      EditorView.contentAttributes.of({ 'aria-label': props.label, spellcheck: 'false', autocorrect: 'off', autocapitalize: 'off' }),
      EditorView.domEventHandlers({
        mousedown(event, target) {
          if (!(event.ctrlKey || event.metaKey) || !latest.current.intel) return false
          const pos = target.posAtCoords({ x: event.clientX, y: event.clientY })
          if (pos === null) return false
          event.preventDefault()
          void goToDefinition(pos)
          return true
        },
      }),
      EditorView.updateListener.of((update) => {
        if (latest.current.onBreakpointsChange && update.startState.field(breakpointField, false) !== update.state.field(breakpointField, false)) {
          const lines = breakpointLines(update.state)
          const known = latest.current.breakpoints ?? []
          if (lines.length !== known.length || lines.some((line, index) => line !== known[index])) latest.current.onBreakpointsChange(lines)
        }
        if (update.docChanged) {
          latest.current.onChange(update.state.doc.toString())
          if (update.transactions.some((transaction) => transaction.isUserEvent('input.type'))) askCompletion(update.view)
        }
      }),
    ]
    if (props.intel) {
      extensions.push(lintGutter(), linter(async (target) => {
        const intel = latest.current.intel
        if (!intel || intelOff.current) return []
        const doc = target.state.doc
        const answer = await intel.diagnostics(latest.current.path, doc.toString()).catch(() => null)
        if (!answer) return []
        if (!answer.available) { intelOff.current = true; return [] }
        return answer.problems.flatMap((problem): Diagnostic[] => {
          if (problem.line >= doc.lines) return []
          const start = doc.line(problem.line + 1)
          const endLine = doc.line(Math.min(doc.lines, problem.endLine + 1))
          const from = Math.min(start.from + problem.character, start.to)
          const to = Math.max(from, Math.min(endLine.from + problem.endCharacter, endLine.to))
          const severity = problem.severity === 1 ? 'error' : problem.severity === 2 ? 'warning' : 'info'
          return [{ from, to: to > from ? to : Math.min(from + 1, doc.length), severity, message: problem.message, source: problem.source ?? undefined }]
        })
      }, { delay: 750 }))
      extensions.push(hoverTooltip(async (target, pos) => {
        const intel = latest.current.intel
        if (!intel || intelOff.current) return null
        const line = target.state.doc.lineAt(pos)
        const text = stripFences(await intel.hover(latest.current.path, line.number - 1, pos - line.from).catch(() => ''))
        if (!text) return null
        return {
          pos,
          above: true,
          create: () => {
            const dom = document.createElement('div')
            dom.className = 'cm-hover-info'
            const pre = document.createElement('pre')
            pre.textContent = text.slice(0, 1600)
            dom.append(pre)
            return { dom }
          },
        }
      }, { hoverTime: 500 }))
    }
    // The window's style policy refuses <style> elements; inside a shadow root CodeMirror adds its
    // styles as constructed style sheets instead, which the policy allows.
    const shadow = host.current.shadowRoot ?? host.current.attachShadow({ mode: 'open' })
    const container = document.createElement('div')
    container.style.height = '100%'
    shadow.appendChild(container)
    const editor = new EditorView({ state: EditorState.create({ doc: props.value, extensions }), parent: container, root: shadow })
    view.current = editor
    if (props.onBreakpointsChange && props.breakpoints?.length) editor.dispatch({ effects: setBreakpoints.of(props.breakpoints) })
    return () => {
      if (completionTimer.current !== null) window.clearTimeout(completionTimer.current)
      editor.destroy()
      container.remove()
      view.current = null
    }
    // One editor per file: the parent keys this component by path.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Breakpoints set elsewhere (the debug panel cleared them): show them.
  useEffect(() => {
    const editor = view.current
    if (!editor || !props.onBreakpointsChange) return
    const wanted = props.breakpoints ?? []
    const shown = breakpointLines(editor.state)
    if (shown.length !== wanted.length || shown.some((line, index) => line !== wanted[index])) editor.dispatch({ effects: setBreakpoints.of(wanted) })
  }, [props.breakpoints, props.onBreakpointsChange])

  // The debugger stopped here, or went on.
  useEffect(() => {
    const editor = view.current
    if (!editor) return
    const line = props.pausedLine
    if (!line || line > editor.state.doc.lines) {
      editor.dispatch({ effects: setPausedLine.of(null) })
      return
    }
    const at = editor.state.doc.line(line).from
    editor.dispatch({ effects: [setPausedLine.of(at), EditorView.scrollIntoView(at, { y: 'center' })] })
  }, [props.pausedLine])

  // Text changed outside the editor (saved by the agent, reloaded): take it, keeping the cursor.
  useEffect(() => {
    const editor = view.current
    if (!editor) return
    const current = editor.state.doc.toString()
    if (current === props.value) return
    const head = Math.min(editor.state.selection.main.head, props.value.length)
    editor.dispatch({ changes: { from: 0, to: current.length, insert: props.value }, selection: { anchor: head }, effects: [setPending.of(null), setGhost.of(null)] })
    setOverlay(null)
  }, [props.value])

  useImperativeHandle(ref, () => ({
    goTo(line, character = 0) {
      const editor = view.current
      if (!editor) return
      const target = editor.state.doc.line(Math.min(Math.max(1, line), editor.state.doc.lines))
      const at = Math.min(target.from + character, target.to)
      editor.dispatch({ selection: { anchor: at }, effects: EditorView.scrollIntoView(at, { y: 'center' }) })
      editor.focus()
    },
    focus() { view.current?.focus() },
  }), [])

  const onAskKey = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') { event.preventDefault(); void submit() }
    if (event.key === 'Escape') { event.preventDefault(); setOverlay(null); view.current?.focus() }
  }

  return (
    <div ref={shell} className="code-view-shell">
      <div ref={host} className="code-view-host" data-path={props.path} />
      {overlay && overlay.kind !== 'review' ? (
        <div className="code-ask" style={{ top: overlay.top, left: overlay.left }} role="dialog" aria-label={t('editor.ask.title')}>
          <Sparkles size={14} aria-hidden="true" />
          <input
            autoFocus
            aria-label={t('editor.ask.instruction')}
            placeholder={overlay.from === overlay.to ? t('editor.ask.placeholderInsert') : t('editor.ask.placeholder')}
            value={instruction}
            disabled={overlay.kind === 'working'}
            onChange={(event) => setInstruction(event.target.value)}
            onKeyDown={onAskKey}
          />
          {overlay.kind === 'working' ? <Loader2 size={14} className="spin-animation" aria-label={t('editor.ask.working')} /> : (
            <button type="button" className="icon-button" aria-label={t('editor.ask.close')} onClick={() => { setOverlay(null); view.current?.focus() }}><X size={13} /></button>
          )}
          {failed ? <span className="code-ask-error" role="status">{t('editor.ask.failed')}</span> : null}
        </div>
      ) : null}
      {overlay?.kind === 'review' ? (
        <div className="code-ask code-review-bar" style={{ top: overlay.top, left: overlay.left }} role="group" aria-label={t('editor.ask.review')}>
          <span className="code-review-summary">{t('editor.ask.summary', { added: String(overlay.added), removed: String(overlay.removed) })}</span>
          <button type="button" className="provider-primary" onClick={() => settle(true)}><Check size={13} aria-hidden="true" />{t('editor.ask.accept')}</button>
          <button type="button" className="provider-secondary" onClick={() => settle(false)}><Undo2 size={13} aria-hidden="true" />{t('editor.ask.reject')}</button>
        </div>
      ) : null}
    </div>
  )
})

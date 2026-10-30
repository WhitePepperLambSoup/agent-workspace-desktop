import { closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { bracketMatching, HighlightStyle, indentOnInput, syntaxHighlighting } from '@codemirror/language'
import { lintGutter, setDiagnostics, type Diagnostic } from '@codemirror/lint'
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search'
import { EditorSelection, EditorState, type Extension } from '@codemirror/state'
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from '@codemirror/view'
import { tags } from '@lezer/highlight'
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'

import { latexCompletion, latexLanguage, type CompletionData } from './latex-language'

export interface EditorProblem {
  line: number
  column?: number
  severity: 'error' | 'warning' | 'info' | 'suggestion'
  message: string
}

export interface LatexEditorHandle {
  /** Type text at the cursor; the selection (or the cursor) goes where ``§`` is. */
  insert(text: string): void
  /** Wrap the selection in ``\command{...}``. */
  wrap(command: string): void
  goTo(line: number, column?: number): void
  cursorLine(): number
  focus(): void
  /** Hand over edits not yet passed to onChange (the visual editor waits a moment after typing); whether there were any. */
  flush?(): boolean
}

interface LatexEditorProps {
  path: string
  value: string
  readOnly?: boolean
  problems: readonly EditorProblem[]
  completion: () => CompletionData
  label: string
  onChange(value: string): void
  onSave(): void
  onCompile(): void
  onForward(): void
  onCursor?(line: number): void
}

const highlight = HighlightStyle.define([
  { tag: [tags.tagName, tags.standard(tags.variableName)], color: 'var(--accent)' },
  { tag: tags.keyword, color: 'var(--accent)', fontWeight: '600' },
  { tag: tags.comment, color: 'var(--faint)', fontStyle: 'italic' },
  { tag: [tags.atom, tags.number, tags.string], color: 'var(--warning)' },
  { tag: tags.bracket, color: 'var(--text-muted)' },
  { tag: tags.invalid, color: 'var(--danger)' },
])

const theme = EditorView.theme({
  '&': { height: '100%', fontSize: '13px', color: 'var(--text)', backgroundColor: 'transparent' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.6' },
  '.cm-content': { caretColor: 'var(--accent)' },
  '.cm-gutters': { backgroundColor: 'transparent', color: 'var(--faint)', border: 'none' },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'var(--accent-soft)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': { backgroundColor: 'var(--accent-soft) !important' },
  '.cm-tooltip': { backgroundColor: 'var(--reading)', color: 'var(--text)', border: '1px solid var(--divider)' },
  '.cm-tooltip-autocomplete ul li[aria-selected]': { backgroundColor: 'var(--accent-soft)', color: 'var(--text)' },
  '.cm-panels': { backgroundColor: 'var(--raised)', color: 'var(--text)' },
  '.cm-searchMatch': { backgroundColor: 'var(--accent-soft)' },
})

function position(state: EditorState, line: number, column?: number): number {
  const target = state.doc.line(Math.min(Math.max(1, line), state.doc.lines))
  return Math.min(target.from + Math.max(0, (column ?? 1) - 1), target.to)
}

function diagnostics(state: EditorState, problems: readonly EditorProblem[]): Diagnostic[] {
  return problems.filter((problem) => problem.line >= 1).map((problem) => {
    const line = state.doc.line(Math.min(problem.line, state.doc.lines))
    const from = problem.column ? position(state, problem.line, problem.column) : line.from
    return {
      from,
      to: problem.column ? Math.min(from + 1, line.to) : line.to,
      severity: problem.severity === 'error' ? 'error' : problem.severity === 'warning' ? 'warning' : 'info',
      message: problem.message,
    }
  })
}

export const LatexEditor = forwardRef<LatexEditorHandle, LatexEditorProps>(function LatexEditor(props, ref) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  // The latest callbacks, read by the editor's listeners.
  const latest = useRef(props)
  latest.current = props

  useEffect(() => {
    if (!host.current) return undefined
    const commands = keymap.of([
      { key: 'Mod-s', preventDefault: true, run: () => { latest.current.onSave(); return true } },
      { key: 'Mod-Enter', preventDefault: true, run: () => { latest.current.onCompile(); return true } },
      { key: 'Mod-j', preventDefault: true, run: () => { latest.current.onForward(); return true } },
      { key: 'Mod-b', preventDefault: true, run: (target) => { wrapSelection(target, 'textbf'); return true } },
      { key: 'Mod-i', preventDefault: true, run: (target) => { wrapSelection(target, 'emph'); return true } },
    ])
    const extensions: Extension[] = [
      commands,
      lineNumbers(),
      highlightActiveLineGutter(),
      history(),
      drawSelection(),
      indentOnInput(),
      bracketMatching(),
      closeBrackets(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      search({ top: true }),
      keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...completionKeymap, indentWithTab]),
      EditorView.lineWrapping,
      latexLanguage,
      syntaxHighlighting(highlight),
      latexCompletion(() => latest.current.completion()),
      lintGutter(),
      theme,
      EditorState.readOnly.of(Boolean(props.readOnly)),
      EditorView.contentAttributes.of({ 'aria-label': props.label, spellcheck: 'false' }),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) latest.current.onChange(update.state.doc.toString())
        if (update.selectionSet || update.docChanged) {
          latest.current.onCursor?.(update.state.doc.lineAt(update.state.selection.main.head).number)
        }
      }),
    ]
    // The window's style policy refuses <style> elements; inside a shadow root CodeMirror adds its
    // styles as constructed style sheets instead, which the policy allows.
    const shadow = host.current.shadowRoot ?? host.current.attachShadow({ mode: 'open' })
    const container = document.createElement('div')
    container.style.height = '100%'
    shadow.appendChild(container)
    const editor = new EditorView({
      state: EditorState.create({ doc: props.value, extensions }),
      parent: container,
      root: shadow,
    })
    view.current = editor
    return () => {
      editor.destroy()
      container.remove()
      view.current = null
    }
    // One editor per file: the parent keys this component by path.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Text changed outside the editor (a fix, a reload): take it, keeping the cursor where it can.
  useEffect(() => {
    const editor = view.current
    if (!editor) return
    const current = editor.state.doc.toString()
    if (current === props.value) return
    const head = Math.min(editor.state.selection.main.head, props.value.length)
    editor.dispatch({ changes: { from: 0, to: current.length, insert: props.value }, selection: { anchor: head } })
  }, [props.value])

  useEffect(() => {
    const editor = view.current
    if (!editor) return
    editor.dispatch(setDiagnostics(editor.state, diagnostics(editor.state, props.problems)))
  }, [props.problems, props.value])

  useImperativeHandle(ref, () => ({
    insert(text) {
      const editor = view.current
      if (!editor) return
      const range = editor.state.selection.main
      const selected = editor.state.sliceDoc(range.from, range.to)
      const marker = text.indexOf('§')
      const inserted = marker >= 0 ? text.replace('§', selected) : text + selected
      const cursor = range.from + (marker >= 0 ? marker + selected.length : inserted.length)
      editor.dispatch({ changes: { from: range.from, to: range.to, insert: inserted }, selection: EditorSelection.cursor(cursor), scrollIntoView: true })
      editor.focus()
    },
    wrap(command) {
      if (view.current) wrapSelection(view.current, command)
    },
    goTo(line, column) {
      const editor = view.current
      if (!editor) return
      const at = position(editor.state, line, column)
      editor.dispatch({ selection: { anchor: at }, effects: EditorView.scrollIntoView(at, { y: 'center' }) })
      editor.focus()
    },
    cursorLine() {
      const editor = view.current
      return editor ? editor.state.doc.lineAt(editor.state.selection.main.head).number : 1
    },
    focus() {
      view.current?.focus()
    },
  }), [])

  return <div ref={host} className="latex-editor-host" data-path={props.path} />
})

function wrapSelection(editor: EditorView, command: string): void {
  const range = editor.state.selection.main
  const selected = editor.state.sliceDoc(range.from, range.to)
  const opening = `\\${command}{`
  editor.dispatch({
    changes: { from: range.from, to: range.to, insert: `${opening}${selected}}` },
    selection: selected
      ? EditorSelection.range(range.from + opening.length, range.from + opening.length + selected.length)
      : EditorSelection.cursor(range.from + opening.length),
  })
  editor.focus()
}

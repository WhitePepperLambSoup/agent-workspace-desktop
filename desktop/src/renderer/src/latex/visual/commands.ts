// Editing commands, keymap and input rules of the visual editor.
import { chainCommands, setBlockType, toggleMark, baseKeymap } from "prosemirror-commands";
import { history, redo, undo } from "prosemirror-history";
import { InputRule, inputRules, wrappingInputRule } from "prosemirror-inputrules";
import { keymap } from "prosemirror-keymap";
import { liftListItem, sinkListItem, splitListItem, wrapInList } from "prosemirror-schema-list";
import { dropCursor } from "prosemirror-dropcursor";
import { gapCursor } from "prosemirror-gapcursor";
import { goToNextCell, tableEditing } from "prosemirror-tables";
import type { Node as PMNode, NodeType } from "prosemirror-model";
import { EditorState, Plugin, TextSelection, type Command } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { schema } from "./schema";
import { parseBlocks, parseInline } from "./parse";
import { editNodeAt } from "./views";
import { numberingPlugin } from "./numbering";

const n = schema.nodes;

/** Current paragraph style: "paragraph" or the heading command. */
export function currentStyle(state: EditorState): string {
  const parent = state.selection.$from.parent;
  if (parent.type === n.heading) return parent.attrs.cmd;
  return "paragraph";
}

export function setStyle(style: string): Command {
  return (state, dispatch) => {
    if (style === "paragraph") return setBlockType(n.paragraph)(state, dispatch);
    const parent = state.selection.$from.parent;
    const keep = parent.type === n.heading ? { label: parent.attrs.label, star: parent.attrs.star, labelSep: parent.attrs.labelSep } : {};
    return setBlockType(n.heading, { cmd: style, ...keep })(state, dispatch);
  };
}

export function markActive(state: EditorState, type: string): boolean {
  const mark = schema.marks[type];
  const { from, $from, to, empty } = state.selection;
  if (empty) return Boolean(mark.isInSet(state.storedMarks || $from.marks()));
  return state.doc.rangeHasMark(from, to, mark);
}

export const toggle = (type: "bold" | "italic" | "underline" | "code"): Command => toggleMark(schema.marks[type]);

/** Inside a list of the given type? */
function inList(state: EditorState, type: NodeType): boolean {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type === type) return true;
  }
  return false;
}

export function listActive(state: EditorState, kind: "bullet" | "ordered"): boolean {
  return inList(state, kind === "bullet" ? n.bullet_list : n.ordered_list);
}

export function toggleList(kind: "bullet" | "ordered"): Command {
  const type = kind === "bullet" ? n.bullet_list : n.ordered_list;
  return (state, dispatch) => {
    if (inList(state, type)) return liftListItem(n.list_item)(state, dispatch);
    return wrapInList(type)(state, dispatch);
  };
}

export const indent: Command = (state, dispatch) => sinkListItem(n.list_item)(state, dispatch);
export const outdent: Command = (state, dispatch) => liftListItem(n.list_item)(state, dispatch);

const hardBreak: Command = (state, dispatch) => {
  if (dispatch) dispatch(state.tr.replaceSelectionWith(n.hard_break.create()).scrollIntoView());
  return true;
};

/** Where a new block goes: replace an empty paragraph, else after the current top-level block. */
function blockInsertPos(state: EditorState): { from: number; to: number } {
  const { $from } = state.selection;
  if ($from.depth === 0) return { from: $from.pos, to: $from.pos };
  const parent = $from.parent;
  if (parent.type === n.paragraph && parent.content.size === 0 && $from.depth === 1) {
    return { from: $from.before(1), to: $from.after(1) };
  }
  const after = $from.after(1);
  return { from: after, to: after };
}

/** Does the document's preamble define a full document (\documentclass)? */
export function hasPreamble(state: EditorState): boolean {
  return /\\documentclass/.test(state.doc.attrs.pre ?? "");
}

/** Is `pkg` loaded by the preamble (\usepackage[..]{a,pkg,b})? */
export function loadsPackage(state: EditorState, pkg: string): boolean {
  const pre: string = state.doc.attrs.pre ?? "";
  return [...pre.matchAll(/\\(?:usepackage|RequirePackage)\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}/g)].some((m) =>
    m[1].split(",").map((s) => s.trim()).includes(pkg),
  );
}

/**
 * Add `\usepackage{pkg}` to the preamble (just before \begin{document})
 * when the document has a preamble and does not load it yet.
 */
function ensurePackage(tr: import("prosemirror-state").Transaction, state: EditorState, pkg: string): boolean {
  if (!hasPreamble(state) || loadsPackage(state, pkg)) return false;
  const pre: string = tr.doc.attrs.pre ?? "";
  const at = pre.lastIndexOf("\\begin{document}");
  if (at < 0) return false;
  // `pre` is "\n"-normalized; the serializer restores CRLF files
  tr.setDocAttribute("pre", `${pre.slice(0, at)}\\usepackage{${pkg}}\n${pre.slice(at)}`);
  return true;
}

/** Insert a block node and return its position. */
export function insertBlock(view: EditorView, node: PMNode, edit = false, packages: string[] = []): number {
  const { from, to } = blockInsertPos(view.state);
  const tr = view.state.tr.replaceWith(from, to, node);
  for (const pkg of packages) ensurePackage(tr, view.state, pkg);
  const pos = from;
  const after = pos + node.nodeSize;
  // keep a paragraph after the new block so typing can continue
  if (after >= tr.doc.content.size || tr.doc.resolve(after).nodeAfter == null) {
    tr.insert(after, n.paragraph.create());
  }
  tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(after + 1, tr.doc.content.size))));
  view.dispatch(tr.scrollIntoView());
  view.focus();
  if (edit) requestAnimationFrame(() => editNodeAt(view, pos));
  return pos;
}

export function insertInlineMath(view: EditorView) {
  const { from } = view.state.selection;
  const selected = view.state.doc.textBetween(view.state.selection.from, view.state.selection.to);
  view.dispatch(view.state.tr.replaceSelectionWith(n.math_inline.create({ body: selected, delim: "$" })));
  view.focus();
  requestAnimationFrame(() => editNodeAt(view, from));
}

export function insertDisplayMath(view: EditorView) {
  insertBlock(view, n.math_display.create({ env: "equation", head: "\\begin{equation}", body: "\n  \n", foot: "\\end{equation}" }), true);
}

export function insertTable(view: EditorView, rows: number, cols: number) {
  const r = Array.from({ length: rows }, () => n.table_row.create(null, Array.from({ length: cols }, () => n.table_cell.create())));
  // booktabs rules when the preamble can load booktabs; \hline otherwise
  const booktabs = hasPreamble(view.state) || loadsPackage(view.state, "booktabs");
  const table = n.table.create({ spec: "c".repeat(cols), caption: "", label: null, rules: booktabs ? "booktabs" : "hline", header: true }, r);
  const pos = insertBlock(view, table, false, booktabs ? ["booktabs"] : []);
  // cursor into the first cell
  const tr = view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(pos + 3)));
  view.dispatch(tr);
  view.focus();
}

export function insertFigure(view: EditorView, path: string) {
  const base = path.split("/").pop()?.replace(/\.[^.]+$/, "").replace(/[^A-Za-z0-9_-]+/g, "-") || "figure";
  insertBlock(view, n.figure.create({ path, caption: "", label: `fig:${base}`, gopts: "width=0.8\\linewidth" }), true, ["graphicx"]);
}

export function insertRawBlock(view: EditorView, latex = "") {
  insertBlock(view, n.raw.create({ latex, kind: "code" }), true);
}

/** Insert LaTeX at the cursor: inline commands become atoms, block code becomes blocks. */
export function insertLatex(view: EditorView, latex: string): boolean {
  const state = view.state;
  if (/\n/.test(latex.trim()) || /^\s*\\begin\{/.test(latex)) {
    const parsed = parseBlocks(latex.trim(), { theorems: new Set() });
    if (!parsed.nodes.length) return false;
    const { from, to } = blockInsertPos(state);
    view.dispatch(state.tr.replaceWith(from, to, parsed.nodes).scrollIntoView());
    view.focus();
    return true;
  }
  const nodes = parseInline(latex, state.storedMarks ?? state.selection.$from.marks());
  const tr = state.tr.replaceWith(state.selection.from, state.selection.to, nodes).scrollIntoView();
  if (/\\eqref\b/.test(latex)) ensurePackage(tr, state, "amsmath");
  view.dispatch(tr);
  view.focus();
  return true;
}

export function insertFootnote(view: EditorView) {
  const { from } = view.state.selection;
  insertLatex(view, "\\footnote{}");
  requestAnimationFrame(() => editNodeAt(view, from));
}

// ------------------------------------------------------------- input rules

/** `$x^2$` typed in text becomes inline math. */
const mathRule = new InputRule(/(^|[^\\$])\$([^$\n]+)\$$/, (state, match, start, end) => {
  const lead = match[1];
  return state.tr.replaceWith(start + lead.length, end, n.math_inline.create({ body: match[2], delim: "$" }));
});

export function buildPlugins(onSave: () => void): Plugin[] {
  const listKeys: Command = chainCommands(goToNextCell(1), sinkListItem(n.list_item));
  return [
    history(),
    inputRules({
      rules: [mathRule, wrappingInputRule(/^\s*([-*])\s$/, n.bullet_list), wrappingInputRule(/^\s*1[.)]\s$/, n.ordered_list)],
    }),
    keymap({
      "Mod-z": undo,
      "Mod-y": redo,
      "Shift-Mod-z": redo,
      "Mod-b": toggle("bold"),
      "Mod-i": toggle("italic"),
      "Mod-u": toggle("underline"),
      "Mod-`": toggle("code"),
      "Mod-s": () => {
        onSave();
        return true;
      },
      Enter: splitListItem(n.list_item),
      "Shift-Enter": hardBreak,
      Tab: listKeys,
      "Shift-Tab": chainCommands(goToNextCell(-1), liftListItem(n.list_item)),
      "Mod-Alt-0": setStyle("paragraph"),
      "Mod-Alt-1": setStyle("section"),
      "Mod-Alt-2": setStyle("subsection"),
      "Mod-Alt-3": setStyle("subsubsection"),
    }),
    keymap(baseKeymap),
    dropCursor(),
    gapCursor(),
    tableEditing(),
    numberingPlugin(),
  ];
}

export { undo, redo };

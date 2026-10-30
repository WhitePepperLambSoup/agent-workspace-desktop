// Numbers of headings, figures, tables and equations, as LaTeX would
// assign them (per chapter when the document has chapters). Computed in JS
// and attached as node decorations (`data-num`): CSS counters made every
// keystroke restyle the whole document.
import type { Node as PMNode } from "prosemirror-model";
import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";

const CONTAINERS = new Set(["env_block", "bullet_list", "ordered_list", "list_item"]);
const UNNUMBERED_MATH = new Set(["\\[", "$$", "displaymath", "math", "split"]);

export function numberDecorations(doc: PMNode): DecorationSet {
  const decos: Decoration[] = [];
  const c = { chapter: 0, section: 0, subsection: 0, subsubsection: 0, figure: 0, table: 0, equation: 0 };
  const hasChapters = (() => {
    let found = false;
    doc.forEach((n) => {
      if (n.type.name === "heading" && n.attrs.cmd === "chapter") found = true;
    });
    return found;
  })();
  const prefix = (n: number) => (hasChapters && c.chapter ? `${c.chapter}.${n}` : `${n}`);
  // the spec carries the number too, for node views that show it inside (figure / table captions)
  const mark = (node: PMNode, pos: number, num: string) => decos.push(Decoration.node(pos, pos + node.nodeSize, { "data-num": num }, { num }));
  const visit = (node: PMNode, pos: number) => {
    const name = node.type.name;
    if (name === "heading" && !node.attrs.star) {
      switch (node.attrs.cmd) {
        case "chapter":
          c.chapter++;
          c.section = c.subsection = c.subsubsection = c.figure = c.table = c.equation = 0;
          mark(node, pos, `${c.chapter}`);
          break;
        case "section":
          c.section++;
          c.subsection = c.subsubsection = 0;
          mark(node, pos, prefix(c.section));
          break;
        case "subsection":
          c.subsection++;
          c.subsubsection = 0;
          mark(node, pos, `${prefix(c.section)}.${c.subsection}`);
          break;
        case "subsubsection":
          c.subsubsection++;
          mark(node, pos, `${prefix(c.section)}.${c.subsection}.${c.subsubsection}`);
          break;
      }
    } else if (name === "figure") {
      c.figure++;
      mark(node, pos, prefix(c.figure));
    } else if (name === "table" && node.attrs.head != null) {
      c.table++;
      mark(node, pos, prefix(c.table));
    } else if (name === "math_display" && !String(node.attrs.env).endsWith("*") && !UNNUMBERED_MATH.has(node.attrs.env)) {
      c.equation++;
      mark(node, pos, prefix(c.equation));
    } else if (CONTAINERS.has(name)) {
      node.forEach((child, off) => visit(child, pos + 1 + off));
    }
  };
  doc.forEach((node, off) => visit(node, off));
  return DecorationSet.create(doc, decos);
}

const key = new PluginKey<DecorationSet>("numbering");

export function numberingPlugin(): Plugin {
  return new Plugin<DecorationSet>({
    key,
    state: {
      init: (_c, state) => numberDecorations(state.doc),
      apply: (tr, old) => (tr.docChanged ? numberDecorations(tr.doc) : old),
    },
    props: {
      decorations: (state) => key.getState(state),
    },
  });
}

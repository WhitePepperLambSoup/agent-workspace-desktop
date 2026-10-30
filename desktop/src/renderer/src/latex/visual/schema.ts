// ProseMirror schema of the visual (Word-like) editor.
// The files of this folder come from TeXButler 1.0.0 (src/visual, MIT) and are
// kept close to it, so later versions can be compared and taken over.
//
// The .tex file stays the single source of truth. Every block node keeps
//   src  — its exact original source text (null for blocks created here),
//   sig  — a signature of its content at parse time,
//   gap  — the whitespace that followed it in the source,
// so the serializer writes untouched blocks back byte-for-byte and only
// regenerates what was edited. Anything the parser does not understand
// becomes a `raw` block / `latex` inline atom carrying its exact source.
import { Schema, type NodeSpec, type MarkSpec } from "prosemirror-model";
import { tableNodes } from "prosemirror-tables";

const tracked = {
  src: { default: null as string | null },
  sig: { default: null as string | null },
  gap: { default: "\n\n" },
};

const tables = tableNodes({
  tableGroup: "block",
  cellContent: "inline*",
  cellAttributes: {},
});

const nodes: Record<string, NodeSpec> = {
  doc: {
    // pre: everything up to and including \begin{document} (verbatim);
    // post: \end{document} and what follows. Chapter files have neither.
    // eol: "\r\n" when the file uses Windows line endings throughout (it is
    // parsed with "\n" and converted back on output)
    attrs: { pre: { default: "" }, post: { default: "" }, eol: { default: "\n" } },
    content: "block+",
  },
  paragraph: {
    group: "block",
    content: "inline*",
    attrs: { ...tracked },
    parseDOM: [{ tag: "p" }],
    toDOM: () => ["p", { class: "vis-p" }, 0],
  },
  heading: {
    group: "block",
    content: "inline*",
    defining: true,
    attrs: {
      ...tracked,
      cmd: { default: "section" },
      star: { default: false },
      label: { default: null as string | null },
      /** text between the heading command and its \label (e.g. "\n") */
      labelSep: { default: "" },
    },
    toDOM: (n) => [
      `h${headingLevel(n.attrs.cmd)}`,
      { class: `vis-h vis-${n.attrs.cmd}${n.attrs.star ? " vis-star" : ""}`, "data-label": n.attrs.label ?? undefined },
      0,
    ],
  },
  // A list that changed is regenerated as a whole (head, one \item per
  // line, foot); an untouched list is written back from `src`.
  bullet_list: {
    group: "block",
    content: "list_item+",
    attrs: { ...tracked, head: { default: "\\begin{itemize}" }, foot: { default: "\\end{itemize}" }, indent: { default: "  " } },
    toDOM: () => ["ul", { class: "vis-ul" }, 0],
  },
  ordered_list: {
    group: "block",
    content: "list_item+",
    attrs: { ...tracked, head: { default: "\\begin{enumerate}" }, foot: { default: "\\end{enumerate}" }, indent: { default: "  " } },
    toDOM: () => ["ol", { class: "vis-ol" }, 0],
  },
  list_item: {
    content: "paragraph block*",
    defining: true,
    toDOM: () => ["li", 0],
  },
  /** Prose environments (abstract, quote, theorem, proof, center, …). */
  env_block: {
    group: "block",
    content: "block+",
    defining: true,
    attrs: { ...tracked, env: { default: "quote" }, head: { default: "\\begin{quote}" }, lead: { default: "\n" }, foot: { default: "\\end{quote}" } },
    toDOM: (n) => ["div", { class: `vis-env vis-env-${n.attrs.env}`, "data-env": n.attrs.env }, 0],
  },
  math_display: {
    group: "block",
    atom: true,
    attrs: {
      ...tracked,
      env: { default: "equation" },
      head: { default: "\\begin{equation}" },
      body: { default: "" },
      foot: { default: "\\end{equation}" },
    },
    toDOM: () => ["div", { class: "vis-math-display" }],
  },
  figure: {
    group: "block",
    atom: true,
    attrs: {
      ...tracked,
      head: { default: "\\begin{figure}[htbp]" },
      foot: { default: "\\end{figure}" },
      center: { default: true },
      gopts: { default: "width=0.8\\linewidth" },
      path: { default: "" },
      caption: { default: null as string | null },
      label: { default: null as string | null },
      order: { default: ["centering", "includegraphics", "caption", "label"] as string[] },
      indent: { default: "  " },
    },
    toDOM: () => ["figure", { class: "vis-figure" }],
  },
  table: {
    ...tables.table,
    attrs: {
      ...tracked,
      /** \begin{table}… head, or null for a bare tabular */
      head: { default: "\\begin{table}[htbp]" as string | null },
      foot: { default: "\\end{table}" as string | null },
      center: { default: true },
      caption: { default: null as string | null },
      label: { default: null as string | null },
      captionBelow: { default: false },
      spec: { default: "" },
      rules: { default: "booktabs" },
      header: { default: true },
      indent: { default: "  " },
    },
  },
  table_row: tables.table_row,
  table_cell: tables.table_cell,
  table_header: tables.table_header,
  /** Anything else, kept verbatim and editable as LaTeX. */
  raw: {
    group: "block",
    atom: true,
    attrs: { ...tracked, latex: { default: "" }, kind: { default: "code" } },
    toDOM: () => ["div", { class: "vis-raw" }],
  },
  text: { group: "inline" },
  math_inline: {
    group: "inline",
    inline: true,
    atom: true,
    attrs: { body: { default: "" }, delim: { default: "$" } },
    toDOM: () => ["span", { class: "vis-math" }],
  },
  /** \\ (optionally with [len] or *) */
  hard_break: {
    group: "inline",
    inline: true,
    selectable: false,
    attrs: { src: { default: "\\\\" } },
    toDOM: () => ["br"],
  },
  /** cite / ref / label / footnote / url / any other command, verbatim. */
  latex: {
    group: "inline",
    inline: true,
    atom: true,
    attrs: { src: { default: "" }, kind: { default: "cmd" } },
    toDOM: () => ["span", { class: "vis-latex" }],
  },
};

const marks: Record<string, MarkSpec> = {
  bold: {
    attrs: { cmd: { default: "textbf" } },
    toDOM: () => ["strong", 0],
  },
  italic: {
    attrs: { cmd: { default: "textit" } },
    toDOM: () => ["em", 0],
  },
  underline: {
    attrs: { cmd: { default: "underline" } },
    toDOM: () => ["u", 0],
  },
  code: {
    attrs: { cmd: { default: "texttt" } },
    toDOM: () => ["code", 0],
  },
};

export const schema = new Schema({ nodes, marks });

export const HEADING_CMDS = ["part", "chapter", "section", "subsection", "subsubsection", "paragraph", "subparagraph"] as const;

export function headingLevel(cmd: string): number {
  const i = HEADING_CMDS.indexOf(cmd as (typeof HEADING_CMDS)[number]);
  return Math.min(6, Math.max(1, i < 0 ? 2 : i + 1));
}

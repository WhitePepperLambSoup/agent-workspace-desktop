// ProseMirror document → LaTeX source. Untouched blocks are written back
// from their recorded source; edited or new blocks are regenerated.
import type { Fragment, Mark, Node as PMNode } from "prosemirror-model";
import { specColumns } from "./parse";
import { sigOf } from "./sig";

/** Escape plain text for LaTeX (the inverse of the inline parser). */
export function escapeText(text: string): string {
  let out = "";
  for (const ch of text) {
    switch (ch) {
      case "\\":
        out += "\\textbackslash{}";
        break;
      case "{":
      case "}":
      case "%":
      case "&":
      case "#":
      case "$":
      case "_":
        out += `\\${ch}`;
        break;
      case "^":
        out += "\\^{}";
        break;
      case "~":
        out += "\\textasciitilde{}";
        break;
      case " ":
        out += "~";
        break;
      case "\n":
        out += " ";
        break;
      default:
        out += ch;
    }
  }
  return out;
}

function atomSrc(node: PMNode): string {
  switch (node.type.name) {
    case "math_inline":
      return node.attrs.delim === "\\(" ? `\\(${node.attrs.body}\\)` : `$${node.attrs.body}$`;
    case "hard_break":
      return node.attrs.src || "\\\\";
    default:
      return node.attrs.src ?? "";
  }
}

/** Serialize inline content, nesting mark commands. */
export function serializeInline(content: Fragment): string {
  let out = "";
  let open: readonly Mark[] = [];
  const closeTo = (keep: number) => {
    for (let i = open.length - 1; i >= keep; i--) out += "}";
    open = open.slice(0, keep);
  };
  content.forEach((child) => {
    const marks = child.marks;
    let keep = 0;
    while (keep < open.length && keep < marks.length && open[keep].eq(marks[keep])) keep++;
    closeTo(keep);
    for (let i = keep; i < marks.length; i++) out += `\\${marks[i].attrs.cmd}{`;
    open = marks;
    let piece = child.isText ? escapeText(child.text ?? "") : atomSrc(child);
    // a control word followed by a letter needs a separator: \LaTeX{}text
    if (/\\[A-Za-z@]+$/.test(out) && /^[A-Za-z]/.test(piece)) piece = `{}${piece}`;
    out += piece;
  });
  closeTo(0);
  return out;
}

/** True when the block still matches what was parsed. */
export function unchanged(node: PMNode): boolean {
  return node.attrs.src != null && node.attrs.sig != null && node.attrs.sig === sigOf(node);
}

/** A block's own text (without the whitespace after it). */
function blockText(node: PMNode): string {
  return unchanged(node) ? node.attrs.src : regenerate(node);
}

/**
 * The whitespace after `node`. Two paragraphs need a blank line between
 * them (a single newline would merge them into one LaTeX paragraph); in a
 * parsed file they always have one, so this only affects edits (Enter).
 */
function gapAfter(node: PMNode, next: PMNode | null): string {
  const gap = typeof node.attrs.gap === "string" ? node.attrs.gap : "";
  if (next && node.type.name === "paragraph" && next.type.name === "paragraph" && (gap.match(/\n/g)?.length ?? 0) < 2) {
    return `\n\n${/[ \t]*$/.exec(gap)?.[0] ?? ""}`;
  }
  return gap;
}

/** Child blocks joined; `offsets` receives each child's start offset. */
function joinBlocks(parent: PMNode, base = "", offsets?: number[]): string {
  let out = base;
  const n = parent.childCount;
  for (let i = 0; i < n; i++) {
    const child = parent.child(i);
    offsets?.push(out.length);
    out += blockText(child) + gapAfter(child, i + 1 < n ? parent.child(i + 1) : null);
  }
  return out;
}

function children(node: PMNode): string {
  return joinBlocks(node);
}

function regenerate(node: PMNode): string {
  const a = node.attrs;
  switch (node.type.name) {
    case "paragraph":
      return serializeInline(node.content);
    case "heading": {
      const label = a.label ? `${a.labelSep ?? ""}\\label{${a.label}}` : "";
      return `\\${a.cmd}${a.star ? "*" : ""}{${serializeInline(node.content)}}${label}`;
    }
    case "raw":
      return a.latex;
    case "math_display":
      return `${a.head}${a.body}${a.foot}`;
    case "env_block": {
      const inner = children(node);
      return `${a.head}${a.lead}${inner}${inner.endsWith("\n") ? "" : "\n"}${a.foot}`;
    }
    case "bullet_list":
    case "ordered_list":
      return regenerateList(node);
    case "figure":
      return regenerateFigure(node);
    case "table":
      return regenerateTable(node);
    default:
      return a.src ?? "";
  }
}

/** Item content without trailing whitespace; nested blocks on their own lines. */
function itemContent(item: PMNode, indent: string): string {
  let out = "";
  let prev: PMNode | null = null;
  item.forEach((child) => {
    let text = blockText(child).replace(/\s+$/, "");
    // a regenerated nested block (e.g. a sub-list) is indented under its item
    if (!unchanged(child)) text = text.replace(/\n/g, `\n${indent}  `);
    if (prev) out += prev.type.name === "paragraph" && child.type.name === "paragraph" ? `\n\n${indent}  ` : `\n${indent}  `;
    out += text;
    prev = child;
  });
  return out;
}

function regenerateList(node: PMNode): string {
  const indent = node.attrs.indent ?? "  ";
  const items: string[] = [];
  node.forEach((item) => {
    const body = itemContent(item, indent);
    items.push(`${indent}\\item${body ? ` ${body}` : ""}`);
  });
  return `${node.attrs.head}\n${items.join("\n")}\n${node.attrs.foot}`;
}

function regenerateFigure(node: PMNode): string {
  const a = node.attrs;
  const ind = a.indent || "  ";
  const order: string[] = [...(a.order as string[])];
  for (const k of ["centering", "includegraphics", "caption", "label"]) {
    const wanted = k === "centering" ? a.center : k === "includegraphics" ? true : k === "caption" ? a.caption != null : a.label != null;
    if (wanted && !order.includes(k)) order.push(k);
  }
  const lines: string[] = [];
  for (const k of order) {
    if (k === "centering" && a.center) lines.push("\\centering");
    else if (k === "includegraphics") lines.push(`\\includegraphics${a.gopts ? `[${a.gopts}]` : ""}{${a.path}}`);
    else if (k === "caption" && a.caption != null) lines.push(`\\caption{${a.caption}}`);
    else if (k === "label" && a.label != null) lines.push(`\\label{${a.label}}`);
  }
  return `${a.head}\n${lines.map((l) => ind + l).join("\n")}\n${a.foot}`;
}

/** Adapt a column spec to `n` columns (adds `l` / drops trailing columns). */
export function fitSpec(spec: string, n: number): string {
  const have = specColumns(spec);
  if (have === n || have < 0) return spec;
  if (/^[|lcr ]*$/.test(spec)) {
    const bars = spec.includes("|");
    const letters = spec.replace(/[| ]/g, "").split("");
    while (letters.length < n) letters.push("l");
    letters.length = n;
    return bars ? `|${letters.join("|")}|` : letters.join("");
  }
  return have < n ? spec + "l".repeat(n - have) : spec;
}

function regenerateTable(node: PMNode): string {
  const a = node.attrs;
  const float = a.head != null;
  const ind = float ? a.indent || "  " : "";
  const rowInd = `${ind}  `;
  const rows: string[] = [];
  node.forEach((row) => {
    const cells: string[] = [];
    row.forEach((cell) => cells.push(serializeInline(cell.content).trim()));
    rows.push(cells.join(" & "));
  });
  const cols = node.firstChild?.childCount ?? 0;
  const booktabs = a.rules === "booktabs";
  const hline = a.rules === "hline";
  const body: string[] = [];
  if (booktabs) body.push("\\toprule");
  if (hline) body.push("\\hline");
  rows.forEach((r, i) => {
    body.push(`${r} \\\\`);
    if (i === 0 && a.header && rows.length > 1) body.push(booktabs ? "\\midrule" : hline ? "\\hline" : "");
  });
  if (booktabs) body.push("\\bottomrule");
  if (hline) body.push("\\hline");
  const tabular = [
    `${ind}\\begin{tabular}{${fitSpec(a.spec || "c".repeat(cols), cols)}}`,
    ...body.filter((l) => l !== "").map((l) => rowInd + l),
    `${ind}\\end{tabular}`,
  ];
  if (!float) return tabular.join("\n");
  const lines: string[] = [];
  if (a.center) lines.push(`${ind}\\centering`);
  const cap = [a.caption != null ? `${ind}\\caption{${a.caption}}` : "", a.label != null ? `${ind}\\label{${a.label}}` : ""].filter(Boolean);
  if (!a.captionBelow) lines.push(...cap);
  lines.push(...tabular);
  if (a.captionBelow) lines.push(...cap);
  return `${a.head}\n${lines.join("\n")}\n${a.foot}`;
}

/**
 * Serialize the whole document with "\n" line endings; also returns the
 * offset of each top-level block (for line numbers).
 */
export function serializeDocument(doc: PMNode): { text: string; offsets: number[] } {
  const offsets: number[] = [];
  const text = joinBlocks(doc, doc.attrs.pre ?? "", offsets) + (doc.attrs.post ?? "");
  return { text, offsets };
}

/** The file content, in the file's own line-ending style. */
export function serialize(doc: PMNode): string {
  const { text } = serializeDocument(doc);
  return doc.attrs.eol === "\r\n" ? text.replace(/\r?\n/g, "\r\n") : text;
}

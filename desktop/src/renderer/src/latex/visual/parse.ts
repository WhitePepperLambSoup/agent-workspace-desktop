// LaTeX source → ProseMirror document for the visual editor.
//
// Block parsing partitions the source exactly: every character belongs to
// the document's `pre`/`post`, a block's `src`, or a block's `gap`, so an
// untouched document serializes back byte-for-byte (checked before the
// visual editor is allowed to edit a file).
import { Fragment, type Mark, type Node as PMNode } from "prosemirror-model";
import { HEADING_CMDS, schema } from "./schema";
import {
  commandName,
  commentStart,
  findEnvEnd,
  isEscaped,
  lineEnd,
  matchBrace,
  matchBracket,
  skipSpaces,
  skipWs,
  splitTopLevel,
} from "./scan";
import { sigOf } from "./sig";

// ------------------------------------------------------------- vocabulary

export const MATH_ENVS = new Set([
  "equation", "equation*", "align", "align*", "gather", "gather*", "multline", "multline*", "flalign", "flalign*",
  "alignat", "alignat*", "eqnarray", "eqnarray*", "displaymath", "math", "split",
]);
const PROSE_ENVS = new Set([
  "abstract", "quote", "quotation", "center", "flushleft", "flushright", "proof",
  "theorem", "lemma", "corollary", "proposition", "definition", "remark", "example", "conjecture", "claim", "note",
  "assumption", "axiom", "exercise", "problem", "solution", "notation", "hypothesis",
]);
/** Commands that form a block of their own when they start a line. */
const BLOCK_CMDS = new Set([
  "maketitle", "tableofcontents", "listoffigures", "listoftables", "newpage", "clearpage", "cleardoublepage", "pagebreak",
  "bibliography", "bibliographystyle", "printbibliography", "addbibresource", "input", "include", "appendix",
  "frontmatter", "mainmatter", "backmatter", "vspace", "vfill", "bigskip", "medskip", "smallskip", "centering",
  "raggedright", "raggedleft", "setlength", "setcounter", "addtocounter", "pagestyle", "thispagestyle", "newcommand",
  "renewcommand", "providecommand", "newenvironment", "renewenvironment", "newtheorem", "usepackage", "label",
  "caption", "includegraphics", "hline", "midrule", "toprule", "bottomrule", "item", "makeatletter", "makeatother",
  "def", "let", "graphicspath", "selectlanguage", "printindex", "nocite", "onecolumn", "twocolumn", "end",
]);
const MARK_CMDS: Record<string, "bold" | "italic" | "underline" | "code"> = {
  textbf: "bold",
  textit: "italic",
  emph: "italic",
  underline: "underline",
  texttt: "code",
};
const REF_CMDS = new Set([
  "ref", "eqref", "pageref", "autoref", "Autoref", "cref", "Cref", "nameref", "vref", "Vref", "vpageref", "labelcref",
  "subref", "cpageref", "Cpageref", "hyperref",
]);
const CITE_CMDS = new Set([
  "cite", "Cite", "citep", "citet", "Citep", "Citet", "citealp", "citealt", "citeauthor", "Citeauthor", "citeyear",
  "citeyearpar", "citenum", "nocite", "parencite", "Parencite", "textcite", "Textcite", "autocite", "Autocite",
  "footcite", "supercite", "fullcite", "smartcite", "Smartcite",
]);
const ESCAPES: Record<string, string> = { "%": "%", "&": "&", _: "_", "#": "#", $: "$", "{": "{", "}": "}" };
const ACCENT_SYMBOLS = new Set(["'", "`", "^", '"', "~", "=", "."]);
const CJK = /[　-〿㐀-鿿豈-﫿＀-￯]/;

export interface ParseCtx {
  /** Theorem-like environments declared with \newtheorem in the preamble. */
  theorems: Set<string>;
}

// ------------------------------------------------------------- helpers

function finalize(node: PMNode): PMNode {
  if (!("sig" in node.attrs)) return node;
  return node.type.create({ ...node.attrs, sig: sigOf(node) }, node.content, node.marks);
}

function withGap(node: PMNode, gap: string): PMNode {
  if (!("gap" in node.attrs)) return node;
  return node.type.create({ ...node.attrs, gap }, node.content, node.marks);
}

function rawBlock(src: string, kind = "code"): PMNode {
  return finalize(schema.nodes.raw.create({ src, latex: src, kind }));
}

function emptyParagraph(): PMNode {
  return finalize(schema.nodes.paragraph.create({ src: "", gap: "" }));
}

/** Trailing same-line text after `end`: whitespace-only → end; comment → to line end; else null. */
function lineTail(text: string, end: number): number | null {
  const le = lineEnd(text, end);
  const rest = text.slice(end, le);
  if (/^\s*$/.test(rest)) return end;
  if (/^\s*%/.test(rest)) return le;
  return null;
}

// ------------------------------------------------------------- inline

const latexAtom = (src: string, kind: string, marks: readonly Mark[]) => schema.nodes.latex.create({ src, kind }, null, marks);

/** Consume a command's `*`, `[...]` and `{...}` groups immediately following `i`. */
function consumeArgs(s: string, i: number, maxGroups = 9): number {
  let j = i;
  if (s[j] === "*") j++;
  for (let n = 0; n < maxGroups; n++) {
    if (s[j] === "[") {
      const e = matchBracket(s, j);
      if (e < 0) break;
      j = e;
    } else if (s[j] === "{") {
      const e = matchBrace(s, j);
      if (e < 0) break;
      j = e;
    } else break;
  }
  return j;
}

/** Parse paragraph-level LaTeX into inline nodes. */
export function parseInline(s: string, marks: readonly Mark[] = []): PMNode[] {
  const out: PMNode[] = [];
  let text = "";
  const flush = () => {
    if (text) out.push(schema.text(text, marks));
    text = "";
  };
  const atom = (src: string, kind: string) => {
    flush();
    out.push(latexAtom(src, kind, marks));
  };
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === "%") {
      // comment: up to and including the newline
      const le = lineEnd(s, i);
      atom(s.slice(i, Math.min(le + 1, s.length)), "comment");
      i = Math.min(le + 1, s.length);
      continue;
    }
    if (c === "\n" || c === "\r") {
      // a source line break inside a paragraph is a space
      let j = i;
      while (j < s.length && /\s/.test(s[j])) j++;
      // ctex / xeCJK ignore a line break between two CJK characters
      const prev = text ? text[text.length - 1] : out[out.length - 1]?.text?.slice(-1) ?? "";
      if (!(CJK.test(prev) && CJK.test(s[j] ?? "")) && !text.endsWith(" ")) text += " ";
      i = j;
      continue;
    }
    if (c === "~") {
      text += " ";
      i++;
      continue;
    }
    if (c === "$") {
      if (s[i + 1] === "$") {
        const close = s.indexOf("$$", i + 2);
        if (close < 0) {
          atom(s.slice(i), "cmd");
          break;
        }
        atom(s.slice(i, close + 2), "math");
        i = close + 2;
        continue;
      }
      let j = i + 1;
      while (j < s.length && !(s[j] === "$" && !isEscaped(s, j))) j++;
      if (j >= s.length) {
        atom(s.slice(i), "cmd");
        break;
      }
      flush();
      out.push(schema.nodes.math_inline.create({ body: s.slice(i + 1, j), delim: "$" }, null, marks));
      i = j + 1;
      continue;
    }
    if (c === "{") {
      const e = matchBrace(s, i);
      const end = e < 0 ? s.length : e;
      atom(s.slice(i, end), "group");
      i = end;
      continue;
    }
    if (c === "}" || c === "&" || c === "^" || c === "_" || c === "#") {
      atom(c, "cmd");
      i++;
      continue;
    }
    if (c !== "\\") {
      text += c;
      i++;
      continue;
    }
    // ---- backslash
    const next = s[i + 1];
    if (next === undefined) {
      atom("\\", "cmd");
      break;
    }
    if (next === "\\") {
      // \\ with optional * and [len]
      let j = i + 2;
      if (s[j] === "*") j++;
      const k = skipSpaces(s, j);
      if (s[k] === "[") {
        const e = matchBracket(s, k);
        if (e > 0) j = e;
      }
      flush();
      out.push(schema.nodes.hard_break.create({ src: s.slice(i, j) }, null, marks));
      i = j;
      continue;
    }
    if (ESCAPES[next]) {
      text += ESCAPES[next];
      i += 2;
      continue;
    }
    if (next === "(") {
      const close = s.indexOf("\\)", i + 2);
      if (close < 0) {
        atom(s.slice(i), "cmd");
        break;
      }
      flush();
      out.push(schema.nodes.math_inline.create({ body: s.slice(i + 2, close), delim: "\\(" }, null, marks));
      i = close + 2;
      continue;
    }
    if (next === "[") {
      // display math inside a paragraph line: keep \[ … \] as one atom
      const close = findDisplayClose(s, i + 2, "\\]");
      const end = close < 0 ? i + 2 : close + 2;
      atom(s.slice(i, end), close < 0 ? "cmd" : "math");
      i = end;
      continue;
    }
    if (next === "^" && s.startsWith("{}", i + 2)) {
      text += "^";
      i += 4;
      continue;
    }
    if (ACCENT_SYMBOLS.has(next)) {
      // accent: \'e  \"{o}
      let j = i + 2;
      if (s[j] === "{") {
        const e = matchBrace(s, j);
        j = e < 0 ? j + 1 : e;
      } else if (j < s.length) j++;
      atom(s.slice(i, j), "cmd");
      i = j;
      continue;
    }
    const name = commandName(s, i);
    if (!name) {
      // control symbol: \, \; \! \  \- \/ \@ …
      atom(s.slice(i, i + 2), "cmd");
      i += 2;
      continue;
    }
    const afterName = i + 1 + name.length;
    if (name === "textbackslash" || name === "textasciitilde" || name === "textasciicircum") {
      const j = s.startsWith("{}", afterName) ? afterName + 2 : afterName;
      text += name === "textbackslash" ? "\\" : name === "textasciitilde" ? "~" : "^";
      i = j;
      continue;
    }
    if (name === "verb") {
      const delim = s[afterName] === "*" ? s[afterName + 1] : s[afterName];
      const open = s[afterName] === "*" ? afterName + 1 : afterName;
      const close = delim ? s.indexOf(delim, open + 1) : -1;
      const end = close < 0 ? s.length : close + 1;
      atom(s.slice(i, end), "code");
      i = end;
      continue;
    }
    if (name === "begin") {
      const env = findEnvEnd(s, i);
      const end = env ? env.endEnd : s.length;
      atom(s.slice(i, end), "env");
      i = end;
      continue;
    }
    const markName = MARK_CMDS[name];
    if (markName && s[afterName] === "{") {
      const e = matchBrace(s, afterName);
      const type = schema.marks[markName];
      if (e > 0 && !type.isInSet(marks)) {
        flush();
        out.push(...parseInline(s.slice(afterName + 1, e - 1), type.create({ cmd: name }).addToSet(marks)));
        i = e;
        continue;
      }
    }
    let kind = "cmd";
    if (CITE_CMDS.has(name)) kind = "cite";
    else if (REF_CMDS.has(name)) kind = "ref";
    else if (name === "label") kind = "label";
    else if (name === "footnote" || name === "footnotemark" || name === "footnotetext") kind = "footnote";
    else if (name === "url" || name === "href") kind = "url";
    // url/href arguments may contain % # _ literally
    let end: number;
    if (kind === "url") {
      end = afterName;
      for (let n = 0; n < 2 && s[end] === "{"; n++) {
        const e = matchBrace(s, end, false);
        if (e < 0) break;
        end = e;
      }
    } else {
      end = consumeArgs(s, afterName);
    }
    atom(s.slice(i, end), kind);
    i = end;
  }
  flush();
  return Fragment.fromArray(out).content as PMNode[];
}

// ------------------------------------------------------------- blocks

interface Parsed {
  /** Whitespace before the first block. */
  lead: string;
  nodes: PMNode[];
}

/** Partition `text` into blocks (every character is accounted for). */
export function parseBlocks(text: string, ctx: ParseCtx): Parsed {
  const nodes: PMNode[] = [];
  let p = skipLeadingBlank(text, 0);
  const lead = text.slice(0, p);
  while (p < text.length) {
    const { node, end } = parseBlockAt(text, p, ctx);
    // gap: the whitespace run up to (and including) its last newline
    let q = end;
    while (q < text.length && /\s/.test(text[q])) q++;
    let gapEnd: number;
    if (q >= text.length) gapEnd = text.length;
    else {
      const lastNl = text.lastIndexOf("\n", q - 1);
      gapEnd = lastNl >= end ? lastNl + 1 : q;
    }
    nodes.push(withGap(node, text.slice(end, gapEnd)));
    p = gapEnd;
  }
  return { lead, nodes };
}

/** Leading whitespace up to and including its last newline (indentation stays with the block). */
function skipLeadingBlank(text: string, i: number): number {
  let q = i;
  while (q < text.length && /\s/.test(text[q])) q++;
  if (q >= text.length) return text.length;
  const nl = text.lastIndexOf("\n", q - 1);
  return nl >= i ? nl + 1 : i;
}

function parseBlockAt(text: string, p: number, ctx: ParseCtx): { node: PMNode; end: number } {
  const ind = skipSpaces(text, p);
  const ch = text[ind];
  const le = lineEnd(text, p);
  // comment lines
  if (ch === "%") {
    let end = le;
    let q = le + 1;
    while (q < text.length) {
      const qi = skipSpaces(text, q);
      if (text[qi] !== "%") break;
      end = lineEnd(text, q);
      q = end + 1;
    }
    return { node: rawBlock(text.slice(p, end), "comment"), end };
  }
  if (ch === "\\") {
    const name = commandName(text, ind);
    if (name === "begin") return parseEnvBlock(text, p, ind, ctx);
    if (text.startsWith("\\[", ind)) {
      const close = findDisplayClose(text, ind + 2, "\\]");
      if (close >= 0) {
        const tail = lineTail(text, close + 2);
        if (tail !== null) {
          const node = finalize(
            schema.nodes.math_display.create({
              src: text.slice(p, tail),
              env: "\\[",
              head: text.slice(p, ind + 2),
              body: text.slice(ind + 2, close),
              foot: text.slice(close, tail),
            }),
          );
          return { node, end: tail };
        }
      }
    }
    if ((HEADING_CMDS as readonly string[]).includes(name)) {
      const h = parseHeading(text, p, ind, name);
      if (h) return h;
    }
    if (BLOCK_CMDS.has(name) || (HEADING_CMDS as readonly string[]).includes(name)) {
      const argsEnd = consumeArgs(text, ind + 1 + name.length);
      const tail = lineTail(text, argsEnd);
      const end = tail ?? argsEnd;
      return { node: rawBlock(text.slice(p, end), name), end };
    }
  }
  if (text.startsWith("$$", ind)) {
    const close = text.indexOf("$$", ind + 2);
    if (close >= 0) {
      const tail = lineTail(text, close + 2);
      if (tail !== null) {
        const node = finalize(
          schema.nodes.math_display.create({
            src: text.slice(p, tail),
            env: "$$",
            head: text.slice(p, ind + 2),
            body: text.slice(ind + 2, close),
            foot: text.slice(close, tail),
          }),
        );
        return { node, end: tail };
      }
    }
  }
  return parseParagraph(text, p);
}

function findDisplayClose(text: string, from: number, close: string): number {
  let j = from;
  while (j < text.length) {
    const at = text.indexOf(close, j);
    if (at < 0) return -1;
    if (!isEscaped(text, at)) return at;
    j = at + 1;
  }
  return -1;
}

/** Does a line starting at `i` begin a new block (ending the paragraph)? */
function startsBlock(text: string, i: number): boolean {
  const ind = skipSpaces(text, i);
  const c = text[ind];
  if (c === undefined || c === "\n" || c === "\r") return true; // blank line
  if (c === "%") return true;
  if (text.startsWith("$$", ind) || text.startsWith("\\[", ind)) return true;
  if (c === "\\") {
    const name = commandName(text, ind);
    if (name === "begin" || BLOCK_CMDS.has(name) || (HEADING_CMDS as readonly string[]).includes(name)) return true;
  }
  return false;
}

function parseParagraph(text: string, p: number): { node: PMNode; end: number } {
  // first line always belongs to the paragraph; continue while lines are prose
  let end = scanLine(text, p);
  while (end < text.length) {
    const next = end + 1;
    if (next >= text.length || startsBlock(text, next)) break;
    end = scanLine(text, next);
  }
  const src = text.slice(p, end);
  const inline = parseInline(src.replace(/^[ \t]+/, (m) => m)); // keep indentation as text
  const node = finalize(schema.nodes.paragraph.create({ src }, inline));
  return { node, end };
}

/**
 * End of the logical line starting at `i`: a brace group or environment
 * that opens on this line and spans further lines is consumed whole.
 */
function scanLine(text: string, i: number): number {
  let j = i;
  while (j < text.length && text[j] !== "\n") {
    const c = text[j];
    if (c === "%" && !isEscaped(text, j)) return lineEnd(text, j);
    if (c === "\\" && text.startsWith("\\begin", j)) {
      const env = findEnvEnd(text, j);
      if (env) {
        j = env.endEnd;
        continue;
      }
    }
    if (c === "{" && !isEscaped(text, j)) {
      const e = matchBrace(text, j);
      if (e > 0) {
        j = e;
        continue;
      }
    }
    if (c === "$" && !isEscaped(text, j)) {
      const dbl = text[j + 1] === "$";
      const close = dbl ? text.indexOf("$$", j + 2) : findInlineDollar(text, j + 1);
      if (close > 0 && text.slice(j, close).split("\n").every((l) => l.trim() !== "")) {
        j = close + (dbl ? 2 : 1);
        continue;
      }
    }
    j += c === "\\" ? 2 : 1;
  }
  return Math.min(j, text.length);
}

function findInlineDollar(text: string, from: number): number {
  for (let j = from; j < text.length; j++) {
    if (text[j] === "$" && !isEscaped(text, j)) return j;
  }
  return -1;
}

function parseHeading(text: string, p: number, ind: number, cmd: string): { node: PMNode; end: number } | null {
  let j = ind + 1 + cmd.length;
  let star = false;
  if (text[j] === "*") {
    star = true;
    j++;
  }
  if (text[j] !== "{") return null; // \section[short]{…} stays raw
  const close = matchBrace(text, j);
  if (close < 0) return null;
  const body = text.slice(j + 1, close - 1);
  let end = close;
  let label: string | null = null;
  let labelSep = "";
  // \label on the same line …
  const sameLine = /^([ \t]*)\\label\{([^{}]*)\}/.exec(text.slice(end, lineEnd(text, end)));
  if (sameLine) {
    labelSep = sameLine[1];
    label = sameLine[2];
    end += sameLine[0].length;
  } else if (/^[ \t\r]*$/.test(text.slice(end, lineEnd(text, end)))) {
    // … or alone on the next line
    const le = lineEnd(text, end);
    const nextLine = text.slice(le + 1, lineEnd(text, le + 1));
    const m = /^([ \t]*)\\label\{([^{}]*)\}[ \t\r]*$/.exec(nextLine);
    if (le < text.length && m) {
      labelSep = text.slice(end, le + 1) + m[1];
      label = m[2];
      end = le + 1 + m[1].length + m[0].trimEnd().length - m[1].length;
    }
  }
  if (!/^[ \t\r]*$/.test(text.slice(end, lineEnd(text, end)))) return null;
  const src = text.slice(p, end);
  if (ind !== p) return null; // indented headings stay raw (rare)
  const node = finalize(schema.nodes.heading.create({ src, cmd, star, label, labelSep }, parseInline(body)));
  return { node, end };
}

function parseEnvBlock(text: string, p: number, ind: number, ctx: ParseCtx): { node: PMNode; end: number } {
  const env = findEnvEnd(text, ind);
  if (!env) {
    // unbalanced: the rest of the line is raw
    const le = lineEnd(text, ind);
    return { node: rawBlock(text.slice(p, le)), end: le };
  }
  const tail = lineTail(text, env.endEnd);
  const end = tail ?? env.endEnd;
  const src = text.slice(p, end);
  const name = env.name;
  const foot = text.slice(env.endStart, end);
  let node: PMNode | null = null;
  try {
    if (MATH_ENVS.has(name)) {
      const headEnd = consumeArgs(text, env.beginEnd, 2);
      node = finalize(
        schema.nodes.math_display.create({
          src,
          env: name,
          head: text.slice(p, headEnd),
          body: text.slice(headEnd, env.endStart),
          foot,
        }),
      );
    } else if (name === "itemize" || name === "enumerate") {
      node = parseList(text, p, env, name, foot, src, ctx);
    } else if (name === "figure" || name === "figure*") {
      node = parseFigure(text, p, env, foot, src);
    } else if (name === "table" || name === "table*" || name === "tabular") {
      node = parseTable(text, p, env, foot, src);
    } else if (PROSE_ENVS.has(name) || ctx.theorems.has(name)) {
      const headEnd = consumeArgs(text, env.beginEnd, 2);
      const inner = parseBlocks(text.slice(headEnd, env.endStart), ctx);
      const children = inner.nodes.length ? inner.nodes : [emptyParagraph()];
      node = finalize(
        schema.nodes.env_block.create({ src, env: name, head: text.slice(p, headEnd), lead: inner.lead, foot }, children),
      );
    }
  } catch {
    node = null; // content the schema cannot hold → raw
  }
  return { node: node ?? rawBlock(src, name), end };
}

type EnvSpan = { name: string; beginEnd: number; endStart: number; endEnd: number };

function parseList(text: string, p: number, env: EnvSpan, name: string, foot: string, src: string, ctx: ParseCtx): PMNode | null {
  const headEnd = consumeArgs(text, env.beginEnd, 1);
  const inner = text.slice(headEnd, env.endStart);
  const parts = splitTopLevel(inner, (s, i) => (s.startsWith("\\item", i) && !/[A-Za-z@]/.test(s[i + 5] ?? "") ? 5 : 0));
  if (inner.slice(parts[0].start, parts[0].end).trim() !== "") return null; // content before the first \item
  if (parts.length < 2) return null;
  const items: PMNode[] = [];
  let indent = "  ";
  const firstItem = inner.slice(0, parts[0].end);
  const m = /\n([ \t]*)$/.exec(firstItem);
  if (m) indent = m[1];
  for (const part of parts.slice(1)) {
    const body = inner.slice(part.start, part.end);
    if (body.startsWith("[")) return null; // \item[label]
    const parsed = parseBlocks(body.replace(/^[ \t]/, ""), ctx);
    let children = parsed.nodes;
    if (!children.length) children = [emptyParagraph()];
    if (children[0].type !== schema.nodes.paragraph) children = [emptyParagraph(), ...children];
    items.push(schema.nodes.list_item.create(null, children));
  }
  const type = name === "itemize" ? schema.nodes.bullet_list : schema.nodes.ordered_list;
  return finalize(type.create({ src, head: text.slice(p, headEnd), foot, indent }, items));
}

/** Read one `\cmd[..]{..}` token inside a float. */
function floatTokens(inner: string): { cmd: string; opt: string | null; arg: string | null; indent: string }[] | null {
  const out: { cmd: string; opt: string | null; arg: string | null; indent: string }[] = [];
  let i = 0;
  while (true) {
    const ws = skipWs(inner, i);
    if (ws >= inner.length) break;
    const indentMatch = /\n([ \t]*)$/.exec(inner.slice(i, ws));
    const indent = indentMatch ? indentMatch[1] : "";
    if (inner[ws] !== "\\") return null;
    if (inner.startsWith("\\begin", ws)) {
      const env = findEnvEnd(inner, ws);
      if (!env) return null;
      out.push({ cmd: `env:${env.name}`, opt: null, arg: inner.slice(ws, env.endEnd), indent });
      i = env.endEnd;
      continue;
    }
    const name = commandName(inner, ws);
    let j = ws + 1 + name.length;
    let opt: string | null = null;
    let arg: string | null = null;
    if (inner[j] === "[") {
      const e = matchBracket(inner, j);
      if (e < 0) return null;
      opt = inner.slice(j + 1, e - 1);
      j = e;
    }
    if (inner[j] === "{") {
      const e = matchBrace(inner, j);
      if (e < 0) return null;
      arg = inner.slice(j + 1, e - 1);
      j = e;
    }
    out.push({ cmd: name, opt, arg, indent });
    i = j;
  }
  return out;
}

function parseFigure(text: string, p: number, env: EnvSpan, foot: string, src: string): PMNode | null {
  const headEnd = consumeArgs(text, env.beginEnd, 1);
  const tokens = floatTokens(text.slice(headEnd, env.endStart));
  if (!tokens) return null;
  const attrs: Record<string, unknown> = { src, head: text.slice(p, headEnd), foot, center: false, caption: null, label: null };
  const order: string[] = [];
  for (const t of tokens) {
    if (order.includes(t.cmd)) return null;
    if (t.cmd === "centering" && t.arg === null && t.opt === null) attrs.center = true;
    else if (t.cmd === "includegraphics" && t.arg !== null) {
      attrs.gopts = t.opt;
      attrs.path = t.arg.trim();
    } else if (t.cmd === "caption" && t.arg !== null && t.opt === null) attrs.caption = t.arg;
    else if (t.cmd === "label" && t.arg !== null) attrs.label = t.arg;
    else return null;
    order.push(t.cmd);
  }
  if (!order.includes("includegraphics")) return null;
  attrs.order = order;
  attrs.indent = tokens[0]?.indent || "  ";
  return finalize(schema.nodes.figure.create(attrs));
}

/** Column count of a tabular spec (l c r p{} m{} b{} X S …). */
export function specColumns(spec: string): number {
  let n = 0;
  for (let i = 0; i < spec.length; i++) {
    const c = spec[i];
    if (c === "@" || c === "!" || c === ">" || c === "<") {
      const e = matchBrace(spec, i + 1);
      if (e > 0) i = e - 1;
      continue;
    }
    if (c === "*") return -1; // *{3}{c}: not counted
    if (/[lcrXSJL]/.test(c)) n++;
    else if (/[pmb]/.test(c) && spec[i + 1] === "{") {
      n++;
      const e = matchBrace(spec, i + 1);
      if (e > 0) i = e - 1;
    }
  }
  return n;
}

function parseTable(text: string, p: number, env: EnvSpan, foot: string, src: string): PMNode | null {
  let tabular: { body: string; spec: string } | null = null;
  const attrs: Record<string, unknown> = { src, foot, center: false, caption: null, label: null, captionBelow: false };
  if (env.name === "tabular") {
    attrs.head = null;
    attrs.foot = null;
    attrs.indent = "";
    const e = text.slice(env.beginEnd).startsWith("{") ? matchBrace(text, env.beginEnd) : -1;
    if (e < 0 || p !== skipSpaces(text, p) || foot !== "\\end{tabular}") return null;
    tabular = { spec: text.slice(env.beginEnd + 1, e - 1), body: text.slice(e, env.endStart) };
  } else {
    const headEnd = consumeArgs(text, env.beginEnd, 1);
    attrs.head = text.slice(p, headEnd);
    const tokens = floatTokens(text.slice(headEnd, env.endStart));
    if (!tokens) return null;
    let sawTabular = false;
    for (const t of tokens) {
      if (t.cmd === "centering" && t.arg === null) attrs.center = true;
      else if (t.cmd === "caption" && t.arg !== null && t.opt === null && attrs.caption === null) {
        attrs.caption = t.arg;
        attrs.captionBelow = sawTabular;
      } else if (t.cmd === "label" && t.arg !== null && attrs.label === null) attrs.label = t.arg;
      else if (t.cmd === "env:tabular" && !sawTabular && t.arg) {
        sawTabular = true;
        attrs.indent = t.indent || "  ";
        const m = /^\\begin\{tabular\}\{/.exec(t.arg);
        if (!m) return null;
        const e = matchBrace(t.arg, m[0].length - 1);
        const endAt = t.arg.lastIndexOf("\\end{tabular}");
        if (e < 0 || endAt < e) return null;
        tabular = { spec: t.arg.slice(m[0].length, e - 1), body: t.arg.slice(e, endAt) };
      } else return null;
    }
    if (!tabular) return null;
  }
  if (/\\(multicolumn|multirow|cline|cmidrule|addlinespace|rowcolor|cellcolor)\b/.test(tabular.body)) return null;
  const segs = splitTopLevel(tabular.body, (s, i) => (s.startsWith("\\\\", i) ? 2 : 0));
  const rows: string[][] = [];
  const ruleBefore: string[] = [];
  let style: string | null = null;
  for (let k = 0; k < segs.length; k++) {
    let seg = tabular.body.slice(segs[k].start, segs[k].end);
    if (/^\s*\[/.test(seg)) return null; // \\[2pt]
    let rule = "";
    for (;;) {
      const m = /^\s*\\(toprule|midrule|bottomrule|hline)\b/.exec(seg);
      if (!m) break;
      rule = m[1];
      style = m[1] === "hline" ? style ?? "hline" : "booktabs";
      seg = seg.slice(m[0].length);
    }
    if (/%/.test(seg.replace(/\\%/g, ""))) return null; // comments inside rows
    if (seg.trim() === "") {
      if (k === segs.length - 1) break;
      return null; // empty row
    }
    ruleBefore.push(rule);
    rows.push(splitTopLevel(seg, (s, i) => (s[i] === "&" && !isEscaped(s, i) ? 1 : 0)).map((c) => seg.slice(c.start, c.end).trim()));
  }
  if (!rows.length) return null;
  const cols = Math.max(...rows.map((r) => r.length));
  const pmRows = rows.map((r) =>
    schema.nodes.table_row.create(
      null,
      Array.from({ length: cols }, (_, ci) => schema.nodes.table_cell.create(null, parseInline(r[ci] ?? ""))),
    ),
  );
  attrs.spec = tabular.spec;
  attrs.rules = style ?? "none";
  attrs.header = rows.length > 1 && ruleBefore[1] !== "";
  return finalize(schema.nodes.table.create(attrs, pmRows));
}

// ------------------------------------------------------------- document

/** Find `\begin{document}` / `\end{document}` outside comments. */
function findDocMarker(src: string, marker: string, last: boolean): number {
  let at = last ? src.lastIndexOf(marker) : src.indexOf(marker);
  while (at >= 0) {
    const ls = src.lastIndexOf("\n", at - 1) + 1;
    if (commentStart(src.slice(ls, at)) < 0) return at;
    at = last ? src.lastIndexOf(marker, at - 1) : src.indexOf(marker, at + 1);
  }
  return -1;
}

export function theoremsOf(pre: string): Set<string> {
  const out = new Set<string>();
  for (const m of pre.matchAll(/\\(?:newtheorem|declaretheorem|newmdtheoremenv)\*?\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}/g)) out.add(m[1]);
  return out;
}

/** Parse a whole .tex file. */
export function parseDocument(text: string, extraTheorems?: Set<string>): PMNode {
  // consistent Windows line endings: parse with "\n", convert back on output
  const lf = text.includes("\r\n") ? text.replace(/\r\n/g, "\n") : text;
  const eol = lf !== text && !lf.includes("\r") ? "\r\n" : "\n";
  const src = eol === "\r\n" ? lf : text;
  const begin = findDocMarker(src, "\\begin{document}", false);
  let pre = "";
  let body = src;
  let post = "";
  if (begin >= 0) {
    const bodyStart = begin + "\\begin{document}".length;
    const end = findDocMarker(src, "\\end{document}", true);
    pre = src.slice(0, bodyStart);
    if (end >= bodyStart) {
      body = src.slice(bodyStart, end);
      post = src.slice(end);
    } else body = src.slice(bodyStart);
  }
  const theorems = theoremsOf(pre);
  extraTheorems?.forEach((t) => theorems.add(t));
  const parsed = parseBlocks(body, { theorems });
  pre += parsed.lead;
  const nodes = parsed.nodes.length ? parsed.nodes : [emptyParagraph()];
  return schema.nodes.doc.create({ pre, post, eol }, nodes);
}

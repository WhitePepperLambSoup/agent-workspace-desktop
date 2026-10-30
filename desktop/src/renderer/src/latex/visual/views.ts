// Node views of the visual editor: rendered math, figures, tables with
// captions, citation / reference chips and editable raw-LaTeX cards.
// From TeXButler 1.0.0; here formulas go through math.ts (the window's style
// policy) and figures are read through the app (`ViewContext.image`).
import * as pdfjs from "pdfjs-dist";
import type { Node as PMNode } from "prosemirror-model";
import { NodeSelection } from "prosemirror-state";
import type { Decoration, EditorView, NodeView } from "prosemirror-view";
import { ensurePdfWorker } from "../PdfView";
import { renderMath, setHtml } from "./math";
import { parseInline } from "./parse";
import { openPopover } from "./popover";

export { renderMath };

/** A figure's picture: a data URL, or the bytes of a PDF. */
export type FigureSource = { url: string } | { pdf: Uint8Array };

export interface ViewContext {
  /** The picture an \includegraphics path names (the document's folder, \graphicspath, usual extensions). */
  image: (path: string) => Promise<FigureSource | null>;
  /** The document preamble (for \maketitle). */
  pre: () => string;
  t: (key: string, vars?: Record<string, string | number>) => string;
  openFile: (path: string) => void;
}

/** Element → "open its editor" (used right after inserting a node). */
const editors = new WeakMap<HTMLElement, () => void>();

export function editNodeAt(view: EditorView, pos: number): void {
  const dom = view.nodeDOM(pos);
  if (dom instanceof HTMLElement) editors.get(dom)?.();
}

// ------------------------------------------------------------- rendering

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/**
 * The number the numbering plugin gave a node. Its data-num attribute lands
 * on the node's outer element, which a caption's ::before cannot read
 * (attr() reads the element itself), so captions get it from here.
 */
function numberOf(decorations: readonly Decoration[] | undefined): string {
  for (const d of decorations ?? []) {
    const num = (d.spec as { num?: unknown } | undefined)?.num;
    if (typeof num === "string") return num;
  }
  return "";
}

const numAttr = (num: string) => (num ? ` data-num="${escapeHtml(num)}"` : "");

const SYMBOLS: Record<string, string> = {
  "\\LaTeX": "LaTeX",
  "\\LaTeXe": "LaTeX2ε",
  "\\TeX": "TeX",
  "\\ldots": "…",
  "\\dots": "…",
  "\\textellipsis": "…",
  "\\S": "§",
  "\\P": "¶",
  "\\copyright": "©",
  "\\textregistered": "®",
  "\\texttrademark": "™",
  "\\textdegree": "°",
  "\\quad": " ",
  "\\qquad": "  ",
  "\\,": " ",
  "\\;": " ",
  "\\ ": " ",
  "\\-": "",
  "\\/": "",
  "\\@": "",
  "\\textendash": "–",
  "\\textemdash": "—",
};
const ACCENTS: Record<string, string> = { "'": "́", "`": "̀", "^": "̂", '"': "̈", "~": "̃", "=": "̄", ".": "̇", c: "̧", v: "̌", u: "̆", H: "̋" };

/** Last brace group of a command (the key list of \cite[p]{a,b}). */
function lastArg(src: string): string {
  const m = /\{([^{}]*)\}\s*$/.exec(src);
  return m ? m[1] : "";
}

/** Presentation of an inline `latex` atom. */
export function atomPresentation(src: string, kind: string, t: ViewContext["t"]): { html: string; cls: string; title: string } {
  const sym = SYMBOLS[src.replace(/\{\}$/, "")];
  if (sym !== undefined) return { html: escapeHtml(sym), cls: "vis-sym", title: src };
  const accent = /^\\([`'^"~=.]|[cvuH](?=[{ ]))\s*\{?([A-Za-z])\}?$/.exec(src);
  if (accent && ACCENTS[accent[1]]) return { html: (accent[2] + ACCENTS[accent[1]]).normalize("NFC"), cls: "vis-sym", title: src };
  if (src === "\\today") return { html: escapeHtml(new Date().toLocaleDateString()), cls: "vis-sym", title: src };
  switch (kind) {
    case "cite":
      return { html: `[${escapeHtml(lastArg(src).split(",").map((k) => k.trim()).join(", "))}]`, cls: "vis-cite", title: src };
    case "ref": {
      const key = lastArg(src);
      const eq = src.startsWith("\\eqref");
      return { html: escapeHtml(eq ? `(${key})` : key), cls: "vis-ref", title: src };
    }
    case "label":
      return { html: escapeHtml(lastArg(src)), cls: "vis-label", title: src };
    case "footnote":
      return { html: "†", cls: "vis-footnote", title: `${t("vis.footnote")}: ${lastArg(src) || src}` };
    case "url": {
      const groups = [...src.matchAll(/\{([^{}]*)\}/g)].map((m) => m[1]);
      const text = src.startsWith("\\href") ? groups[1] ?? groups[0] ?? src : groups[0] ?? src;
      return { html: escapeHtml(text), cls: "vis-url", title: src };
    }
    case "comment":
      return { html: escapeHtml(src.trim()), cls: "vis-comment", title: t("vis.comment") };
    case "math": {
      const m = /^(\$\$|\\\[)([\s\S]*?)(\$\$|\\\])$/.exec(src);
      return { html: m ? renderMath(m[2], true) : escapeHtml(src), cls: "vis-math-inline-display", title: src };
    }
    default: {
      // \noindent, \vspace{…}, \small … : quiet markers; others as code
      if (/^\\(noindent|indent|par|centering|small|footnotesize|large|Large|normalsize|bfseries|itshape|rmfamily|sffamily|ttfamily)$/.test(src)) {
        return { html: escapeHtml(src), cls: "vis-quiet", title: src };
      }
      return { html: escapeHtml(src.length > 60 ? `${src.slice(0, 57)}…` : src), cls: "vis-code", title: src };
    }
  }
}

/** Inline LaTeX (captions) → HTML, read-only. */
export function renderInlineHtml(latex: string, t: ViewContext["t"]): string {
  let html = "";
  for (const node of parseInline(latex)) {
    let piece: string;
    if (node.isText) piece = escapeHtml(node.text ?? "");
    else if (node.type.name === "math_inline") piece = renderMath(node.attrs.body, false);
    else if (node.type.name === "hard_break") piece = "<br>";
    else {
      const p = atomPresentation(node.attrs.src, node.attrs.kind, t);
      piece = `<span class="${p.cls}">${p.html}</span>`;
    }
    for (const m of node.marks) {
      const tag = { bold: "strong", italic: "em", underline: "u", code: "code" }[m.type.name] ?? "span";
      piece = `<${tag}>${piece}</${tag}>`;
    }
    html += piece;
  }
  return html;
}

/** First balanced argument of `\cmd{…}` in the preamble (title, author, date). */
export function preambleArg(pre: string, cmd: string): string | null {
  const at = pre.search(new RegExp(`\\\\${cmd}\\s*(\\[[^\\]]*\\])?\\s*\\{`));
  if (at < 0) return null;
  const open = pre.indexOf("{", at);
  let depth = 0;
  for (let i = open; i < pre.length; i++) {
    if (pre[i] === "\\") {
      i++;
      continue;
    }
    if (pre[i] === "{") depth++;
    else if (pre[i] === "}" && --depth === 0) return pre.slice(open + 1, i);
  }
  return null;
}

// ------------------------------------------------------------- base

abstract class AtomView implements NodeView {
  dom: HTMLElement;
  /** The node's number (figures), from the numbering plugin's decoration. */
  protected num: string;
  constructor(
    protected node: PMNode,
    protected view: EditorView,
    protected getPos: () => number | undefined,
    protected ctx: ViewContext,
    tag: string,
    decorations?: readonly Decoration[],
  ) {
    this.num = numberOf(decorations);
    this.dom = document.createElement(tag);
    this.dom.contentEditable = "false";
    editors.set(this.dom, () => this.edit());
    this.dom.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      this.select();
      this.edit();
    });
    this.render();
  }
  abstract render(): void;
  abstract edit(): void;
  select() {
    const pos = this.getPos();
    if (pos === undefined) return;
    this.view.dispatch(this.view.state.tr.setSelection(NodeSelection.create(this.view.state.doc, pos)));
  }
  setAttrs(attrs: Record<string, unknown>) {
    const pos = this.getPos();
    if (pos === undefined) return;
    this.view.dispatch(this.view.state.tr.setNodeMarkup(pos, null, { ...this.node.attrs, ...attrs }));
    this.view.focus();
  }
  remove() {
    const pos = this.getPos();
    if (pos === undefined) return;
    this.view.dispatch(this.view.state.tr.delete(pos, pos + this.node.nodeSize));
    this.view.focus();
  }
  replaceWith(nodes: PMNode[]) {
    const pos = this.getPos();
    if (pos === undefined) return;
    this.view.dispatch(this.view.state.tr.replaceWith(pos, pos + this.node.nodeSize, nodes));
    this.view.focus();
  }
  update(node: PMNode, decorations?: readonly Decoration[]) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.num = numberOf(decorations);
    this.render();
    return true;
  }
  selectNode() {
    this.dom.classList.add("vis-selected");
  }
  deselectNode() {
    this.dom.classList.remove("vis-selected");
  }
  stopEvent() {
    return true;
  }
  ignoreMutation() {
    return true;
  }
}

// ------------------------------------------------------------- inline atoms

class MathInlineView extends AtomView {
  constructor(node: PMNode, view: EditorView, getPos: () => number | undefined, ctx: ViewContext) {
    super(node, view, getPos, ctx, "span");
    this.dom.className = "vis-math";
  }
  render() {
    setHtml(this.dom, renderMath(this.node.attrs.body, false));
    this.dom.title = this.node.attrs.body;
  }
  edit() {
    const t = this.ctx.t;
    openPopover({
      anchor: this.dom,
      title: t("vis.editMath"),
      fields: [{ key: "body", value: this.node.attrs.body, mono: true, placeholder: "x^2 + y^2" }],
      preview: (v) => renderMath(v.body, false),
      saveLabel: t("common.done"),
      cancelLabel: t("common.cancel"),
      actions: [{ label: t("common.delete"), danger: true, run: () => this.remove() }],
      onSave: (v) => (v.body.trim() ? this.setAttrs({ body: v.body }) : this.remove()),
    });
  }
}

class LatexInlineView extends AtomView {
  constructor(node: PMNode, view: EditorView, getPos: () => number | undefined, ctx: ViewContext) {
    super(node, view, getPos, ctx, "span");
  }
  render() {
    const p = atomPresentation(this.node.attrs.src, this.node.attrs.kind, this.ctx.t);
    this.dom.className = `vis-atom ${p.cls}`;
    setHtml(this.dom, p.html);
    this.dom.title = p.title;
  }
  edit() {
    const t = this.ctx.t;
    const src: string = this.node.attrs.src;
    openPopover({
      anchor: this.dom,
      title: t(`vis.kind.${this.node.attrs.kind}`) === `vis.kind.${this.node.attrs.kind}` ? t("vis.editLatex") : t(`vis.kind.${this.node.attrs.kind}`),
      fields: [{ key: "src", value: src, mono: true, multiline: src.includes("\n") || src.length > 60 }],
      preview: (v) => renderInlineHtml(v.src, t),
      saveLabel: t("common.done"),
      cancelLabel: t("common.cancel"),
      actions: [{ label: t("common.delete"), danger: true, run: () => this.remove() }],
      onSave: (v) => {
        if (v.src === src) return;
        if (!v.src.trim()) return this.remove();
        this.replaceWith(parseInline(v.src, this.node.marks));
      },
    });
  }
}

// ------------------------------------------------------------- blocks

class MathDisplayView extends AtomView {
  constructor(node: PMNode, view: EditorView, getPos: () => number | undefined, ctx: ViewContext) {
    super(node, view, getPos, ctx, "div");
  }
  render() {
    const a = this.node.attrs;
    const numbered = !String(a.env).endsWith("*") && !["\\[", "$$", "displaymath", "math", "split"].includes(a.env);
    this.dom.className = `vis-math-display${numbered ? " numbered" : ""}`;
    const labels = [...String(a.body).matchAll(/\\label\{([^}]*)\}/g)].map((m) => m[1]);
    setHtml(
      this.dom,
      `<div class="vis-math-body">${renderMath(a.body, true, a.env)}</div>` +
        (labels.length ? `<span class="vis-label">${labels.map(escapeHtml).join(", ")}</span>` : ""),
    );
  }
  edit() {
    const t = this.ctx.t;
    const a = this.node.attrs;
    openPopover({
      anchor: this.dom,
      title: `${t("vis.editMath")} · ${a.env}`,
      fields: [{ key: "body", value: a.body, mono: true, multiline: true }],
      preview: (v) => renderMath(v.body, true, a.env),
      saveLabel: t("common.done"),
      cancelLabel: t("common.cancel"),
      actions: [{ label: t("common.delete"), danger: true, run: () => this.remove() }],
      onSave: (v) => this.setAttrs({ body: v.body }),
    });
  }
}

const RAW_FRIENDLY = new Set(["maketitle", "tableofcontents", "listoffigures", "listoftables", "newpage", "clearpage", "cleardoublepage", "pagebreak", "bibliography", "printbibliography", "appendix", "input", "include"]);

class RawView extends AtomView {
  constructor(node: PMNode, view: EditorView, getPos: () => number | undefined, ctx: ViewContext) {
    super(node, view, getPos, ctx, "div");
  }
  render() {
    const latex: string = this.node.attrs.latex;
    const kind: string = this.node.attrs.kind;
    const t = this.ctx.t;
    const cmd = /^\s*\\([A-Za-z]+)/.exec(latex)?.[1] ?? "";
    this.dom.className = `vis-raw vis-raw-${kind}`;
    this.dom.title = t("vis.rawTitle");
    if (kind === "comment") {
      this.dom.innerHTML = `<pre class="vis-raw-comment">${escapeHtml(latex)}</pre>`;
      return;
    }
    if (RAW_FRIENDLY.has(cmd) && latex.trim().split("\n").length === 1) {
      if (cmd === "maketitle") {
        const pre: string = this.view.state?.doc.attrs.pre ?? this.ctx.pre();
        const title = preambleArg(pre, "title");
        const author = preambleArg(pre, "author");
        const date = preambleArg(pre, "date");
        this.dom.className += " vis-raw-maketitle";
        setHtml(
          this.dom,
          `<div class="vis-title">${title ? renderInlineHtml(title, t) : `<span class="vis-quiet">${escapeHtml(t("vis.noTitle"))}</span>`}</div>` +
            (author ? `<div class="vis-author">${renderInlineHtml(author, t)}</div>` : "") +
            `<div class="vis-date">${date ? renderInlineHtml(date, t) : escapeHtml(new Date().toLocaleDateString())}</div>`,
        );
        return;
      }
      if (cmd === "newpage" || cmd === "clearpage" || cmd === "cleardoublepage" || cmd === "pagebreak") {
        this.dom.className += " vis-raw-pagebreak";
        this.dom.innerHTML = `<span>${escapeHtml(t("vis.pageBreak"))}</span>`;
        return;
      }
      if (cmd === "input" || cmd === "include") {
        const file = /\{([^}]*)\}/.exec(latex)?.[1] ?? "";
        const target = /\.tex$/i.test(file) ? file : `${file}.tex`;
        this.dom.className += " vis-raw-input";
        this.dom.innerHTML = `<span class="vis-raw-label">${escapeHtml(t("vis.includes"))}</span> <a class="vis-input-link" href="#">${escapeHtml(target)}</a>`;
        this.dom.querySelector("a")?.addEventListener("mousedown", (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.ctx.openFile(target);
        });
        return;
      }
      const name = t(`vis.cmd.${cmd}`);
      this.dom.className += " vis-raw-marker";
      this.dom.innerHTML = `<span class="vis-raw-label">${escapeHtml(name === `vis.cmd.${cmd}` ? `\\${cmd}` : name)}</span>`;
      return;
    }
    const head = /\\begin\{([^}]+)\}/.exec(latex)?.[1];
    const label = head ? `\\begin{${head}}` : cmd ? `\\${cmd}` : t("vis.latex");
    this.dom.innerHTML = `<div class="vis-raw-label">${escapeHtml(label)}</div><pre class="vis-raw-code">${escapeHtml(latex)}</pre>`;
  }
  edit() {
    const t = this.ctx.t;
    openPopover({
      anchor: this.dom,
      title: t("vis.editLatex"),
      fields: [{ key: "latex", value: this.node.attrs.latex, mono: true, multiline: true }],
      saveLabel: t("common.done"),
      cancelLabel: t("common.cancel"),
      actions: [{ label: t("common.delete"), danger: true, run: () => this.remove() }],
      onSave: (v) => (v.latex.trim() ? this.setAttrs({ latex: v.latex }) : this.remove()),
    });
  }
}

async function renderPdfThumb(data: Uint8Array, holder: HTMLElement): Promise<boolean> {
  try {
    ensurePdfWorker();
    const task = pdfjs.getDocument({ data, useWorkerFetch: false, disableAutoFetch: true });
    const doc = await task.promise;
    const page = await doc.getPage(1);
    const vp = page.getViewport({ scale: 1.5 });
    const canvas = document.createElement("canvas");
    canvas.width = vp.width;
    canvas.height = vp.height;
    canvas.className = "vis-fig-canvas";
    const ctx = canvas.getContext("2d");
    if (!ctx) return false;
    await page.render({ canvas, canvasContext: ctx, viewport: vp }).promise;
    holder.replaceChildren(canvas);
    void task.destroy();
    return true;
  } catch {
    return false;
  }
}

/** `width=0.5\linewidth` → CSS width. */
function cssWidth(gopts: string | null): string {
  const m = /width\s*=\s*([\d.]+)\s*\\(linewidth|textwidth|columnwidth)/.exec(gopts ?? "");
  if (m) return `${Math.min(100, Math.round(Number(m[1]) * 100))}%`;
  const s = /scale\s*=\s*([\d.]+)/.exec(gopts ?? "");
  if (s) return `${Math.min(100, Math.round(Number(s[1]) * 60))}%`;
  return "70%";
}

class FigureView extends AtomView {
  private shownPath = "";
  constructor(node: PMNode, view: EditorView, getPos: () => number | undefined, ctx: ViewContext, decorations?: readonly Decoration[]) {
    super(node, view, getPos, ctx, "figure", decorations);
    this.dom.className = "vis-figure";
  }
  render() {
    const a = this.node.attrs;
    const t = this.ctx.t;
    if (this.shownPath !== `${a.path}|${a.gopts}` || !this.dom.querySelector(".vis-fig-img")) {
      this.shownPath = `${a.path}|${a.gopts}`;
      const holder = document.createElement("div");
      holder.className = "vis-fig-img";
      holder.style.width = cssWidth(a.gopts);
      const missing = () => {
        holder.innerHTML = `<div class="vis-fig-missing">${escapeHtml(t("vis.imageMissing", { path: a.path }))}</div>`;
      };
      void this.ctx.image(a.path).then(
        async (found) => {
          if (!found) return missing();
          if ("pdf" in found) {
            if (!(await renderPdfThumb(found.pdf, holder))) missing();
            return;
          }
          const img = document.createElement("img");
          img.alt = a.path;
          img.onerror = missing;
          img.src = found.url;
          holder.replaceChildren(img);
        },
        missing,
      );
      this.dom.querySelector(".vis-fig-img")?.remove();
      this.dom.prepend(holder);
    }
    let cap = this.dom.querySelector("figcaption");
    if (!cap) {
      cap = document.createElement("figcaption");
      this.dom.appendChild(cap);
    }
    setHtml(
      cap,
      `<span class="vis-fig-num"${numAttr(this.num)}></span>` +
        (a.caption ? renderInlineHtml(a.caption, t) : `<span class="vis-quiet">${escapeHtml(t("vis.addCaption"))}</span>`) +
        (a.label ? ` <span class="vis-label">${escapeHtml(a.label)}</span>` : ""),
    );
  }
  edit() {
    const t = this.ctx.t;
    const a = this.node.attrs;
    openPopover({
      anchor: this.dom,
      title: t("vis.editFigure"),
      fields: [
        { key: "caption", label: t("vis.caption"), value: a.caption ?? "" },
        { key: "label", label: t("vis.label"), value: a.label ?? "", mono: true },
        { key: "gopts", label: t("vis.imageOptions"), value: a.gopts ?? "", mono: true, placeholder: "width=0.8\\linewidth" },
        { key: "path", label: t("vis.imagePath"), value: a.path, mono: true },
      ],
      saveLabel: t("common.done"),
      cancelLabel: t("common.cancel"),
      actions: [{ label: t("common.delete"), danger: true, run: () => this.remove() }],
      onSave: (v) =>
        this.setAttrs({
          caption: v.caption.trim() ? v.caption : a.caption === null ? null : "",
          label: v.label.trim() || null,
          gopts: v.gopts.trim() || null,
          path: v.path.trim() || a.path,
        }),
    });
  }
}

class TableView implements NodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement;
  private cap: HTMLElement;
  private num: string;
  constructor(
    private node: PMNode,
    private view: EditorView,
    private getPos: () => number | undefined,
    private ctx: ViewContext,
    decorations?: readonly Decoration[],
  ) {
    this.num = numberOf(decorations);
    this.dom = document.createElement("div");
    this.dom.className = "vis-table";
    this.cap = document.createElement("div");
    this.cap.className = "vis-table-caption";
    this.cap.contentEditable = "false";
    this.cap.addEventListener("mousedown", (e) => {
      e.preventDefault();
      this.edit();
    });
    const table = document.createElement("table");
    this.contentDOM = document.createElement("tbody");
    table.appendChild(this.contentDOM);
    this.dom.append(this.cap, table);
    editors.set(this.dom, () => this.edit());
    this.render();
  }
  render() {
    const a = this.node.attrs;
    const t = this.ctx.t;
    this.dom.classList.toggle("caption-below", Boolean(a.captionBelow));
    this.dom.classList.toggle("rules-booktabs", a.rules === "booktabs");
    this.dom.classList.toggle("rules-hline", a.rules === "hline");
    this.dom.classList.toggle("has-header", Boolean(a.header));
    this.dom.classList.toggle("is-float", a.head != null);
    this.cap.style.display = a.head == null ? "none" : "";
    if (this.cap.parentElement) {
      if (a.captionBelow) this.dom.appendChild(this.cap);
      else this.dom.prepend(this.cap);
    }
    setHtml(
      this.cap,
      `<span class="vis-tab-num"${numAttr(this.num)}></span>` +
        (a.caption ? renderInlineHtml(a.caption, t) : `<span class="vis-quiet">${escapeHtml(t("vis.addCaption"))}</span>`) +
        (a.label ? ` <span class="vis-label">${escapeHtml(a.label)}</span>` : ""),
    );
  }
  edit() {
    const t = this.ctx.t;
    const a = this.node.attrs;
    if (a.head == null) return;
    openPopover({
      anchor: this.cap,
      title: t("vis.editTable"),
      fields: [
        { key: "caption", label: t("vis.caption"), value: a.caption ?? "" },
        { key: "label", label: t("vis.label"), value: a.label ?? "", mono: true },
        { key: "spec", label: t("vis.columnSpec"), value: a.spec, mono: true },
      ],
      saveLabel: t("common.done"),
      cancelLabel: t("common.cancel"),
      onSave: (v) => {
        const pos = this.getPos();
        if (pos === undefined) return;
        this.view.dispatch(
          this.view.state.tr.setNodeMarkup(pos, null, {
            ...a,
            caption: v.caption.trim() ? v.caption : a.caption === null ? null : "",
            label: v.label.trim() || null,
            spec: v.spec.trim() || a.spec,
          }),
        );
      },
    });
  }
  update(node: PMNode, decorations?: readonly Decoration[]) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.num = numberOf(decorations);
    this.render();
    return true;
  }
  ignoreMutation(m: { target: Node; type: string }) {
    return !this.contentDOM.contains(m.target) || m.type === "attributes";
  }
}

class HeadingView implements NodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement;
  private chip: HTMLElement;
  constructor(
    private node: PMNode,
    private view: EditorView,
    private getPos: () => number | undefined,
    private ctx: ViewContext,
  ) {
    this.dom = document.createElement(`h${Math.min(6, Math.max(1, ["part", "chapter", "section", "subsection", "subsubsection", "paragraph", "subparagraph"].indexOf(node.attrs.cmd) + 1))}`);
    this.contentDOM = document.createElement("span");
    this.contentDOM.className = "vis-h-text";
    this.chip = document.createElement("span");
    this.chip.contentEditable = "false";
    this.chip.addEventListener("mousedown", (e) => {
      e.preventDefault();
      this.editLabel();
    });
    this.dom.append(this.contentDOM, this.chip);
    this.render();
  }
  render() {
    const a = this.node.attrs;
    this.dom.className = `vis-h vis-${a.cmd}${a.star ? " vis-star" : ""}`;
    this.chip.className = `vis-label vis-h-label${a.label ? "" : " empty"}`;
    this.chip.textContent = a.label ?? "#";
    this.chip.title = this.ctx.t("vis.label");
  }
  editLabel() {
    const t = this.ctx.t;
    openPopover({
      anchor: this.chip,
      title: t("vis.label"),
      fields: [{ key: "label", value: this.node.attrs.label ?? "", mono: true, placeholder: "sec:intro" }],
      saveLabel: t("common.done"),
      cancelLabel: t("common.cancel"),
      onSave: (v) => {
        const pos = this.getPos();
        if (pos === undefined) return;
        this.view.dispatch(this.view.state.tr.setNodeMarkup(pos, null, { ...this.node.attrs, label: v.label.trim() || null }));
      },
    });
  }
  update(node: PMNode) {
    if (node.type !== this.node.type || node.attrs.cmd !== this.node.attrs.cmd) return false;
    this.node = node;
    this.render();
    return true;
  }
  ignoreMutation(m: { target: Node }) {
    return this.chip.contains(m.target);
  }
}

class EnvView implements NodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement;
  constructor(node: PMNode, ctx: ViewContext) {
    this.dom = document.createElement("div");
    this.dom.className = `vis-env vis-env-${node.attrs.env}`;
    const tab = document.createElement("div");
    tab.className = "vis-env-tab";
    tab.contentEditable = "false";
    const name = ctx.t(`vis.env.${node.attrs.env}`);
    tab.textContent = name === `vis.env.${node.attrs.env}` ? node.attrs.env : name;
    this.contentDOM = document.createElement("div");
    this.contentDOM.className = "vis-env-body";
    this.dom.append(tab, this.contentDOM);
  }
  ignoreMutation(m: { target: Node }) {
    return !this.contentDOM.contains(m.target);
  }
}

export function createNodeViews(ctx: ViewContext) {
  return {
    math_inline: (n: PMNode, v: EditorView, g: () => number | undefined) => new MathInlineView(n, v, g, ctx),
    latex: (n: PMNode, v: EditorView, g: () => number | undefined) => new LatexInlineView(n, v, g, ctx),
    math_display: (n: PMNode, v: EditorView, g: () => number | undefined) => new MathDisplayView(n, v, g, ctx),
    raw: (n: PMNode, v: EditorView, g: () => number | undefined) => new RawView(n, v, g, ctx),
    figure: (n: PMNode, v: EditorView, g: () => number | undefined, d: readonly Decoration[]) => new FigureView(n, v, g, ctx, d),
    table: (n: PMNode, v: EditorView, g: () => number | undefined, d: readonly Decoration[]) => new TableView(n, v, g, ctx, d),
    heading: (n: PMNode, v: EditorView, g: () => number | undefined) => new HeadingView(n, v, g, ctx),
    env_block: (n: PMNode) => new EnvView(n, ctx),
  };
}

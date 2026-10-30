// Formulas of the visual editor. The window's style policy refuses style
// attributes written as HTML (KaTeX's renderToString output loses its
// layout), so the HTML carries placeholders that KaTeX renders as DOM
// (its styles are set through the CSSOM, which the policy allows).
import katex from "katex";
import "katex/dist/katex.min.css";

const escapeAttr = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const KATEX_ENV: Record<string, string> = {
  align: "aligned",
  "align*": "aligned",
  flalign: "aligned",
  "flalign*": "aligned",
  alignat: "alignedat",
  "alignat*": "alignedat",
  eqnarray: "aligned",
  "eqnarray*": "aligned",
  gather: "gathered",
  "gather*": "gathered",
  multline: "gathered",
  "multline*": "gathered",
  split: "split",
};

/** LaTeX math → a placeholder for `hydrateMath` (labels / tags stripped; aligned envs mapped). */
export function renderMath(body: string, display: boolean, env = ""): string {
  let src = body.replace(/\\(label|tag)\*?\{[^}]*\}/g, "").replace(/\\(nonumber|notag)\b/g, "");
  const k = KATEX_ENV[env];
  if (k === "alignedat") {
    const m = /^\s*\{(\d+)\}/.exec(src);
    src = `\\begin{alignedat}{${m ? m[1] : "1"}}${m ? src.slice(m[0].length) : src}\\end{alignedat}`;
  } else if (k) src = `\\begin{${k}}${src}\\end{${k}}`;
  return `<span class="vis-tex" data-tex="${escapeAttr(src.trim() || "\\square")}"${display ? ' data-display="1"' : ""}></span>`;
}

/** Render the formula placeholders under `root`. */
export function hydrateMath(root: ParentNode): void {
  for (const el of Array.from(root.querySelectorAll<HTMLElement>("span.vis-tex[data-tex]"))) {
    const tex = el.dataset.tex ?? "";
    try {
      katex.render(tex, el, { displayMode: el.dataset.display === "1", throwOnError: false, strict: "ignore", trust: false });
    } catch {
      el.textContent = tex;
    }
  }
}

/** Set an element's HTML (from the views' presenters) and render its formulas. */
export function setHtml(el: HTMLElement, html: string): void {
  el.innerHTML = html;
  hydrateMath(el);
}

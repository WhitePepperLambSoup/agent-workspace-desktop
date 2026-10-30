// The editor's LaTeX support: highlighting, completion of commands, environments, labels and
// bibliography keys, the outline, and the snippets and symbols of the insert menus. The command
// lists, snippets and symbol set follow TeXButler's editor (MIT, WhitePepperLambSoup).
import {
  autocompletion,
  snippet,
  snippetCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete'
import { StreamLanguage } from '@codemirror/language'
import { stex } from '@codemirror/legacy-modes/mode/stex'
import type { Extension } from '@codemirror/state'

export const latexLanguage = StreamLanguage.define(stex)

export interface LatexLabel { key: string; file: string; line: number }
export interface LatexCitation { key: string; file: string; line: number; title: string; author: string; year: string }

export interface CompletionData {
  labels: readonly LatexLabel[]
  citations: readonly LatexCitation[]
}

// ${n} are the places Tab moves through.
const COMMANDS: ReadonlyArray<readonly [string, string?]> = [
  ['\\section{${title}}'], ['\\subsection{${title}}'], ['\\subsubsection{${title}}'], ['\\chapter{${title}}'], ['\\paragraph{${title}}'],
  ['\\textbf{${text}}'], ['\\textit{${text}}'], ['\\emph{${text}}'], ['\\underline{${text}}'], ['\\texttt{${text}}'], ['\\textsc{${text}}'],
  ['\\label{${key}}'], ['\\ref{${key}}'], ['\\eqref{${key}}'], ['\\pageref{${key}}'], ['\\cite{${key}}'], ['\\citep{${key}}'], ['\\citet{${key}}'],
  ['\\footnote{${text}}'], ['\\href{${url}}{${text}}'], ['\\url{${url}}'],
  ['\\includegraphics[width=${0.8}\\linewidth]{${file}}'], ['\\caption{${text}}'], ['\\centering'], ['\\item'],
  ['\\documentclass{${article}}'], ['\\usepackage{${package}}'], ['\\title{${title}}'], ['\\author{${name}}'], ['\\date{${\\today}}'],
  ['\\maketitle'], ['\\tableofcontents'], ['\\newpage'], ['\\clearpage'], ['\\bibliography{${refs}}'], ['\\bibliographystyle{${style}}'],
  ['\\input{${file}}'], ['\\include{${file}}'], ['\\newcommand{\\${name}}{${definition}}'],
  ['\\frac{${a}}{${b}}'], ['\\sqrt{${x}}'], ['\\sum_{${i=1}}^{${n}}'], ['\\prod_{${i=1}}^{${n}}'], ['\\int_{${a}}^{${b}}'], ['\\lim_{${x \\to 0}}'],
  ['\\left( ${x} \\right)'], ['\\mathbf{${x}}'], ['\\mathrm{${x}}'], ['\\mathbb{${R}}'], ['\\mathcal{${L}}'], ['\\hat{${x}}'], ['\\bar{${x}}'], ['\\vec{${x}}'],
  ['\\alpha'], ['\\beta'], ['\\gamma'], ['\\delta'], ['\\epsilon'], ['\\varepsilon'], ['\\zeta'], ['\\eta'], ['\\theta'], ['\\lambda'], ['\\mu'],
  ['\\nu'], ['\\xi'], ['\\pi'], ['\\rho'], ['\\sigma'], ['\\tau'], ['\\phi'], ['\\varphi'], ['\\chi'], ['\\psi'], ['\\omega'],
  ['\\Gamma'], ['\\Delta'], ['\\Theta'], ['\\Lambda'], ['\\Pi'], ['\\Sigma'], ['\\Phi'], ['\\Psi'], ['\\Omega'],
  ['\\leq'], ['\\geq'], ['\\neq'], ['\\approx'], ['\\equiv'], ['\\sim'], ['\\propto'], ['\\in'], ['\\notin'], ['\\subset'], ['\\subseteq'],
  ['\\cup'], ['\\cap'], ['\\times'], ['\\cdot'], ['\\pm'], ['\\infty'], ['\\partial'], ['\\nabla'], ['\\forall'], ['\\exists'],
  ['\\rightarrow'], ['\\Rightarrow'], ['\\leftrightarrow'], ['\\Leftrightarrow'], ['\\mapsto'], ['\\ldots'], ['\\cdots'],
  ['\\toprule'], ['\\midrule'], ['\\bottomrule'], ['\\hline'], ['\\quad'], ['\\qquad'], ['\\noindent'], ['\\today'],
]

const ENVIRONMENTS = [
  'figure', 'table', 'equation', 'equation*', 'align', 'align*', 'gather', 'itemize', 'enumerate', 'description',
  'center', 'tabular', 'abstract', 'theorem', 'lemma', 'definition', 'proof', 'document', 'verbatim', 'quote',
  'minipage', 'cases', 'matrix', 'pmatrix', 'bmatrix', 'frame', 'thebibliography', 'subfigure',
]

const PACKAGES = [
  'amsmath', 'amssymb', 'amsthm', 'graphicx', 'booktabs', 'float', 'hyperref', 'xcolor', 'geometry', 'caption',
  'subcaption', 'multirow', 'longtable', 'array', 'enumitem', 'listings', 'algorithm', 'algpseudocode', 'tikz',
  'pgfplots', 'siunitx', 'natbib', 'biblatex', 'gbt7714', 'ctex', 'xeCJK', 'fontspec', 'cleveref', 'bm', 'mathtools',
]

const REF_COMMANDS = new Set(['ref', 'eqref', 'pageref', 'autoref', 'cref', 'Cref', 'nameref', 'vref'])
const CITE_COMMANDS = new Set(['cite', 'citep', 'citet', 'parencite', 'textcite', 'autocite', 'footcite', 'citealp', 'citeauthor', 'citeyear', 'nocite', 'supercite'])

function environmentBody(name: string): string {
  if (name === 'figure') return '\\begin{figure}[H]\n\t\\centering\n\t\\includegraphics[width=0.8\\linewidth]{${file}}\n\t\\caption{${caption}}\n\t\\label{fig:${key}}\n\\end{figure}'
  if (name === 'table') return '\\begin{table}[H]\n\t\\centering\n\t\\caption{${caption}}\n\t\\label{tab:${key}}\n\t\\begin{tabular}{${cc}}\n\t\t\\toprule\n\t\t${A} & ${B} \\\\\n\t\t\\midrule\n\t\t${} & ${} \\\\\n\t\t\\bottomrule\n\t\\end{tabular}\n\\end{table}'
  if (name === 'equation') return '\\begin{equation}\n\t${}\n\t\\label{eq:${key}}\n\\end{equation}'
  if (name === 'itemize' || name === 'enumerate') return `\\begin{${name}}\n\t\\item \${}\n\\end{${name}}`
  if (name === 'tabular') return '\\begin{tabular}{${cc}}\n\t${} & ${} \\\\\n\\end{tabular}'
  if (name === 'frame') return '\\begin{frame}{${title}}\n\t${}\n\\end{frame}'
  return `\\begin{${name}}\n\t\${}\n\\end{${name}}`
}

const commandCompletions: Completion[] = COMMANDS.map(([template]) => {
  const name = /^\\[A-Za-z]+/.exec(template)?.[0] ?? template
  const detail = template.slice(name.length).replace(/\$\{([^}]*)\}/g, '$1')
  return snippetCompletion(template, { label: name, detail: detail || undefined, type: 'keyword' })
})

/** ``\begin{`` completes to the whole environment; a ``}`` typed or closed already is reused. */
function environmentCompletion(name: string): Completion {
  const apply = snippet(environmentBody(name).slice('\\begin{'.length))
  return {
    label: name,
    type: 'type',
    apply: (view, completion, from, to) => {
      const next = view.state.sliceDoc(to, to + 1)
      apply(view, completion, from, next === '}' ? to + 1 : to)
    },
  }
}

function commandSource(context: CompletionContext): CompletionResult | null {
  const word = context.matchBefore(/\\[A-Za-z@]*/)
  if (!word || (word.from === word.to && !context.explicit)) return null
  return { from: word.from, options: commandCompletions, validFor: /^\\[A-Za-z@]*$/ }
}

function argumentSource(data: () => CompletionData) {
  return (context: CompletionContext): CompletionResult | null => {
    const before = context.matchBefore(/\\([A-Za-z@]+)\*?(?:\[[^\]]*\])?\{[^{}]*/)
    if (!before) return null
    const match = /\\([A-Za-z@]+)\*?(?:\[[^\]]*\])?\{([^{}]*)$/.exec(before.text)
    if (!match) return null
    const command = match[1] ?? ''
    const typed = match[2] ?? ''
    // In \cite{a, b} only the key being typed is replaced.
    const current = typed.slice(typed.lastIndexOf(',') + 1)
    const from = before.to - current.trimStart().length
    if (command === 'begin' || command === 'end') {
      return {
        from,
        options: ENVIRONMENTS.map((name) => command === 'begin' ? environmentCompletion(name) : { label: name, type: 'type' }),
        validFor: /^[A-Za-z*]*$/,
      }
    }
    if (command === 'usepackage' || command === 'RequirePackage') {
      return { from, options: PACKAGES.map((name) => ({ label: name, type: 'namespace' })), validFor: /^[\w-]*$/ }
    }
    if (REF_COMMANDS.has(command)) {
      return {
        from,
        options: data().labels.map((label) => ({ label: label.key, detail: `${label.file}:${label.line}`, type: 'variable' })),
        validFor: /^[^,}]*$/,
      }
    }
    if (CITE_COMMANDS.has(command)) {
      return {
        from,
        options: data().citations.map((item) => ({
          label: item.key,
          detail: [item.author.split(' and ')[0], item.year].filter(Boolean).join(', '),
          info: item.title || undefined,
          type: 'text',
        })),
        validFor: /^[^,}]*$/,
      }
    }
    return null
  }
}

/** Completion of commands, environments, packages, labels and bibliography keys. */
export function latexCompletion(data: () => CompletionData): Extension {
  return autocompletion({ override: [argumentSource(data), commandSource], activateOnTyping: true, icons: false })
}

export interface OutlineEntry { level: number; title: string; line: number }

const LEVELS: Record<string, number> = { part: 0, chapter: 1, section: 2, subsection: 3, subsubsection: 4, paragraph: 5, frame: 3 }

/** The headings of a source, for the outline. */
export function outline(text: string): OutlineEntry[] {
  const entries: OutlineEntry[] = []
  const lines = text.split('\n')
  lines.forEach((source, index) => {
    const code = stripComment(source)
    const heading = /\\(part|chapter|section|subsection|subsubsection|paragraph)\*?\s*(?:\[[^\]]*\])?\{([^}]*)\}/.exec(code)
    if (heading) {
      entries.push({ level: LEVELS[heading[1] ?? 'section'] ?? 2, title: heading[2]?.trim() || '…', line: index + 1 })
      return
    }
    const frame = /\\begin\{frame\}(?:\[[^\]]*\])?\{([^}]*)\}/.exec(code)
    if (frame) entries.push({ level: LEVELS.frame ?? 3, title: frame[1]?.trim() || '…', line: index + 1 })
  })
  return entries.slice(0, 1000)
}

export function stripComment(line: string): string {
  for (let index = 0; index < line.length; index++) {
    const character = line[index]
    if (character === '\\') { index++; continue }
    if (character === '%') return line.slice(0, index)
  }
  return line
}

/** Words of a source without commands and comments, for the status line. */
export function countWords(text: string): number {
  let count = 0
  const body = text.includes('\\begin{document}') ? text.slice(text.indexOf('\\begin{document}')) : text
  for (const raw of body.split('\n')) {
    const line = stripComment(raw)
      // Names that are not text: environments, keys, packages, files.
      .replace(/\\(?:begin|end|label|ref|eqref|cref|cite\w*|usepackage|documentclass|includegraphics|input|include|bibliography\w*)\*?(?:\[[^\]]*\])?\{[^}]*\}/g, ' ')
      .replace(/\\[A-Za-z@]+\*?/g, ' ')
      .replace(/[{}[\]$&_^~\\]/g, ' ')
    count += (line.match(/[\u3400-\u9fff\uf900-\ufaff]/g) ?? []).length
    count += (line.replace(/[\u3400-\u9fff\uf900-\ufaff]/g, ' ').match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g) ?? []).length
  }
  return count
}

export interface Snippet { id: string; text: string }

/** The insert menu: the text goes in at the cursor, the selection (when any) where ``§`` is. */
export const SNIPPETS: readonly Snippet[] = [
  { id: 'figure', text: '\\begin{figure}[H]\n  \\centering\n  \\includegraphics[width=0.8\\linewidth]{§}\n  \\caption{}\n  \\label{fig:}\n\\end{figure}\n' },
  { id: 'table', text: '\\begin{table}[H]\n  \\centering\n  \\caption{§}\n  \\label{tab:}\n  \\begin{tabular}{cc}\n    \\toprule\n    A & B \\\\\n    \\midrule\n     &  \\\\\n    \\bottomrule\n  \\end{tabular}\n\\end{table}\n' },
  { id: 'equation', text: '\\begin{equation}\n  §\n  \\label{eq:}\n\\end{equation}\n' },
  { id: 'align', text: '\\begin{align}\n  a &= b \\\\\n  c &= d§\n\\end{align}\n' },
  { id: 'itemize', text: '\\begin{itemize}\n  \\item §\n\\end{itemize}\n' },
  { id: 'enumerate', text: '\\begin{enumerate}\n  \\item §\n\\end{enumerate}\n' },
  { id: 'footnote', text: '\\footnote{§}' },
  { id: 'cite', text: '\\cite{§}' },
  { id: 'ref', text: '\\ref{§}' },
  { id: 'href', text: '\\href{https://§}{}' },
]

/** The symbol palette: what it shows and the command it types. */
export const SYMBOLS: ReadonlyArray<readonly [string, string]> = [
  ['α', '\\alpha'], ['β', '\\beta'], ['γ', '\\gamma'], ['δ', '\\delta'], ['ε', '\\varepsilon'], ['ζ', '\\zeta'], ['η', '\\eta'],
  ['θ', '\\theta'], ['ι', '\\iota'], ['κ', '\\kappa'], ['λ', '\\lambda'], ['μ', '\\mu'], ['ν', '\\nu'], ['ξ', '\\xi'], ['π', '\\pi'],
  ['ρ', '\\rho'], ['σ', '\\sigma'], ['τ', '\\tau'], ['υ', '\\upsilon'], ['φ', '\\varphi'], ['χ', '\\chi'], ['ψ', '\\psi'], ['ω', '\\omega'],
  ['Γ', '\\Gamma'], ['Δ', '\\Delta'], ['Θ', '\\Theta'], ['Λ', '\\Lambda'], ['Ξ', '\\Xi'], ['Π', '\\Pi'], ['Σ', '\\Sigma'], ['Φ', '\\Phi'],
  ['Ψ', '\\Psi'], ['Ω', '\\Omega'],
  ['√', '\\sqrt{}'], ['∫', '\\int'], ['∮', '\\oint'], ['∑', '\\sum'], ['∏', '\\prod'], ['∞', '\\infty'], ['±', '\\pm'], ['∓', '\\mp'],
  ['×', '\\times'], ['÷', '\\div'], ['⋅', '\\cdot'], ['∘', '\\circ'],
  ['≤', '\\leq'], ['≥', '\\geq'], ['≪', '\\ll'], ['≫', '\\gg'], ['≠', '\\neq'], ['≈', '\\approx'], ['≡', '\\equiv'], ['∼', '\\sim'], ['∝', '\\propto'],
  ['∈', '\\in'], ['∉', '\\notin'], ['⊂', '\\subset'], ['⊆', '\\subseteq'], ['⊃', '\\supset'], ['⊇', '\\supseteq'], ['∪', '\\cup'], ['∩', '\\cap'],
  ['∧', '\\wedge'], ['∨', '\\vee'], ['¬', '\\neg'], ['∀', '\\forall'], ['∃', '\\exists'], ['∂', '\\partial'], ['∇', '\\nabla'], ['∠', '\\angle'],
  ['⊥', '\\perp'], ['∥', '\\parallel'],
  ['→', '\\rightarrow'], ['←', '\\leftarrow'], ['↑', '\\uparrow'], ['↓', '\\downarrow'], ['↦', '\\mapsto'], ['⇒', '\\Rightarrow'],
  ['⇐', '\\Leftarrow'], ['⇔', '\\Leftrightarrow'], ['↔', '\\leftrightarrow'], ['⋯', '\\cdots'], ['…', '\\ldots'],
]

export function isLatexPath(path: string): boolean {
  return /\.(tex|bib|sty|cls|ltx)$/i.test(path)
}

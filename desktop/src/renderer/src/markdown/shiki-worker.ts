import { createHighlighterCore } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import githubDark from '@shikijs/themes/github-dark'

export interface HighlightRequest {
  requestId: string
  language: string
  code: string
}

export interface HighlightResult {
  requestId: string
  html: string
  highlighted: boolean
}

const LANGUAGE_ALIASES: Readonly<Record<string, string>> = {
  js: 'javascript', md: 'markdown', py: 'python', shell: 'shellscript', sh: 'shellscript', ts: 'typescript', yml: 'yaml',
}

const LANGUAGE_LOADERS: Readonly<Record<string, () => Promise<{ default: unknown }>>> = {
  bash: () => import('@shikijs/langs/bash'),
  css: () => import('@shikijs/langs/css'),
  diff: () => import('@shikijs/langs/diff'),
  html: () => import('@shikijs/langs/html'),
  javascript: () => import('@shikijs/langs/javascript'),
  json: () => import('@shikijs/langs/json'),
  jsx: () => import('@shikijs/langs/jsx'),
  markdown: () => import('@shikijs/langs/markdown'),
  powershell: () => import('@shikijs/langs/powershell'),
  python: () => import('@shikijs/langs/python'),
  shellscript: () => import('@shikijs/langs/shellscript'),
  sql: () => import('@shikijs/langs/sql'),
  tsx: () => import('@shikijs/langs/tsx'),
  typescript: () => import('@shikijs/langs/typescript'),
  yaml: () => import('@shikijs/langs/yaml'),
}

let highlighterPromise: ReturnType<typeof createHighlighterCore> | undefined
const languagePromises = new Map<string, Promise<void>>()

function getHighlighter(): ReturnType<typeof createHighlighterCore> {
  return (highlighterPromise ??= createHighlighterCore({
    langs: [],
    themes: [githubDark],
    engine: createJavaScriptRegexEngine(),
  }))
}

async function loadLanguage(language: string): Promise<string | null> {
  const canonical = LANGUAGE_ALIASES[language] ?? language
  const loader = LANGUAGE_LOADERS[canonical]
  if (!loader) return null
  const highlighter = await getHighlighter()
  if (!highlighter.getLoadedLanguages().includes(canonical)) {
    let pendingLoad = languagePromises.get(canonical)
    if (!pendingLoad) {
      pendingLoad = loader().then(async (module) => { await highlighter.loadLanguage(module.default as never) })
      languagePromises.set(canonical, pendingLoad)
    }
    await pendingLoad
  }
  return canonical
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')
}

const TOKEN_COLORS: Readonly<Record<string, string>> = {
  '#6a737d': 'muted',
  '#79b8ff': 'blue',
  '#b392f0': 'violet',
  '#e1e4e8': 'plain',
  '#85e89d': 'green',
  '#f97583': 'red',
  '#9ecbff': 'cyan',
  '#ffab70': 'orange',
  '#fdaeb7': 'pink',
  '#dbedff': 'pale',
  '#d1d5da': 'gray',
  '#2f363d': 'dark',
}

function tokenClasses(color: string | undefined, fontStyle: number | undefined): string {
  const classes = ['tok', `tok-${TOKEN_COLORS[color?.toLowerCase() ?? ''] ?? 'plain'}`]
  if (fontStyle && (fontStyle & 1) !== 0) classes.push('tok-italic')
  if (fontStyle && (fontStyle & 2) !== 0) classes.push('tok-bold')
  if (fontStyle && (fontStyle & 4) !== 0) classes.push('tok-underline')
  if (fontStyle && (fontStyle & 8) !== 0) classes.push('tok-strike')
  return classes.join(' ')
}

export async function highlightCode(request: HighlightRequest): Promise<HighlightResult> {
  const code = request.code
  const language = request.language.toLowerCase()
  if (code.length > 200_000 || language === 'text') {
    return { requestId: request.requestId, html: `<pre><code>${escapeHtml(code)}</code></pre>`, highlighted: false }
  }
  try {
    const highlighter = await getHighlighter()
    const canonical = await loadLanguage(language)
    if (!canonical) return { requestId: request.requestId, html: `<pre><code>${escapeHtml(code)}</code></pre>`, highlighted: false }
    const result = highlighter.codeToTokens(code, { lang: canonical as never, theme: 'github-dark' })
    const lines = result.tokens.map((line) => `<span class="line">${line.map((token) => `<span class="${tokenClasses(token.color, token.fontStyle)}">${escapeHtml(token.content)}</span>`).join('')}</span>`).join('\n')
    const html = `<pre class="shiki"><code>${lines}</code></pre>`
    return { requestId: request.requestId, html, highlighted: true }
  } catch {
    return { requestId: request.requestId, html: `<pre><code>${escapeHtml(code)}</code></pre>`, highlighted: false }
  }
}

const workerScope = globalThis as unknown as {
  document?: unknown
  addEventListener: (type: 'message', listener: (event: MessageEvent<HighlightRequest>) => void) => void
  postMessage: (result: HighlightResult) => void
}

if (typeof workerScope.document === 'undefined' && typeof workerScope.postMessage === 'function') {
  workerScope.addEventListener('message', (event) => {
    void highlightCode(event.data).then((result) => workerScope.postMessage(result))
  })
}

/**
 * What a message's Markdown needs before it is parsed: models write LaTeX as \( \) and \[ \], and put
 * display formulas on one line as $$ $$, none of which remark-math reads; and a "$" that is money must
 * not open a formula. Code, fenced or inline, is left as it is.
 */
export function normalizeMath(text: string): string {
  return text.split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/g).map((part, index) => index % 2 ? part : escapeMoney(part
    .replace(/\\\[([\s\S]+?)\\\]/g, (_, body: string) => `\n$$\n${body.trim()}\n$$\n`)
    .replace(/\\\(([\s\S]+?)\\\)/g, (_, body: string) => `$${body.trim()}$`)
    .replace(/^([ \t]*)\$\$([^\n]+?)\$\$[ \t]*$/gm, (_, indent: string, body: string) => `${indent}$$\n${indent}${body.trim()}\n${indent}$$`))).join('')
}

/**
 * A single "$" is a formula's edge only as pandoc reads it: an opening one has no space after it, and
 * the next "$" closes it if it has no space before it and no digit after it, in the same paragraph (a
 * formula holds no bare "$"). Any other "$" is money ("A$40,000 … A$40k", "$5 and $10") and is escaped,
 * or the text between two prices turns into one formula. "$$" is left as it is.
 */
function escapeMoney(part: string): string {
  const singles: number[] = []
  for (let at = 0; at < part.length; at += 1) {
    if (part[at] === '\\') {
      at += 1
      continue
    }
    if (part[at] !== '$') continue
    if (part[at + 1] === '$') {
      at += 1
      continue
    }
    singles.push(at)
  }
  const formula = new Set<number>()
  for (let index = 0; index + 1 < singles.length; index += 1) {
    const open = singles[index] as number
    const close = singles[index + 1] as number
    if (!part[open + 1] || /\s/.test(part[open + 1] as string) || /\n[ \t]*\n/.test(part.slice(open, close))) continue
    if (/\s/.test(part[close - 1] as string) || /\d/.test(part[close + 1] ?? '')) continue
    formula.add(open).add(close)
    index += 1
  }
  let escaped = ''
  let from = 0
  for (const at of singles) {
    if (formula.has(at)) continue
    escaped += `${part.slice(from, at)}\\$`
    from = at + 1
  }
  return escaped + part.slice(from)
}

interface MarkdownNode {
  type: string
  value?: string
  children?: MarkdownNode[]
  position?: unknown
}

const BLOCK_PARENTS = new Set(['root', 'blockquote', 'listItem'])

/**
 * Raw HTML in a message ("add rules before </style>") is shown as the text it is, never drawn; dropped,
 * it made tags vanish from the sentence. Models write <br> for line breaks in table cells, so that one
 * stays a break.
 */
export function remarkRawHtmlAsText() {
  const visit = (node: MarkdownNode): MarkdownNode => {
    if (!node.children) return node
    node.children = node.children.map((child) => {
      if (child.type !== 'html') return visit(child)
      const block = BLOCK_PARENTS.has(node.type)
      if (!block && /^<br\s*\/?>$/i.test(child.value ?? '')) return { type: 'break', position: child.position }
      const text: MarkdownNode = { type: 'text', value: child.value ?? '', position: child.position }
      return block ? { type: 'paragraph', children: [text], position: child.position } : text
    })
    return node
  }
  return visit
}

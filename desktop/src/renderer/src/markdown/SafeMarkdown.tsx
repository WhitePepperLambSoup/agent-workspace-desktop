import { defaultSchema } from 'hast-util-sanitize'
import { memo, useEffect, useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeSanitize from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'

import { classifyExternalUrl, resolveResourceImage, type ResourceCapability } from './resource-policy'
import { HighlightedCode } from './HighlightedCode'
import { useOptionalI18n } from '../i18n/I18nProvider'

type MathPlugins = typeof import('./math-plugins')

// Inline $x$, display $$x$$, and LaTeX \( \) / \[ \] delimiters.
const MATH_PATTERN = /\$[^$\n]+\$|\$\$|\\\(|\\\[/
let mathPlugins: MathPlugins | null = null
let mathPluginsPromise: Promise<MathPlugins> | null = null

export function loadMathPlugins(): Promise<MathPlugins> {
  mathPluginsPromise ??= import('./math-plugins').then((plugins) => {
    mathPlugins = plugins
    return plugins
  })
  return mathPluginsPromise
}

function useMathPlugins(source: string): MathPlugins | null {
  const needsMath = MATH_PATTERN.test(source)
  const [plugins, setPlugins] = useState<MathPlugins | null>(mathPlugins)
  useEffect(() => {
    if (!needsMath || plugins) return
    let active = true
    void loadMathPlugins().then((loaded) => { if (active) setPlugins(loaded) })
    return () => { active = false }
  }, [needsMath, plugins])
  return needsMath ? plugins : null
}

interface SafeMarkdownProps {
  source: string
  resources?: readonly ResourceCapability[]
  onOpenExternal?: (url: string) => void
  streaming?: boolean
}

const schema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [...(defaultSchema.attributes?.code ?? []), ['className', /^language-/]],
    span: [...(defaultSchema.attributes?.span ?? []), ['className', /^katex/]],
  },
}

export const SafeMarkdown = memo(function SafeMarkdown({ source, resources = [], onOpenExternal, streaming = false }: SafeMarkdownProps) {
  const { t } = useOptionalI18n()
  const capabilities = useMemo(() => [...resources], [resources])
  const visibleSource = useMemo(() => source.slice(0, 500_000), [source])
  const truncated = source.length > 500_000
  const math = useMathPlugins(streaming ? '' : visibleSource)
  if (streaming) {
    return <div className="markdown-body markdown-streaming" aria-live="polite">{visibleSource}</div>
  }
  return (
    <div className="markdown-body">
      <ReactMarkdown
        skipHtml
        remarkPlugins={math ? [remarkGfm, math.remarkMath] : [remarkGfm]}
        rehypePlugins={math ? [[rehypeSanitize, schema], math.rehypeKatex] : [[rehypeSanitize, schema]]}
        components={{
          pre: ({ children }) => <>{children}</>,
          code: ({ className, children }) => {
            const match = /language-([A-Za-z0-9_-]+)/.exec(className ?? '')
            if (!match) return <code>{children}</code>
            return <HighlightedCode language={match[1]} code={String(children).replace(/\n$/, '')} />
          },
          a: ({ href, children }) => {
            const url = classifyExternalUrl(href)
            if (!url) return <span>{children}</span>
            const openLabel = t('markdown.openLink', { label: url.label })
            return <button type="button" className="markdown-link" aria-label={openLabel} title={onOpenExternal ? openLabel : t('markdown.externalUnavailable')} disabled={!onOpenExternal} onClick={() => onOpenExternal?.(url.href)}>{children}</button>
          },
          // GFM task-list boxes are read-only; name their state for assistive tech.
          input: ({ type, checked }) => type === 'checkbox'
            ? <input type="checkbox" checked={checked === true} disabled readOnly aria-label={t(checked ? 'markdown.taskDone' : 'markdown.taskOpen')} />
            : null,
          img: ({ src, alt }) => {
            const resolved = resolveResourceImage(src, capabilities)
            if (resolved) {
              return <img src={resolved} alt={alt ?? ''} loading="lazy" />
            }
            return <span className="remote-image-placeholder">{t('markdown.remoteImageUnavailable')}</span>
          },
        }}
      >
        {visibleSource}
      </ReactMarkdown>
      {truncated ? <p className="markdown-truncation-note" role="status">{t('markdown.truncated')}</p> : null}
    </div>
  )
})

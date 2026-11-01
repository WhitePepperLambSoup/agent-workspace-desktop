import { ChevronDown, ChevronRight, Workflow } from 'lucide-react'
import { useEffect, useState } from 'react'

import { useOptionalI18n } from '../i18n/I18nProvider'
import { HighlightedCode } from './HighlightedCode'

import './mermaid-diagram.css'

type Mermaid = (typeof import('mermaid'))['default']

let mermaidPromise: Promise<Mermaid> | null = null
let sequence = 0
// Mermaid keeps its settings in one place, and a render reads them: one diagram at a time.
let queue: Promise<unknown> = Promise.resolve()

const MAX_SOURCE_CHARS = 50_000

function colorMode(): 'dark' | 'light' {
  return document.querySelector('.app-shell')?.getAttribute('data-color-mode') === 'light' ? 'light' : 'dark'
}

/**
 * The drawing as a picture of its own. A model's diagram is untrusted, and the window's policy has
 * no room for the inline styles Mermaid writes: as an image the SVG keeps its styles, cannot run
 * anything, and loads nothing. It is a data address so an exported answer carries it too.
 */
export function diagramImage(svg: string): { src: string; width: number; height: number } | null {
  // Mermaid's HTML labels are not XML (<br>), and an image must be: those go through the HTML parser.
  const parser = new DOMParser()
  const xml = parser.parseFromString(svg, 'image/svg+xml')
  const element = xml.querySelector('parsererror')
    ? parser.parseFromString(svg, 'text/html').querySelector('svg')
    : xml.documentElement
  const viewBox = element?.getAttribute('viewBox')?.split(/[\s,]+/).map(Number)
  if (!element || !viewBox || viewBox.length !== 4 || viewBox.some((value) => !Number.isFinite(value))) return null
  const [, , width, height] = viewBox as [number, number, number, number]
  if (width <= 0 || height <= 0) return null
  // "100%" gives an image no size of its own.
  element.setAttribute('width', String(Math.ceil(width)))
  element.setAttribute('height', String(Math.ceil(height)))
  element.removeAttribute('style')
  const bytes = new TextEncoder().encode(new XMLSerializer().serializeToString(element))
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return { src: `data:image/svg+xml;base64,${btoa(binary)}`, width: Math.ceil(width), height: Math.ceil(height) }
}

async function drawDiagram(code: string, mode: 'dark' | 'light'): Promise<ReturnType<typeof diagramImage>> {
  mermaidPromise ??= import('mermaid').then((module) => module.default)
  const mermaid = await mermaidPromise
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: mode === 'dark' ? 'dark' : 'default',
    htmlLabels: false,
    flowchart: { htmlLabels: false },
    fontFamily: '"Segoe UI", "Microsoft YaHei", sans-serif',
    suppressErrorRendering: true,
    maxTextSize: MAX_SOURCE_CHARS,
  })
  sequence += 1
  const id = `agent-workspace-diagram-${sequence}`
  try {
    const { svg } = await mermaid.render(id, code)
    return diagramImage(svg)
  } finally {
    // A diagram that failed leaves its scratch element behind.
    document.getElementById(`d${id}`)?.remove()
    document.getElementById(id)?.remove()
  }
}

export function MermaidDiagram({ code }: { code: string }) {
  const { t } = useOptionalI18n()
  const [mode, setMode] = useState(colorMode)
  const [image, setImage] = useState<ReturnType<typeof diagramImage>>(null)
  const [failed, setFailed] = useState(false)
  const [showSource, setShowSource] = useState(false)

  useEffect(() => {
    const shell = document.querySelector('.app-shell')
    if (!shell) return undefined
    const observer = new MutationObserver(() => setMode(colorMode()))
    observer.observe(shell, { attributes: true, attributeFilter: ['data-color-mode'] })
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (code.length > MAX_SOURCE_CHARS) {
      setFailed(true)
      return undefined
    }
    let active = true
    setFailed(false)
    queue = queue.then(async () => {
      if (!active) return
      try {
        const drawn = await drawDiagram(code, mode)
        if (!active) return
        setImage(drawn)
        setFailed(drawn === null)
      } catch {
        if (active) setFailed(true)
      }
    })
    return () => { active = false }
  }, [code, mode])

  if (failed) {
    return (
      <div className="mermaid-diagram" data-state="failed">
        <p className="mermaid-diagram-note">{t('markdown.diagramFailed')}</p>
        <HighlightedCode language="text" code={code} />
      </div>
    )
  }
  return (
    <figure className="mermaid-diagram" data-state={image ? 'drawn' : 'drawing'}>
      {image
        ? <img src={image.src} width={image.width} height={image.height} alt={t('markdown.diagram')} />
        : <span className="mermaid-diagram-wait"><Workflow size={15} aria-hidden="true" />{t('markdown.diagramDrawing')}</span>}
      <figcaption>
        <button type="button" aria-expanded={showSource} onClick={() => setShowSource((current) => !current)}>
          {showSource ? <ChevronDown size={13} aria-hidden="true" /> : <ChevronRight size={13} aria-hidden="true" />}
          {t('markdown.diagramSource')}
        </button>
      </figcaption>
      {showSource ? <HighlightedCode language="text" code={code} /> : null}
    </figure>
  )
}

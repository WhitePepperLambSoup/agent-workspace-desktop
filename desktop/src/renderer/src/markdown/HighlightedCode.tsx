import { useEffect, useState } from 'react'

import type { HighlightResult } from './shiki-worker'

interface PendingHighlight {
  resolve: (result: HighlightResult | null) => void
  timer: number
}

let sharedWorker: Worker | null = null
let requestSequence = 0
const pending = new Map<string, PendingHighlight>()

function closeWorker(): void {
  sharedWorker?.terminate()
  sharedWorker = null
  for (const request of pending.values()) {
    window.clearTimeout(request.timer)
    request.resolve(null)
  }
  pending.clear()
}

function getWorker(): Worker | null {
  if (typeof Worker === 'undefined') return null
  if (sharedWorker) return sharedWorker
  const worker = new Worker(new URL('./shiki-worker.ts', import.meta.url), { type: 'module' })
  worker.addEventListener('message', (event: MessageEvent<HighlightResult>) => {
    const result = event.data
    const request = pending.get(result.requestId)
    if (!request) return
    pending.delete(result.requestId)
    window.clearTimeout(request.timer)
    request.resolve(result)
  })
  worker.addEventListener('error', closeWorker)
  sharedWorker = worker
  return worker
}

function requestHighlight(language: string, code: string): { promise: Promise<HighlightResult | null>; cancel: () => void } | null {
  if (code.length > 200_000) return null
  const worker = getWorker()
  if (!worker) return null
  const requestId = `highlight-${Date.now()}-${++requestSequence}`
  let resolveRequest!: (result: HighlightResult | null) => void
  const promise = new Promise<HighlightResult | null>((resolve) => { resolveRequest = resolve })
  const timer = window.setTimeout(() => {
    pending.delete(requestId)
    resolveRequest(null)
  }, 2500)
  pending.set(requestId, { resolve: resolveRequest, timer })
  worker.postMessage({ requestId, language, code })
  return {
    promise,
    cancel: () => {
      const request = pending.get(requestId)
      if (!request) return
      pending.delete(requestId)
      window.clearTimeout(request.timer)
      request.resolve(null)
    },
  }
}

export function HighlightedCode({ language, code }: { language: string; code: string }) {
  const [html, setHtml] = useState<string | null>(null)

  useEffect(() => {
    setHtml(null)
    const request = requestHighlight(language, code)
    if (!request) return
    let active = true
    void request.promise.then((result) => {
      if (!active || !result || result.html.length > 1_000_000 || !result.html.startsWith('<pre class="shiki') || /\sstyle=|<script|\son\w+=/i.test(result.html)) return
      setHtml(result.html)
    })
    return () => {
      active = false
      request.cancel()
    }
  }, [code, language])

  if (html) return <div className="shiki-fragment" data-highlight-state="highlighted" dangerouslySetInnerHTML={{ __html: html }} />
  return <pre data-highlight-state="plain"><code className={`language-${language}`}>{code}</code></pre>
}

/** A readable description of one `browser` tool call and its result. */
export interface BrowserCall {
  action: string
  /** The URL, selector, tab or file the action targets. */
  target: string | null
  url: string | null
  title: string | null
  /** Workspace-relative image saved by a screenshot. */
  imagePath: string | null
  /** Workspace-relative PDF saved by print_pdf. */
  pdfPath: string | null
  /** Text captured by snapshot or evaluate, already bounded by the gateway. */
  text: string | null
  tabs: Array<{ id: string; title: string; url: string }>
  outcome: 'ok' | 'failed' | null
}

function record(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'string') {
    try { value = JSON.parse(value) } catch { return null }
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

const SUCCESS_FLAGS = ['ok', 'clicked', 'typed', 'filled'] as const

export function describeBrowserCall(argumentsValue: unknown, resultValue: unknown): BrowserCall {
  const args = record(argumentsValue) ?? {}
  const result = record(resultValue)
  const action = str(args.action) ?? 'browser'
  const selector = str(args.selector)
  const url = str(result?.url) ?? str(args.url)
  let outcome: BrowserCall['outcome'] = null
  for (const flag of SUCCESS_FLAGS) {
    if (typeof result?.[flag] === 'boolean') outcome = result[flag] ? 'ok' : 'failed'
  }
  const tabs = Array.isArray(result?.tabs)
    ? result.tabs.flatMap((tab) => {
      const item = record(tab)
      if (!item) return []
      return [{ id: str(item.id) ?? str(item.targetId) ?? '', title: str(item.title) ?? '', url: str(item.url) ?? '' }]
    }).slice(0, 20)
    : []
  const mediaType = str(result?.media_type)
  const savedPath = str(result?.path)
  const capturedText = typeof result?.text === 'string' ? result.text : typeof result?.result === 'string' ? result.result : null
  return {
    action,
    target: action === 'navigate' ? url : selector ?? str(args.path) ?? str(args.target_id) ?? (action === 'evaluate' ? str(args.expression) : null),
    url,
    title: str(result?.title),
    imagePath: mediaType?.startsWith('image/') ? savedPath : null,
    pdfPath: mediaType === 'application/pdf' ? savedPath : null,
    text: capturedText ? capturedText.slice(0, 4000) : null,
    tabs,
    outcome,
  }
}

/** Host name shown in the collapsed row; falls back to the raw target. */
export function compactTarget(call: BrowserCall): string | null {
  if (call.action === 'navigate' && call.url) {
    try { return new URL(call.url).host || call.url } catch { return call.url }
  }
  return call.target ? call.target.slice(0, 80) : null
}

export interface ResourceCapability {
  id: string
  url: string
}

export interface ExternalUrl {
  href: string
  label: string
}

export function classifyExternalUrl(value: string | undefined): ExternalUrl | null {
  if (!value) return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) return null
    return { href: url.toString(), label: `${url.origin}${url.pathname}` }
  } catch {
    return null
  }
}

export interface WorkspaceLink {
  path: string
  /** A PDF page: paper.pdf#page=5. */
  page?: number
}

/** A link to a file of the open folder: a relative path such as ``results/fig1.png`` or
 * ``paper.pdf#page=5``; null for anything else (an address, an absolute path, a step out). */
export function classifyWorkspaceLink(value: string | undefined): WorkspaceLink | null {
  if (!value || value.length > 1024 || /^[a-z][a-z0-9+.-]*:/i.test(value) || /^[\\/]/.test(value)) return null
  let decoded: string
  try {
    decoded = decodeURI(value)
  } catch {
    return null
  }
  const [rawPath = '', fragment = ''] = decoded.split('#', 2)
  const path = rawPath.replace(/^\.\//, '').replace(/\\/g, '/')
  if (!path || path.includes('\0') || path.split('/').some((part) => part === '..') || !/\.[A-Za-z0-9]{1,8}$/.test(path)) return null
  const page = /^page=(\d{1,6})$/.exec(fragment)?.[1]
  return page && Number(page) >= 1 ? { path, page: Number(page) } : { path }
}

export function resolveResourceImage(
  source: string | undefined,
  capabilities: readonly ResourceCapability[],
): string | null {
  if (!source?.startsWith('resource:')) return null
  const id = source.slice('resource:'.length)
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(id)) return null
  const value = capabilities.find((item) => item.id === id)?.url
  return value && /^(data:image\/(png|jpeg|gif|webp);base64,|blob:)/i.test(value) ? value : null
}

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

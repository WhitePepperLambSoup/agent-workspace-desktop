import { isValidElement, type ReactNode } from 'react'

export type CommandContribution = {
  kind: 'command'
  id: string
  title: string
  keywords: readonly string[]
  shortcut?: string
  icon?: string
  isEnabled: () => boolean
  run: () => void | Promise<void>
}

export type InspectorPageContribution = {
  kind: 'inspector-page'
  id: string
  title: string
  order: number
  render: () => unknown
  isVisible?: () => boolean
}

export type SettingsSectionContribution = {
  kind: 'settings-section'
  id: string
  title: string
  order: number
  render: () => unknown
}

export type TimelineRendererContribution = {
  kind: 'timeline-renderer'
  id: string
  priority: number
  supports: (entry: unknown) => boolean
  render: (entry: unknown) => unknown
}

export type ArtifactViewerContribution = {
  kind: 'artifact-viewer'
  id: string
  priority: number
  supports: (metadata: unknown) => boolean
  render: (metadata: unknown) => unknown
}

export type Contribution =
  | CommandContribution
  | InspectorPageContribution
  | SettingsSectionContribution
  | TimelineRendererContribution
  | ArtifactViewerContribution

const ID_PATTERN = /^[a-z][a-z0-9]*(?:\.[a-z0-9]+)*$/
const MAX_TEXT = 160
const MAX_KEYWORDS = 32
const MAX_ORDER = 1_000_000

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, ' ')
}

export function normalizeShortcut(value: string): string {
  return value.split('+').map((part) => normalize(part)).filter(Boolean).join('+')
}

export function isRenderableContribution(value: unknown): value is ReactNode {
  if (typeof value === 'string' || typeof value === 'number' || isValidElement(value)) return true
  return Array.isArray(value) && value.every(isRenderableContribution)
}

function validateBase(contribution: Contribution): void {
  if (typeof contribution.id !== 'string' || !ID_PATTERN.test(contribution.id) || contribution.id.length > 128) throw new Error('invalid_contribution_id')
  if ('title' in contribution && (typeof contribution.title !== 'string' || !contribution.title.trim() || contribution.title.length > MAX_TEXT)) throw new Error('invalid_contribution_title')
  if (contribution.kind === 'command') {
    if (typeof contribution.run !== 'function') throw new Error('invalid_contribution_renderer')
    if (typeof contribution.isEnabled !== 'function') throw new Error('invalid_contribution_enabled')
    if (!Array.isArray(contribution.keywords) || contribution.keywords.length > MAX_KEYWORDS || contribution.keywords.some((keyword) => typeof keyword !== 'string' || keyword.length > MAX_TEXT)) throw new Error('invalid_contribution_keywords')
    if (contribution.shortcut !== undefined && (typeof contribution.shortcut !== 'string' || !contribution.shortcut.trim() || contribution.shortcut.length > MAX_TEXT)) throw new Error('invalid_contribution_shortcut')
    return
  }
  if (typeof contribution.render !== 'function') throw new Error('invalid_contribution_renderer')
  if ('order' in contribution && (!Number.isFinite(contribution.order) || Math.abs(contribution.order) > MAX_ORDER)) throw new Error('invalid_contribution_order')
  if ('priority' in contribution && (!Number.isFinite(contribution.priority) || Math.abs(contribution.priority) > MAX_ORDER)) throw new Error('invalid_contribution_priority')
  if ('supports' in contribution && typeof contribution.supports !== 'function') throw new Error('invalid_contribution_supports')
  if ('isVisible' in contribution && contribution.isVisible !== undefined && typeof contribution.isVisible !== 'function') throw new Error('invalid_contribution_visibility')
}

export function createContributionRegistry() {
  const all = new Map<string, Contribution>()
  const shortcuts = new Map<string, string>()

  const register = (contribution: Contribution): (() => void) => {
    validateBase(contribution)
    if (all.has(contribution.id)) throw new Error('duplicate_contribution_id')
    if ('shortcut' in contribution && contribution.shortcut) {
      const shortcut = normalizeShortcut(contribution.shortcut)
      const existing = shortcuts.get(shortcut)
      if (existing) throw new Error('duplicate_contribution_shortcut')
      shortcuts.set(shortcut, contribution.id)
    }
    all.set(contribution.id, contribution)
    let active = true
    return () => {
      if (!active) return
      active = false
      all.delete(contribution.id)
      if ('shortcut' in contribution && contribution.shortcut) shortcuts.delete(normalizeShortcut(contribution.shortcut))
    }
  }

  const enabled = (command: CommandContribution): boolean => {
    try { return command.isEnabled() } catch { return false }
  }

  const visible = (page: InspectorPageContribution): boolean => {
    try { return page.isVisible?.() !== false } catch { return false }
  }

  const prioritized = <T extends TimelineRendererContribution | ArtifactViewerContribution>(
    kind: T['kind'],
  ): T[] => [...all.values()]
    .filter((item): item is T => item.kind === kind)
    .sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id))

  const resolveRenderer = <T extends TimelineRendererContribution | ArtifactViewerContribution>(
    contributions: T[], value: unknown, fallback: () => unknown,
  ): unknown => {
    for (const contribution of contributions) {
      try {
        if (!contribution.supports(value)) continue
        return contribution.render(value)
      } catch {
        continue
      }
    }
    return fallback()
  }

  return {
    registerContribution(contribution: Contribution): () => void {
      if (!contribution || !['command', 'inspector-page', 'settings-section', 'timeline-renderer', 'artifact-viewer'].includes((contribution as Contribution).kind)) {
        throw new Error('unknown_contribution_kind')
      }
      return register(contribution)
    },
    registerCommand(command: Omit<CommandContribution, 'kind'>): () => void {
      return register({ ...command, kind: 'command' })
    },
    registerInspectorPage(page: Omit<InspectorPageContribution, 'kind'>): () => void {
      return register({ ...page, kind: 'inspector-page' })
    },
    registerSettingsSection(section: Omit<SettingsSectionContribution, 'kind'>): () => void {
      return register({ ...section, kind: 'settings-section' })
    },
    registerTimelineRenderer(renderer: Omit<TimelineRendererContribution, 'kind'>): () => void {
      return register({ ...renderer, kind: 'timeline-renderer' })
    },
    registerArtifactViewer(viewer: Omit<ArtifactViewerContribution, 'kind'>): () => void {
      return register({ ...viewer, kind: 'artifact-viewer' })
    },
    searchCommands(query: string): CommandContribution[] {
      const terms = normalize(query).split(' ').filter(Boolean)
      return [...all.values()]
        .filter((item): item is CommandContribution => item.kind === 'command' && enabled(item))
        .filter((item) => {
          if (terms.length === 0) return true
          const haystack = [item.id, item.title, ...item.keywords, item.shortcut ?? ''].map(normalize).join(' ')
          return terms.every((term) => haystack.includes(term))
        })
        .sort((left, right) => normalize(left.title).localeCompare(normalize(right.title)) || left.id.localeCompare(right.id))
    },
    getCommandByShortcut(shortcut: string): CommandContribution | null {
      const id = shortcuts.get(normalizeShortcut(shortcut))
      const contribution = id ? all.get(id) : undefined
      return contribution?.kind === 'command' && enabled(contribution) ? contribution : null
    },
    getInspectorPages(): InspectorPageContribution[] {
      return [...all.values()].filter((item): item is InspectorPageContribution => item.kind === 'inspector-page').filter(visible).sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
    },
    getSettingsSections(): SettingsSectionContribution[] {
      return [...all.values()].filter((item): item is SettingsSectionContribution => item.kind === 'settings-section').sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
    },
    resolveTimelineRenderer(entry: unknown, fallback: () => unknown): unknown {
      return resolveRenderer(prioritized<TimelineRendererContribution>('timeline-renderer'), entry, fallback)
    },
    resolveArtifactViewer(metadata: unknown, fallback: () => unknown): unknown {
      return resolveRenderer(prioritized<ArtifactViewerContribution>('artifact-viewer'), metadata, fallback)
    },
  }
}

export type ContributionRegistry = ReturnType<typeof createContributionRegistry>

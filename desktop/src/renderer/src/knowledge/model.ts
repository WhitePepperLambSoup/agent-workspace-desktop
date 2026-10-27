// The knowledge base as the sidecar reports it (knowledge.* results), read defensively.

export interface KnowledgeCollection {
  id: string
  name: string
  label: string
  defaultOn: boolean
  documents: number
  ready: number
  passages: number
}

export type KnowledgeState = 'queued' | 'indexing' | 'ready' | 'failed'

export interface KnowledgeDocument {
  id: string
  title: string
  collectionId: string
  origin: string
  originPath: string | null
  state: KnowledgeState
  progress: number
  pages: number | null
  passages: number
  error: string | null
  errorCode: string | null
  warnings: string[]
  createdAt: string
}

export interface KnowledgeSnapshot {
  enabled: boolean
  auto: boolean
  collections: KnowledgeCollection[]
  documents: KnowledgeDocument[]
  synonyms: string
  builtinSynonymGroups: number
  totals: { documents: number; passages: number; storageBytes: number }
  suffixes: string[]
  maxFileBytes: number
}

export interface KnowledgeResult {
  documentId: string
  document: string
  page: number | null
  section: string | null
  passage: string
  url: string | null
}

export interface KnowledgeSelection {
  enabled: boolean
  collections: string[]
  explicit: boolean
  available: KnowledgeCollection[]
}

export interface KnowledgeAddFailure {
  name: string
  code: string
}

type Record_ = Record<string, unknown>

const record = (value: unknown): Record_ =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record_ : {}
const text = (value: unknown, fallback = ''): string => typeof value === 'string' ? value : fallback
const count = (value: unknown): number => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : []
const STATES = new Set<KnowledgeState>(['queued', 'indexing', 'ready', 'failed'])

export function parseCollection(value: unknown): KnowledgeCollection | null {
  const item = record(value)
  if (typeof item.id !== 'string' || !item.id) return null
  return {
    id: item.id,
    name: text(item.name),
    label: text(item.label, item.id),
    defaultOn: item.defaultOn === true,
    documents: count(item.documents),
    ready: count(item.ready),
    passages: count(item.passages),
  }
}

export function parseDocument(value: unknown): KnowledgeDocument | null {
  const item = record(value)
  if (typeof item.id !== 'string' || !item.id) return null
  const state = STATES.has(item.state as KnowledgeState) ? item.state as KnowledgeState : 'failed'
  return {
    id: item.id,
    title: text(item.title, item.id),
    collectionId: text(item.collectionId, 'default'),
    origin: text(item.origin),
    originPath: typeof item.originPath === 'string' ? item.originPath : null,
    state,
    progress: Math.min(1, count(item.progress)),
    pages: typeof item.pages === 'number' ? item.pages : null,
    passages: count(item.passages),
    error: typeof item.error === 'string' ? item.error : null,
    errorCode: typeof item.errorCode === 'string' ? item.errorCode : null,
    warnings: list(item.warnings).filter((warning): warning is string => typeof warning === 'string'),
    createdAt: text(item.createdAt),
  }
}

export function parseSnapshot(payload: unknown): KnowledgeSnapshot {
  const value = record(payload)
  const totals = record(value.totals)
  const limits = record(value.limits)
  return {
    enabled: value.enabled !== false,
    auto: value.auto !== false,
    collections: list(value.collections).map(parseCollection).filter((item): item is KnowledgeCollection => item !== null),
    documents: list(value.documents).map(parseDocument).filter((item): item is KnowledgeDocument => item !== null),
    synonyms: text(value.synonyms),
    builtinSynonymGroups: count(value.builtinSynonymGroups),
    totals: { documents: count(totals.documents), passages: count(totals.passages), storageBytes: count(totals.storageBytes) },
    suffixes: list(limits.suffixes).filter((suffix): suffix is string => typeof suffix === 'string'),
    maxFileBytes: count(limits.maxFileBytes),
  }
}

export function parseResults(payload: unknown): KnowledgeResult[] {
  return list(record(payload).results).flatMap((value) => {
    const item = record(value)
    if (typeof item.documentId !== 'string' || typeof item.passage !== 'string') return []
    return [{
      documentId: item.documentId,
      document: text(item.document, item.documentId),
      page: typeof item.page === 'number' ? item.page : null,
      section: typeof item.section === 'string' && item.section ? item.section : null,
      passage: item.passage,
      url: typeof item.url === 'string' ? item.url : null,
    }]
  })
}

export function parseSelection(payload: unknown): KnowledgeSelection {
  const value = record(payload)
  return {
    enabled: value.enabled !== false,
    collections: list(value.collections).filter((id): id is string => typeof id === 'string'),
    explicit: value.explicit === true,
    available: list(value.available).map(parseCollection).filter((item): item is KnowledgeCollection => item !== null),
  }
}

export function parseFailures(payload: unknown): KnowledgeAddFailure[] {
  return list(record(payload).failed).flatMap((value) => {
    const item = record(value)
    return typeof item.name === 'string' && typeof item.code === 'string' ? [{ name: item.name, code: item.code }] : []
  })
}

export const isIndexing = (document: KnowledgeDocument): boolean =>
  document.state === 'queued' || document.state === 'indexing'

/** A knowledge base's name for the window; the default one has none until the user names it. */
export function collectionLabel(collection: KnowledgeCollection, defaultName: string): string {
  return collection.id === 'default' && !collection.name ? defaultName : collection.label
}

/** Sent on the window after the Knowledge page changed something, so other views read again. */
export const KNOWLEDGE_CHANGED_EVENT = 'agent-workspace:knowledge-changed'

/** The code inside a sidecar error ("knowledge_name_taken" -> "name_taken"), or null. */
export function knowledgeErrorCode(error: unknown): string | null {
  const code = error && typeof error === 'object' && 'code' in error ? (error as { code?: unknown }).code : null
  if (typeof code !== 'string') return null
  return code.startsWith('knowledge_') ? code.slice('knowledge_'.length) : null
}

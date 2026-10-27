import type { JsonValue } from '../../../shared/protocol'
import type {
  BackgroundJobSummary,
  ChangeSetSummary,
  SessionPresentation,
  SessionSearchHit,
  TimelineItem,
  WorkbenchState,
} from './workbench-store'

export function objectValue(value: JsonValue | undefined): Record<string, JsonValue> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, JsonValue>)
    : null
}

export function stringValue(value: JsonValue | undefined): string | null {
  return typeof value === 'string' ? value : null
}

export function numberValue(value: JsonValue | undefined): number | undefined {
  return typeof value === 'number' ? value : undefined
}

export function roleValue(value: JsonValue | undefined): TimelineItem['role'] {
  return value === 'user' || value === 'assistant' || value === 'reasoning' || value === 'system'
    ? value
    : undefined
}

export function arrayObjects(value: JsonValue | undefined): Array<Record<string, JsonValue>> {
  return Array.isArray(value)
    ? value.map(objectValue).filter((item): item is Record<string, JsonValue> => item !== null)
    : []
}

export function modelRequestIdFromData(data: Record<string, JsonValue>): string | undefined {
  return stringValue(data.modelRequestId) ?? stringValue(data.model_request_id) ??
    stringValue(data.requestedEventId) ?? stringValue(data.requested_event_id) ?? undefined
}

export function isModelStream(item: TimelineItem): boolean {
  return item.type === 'model.output.delta' || item.type === 'model.completed'
}

function timelineCorrelation(item: TimelineItem): string | undefined {
  return item.correlationId ?? stringValue(item.data.correlationId) ??
    stringValue(item.data.turnId) ?? undefined
}

function isInterruptedAssistant(item: TimelineItem): boolean {
  const metadata = objectValue(item.data.providerMetadata) ?? objectValue(item.data.provider_metadata)
  return item.type === 'message.created' && (item.role === 'assistant' || item.role === 'reasoning') &&
    metadata?.['agent_workspace.stream_interrupted'] === true
}

export function isStreamReplacedBy(stream: TimelineItem, canonical: TimelineItem): boolean {
  if (!isModelStream(stream) || canonical.type !== 'message.created' ||
    canonical.role !== 'assistant' || isInterruptedAssistant(canonical)) return false
  const streamRequest = modelRequestIdFromData(stream.data)
  if (!streamRequest) return false
  const canonicalRequest = modelRequestIdFromData(canonical.data)
  if (streamRequest === canonicalRequest) {
    return stream.stream !== 'reasoning' || Boolean(stringValue(canonical.data.reasoning))
  }
  const superseded = canonical.data.supersededModelRequestIds ?? canonical.data.superseded_model_request_ids
  return stream.stream !== 'reasoning' && Array.isArray(superseded) && superseded.includes(streamRequest)
}

function withModelRequestScopes(items: TimelineItem[]): TimelineItem[] {
  // Older snapshots can lack request IDs. Completion markers separate their
  // calls; a canonical assistant seals only the immediately preceding call.
  const scopes = new Map<string, { id: string; completed: boolean }>()
  return items.map((item) => {
    const key = timelineCorrelation(item) ?? 'uncorrelated'
    const canonical = item.type === 'message.created' &&
      (item.role === 'assistant' || item.role === 'reasoning')
    if (item.type === 'model.requested') {
      scopes.set(key, { id: modelRequestIdFromData(item.data) ?? item.id, completed: false })
      return item
    }
    if (!isModelStream(item) && !canonical) {
      if (item.type === 'message.created' && item.role === 'user') scopes.delete(key)
      return item
    }
    let requestId = modelRequestIdFromData(item.data)
    const prior = scopes.get(key)
    if (!requestId) {
      requestId = item.type === 'model.output.delta' && (!prior || prior.completed)
        ? `legacy-${key}-${item.id}`
        : prior?.id
    }
    if (!requestId) return item
    const completed = canonical || item.type === 'model.completed' ||
      (!item.open && (item.data.finishReason !== undefined || item.data.finish_reason !== undefined))
    scopes.set(key, { id: requestId, completed })
    return item.data.modelRequestId === requestId
      ? item
      : { ...item, data: { ...item.data, modelRequestId: requestId } }
  })
}

export function filterCanonicalStreams(items: TimelineItem[]): TimelineItem[] {
  const scoped = withModelRequestScopes(items)
  const covered = new Map<string, { text: boolean; reasoning: boolean }>()
  for (const item of scoped) {
    if (item.type !== 'message.created' || isInterruptedAssistant(item) ||
      (item.role !== 'assistant' && item.role !== 'reasoning')) continue
    const requestId = modelRequestIdFromData(item.data)
    if (requestId) {
      const prior = covered.get(requestId)
      covered.set(requestId, {
        text: prior?.text === true || item.role === 'assistant',
        reasoning: prior?.reasoning === true ||
          (item.role === 'reasoning' && Boolean(item.text)) || Boolean(stringValue(item.data.reasoning)),
      })
    }
    if (item.role !== 'assistant') continue
    const superseded = item.data.supersededModelRequestIds ?? item.data.superseded_model_request_ids
    if (Array.isArray(superseded)) {
      for (const id of superseded) {
        if (typeof id === 'string') covered.set(id, { text: true, reasoning: covered.get(id)?.reasoning === true })
      }
    }
  }
  return scoped.filter((item) => {
    if (isInterruptedAssistant(item)) return false
    if (!isModelStream(item)) return true
    const requestId = modelRequestIdFromData(item.data)
    const replacement = requestId ? covered.get(requestId) : undefined
    return item.stream === 'reasoning' ? !replacement?.reasoning : !replacement?.text
  })
}

function coalesceSnapshotStreams(items: TimelineItem[]): TimelineItem[] {
  const rows: TimelineItem[] = []
  const groups = new Map<string, { row: TimelineItem; texts: string[] }>()
  for (const item of items) {
    const requestId = modelRequestIdFromData(item.data)
    if (item.type !== 'model.output.delta' || !requestId) {
      rows.push(item)
      continue
    }
    const recoveryAttempt = numberValue(item.data.recoveryAttempt) ?? 0
    const id = `stream-${requestId}-${item.stream}-${recoveryAttempt}`
    const group = groups.get(id)
    const chunk = item.domainSequence !== undefined
      ? { sequence: item.domainSequence, text: item.text } : undefined
    if (group) {
      group.texts.push(item.text)
      group.row.data = { ...group.row.data, ...item.data }
      if (group.row.streamChunks && chunk) group.row.streamChunks.push(chunk)
      else group.row.streamChunks = undefined
    } else {
      const row = { ...item, id, streamChunks: chunk ? [chunk] : undefined }
      groups.set(id, { row, texts: [item.text] })
      rows.push(row)
    }
  }
  for (const { row, texts } of groups.values()) row.text = texts.join('')
  return rows
}

export function timelineFromSnapshot(value: JsonValue | undefined): TimelineItem[] {
  const items = arrayObjects(value).flatMap((item, index): TimelineItem[] => {
    const data = objectValue(item.data) ?? {}
    const type = stringValue(item.type) ?? 'event'
    const attemptId = stringValue(data.attemptId) ?? stringValue(data.attempt_id)
    const entry: TimelineItem = {
      id: type.startsWith('tool.') && attemptId ? `tool-${attemptId}` : stringValue(item.eventId) ?? `snapshot-${index}`,
      type,
      text: stringValue(data.text) ?? stringValue(data.content) ?? '',
      stream: stringValue(data.kind) ?? 'text',
      open: false,
      domainSequence: numberValue(item.domainSequence),
      correlationId: stringValue(item.correlationId) ?? stringValue(data.correlationId) ?? undefined,
      role: roleValue(data.role),
      data: type.startsWith('tool.') && attemptId ? { ...data, attemptId } : data,
    }
    const reasoning = entry.type === 'message.created' && entry.role === 'assistant' && !isInterruptedAssistant(entry)
      ? stringValue(data.reasoning) : null
    return reasoning ? [
      {
        ...entry,
        id: `${entry.id}-reasoning`,
        text: reasoning,
        stream: 'reasoning',
        role: 'reasoning',
        data: { ...data, text: reasoning, kind: 'reasoning', role: 'reasoning' },
      },
      entry,
    ] : [entry]
  })
  return coalesceSnapshotStreams(canonicalizeTimeline(items))
}

export function canonicalizeTimeline(items: TimelineItem[]): TimelineItem[] {
  const byId = new Map<string, TimelineItem>()
  for (const item of items) {
    const prior = byId.get(item.id)
    if (!prior) {
      byId.set(item.id, item)
      continue
    }
    const newer = (item.domainSequence ?? -1) >= (prior.domainSequence ?? -1) ? item : prior
    let streamChunks = newer.streamChunks
    let text = newer.text
    if (prior.type === 'model.output.delta' && item.type === 'model.output.delta' &&
      prior.streamChunks && item.streamChunks) {
      const bySequence = new Map(prior.streamChunks.map((chunk) => [chunk.sequence, chunk]))
      for (const chunk of item.streamChunks) {
        const previous = bySequence.get(chunk.sequence)
        if (!previous || chunk.text.length >= previous.text.length) bySequence.set(chunk.sequence, chunk)
      }
      streamChunks = [...bySequence.values()].sort((left, right) => left.sequence - right.sequence)
      text = streamChunks.map((chunk) => chunk.text).join('')
    }
    byId.set(item.id, {
      ...prior,
      ...newer,
      text,
      streamChunks,
      domainSequence: Math.min(
        prior.domainSequence ?? Number.MAX_SAFE_INTEGER,
        item.domainSequence ?? Number.MAX_SAFE_INTEGER,
      ),
      data: { ...prior.data, ...item.data },
    })
  }
  const sequenced: TimelineItem[] = []
  const unsequenced: TimelineItem[] = []
  for (const item of byId.values()) {
    if (item.domainSequence === undefined) unsequenced.push(item)
    else sequenced.push(item)
  }
  const ordered = [
    ...sequenced.sort((left, right) => (left.domainSequence ?? 0) - (right.domainSequence ?? 0)),
    ...unsequenced,
  ]
  return filterCanonicalStreams(ordered)
}

export function mergeTimeline(existing: TimelineItem[], incoming: TimelineItem[]): TimelineItem[] {
  return canonicalizeTimeline([...existing, ...incoming])
}

export function historyFromPayload(value: JsonValue | undefined): WorkbenchState['history'] {
  const history = objectValue(value)
  return {
    hasMore: history?.hasMore === true,
    nextCursor: stringValue(history?.nextCursor) ?? null,
    cutoff: numberValue(history?.cutoff) ?? 0,
  }
}

export function presentationsFromPayload(value: JsonValue | undefined): Record<string, SessionPresentation> {
  const source = objectValue(value)
  const records: Record<string, SessionPresentation> = {}
  if (!source) return records
  for (const [key, raw] of Object.entries(source)) {
    const item = objectValue(raw)
    const sessionId = stringValue(item?.sessionId)
    if (!item || !sessionId || typeof item.pinned !== 'boolean' || typeof item.archived !== 'boolean') continue
    records[key] = {
      sessionId,
      alias: stringValue(item.alias),
      pinned: item.pinned,
      archived: item.archived,
      version: numberValue(item.version) ?? 1,
    }
  }
  return records
}

export function searchHits(value: JsonValue | undefined): SessionSearchHit[] {
  return arrayObjects(value).flatMap((item) => {
    const id = stringValue(item.id)
    const title = stringValue(item.title)
    if (!id || title === null) return []
    return [{
      id,
      title,
      mode: stringValue(item.mode) ?? 'coding',
      updatedAt: stringValue(item.updatedAt) ?? '',
      snippet: stringValue(item.snippet) ?? '',
      documentKind: stringValue(item.documentKind) ?? 'title',
    }]
  })
}

export function changesFromPayload(value: JsonValue | undefined): ChangeSetSummary[] {
  return arrayObjects(value).flatMap((item) => {
    const changesetId = stringValue(item.changesetId)
    if (!changesetId) return []
    return [{
      changesetId,
      createdAt: stringValue(item.createdAt) ?? '',
      changeCount: numberValue(item.changeCount) ?? 0,
      supportedCount: numberValue(item.supportedCount) ?? 0,
      appliedCount: numberValue(item.appliedCount) ?? 0,
      rejectedCount: numberValue(item.rejectedCount) ?? 0,
      state: stringValue(item.state) ?? 'unknown',
    }]
  })
}

export function jobsFromPayload(value: JsonValue | undefined): BackgroundJobSummary[] {
  return arrayObjects(value).flatMap((item) => {
    const jobId = stringValue(item.jobId)
    if (!jobId) return []
    return [{
      jobId,
      sessionId: stringValue(item.sessionId) ?? undefined,
      label: stringValue(item.label) ?? undefined,
      state: stringValue(item.state) ?? 'unknown',
      createdAt: stringValue(item.createdAt) ?? undefined,
      updatedAt: stringValue(item.updatedAt) ?? undefined,
      terminalReason: stringValue(item.terminalReason),
    }]
  })
}

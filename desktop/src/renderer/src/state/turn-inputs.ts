import type { JsonValue } from '../../../shared/protocol'
import { mergeTimeline, stringValue, timelineFromSnapshot } from './projection-parsers'
import type { TimelineItem } from './workbench-store'

function turnInputId(item: TimelineItem): string | null {
  return item.role === 'user' || item.type === 'turn.input.received'
    ? stringValue(item.data.inputId) ?? stringValue(item.data.input_id)
      ?? (item.type === 'turn.input.received' ? stringValue(item.data.eventId) ?? item.id : null)
    : null
}

function normalizeTurnInputMessage(item: TimelineItem): TimelineItem {
  const inputId = turnInputId(item)
  if (!inputId) return item
  const received = item.type === 'turn.input.received'
  return { ...item, id: `input-${inputId}`, type: 'message.created', role: 'user', stream: 'text', open: false,
    text: received ? stringValue(item.data.prompt) ?? item.text : item.text,
    data: { ...item.data, inputId, inputState: received || item.data.inputState === 'pending' ? 'pending' : 'applied' } }
}

/** Receipts and applied user messages represent one instruction, even across history pages. */
export function mergeTurnInputTimeline(existing: TimelineItem[], incoming: TimelineItem[]): TimelineItem[] {
  const items = [...existing, ...incoming].map(normalizeTurnInputMessage)
  const applied = new Set(items.filter((item) => item.data.inputState === 'applied').map(turnInputId))
  return mergeTimeline([], items).map((item) => applied.has(turnInputId(item)) && turnInputId(item)
    ? { ...item, data: { ...item.data, inputState: 'applied' } }
    : item)
}

export function turnInputTimelineFromSnapshot(value: JsonValue | undefined): TimelineItem[] {
  return mergeTurnInputTimeline([], timelineFromSnapshot(value))
}

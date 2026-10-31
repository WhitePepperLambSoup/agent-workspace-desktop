import type { MessageKey } from '../../i18n/messages'
import type { ActorLook } from '../cast'

/** Someone from a conversation's team at work in the place: an expert, shown with their look. */
export interface PlaceVisitorView {
  id: string
  name: string
  stateLabel: string
  look: ActorLook
  pick: string
}

/** What a place's scene is given: its model, the window's words, the agent's name, and visitors. */
export interface PlaceInput<M> {
  model: M
  t: (key: MessageKey, values?: Record<string, string | number>) => string
  lead: string
  visitors?: readonly PlaceVisitorView[]
}
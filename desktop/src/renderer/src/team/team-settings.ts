import { useSyncExternalStore } from 'react'

import { isLibraryExpert } from './catalog'

/** delegate_tasks hands out at most four tasks at a time. */
export const MAX_TEAM = 4
export const MAX_NAME = 24
export const MAX_BRIEF = 1200

export interface CustomExpert {
  id: string
  name: string
  brief: string
}

export interface TeamSettings {
  /** 'auto': the lead picks the experts for each request from the library; 'fixed': members. */
  mode: 'auto' | 'fixed'
  /** Who works on a fixed team, in order: library ids and custom ids. */
  members: string[]
  custom: CustomExpert[]
  /** A second round where the experts review each other's findings. */
  review: boolean
}

/** What turn.start sends for a fixed team: library experts by id and name, custom ones with their brief. */
export interface TeamMember {
  id: string
  name: string
  brief?: string
}

export const DEFAULT_TEAM: TeamSettings = Object.freeze({ mode: 'auto', members: ['researcher', 'analyst', 'critic'], custom: [], review: true }) as TeamSettings

const STORAGE_KEY = 'agent-workspace.team.v1'
const CHANGED = 'agent-workspace:team-settings'
const ID = /^[a-z0-9][a-z0-9_-]{0,31}$/

function validCustom(value: unknown): value is CustomExpert {
  if (!value || typeof value !== 'object') return false
  const { id, name, brief } = value as Record<string, unknown>
  return typeof id === 'string' && ID.test(id) && !isLibraryExpert(id)
    && typeof name === 'string' && name.trim().length > 0 && name.trim().length <= MAX_NAME
    && typeof brief === 'string' && brief.trim().length > 0 && brief.length <= MAX_BRIEF
}

export function normalizeTeam(value: unknown): TeamSettings {
  if (!value || typeof value !== 'object') return DEFAULT_TEAM
  const raw = value as Record<string, unknown>
  const custom = Array.isArray(raw.custom) ? raw.custom.filter(validCustom).slice(0, 12) : []
  const customIds = new Set(custom.map((item) => item.id))
  const members = Array.isArray(raw.members)
    ? [...new Set(raw.members.filter((id): id is string => typeof id === 'string' && (isLibraryExpert(id) || customIds.has(id))))].slice(0, MAX_TEAM)
    : DEFAULT_TEAM.members
  // Settings saved before teams could be picked automatically chose their members by hand.
  const mode = raw.mode === 'fixed' || (raw.mode === undefined && Array.isArray(raw.members)) ? 'fixed' : 'auto'
  return { mode, members: members.length > 0 ? members : DEFAULT_TEAM.members, custom, review: raw.review !== false }
}

let cached: { raw: string | null; value: TeamSettings } | null = null

export function readTeamSettings(): TeamSettings {
  let raw: string | null = null
  try { raw = window.localStorage.getItem(STORAGE_KEY) } catch { raw = null }
  if (cached && cached.raw === raw) return cached.value
  let value = DEFAULT_TEAM
  try { value = raw ? normalizeTeam(JSON.parse(raw)) : DEFAULT_TEAM } catch { value = DEFAULT_TEAM }
  cached = { raw, value }
  return value
}

export function writeTeamSettings(next: TeamSettings): void {
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeTeam(next))) } catch { /* kept for this window only */ }
  cached = null
  window.dispatchEvent(new Event(CHANGED))
}

function subscribe(listener: () => void): () => void {
  window.addEventListener(CHANGED, listener)
  window.addEventListener('storage', listener)
  return () => {
    window.removeEventListener(CHANGED, listener)
    window.removeEventListener('storage', listener)
  }
}

export function useTeamSettings(): TeamSettings {
  return useSyncExternalStore(subscribe, readTeamSettings, readTeamSettings)
}

/** A fixed team as turn.start sends it; ``nameOf`` gives library experts their name in the user's language. */
export function teamMembers(settings: TeamSettings, nameOf: (id: string) => string): TeamMember[] {
  const names = new Set<string>()
  return settings.members.flatMap((id): TeamMember[] => {
    const custom = isLibraryExpert(id) ? null : settings.custom.find((item) => item.id === id)
    const member = isLibraryExpert(id) ? { id, name: nameOf(id) } : custom ? { id, name: custom.name.trim(), brief: custom.brief.trim() } : null
    // The sidecar tells experts apart by name too: a second one with the same name stays home.
    if (!member || names.has(member.name.toLocaleLowerCase())) return []
    names.add(member.name.toLocaleLowerCase())
    return [member]
  })
}

/** The team field of turn.start: 'auto', or the fixed members. */
export function teamPayload(settings: TeamSettings, nameOf: (id: string) => string): 'auto' | TeamMember[] {
  return settings.mode === 'auto' ? 'auto' : teamMembers(settings, nameOf)
}

/** A free id for a new custom expert. */
export function customExpertId(settings: TeamSettings): string {
  const used = new Set(settings.custom.map((item) => item.id))
  let index = settings.custom.length + 1
  while (used.has(`custom-${index}`)) index += 1
  return `custom-${index}`
}

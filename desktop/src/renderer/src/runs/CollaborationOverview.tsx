import { CheckCircle2, CircleDot, FileText, GitBranch, Users } from 'lucide-react'

import { useText } from '../i18n/I18nProvider'
import type { TimelineItem } from '../state/workbench-store'

export interface CollaborationMemberView {
  id: string
  role: string
  routeId: string
  model: string
  phase: string
  state: string
  attempt: number
  contribution: string
  truncated: boolean
}

export interface CollaborationView {
  id: string
  title: string
  goal: string
  state: string
  phase: string
  documentRevision: number
  detail: string
  members: CollaborationMemberView[]
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function number(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function memberFromDocument(value: unknown, routes: Record<string, unknown>): CollaborationMemberView | null {
  const item = object(value)
  const id = text(item.id)
  if (!id) return null
  const routeId = text(item.route_id, text(item.routeId, 'unknown'))
  return {
    id,
    role: text(item.role, 'member'),
    routeId,
    model: text(item.model, text(routes[routeId], 'unknown')),
    phase: 'pending',
    state: 'pending',
    attempt: 0,
    contribution: '',
    truncated: false,
  }
}

export function collaborationViewsFromTimeline(timeline: readonly TimelineItem[]): CollaborationView[] {
  const views = new Map<string, CollaborationView>()
  const ensure = (id: string): CollaborationView => {
    const existing = views.get(id)
    if (existing) return existing
    const created: CollaborationView = {
      id,
      title: id,
      goal: '',
      state: 'running',
      phase: 'starting',
      documentRevision: 0,
      detail: '',
      members: [],
    }
    views.set(id, created)
    return created
  }

  for (const item of timeline) {
    if (!item.type.startsWith('collaboration.')) continue
    const data = item.data as Record<string, unknown>
    const id = text(data.collaboration_id, text(data.collaborationId))
    if (!id) continue
    const view = ensure(id)
    if (item.type === 'collaboration.started') {
      const routes = object(data.routes)
      view.title = text(data.title, view.title)
      view.goal = text(data.goal, view.goal)
      view.state = 'running'
      view.phase = 'starting'
      view.members = Array.isArray(data.members)
        ? data.members.flatMap((member) => {
            const parsed = memberFromDocument(member, routes)
            return parsed ? [parsed] : []
          })
        : view.members
      continue
    }
    if (item.type === 'collaboration.document.updated') {
      view.documentRevision = Math.max(view.documentRevision, number(data.revision))
      continue
    }
    if (item.type === 'collaboration.running') {
      view.state = 'running'
      continue
    }
    if (item.type === 'collaboration.completed' || item.type === 'collaboration.failed' || item.type === 'collaboration.cancelled' || item.type === 'collaboration.blocked') {
      view.state = item.type.slice('collaboration.'.length)
      view.detail = text(data.reason, text(data.detail, view.detail))
      continue
    }
    if (!item.type.startsWith('collaboration.member.')) continue
    const memberId = text(data.member_id, text(data.memberId))
    if (!memberId) continue
    let member = view.members.find((candidate) => candidate.id === memberId)
    if (!member) {
      member = {
        id: memberId,
        role: text(data.role, 'member'),
        routeId: text(data.route_id, 'unknown'),
        model: text(data.model, 'unknown'),
        phase: 'starting',
        state: 'pending',
        attempt: 0,
        contribution: '',
        truncated: false,
      }
      view.members.push(member)
    }
    member.role = text(data.role, member.role)
    member.routeId = text(data.route_id, member.routeId)
    member.model = text(data.model, member.model)
    member.phase = text(data.phase, member.phase)
    member.attempt = number(data.attempt, member.attempt)
    if (item.type === 'collaboration.member.started' || item.type === 'collaboration.member.running' || item.type === 'collaboration.member.resumed') {
      member.state = 'running'
    } else if (item.type === 'collaboration.member.completed') {
      member.state = 'completed'
      member.contribution = text(data.content, item.text)
      member.truncated = data.truncated === true
    } else if (item.type === 'collaboration.member.failed') {
      member.state = 'failed'
      member.contribution = text(data.error, text(data.detail, item.text))
    }
  }
  return [...views.values()].filter((view) => view.members.length > 0 || view.goal.length > 0)
}

export function CollaborationOverview({ timeline }: { timeline: readonly TimelineItem[] }) {
  const tx = useText()
  const collaborations = collaborationViewsFromTimeline(timeline)
  if (collaborations.length === 0) return null

  return (
    <section className="collaboration-overview glass-surface" data-testid="collaboration-overview" aria-label={tx('Collaboration overview')}>
      <header className="collaboration-overview-header">
        <div>
          <p className="section-kicker"><Users size={13} />{tx('Collaboration')}</p>
          <h2>{tx('Collaboration overview')}</h2>
          <p>{tx('Follow member roles, models, phases and shared evidence in one place.')}</p>
        </div>
        <span className="collaboration-count"><GitBranch size={13} />{collaborations.length}</span>
      </header>
      <div className="collaboration-overview-list">
        {collaborations.map((collaboration) => (
          <article key={collaboration.id} className="collaboration-card">
            <div className="collaboration-card-heading">
              <div>
                <strong>{collaboration.title}</strong>
                {collaboration.goal ? <p>{collaboration.goal}</p> : null}
              </div>
              <span className={`collaboration-state state-${collaboration.state}`}><CircleDot size={12} />{collaboration.state}</span>
            </div>
            <div className="collaboration-card-meta">
              <span>{tx('Phase')}: {collaboration.phase}</span>
              <span><FileText size={12} />{tx('Shared document revision')} {collaboration.documentRevision}</span>
              <span>{collaboration.members.length} {tx('members')}</span>
            </div>
            <div className="collaboration-member-list">
              {collaboration.members.map((member) => (
                <div key={member.id} className="collaboration-member-row">
                  <span className={`collaboration-member-state state-${member.state}`} aria-label={member.state}>
                    {member.state === 'completed' ? <CheckCircle2 size={13} /> : <CircleDot size={13} />}
                  </span>
                  <strong>{member.id}</strong>
                  <span className="collaboration-member-role">{member.role}</span>
                  <span>{member.model}</span>
                  <span>{member.phase}</span>
                  <span className="collaboration-member-status">{member.state}</span>
                  {member.contribution ? <p title={member.contribution}>{member.contribution}{member.truncated ? '…' : ''}</p> : null}
                </div>
              ))}
            </div>
            {collaboration.detail ? <p className="collaboration-detail">{collaboration.detail}</p> : null}
          </article>
        ))}
      </div>
    </section>
  )
}

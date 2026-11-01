import type { JsonValue } from '../../../shared/protocol'
import type { WorkbenchState } from '../state/workbench-types'
import type { ApprovalItem } from './types'

function fact(value: unknown, fallback: string): string {
  return typeof value === 'string' && value ? value : fallback
}

function approvalPlan(value: JsonValue | undefined, total: JsonValue | undefined): Pick<ApprovalItem, 'plan' | 'planTotal'> {
  if (!Array.isArray(value)) return {}
  const plan = value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return []
    const { action, path, to } = item as Record<string, JsonValue>
    if (typeof action !== 'string' || typeof path !== 'string') return []
    return [typeof to === 'string' ? { action, path, to } : { action, path }]
  })
  return plan.length ? { plan, planTotal: typeof total === 'number' ? total : plan.length } : {}
}

/**
 * The approvals waiting for a conversation, as the approval cards show them: by default the
 * conversation on screen (and those of no conversation), or the one named.
 */
export function approvalItems(state: WorkbenchState, tx: (text: string) => string, sessionId?: string): ApprovalItem[] {
  return Object.entries(state.approvals)
    .filter(([, approval]) => sessionId === undefined
      ? approval.sessionId == null || approval.sessionId === state.selectedSession?.id
      : approval.sessionId === sessionId)
    .map(([requestId, approval]) => ({
      requestId,
      title: fact(approval.toolName ?? approval.tool ?? approval.name, tx('Approval required')),
      detail: fact(approval.summary ?? approval.reason, tx('Review the requested action')),
      supportsSessionScope: approval.supportsSessionScope === true,
      ...(approval.kind === 'provider_egress' && typeof approval.endpoint === 'string' ? { endpoint: approval.endpoint } : {}),
      ...(typeof approval.subagent === 'string' && approval.subagent ? { subagent: approval.subagent } : {}),
      ...approvalPlan(approval.plan, approval.planTotal),
    }))
}

import type { MessageKey } from '../i18n/messages'

export type FailureKind =
  | 'cost' | 'tokens' | 'steps' | 'time' | 'auth' | 'billing' | 'rateLimit'
  | 'network' | 'provider' | 'egress' | 'context' | 'other'

const TOKEN_BUDGETS = ['task token limit reached', 'input token budget exhausted', 'output token budget exhausted']

/**
 * The reason a turn stopped, from the runner's error type and its sanitized message.
 * Provider errors end in "(status=NNN)"; budget errors name the exhausted budget.
 */
export function failureKind(errorType?: string, message = ''): FailureKind {
  const text = message.toLowerCase()
  if (errorType === 'BudgetExceededError') {
    if (text.includes('monetary cost budget')) return 'cost'
    if (TOKEN_BUDGETS.some((phrase) => text.includes(phrase))) return 'tokens'
    return 'steps'
  }
  if (errorType === 'TimeoutError') return 'time'
  if (errorType === 'ProviderEgressDeniedError') return 'egress'
  if (errorType?.startsWith('Provider')) {
    const status = Number(/status=(\d{3})/.exec(text)?.[1] ?? NaN)
    if (status === 401 || status === 403) return 'auth'
    if (status === 402 || /balance|quota|billing/.test(text)) return 'billing'
    if (status === 429) return 'rateLimit'
    if (/context|too long|maximum.*tokens/.test(text)) return 'context'
    if (errorType === 'ProviderTransportError') return 'network'
    return 'provider'
  }
  return 'other'
}

export const FAILURE_KEYS: Record<FailureKind, MessageKey> = {
  cost: 'notice.failed.cost',
  tokens: 'notice.failed.tokens',
  steps: 'notice.failed.steps',
  time: 'notice.failed.time',
  auth: 'notice.failed.auth',
  billing: 'notice.failed.billing',
  rateLimit: 'notice.failed.rateLimit',
  network: 'notice.failed.network',
  provider: 'notice.failed.provider',
  egress: 'notice.failed.egress',
  context: 'notice.failed.context',
  other: 'notice.failed.other',
}

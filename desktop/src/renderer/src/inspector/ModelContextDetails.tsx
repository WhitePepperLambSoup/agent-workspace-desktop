import { useOptionalI18n } from '../i18n/I18nProvider'

export type ContextImageStatus = 'included' | 'summarized' | 'deduplicated' | 'excluded'

export interface ContextImageDecision {
  id: string
  messageIndex: number
  imageIndex: number
  digest: string
  mediaType: string
  bytes: number
  status: ContextImageStatus
  reason?: string | null
  estimatedTokens: number
}

export interface ManifestItem {
  id: string
  kind: string
  label: string
  bytes: number
  estimatedTokens: number
  sha256: string
}

export interface ModelContextManifest {
  source: string
  model: string
  requestId: string
  createdAt: string
  messageCount: number
  toolCount: number
  logicalBytes: number
  compactedMessages: number
  omittedItems: number
  items: ManifestItem[]
  sha256?: string
  contextLimitBytes?: number | null
  requestBudgetBytes?: number | null
  maxOutputTokens?: number | null
  estimatedTokens?: number
  imageDecisions?: ContextImageDecision[]
  summary?: string | null
}

export interface ModelUsage {
  inputTokens?: number | null
  outputTokens?: number | null
  cachedTokens?: number | null
  estimated?: boolean
  requestId?: string | null
  createdAt?: string | null
}

interface NormalizedUsage {
  inputTokens: number | null
  outputTokens: number | null
  cachedTokens: number | null
  estimated: boolean
  incomplete: boolean
}

const isNonNegativeInteger = (value: unknown): value is number => (
  typeof value === 'number' && Number.isInteger(value) && Number.isFinite(value) && value >= 0
)
const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0
const isOptionalNonNegativeInteger = (value: unknown): value is number | null | undefined => (
  value == null || isNonNegativeInteger(value)
)
const isSha256 = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value)
const isValidTimestamp = (value: unknown): value is string => (
  isNonEmptyString(value) && !Number.isNaN(new Date(value).getTime())
)

const isContextImageDecision = (value: unknown): value is ContextImageDecision => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const item = value as Partial<ContextImageDecision>
  return isNonEmptyString(item.id) && isNonNegativeInteger(item.messageIndex) &&
    isNonNegativeInteger(item.imageIndex) && isSha256(item.digest) && isNonEmptyString(item.mediaType) &&
    isNonNegativeInteger(item.bytes) && isNonNegativeInteger(item.estimatedTokens) &&
    (item.status === 'included' || item.status === 'summarized' || item.status === 'deduplicated' || item.status === 'excluded') &&
    (item.reason === undefined || item.reason === null || typeof item.reason === 'string')
}

const isManifestItem = (value: unknown): value is ManifestItem => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const item = value as Partial<ManifestItem>
  return isNonEmptyString(item.id) && isNonEmptyString(item.kind) && isNonEmptyString(item.label) &&
    isNonNegativeInteger(item.bytes) && isNonNegativeInteger(item.estimatedTokens) && isSha256(item.sha256)
}

const isManifest = (value: unknown): value is ModelContextManifest => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const manifest = value as Partial<ModelContextManifest>
  if (!isNonEmptyString(manifest.source) || !isNonEmptyString(manifest.model) ||
    !isNonEmptyString(manifest.requestId) || !isValidTimestamp(manifest.createdAt) ||
    !Array.isArray(manifest.items)) return false
  if (manifest.sha256 !== undefined && !isSha256(manifest.sha256)) return false
  if (manifest.estimatedTokens !== undefined && !isNonNegativeInteger(manifest.estimatedTokens)) return false
  if (manifest.summary !== undefined && manifest.summary !== null && typeof manifest.summary !== 'string') return false
  if (manifest.imageDecisions !== undefined && (!Array.isArray(manifest.imageDecisions) || !manifest.imageDecisions.every(isContextImageDecision))) return false
  if (!isOptionalNonNegativeInteger(manifest.contextLimitBytes) ||
    !isOptionalNonNegativeInteger(manifest.requestBudgetBytes) ||
    !isOptionalNonNegativeInteger(manifest.maxOutputTokens)) return false
  return [manifest.messageCount, manifest.toolCount, manifest.logicalBytes,
    manifest.compactedMessages, manifest.omittedItems].every(isNonNegativeInteger) &&
    manifest.items.every(isManifestItem)
}

function normalizeUsage(value: unknown): NormalizedUsage | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const usage = value as Partial<ModelUsage>
  const fields = [usage.inputTokens, usage.outputTokens, usage.cachedTokens]
  const hasInvalidValue = fields.some((field) => (
    field !== undefined && field !== null && !isNonNegativeInteger(field)
  ))
  if (hasInvalidValue) return null
  const inputTokens = isNonNegativeInteger(usage.inputTokens) ? usage.inputTokens : null
  const outputTokens = isNonNegativeInteger(usage.outputTokens) ? usage.outputTokens : null
  const cachedTokens = isNonNegativeInteger(usage.cachedTokens) ? usage.cachedTokens : null
  const hasUsageField = fields.some((field) => field !== undefined)
  if (!hasUsageField) return null
  return {
    inputTokens,
    outputTokens,
    cachedTokens,
    estimated: typeof usage.estimated === 'boolean' ? usage.estimated : true,
    incomplete: inputTokens === null || outputTokens === null || cachedTokens === null,
  }
}

function formatCount(value: number | null, locale: string): string {
  return value === null ? '—' : value.toLocaleString(locale)
}

export function ModelContextDetails({
  manifest,
  usage,
  onExcludeAttachment,
  excludingDigest,
}: {
  manifest?: ModelContextManifest | null
  usage?: ModelUsage | null
  onExcludeAttachment?: (digest: string) => void
  excludingDigest?: string | null
}) {
  const { locale, t } = useOptionalI18n()
  const valid = isManifest(manifest)
  const normalizedUsage = normalizeUsage(usage)
  return <section className="inspector-section model-context-details">
    <h3>{t('context.requestTitle')}</h3>
    {!valid ? <p role={manifest ? 'alert' : undefined}>{manifest ? t('context.invalidMetadata') : t('context.noRequest')}</p> : <>
      <dl className="fact-list">
        <div><dt>{t('inspector.model')}</dt><dd>{manifest.model}</dd></div>
        <div><dt>{t('context.requestId')}</dt><dd><code title={manifest.requestId}>{manifest.requestId.slice(0, 16)}</code></dd></div>
        <div><dt>{t('context.capturedAt')}</dt><dd>{new Date(manifest.createdAt).toLocaleString(locale)}</dd></div>
        {manifest.contextLimitBytes != null ? <div><dt>{t('context.contextLimit')}</dt><dd>{manifest.contextLimitBytes.toLocaleString(locale)} B</dd></div> : null}
        {manifest.maxOutputTokens != null ? <div><dt>{t('context.maxOutput')}</dt><dd>{manifest.maxOutputTokens.toLocaleString(locale)}</dd></div> : null}
        {manifest.requestBudgetBytes != null ? <div><dt>{t('context.requestBudget')}</dt><dd>{manifest.requestBudgetBytes.toLocaleString(locale)} B</dd></div> : null}
        <div><dt>{t('context.messages')}</dt><dd>{manifest.messageCount}</dd></div>
        <div><dt>{t('context.tools')}</dt><dd>{manifest.toolCount}</dd></div>
        <div><dt>{t('context.logicalBytes')}</dt><dd>{manifest.logicalBytes.toLocaleString(locale)}</dd></div>
        <div><dt>{t('context.compacted')}</dt><dd>{manifest.compactedMessages}</dd></div>
      </dl>
      <small>{t('context.estimateNote')}</small>
      {manifest.summary ? <p className="context-explanation" role="status">{manifest.summary}</p> : null}
      {manifest.imageDecisions && manifest.imageDecisions.length > 0 ? (
        <section className="context-image-decisions" aria-label={t('context.imageDecisions')}>
          <h4>{t('context.imageDecisions')}</h4>
          <ul className="context-manifest-items">
            {manifest.imageDecisions.map((image) => (
              <li key={image.id}>
                <strong>{image.mediaType} · {image.bytes.toLocaleString(locale)} B</strong>
                <span>{t(`context.imageStatus.${image.status}` as Parameters<typeof t>[0])}</span>
                {image.reason === 'same_digest_in_previous_message' ? (
                  <small>{t('context.imageDuplicateReason')}</small>
                ) : image.reason ? <small>{image.reason}</small> : null}
                {image.status === 'included' && onExcludeAttachment ? (
                  <button type="button" className="secondary-button" disabled={excludingDigest === image.digest} aria-busy={excludingDigest === image.digest || undefined} onClick={() => onExcludeAttachment(image.digest)}>
                    {t('context.excludeImageRetry')}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <details>
        <summary>{t('context.items')} ({manifest.items.length})</summary>
        <ul className="context-manifest-items">{manifest.items.map((item, index) => <li key={`${item.id}-${index}`}>
          <strong>{item.label}</strong>
          <span>{item.bytes.toLocaleString(locale)} B · ~{item.estimatedTokens.toLocaleString(locale)} tokens</span>
          <code title={item.sha256}>{item.sha256.slice(0, 12)}</code>
        </li>)}</ul>
        {manifest.omittedItems > 0 ? <small>{t('context.omitted', { count: manifest.omittedItems })}</small> : null}
      </details>
    </>}
    {normalizedUsage ? <div className="context-usage">
      <h4>{t(normalizedUsage.estimated ? 'context.estimatedUsage' : 'context.reportedUsage')}</h4>
      <dl className="fact-list">
        <div><dt>{t('context.input')}</dt><dd>{formatCount(normalizedUsage.inputTokens, locale)}</dd></div>
        <div><dt>{t('context.output')}</dt><dd>{formatCount(normalizedUsage.outputTokens, locale)}</dd></div>
        <div><dt>{t('context.cached')}</dt><dd>{formatCount(normalizedUsage.cachedTokens, locale)}</dd></div>
      </dl>
      {normalizedUsage.incomplete ? <small role="status">{t('context.usageIncomplete')}</small> : null}
    </div> : null}
  </section>
}
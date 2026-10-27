import type { JsonValue } from '../../../shared/protocol'
import { useOptionalI18n } from '../i18n/I18nProvider'

function objectValue(value: JsonValue | undefined): Record<string, JsonValue> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, JsonValue> : null
}

export function ChangeDetail({ detail }: { detail: Record<string, JsonValue> | null }) {
  const { t } = useOptionalI18n()
  if (!detail) return <p className="route-note">{t('changes.selectPrompt')}</p>
  const content = objectValue(detail.content)
  return <section className="change-detail reading-surface" aria-label={t('changes.detail')}><header><strong>{String(detail.path ?? t('workbench.changes'))}</strong><span>{detail.applied === true ? t('changes.applied') : String(detail.review ?? t('changes.readOnly'))}</span></header><dl className="fact-list"><div><dt>{t('changes.kind')}</dt><dd>{detail.kind == null ? t('common.unknown') : String(detail.kind)}</dd></div><div><dt>{t('changes.supported')}</dt><dd>{detail.applySupported === true ? t('changes.yes') : t('changes.no')}</dd></div></dl>{content ? <><pre>{String(content.data ?? '')}</pre>{content.truncated === true ? <p role="status">{t('changes.contentTruncated')}</p> : null}</> : <p>{t('changes.noContent')}</p>}</section>
}

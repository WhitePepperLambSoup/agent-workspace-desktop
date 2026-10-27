import { Boxes } from 'lucide-react'

import type { ContributionRegistry } from '../extensions/registry'
import { isRenderableContribution } from '../extensions/registry'
import type { WorkbenchState } from '../state/workbench-store'
import { useOptionalI18n } from '../i18n/I18nProvider'

export function ArtifactsInspectorPage({ state, registry }: { state: WorkbenchState; registry?: Pick<ContributionRegistry, 'resolveArtifactViewer'> }) {
  const { t } = useOptionalI18n()
  const capabilities = state.operational.workspaceSummary?.capabilities
  const items = Array.isArray(capabilities) ? capabilities.filter((item): item is string => typeof item === 'string').slice(0, 32) : []
  return <section className="inspector-section"><h3>{t('inspector.capabilities')}</h3>
    {items.length === 0
      ? <div className="inspector-placeholder"><Boxes size={15} /><span>{t('inspector.noCapabilities')}</span></div>
      : <ul className="metadata-list">{items.map((item) => {
          const fallback = item
          const capability = /^[a-zA-Z0-9._:-]{1,160}$/.test(item) ? item : 'redacted'
          const contribution = registry?.resolveArtifactViewer(
            { kind: 'capability', capability },
            () => fallback,
          )
          return <li key={item}>{isRenderableContribution(contribution) ? contribution : fallback}</li>
        })}</ul>}
  </section>
}

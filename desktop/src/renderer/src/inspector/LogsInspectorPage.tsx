import { Clock3 } from 'lucide-react'

import type { WorkbenchState } from '../state/workbench-store'
import { useOptionalI18n } from '../i18n/I18nProvider'

export function LogsInspectorPage({ state }: { state: WorkbenchState }) {
  const { t } = useOptionalI18n()
  return <section className="inspector-section inspector-log reading-surface" aria-label={t('inspector.recentLogs')}><h3>{t('inspector.recent')}</h3>
    {state.operational.logs.length === 0 ? <p>{t('inspector.noRuntimeLogs')}</p> : state.operational.logs.slice(-30).map((entry) => <div key={`${entry.sequence}-${entry.type}`}><Clock3 size={12} /><span>{entry.text}</span><time>{entry.sequence}</time></div>)}
  </section>
}

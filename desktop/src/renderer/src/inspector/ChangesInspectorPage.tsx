import { FileDiff } from 'lucide-react'

import type { WorkbenchState } from '../state/workbench-store'
import { useOptionalI18n } from '../i18n/I18nProvider'
import { localizeKnownStatus } from '../i18n/messages'

export function ChangesInspectorPage({ state }: { state: WorkbenchState }) {
  const { locale, t } = useOptionalI18n()
  return <section className="inspector-section"><h3>{t('workbench.changes')}</h3>
    {state.operational.changes.length === 0
      ? <div className="inspector-placeholder"><FileDiff size={15} /><span>{t('inspector.noChanges')}</span></div>
      : <dl className="fact-list">{state.operational.changes.slice(0, 10).map((item) => <div key={item.changesetId}><dt>{item.changesetId.slice(0, 8)}</dt><dd>{localizeKnownStatus(locale, item.state)}</dd></div>)}</dl>}
  </section>
}

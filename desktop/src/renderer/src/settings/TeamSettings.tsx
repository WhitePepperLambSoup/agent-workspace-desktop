import { Plus, Trash2, Users } from 'lucide-react'
import { useState, type CSSProperties } from 'react'

import { useI18n, type I18nValue } from '../i18n/I18nProvider'
import { CATALOG, EXPERT_DOMAINS, catalogLocale, libraryName } from '../team/catalog'
import {
  MAX_BRIEF,
  MAX_NAME,
  MAX_TEAM,
  customExpertId,
  useTeamSettings,
  writeTeamSettings,
  type TeamSettings as TeamConfig,
} from '../team/team-settings'
import '../team/team.css'

function TeamSettingsView({ i18n }: { i18n: I18nValue }) {
  const { t, locale } = i18n
  const settings = useTeamSettings()
  const [draft, setDraft] = useState<{ name: string; brief: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fixed = settings.mode === 'fixed'
  const full = settings.members.length >= MAX_TEAM
  const language = catalogLocale(locale)
  const nameOf = (id: string): string => libraryName(id, locale) ?? settings.custom.find((item) => item.id === id)?.name ?? id

  const save = (next: Partial<TeamConfig>): void => writeTeamSettings({ ...settings, ...next })
  const toggle = (id: string, on: boolean): void => {
    const members = on ? [...settings.members, id] : settings.members.filter((item) => item !== id)
    // A team keeps at least one expert.
    if (members.length === 0 || members.length > MAX_TEAM) return
    save({ members })
  }
  const add = (): void => {
    if (!draft) return
    const name = draft.name.trim()
    const brief = draft.brief.trim()
    if (!name || !brief) return
    const taken = [...[...CATALOG.values()].map((item) => item.names[language]), ...settings.custom.map((item) => item.name)]
    if (taken.some((item) => item.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      setError(t('team.custom.duplicate'))
      return
    }
    const id = customExpertId(settings)
    save({ custom: [...settings.custom, { id, name, brief }], members: full ? settings.members : [...settings.members, id] })
    setDraft(null)
    setError(null)
  }
  const remove = (id: string): void => {
    const members = settings.members.filter((item) => item !== id)
    save({ custom: settings.custom.filter((item) => item.id !== id), members: members.length > 0 ? members : ['researcher'] })
  }

  const option = (id: string, summary: string, custom: boolean) => {
    const checked = fixed && settings.members.includes(id)
    return (
      <li key={id} className="team-option" data-checked={checked ? 'true' : 'false'}>
        <label>
          {fixed ? (
            <input type="checkbox" checked={checked} disabled={!checked && full}
              onChange={(event) => toggle(id, event.target.checked)} />
          ) : null}
          <span className="team-option-text">
            <strong>{nameOf(id)}</strong>
            <span>{summary}</span>
          </span>
        </label>
        {custom ? (
          <button type="button" className="icon-button" aria-label={t('team.custom.remove', { name: nameOf(id) })}
            title={t('team.custom.remove', { name: nameOf(id) })} onClick={() => remove(id)}><Trash2 size={13} /></button>
        ) : null}
      </li>
    )
  }

  return (
    <section className="settings-section appearance-settings team-settings" aria-labelledby="team-heading">
      <header className="doctor-header">
        <div>
          <h2 id="team-heading">{t('team.title')}</h2>
          <p>{t('team.description')}</p>
        </div>
        <Users size={16} aria-hidden="true" />
      </header>

      <fieldset className="team-mode">
        <legend>{t('team.mode')}</legend>
        <label>
          <input type="radio" name="team-mode" checked={!fixed} onChange={() => save({ mode: 'auto' })} />
          <span><strong>{t('team.mode.auto')}</strong><span>{t('team.mode.autoDescription')}</span></span>
        </label>
        <label>
          <input type="radio" name="team-mode" checked={fixed} onChange={() => save({ mode: 'fixed' })} />
          <span><strong>{t('team.mode.fixed')}</strong><span>{t('team.mode.fixedDescription', { max: MAX_TEAM })}</span></span>
        </label>
      </fieldset>

      <div className="team-members" role="group" aria-label={t('team.members')}>
        <p className="team-limit">{t('team.library', { domains: EXPERT_DOMAINS.length, experts: CATALOG.size })}</p>
        {EXPERT_DOMAINS.map((domain) => {
          const chosen = fixed ? domain.experts.filter((item) => settings.members.includes(item.id)).length : 0
          return (
            <details key={domain.id} className="team-domain" open={domain.id === 'core' || chosen > 0}>
              <summary>
                <span className="team-domain-swatch" aria-hidden="true" style={{ '--swatch': domain.color } as CSSProperties} />
                <strong>{domain.names[language]}</strong>
                <span>{chosen > 0 ? `${chosen} / ${domain.experts.length}` : domain.experts.length}</span>
              </summary>
              <ul>{domain.experts.map((item) => option(item.id, item.summaries[language], false))}</ul>
            </details>
          )
        })}
        {settings.custom.length > 0 ? (
          <details className="team-domain" open>
            <summary><strong>{t('team.custom.title')}</strong><span>{settings.custom.length}</span></summary>
            <ul>{settings.custom.map((item) => option(item.id, item.brief, true))}</ul>
          </details>
        ) : null}
      </div>

      {draft ? (
        <div className="team-custom-form">
          <label>
            <span>{t('team.custom.name')}</span>
            <input value={draft.name} maxLength={MAX_NAME} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
          </label>
          <label>
            <span>{t('team.custom.brief')}</span>
            <textarea value={draft.brief} maxLength={MAX_BRIEF} rows={3} placeholder={t('team.custom.briefPlaceholder')}
              onChange={(event) => setDraft({ ...draft, brief: event.target.value })} />
          </label>
          {error ? <p className="provider-status provider-status-error" role="status">{error}</p> : null}
          <div className="team-custom-actions">
            <button type="button" className="provider-primary" disabled={!draft.name.trim() || !draft.brief.trim()} onClick={add}>{t('team.custom.save')}</button>
            <button type="button" className="provider-secondary" onClick={() => { setDraft(null); setError(null) }}>{t('team.custom.cancel')}</button>
          </div>
        </div>
      ) : (
        <button type="button" className="provider-secondary team-add" onClick={() => setDraft({ name: '', brief: '' })}>
          <Plus size={13} aria-hidden="true" />{t('team.custom.add')}
        </button>
      )}

      <div className="settings-row compact-setting">
        <div className="setting-label">
          <strong>{t('team.review')}</strong>
          <span>{t('team.reviewDescription')}</span>
        </div>
        <label className="toggle-control">
          <input type="checkbox" aria-label={t('team.review')} checked={settings.review} onChange={(event) => save({ review: event.target.checked })} />
          <span aria-hidden="true" />
        </label>
      </div>
    </section>
  )
}

function LocalizedTeamSettings() {
  return <TeamSettingsView i18n={useI18n()} />
}

export function TeamSettings({ i18n }: { i18n?: I18nValue }) {
  return i18n ? <TeamSettingsView i18n={i18n} /> : <LocalizedTeamSettings />
}

import { FolderOpen, Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'

import type { WorkbenchBridgeClient } from '../bridge/client'
import { useI18n, type I18nValue } from '../i18n/I18nProvider'

type SkillsClient = Pick<WorkbenchBridgeClient, 'listSkills' | 'setSkillEnabled' | 'openSkillsFolder'>

interface SkillEntry {
  key: string
  title: string
  description: string
  pack: 'official' | 'user'
  enabled: boolean
}

interface SkillsDocument {
  officialVersion: string
  skills: SkillEntry[]
}

function skillsFrom(payload: Record<string, unknown>): SkillsDocument | null {
  if (!Array.isArray(payload.skills)) return null
  const official = payload.official && typeof payload.official === 'object' ? payload.official as Record<string, unknown> : {}
  const skills: SkillEntry[] = []
  for (const raw of payload.skills) {
    if (!raw || typeof raw !== 'object') continue
    const item = raw as Record<string, unknown>
    if (typeof item.key !== 'string' || typeof item.enabled !== 'boolean') continue
    skills.push({
      key: item.key,
      title: typeof item.title === 'string' && item.title ? item.title : item.key,
      description: typeof item.description === 'string' ? item.description : '',
      pack: item.pack === 'user' ? 'user' : 'official',
      enabled: item.enabled,
    })
  }
  return { officialVersion: typeof official.version === 'string' ? official.version : '', skills }
}

function SkillSettingsView({ client, i18n }: { client: SkillsClient; i18n: I18nValue }) {
  const { t } = i18n
  const [document, setDocument] = useState<SkillsDocument | null>(null)
  const [status, setStatus] = useState<'idle' | 'failed' | 'unavailable'>('idle')
  const [pending, setPending] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    client.listSkills()
      .then((response) => {
        if (!active) return
        const next = response.type === 'skills.list.result' ? skillsFrom(response.payload) : null
        if (next) setDocument(next)
        else setStatus('unavailable')
      })
      .catch(() => { if (active) setStatus('unavailable') })
    return () => { active = false }
  }, [client])

  const toggle = (skill: SkillEntry, enabled: boolean): void => {
    setPending(skill.key)
    setStatus('idle')
    client.setSkillEnabled(skill.key, enabled)
      .then((response) => {
        const next = response.type === 'skills.set.result' ? skillsFrom(response.payload) : null
        if (next) setDocument(next)
        else setStatus('failed')
      })
      .catch(() => setStatus('failed'))
      .finally(() => setPending(null))
  }

  const openFolder = (): void => {
    setStatus('idle')
    client.openSkillsFolder()
      .then((response) => {
        const next = response.type === 'skills.folder.open.result' ? skillsFrom(response.payload) : null
        if (next) setDocument(next)
        else setStatus('failed')
      })
      .catch(() => setStatus('failed'))
  }

  const group = (pack: SkillEntry['pack']) => document?.skills.filter((skill) => skill.pack === pack) ?? []
  const list = (skills: SkillEntry[]) => (
    <ul className="skill-list">
      {skills.map((skill) => (
        <li key={skill.key}>
          <label className="settings-toggle skill-toggle">
            <input
              type="checkbox"
              role="switch"
              checked={skill.enabled}
              disabled={pending !== null}
              onChange={(event) => toggle(skill, event.target.checked)}
            />
            <span className="skill-text">
              <span className="skill-title">{skill.title}</span>
              <span className="skill-description">{skill.description}</span>
            </span>
          </label>
        </li>
      ))}
    </ul>
  )
  const official = group('official')
  const mine = group('user')

  return (
    <section className="settings-section skill-settings" aria-labelledby="skill-heading">
      <header className="doctor-header">
        <div>
          <h2 id="skill-heading">{t('settings.skills.title')}</h2>
          <p>{t('settings.skills.description')}</p>
        </div>
        <Sparkles size={16} aria-hidden="true" />
      </header>
      {document ? (
        <>
          <h3 className="about-subheading">
            {document.officialVersion
              ? t('settings.skills.officialVersion', { version: document.officialVersion })
              : t('settings.skills.official')}
          </h3>
          {official.length ? list(official) : <p className="provider-hint">{t('settings.skills.officialMissing')}</p>}
          <h3 className="about-subheading">{t('settings.skills.mine')}</h3>
          {mine.length ? list(mine) : null}
          <p className="provider-hint">{t('settings.skills.mineHint')}</p>
          <div className="provider-actions">
            <button type="button" className="provider-secondary" onClick={openFolder}>
              <FolderOpen size={13} aria-hidden="true" />
              {t('settings.skills.openFolder')}
            </button>
          </div>
        </>
      ) : null}
      {status !== 'idle' ? (
        <p className="provider-status provider-status-error" role="status">
          {t(status === 'failed' ? 'settings.skills.failed' : 'settings.skills.unavailable')}
        </p>
      ) : null}
    </section>
  )
}

function LocalizedSkillSettings({ client }: { client: SkillsClient }) {
  return <SkillSettingsView client={client} i18n={useI18n()} />
}

export function SkillSettings({ client, i18n }: { client: SkillsClient; i18n?: I18nValue }) {
  return i18n ? <SkillSettingsView client={client} i18n={i18n} /> : <LocalizedSkillSettings client={client} />
}

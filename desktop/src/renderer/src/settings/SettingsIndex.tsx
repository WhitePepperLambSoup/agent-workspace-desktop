import { Search } from 'lucide-react'
import { useEffect, useState, type RefObject } from 'react'

import type { I18nValue } from '../i18n/I18nProvider'

interface Section {
  id: string
  title: string
}

const SECTIONS = ':scope > section'

/**
 * Settings is one long page of many sections: a box to narrow it down by any word on it, and a
 * list to jump to a section. It reads the sections from the page, so each section stays its own.
 */
export function SettingsIndex({ content, i18n }: { content: RefObject<HTMLElement | null>; i18n: I18nValue }) {
  const { t } = i18n
  const [sections, setSections] = useState<readonly Section[]>([])
  const [query, setQuery] = useState('')
  const [empty, setEmpty] = useState(false)

  useEffect(() => {
    const node = content.current
    if (!node) return undefined
    const read = (): void => {
      const found: Section[] = []
      node.querySelectorAll<HTMLElement>(SECTIONS).forEach((section, index) => {
        const heading = section.querySelector('h2')
        if (!heading?.textContent) return
        section.dataset.settingsSection ??= `section-${index}`
        found.push({ id: section.dataset.settingsSection, title: heading.textContent })
      })
      setSections((current) => (current.map((item) => item.title).join('\n') === found.map((item) => item.title).join('\n') ? current : found))
    }
    read()
    // Some sections come in when their data has loaded, and their titles change with the language.
    const observer = new MutationObserver(read)
    observer.observe(node, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [content])

  useEffect(() => {
    const node = content.current
    if (!node) return
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
    let shown = 0
    node.querySelectorAll<HTMLElement>(SECTIONS).forEach((section) => {
      const text = section.textContent?.toLowerCase() ?? ''
      const matches = words.every((word) => text.includes(word))
      section.hidden = !matches
      if (matches) shown += 1
    })
    setEmpty(shown === 0)
  }, [content, query, sections])

  const jump = (id: string): void => {
    setQuery('')
    window.requestAnimationFrame(() => {
      const section = content.current?.querySelector<HTMLElement>(`[data-settings-section="${id}"]`)
      section?.scrollIntoView?.({ block: 'start' })
      section?.querySelector<HTMLElement>('h2')?.setAttribute('tabindex', '-1')
      section?.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true })
    })
  }

  return (
    <div className="settings-index" data-testid="settings-index">
      <label className="settings-index-search">
        <Search size={13} aria-hidden="true" />
        <input type="search" value={query} aria-label={t('settings.index.search')} placeholder={t('settings.index.search')} onChange={(event) => setQuery(event.target.value)} />
      </label>
      <select value="" aria-label={t('settings.index.jump')} onChange={(event) => { if (event.target.value) jump(event.target.value) }}>
        <option value="">{t('settings.index.jump')}</option>
        {sections.map((section) => <option key={section.id} value={section.id}>{section.title}</option>)}
      </select>
      {empty ? <p className="settings-index-empty" role="status">{t('settings.index.empty')}</p> : null}
    </div>
  )
}

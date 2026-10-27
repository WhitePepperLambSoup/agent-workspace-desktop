import { Command, Search, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import type { CommandContribution } from '../extensions/registry'
import { useText } from '../i18n/I18nProvider'

interface PaletteRegistry {
  searchCommands(query: string): CommandContribution[]
}

export function CommandPalette({ registry, onClose }: { registry: PaletteRegistry; onClose: () => void }) {
  const tx = useText()
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const executingRef = useRef(false)
  const commands = useMemo(() => registry.searchCommands(query), [registry, query])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    if (selected < 0 || selected >= commands.length) setSelected(Math.max(0, commands.length - 1))
  }, [commands.length, selected])

  const execute = (index = selected): void => {
    if (executingRef.current) return
    const command = commands[index]
    if (!command) return
    executingRef.current = true
    void Promise.resolve(command.run()).catch(() => undefined)
    onClose()
  }

  return (
    <div className="command-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="command-palette reading-surface" role="dialog" aria-label={tx('Command palette')} aria-modal="true">
        <header>
          <Command size={16} />
          <input
            ref={inputRef}
            type="search"
            role="combobox"
            aria-label={tx('Command search')}
            aria-controls="command-results"
            aria-expanded="true"
            value={query}
            placeholder={tx('Search commands')}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') onClose()
              else if (event.key === 'ArrowDown') { event.preventDefault(); setSelected((value) => commands.length === 0 ? 0 : Math.min(value + 1, commands.length - 1)) }
              else if (event.key === 'ArrowUp') { event.preventDefault(); setSelected((value) => Math.max(value - 1, 0)) }
              else if (event.key === 'Home') { event.preventDefault(); setSelected(0) }
              else if (event.key === 'End') { event.preventDefault(); setSelected(Math.max(0, commands.length - 1)) }
              else if (event.key === 'Enter') { event.preventDefault(); execute() }
            }}
          />
          <button type="button" className="icon-button" aria-label={tx('Close command palette')} title={tx('Close command palette')} onClick={onClose}><X size={15} /></button>
        </header>
        <div id="command-results" role="listbox" aria-label={tx('Commands')}>
          {commands.length === 0 ? <p className="command-empty"><Search size={14} />{tx('No matching commands')}</p> : commands.map((command, index) => (
            <button
              type="button"
              role="option"
              aria-selected={index === selected}
              key={command.id}
              onMouseEnter={() => setSelected(index)}
              onClick={() => execute(index)}
            >
              <span><strong>{command.title}</strong><small>{command.id}</small></span>
              {command.shortcut ? <kbd>{command.shortcut}</kbd> : null}
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}

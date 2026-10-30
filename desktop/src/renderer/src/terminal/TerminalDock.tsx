import { ChevronDown, ChevronUp, MessageSquarePlus, Plus, SquareTerminal, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'

import { HunkComment } from '../changes/HunkDiff'
import { useOptionalI18n } from '../i18n/I18nProvider'
import type { MessageKey } from '../i18n/messages'
import { type ShellClient, TerminalView, type TerminalViewHandle } from './TerminalView'

interface ShellInfo {
  id: string
  program: string
  label: string
  cwd: string
  running: boolean
  exitCode: number | null
}

interface ProgramInfo {
  id: string
  label: string
}

const PROGRAM_KEY = 'agent-workspace.terminal.program.v1'
const HEIGHT_KEY = 'agent-workspace.terminal.height.v1'
const DEFAULT_HEIGHT = 240
const MIN_HEIGHT = 120

function stored(key: string): string {
  try {
    return localStorage.getItem(key) ?? ''
  } catch {
    return ''
  }
}

function store(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // The choice is only remembered for convenience.
  }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

const ERRORS: Record<string, MessageKey> = {
  shell_limit: 'terminal.limit',
  shell_unavailable: 'terminal.unavailable',
  shell_program_unknown: 'terminal.programGone',
}

function errorKey(reason: unknown): MessageKey {
  const code = reason instanceof Error ? reason.message : String(reason)
  return ERRORS[code] ?? 'terminal.failed'
}

/** The panel under the editor: the user's terminals, one tab each. */
export function TerminalDock({
  client,
  onHide,
  onAsk,
}: {
  client: ShellClient
  onHide(): void
  /** Sends a question about the shown output to the conversation; false when it could not. */
  onAsk?: (prompt: string) => Promise<boolean>
}) {
  const { t } = useOptionalI18n()
  const [shells, setShells] = useState<ShellInfo[]>([])
  const [programs, setPrograms] = useState<ProgramInfo[]>([])
  const [program, setProgram] = useState(() => stored(PROGRAM_KEY))
  const [activeId, setActiveId] = useState<string | null>(null)
  const [error, setError] = useState<MessageKey | null>(null)
  const [asking, setAsking] = useState<{ shell: ShellInfo; output: string } | null>(null)
  const [height, setHeight] = useState(() => Number(stored(HEIGHT_KEY)) || DEFAULT_HEIGHT)
  const views = useRef(new Map<string, TerminalViewHandle>())
  const stack = useRef<HTMLDivElement>(null)
  const startedOnOpen = useRef(false)

  const start = useCallback(async (chosen: string | undefined): Promise<void> => {
    setError(null)
    const box = stack.current?.getBoundingClientRect()
    const columns = Math.max(20, Math.min(400, Math.floor((box?.width || 800) / 7.8)))
    const rows = Math.max(5, Math.min(200, Math.floor((box?.height || 200) / 17)))
    try {
      const reply = await client.startShell({ program: chosen, columns, rows })
      const shell = record(reply.payload).shell as ShellInfo
      setShells((current) => [...current, shell])
      setActiveId(shell.id)
    } catch (reason) {
      setError(errorKey(reason))
    }
  }, [client])

  useEffect(() => {
    let current = true
    void client.listShells().then((reply) => {
      if (!current) return
      const payload = record(reply.payload)
      const list = Array.isArray(payload.shells) ? (payload.shells as ShellInfo[]) : []
      const choices = Array.isArray(payload.programs) ? (payload.programs as ProgramInfo[]) : []
      setPrograms(choices)
      setShells(list)
      setActiveId(list.at(-1)?.id ?? null)
      if (list.length === 0 && !startedOnOpen.current) {
        startedOnOpen.current = true
        const remembered = stored(PROGRAM_KEY)
        void start(choices.some((item) => item.id === remembered) ? remembered : undefined)
      }
    }, (reason: unknown) => {
      if (current) setError(errorKey(reason))
    })
    return () => {
      current = false
    }
  }, [client, start])

  const exited = useCallback((shellId: string, exitCode: number | null) => {
    setShells((current) => current.map((shell) => (shell.id === shellId ? { ...shell, running: false, exitCode } : shell)))
  }, [])

  const close = async (shell: ShellInfo): Promise<void> => {
    try {
      await client.closeShell(shell.id)
    } catch {
      // Already gone from the gateway (it restarted): remove the tab all the same.
    }
    setShells((current) => current.filter((item) => item.id !== shell.id))
    if (activeId === shell.id) setActiveId(shells.filter((item) => item.id !== shell.id).at(-1)?.id ?? null)
    if (asking?.shell.id === shell.id) setAsking(null)
  }

  const resizeFrom = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const handle = event.currentTarget
    const startY = event.clientY
    const startHeight = height
    let latest = height
    handle.setPointerCapture(event.pointerId)
    const move = (moved: PointerEvent): void => {
      const limit = Math.max(MIN_HEIGHT, window.innerHeight * 0.7)
      latest = Math.round(Math.max(MIN_HEIGHT, Math.min(limit, startHeight + startY - moved.clientY)))
      setHeight(latest)
    }
    const end = (): void => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', end)
      handle.removeEventListener('pointercancel', end)
      store(HEIGHT_KEY, String(latest))
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', end)
    handle.addEventListener('pointercancel', end)
  }

  const active = shells.find((shell) => shell.id === activeId) ?? null
  const chosenProgram = programs.some((item) => item.id === program) ? program : (programs[0]?.id ?? '')

  return (
    <section className="terminal-dock" style={{ height }} aria-label={t('terminal.title')}>
      <div
        className="terminal-dock-resize"
        role="separator"
        aria-orientation="horizontal"
        aria-label={t('terminal.resize')}
        onPointerDown={resizeFrom}
      />
      <header className="terminal-dock-bar">
        <div className="terminal-tabs" role="tablist">
          {shells.map((shell, index) => (
            <div key={shell.id} className={`terminal-tab${shell.id === activeId ? ' active' : ''}${shell.running ? '' : ' exited'}`}>
              <button type="button" role="tab" aria-selected={shell.id === activeId} onClick={() => setActiveId(shell.id)}>
                <SquareTerminal size={12} aria-hidden="true" />
                <span>{shell.label}{shells.length > 1 ? ` ${index + 1}` : ''}</span>
              </button>
              <button
                type="button"
                className="terminal-tab-close"
                aria-label={t('terminal.close', { name: shell.label })}
                onClick={() => void close(shell)}
              >
                <X size={11} />
              </button>
            </div>
          ))}
        </div>
        <div className="terminal-dock-actions">
          <button type="button" className="icon-button" aria-label={t('terminal.new')} title={t('terminal.new')} onClick={() => void start(chosenProgram || undefined)}>
            <Plus size={14} />
          </button>
          {programs.length > 1 ? (
            <select
              aria-label={t('terminal.shell')}
              value={chosenProgram}
              onChange={(event) => {
                setProgram(event.target.value)
                store(PROGRAM_KEY, event.target.value)
              }}
            >
              {programs.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          ) : null}
          {onAsk && active ? (
            <button
              type="button"
              className="icon-button"
              aria-label={t('terminal.ask')}
              title={t('terminal.ask')}
              onClick={() => {
                const output = views.current.get(active.id)?.text() ?? ''
                setAsking({ shell: active, output })
              }}
            >
              <MessageSquarePlus size={14} />
            </button>
          ) : null}
          <button type="button" className="icon-button" aria-label={t('terminal.hide')} title={t('terminal.hideShortcut')} onClick={onHide}>
            <ChevronDown size={14} />
          </button>
        </div>
      </header>
      {error ? <p className="terminal-dock-error" role="status">{t(error)}</p> : null}
      {asking && onAsk ? (
        <HunkComment
          placeholder={t('terminal.askPlaceholder')}
          onCancel={() => setAsking(null)}
          onSend={async (question) => {
            const sent = await onAsk(t('terminal.askAbout', {
              shell: asking.shell.label,
              cwd: asking.shell.cwd,
              output: asking.output || t('terminal.nothingShown'),
              question,
            }))
            if (sent) setAsking(null)
            return sent
          }}
        />
      ) : null}
      <div className="terminal-stack" ref={stack}>
        {shells.map((shell) => (
          <TerminalView
            key={shell.id}
            ref={(handle) => {
              if (handle) views.current.set(shell.id, handle)
              else views.current.delete(shell.id)
            }}
            shellId={shell.id}
            client={client}
            visible={shell.id === activeId}
            onExit={exited}
          />
        ))}
        {shells.length === 0 && !error ? <p className="terminal-empty">{t('terminal.empty')}</p> : null}
      </div>
    </section>
  )
}

/** The panel's closed form: one line to open it. */
export function TerminalDockClosed({ onShow }: { onShow(): void }) {
  const { t } = useOptionalI18n()
  return (
    <button type="button" className="terminal-dock-closed" title={t('terminal.hideShortcut')} onClick={onShow}>
      <SquareTerminal size={12} aria-hidden="true" />
      <span>{t('terminal.title')}</span>
      <ChevronUp size={12} aria-hidden="true" />
    </button>
  )
}

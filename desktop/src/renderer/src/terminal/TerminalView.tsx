import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'

import type { UiEvent } from '../../../shared/api'
import type { WorkbenchBridgeClient } from '../bridge/client'
import { useOptionalI18n } from '../i18n/I18nProvider'
import { createTerminalHost, type TerminalHost } from './xterm-host'

export type ShellClient = Pick<
  WorkbenchBridgeClient,
  | 'onShellEvent'
  | 'listShells'
  | 'startShell'
  | 'sendShellInput'
  | 'resizeShell'
  | 'stopShell'
  | 'closeShell'
  | 'replayShell'
>

export interface TerminalViewHandle {
  /** The selected text, or the last lines on screen when nothing is selected. */
  text(lines?: number): string
  focus(): void
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

/** One shell's screen: what it printed before (after a reload too), then what it prints, and
 * the keys typed in it. */
export const TerminalView = forwardRef<TerminalViewHandle, {
  shellId: string
  client: ShellClient
  visible: boolean
  onExit(shellId: string, exitCode: number | null): void
}>(function TerminalView({ shellId, client, visible, onExit }, ref) {
  const { t } = useOptionalI18n()
  const box = useRef<HTMLDivElement>(null)
  const host = useRef<TerminalHost | null>(null)
  const sentSize = useRef('')
  const onExitRef = useRef(onExit)
  onExitRef.current = onExit
  const tRef = useRef(t)
  tRef.current = t

  const fit = (): void => {
    const size = host.current?.fit()
    if (!size) return
    const key = `${size.columns}x${size.rows}`
    if (key === sentSize.current) return
    sentSize.current = key
    void client.resizeShell(shellId, size.columns, size.rows).catch(() => undefined)
  }
  const fitRef = useRef(fit)
  fitRef.current = fit

  useEffect(() => {
    const element = box.current
    if (!element) return
    const view = createTerminalHost(element)
    host.current = view
    const { terminal } = view
    let replayedTo = -1
    let exited = false
    const early: UiEvent[] = []
    const showExit = (code: unknown): void => {
      if (exited) return
      exited = true
      const exitCode = typeof code === 'number' ? code : null
      terminal.write(`\r\n\x1b[2m${tRef.current('terminal.exited', { code: exitCode ?? '?' })}\x1b[0m\r\n`)
      onExitRef.current(shellId, exitCode)
    }
    const apply = (event: UiEvent): void => {
      if (event.payload.shellId !== shellId) return
      if (event.type === 'shell.exited') {
        showExit(event.payload.exitCode)
        return
      }
      const sequence = Number(event.payload.seq)
      if (!(sequence > replayedTo)) return
      replayedTo = sequence
      terminal.write(String(event.payload.data ?? ''))
    }
    const unsubscribe = client.onShellEvent((event) => {
      if (replayedTo < 0) early.push(event)
      else apply(event)
    })
    const caughtUp = (): void => {
      for (const event of early.splice(0)) apply(event)
    }
    void client.replayShell(shellId).then((reply) => {
      const replay = record(record(reply.payload).replay)
      terminal.write(String(replay.data ?? ''))
      replayedTo = typeof replay.seq === 'number' ? replay.seq : 0
      caughtUp()
      if (replay.running === false) showExit(replay.exitCode)
    }, () => {
      replayedTo = 0
      caughtUp()
    })
    const typed = terminal.onData((data) => {
      if (!exited) void client.sendShellInput(shellId, data).catch(() => undefined)
    })
    let frame = 0
    const resized = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => fitRef.current())
    })
    resized.observe(element)
    return () => {
      cancelAnimationFrame(frame)
      resized.disconnect()
      typed.dispose()
      unsubscribe()
      host.current = null
      view.dispose()
    }
  }, [client, shellId])

  useEffect(() => {
    if (!visible) return
    fitRef.current()
    host.current?.terminal.focus()
  }, [visible])

  useImperativeHandle(ref, () => ({
    text(lines = 60) {
      const terminal = host.current?.terminal
      if (!terminal) return ''
      if (terminal.hasSelection()) return terminal.getSelection().trimEnd()
      const buffer = terminal.buffer.active
      const rows: string[] = []
      for (let index = Math.max(0, buffer.length - 400); index < buffer.length; index += 1) {
        rows.push(buffer.getLine(index)?.translateToString(true) ?? '')
      }
      while (rows.length > 0 && !rows[rows.length - 1].trim()) rows.pop()
      return rows.slice(-lines).join('\n')
    },
    focus() {
      host.current?.terminal.focus()
    },
  }), [])

  // Not display:none when another tab is shown: xterm measures its characters in the box.
  return <div ref={box} className="terminal-view" data-active={visible} aria-hidden={!visible} data-shell-id={shellId} />
})

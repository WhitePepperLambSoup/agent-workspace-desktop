import { ArrowDownToLine, ArrowRightFromLine, ArrowUpFromLine, ChevronRight, Download, Loader2, Play, Redo2, Square, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'

import type { UiEvent } from '../../../shared/api'
import type { WorkbenchBridgeClient } from '../bridge/client'
import { breakpointStore } from '../editor/breakpoints'
import { useOptionalI18n } from '../i18n/I18nProvider'
import type { MessageKey } from '../i18n/messages'

export type DebugClient = Pick<
  WorkbenchBridgeClient,
  | 'onDebugEvent'
  | 'debugStatus'
  | 'installDebugpy'
  | 'startDebug'
  | 'debugControl'
  | 'debugStack'
  | 'debugScopes'
  | 'debugVariables'
  | 'debugEvaluate'
  | 'setDebugBreakpoints'
  | 'stopDebug'
>

type RunState = 'idle' | 'starting' | 'running' | 'stopped' | 'terminated'

interface Frame {
  id: number
  name: string
  path: string
  relativePath: string | null
  line: number
}

interface Variable {
  name: string
  value: string
  type: string
  reference: number
}

interface Evaluated {
  expression: string
  result?: string
  error?: string
}

const MAX_OUTPUT = 60_000

const ERRORS: Record<string, MessageKey> = {
  python_missing: 'debug.error.python',
  debugpy_missing: 'debug.error.debugpy',
  debugpy_install_failed: 'debug.error.install',
  debug_start_timeout: 'debug.error.start',
  adapter_start_failed: 'debug.error.start',
  no_debug_session: 'debug.error.noSession',
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function errorKey(reason: unknown): MessageKey {
  return ERRORS[reason instanceof Error ? reason.message : String(reason)] ?? 'debug.error.failed'
}

function VariableRow({ variable, client, depth }: { variable: Variable; client: DebugClient; depth: number }) {
  const [open, setOpen] = useState(false)
  const [children, setChildren] = useState<Variable[] | null>(null)
  const toggle = async (): Promise<void> => {
    if (!open && children === null) {
      try {
        const reply = await client.debugVariables(variable.reference)
        setChildren((record(reply.payload).variables as Variable[] | undefined) ?? [])
      } catch {
        setChildren([])
      }
    }
    setOpen((current) => !current)
  }
  return (
    <li>
      <div className="debug-variable" style={{ paddingLeft: depth * 12 }}>
        {variable.reference ? (
          <button type="button" className="debug-expand" aria-expanded={open} aria-label={variable.name} onClick={() => void toggle()}>
            <ChevronRight size={11} className={open ? 'is-open' : undefined} />
          </button>
        ) : <span className="debug-expand" />}
        <span className="debug-variable-name">{variable.name}</span>
        <code className="debug-variable-value" title={variable.type}>{variable.value}</code>
      </div>
      {open && children ? (
        <ul>{children.map((child) => <VariableRow key={child.name} variable={child} client={client} depth={depth + 1} />)}</ul>
      ) : null}
    </li>
  )
}

/** The debugger beside the editor: run the open Python file, step, the stack and variables. */
export function DebugPanel({
  client,
  folder,
  startRequest,
  onPaused,
  onClose,
}: {
  client: DebugClient
  folder: string
  /** The file to debug, when the editor's Debug button was pressed (serial makes each press new). */
  startRequest: { path: string; serial: number } | null
  /** Where the program stopped (a file of the folder), or null when it runs again or ended. */
  onPaused(location: { path: string; line: number } | null): void
  onClose(): void
}) {
  const { t } = useOptionalI18n()
  const [debugpy, setDebugpy] = useState<boolean | null>(null)
  const [python, setPython] = useState<string | null>(null)
  const [state, setState] = useState<RunState>('idle')
  const [program, setProgram] = useState<string | null>(null)
  // The file to run once debugpy is installed: read when the install ends, not when it began.
  const programRef = useRef<string | null>(null)
  programRef.current = program
  const [frames, setFrames] = useState<Frame[]>([])
  const [frameId, setFrameId] = useState<number | null>(null)
  const [variables, setVariables] = useState<Variable[]>([])
  const [exception, setException] = useState<{ type: string; message: string } | null>(null)
  const [exitCode, setExitCode] = useState<number | null>(null)
  const [output, setOutput] = useState('')
  const [expression, setExpression] = useState('')
  const [evaluated, setEvaluated] = useState<Evaluated[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<MessageKey | null>(null)
  const onPausedRef = useRef(onPaused)
  onPausedRef.current = onPaused
  const sent = useRef<Record<string, readonly number[]>>({})
  const outputBox = useRef<HTMLPreElement>(null)

  const refreshStatus = useCallback(async () => {
    try {
      const status = record((await client.debugStatus()).payload)
      setDebugpy(status.debugpy === true)
      setPython(typeof status.python === 'string' ? status.python : null)
      const session = record(status.session)
      if (typeof session.state === 'string') setState(session.state as RunState)
    } catch (reason) {
      setError(errorKey(reason))
    }
  }, [client])

  useEffect(() => {
    void refreshStatus()
  }, [refreshStatus])

  const showFrame = useCallback(async (frame: Frame) => {
    setFrameId(frame.id)
    onPausedRef.current(frame.relativePath ? { path: frame.relativePath, line: frame.line } : null)
    try {
      const reply = await client.debugScopes(frame.id)
      setVariables((record(reply.payload).variables as Variable[] | undefined) ?? [])
    } catch {
      setVariables([])
    }
  }, [client])

  const stopped = useCallback(async (threadId: number | undefined) => {
    try {
      const reply = record((await client.debugStack(threadId)).payload)
      const found = (reply.frames as Frame[] | undefined) ?? []
      setFrames(found)
      setException(reply.exception ? (reply.exception as { type: string; message: string }) : null)
      const first = found.find((frame) => frame.relativePath) ?? found[0]
      if (first) await showFrame(first)
    } catch (reason) {
      setError(errorKey(reason))
    }
  }, [client, showFrame])

  useEffect(() => client.onDebugEvent((event: UiEvent) => {
    const payload = event.payload as Record<string, unknown>
    if (event.type === 'debug.output') {
      setOutput((current) => (current + String(payload.text ?? '')).slice(-MAX_OUTPUT))
      return
    }
    const next = String(payload.state) as RunState
    setState(next)
    if (next === 'stopped') {
      void stopped(typeof payload.threadId === 'number' ? payload.threadId : undefined)
    } else {
      setFrames([])
      setVariables([])
      setException(null)
      setFrameId(null)
      onPausedRef.current(null)
      if (next === 'terminated') setExitCode(typeof payload.exitCode === 'number' ? payload.exitCode : null)
    }
  }), [client, stopped])

  // Breakpoints changed in the editor while the program runs: the debugger gets them at once.
  useEffect(() => {
    const live = state === 'running' || state === 'stopped'
    const sync = (): void => {
      if (!live) return
      const files = breakpointStore.folder(folder)
      for (const path of new Set([...Object.keys(files), ...Object.keys(sent.current)])) {
        const lines = files[path] ?? []
        if (sent.current[path] === lines) continue
        sent.current = { ...sent.current, [path]: lines }
        void client.setDebugBreakpoints(path, [...lines]).catch(() => undefined)
      }
    }
    if (live) sent.current = { ...breakpointStore.folder(folder) }
    return breakpointStore.subscribe(sync)
  }, [client, folder, state])

  const start = useCallback(async (path: string) => {
    setError(null)
    setOutput('')
    setEvaluated([])
    setExitCode(null)
    setProgram(path)
    setState('starting')
    setBusy('start')
    try {
      const breakpoints = Object.fromEntries(Object.entries(breakpointStore.folder(folder)).map(([file, lines]) => [file, [...lines]]))
      sent.current = { ...breakpointStore.folder(folder) }
      const status = record((await client.startDebug({ path, breakpoints })).payload)
      const session = record(status.session)
      // The program may already have stopped (or ended) by the time the answer comes.
      setState((current) => (current === 'starting' && typeof session.state === 'string' ? session.state as RunState : current))
    } catch (reason) {
      setState('idle')
      setError(errorKey(reason))
      if (errorKey(reason) === 'debug.error.debugpy') setDebugpy(false)
    } finally {
      setBusy(null)
    }
  }, [client, folder])

  const lastStart = useRef<number | null>(null)
  useEffect(() => {
    if (!startRequest || debugpy === null || lastStart.current === startRequest.serial) return
    lastStart.current = startRequest.serial
    if (debugpy) void start(startRequest.path)
    else {
      programRef.current = startRequest.path
      setProgram(startRequest.path)
    }
  }, [debugpy, start, startRequest])

  const install = async (): Promise<void> => {
    setBusy('install')
    setError(null)
    try {
      await client.installDebugpy()
      setDebugpy(true)
      if (programRef.current) void start(programRef.current)
    } catch (reason) {
      setError(errorKey(reason))
    } finally {
      setBusy(null)
    }
  }

  const control = useCallback(async (action: 'continue' | 'next' | 'stepIn' | 'stepOut' | 'pause') => {
    setError(null)
    try {
      await client.debugControl(action)
    } catch (reason) {
      setError(errorKey(reason))
    }
  }, [client])

  const stop = useCallback(async () => {
    try {
      await client.stopDebug()
    } catch (reason) {
      setError(errorKey(reason))
    }
  }, [client])

  const evaluate = async (): Promise<void> => {
    const text = expression.trim()
    if (!text) return
    setExpression('')
    try {
      const result = record((await client.debugEvaluate(text, frameId ?? undefined)).payload)
      setEvaluated((current) => [...current.slice(-19), typeof result.error === 'string' ? { expression: text, error: result.error } : { expression: text, result: String(result.result ?? '') }])
    } catch (reason) {
      setEvaluated((current) => [...current.slice(-19), { expression: text, error: t(errorKey(reason)) }])
    }
  }

  // F5 continue (or start again), F10 over, F11 into, Shift+F11 out, Shift+F5 stop.
  useEffect(() => {
    const keys = (event: KeyboardEvent): void => {
      if (event.ctrlKey || event.altKey || event.metaKey) return
      const live = state === 'running' || state === 'stopped'
      if (event.key === 'F5' && event.shiftKey && live) void stop()
      else if (event.key === 'F5' && !event.shiftKey && state === 'stopped') void control('continue')
      else if (event.key === 'F5' && !event.shiftKey && !live && program && debugpy) void start(program)
      else if (event.key === 'F10' && state === 'stopped') void control('next')
      else if (event.key === 'F11' && state === 'stopped') void control(event.shiftKey ? 'stepOut' : 'stepIn')
      else return
      event.preventDefault()
    }
    window.addEventListener('keydown', keys)
    return () => window.removeEventListener('keydown', keys)
  }, [control, debugpy, program, start, state, stop])

  useEffect(() => {
    const box = outputBox.current
    if (box) box.scrollTop = box.scrollHeight
  }, [output])

  const live = state === 'running' || state === 'stopped'
  const onEvaluateKey = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault()
      void evaluate()
    }
  }

  return (
    <aside className="debug-panel" aria-label={t('debug.title')}>
      <header className="debug-head">
        <strong>{t('debug.title')}</strong>
        <span className={`debug-state state-${state}`}>{t(`debug.state.${state}` as MessageKey)}</span>
        <button type="button" className="icon-button" aria-label={t('debug.close')} onClick={onClose}><X size={13} /></button>
      </header>
      {program ? <p className="debug-program"><code>{program}</code>{python ? <small title={python}>{python.split(/[\\/]/).slice(-3).join('/')}</small> : null}</p> : null}

      <div className="debug-controls" role="toolbar" aria-label={t('debug.controls')}>
        {live ? (
          <>
            <button type="button" className="icon-button" aria-label={t('debug.continue')} title={`${t('debug.continue')} (F5)`} disabled={state !== 'stopped'} onClick={() => void control('continue')}><Play size={14} /></button>
            <button type="button" className="icon-button" aria-label={t('debug.next')} title={`${t('debug.next')} (F10)`} disabled={state !== 'stopped'} onClick={() => void control('next')}><Redo2 size={14} /></button>
            <button type="button" className="icon-button" aria-label={t('debug.stepIn')} title={`${t('debug.stepIn')} (F11)`} disabled={state !== 'stopped'} onClick={() => void control('stepIn')}><ArrowDownToLine size={14} /></button>
            <button type="button" className="icon-button" aria-label={t('debug.stepOut')} title={`${t('debug.stepOut')} (Shift+F11)`} disabled={state !== 'stopped'} onClick={() => void control('stepOut')}><ArrowUpFromLine size={14} /></button>
            <button type="button" className="icon-button" aria-label={t('debug.stop')} title={`${t('debug.stop')} (Shift+F5)`} onClick={() => void stop()}><Square size={13} /></button>
          </>
        ) : debugpy === false ? (
          <button type="button" className="primary-button" disabled={busy !== null} onClick={() => void install()}>
            {busy === 'install' ? <Loader2 size={13} className="spin-animation" /> : <Download size={13} />}
            {busy === 'install' ? t('debug.installing') : t('debug.install')}
          </button>
        ) : program ? (
          <button type="button" className="primary-button" disabled={busy !== null || state === 'starting'} onClick={() => void start(program)}>
            {busy === 'start' ? <Loader2 size={13} className="spin-animation" /> : <ArrowRightFromLine size={13} />}{t('debug.run')}
          </button>
        ) : null}
      </div>

      {error ? <p className="route-error" role="status">{t(error)}</p> : null}
      {debugpy === false && !error ? <p className="route-note">{t('debug.needsDebugpy')}</p> : null}
      {!program && !error ? <p className="route-note">{t('debug.hint')}</p> : null}
      {state === 'terminated' ? <p className="route-note">{t('debug.ended', { code: exitCode ?? '?' })}</p> : null}
      {exception ? (
        <p className="debug-exception" role="status"><strong>{exception.type.split('.').at(-1)}</strong> {exception.message}</p>
      ) : null}

      {frames.length > 0 ? (
        <section className="debug-section">
          <h4>{t('debug.stack')}</h4>
          <ol className="debug-frames">
            {frames.map((frame) => (
              <li key={frame.id}>
                <button type="button" aria-pressed={frame.id === frameId} className={frame.relativePath ? '' : 'is-library'} onClick={() => void showFrame(frame)}>
                  <span>{frame.name}</span>
                  <small>{(frame.relativePath ?? frame.path.split(/[\\/]/).at(-1)) + ':' + frame.line}</small>
                </button>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {state === 'stopped' ? (
        <section className="debug-section">
          <h4>{t('debug.variables')}</h4>
          <ul className="debug-variables" aria-label={t('debug.variables')}>
            {variables.map((variable) => <VariableRow key={variable.name} variable={variable} client={client} depth={0} />)}
          </ul>
          <div className="debug-evaluate">
            <input aria-label={t('debug.evaluate')} placeholder={t('debug.evaluatePlaceholder')} value={expression} onChange={(event) => setExpression(event.target.value)} onKeyDown={onEvaluateKey} />
          </div>
          {evaluated.length > 0 ? (
            <ul className="debug-evaluated">
              {evaluated.map((item, index) => (
                <li key={index} className={item.error ? 'is-error' : ''}><code>{item.expression}</code> = <code>{item.error ?? item.result}</code></li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      {output ? (
        <section className="debug-section debug-output-section">
          <h4>{t('debug.output')}</h4>
          <pre ref={outputBox} className="debug-output">{output}</pre>
        </section>
      ) : null}
    </aside>
  )
}

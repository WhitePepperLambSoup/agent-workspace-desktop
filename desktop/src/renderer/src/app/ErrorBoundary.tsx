import { AlertTriangle, FileText, FolderOpen, RotateCw, X } from 'lucide-react'
import { Component, useState, type ErrorInfo, type ReactNode } from 'react'

import { useOptionalI18n } from '../i18n/I18nProvider'

import './error-boundary.css'

/** Records what went wrong in the app's log; the window has no console in a release. */
export function reportUiError(where: string, error: unknown, componentStack?: string | null): void {
  const report = window.agentWorkspace?.desktop?.reportUiError
  if (!report) return
  const failure = error instanceof Error ? error : new Error(String(error))
  try {
    report({ where, message: failure.message, stack: failure.stack ?? '', componentStack: componentStack ?? '' })
  } catch {
    // Reporting must not add a second failure to the first.
  }
}

/** Errors outside React's rendering (event handlers, timers, promises) go to the log as well. */
export function installUiErrorLogging(target: Pick<Window, 'addEventListener'> = window): void {
  target.addEventListener('error', (event) => reportUiError('window', (event as ErrorEvent).error ?? (event as ErrorEvent).message))
  target.addEventListener('unhandledrejection', (event) => reportUiError('promise', (event as PromiseRejectionEvent).reason))
}

interface ErrorBoundaryProps {
  /** Where this boundary stands, for the log. */
  where: string
  /** A new value tries the children again (the page changed, say). */
  resetKey?: unknown
  fallback: (error: Error, retry: () => void) => ReactNode
  onError?: (error: Error) => void
  children: ReactNode
}

interface ErrorBoundaryState {
  error: Error | null
  resetKey: unknown
}

/** One part of the window failing to draw leaves the rest of it, and says so. */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null, resetKey: this.props.resetKey }

  static getDerivedStateFromError(error: unknown): Partial<ErrorBoundaryState> {
    return { error: error instanceof Error ? error : new Error(String(error)) }
  }

  static getDerivedStateFromProps(props: ErrorBoundaryProps, state: ErrorBoundaryState): Partial<ErrorBoundaryState> | null {
    return props.resetKey === state.resetKey ? null : { error: null, resetKey: props.resetKey }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    reportUiError(this.props.where, error, info.componentStack)
    this.props.onError?.(error)
  }

  private readonly retry = (): void => this.setState({ error: null })

  override render(): ReactNode {
    return this.state.error ? this.props.fallback(this.state.error, this.retry) : this.props.children
  }
}

function DiagnosticActions() {
  const { t } = useOptionalI18n()
  const host = window.agentWorkspace?.desktop
  const [saved, setSaved] = useState<string | null>(null)
  if (!host) return null
  return (
    <>
      <button type="button" className="provider-secondary" onClick={() => void host.exportDiagnostics({}).then((path) => setSaved(path?.split(/[\\/]/).at(-1) ?? null), () => undefined)}>
        <FileText size={14} aria-hidden="true" />
        <span>{t('settings.about.exportDiagnostics')}</span>
      </button>
      <button type="button" className="provider-secondary" onClick={() => void host.openLogFolder()}>
        <FolderOpen size={14} aria-hidden="true" />
        <span>{t('settings.about.openLogs')}</span>
      </button>
      {saved ? <p className="crash-note" role="status">{t('settings.about.diagnosticsSaved', { name: saved })}</p> : null}
    </>
  )
}

/** The whole window failed: its title bar is gone too, so this page can move and close it. */
export function WindowCrash({ error }: { error: Error }) {
  const { t } = useOptionalI18n()
  return (
    <div className="window-crash" data-testid="window-crash">
      <div className="window-crash-bar">
        <button type="button" aria-label={t('workbench.close')} onClick={() => void window.agentWorkspace?.controlWindow?.('close')}>
          <X size={15} aria-hidden="true" />
        </button>
      </div>
      <main role="alert">
        <AlertTriangle size={26} aria-hidden="true" />
        <h1>{t('crash.window.title')}</h1>
        <p>{t('crash.window.body')}</p>
        <code>{error.message.slice(0, 300)}</code>
        <div className="provider-actions crash-actions">
          <button type="button" className="provider-primary" onClick={() => window.location.reload()}>
            <RotateCw size={14} aria-hidden="true" />
            <span>{t('crash.reload')}</span>
          </button>
          <DiagnosticActions />
        </div>
      </main>
    </div>
  )
}

/** One page failed: the rail, the sessions and the other pages still work. */
export function RouteCrash({ error, retry, onLeave }: { error: Error; retry: () => void; onLeave?: () => void }) {
  const { t } = useOptionalI18n()
  return (
    <main className="route-column reading-surface route-crash" data-testid="route-crash" role="alert">
      <AlertTriangle size={22} aria-hidden="true" />
      <h1>{t('crash.route.title')}</h1>
      <p>{t('crash.route.body')}</p>
      <code>{error.message.slice(0, 300)}</code>
      <div className="provider-actions crash-actions">
        <button type="button" className="provider-primary" onClick={retry}>
          <RotateCw size={14} aria-hidden="true" />
          <span>{t('crash.retry')}</span>
        </button>
        {onLeave ? <button type="button" className="provider-secondary" onClick={onLeave}>{t('crash.backToConversation')}</button> : null}
        <DiagnosticActions />
      </div>
    </main>
  )
}

/** A side panel failed: it stays in its place with a way to try again. */
export function PanelCrash({ retry, className }: { retry: () => void; className: string }) {
  const { t } = useOptionalI18n()
  return (
    <aside className={`${className} panel-crash provider-actions`} data-testid="panel-crash" role="alert">
      <p>{t('crash.panel')}</p>
      <button type="button" className="provider-secondary" onClick={retry}>
        <RotateCw size={14} aria-hidden="true" />
        <span>{t('crash.retry')}</span>
      </button>
    </aside>
  )
}

/** One entry of a conversation could not be drawn; the others still are. */
export function RowCrash() {
  const { t } = useOptionalI18n()
  return <p className="timeline-row-crash" data-testid="timeline-row-crash" role="note">{t('crash.row')}</p>
}

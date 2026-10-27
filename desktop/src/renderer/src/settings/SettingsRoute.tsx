import type { AppearanceState } from '../design/appearance'
import type { WorkbenchBridgeClient } from '../bridge/client'
import type { SettingsSectionContribution } from '../extensions/registry'
import { useI18n, type I18nValue } from '../i18n/I18nProvider'
import type { WorkbenchState } from '../state/workbench-store'
import { AboutSettings } from './AboutSettings'
import { AppearanceSettings } from './AppearanceSettings'
import { AutonomySettings } from './AutonomySettings'
import { LanguageSettings } from './LanguageSettings'
import { NotificationSettings } from './NotificationSettings'
import { VoiceSettings } from './VoiceSettings'
import { ShortcutSettings } from './ShortcutSettings'
import { ProviderRuntimeSettings } from './ProviderRuntimeSettings'
import { PromptOptimizationSettings } from './PromptOptimizationSettings'
import { SystemDoctorSettings } from './SystemDoctorSettings'
import { TaskLimitSettings } from './TaskLimitSettings'
import { UsageSettings } from './UsageSettings'
import { DeviceLinkSettings } from './DeviceLinkSettings'
import { InterfaceSettings } from './InterfaceSettings'
import type { InterfaceMode } from '../workbench/interface-mode'

type SettingsRegistry = { getSettingsSections(): SettingsSectionContribution[] }

interface SettingsRouteProps {
  state: WorkbenchState
  client?: WorkbenchBridgeClient
  appearance?: AppearanceState
  nativeStatus?: string
  onAppearanceChange?: (value: AppearanceState) => void
  registry?: SettingsRegistry
  layout?: 'stacked' | 'split'
  i18n?: I18nValue
  interfaceMode?: InterfaceMode
  onInterfaceModeChange?: (mode: InterfaceMode) => void
}

function SettingsRouteView({ state, client, appearance, nativeStatus, onAppearanceChange, registry, layout, i18n, interfaceMode, onInterfaceModeChange }: SettingsRouteProps & { i18n: I18nValue }) {
  const { t } = i18n
  const desktopHost = typeof window === 'undefined' ? undefined : window.agentWorkspace?.desktop
  const collectDiagnostics = async (): Promise<Record<string, unknown>> => {
    let doctor: unknown = null
    if (client?.runDoctor) {
      try { doctor = (await client.runDoctor()).payload } catch (error) { doctor = { error: String(error instanceof Error ? error.message : error).slice(0, 300) } }
    }
    // Facts only: no prompts, file contents, paths beyond the folder name, or credentials.
    return {
      locale: i18n.locale,
      viewport: typeof window === 'undefined' ? null : { width: window.innerWidth, height: window.innerHeight, scale: window.devicePixelRatio },
      runtime: {
        state: state.runtime.state,
        ready: state.runtime.ready,
        stale: state.runtime.stale,
        mode: state.runtime.mode,
        autonomy: state.runtime.autonomy,
        activeTurn: Boolean(state.runtime.activeTurn),
        queuedTurnCount: state.runtime.queuedTurnCount ?? 0,
        activeSessions: Object.keys(state.runtime.activeSessions ?? {}).length,
      },
      provider: state.provider ? { id: state.provider.id ?? null, protocol: state.provider.protocol ?? null, model: state.provider.model ?? null } : null,
      workspace: state.workspace ? { name: state.workspace.name ?? null } : null,
      sessionCount: state.sessions.length,
      timelineEvents: state.timeline.length,
      pendingApprovals: Object.keys(state.approvals).length,
      doctor,
    }
  }
  return (
    <main className="settings-column reading-surface" aria-label={t('settings.aria')} data-settings-layout={layout}>
      <header className="route-header">
        <div>
          <p className="section-kicker">{t('settings.kicker')}</p>
          <h1 tabIndex={-1}>{t('settings.title')}</h1>
        </div>
        <span className="route-context">{t('settings.context')}</span>
      </header>
      <div className="settings-route-content">
        <AutonomySettings state={state} client={client} i18n={i18n} />
        <LanguageSettings i18n={i18n} />
        {interfaceMode && onInterfaceModeChange ? <InterfaceSettings mode={interfaceMode} onChange={onInterfaceModeChange} i18n={i18n} /> : null}
        <ProviderRuntimeSettings state={state} client={client} i18n={i18n} />
      {typeof client?.getUsageBill === 'function' ? <UsageSettings client={client} i18n={i18n} /> : null}
      {client ? <TaskLimitSettings client={client} i18n={i18n} /> : null}
      {client ? <DeviceLinkSettings client={client} i18n={i18n} /> : null}
        <PromptOptimizationSettings state={state} client={client} i18n={i18n} />
        <SystemDoctorSettings client={client} i18n={i18n} />
        <NotificationSettings available={Boolean(desktopHost)} i18n={i18n} />
        {client ? <VoiceSettings client={client} i18n={i18n} /> : null}
        <ShortcutSettings i18n={i18n} />
        <AboutSettings host={desktopHost} i18n={i18n} collectDiagnostics={collectDiagnostics} />
        {appearance && onAppearanceChange ? (
          <AppearanceSettings
            appearance={appearance}
            nativeStatus={nativeStatus ?? t('settings.rendererOnly')}
            onChange={onAppearanceChange}
            i18n={i18n}
          />
        ) : null}
        {registry?.getSettingsSections().map((section) => {
          try {
            return <section key={section.id}>{section.render() as React.ReactNode}</section>
          } catch {
            return <p role="status" key={section.id}>{t('settings.extensionUnavailable', { title: section.title })}</p>
          }
        })}
      </div>
    </main>
  )
}

function LocalizedSettingsRoute(props: SettingsRouteProps) {
  return <SettingsRouteView {...props} i18n={useI18n()} />
}

export function SettingsRoute(props: SettingsRouteProps) {
  return props.i18n
    ? <SettingsRouteView {...props} i18n={props.i18n} />
    : <LocalizedSettingsRoute {...props} />
}

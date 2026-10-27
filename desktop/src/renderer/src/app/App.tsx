import { useEffect, useMemo, useState } from 'react'

import type { NativeAppearanceResult } from '../../../shared/appearance'
import {
  APPEARANCE_PALETTES,
  COLOR_MODES,
  DEFAULT_APPEARANCE,
  type AppearanceState,
  resolveAppearance,
} from '../design/appearance'
import { Workbench } from '../workbench/Workbench'
import type { WorkbenchBridgeClient } from '../bridge/client'
import { createContributionRegistry, type ContributionRegistry } from '../extensions/registry'
import { useI18n, type I18nValue } from '../i18n/I18nProvider'

export const APPEARANCE_STORAGE_KEY = 'agent-workspace.appearance.v2'

function loadAppearance(): AppearanceState {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(APPEARANCE_STORAGE_KEY) ?? 'null')
    if (!value || typeof value !== 'object') return DEFAULT_APPEARANCE
    const candidate = value as Partial<AppearanceState>
    if (
      !['liquid', 'mica', 'solid'].includes(candidate.mode ?? '') ||
      !COLOR_MODES.includes(candidate.colorMode as AppearanceState['colorMode']) ||
      !APPEARANCE_PALETTES.includes(candidate.palette as AppearanceState['palette']) ||
      typeof candidate.intensity !== 'number' ||
      typeof candidate.reduceMotion !== 'boolean' ||
      typeof candidate.highContrast !== 'boolean' ||
      (candidate.transparentDesktop !== undefined && typeof candidate.transparentDesktop !== 'boolean')
    ) {
      return DEFAULT_APPEARANCE
    }
    const resolved = resolveAppearance(candidate)
    return {
      mode: resolved.mode,
      colorMode: resolved.colorMode,
      palette: resolved.palette,
      intensity: resolved.intensity,
      reduceMotion: resolved.reduceMotion,
      highContrast: resolved.highContrast,
      transparentDesktop: resolved.transparentDesktop ?? false,
    }
  } catch {
    return DEFAULT_APPEARANCE
  }
}

function nativeStatusLabel(result: NativeAppearanceResult | null, t: I18nValue['t']): string {
  if (!result) return t('settings.native.rendererFallback')
  if (result.success) return t('settings.native.success', { material: result.appliedMaterial })
  if (result.appliedMaterial === 'unknown') return t('settings.native.unknown')
  return t('settings.native.fallback', { material: result.appliedMaterial })
}

export function App({ client, registry }: { client?: WorkbenchBridgeClient; registry?: ContributionRegistry }) {
  const i18n = useI18n()
  const [appearance, setAppearance] = useState<AppearanceState>(loadAppearance)
  const [nativeAppearance, setNativeAppearance] = useState<NativeAppearanceResult | null>(null)
  const [systemColorMode, setSystemColorMode] = useState<'dark' | 'light'>(() =>
    typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: light)').matches
      ? 'light'
      : 'dark',
  )
  const ownedRegistry = useMemo(createContributionRegistry, [])
  const contributionRegistry = registry ?? ownedRegistry
  const resolved = resolveAppearance(appearance)
  const renderedColorMode = appearance.colorMode === 'system' ? systemColorMode : appearance.colorMode

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const query = window.matchMedia('(prefers-color-scheme: light)')
    const update = (): void => setSystemColorMode(query.matches ? 'light' : 'dark')
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    const bridge = window.agentWorkspace
    if (!bridge?.setAppearance) return
    let current = true
    void bridge
      .setAppearance({ mode: appearance.mode, highContrast: appearance.highContrast,
        colorMode: appearance.colorMode, transparentDesktop: appearance.transparentDesktop })
      .then((result) => {
        if (current) setNativeAppearance(result)
      })
      .catch(() => {
        if (current) setNativeAppearance(null)
      })
    return () => {
      current = false
    }
  }, [appearance.highContrast, appearance.mode, appearance.colorMode, appearance.transparentDesktop])

  const updateAppearance = (nextAppearance: AppearanceState): void => {
    const next = resolveAppearance(nextAppearance)
    const stored: AppearanceState = {
      mode: next.mode,
      colorMode: next.colorMode,
      palette: next.palette,
      intensity: next.intensity,
      reduceMotion: next.reduceMotion,
      highContrast: next.highContrast,
      transparentDesktop: next.transparentDesktop,
    }
    setAppearance(stored)
    try {
      localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(stored))
    } catch {
      // Local preference persistence can be unavailable without blocking the workbench.
    }
  }

  return (
    <div
      className="app-shell"
      data-testid="app-shell"
      data-color-mode={renderedColorMode}
      data-palette={appearance.palette}
      data-material={resolved.effectiveMode}
      data-high-contrast={appearance.highContrast ? 'true' : 'false'}
      data-reduced-motion={appearance.reduceMotion ? 'true' : 'false'}
      data-desktop-transparent={resolved.effectiveTransparentDesktop ? 'true' : 'false'}
      style={{ '--appearance-intensity': appearance.intensity } as React.CSSProperties}
    >
      <Workbench
        client={client}
        registry={contributionRegistry}
        appearance={appearance}
        nativeStatus={nativeStatusLabel(nativeAppearance, i18n.t)}
        settingsI18n={i18n}
        onAppearanceChange={updateAppearance}
      />
    </div>
  )
}

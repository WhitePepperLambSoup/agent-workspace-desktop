import type { AppearanceMode } from '../../../shared/appearance'

export const APPEARANCE_PALETTES = [
  'polar',
  'verdigris',
  'amethyst',
  'cobalt',
  'garnet',
] as const

export const COLOR_MODES = ['dark', 'light', 'system'] as const

export const BACKDROPS = ['studio', 'field'] as const

export type AppearancePalette = (typeof APPEARANCE_PALETTES)[number]
/** What liquid glass shows behind the panes: the conversation's studio, or the drifting colour field. */
export type Backdrop = (typeof BACKDROPS)[number]
export type ColorMode = (typeof COLOR_MODES)[number]

export interface AppearanceState {
  mode: AppearanceMode
  colorMode: ColorMode
  palette: AppearancePalette
  intensity: number
  reduceMotion: boolean
  highContrast: boolean
  transparentDesktop: boolean
  /** Liquid glass bends the backdrop at the rims of panes and dialogs; absent means on. */
  refraction?: boolean
  /** Absent means the studio. */
  backdrop?: Backdrop
}

export interface ResolvedAppearance extends AppearanceState {
  effectiveMode: AppearanceMode
  effectiveTransparentDesktop: boolean
  animateOptics: boolean
  effectiveRefraction: boolean
  /** The studio only under liquid glass over the app's own backdrop; 'none' where no backdrop shows. */
  effectiveBackdrop: Backdrop | 'none'
}

export const DEFAULT_APPEARANCE: AppearanceState = Object.freeze({
  mode: 'liquid',
  colorMode: 'dark',
  palette: 'polar',
  intensity: 0.42,
  reduceMotion: false,
  highContrast: false,
  transparentDesktop: false,
})

export function resolveAppearance(input: Partial<AppearanceState> = {}): ResolvedAppearance {
  const appearance = { ...DEFAULT_APPEARANCE, ...input }
  const intensity = Math.min(1, Math.max(0, appearance.intensity))
  const effectiveMode = appearance.highContrast ? 'solid' : appearance.mode
  const effectiveTransparentDesktop = appearance.transparentDesktop && effectiveMode !== 'solid'

  return {
    ...appearance,
    intensity,
    effectiveMode,
    effectiveTransparentDesktop,
    animateOptics:
      effectiveMode === 'liquid' && !appearance.reduceMotion && !appearance.highContrast,
    // Over a see-through window the backdrop is the desktop, which the page cannot bend.
    effectiveRefraction:
      effectiveMode === 'liquid' && appearance.refraction !== false && !appearance.highContrast
      && !effectiveTransparentDesktop,
    effectiveBackdrop: effectiveMode !== 'liquid' ? 'none'
      : appearance.backdrop === 'field' || effectiveTransparentDesktop ? 'field' : 'studio',
  }
}

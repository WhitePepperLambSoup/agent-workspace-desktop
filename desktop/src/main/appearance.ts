import {
  type AppearanceMode,
  type NativeAppearanceRequest,
  type NativeAppearanceResult,
  type NativeColorMode,
  type NativeMaterial,
  nativeAppearanceRequestSchema,
} from '../shared/appearance'

export interface NativeAppearanceWindow {
  setBackgroundMaterial(material: NativeMaterial): void
}

export interface NativeAppearanceTheme {
  themeSource: NativeColorMode
}

export function effectiveAppearanceMode(request: NativeAppearanceRequest): AppearanceMode {
  return request.highContrast ? 'solid' : request.mode
}

export function materialForAppearance(request: NativeAppearanceRequest): NativeMaterial {
  const mode = effectiveAppearanceMode(request)
  if (mode === 'solid') return 'none'
  if (request.transparentDesktop) return 'acrylic'
  if (mode === 'liquid') return 'acrylic'
  if (mode === 'mica') return 'mica'
  return 'none'
}

export function applyNativeAppearance(
  window: NativeAppearanceWindow,
  input: NativeAppearanceRequest,
  nativeTheme?: NativeAppearanceTheme,
): NativeAppearanceResult {
  const request = nativeAppearanceRequestSchema.parse(input)
  const effectiveMode = effectiveAppearanceMode(request)
  const requestedMaterial = materialForAppearance(request)
  if (nativeTheme) nativeTheme.themeSource = request.colorMode

  try {
    window.setBackgroundMaterial(requestedMaterial)
    return {
      requestedMode: request.mode,
      effectiveMode,
      requestedMaterial,
      appliedMaterial: requestedMaterial,
      success: true,
    }
  } catch {
    let appliedMaterial: NativeAppearanceResult['appliedMaterial'] = 'unknown'
    if (requestedMaterial !== 'none') {
      try {
        window.setBackgroundMaterial('none')
        appliedMaterial = 'none'
      } catch {
        appliedMaterial = 'unknown'
      }
    }
    return {
      requestedMode: request.mode,
      effectiveMode,
      requestedMaterial,
      appliedMaterial,
      success: false,
      reason: 'native-material-unavailable',
    }
  }
}

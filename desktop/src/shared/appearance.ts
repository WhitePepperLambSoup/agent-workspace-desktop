import { z } from 'zod'

export const appearanceModeSchema = z.enum(['liquid', 'mica', 'solid'])
export const nativeMaterialSchema = z.enum(['acrylic', 'mica', 'none'])
export const nativeColorModeSchema = z.enum(['dark', 'light', 'system'])

export const nativeAppearanceRequestSchema = z
  .object({
    mode: appearanceModeSchema,
    highContrast: z.boolean(),
    transparentDesktop: z.boolean().default(false),
    colorMode: nativeColorModeSchema.default('system'),
  })
  .strict()

export const nativeAppearanceResultSchema = z
  .object({
    requestedMode: appearanceModeSchema,
    effectiveMode: appearanceModeSchema,
    requestedMaterial: nativeMaterialSchema,
    appliedMaterial: z.union([nativeMaterialSchema, z.literal('unknown')]),
    success: z.boolean(),
    reason: z.literal('native-material-unavailable').optional(),
  })
  .strict()

export type AppearanceMode = z.infer<typeof appearanceModeSchema>
// Older renderers can omit the new preferences; bridge parsing fills defaults.
export type NativeAppearanceRequest = z.input<typeof nativeAppearanceRequestSchema>
export type NativeAppearanceResult = z.infer<typeof nativeAppearanceResultSchema>
export type NativeMaterial = z.infer<typeof nativeMaterialSchema>
export type NativeColorMode = z.infer<typeof nativeColorModeSchema>

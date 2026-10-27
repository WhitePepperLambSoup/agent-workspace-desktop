import { z } from 'zod'

export const windowActionSchema = z.enum(['minimize', 'maximize', 'close'])
export const windowActionResultSchema = z
  .object({
    maximized: z.boolean(),
    closed: z.boolean(),
  })
  .strict()

export type WindowAction = z.infer<typeof windowActionSchema>
export type WindowActionResult = z.infer<typeof windowActionResultSchema>

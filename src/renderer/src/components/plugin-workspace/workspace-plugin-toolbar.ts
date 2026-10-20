import { z } from 'zod'

// A plugin describes its own controls; the host only renders registered panels.
export const workspaceToolbarSchema = z.object({
  enabled: z.boolean(),
  items: z
    .array(
      z.object({
        id: z.string().min(1).max(64),
        title: z.string().min(1).max(64),
        icon: z.string().max(64),
        width: z.number().int().min(280).max(640).optional(),
        height: z.number().int().min(280).max(720).optional(),
        status: z.enum(['idle', 'starting', 'ready', 'error', 'unverifiable']),
        description: z.string().max(256)
      })
    )
    .max(8),
  notices: z
    .array(z.object({ id: z.string().min(1).max(128), message: z.string().min(1).max(1000) }))
    .max(32)
    .optional()
})

export type WorkspaceToolbarItem = z.infer<typeof workspaceToolbarSchema>['items'][number]

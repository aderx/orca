import { z } from 'zod'
import { spec, WORKER_ONLY } from './plugin-host-method-spec'

// Fork-only actions preserve ownership without changing the upstream terminal.create contract.
const ownedTerminal = z.strictObject({ terminalId: z.string().min(1).max(4096) })
const ok = z.strictObject({ ok: z.literal(true) })
export const PLUGIN_OWNED_WORKSPACE_API = {
  'terminal.createOwned': spec({
    summary: 'Creates and focuses a terminal owned by this plugin in the active workspace.',
    since: 3,
    scope: 'active-workspace',
    capability: 'terminal:manage',
    mutation: true,
    surfaces: WORKER_ONLY,
    params: z.strictObject({
      worktreeId: z.string().min(1).max(4096),
      command: z.string().min(1).max(8192),
      title: z.string().min(1).max(256)
    }),
    result: z.strictObject({ handle: z.string() })
  }),
  'terminal.focusOwned': spec({
    summary: 'Focuses a terminal created by this plugin.',
    since: 3,
    scope: 'explicit-terminal',
    capability: 'terminal:manage',
    mutation: true,
    surfaces: WORKER_ONLY,
    params: ownedTerminal,
    result: ok
  }),
  'terminal.closeOwned': spec({
    summary: 'Closes a terminal created by this plugin after its execution host confirms exit.',
    since: 3,
    scope: 'explicit-terminal',
    capability: 'terminal:manage',
    mutation: true,
    surfaces: WORKER_ONLY,
    params: ownedTerminal,
    result: ok
  }),
  'browser.open': spec({
    summary: 'Opens an HTTP(S) browser tab in the active workspace.',
    since: 3,
    scope: 'active-workspace',
    capability: 'browser:open',
    mutation: true,
    surfaces: WORKER_ONLY,
    params: z.strictObject({
      worktreeId: z.string().min(1).max(4096),
      url: z
        .string()
        .url()
        .max(8192)
        .refine((value) => /^https?:\/\//i.test(value))
    }),
    result: z.strictObject({ browserPageId: z.string() })
  })
}

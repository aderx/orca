import { z } from 'zod'
import type { PluginHostMethodContext } from './workers/plugin-host-method-bind'

const created = z.object({ terminal: z.object({ handle: z.string() }) })
const closed = z.object({
  close: z.object({
    ptyStopVerdict: z.enum(['live', 'unverifiable', 'exited']).optional(),
    ptyStopReason: z.string().optional()
  })
})

export function pluginWorkspaceEffect(
  ctx: PluginHostMethodContext,
  method: string,
  params: unknown
): Promise<unknown> {
  if (!ctx.services.runtimeRpc) throw new Error('Runtime unavailable')
  ctx.scope.assertActive()
  return ctx.services.runtimeRpc(method, params, {
    signal: ctx.scope.signal,
    beforeEffect: () => ctx.scope.assertActive()
  })
}

export async function assertPluginActiveWorkspace(
  ctx: PluginHostMethodContext,
  worktreeId: string
): Promise<void> {
  const context = await ctx.services.resolveActiveWorktreeContext()
  if (!context || context.worktreeId !== worktreeId) {
    throw new Error('The worktree changed; return to its service tab and retry')
  }
}

/** Ownership lives with the host, never in a panel-supplied terminal handle. */
export class PluginOwnedTerminals {
  private readonly owners = new Map<string, string>()

  async create(
    ctx: PluginHostMethodContext,
    input: { worktreeId: string; command: string; title: string }
  ): Promise<{ handle: string }> {
    await assertPluginActiveWorkspace(ctx, input.worktreeId)
    const answer = await pluginWorkspaceEffect(ctx, 'terminal.create', {
      worktree: `id:${input.worktreeId}`,
      command: input.command,
      title: input.title,
      focus: true,
      presentation: 'focused',
      rendererBacked: true
    })
    const { handle } = created.parse(answer).terminal
    this.owners.set(handle, ctx.pluginId)
    return { handle }
  }

  private assertOwner(ctx: PluginHostMethodContext, terminalId: string): void {
    if (this.owners.get(terminalId) !== ctx.pluginId) {
      throw new Error('Terminal ownership is unavailable; use the original terminal tab')
    }
  }

  async focus(ctx: PluginHostMethodContext, terminalId: string): Promise<{ ok: true }> {
    this.assertOwner(ctx, terminalId)
    await pluginWorkspaceEffect(ctx, 'terminal.focus', { terminal: terminalId })
    return { ok: true }
  }

  async close(ctx: PluginHostMethodContext, terminalId: string): Promise<{ ok: true }> {
    this.assertOwner(ctx, terminalId)
    const result = closed.parse(
      await pluginWorkspaceEffect(ctx, 'terminal.close', { terminal: terminalId })
    ).close
    if (result.ptyStopVerdict === 'live' || result.ptyStopVerdict === 'unverifiable') {
      throw new Error(
        `Terminal stop is ${result.ptyStopVerdict}; ${result.ptyStopReason ?? 'retry on its execution host'}`
      )
    }
    this.owners.delete(terminalId)
    return { ok: true }
  }
}

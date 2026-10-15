import type { PluginRuntimeDelegate } from './plugin-host-service-bindings'

/** Ownership lives with the host, never in a panel-supplied terminal handle. */
export class PluginOwnedTerminals {
  private readonly owners = new Map<string, string>()

  async create(
    delegate: PluginRuntimeDelegate,
    pluginKey: string,
    input: { worktreeId: string; command: string; title: string }
  ): Promise<{ handle: string }> {
    if (!delegate.createTerminal) throw new Error('This host cannot create plugin terminals')
    const context = await delegate.resolveActiveWorktreeContext()
    if (!context || context.worktreeId !== input.worktreeId) {
      throw new Error('The worktree changed before launch; return to its service tab and retry')
    }
    const result = await delegate.createTerminal(`id:${input.worktreeId}`, {
      command: input.command,
      title: input.title,
      focus: true,
      rendererBacked: true
    })
    this.owners.set(result.handle, pluginKey)
    return { handle: result.handle }
  }

  async focus(
    delegate: PluginRuntimeDelegate,
    pluginKey: string,
    terminalId: string
  ): Promise<{ ok: true }> {
    if (this.owners.get(terminalId) !== pluginKey) {
      throw new Error('Terminal ownership is unavailable; open the original terminal tab')
    }
    if (!delegate.focusTerminal) throw new Error('This host cannot focus plugin terminals')
    await delegate.focusTerminal(terminalId)
    return { ok: true }
  }

  async close(
    delegate: PluginRuntimeDelegate,
    pluginKey: string,
    terminalId: string
  ): Promise<{ ok: true }> {
    if (this.owners.get(terminalId) !== pluginKey) {
      throw new Error('Terminal ownership is unavailable; close the original terminal tab')
    }
    if (!delegate.closeTerminal) throw new Error('This host cannot close plugin terminals')
    const result = await delegate.closeTerminal(terminalId)
    if (result.ptyStopVerdict === 'live' || result.ptyStopVerdict === 'unverifiable') {
      throw new Error(
        `Terminal stop is ${result.ptyStopVerdict}; ${result.ptyStopReason ?? 'retry on its execution host'}`
      )
    }
    this.owners.delete(terminalId)
    return { ok: true }
  }
}

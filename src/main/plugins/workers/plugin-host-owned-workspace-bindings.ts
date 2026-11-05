import { PLUGIN_HOST_API as api } from '../../../shared/plugins/workers/plugin-host-api'
import { bind, type PluginHostMethodContext } from './plugin-host-method-bind'
import { assertPluginActiveWorkspace, pluginWorkspaceEffect } from '../plugin-owned-terminals'

function owned(ctx: PluginHostMethodContext) {
  if (!ctx.services.ownedTerminals) throw new Error('Plugin terminal management unavailable')
  return ctx.services.ownedTerminals
}

export const PLUGIN_OWNED_WORKSPACE_HANDLERS = {
  'terminal.createOwned': bind(api['terminal.createOwned'], (params, ctx) =>
    owned(ctx).create(ctx, params)
  ),
  'terminal.focusOwned': bind(api['terminal.focusOwned'], (params, ctx) =>
    owned(ctx).focus(ctx, params.terminalId)
  ),
  'terminal.closeOwned': bind(api['terminal.closeOwned'], (params, ctx) =>
    owned(ctx).close(ctx, params.terminalId)
  ),
  'browser.open': bind(api['browser.open'], async (params, ctx) => {
    await assertPluginActiveWorkspace(ctx, params.worktreeId)
    return api['browser.open'].result.parse(
      await pluginWorkspaceEffect(ctx, 'browser.tabCreate', {
        worktree: `id:${params.worktreeId}`,
        url: params.url,
        activate: true,
        waitForRegistration: true
      })
    )
  })
}

import { describe, expect, it, vi } from 'vitest'
import { PluginOwnedTerminals } from './plugin-owned-terminals'
import { bindPluginHostServices } from './workers/plugin-host-service-bindings'
import { executePluginHostCall } from './workers/plugin-host-methods'
import type { PluginHostMethodContext } from './workers/plugin-host-method-bind'

function fixture() {
  const rpc = vi.fn(async (method: string) => {
    if (method === 'terminal.create') return { terminal: { handle: 't1' } }
    if (method === 'terminal.close') return { close: { ptyStopVerdict: 'exited' } }
    return { browserPageId: 'page-1' }
  })
  const terminals = new PluginOwnedTerminals()
  const services = bindPluginHostServices({
    delegate: {
      resolveActiveWorktreeContext: async () => ({
        worktreeId: 'w1',
        path: '/tmp/w1',
        branch: 'test',
        displayName: 'test'
      }),
      listTerminals: async () => ({ terminals: [] }),
      sendTerminal: async () => ({ accepted: true }),
      dispatchPluginNotification: async () => ({ delivered: true }),
      callRuntime: rpc
    },
    pluginsDataDir: '/tmp/unused-plugin-store',
    ownedTerminals: terminals
  })
  const ctx: PluginHostMethodContext = {
    pluginId: 'local.one',
    services,
    scope: { assertActive() {} }
  }
  const call = (method: string, params: unknown, pluginId = 'local.one') =>
    executePluginHostCall({
      pluginId,
      method,
      params,
      surface: 'worker',
      services,
      grantedCapabilities: ['terminal:manage', 'browser:open'],
      audit: { record: async () => {} }
    })
  return { rpc, terminals, ctx, call }
}
const launch = { worktreeId: 'w1', command: 'test', title: 'test' }

describe('workspace plugin extension authority', () => {
  it('refuses a delayed launch after focus changes', async () => {
    const { rpc, call } = fixture()
    expect(await call('terminal.createOwned', { ...launch, worktreeId: 'w2' })).toMatchObject({
      ok: false,
      error: expect.stringContaining('worktree changed')
    })
    expect(rpc).not.toHaveBeenCalled()
  })
  it('keeps focus and close authority with the creating plugin', async () => {
    const { call } = fixture()
    expect(await call('terminal.createOwned', launch)).toEqual({
      ok: true,
      value: { handle: 't1' }
    })
    expect(await call('terminal.focusOwned', { terminalId: 't1' }, 'local.two')).toMatchObject({
      ok: false
    })
    expect(await call('terminal.closeOwned', { terminalId: 't1' }, 'local.two')).toMatchObject({
      ok: false
    })
    expect(await call('terminal.focusOwned', { terminalId: 't1' })).toEqual({
      ok: true,
      value: { ok: true }
    })
    expect(await call('terminal.closeOwned', { terminalId: 't1' })).toEqual({
      ok: true,
      value: { ok: true }
    })
    expect(await call('terminal.closeOwned', { terminalId: 't1' })).toMatchObject({ ok: false })
  })
  it.each(['live', 'unverifiable'])('preserves retry authority after %s stop', async (verdict) => {
    const { rpc, terminals, ctx } = fixture()
    await terminals.create(ctx, launch)
    rpc.mockResolvedValueOnce({ close: { ptyStopVerdict: verdict } })
    await expect(terminals.close(ctx, 't1')).rejects.toThrow(verdict)
    await expect(terminals.close(ctx, 't1')).resolves.toEqual({ ok: true })
  })
  it('refuses non-web URLs, stale workspace targets and direct panel browser calls', async () => {
    const { rpc, call, ctx } = fixture()
    expect(await call('browser.open', { worktreeId: 'w1', url: 'file:///tmp/a' })).toMatchObject({
      ok: false,
      code: 'invalid_params'
    })
    expect(
      await call('browser.open', { worktreeId: 'w2', url: 'https://example.com' })
    ).toMatchObject({ ok: false })
    expect(
      await executePluginHostCall({
        pluginId: 'local.one',
        method: 'browser.open',
        params: { worktreeId: 'w1', url: 'https://example.com' },
        surface: 'panel',
        services: ctx.services,
        grantedCapabilities: ['browser:open']
      })
    ).toMatchObject({ ok: false })
    expect(rpc).not.toHaveBeenCalled()
  })
})

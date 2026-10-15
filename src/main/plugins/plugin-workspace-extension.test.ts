import { describe, expect, it, vi } from 'vitest'
import { PluginOwnedTerminals } from './plugin-owned-terminals'
import { bindPluginHostServices, type PluginRuntimeDelegate } from './plugin-host-service-bindings'
import { executePluginHostCall } from './plugin-host-methods'

function delegate(): PluginRuntimeDelegate {
  return {
    resolveActiveWorktreeContext: vi.fn().mockResolvedValue({
      worktreeId: 'w1',
      path: '/tmp/w1',
      branch: 'test',
      displayName: 'test'
    }),
    listTerminals: vi.fn().mockResolvedValue({ terminals: [] }),
    sendTerminal: vi.fn().mockResolvedValue({ accepted: true }),
    dispatchPluginNotification: vi.fn().mockResolvedValue({ delivered: true }),
    browserTabCreate: vi.fn().mockResolvedValue({ browserPageId: 'page-1' }),
    createTerminal: vi.fn().mockResolvedValue({ handle: 't1' }),
    focusTerminal: vi.fn().mockResolvedValue({}),
    closeTerminal: vi.fn().mockResolvedValue({ handle: 't1', tabId: 'tab1', ptyKilled: true })
  }
}
describe('workspace plugin extension authority', () => {
  it('does not redirect a delayed launch into the newly focused worktree', async () => {
    const runtime = delegate()
    const terminals = new PluginOwnedTerminals()
    await expect(
      terminals.create(runtime, 'local.one', { worktreeId: 'w2', command: 'test', title: 'test' })
    ).rejects.toThrow('worktree changed')
    expect(runtime.createTerminal).not.toHaveBeenCalled()
  })
  it('only reveals terminals created by the same plugin', async () => {
    const runtime = delegate()
    const terminals = new PluginOwnedTerminals()
    await terminals.create(runtime, 'local.one', {
      worktreeId: 'w1',
      command: 'test',
      title: 'test'
    })
    await expect(terminals.focus(runtime, 'local.two', 't1')).rejects.toThrow('ownership')
    await terminals.focus(runtime, 'local.one', 't1')
    expect(runtime.focusTerminal).toHaveBeenCalledExactlyOnceWith('t1')
  })
  it('closes only the authenticated plugin terminal and retires ownership after success', async () => {
    const runtime = delegate()
    const terminals = new PluginOwnedTerminals()
    await terminals.create(runtime, 'local.one', {
      worktreeId: 'w1',
      command: 'test',
      title: 'test'
    })
    await expect(terminals.close(runtime, 'local.two', 't1')).rejects.toThrow('ownership')
    expect(runtime.closeTerminal).not.toHaveBeenCalled()
    const services = bindPluginHostServices({
      delegate: runtime,
      pluginsDataDir: '/tmp/unused-plugin-store',
      subscribeEvents: () => [],
      extensions: { closeOwnedTerminal: (pluginId, id) => terminals.close(runtime, pluginId, id) }
    })
    const result = await executePluginHostCall({
      pluginId: 'local.one',
      method: 'terminal.closeOwned',
      params: { terminalId: 't1' },
      viaPanel: false,
      services,
      grantedCapabilities: ['terminal:manage'],
      audit: { record: vi.fn().mockResolvedValue(undefined) }
    })
    expect(result).toMatchObject({ ok: true, value: { ok: true } })
    expect(runtime.closeTerminal).toHaveBeenCalledExactlyOnceWith('t1')
    await expect(terminals.close(runtime, 'local.one', 't1')).rejects.toThrow('ownership')
  })
  it.each(['live', 'unverifiable'] as const)(
    'does not report %s termination as success or discard retry authority',
    async (verdict) => {
      const runtime = delegate()
      const close = vi
        .fn<NonNullable<PluginRuntimeDelegate['closeTerminal']>>()
        .mockResolvedValueOnce({
          handle: 't1',
          tabId: 'tab1',
          ptyKilled: false,
          ptyStopVerdict: verdict
        })
        .mockResolvedValueOnce({ handle: 't1', tabId: 'tab1', ptyKilled: true })
      runtime.closeTerminal = close
      const terminals = new PluginOwnedTerminals()
      await terminals.create(runtime, 'local.one', {
        worktreeId: 'w1',
        command: 'test',
        title: 'test'
      })
      await expect(terminals.close(runtime, 'local.one', 't1')).rejects.toThrow(verdict)
      await expect(terminals.close(runtime, 'local.one', 't1')).resolves.toEqual({ ok: true })
    }
  )
  it('binds panel command calls to authenticated plugin identity and preserves capability gate', async () => {
    const invoke = vi.fn().mockResolvedValue({ ok: true })
    const services = bindPluginHostServices({
      delegate: delegate(),
      pluginsDataDir: '/tmp/unused-plugin-store',
      subscribeEvents: () => [],
      extensions: { invokeOwnCommand: invoke }
    })
    const base = {
      pluginId: 'local.one',
      method: 'commands.invoke',
      params: { commandId: 'probe', args: { x: 1 } },
      viaPanel: true,
      services,
      audit: { record: vi.fn().mockResolvedValue(undefined) }
    }
    const denied = await executePluginHostCall({ ...base, grantedCapabilities: [] })
    expect(denied).toMatchObject({ ok: false, code: 'capability_denied' })
    expect(invoke).not.toHaveBeenCalled()
    const allowed = await executePluginHostCall({
      ...base,
      grantedCapabilities: ['commands:invoke']
    })
    expect(allowed).toMatchObject({ ok: true })
    expect(invoke).toHaveBeenCalledExactlyOnceWith('local.one', 'probe', { x: 1 })
  })
})


describe('plugin browser tabs', () => {
  function setup() {
    const runtime = delegate()
    const services = bindPluginHostServices({
      delegate: runtime,
      pluginsDataDir: '/tmp/unused-plugin-store',
      subscribeEvents: () => []
    })
    const audit = { record: vi.fn().mockResolvedValue(undefined) }
    const base = {
      pluginId: 'local.one', method: 'browser.open', viaPanel: false, services, audit,
      params: { worktreeId: 'w1', url: 'http://192.0.2.1:5000' }
    }
    return { runtime, base }
  }
  it('requires separate consent and audits an open in the explicit worktree', async () => {
    const { runtime, base } = setup()
    await expect(executePluginHostCall({ ...base, grantedCapabilities: ['workspace:read'] }))
      .resolves.toMatchObject({ ok: false, code: 'capability_denied' })
    expect(runtime.browserTabCreate).not.toHaveBeenCalled()
    await expect(executePluginHostCall({ ...base, grantedCapabilities: ['browser:open'] }))
      .resolves.toEqual({ ok: true, value: { browserPageId: 'page-1' } })
    expect(runtime.browserTabCreate).toHaveBeenCalledExactlyOnceWith({
      worktree: 'id:w1', url: 'http://192.0.2.1:5000', activate: true, waitForRegistration: true
    })
    expect(base.audit.record).toHaveBeenCalledWith(expect.objectContaining({
      actor: 'plugin:local.one', method: 'browser.open', outcome: 'ok'
    }))
  })
  it('rejects delayed opens when focus moved to another worktree', async () => {
    const { runtime, base } = setup()
    const result = await executePluginHostCall({
      ...base, params: { ...base.params, worktreeId: 'w2' }, grantedCapabilities: ['browser:open']
    })
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('worktree changed') })
    expect(runtime.browserTabCreate).not.toHaveBeenCalled()
  })
  it('rejects non-web URLs and direct sandbox panel calls before creating a tab', async () => {
    const { runtime, base } = setup()
    for (const url of ['javascript:alert(1)', 'file:///tmp/local', 'orca://settings', 'not a url']) {
      await expect(executePluginHostCall({
        ...base, params: { ...base.params, url }, grantedCapabilities: ['browser:open']
      })).resolves.toMatchObject({ ok: false, code: 'invalid_params' })
    }
    await expect(executePluginHostCall({
      ...base, viaPanel: true, grantedCapabilities: ['browser:open']
    })).resolves.toMatchObject({ ok: false })
    expect(runtime.browserTabCreate).not.toHaveBeenCalled()
  })
})

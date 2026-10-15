import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ state: {} as any, catalog: {} as any, invoke: vi.fn() }))
vi.mock('@/store', () => ({ useAppStore: { getState: () => mocks.state } }))
vi.mock('@/store/plugin-panels', () => ({
  usePluginPanelsStore: { getState: () => mocks.catalog }
}))
vi.mock('./plugin-workspace-context', () => ({
  pluginWorkspaceContext: (state: any, id: string) =>
    state.host === 'local'
      ? { worktreeId: id, path: '/work/' + id, executionHostId: 'local' }
      : null
}))
import {
  canProbeInitialPluginPanel,
  openInitialPluginWorkspacePanel,
  resolveWorkspacePluginPanel
} from './initial-plugin-workspace-panel'

beforeEach(() => {
  mocks.invoke.mockReset()
  mocks.state = {
    activeWorktreeId: 'one',
    activeWorkspaceKey: 'worktree:one',
    activeWorkspaceExecutionHostId: 'local',
    setActiveWorktree: vi.fn((id) => {
      mocks.state.activeWorktreeId = id
    }),
    host: 'local',
    settings: { pluginSystemEnabled: true },
    openFiles: [],
    unifiedTabsByWorktree: {},
    activateTab: vi.fn(),
    setActiveFile: vi.fn(),
    setActiveTabType: vi.fn(),
    openFile: vi.fn((file) => mocks.state.openFiles.push(file))
  }
  mocks.catalog = {
    fetchStatus: 'ready',
    plugins: [
      {
        status: 'running',
        pluginKey: 'local.test',
        panels: [{ id: 'services', tabKey: 'test.services', title: '服务' }],
        commands: [{ id: 'workspace-panel.services.probe', handler: { type: 'worker' } }]
      }
    ]
  }
  vi.stubGlobal('window', {
    api: {
      plugins: { invokeCommand: mocks.invoke, list: vi.fn(async () => mocks.catalog.plugins) }
    }
  })
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})
describe('plugin initial surface', () => {
  it('deduplicates concurrent activation and watcher probes', async () => {
    mocks.invoke.mockResolvedValue({ supported: true })
    expect(
      await Promise.all([
        openInitialPluginWorkspacePanel('one'),
        openInitialPluginWorkspacePanel('one')
      ])
    ).toEqual([true, true])
    expect(mocks.invoke).toHaveBeenCalledTimes(1)
    expect(mocks.state.openFile).toHaveBeenCalledTimes(1)
    expect(await openInitialPluginWorkspacePanel('one')).toBe(true)
    expect(mocks.state.openFile).toHaveBeenCalledTimes(1)
  })
  it('leaves ordinary and remote workspaces on their existing terminal path', async () => {
    mocks.invoke.mockResolvedValue({ supported: false })
    expect(await openInitialPluginWorkspacePanel('one')).toBe(false)
    mocks.state.host = 'ssh:one'
    expect(canProbeInitialPluginPanel('one')).toBe(false)
    expect(mocks.state.openFile).not.toHaveBeenCalled()
  })
  it('does not create a late panel after the user switches worktree', async () => {
    let resolve!: (value: unknown) => void
    mocks.invoke.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done
        })
    )
    const pending = openInitialPluginWorkspacePanel('one')
    mocks.state.activeWorktreeId = 'two'
    resolve({ supported: true })
    expect(await pending).toBe(false)
    expect(mocks.state.openFile).not.toHaveBeenCalled()
  })
  it('falls back on worker failure and timeout, ignoring late results', async () => {
    mocks.invoke.mockRejectedValueOnce(new Error('worker failed'))
    expect(await openInitialPluginWorkspacePanel('one')).toBe(false)
    vi.useFakeTimers()
    let resolve!: (value: unknown) => void
    mocks.invoke.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done
        })
    )
    const pending = openInitialPluginWorkspacePanel('one')
    await vi.advanceTimersByTimeAsync(4001)
    expect(await pending).toBe(false)
    resolve({ supported: true })
    await Promise.resolve()
    expect(mocks.state.openFile).not.toHaveBeenCalled()
  })
  it('does not request disabled plugins', async () => {
    mocks.state.settings.pluginSystemEnabled = false
    expect(await openInitialPluginWorkspacePanel('one')).toBe(false)
    expect(mocks.invoke).not.toHaveBeenCalled()
  })
})

it('toolbar discovery does not open a page and closing it leaves it reopenable', async () => {
  mocks.invoke.mockResolvedValue({ supported: true })
  expect(await resolveWorkspacePluginPanel('one')).toMatchObject({ title: '服务' })
  expect(mocks.state.openFile).not.toHaveBeenCalled()
  await openInitialPluginWorkspacePanel('one', true)
  mocks.state.openFiles = []
  await openInitialPluginWorkspacePanel('one', true)
  expect(mocks.state.openFile).toHaveBeenCalledTimes(2)
})
it('explicit toolbar activation focuses the existing tab in its split group', async () => {
  mocks.invoke.mockResolvedValue({ supported: true })
  await openInitialPluginWorkspacePanel('one')
  mocks.state.openFiles[0].id = 'file-one'
  mocks.state.unifiedTabsByWorktree.one = [
    { id: 'tab-in-other-group', entityId: 'file-one', contentType: 'editor' }
  ]
  await openInitialPluginWorkspacePanel('one', true)
  expect(mocks.state.activateTab).toHaveBeenCalledWith('tab-in-other-group', { worktreeId: 'one' })
  expect(mocks.state.openFile).toHaveBeenCalledTimes(1)
})

it('reactivates the retained worktree only after an explicit click from the empty page', async () => {
  mocks.state.activeWorktreeId = null
  mocks.invoke.mockResolvedValue({ supported: true })
  expect(await resolveWorkspacePluginPanel('one')).toMatchObject({ title: '服务' })
  expect(await openInitialPluginWorkspacePanel('one')).toBe(false)
  expect(mocks.state.setActiveWorktree).not.toHaveBeenCalled()
  expect(mocks.state.openFile).not.toHaveBeenCalled()
  expect(await openInitialPluginWorkspacePanel('one', true)).toBe(true)
  expect(mocks.state.setActiveWorktree).toHaveBeenCalledWith('one', 'local')
  expect(mocks.state.openFile).toHaveBeenCalledTimes(1)
})
it('does not restore the previous sidebar selection after a late probe', async () => {
  mocks.state.activeWorktreeId = null
  let resolve!: (value: unknown) => void
  mocks.invoke.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done
      })
  )
  const result = openInitialPluginWorkspacePanel('one', true)
  mocks.state.activeWorkspaceKey = 'worktree:two'
  resolve({ supported: true })
  expect(await result).toBe(false)
  expect(mocks.state.setActiveWorktree).not.toHaveBeenCalled()
  expect(mocks.state.openFile).not.toHaveBeenCalled()
})

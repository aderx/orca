// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
const mocks = vi.hoisted(() => {
  const state: {
    activeWorktreeId: string | null
    activeWorkspaceKey: string
    activeWorkspaceExecutionHostId: string
    worktreesByRepo: {}
    settings: { pluginSystemEnabled: boolean }
  } = {
    activeWorktreeId: 'one',
    activeWorkspaceKey: 'worktree:one',
    activeWorkspaceExecutionHostId: 'local',
    worktreesByRepo: {},
    settings: { pluginSystemEnabled: true }
  }
  return {
    state,
    plugins: [],
    discover: vi.fn(),
    open: vi.fn()
  }
})
vi.mock('@/store', () => ({
  useAppStore: Object.assign(
    (selector: (state: typeof mocks.state) => unknown) => selector(mocks.state),
    { getState: () => mocks.state }
  )
}))
vi.mock('@/store/plugin-panels', () => ({
  usePluginPanelsStore: (selector: (state: { plugins: unknown[] }) => unknown) =>
    selector({ plugins: mocks.plugins })
}))
vi.mock('./initial-plugin-workspace-panel', () => ({
  resolveWorkspacePluginPanel: mocks.discover,
  openInitialPluginWorkspacePanel: mocks.open
}))
vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => children,
  TooltipTrigger: ({ children }: { children: ReactNode }) => children,
  TooltipContent: () => null
}))
import { WorkspacePluginButton } from './WorkspacePluginButton'
import { WorkspacePluginTabIcon } from './WorkspacePluginTabIcon'
beforeEach(() => {
  mocks.discover.mockReset().mockResolvedValue({ title: '服务', icon: 'Plug' })
  mocks.open.mockReset().mockResolvedValue(true)
  mocks.state.settings.pluginSystemEnabled = true
  mocks.state.activeWorktreeId = 'one'
  mocks.state.activeWorkspaceKey = 'worktree:one'
  mocks.state.activeWorkspaceExecutionHostId = 'local'
})
afterEach(cleanup)
it('keeps a reopenable toolbar entry without opening a tab during discovery', async () => {
  const view = render(<WorkspacePluginButton worktreeId="one" />)
  const button = await screen.findByRole('button', { name: '服务' })
  expect(mocks.open).not.toHaveBeenCalled()
  expect(button.querySelector('svg')?.classList.contains('lucide-plug')).toBe(true)
  fireEvent.click(button)
  await waitFor(() => expect(mocks.open).toHaveBeenCalledWith('one', true))
  view.rerender(<WorkspacePluginButton worktreeId="one" />)
  expect(screen.getByRole('button', { name: '服务' })).toBe(button)
})
it('does not expose the entry on an unsupported worktree', async () => {
  mocks.discover.mockResolvedValue(null)
  render(<WorkspacePluginButton worktreeId="one" />)
  await waitFor(() => expect(mocks.discover).toHaveBeenCalled())
  expect(screen.queryByRole('button')).toBe(null)
})
it('uses the same plug icon for the workspace tab fallback', () => {
  const view = render(
    <WorkspacePluginTabIcon tabKey="plugin:local.test/services" className="size-4" />
  )
  expect(view.container.querySelector('svg')?.classList.contains('lucide-plug')).toBe(true)
})

it('uses retained sidebar selection when the last tab has closed', async () => {
  mocks.state.activeWorktreeId = null
  render(<WorkspacePluginButton />)
  const button = await screen.findByRole('button', { name: '服务' })
  expect(button.textContent).toBe('服务')
  expect(mocks.discover).toHaveBeenCalledWith('one')
  expect(mocks.open).not.toHaveBeenCalled()
  fireEvent.click(button)
  await waitFor(() => expect(mocks.open).toHaveBeenCalledWith('one', true))
})
it('does not recover a sidebar selection belonging to a remote host', () => {
  mocks.state.activeWorktreeId = null
  mocks.state.activeWorkspaceExecutionHostId = 'ssh:other'
  render(<WorkspacePluginButton />)
  expect(screen.queryByRole('button')).toBe(null)
  expect(mocks.discover).not.toHaveBeenCalled()
})

vi.mock('../../app-shell/app-window-chrome', () => ({ hasCustomTitleBar: false }))
vi.mock('../activity/ActivityTitlebarControls', () => ({ ActivityTitlebarControls: () => null }))
vi.mock('../../hooks/useShortcutLabel', () => ({ useShortcutLabel: () => '' }))
import { TitlebarMainStrip } from '../../app-shell/TitlebarMainStrip'
import type { AppChromeLayout } from '../../app-shell/use-app-chrome-layout'

function emptyWorkspaceLayout(rightSidebarOpen: boolean): AppChromeLayout {
  return {
    activeView: 'terminal',
    activeWorktreeId: null,
    activePendingCreationId: null,
    activeTabCanExpand: false,
    effectiveActiveTabId: null,
    collapsedSidebarHeaderWidth: 0,
    creationLayoutActive: false,
    isFullScreen: false,
    leftSidebarStyle: undefined,
    leftTitlebarChromeLayout: { shouldMount: true, isFloating: false },
    rightSidebarExplorerView: 'files',
    rightSidebarOpen,
    rightSidebarTab: 'explorer',
    shouldMountTerminalWorkbench: true,
    showSidebar: true,
    showRightSidebarControls: true,
    showTitlebarAppName: true,
    showTitlebarExpandButton: false,
    sidebarOpen: true,
    stackedSidebarOpen: true,
    terminalWorkbenchVisible: false,
    titlebarLeftControlsRef: { current: null },
    workspaceChromeActive: false
  }
}
it.each([true, false])(
  'mounts the service entry in empty-page chrome with sidebar open=%s',
  async (rightSidebarOpen) => {
    mocks.state.activeWorktreeId = null
    render(<TitlebarMainStrip layout={emptyWorkspaceLayout(rightSidebarOpen)} />)
    const button = await screen.findByRole('button', { name: '服务' })
    fireEvent.click(button)
    await waitFor(() => expect(mocks.open).toHaveBeenCalledWith('one', true))
  }
)

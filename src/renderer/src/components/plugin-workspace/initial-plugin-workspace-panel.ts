import { selectedPluginWorktreeId } from './selected-plugin-worktree'
import { useAppStore } from '@/store'
import { usePluginPanelsStore } from '@/store/plugin-panels'
import { pluginWorkspaceContext } from './plugin-workspace-context'
import { isWorkspacePluginPanel } from './workspace-plugin-panels'

type WorkspacePanel = {
  filePath: string
  path: string
  tabKey: string
  title: string
  icon?: string
  toolbar?: boolean
}
const pending = new Map<string, Promise<WorkspacePanel | null>>()
const probeTimeoutMs = 4000

export function canProbeInitialPluginPanel(worktreeId: string): boolean {
  if (typeof window === 'undefined' || !window.api?.plugins) return false
  const state = useAppStore.getState()
  if (state.settings?.pluginSystemEnabled === false || !pluginWorkspaceContext(state, worktreeId))
    return false
  const catalog = usePluginPanelsStore.getState()
  return (
    catalog.fetchStatus !== 'ready' ||
    catalog.plugins.some(
      (plugin) =>
        ['running', 'idle', 'restarting'].includes(plugin.status) &&
        plugin.panels.some((panel) => isWorkspacePluginPanel(plugin, panel.id))
    )
  )
}

/** Read-only discovery is shared by automatic tabs and the persistent toolbar entry. */
export function resolveWorkspacePluginPanel(worktreeId: string): Promise<WorkspacePanel | null> {
  if (!canProbeInitialPluginPanel(worktreeId)) return Promise.resolve(null)
  const context = pluginWorkspaceContext(useAppStore.getState(), worktreeId)
  if (!context) return Promise.resolve(null)
  const key = `${worktreeId}:${context.path}`
  const existing = pending.get(key)
  if (existing) return existing
  let expired = false
  let timer: ReturnType<typeof setTimeout>
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      expired = true
      resolve(null)
    }, probeTimeoutMs)
  })
  const probe = async (): Promise<WorkspacePanel | null> => {
    const catalog = usePluginPanelsStore.getState()
    const plugins =
      catalog.fetchStatus === 'ready' ? catalog.plugins : await window.api.plugins.list()
    for (const plugin of plugins) {
      if (!['running', 'idle', 'restarting'].includes(plugin.status)) continue
      for (const panel of plugin.panels) {
        if (!isWorkspacePluginPanel(plugin, panel.id)) continue
        const filePath = `orca-plugin-workspace:${encodeURIComponent(worktreeId)}:${panel.tabKey}`
        const descriptor = {
          filePath,
          path: context.path,
          tabKey: panel.tabKey,
          title: panel.title,
          icon: panel.icon
        }
        const result: unknown = await window.api.plugins.invokeCommand({
          pluginKey: plugin.pluginKey,
          commandId: `workspace-panel.${panel.id}.probe`,
          args: { context }
        })
        if (
          !result ||
          typeof result !== 'object' ||
          !('supported' in result) ||
          result.supported !== true
        )
          continue
        const state = useAppStore.getState()
        const current = pluginWorkspaceContext(state, worktreeId)
        if (
          expired ||
          selectedPluginWorktreeId(state) !== worktreeId ||
          current?.path !== context.path ||
          state.settings?.pluginSystemEnabled === false
        )
          return null
        return { ...descriptor, toolbar: 'toolbar' in result && result.toolbar === true }
      }
    }
    return null
  }
  const result = Promise.race([probe().catch(() => null), timeout]).finally(() => {
    clearTimeout(timer)
    pending.delete(key)
  })
  pending.set(key, result)
  return result
}

export async function openInitialPluginWorkspacePanel(
  worktreeId: string,
  focus = false
): Promise<boolean> {
  const panel = await resolveWorkspacePluginPanel(worktreeId)
  let state = useAppStore.getState()
  if (
    !panel ||
    (focus ? selectedPluginWorktreeId(state) : state.activeWorktreeId) !== worktreeId ||
    pluginWorkspaceContext(state, worktreeId)?.path !== panel.path ||
    !canProbeInitialPluginPanel(worktreeId)
  )
    return false
  if (focus && state.activeWorktreeId === null) {
    state.setActiveWorktree(worktreeId, 'local')
    state = useAppStore.getState()
    if (state.activeWorktreeId !== worktreeId) return false
  }
  if (panel.toolbar && !focus) return true
  const existing = state.openFiles.find((file) => file.filePath === panel.filePath)
  if (!existing) {
    state.openFile({
      filePath: panel.filePath,
      relativePath: panel.title,
      worktreeId,
      language: 'plaintext',
      mode: 'plugin-panel',
      readOnly: true,
      runtimeEnvironmentId: null,
      pluginPanel: { tabKey: panel.tabKey }
    })
  } else if (focus) {
    // Focus the existing split group as well as its file; never duplicate the service tab.
    const tab = state.unifiedTabsByWorktree[worktreeId]?.find(
      (item) => item.entityId === existing.id && item.contentType === 'editor'
    )
    if (tab) state.activateTab(tab.id, { worktreeId })
    else {
      state.setActiveFile(existing.id)
      state.setActiveTabType('editor', worktreeId)
    }
  }
  return true
}

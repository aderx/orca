import { useEffect } from 'react'
import { useAppStore } from '@/store'
import { usePluginPanelsStore, ensurePluginPanelsLoaded } from '@/store/plugin-panels'
import { openInitialPluginWorkspacePanel } from './initial-plugin-workspace-panel'

export function usePluginWorkspacePanels(): void {
  const worktreeId = useAppStore((state) => state.activeWorktreeId)
  const worktrees = useAppStore((state) => state.worktreesByRepo)
  const repos = useAppStore((state) => state.repos)
  const activeHost = useAppStore((state) => state.activeWorkspaceExecutionHostId)
  const plugins = usePluginPanelsStore((state) => state.plugins)
  useEffect(() => ensurePluginPanelsLoaded(), [])
  useEffect(() => {
    if (worktreeId) void openInitialPluginWorkspacePanel(worktreeId)
  }, [worktreeId, worktrees, repos, activeHost, plugins])
}

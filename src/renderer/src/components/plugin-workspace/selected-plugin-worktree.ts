import type { AppState } from '@/store/types'
import { getActiveSidebarWorkspaceId } from '../../../../shared/workspace-scope'

export function selectedPluginWorktreeId(
  state: Pick<
    AppState,
    'activeWorktreeId' | 'activeWorkspaceKey' | 'activeWorkspaceExecutionHostId'
  >
): string | null {
  if (state.activeWorktreeId) return state.activeWorktreeId
  // Closing the final tab retains sidebar selection; never recover it on another host.
  if (state.activeWorkspaceExecutionHostId && state.activeWorkspaceExecutionHostId !== 'local')
    return null
  return getActiveSidebarWorkspaceId(state.activeWorkspaceKey, null)
}

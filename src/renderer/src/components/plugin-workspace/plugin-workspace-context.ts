import type { AppState } from '@/store/types'
import { getResolvedExecutionHostIdForWorktree } from '@/lib/resolved-worktree-execution-host'
import { getIndexedWorktreeMap } from '@/store/worktree-repo-index'

export type PluginWorkspaceContext = {
  worktreeId: string
  path: string
  executionHostId: 'local'
}

export function pluginWorkspaceContext(
  state: AppState,
  worktreeId: string
): PluginWorkspaceContext | null {
  if (getResolvedExecutionHostIdForWorktree(state, worktreeId) !== 'local') return null
  const worktree = getIndexedWorktreeMap(state.worktreesByRepo).get(worktreeId)
  return worktree ? { worktreeId, path: worktree.path, executionHostId: 'local' } : null
}

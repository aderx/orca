import React from 'react'
import { useAppStore } from '@/store'
import PluginPanel from '../right-sidebar/PluginPanel'
import { pluginWorkspaceContext } from './plugin-workspace-context'

export function PluginWorkspacePanel({
  tabKey,
  worktreeId,
  isVisible = true
}: {
  tabKey: string
  worktreeId: string
  isVisible?: boolean
}): React.JSX.Element {
  const [opened, setOpened] = React.useState(isVisible)
  React.useEffect(() => {
    if (isVisible) setOpened(true)
  }, [isVisible])
  const worktrees = useAppStore((state) => state.worktreesByRepo)
  const repos = useAppStore((state) => state.repos)
  const host = useAppStore((state) => state.activeWorkspaceExecutionHostId)
  const context = React.useMemo(
    () => pluginWorkspaceContext(useAppStore.getState(), worktreeId),
    [worktreeId, worktrees, repos, host]
  )
  if (!opened) return <></>
  if (!context)
    return (
      <div className="p-6 text-sm text-muted-foreground">此插件页仅支持已连接的本机工作树。</div>
    )
  return <PluginPanel key={worktreeId} tabKey={tabKey} workspaceContext={context} isVisible={isVisible} />
}

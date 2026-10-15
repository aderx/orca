import { selectedPluginWorktreeId } from './selected-plugin-worktree'
import { createElement, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { usePluginPanelsStore } from '@/store/plugin-panels'
import { Button } from '@/components/ui/button'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { resolvePluginPanelIcon } from '../right-sidebar/plugin-panel-activity-items'
import {
  openInitialPluginWorkspacePanel,
  resolveWorkspacePluginPanel
} from './initial-plugin-workspace-panel'

export function WorkspacePluginButton({
  worktreeId: requestedWorktreeId,
  presentation = 'button'
}: {
  worktreeId?: string
  presentation?: 'button' | 'menu'
}): React.JSX.Element | null {
  const plugins = usePluginPanelsStore((state) => state.plugins)
  const worktrees = useAppStore((state) => state.worktreesByRepo)
  const selectedWorktreeId = useAppStore(selectedPluginWorktreeId)
  const worktreeId = requestedWorktreeId ?? selectedWorktreeId
  const activeHost = useAppStore((state) => state.activeWorkspaceExecutionHostId)
  const enabled = useAppStore((state) => state.settings?.pluginSystemEnabled)
  const [entry, setEntry] = useState<{ worktreeId: string; title: string; icon?: string } | null>(
    null
  )
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let cancelled = false
    setEntry(null)
    if (enabled && worktreeId && selectedWorktreeId === worktreeId) {
      void resolveWorkspacePluginPanel(worktreeId).then((panel) => {
        if (!cancelled && panel) setEntry({ worktreeId, title: panel.title, icon: panel.icon })
      })
    }
    return () => {
      cancelled = true
    }
  }, [worktreeId, selectedWorktreeId, activeHost, worktrees, plugins, enabled])
  if (
    !enabled ||
    !worktreeId ||
    !entry ||
    entry.worktreeId !== worktreeId ||
    selectedWorktreeId !== worktreeId
  )
    return null
  const label = entry.title
  const open = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      const opened = await openInitialPluginWorkspacePanel(worktreeId, true)
      if (!opened && selectedPluginWorktreeId(useAppStore.getState()) === worktreeId)
        toast.error(`${label}暂不可用，请刷新插件后重试`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }
  if (presentation === 'menu')
    return (
      <DropdownMenuItem
        disabled={busy}
        onSelect={() => void open()}
        className="gap-2 rounded-[7px] px-2 py-1.5 text-[12px] leading-5 font-medium"
      >
        {createElement(resolvePluginPanelIcon(entry.icon), {
          className: 'size-4 text-muted-foreground',
          'aria-hidden': true
        })}
        {label}
      </DropdownMenuItem>
    )
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="[-webkit-app-region:no-drag]"
          aria-label={label}
          disabled={busy}
          onClick={() => void open()}
        >
          {createElement(resolvePluginPanelIcon(entry.icon), {
            className: 'size-4',
            'aria-hidden': true
          })}
          {label}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

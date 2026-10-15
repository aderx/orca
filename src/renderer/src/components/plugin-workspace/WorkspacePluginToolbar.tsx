import { createElement, useEffect, useMemo, useState } from 'react'
import { useAppStore } from '@/store'
import { usePluginPanelsStore } from '@/store/plugin-panels'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import PluginPanel from '../right-sidebar/PluginPanel'
import { resolvePluginPanelIcon } from '../right-sidebar/plugin-panel-activity-items'
import { selectedPluginWorktreeId } from './selected-plugin-worktree'
import { pluginWorkspaceContext } from './plugin-workspace-context'
import { workspaceToolbarSchema, type WorkspaceToolbarItem } from './workspace-plugin-toolbar'
import { useWorkspaceToolbarPopoverState } from './workspace-toolbar-popover-state'

type Entry = WorkspaceToolbarItem & { pluginKey: string; tabKey: string }
const statusDot = {
  idle: '',
  starting: 'bg-status-warning motion-safe:animate-pulse',
  ready: 'bg-status-success',
  error: 'bg-destructive',
  unverifiable: 'bg-muted-foreground'
}

export function WorkspacePluginToolbar({
  worktreeId: requestedWorktreeId
}: { worktreeId?: string } = {}): React.JSX.Element | null {
  const selectedWorktreeId = useAppStore(selectedPluginWorktreeId)
  const worktreeId = requestedWorktreeId ?? selectedWorktreeId
  const worktreePath = useAppStore((state) =>
    worktreeId ? pluginWorkspaceContext(state, worktreeId)?.path : undefined
  )
  const activeHost = useAppStore((state) => state.activeWorkspaceExecutionHostId)
  const enabled = useAppStore((state) => state.settings?.pluginSystemEnabled)
  const plugins = usePluginPanelsStore((state) => state.plugins)
  const [entries, setEntries] = useState<Entry[]>([])
  const [contentHeight, setContentHeight] = useState<{ id: string; height: number } | null>(null)
  const openPopover = useWorkspaceToolbarPopoverState((state) => state.openPopover)
  const setOpenPopover = useWorkspaceToolbarPopoverState((state) => state.setOpenPopover)
  const openId = openPopover?.worktreeId === worktreeId ? openPopover.id : null
  // Status polling must not retire the iframe bridge while a list request is still pending.
  const context = useMemo(
    () => (worktreeId ? pluginWorkspaceContext(useAppStore.getState(), worktreeId) : null),
    [worktreeId, worktreePath, activeHost]
  )

  useEffect(() => {
    setEntries([])
    const requested = useWorkspaceToolbarPopoverState.getState().openPopover
    if (
      !enabled ||
      (worktreeId === selectedWorktreeId &&
        requested &&
        (requested.worktreeId !== worktreeId || requested.path !== worktreePath))
    )
      setOpenPopover(null)
    if (!enabled || !worktreeId || worktreeId !== selectedWorktreeId) return
    const boundContext = pluginWorkspaceContext(useAppStore.getState(), worktreeId)
    if (!boundContext) return
    let cancelled = false,
      pending = false
    const refresh = async (): Promise<void> => {
      if (cancelled || pending || document.hidden) return
      pending = true
      const next: Entry[] = []
      try {
        for (const plugin of plugins) {
          if (!['running', 'idle', 'restarting'].includes(plugin.status)) continue
          for (const panel of plugin.panels) {
            const commandId = `workspace-panel.${panel.id}.toolbar`
            if (
              !plugin.commands.some(
                (command) => command.id === commandId && command.handler.type === 'worker'
              )
            )
              continue
            const value: unknown = await window.api.plugins.invokeCommand({
              pluginKey: plugin.pluginKey,
              commandId,
              args: { context: boundContext }
            })
            const result = workspaceToolbarSchema.safeParse(value)
            if (result.success && result.data.enabled)
              next.push(
                ...result.data.items.map((item) => ({
                  ...item,
                  pluginKey: plugin.pluginKey,
                  tabKey: panel.tabKey
                }))
              )
          }
        }
        if (!cancelled) {
          setEntries(next)
          const open = useWorkspaceToolbarPopoverState.getState().openPopover
          if (
            open?.worktreeId === worktreeId &&
            !next.some((entry) => `${entry.pluginKey}:${entry.id}` === open.id)
          )
            setOpenPopover(null)
        }
      } catch {
        // A missing reply cannot prove that a service stopped or became healthy.
        if (!cancelled)
          setEntries((current) =>
            current.map((entry) => ({
              ...entry,
              status: 'unverifiable',
              description: '状态暂不可确认'
            }))
          )
      } finally {
        pending = false
      }
    }
    void refresh()
    const timer = setInterval(() => void refresh(), 1500)
    window.addEventListener('focus', refresh)
    return () => {
      cancelled = true
      clearInterval(timer)
      window.removeEventListener('focus', refresh)
    }
  }, [enabled, worktreeId, selectedWorktreeId, worktreePath, activeHost, plugins, setOpenPopover])

  if (!enabled || !worktreeId || !context || !entries.length || worktreeId !== selectedWorktreeId)
    return null
  return (
    <div className="flex shrink-0 items-center gap-0.5 [-webkit-app-region:no-drag]">
      {entries.map((entry) => {
        const id = `${entry.pluginKey}:${entry.id}`
        return (
          <Popover
            key={`${worktreeId}:${id}`}
            open={openId === id}
            onOpenChange={(open) => {
              setContentHeight(null)
              setOpenPopover(open ? { worktreeId, path: context.path, id } : null)
              if (open && useAppStore.getState().activeWorktreeId === null)
                useAppStore.getState().setActiveWorktree(worktreeId, 'local')
            }}
          >
            <Tooltip>
              <TooltipTrigger asChild>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="relative my-auto flex h-7 shrink-0 items-center justify-center rounded-md px-1.5 text-muted-foreground hover:bg-accent/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    aria-label={entry.title}
                  >
                    {createElement(resolvePluginPanelIcon(entry.icon), {
                      className: 'size-3.5',
                      'aria-hidden': true
                    })}
                    {entry.status !== 'idle' && (
                      <span
                        aria-hidden="true"
                        data-service-status={entry.status}
                        className={cn(
                          'pointer-events-none absolute bottom-0.5 right-0.5 size-1.5 rounded-full ring-2 ring-background',
                          statusDot[entry.status]
                        )}
                      />
                    )}
                  </button>
                </PopoverTrigger>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {entry.title} · {entry.description}
              </TooltipContent>
            </Tooltip>
            <PopoverContent
              align="end"
              sideOffset={6}
              className="flex flex-col overflow-hidden p-0"
              style={{
                width: `min(${entry.width ?? 440}px, calc(100vw - 32px))`,
                maxHeight: 'calc(100vh - 80px)'
              }}
            >
              <PluginPanel
                tabKey={entry.tabKey}
                workspaceContext={context}
                presentation={entry.id}
                isVisible={openId === id}
                contentHeight={contentHeight?.id === id ? contentHeight.height : entry.height ?? 80}
                onDismiss={() => setOpenPopover(null)}
                onContentHeight={(height) => setContentHeight((current) =>
                  current?.id === id && current.height === height ? current : { id, height }
                )}
              />
            </PopoverContent>
          </Popover>
        )
      })}
    </div>
  )
}

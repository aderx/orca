import { useMemo, useState } from 'react'
import { useAppStore } from '@/store'
import { getTerminalQuickCommandHostPromptMaxLength } from '@/lib/terminal-quick-command-host-prompt-limit'
import {
  createTerminalQuickCommandDraft,
  TerminalQuickCommandDialog
} from '@/components/terminal-quick-commands/TerminalQuickCommandDialog'
import {
  getTerminalQuickCommandScope,
  isTerminalQuickCommandComplete
} from '../../../../shared/terminal/quick-commands/terminal-quick-commands'
import { getRepoIdFromWorktreeId } from '../../../../shared/worktree/id'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../../shared/constants'
import { runQuickCommandInNewTab } from '@/lib/run-quick-command-in-new-tab'
import type { TerminalQuickCommand } from '../../../../shared/terminal/quick-commands/terminal-quick-command-types'
import { useConfirmationDialog } from '@/components/confirmation-dialog-context'
import { translate } from '@/i18n/i18n'
import { TabBarQuickCommandsMenu } from './TabBarQuickCommandsMenu'
import {
  flattenTerminalQuickCommandHosts,
  type HostedTerminalQuickCommand,
  useTerminalQuickCommandHosts
} from '@/hooks/use-terminal-quick-command-hosts'
import { getRepoExecutionHostId, type ExecutionHostId } from '../../../../shared/execution-host'
import { useProjectHostSetupProjection } from '@/store/selectors'
import { terminalQuickCommandMatchesWorkspaceProject } from '@/lib/terminal-quick-command-project-scope'

type TabBarQuickCommandsButtonProps = {
  worktreeId: string
  groupId: string
  isFocused: boolean
}

export function TabBarQuickCommandsButton({
  worktreeId,
  groupId,
  isFocused
}: TabBarQuickCommandsButtonProps): React.JSX.Element | null {
  const recentByGroup = useAppStore((s) => s.recentQuickCommandIdByGroup)
  const repos = useAppStore((s) => s.repos)
  const projectHostSetupProjection = useProjectHostSetupProjection()
  const { executionHostId, hosts, refreshRemoteHost, remoteHostLoadFailed, remoteHostPending } =
    useTerminalQuickCommandHosts(worktreeId)
  const confirm = useConfirmationDialog()
  // Floating terminals have a synthetic workspace ID without a repo; never treat that sentinel as a run target.
  const repoId = useMemo(() => {
    if (worktreeId === FLOATING_TERMINAL_WORKTREE_ID) {
      return null
    }
    const candidate = getRepoIdFromWorktreeId(worktreeId)
    return repos.some((r) => r.id === candidate) ? candidate : null
  }, [worktreeId, repos])

  const { repoCommands, globalCommands } = useMemo(() => {
    const repoList: HostedTerminalQuickCommand[] = []
    const globalList: HostedTerminalQuickCommand[] = []
    for (const entry of flattenTerminalQuickCommandHosts(hosts)) {
      const { command } = entry
      if (!isTerminalQuickCommandComplete(command)) {
        continue
      }
      const scope = getTerminalQuickCommandScope(command)
      if (scope.type === 'global') {
        globalList.push(entry)
      } else if (
        scope.type === 'repo' &&
        terminalQuickCommandMatchesWorkspaceProject(command, {
          commandHostId: entry.hostId,
          projectHostSetups: projectHostSetupProjection.setups,
          targetHostId: executionHostId,
          targetRepoId: repoId
        })
      ) {
        repoList.push(entry)
      }
    }
    return { repoCommands: repoList, globalCommands: globalList }
  }, [executionHostId, hosts, projectHostSetupProjection.setups, repoId])

  const recentId = recentByGroup[groupId] ?? null
  // Prefer group history across scopes, then the first repo command, then a global command.
  const mostRecent = useMemo(() => {
    if (recentId) {
      const match =
        repoCommands.find((entry) => entry.key === recentId) ??
        globalCommands.find((entry) => entry.key === recentId) ??
        repoCommands.find((entry) => entry.command.id === recentId) ??
        globalCommands.find((entry) => entry.command.id === recentId)
      if (match) {
        return match
      }
    }
    return repoCommands[0] ?? globalCommands[0] ?? null
  }, [repoCommands, globalCommands, recentId])

  const [editor, setEditor] = useState<
    | { mode: 'add'; command: TerminalQuickCommand; hostId: ExecutionHostId }
    | { mode: 'edit'; command: TerminalQuickCommand; hostId: ExecutionHostId }
    | null
  >(null)

  const addRepoCommand = (hostId: ExecutionHostId): void => {
    setEditor({
      mode: 'add',
      hostId,
      command: createTerminalQuickCommandDraft({ type: 'repo', repoId: repoId ?? '' })
    })
  }

  const handleSaveCommand = async (next: TerminalQuickCommand): Promise<boolean> =>
    editor ? await useAppStore.getState().upsertTerminalQuickCommand(editor.hostId, next) : false

  const handleDeleteCommand = async (entry: HostedTerminalQuickCommand): Promise<void> => {
    const { command } = entry
    const confirmed = await confirm({
      title: translate(
        'auto.components.tab.bar.TabBarQuickCommandsButton.e8e1a52edb',
        'Delete "{{value0}}"?',
        { value0: command.label }
      ),
      description: translate(
        'auto.components.tab.bar.TabBarQuickCommandsButton.3220e2da27',
        'This quick command will be removed from your saved list.'
      ),
      confirmLabel: translate(
        'auto.components.tab.bar.TabBarQuickCommandsButton.be8f0ff166',
        'Delete'
      ),
      confirmVariant: 'destructive'
    })
    if (!confirmed) {
      return
    }
    void useAppStore.getState().deleteTerminalQuickCommand(entry.hostId, command.id)
  }

  const handleRun = (entry: HostedTerminalQuickCommand): void => {
    runQuickCommandInNewTab({
      command: entry.command,
      worktreeId,
      groupId,
      historyId: entry.key
    })
  }
  const editorPromptMaxLength = useAppStore((state) =>
    editor ? getTerminalQuickCommandHostPromptMaxLength(state, editor.hostId) : undefined
  )
  const editorRepos = editor?.hostId.startsWith('runtime:')
    ? repos.filter((repo) => getRepoExecutionHostId(repo) === editor.hostId)
    : repos

  // Keep the toolbar for runnable commands; new commands remain available in Settings.
  if (!repoId || !mostRecent) {
    return null
  }

  return (
    <>
      <TabBarQuickCommandsMenu
        isFocused={isFocused}
        repoCommands={repoCommands}
        globalCommands={globalCommands}
        mostRecent={mostRecent}
        addHosts={hosts}
        hostLoadFailed={remoteHostLoadFailed}
        hostOwnershipPending={remoteHostPending}
        onMenuOpen={refreshRemoteHost}
        onAddCommand={addRepoCommand}
        onEditCommand={(entry) =>
          setEditor({ mode: 'edit', command: entry.command, hostId: entry.hostId })
        }
        onDeleteCommand={(entry) => void handleDeleteCommand(entry)}
        onRunCommand={handleRun}
      />
      <TerminalQuickCommandDialog
        open={editor !== null}
        mode={editor?.mode ?? 'add'}
        command={editor?.command ?? createTerminalQuickCommandDraft({ type: 'repo', repoId })}
        repos={editorRepos}
        agentPromptMaxLength={editorPromptMaxLength}
        onOpenChange={(open) => !open && setEditor(null)}
        onSave={handleSaveCommand}
      />
    </>
  )
}

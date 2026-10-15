export function isWorkspacePluginPanel(
  plugin: { commands: readonly { id: string; handler: { type: string } }[] },
  panelId: string
): boolean {
  return plugin.commands.some(
    (command) =>
      command.id === `workspace-panel.${panelId}.probe` && command.handler.type === 'worker'
  )
}

/** Workspace-only panels must not also mount without a worktree in the sidebar. */
export function workspacePluginPanelKeys(
  plugins: readonly {
    panels: readonly { id: string; tabKey: string }[]
    commands: readonly { id: string; handler: { type: string } }[]
  }[]
): Set<string> {
  return new Set(
    plugins.flatMap((plugin) =>
      plugin.panels
        .filter((panel) => isWorkspacePluginPanel(plugin, panel.id))
        .map((panel) => panel.tabKey)
    )
  )
}

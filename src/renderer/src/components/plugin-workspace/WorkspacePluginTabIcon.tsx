import { createElement } from 'react'
import { usePluginPanelsStore } from '@/store/plugin-panels'
import { resolvePluginPanelIcon } from '../right-sidebar/plugin-panel-activity-items'

export function WorkspacePluginTabIcon({
  tabKey,
  className
}: {
  tabKey?: string
  className: string
}): React.JSX.Element {
  const icon = usePluginPanelsStore(
    (state) =>
      state.plugins.flatMap((plugin) => plugin.panels).find((panel) => panel.tabKey === tabKey)
        ?.icon
  )
  return createElement(resolvePluginPanelIcon(icon), { className, 'aria-hidden': true })
}

import { describe, expect, it } from 'vitest'
import { workspacePluginPanelKeys } from './workspace-plugin-panels'
import { normalizeRightSidebarRoute } from '@/store/right-sidebar-route'
import { pluginPanelTabKey } from '../../../../shared/plugins/plugin-tab-key'

// Minimal metadata is sufficient for routing; no worker is executed.
const workspaceKey = pluginPanelTabKey('local.launcher', 'services')
const sidebarKey = pluginPanelTabKey('local.launcher', 'notes')
const plugins = [
  {
    panels: [
      { id: 'services', tabKey: workspaceKey },
      { id: 'notes', tabKey: sidebarKey }
    ],
    commands: [{ id: 'workspace-panel.services.probe', handler: { type: 'worker' } }]
  }
]
describe('workspace panel placement', () => {
  it('excludes only panels with a matching worker probe from sidebar routes', () => {
    const workspace = workspacePluginPanelKeys(plugins)
    expect([...workspace]).toEqual([workspaceKey])
    const sidebarKeys = new Set([workspaceKey, sidebarKey].filter((key) => !workspace.has(key)))
    expect(
      normalizeRightSidebarRoute(workspaceKey, undefined, { installedPluginTabKeys: sidebarKeys })
        .rightSidebarTab
    ).toBe('explorer')
    expect(
      normalizeRightSidebarRoute(sidebarKey, undefined, { installedPluginTabKeys: sidebarKeys })
        .rightSidebarTab
    ).toBe(sidebarKey)
  })
})

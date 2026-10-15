import { beforeEach, expect, it } from 'vitest'
import { vi } from 'vitest'
import { loadUpdaterModule, warmUpdaterModule } from './updater-test-module-loader'

const { autoUpdaterMock, appMock, powerMonitorOnMock, moduleFactories, resetUpdaterMocks } =
  await vi.hoisted(async () => (await import('./updater-test-harness')).createUpdaterMocks())

vi.mock('electron', () => moduleFactories.electron())
vi.mock('electron-updater', () => moduleFactories.electronUpdater())
vi.mock('./electron-updater-loader', () => moduleFactories.electronUpdaterLoader())
vi.mock('@electron-toolkit/utils', () => moduleFactories.electronToolkitUtils())
vi.mock('./ipc/pty', () => moduleFactories.ipcPty())
vi.mock('./linux-update-package-type', () => moduleFactories.linuxUpdatePackageType())
vi.mock('./updater-lifecycle-diagnostics', () => moduleFactories.updaterLifecycleDiagnostics())
vi.mock('./updater-changelog', () => moduleFactories.updaterChangelog())
vi.mock('./updater-nudge', () => moduleFactories.updaterNudge())
vi.mock('./update-install-exit-watchdog', () => moduleFactories.updateInstallExitWatchdog())
vi.mock('./updater-prerelease-feed', () => moduleFactories.updaterPrereleaseFeed())
vi.mock('./local-builds/local-build-switch', () => moduleFactories.localBuildSwitch())
vi.mock('./local-builds/local-build-feed-server', () => moduleFactories.localBuildFeedServer())

warmUpdaterModule()
beforeEach(() => resetUpdaterMocks())
it('disables startup, focus, resume and periodic checks while retaining manual checks', async () => {
  const updater = await loadUpdaterModule()
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: The updater only uses webContents.send on this isolated window mock.
  updater.setupAutoUpdater({ webContents: { send: vi.fn() } } as never, {
    getLastUpdateCheckAt: () => null
  })
  updater.checkForUpdates()
  appMock.emit('browser-window-focus')
  const resume = powerMonitorOnMock.mock.calls.find(([event]) => event === 'resume')?.[1]
  if (typeof resume === 'function') resume()
  await Promise.resolve()
  expect(autoUpdaterMock.checkForUpdates).not.toHaveBeenCalled()
  expect(autoUpdaterMock.autoInstallOnAppQuit).toBe(false)
  expect(autoUpdaterMock.autoDownload).toBe(false)
  updater.checkForUpdatesFromMenu()
  await vi.waitFor(() => expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledTimes(1))
})

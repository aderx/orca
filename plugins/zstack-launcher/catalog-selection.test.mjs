import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import activate from './main.mjs'
import { currentBffHost, importServers, context, readJson, atomicJson } from './data.mjs'
import { productConfigs } from './products.mjs'
import { bffInstallArgs, preparationCommand } from './dependency-install.mjs'
const plugin = path.dirname(fileURLToPath(import.meta.url))
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orca-catalog-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  for (const directory of [
    '.git',
    'scripts',
    'node_modules',
    'packages/products/cloud/bff',
    'packages/products/cloud/shared/mf-hub/src',
    'packages/products/cloud/apps/core-shell',
    'packages/products/cloud/apps/core-widget',
    'packages/products/cloud/apps/account',
    'packages/products/shared/audit'
  ])
    fs.mkdirSync(path.join(root, directory), { recursive: true })
  fs.writeFileSync(
    path.join(root, 'scripts/start.ts'),
    `const PRODUCT_CONFIGS: Record<string, object> = {
  cloud: { mfHubPath: "packages/products/cloud/shared/mf-hub/src/mf-config.ts", appsPath: "packages/products/cloud/apps", displayName: "ZStack Cloud" },
};`
  )
  fs.writeFileSync(path.join(root, 'packages/products/cloud/bff/package.json'), '{}')
  fs.writeFileSync(
    path.join(root, 'node_modules/.modules.yaml'),
    'storeDir: /tmp/example-pnpm-store/v10\n'
  )
  for (const name of ['core-shell', 'core-widget', 'account'])
    fs.writeFileSync(
      path.join(root, 'packages/products/cloud/apps', name, 'package.json'),
      JSON.stringify({ name, scripts: { dev: 'rsbuild dev' } })
    )
  fs.writeFileSync(
    path.join(root, 'packages/products/shared/audit/package.json'),
    '{"scripts":{"dev":"rsbuild dev"}}'
  )
  fs.writeFileSync(
    path.join(root, 'packages/products/cloud/shared/mf-hub/src/mf-config.ts'),
    `export const MF_CONFIG = { apps: { account: { port: 3010, remotes: ['audit'] }, absent: {port: 3011}, audit: {port: 3012}, 'core-widget': {port: 3013}, 'core-shell': {port: 3000} } }`
  )
  return root
}
test('reads the active worktree host and only adjacent candidate descriptions', (t) => {
  const root = fixture(t),
    primary = fixture(t)
  fs.writeFileSync(
    path.join(primary, 'packages/products/cloud/bff/.env'),
    '# 测试环境\n# ZS_MN_SERVER=http://192.0.2.1:8080\n# 不属于下一条的备注\n\n# ZS_MN_SERVER=http://192.0.2.2:8080\n'
  )
  fs.writeFileSync(
    path.join(root, 'packages/products/cloud/bff/.env'),
    '# ZS_MN_SERVER=http://192.0.2.1:8080\nZS_MN_SERVER="http://192.0.2.2:8080"\n'
  )
  assert.equal(currentBffHost({ path: root }), '192.0.2.2')
  assert.deepEqual(importServers({ primary }), [
    { host: '192.0.2.1', name: '测试环境' },
    { host: '192.0.2.2', name: '无描述' }
  ])
})
test('lists only current-product and shared startup directories in alphabetical order', (t) => {
  const root = fixture(t)
  const modules = JSON.parse(
    execFileSync('bun', [path.join(plugin, 'catalog.mjs'), root, 'cloud'], { encoding: 'utf8' })
  )
  assert.deepEqual(
    modules.map((item) => item.name),
    ['account', 'audit', 'core-shell', 'core-widget']
  )
  assert.equal(modules.find((item) => item.name === 'audit').available, true)
  assert.equal(modules.find((item) => item.name === 'account').dependenciesPresent, false)
  assert.equal(
    modules.some((item) => item.name === 'absent'),
    false
  )
})
test('BFF install uses the existing store and refuses another worktree dependency directory', (t) => {
  const root = fixture(t),
    other = fixture(t)
  assert.deepEqual(bffInstallArgs({ path: root, primary: root }), [
    '--store-dir',
    '/tmp/example-pnpm-store',
    'install',
    '--offline',
    '--frozen-lockfile',
    '--ignore-scripts',
    '--filter=bff...'
  ])
  fs.symlinkSync(
    path.join(other, 'node_modules'),
    path.join(root, 'packages/products/cloud/bff/node_modules')
  )
  assert.throws(() => bffInstallArgs({ path: root, primary: root }), /其他工作树/)
})
test('worker defaults to the actual .env host and installs selected FE scope in a logged terminal without starting FE', async (t) => {
  const root = fixture(t),
    handlers = new Map(),
    input = { path: root, worktreeId: 'fixture', executionHostId: 'local' }
  fs.writeFileSync(
    path.join(root, 'packages/products/cloud/bff/.env'),
    '# 测试\nZS_MN_SERVER=http://192.0.2.8:8080\n'
  )
  let saved, launched
  const closed = [], terminals = new Set(), sent = []
  let releaseBff
  const bffTerminal = new Promise((resolve) => { releaseBff = resolve })
  activate({
    commands: {
      register(id, fn) {
        handlers.set(id, fn)
      }
    },
    host: {
      async call(method, args) {
        if (method === 'storage.get') return { value: saved }
        if (method === 'storage.set') {
          saved = args.value
          return { ok: true }
        }
        if (method === 'terminal.create') {
          launched = args
          const handle = `fixture-terminal-${terminals.size}`
          terminals.add(handle)
          if (args.title === 'BFF') await bffTerminal
          return { handle }
        }
        if (method === 'workspace.readContext') return { terminals: [...terminals].map(id => ({ id })) }
        if (method === 'terminal.focusOwned') return { ok: true }
        if (method === 'terminal.sendText') {
          sent.push(args)
          launched = { command: args.text }
          return { accepted: true }
        }
        if (method === 'terminal.closeOwned') {
          closed.push(args.terminalId)
          return { ok: true }
        }
        throw new Error(method)
      }
    }
  })
  const request = (args) =>
    handlers.get('launcher.request')({ context: input, product: 'cloud', ...args })
  assert.equal((await request({ action: 'snapshot' })).selection.host, '192.0.2.8')
  await request({ action: 'saveSelection', apps: ['account'], host: '192.0.2.8', proxy: true })
  await request({ action: 'install', kind: 'fe' })
  const file = launched.command.match(/'([^']+\.json)'$/)[1],
    run = readJson(file)
  t.after(() => fs.rmSync(path.dirname(file), { recursive: true, force: true }))
  assert.equal(run.program, 'python3')
  assert.deepEqual(run.args, [
    path.join(plugin, 'prepare-dependencies.py'),
    '--product',
    'cloud',
    '--apps',
    'account'
  ])
  assert.equal(run.cwd, fs.realpathSync(root))
  assert.equal(run.operation, 'install')
  assert.equal(launched.worktreeId, 'fixture')
  assert.equal(
    fs.readFileSync(path.join(root, 'packages/products/cloud/bff/.env'), 'utf8'),
    '# 测试\nZS_MN_SERVER=http://192.0.2.8:8080\n'
  )
  atomicJson(file, { ...run, state: 'exited', code: 0 })
  assert.equal((await request({ action: 'status' })).fe.operation, 'install')
  const ctx = context(input)
  saved.selections[`${ctx.worktreeKey}:cloud`].host = '192.0.2.9'
  assert.equal((await request({ action: 'snapshot' })).selection.host, '192.0.2.9')
  await request({ action: 'saveSelection', kind: 'bff', apps: [], host: '192.0.2.8', proxy: true })
  const pendingBff = request({ action: 'start', kind: 'bff' })
  t.after(() => releaseBff())
  for (let i = 0; launched.title !== 'BFF'; i++) {
    if (i > 100) throw new Error('BFF terminal was not requested')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  const bffFile = launched.command.match(/'([^']+\.json)'$/)[1]
  const bff = readJson(bffFile)
  assert.deepEqual(bff.preparation, {
    ...preparationCommand('cloud', ['bff']),
    cwd: fs.realpathSync(root)
  })
  assert.equal(bff.program, 'pnpm')
  assert.deepEqual(bff.args, ['start:dev'])
  await request({ action: 'start', kind: 'fe' })
  assert.equal((await request({ action: 'status' })).bff.state, 'starting')
  releaseBff()
  await pendingBff
  const fe = readJson(launched.command.match(/'([^']+\.json)'$/)[1])
  assert.equal(fe.waitForPreparation, undefined)
  assert.equal(sent.length, 1)
  assert.equal(terminals.size, 2)
  assert.deepEqual(fe.preparation.args, preparationCommand('cloud', ['account']).args)
  assert.deepEqual(fe.args, [
    './scripts/start.ts',
    '--product',
    'cloud',
    '--apps',
    'account',
    '--proxy=false'
  ])
  await request({ action: 'stop', kind: 'fe', id: fe.id })
  assert.deepEqual(closed, [])
  assert.equal((await request({ action: 'status' })).fe.state, 'cancelled')
  await request({ action: 'start', kind: 'fe' })
  assert.equal(sent.length, 2)
  assert.equal(terminals.size, 2)
  const again = (await request({ action: 'status' })).fe
  await request({ action: 'stop', kind: 'fe', id: again.id })
  terminals.delete(again.handle)
  await request({ action: 'start', kind: 'fe' })
  assert.equal(sent.length, 2)
  await request({ action: 'saveServers', servers: [] })
  const empty = await request({ action: 'snapshot' })
  assert.deepEqual(empty.servers, [])
  assert.equal(empty.currentHost, '192.0.2.8')
  assert.equal(empty.selection.host, '192.0.2.8')
  await request({ action: 'saveServers', servers: [{host: '192.0.2.9', name: 'new'}] })
  assert.deepEqual((await request({ action: 'snapshot' })).servers, [{host: '192.0.2.9', name: 'new'}])
})

test('reads all product definitions without executing the start script and scopes preparation by explicit package names', (t) => {
  const root = fixture(t)
  fs.writeFileSync(
    path.join(root, 'scripts/start.ts'),
    `throw new Error('never execute');
const PRODUCT_CONFIGS: Record<string, object> = {
  cloud: { mfHubPath: "cloud.ts", appsPath: "cloud/apps", displayName: "ZStack Cloud" },
  zsv: { mfHubPath: "zsv.ts", appsPath: "zsv/apps", displayName: "ZStack ZSV" },
  portal: { mfHubPath: "cloud.ts", appsPath: "portal", displayName: "ZStack Portal" },
};`
  )
  assert.deepEqual(
    productConfigs(root).map((item) => item.id),
    ['cloud', 'zsv', 'portal']
  )
  assert.equal(productConfigs(root)[2].appsPath, 'portal')
  assert.deepEqual(preparationCommand('zsv', ['zsv-shell', 'zsv-compute']).args, [
    path.join(plugin, 'prepare-dependencies.py'),
    '--product',
    'zsv',
    '--apps',
    'zsv-shell,zsv-compute'
  ])
})

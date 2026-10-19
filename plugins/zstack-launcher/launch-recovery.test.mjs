import assert from 'node:assert/strict'
import { test, mock } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import * as data from './data.mjs'
import { bffLaunchEnvironment, readBffEnvironment } from './bff-environment.mjs'
import { stopRun } from './stop-run.mjs'
import { observeRunState, processGone } from './run-state.mjs'

const plugin = path.dirname(fileURLToPath(import.meta.url))
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'orca-launch-recovery-'))
const runs = path.join(temporary, 'runs')
mock.module(new URL('./data.mjs', import.meta.url).href, {
  namedExports: { ...data, dataDirectory: () => runs }
})
mock.module(new URL('./server-reachability.mjs', import.meta.url).href, {
  namedExports: { createServerChecks: () => ({ start: async () => {}, snapshot: async () => ({}) }) }
})
const { default: activate } = await import('./main.mjs')
test.after(() => { mock.restoreAll(); fs.rmSync(temporary, { recursive: true, force: true }) })

async function until(predicate) {
  const end = Date.now() + 5000
  while (!predicate()) {
    assert.ok(Date.now() < end, 'condition timed out')
    await delay(20)
  }
}

test('terminal reuse failure preserves one run and continues in a new owned terminal', async () => {
  const root = path.join(temporary, 'workspace')
  const bff = path.join(root, 'packages/products/cloud/bff')
  fs.mkdirSync(bff, { recursive: true })
  fs.mkdirSync(path.join(root, '.git'))
  fs.mkdirSync(path.join(root, 'scripts'))
  fs.writeFileSync(path.join(root, 'scripts/start.ts'), '')
  fs.writeFileSync(path.join(bff, 'package.json'), '{}')
  fs.writeFileSync(path.join(bff, '.env'), 'HOST=192.0.2.1\nBASE_PORT=3100\nINSTANCE_ID=2\nZS_MN_SERVER=http://192.0.2.2:8080\n')
  const handlers = new Map(), storage = new Map(), calls = []
  let mode = 'ok', createFailure = false, handle = 'terminal-0', currentFile
  activate({ commands: { register: (id, fn) => handlers.set(id, fn) }, host: { call: async (method, args) => {
    calls.push(method)
    if (method === 'storage.get') return { value: storage.get(args.key) }
    if (method === 'storage.set') { storage.set(args.key, args.value); return {} }
    if (method === 'workspace.readContext') return { terminals: mode === 'missing' ? [] : [{ id: handle }] }
    if (method === 'terminal.focusOwned') {
      if (mode === 'ownership') throw new Error('Terminal ownership is unavailable')
      return { ok: true }
    }
    if (method === 'terminal.sendText') {
      if (mode === 'send-error') throw new Error('terminal is unavailable')
      return { accepted: mode !== 'rejected' }
    }
    if (method === 'terminal.create') {
      if (createFailure) throw new Error('new terminal unavailable')
      handle = `terminal-${calls.length}`
      if (currentFile) data.atomicJson(currentFile, { ...data.readJson(currentFile), sshConnected: true })
      return { handle }
    }
    throw new Error(method)
  } } })
  const context = { path: root, worktreeId: 'fixture', executionHostId: 'local' }
  const request = args => handlers.get('launcher.request')({ context, product: 'cloud', ...args })
  const options = { kind: 'bff', apps: [], proxy: false, host: '192.0.2.2' }
  await request({ action: 'start', ...options })
  const finish = async () => {
    const run = (await request({ action: 'status' })).bff
    data.atomicJson(run.file, { ...data.readJson(run.file), state: 'stopped', updatedAt: Date.now() })
  }
  for (const failure of ['ownership', 'send-error', 'rejected', 'missing']) {
    await finish()
    mode = failure
    const count = calls.filter(value => value === 'terminal.create').length
    const response = await request({ action: 'start', ...options })
    assert.equal(response.needsTerminal, true)
    assert.match(response.notice, /新建终端/)
    assert.equal(calls.filter(value => value === 'terminal.create').length, count)
    const before = (await request({ action: 'status' })).bff
    assert.equal(before.state, 'starting')
    await request({ action: 'createTerminal', kind: 'bff', id: response.id })
    const after = (await request({ action: 'status' })).bff
    assert.equal(after.id, before.id)
    assert.equal(after.handle, handle)
    await assert.rejects(request({ action: 'createTerminal', kind: 'bff', id: response.id }), /重复/)
  }
  await finish()
  mode = 'ok'
  const creates = calls.filter(value => value === 'terminal.create').length
  assert.equal((await request({ action: 'start', ...options })).needsTerminal, undefined)
  assert.equal(calls.filter(value => value === 'terminal.create').length, creates)
  await finish()
  mode = 'ownership'
  createFailure = true
  const failed = await request({ action: 'start', ...options })
  await assert.rejects(request({ action: 'createTerminal', kind: 'bff', id: failed.id }), /new terminal unavailable/)
  assert.equal((await request({ action: 'status' })).bff.state, 'failed')

  createFailure = false
  const forwarding = await request({ action: 'start', ...options, sshForward: true })
  currentFile = (await request({ action: 'status' })).bff.file
  await request({ action: 'createTerminal', kind: 'bff', id: forwarding.id })
  const run = data.readJson(currentFile)
  assert.equal(run.sshForward.port, 3102)
  assert.equal(run.sshForward.host, options.host)
  assert.match(fs.readFileSync(path.join(bff, '.env'), 'utf8'), /HOST=127\.0\.0\.1/)
  await request({ action: 'saveSelection', kind: 'fe', apps: [], proxy: false, host: '' })
  const selection = Object.values(storage.get('configuration').selections)[0]
  assert.equal(selection.sshForward, true)
  assert.equal(selection.host, options.host)
})

test('forwarding enforces HOST, preserves revision checks and follows BFF port overrides', () => {
  const root = path.join(temporary, 'environment')
  const bff = path.join(root, 'packages/products/cloud/bff')
  fs.mkdirSync(bff, { recursive: true })
  const file = path.join(bff, '.env'), ctx = { path: root, primary: root }
  fs.writeFileSync(file, 'HOST=192.0.2.1\nBASE_PORT=3200\nINSTANCE_ID=3\n')
  const revision = readBffEnvironment(ctx).revision
  const settings = bffLaunchEnvironment(ctx, { revision, changes: { HOST: '192.0.2.4', BASE_PORT: '3300' } }, true)
  assert.equal(settings.port, 3303)
  assert.equal(settings.environment.changes.HOST, '127.0.0.1')
  fs.appendFileSync(file, 'PORT=3400\n')
  assert.throws(() => bffLaunchEnvironment(ctx, settings.environment, true), /已被修改/)
  assert.equal(bffLaunchEnvironment(ctx, undefined, true).port, 3400)
  assert.equal(bffLaunchEnvironment(ctx, undefined, false).environment, undefined)
})

async function fixture(t, mode, service = 'setInterval(() => {}, 1000)', preparation) {
  const root = fs.mkdtempSync(path.join(temporary, 'runner-'))
  const file = path.join(root, 'run.json'), capture = path.join(root, 'ssh.json')
  const run = {
    id: 'fixture', lock: path.join(root, 'lock.json'), log: path.join(root, 'run.log'), root, cwd: root,
    title: 'fixture BFF', service: 'bff', state: 'starting', createdAt: Date.now(), updatedAt: Date.now(),
    program: process.execPath, args: ['-e', `console.log('SERVICE-START'); ${service}`],
    preparation: preparation ? { program: process.execPath, args: ['-e', preparation], cwd: root } : null,
    sshForward: { host: '192.0.2.2', port: 3100, knownHosts: path.join(root, 'known_hosts') }
  }
  data.atomicJson(file, run)
  data.atomicJson(run.lock, { id: run.id, file })
  const fake = mode === 'auth' ? "console.error('Permission denied (password).'); process.exitCode=255"
    : mode === 'port' ? "console.error('remote port forwarding failed for listen port 3100'); process.exitCode=255"
    : mode === 'connecting' ? 'setInterval(() => {}, 1000)'
    : `console.log('ORCA_BFF_FORWARD_READY'); process.stdin.resume(); process.stdin.on('end', () => process.exit()); ${mode === 'disconnect' ? 'setTimeout(() => process.exit(255), 350)' : ''}`
  const preload = path.join(root, 'mock.mjs')
  const moduleUrl = new URL('./ssh-forward.mjs', import.meta.url).href
  fs.writeFileSync(preload, `
    import { mock } from 'node:test'; import fs from 'node:fs'; import { spawn } from 'node:child_process';
    import { createSshForward } from ${JSON.stringify(moduleUrl)};
    mock.module(${JSON.stringify(moduleUrl)}, { namedExports: { createSshForward: (settings, options) =>
      createSshForward(settings, { ...options, spawnProcess: (program, args, opts) => {
        fs.writeFileSync(${JSON.stringify(capture)}, JSON.stringify({program, args, askpass: opts.env.SSH_ASKPASS, mode: opts.env.SSH_ASKPASS_REQUIRE}));
        return spawn(process.execPath, ['-e', ${JSON.stringify(fake)}], opts);
      } }) } });
  `)
  const child = spawn(process.execPath, ['--experimental-test-module-mocks', '--import', preload, path.join(plugin, 'runner.mjs'), file], { stdio: 'ignore' })
  const ended = new Promise(resolve => child.once('exit', resolve))
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) { child.kill('SIGTERM'); await ended } })
  return { file, run, child, ended, capture, log: () => fs.readFileSync(run.log, 'utf8') }
}

test('SSH authentication and forwarding failures never start dependency preparation or BFF', { timeout: 10000 }, async t => {
  for (const mode of ['auth', 'port']) {
    const task = await fixture(t, mode, '', "console.log('PREPARE-START')")
    assert.equal(await task.ended, 1)
    const result = data.readJson(task.file)
    assert.equal(result.state, 'failed')
    assert.match(result.error, mode === 'auth' ? /密码认证失败.*不再重试/ : /转发端口 3100/)
    assert.doesNotMatch(task.log(), /SERVICE-START|PREPARE-START/)
    assert.equal(processGone(result.sshPid), true)
    const command = data.readJson(task.capture)
    assert.ok(command.args.includes('NumberOfPasswordPrompts=1'))
    assert.ok(command.args.includes('ConnectionAttempts=1'))
    assert.ok(command.args.includes('PreferredAuthentications=password'))
    assert.ok(command.args.includes('127.0.0.1:3100:127.0.0.1:3100'))
    assert.equal(command.mode, 'force')
    assert.equal(command.args.includes('password'), false)
  }
})

test('stopping BFF and cancelling SSH connection both reap the owned forwarding process', { timeout: 10000 }, async t => {
  for (const mode of ['ready', 'connecting']) {
    const task = await fixture(t, mode)
    await until(() => Boolean(data.readJson(task.file).sshPid))
    if (mode === 'ready') await until(() => data.readJson(task.file).state === 'running')
    await stopRun(task.file)
    await task.ended
    const result = data.readJson(task.file)
    assert.equal(result.state, 'stopped')
    assert.equal(processGone(result.sshPid), true)
    if (result.childPid) assert.equal(processGone(-result.childPid), true)
  }
})

test('service exit, preparation failure and SSH disconnect cannot leave a live tunnel', { timeout: 10000 }, async t => {
  for (const [mode, service, preparation] of [
    ['ready', 'process.exitCode=0', null],
    ['ready', '', 'process.exitCode=7'],
    ['disconnect', 'setInterval(() => {}, 1000)', null]
  ]) {
    const task = await fixture(t, mode, service, preparation)
    await task.ended
    const result = data.readJson(task.file)
    assert.equal(processGone(result.sshPid), true)
    if (result.childPid) assert.equal(processGone(-result.childPid), true)
    if (mode === 'disconnect') assert.match(result.error, /SSH 转发已断开/)
  }
})

test('runner death closes SSH stdin and an unconfirmed tunnel is never reported as exited', { timeout: 10000 }, async t => {
  const task = await fixture(t, 'ready', '', 'setInterval(() => {}, 1000)')
  await until(() => data.readJson(task.file).state === 'preparing')
  const before = data.readJson(task.file)
  task.child.kill('SIGKILL')
  await task.ended
  await until(() => processGone(before.sshPid))
  process.kill(-before.childPid, 'SIGKILL')
  await until(() => processGone(-before.childPid))
  const stale = { state: 'running', updatedAt: 1, createdAt: 1, runnerPid: 1, childPid: 2, sshPid: 3 }
  assert.equal(observeRunState(stale, 20000, pid => pid !== -3), 'unknown')
})

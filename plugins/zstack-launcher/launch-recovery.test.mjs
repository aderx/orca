import assert from 'node:assert/strict'
import { test, mock } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import * as data from './data.mjs'
import { bffLaunchEnvironment, readBffEnvironment, writeBffEnvironment } from './bff-environment.mjs'
import { stopRun } from './stop-run.mjs'
import { observeRunState, processGone } from './run-state.mjs'

const plugin = path.dirname(fileURLToPath(import.meta.url))
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'orca-launch-recovery-'))
const runs = path.join(temporary, 'runs')
let failRecord = false
mock.module(new URL('./data.mjs', import.meta.url).href, {
  namedExports: { ...data, dataDirectory: () => runs, atomicJson: (file, value) => {
    if (failRecord && file.startsWith(runs)) throw new Error('fixture record unavailable')
    data.atomicJson(file, value)
  } }
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

test('terminal, stale PID, cache, history and env persistence failures still submit the current service command', async t => {
  const root = path.join(temporary, 'workspace')
  const bff = path.join(root, 'packages/products/cloud/bff')
  fs.mkdirSync(bff, { recursive: true })
  fs.mkdirSync(path.join(root, 'scripts'))
  fs.writeFileSync(path.join(root, 'scripts/start.ts'), '')
  fs.writeFileSync(path.join(bff, 'package.json'), '{}')
  fs.writeFileSync(path.join(bff, '.env'), 'HOST=192.0.2.1\nBASE_PORT=3100\nINSTANCE_ID=2\nZS_MN_SERVER=http://192.0.2.2:8080\nAPI_INSPECTOR=true\nINTERACTIVE_COLLECT=false\nOPEN_PLATFORM=true\n')
  const handlers = new Map(), storage = new Map(), calls = []
  let mode = 'ok', createFailure = false, cacheFailure = false, handle = 'terminal-0'
  activate({ commands: { register: (id, fn) => handlers.set(id, fn) }, host: { call: async (method, args) => {
    calls.push(method)
    if (method === 'storage.get') return { value: storage.get(args.key) }
    if (method === 'storage.set') {
      if (cacheFailure) throw new Error('fixture cache unavailable')
      storage.set(args.key, args.value); return {}
    }
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
      return { handle }
    }
    throw new Error(method)
  } } })
  const context = { path: root, worktreeId: 'fixture', executionHostId: 'local' }
  const request = args => handlers.get('launcher.request')({ context, product: 'cloud', ...args })
  const options = { kind: 'bff', apps: [], proxy: false, host: '192.0.2.2', sshForward: false }
  const lock = path.join(runs, data.key(fs.realpathSync(root)), 'bff.json')
  fs.mkdirSync(path.dirname(lock), { recursive: true })
  fs.writeFileSync(lock, 'invalid history')
  const initialEnvironment = fs.readFileSync(path.join(bff, '.env'), 'utf8')
  await request({ action: 'saveSshSettings', sshPassword: 'password' })
  assert.equal(Object.values(storage.get('configuration').selections)[0].sshForward, true)
  await request({ action: 'saveSshSettings', sshForward: false })
  assert.equal(Object.values(storage.get('configuration').selections)[0].sshForward, false)
  assert.equal(fs.readFileSync(path.join(bff, '.env'), 'utf8'), initialEnvironment)
  assert.match(JSON.stringify((await request({ action: 'start', ...options })).notices), /历史记录读取/)
  const first = (await request({ action: 'status' })).bff
  assert.deepEqual(JSON.parse(JSON.stringify(first)), first)
  assert.equal(first.sshForward, null)
  assert.deepEqual(first.environmentSummary, { host: '192.0.2.1', flags: ['API_INSPECTOR', 'OPEN_PLATFORM'] })
  assert.equal(Object.values(storage.get('configuration').selections)[0].sshPassword, 'password')
  const finish = async () => {
    const run = (await request({ action: 'status' })).bff
    data.atomicJson(run.file, { ...data.readJson(run.file), state: 'stopped', runnerPid: undefined, childPid: undefined, updatedAt: Date.now() })
  }
  for (const failure of ['ownership', 'send-error', 'rejected', 'missing']) {
    await finish()
    mode = failure
    const count = calls.filter(value => value === 'terminal.create').length
    const response = await request({ action: 'start', ...options })
    assert.match(JSON.stringify(response.notices), /改用新终端/)
    assert.equal(calls.filter(value => value === 'terminal.create').length, count + 1)
    const before = (await request({ action: 'status' })).bff
    assert.equal(before.state, 'starting')
    await request({ action: 'createTerminal', kind: 'bff', id: response.id })
    const after = (await request({ action: 'status' })).bff
    assert.equal(after.id, before.id)
    assert.equal(after.handle, handle)
    await request({ action: 'createTerminal', kind: 'bff', id: response.id })
    assert.equal(calls.filter(value => value === 'terminal.create').length, count + 1)
  }
  await finish()
  mode = 'ok'
  const creates = calls.filter(value => value === 'terminal.create').length
  assert.equal((await request({ action: 'start', ...options })).needsTerminal, undefined)
  assert.equal(calls.filter(value => value === 'terminal.create').length, creates)
  await finish()
  mode = 'ownership'
  createFailure = true
  await assert.rejects(request({ action: 'start', ...options }), /new terminal unavailable/)
  assert.equal((await request({ action: 'status' })).bff.state, 'failed')

  createFailure = false
  const sshPassword = "custom p@$'word"
  await request({ action: 'start', ...options, sshForward: true, sshPassword })
  const currentFile = (await request({ action: 'status' })).bff.file
  const run = data.readJson(currentFile)
  assert.equal(run.sshForward.port, 3102)
  assert.equal(run.sshForward.host, options.host)
  assert.equal(run.sshForward.password, sshPassword)
  const env = fs.readFileSync(path.join(bff, '.env'), 'utf8')
  assert.match(env, /HOST=127\.0\.0\.1/)
  assert.ok(!env.includes(sshPassword))
  assert.doesNotMatch(env, /SSH/)
  await request({ action: 'saveSelection', kind: 'fe', apps: [], proxy: false, host: '' })
  const selection = Object.values(storage.get('configuration').selections)[0]
  assert.equal(selection.sshForward, true)
  assert.equal(selection.sshPassword, sshPassword)
  assert.equal(selection.host, options.host)
  await request({ action: 'saveSelection', ...options, sshForward: false, sshPassword: 'changed' })
  const status = (await request({ action: 'status' })).bff
  assert.deepEqual(status.sshForward, { password: sshPassword })
  assert.deepEqual(status.environmentSummary, { host: '127.0.0.1', flags: ['API_INSPECTOR', 'OPEN_PLATFORM'] })
  await request({ action: 'saveSshSettings', sshForward: true, sshPassword })
  const cached = Object.values(storage.get('configuration').selections)[0]
  assert.equal(cached.sshForward, true)
  assert.equal(cached.sshPassword, sshPassword)
  assert.equal(cached.host, options.host)
  assert.deepEqual(cached.apps, selection.apps)

  data.atomicJson(currentFile, { ...run, state: 'running', runnerPid: process.pid })
  const restart = await request({ action: 'restart', ...options, id: 'stale-display-id' })
  assert.match(JSON.stringify(restart.notices), /历史 PID 已属于其他程序/)
  assert.equal(processGone(process.pid), false)

  await finish()
  const draft = readBffEnvironment({ path: root, primary: root })
  fs.appendFileSync(path.join(bff, '.env'), '# externally changed\n')
  cacheFailure = true
  failRecord = true
  t.after(() => { failRecord = false })
  const fallback = await request({ action: 'start', ...options, host: '192.0.2.9',
    environment: { revision: draft.revision, changes: { HOST: '192.0.2.8' } } })
  const current = (await request({ action: 'status' })).bff
  t.after(() => fs.rmSync(path.dirname(current.file), { recursive: true, force: true }))
  assert.equal(current.id, fallback.id)
  assert.ok(!current.file.startsWith(runs))
  const currentRun = data.readJson(current.file)
  assert.equal(currentRun.env.HOST, '192.0.2.8')
  assert.equal(currentRun.env.ZS_MN_SERVER, 'http://192.0.2.9:8080')
  assert.match(JSON.stringify(fallback.notices), /缓存.*失败/)
  assert.match(JSON.stringify(fallback.notices), /保存 BFF 环境/)
  assert.match(JSON.stringify(fallback.notices), /改用临时目录/)
  const toolbar = await handlers.get('workspace-panel.services.toolbar')({ context })
  assert.ok(toolbar.notices.some(notice => notice.id === fallback.notices[0].id))
  failRecord = false
})

test('runtime env survives stale revisions while file writes preserve newer user edits', () => {
  const root = path.join(temporary, 'environment')
  const bff = path.join(root, 'packages/products/cloud/bff')
  fs.mkdirSync(bff, { recursive: true })
  const file = path.join(bff, '.env'), ctx = { path: root, primary: root }
  fs.writeFileSync(file, 'HOST=192.0.2.1\nBASE_PORT=3200\nINSTANCE_ID=3\nAPI_INSPECTOR=false\nINTERACTIVE_COLLECT=true\nOPEN_PLATFORM=TRUE\n')
  const revision = readBffEnvironment(ctx).revision
  const flags = readBffEnvironment(ctx).groups.flatMap(group => group.fields).filter(field => field.boolean)
  assert.deepEqual(flags.map(field => field.key), ['API_INSPECTOR', 'INTERACTIVE_COLLECT', 'OPEN_PLATFORM'])
  const draft = { revision, changes: { HOST: '192.0.2.4', BASE_PORT: '3300', API_INSPECTOR: 'true' } }
  const settings = bffLaunchEnvironment(ctx, draft, true)
  assert.equal(settings.port, 3303)
  assert.equal(settings.environment.changes.HOST, '127.0.0.1')
  assert.deepEqual(settings.summary, { host: '127.0.0.1', flags: ['API_INSPECTOR', 'INTERACTIVE_COLLECT'] })
  assert.deepEqual(bffLaunchEnvironment(ctx, draft, false).summary, { host: '192.0.2.4', flags: ['API_INSPECTOR', 'INTERACTIVE_COLLECT'] })
  fs.appendFileSync(file, 'PORT=3400\n')
  assert.throws(() => writeBffEnvironment(ctx, '192.0.2.2', settings.environment), /已被修改/)
  assert.equal(bffLaunchEnvironment(ctx, settings.environment, true).env.HOST, '127.0.0.1')
  assert.equal(bffLaunchEnvironment(ctx, undefined, true).port, 3400)
  assert.equal(bffLaunchEnvironment(ctx, undefined, false).environment, undefined)
})

async function fixture(t, mode, service = 'setInterval(() => {}, 1000)', preparation, fault = '') {
  const root = fs.mkdtempSync(path.join(temporary, 'runner-'))
  const file = path.join(root, 'run.json'), capture = path.join(root, 'ssh.json')
  const run = {
    id: 'fixture', lock: path.join(root, 'lock.json'), log: path.join(root, 'run.log'), root, cwd: root,
    title: 'fixture BFF', service: 'bff', state: 'starting', createdAt: Date.now(), updatedAt: Date.now(),
    program: process.execPath, args: ['-e', `console.log('SERVICE-START'); ${service}`],
    preparation: preparation ? { program: fault === 'missing-preparation' ? path.join(root, 'missing') : process.execPath, args: ['-e', preparation], cwd: root } : null,
    sshForward: { host: '192.0.2.2', port: 3100, knownHosts: path.join(root, 'known_hosts'),
      password: mode === 'port' ? undefined : "fixture p@$'word" }
  }
  data.atomicJson(file, run)
  data.atomicJson(run.lock, { id: run.id, file })
  if (fault === 'log') fs.mkdirSync(run.log)
  const fake = mode === 'auth' ? "console.error('Permission denied (password).'); process.exitCode=255"
    : mode === 'port' ? "console.error('remote port forwarding failed for listen port 3100'); process.exitCode=255"
    : mode === 'connecting' ? 'setInterval(() => {}, 1000)'
    : `console.log('ORCA_BFF_FORWARD_READY'); process.stdin.resume(); process.stdin.on('end', () => process.exit()); ${mode === 'disconnect' ? 'setTimeout(() => process.exit(255), 350)' : ''}`
  const preload = path.join(root, 'mock.mjs')
  const moduleUrl = new URL('./ssh-forward.mjs', import.meta.url).href
  const processUrl = new URL('./service-processes.mjs', import.meta.url).href
  const dataUrl = new URL('./data.mjs', import.meta.url).href
  fs.writeFileSync(preload, `
    import { mock } from 'node:test'; import fs from 'node:fs'; import { spawn, execFileSync } from 'node:child_process';
    import { createSshForward } from ${JSON.stringify(moduleUrl)};
    import * as data from ${JSON.stringify(dataUrl)};
    import * as processes from ${JSON.stringify(processUrl)};
    let writes = 0;
    mock.module(${JSON.stringify(dataUrl)}, { namedExports: { ...data, atomicJson: (file, value) => {
      if (${JSON.stringify(fault)} === 'state' && writes++ === 0) throw new Error('fixture state unavailable');
      return data.atomicJson(file, value);
    } } });
    mock.module(${JSON.stringify(processUrl)}, { namedExports: { ...processes,
      observeServiceProcesses: async () => { if (${JSON.stringify(fault)} === 'monitor') throw new Error('fixture monitor unavailable'); return false },
      stopUnusedBroker: async () => { if (${JSON.stringify(fault)} === 'broker') throw new Error('fixture broker unavailable') }
    } });
    mock.module(${JSON.stringify(moduleUrl)}, { namedExports: { createSshForward: (settings, options) =>
      createSshForward(settings, { ...options, spawnProcess: (program, args, opts) => {
        const password = execFileSync(opts.env.SSH_ASKPASS, [], {env: opts.env, encoding: 'utf8'}).trimEnd();
        fs.writeFileSync(${JSON.stringify(capture)}, JSON.stringify({program, args, password, mode: opts.env.SSH_ASKPASS_REQUIRE}));
        return spawn(process.execPath, ['-e', ${JSON.stringify(fake)}], opts);
      } }) } });
  `)
  const child = spawn(process.execPath, ['--experimental-test-module-mocks', '--import', preload, path.join(plugin, 'runner.mjs'), file], { stdio: 'ignore' })
  const ended = new Promise(resolve => child.once('exit', resolve))
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) { child.kill('SIGTERM'); await ended } })
  return { file, run, child, ended, capture, log: () => fs.readFileSync(run.log, 'utf8') }
}

test('SSH authentication and forwarding failures warn once while preparation and BFF execute', { timeout: 10000 }, async t => {
  for (const mode of ['auth', 'port']) {
    const task = await fixture(t, mode, 'setTimeout(() => {}, 200)', "console.log('PREPARE-START')")
    assert.equal(await task.ended, 0)
    const result = data.readJson(task.file)
    assert.equal(result.state, 'exited')
    assert.match(result.warnings.find(item => item.id.endsWith(':ssh')).message, mode === 'auth' ? /密码认证失败.*不再重试/ : /转发端口 3100/)
    assert.match(task.log(), /SERVICE-START/)
    assert.match(task.log(), /PREPARE-START/)
    assert.equal(processGone(result.sshPid), true)
    const command = data.readJson(task.capture)
    assert.ok(command.args.includes('NumberOfPasswordPrompts=1'))
    assert.ok(command.args.includes('ConnectionAttempts=1'))
    assert.ok(command.args.includes('PreferredAuthentications=password'))
    assert.ok(command.args.includes('127.0.0.1:3100:127.0.0.1:3100'))
    assert.equal(command.mode, 'force')
    assert.equal(command.password, task.run.sshForward.password ?? 'password')
    assert.equal(command.args.includes(command.password), false)
    assert.ok(!task.log().includes(command.password))
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

test('preparation failure and SSH disconnect never stop BFF; service exit still closes SSH', { timeout: 10000 }, async t => {
  for (const [mode, service, preparation] of [
    ['ready', 'process.exitCode=0', null],
    ['ready', '', 'process.exitCode=7'],
    ['disconnect', 'setInterval(() => {}, 1000)', null]
  ]) {
    const task = await fixture(t, mode, service, preparation)
    if (mode === 'disconnect') {
      await until(() => Boolean(data.readJson(task.file).sshError))
      assert.equal(data.readJson(task.file).state, 'running')
      assert.equal(processGone(-data.readJson(task.file).childPid), false)
      await stopRun(task.file)
    }
    await task.ended
    const result = data.readJson(task.file)
    assert.match(task.log(), /SERVICE-START/)
    assert.equal(processGone(result.sshPid), true)
    if (result.childPid) assert.equal(processGone(-result.childPid), true)
    if (mode === 'disconnect') assert.match(result.sshError, /SSH 转发已断开/)
    if (preparation) assert.match(result.warnings[0].message, /依赖准备失败/)
  }
})

test('runner death closes SSH stdin and tunnel state does not determine main service state', { timeout: 10000 }, async t => {
  const task = await fixture(t, 'ready', '', 'setInterval(() => {}, 1000)')
  await until(() => data.readJson(task.file).state === 'preparing')
  const before = data.readJson(task.file)
  task.child.kill('SIGKILL')
  await task.ended
  await until(() => processGone(before.sshPid))
  process.kill(-before.childPid, 'SIGKILL')
  await until(() => processGone(-before.childPid))
  const stale = { state: 'running', updatedAt: 1, createdAt: 1, runnerPid: 1, childPid: 2, sshPid: 3 }
  assert.equal(observeRunState(stale, 20000, pid => pid !== -3), 'failed')
})

test('optional logging, recording, monitoring, broker and missing preparation executable failures do not fail the main command', { timeout: 10000 }, async t => {
  for (const fault of ['log', 'state', 'monitor', 'broker', 'missing-preparation']) {
    const task = await fixture(t, 'ready', "setTimeout(() => {}, 700)", 'process.exitCode=0', fault)
    assert.equal(await task.ended, 0, fault)
    const result = data.readJson(task.file)
    assert.equal(result.state, 'exited', fault)
    assert.ok(result.warnings?.length, fault)
    assert.equal(processGone(result.sshPid), true)
    if (fault !== 'log') assert.match(task.log(), /SERVICE-START/)
  }
})

test('main command failure remains a failure', async t => {
  const task = await fixture(t, 'ready', 'process.exitCode=4')
  assert.equal(await task.ended, 4)
  assert.equal(data.readJson(task.file).state, 'failed')
})

test('unverifiable historical runner and orphan groups are never signalled or reused', async () => {
  const file = path.join(temporary, 'orphan.json')
  data.atomicJson(file, { id: 'orphan', state: 'running', runnerPid: 123, childPid: 124 })
  const signals = []
  const result = await stopRun(file, { readIdentity: async () => null, gone: () => false,
    signal: (...args) => signals.push(args) })
  assert.equal(result.stopped, false)
  assert.deepEqual(signals, [])
  assert.match(result.warning, /跳过终端复用/)
})

import activate from './main.mjs'
import { stopRun } from './stop-run.mjs'
import { observeRunState } from './run-state.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { servers, applyBffEnvironment, atomicJson, readJson, context, quote } from './data.mjs'

const plugin = path.dirname(fileURLToPath(import.meta.url))
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orca-launcher-test-'))
  fs.mkdirSync(path.join(root, 'packages/products/cloud/bff'), { recursive: true })
  return root
}
test('validates host input and extracts IP from HTTP URLs', () => {
  assert.equal(servers([{ name: 'v6', host: '[::1]' }])[0].host, '::1')
  assert.equal(servers([{ name: 'http', host: 'http://172.24.1.0/' }])[0].host, '172.24.1.0')
  assert.equal(servers([{ name: 'https', host: 'https://172.2.1.89:5000/path?q=1#part' }])[0].host, '172.2.1.89')
  assert.equal(servers([{ name: 'v6 url', host: 'https://[::1]:5000/' }])[0].host, '::1')
  assert.throws(() => servers([
    { name: 'original', host: '172.24.1.0' },
    { name: 'url', host: 'http://172.24.1.0/' }
  ]), /重复/)
  for (const host of ['bad; echo x', '$(id)', 'https://host', 'host:8080', '',
    'http://172', 'http://999.2.1.1', 'http://user@172.24.1.0', 'ftp://172.24.1.0']) {
    assert.throws(() => servers([{ name: 'bad', host }]))
  }
  assert.throws(() =>
    servers([
      { name: 'a', host: 'a.test' },
      { name: 'b', host: 'a.test' }
    ])
  )
  assert.equal(quote("a'b"), "'a'\\''b'")
})
test('BFF updates only the target environment, preserves comments/port without generating a backup', (t) => {
  const root = fixture()
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const file = path.join(root, 'packages/products/cloud/bff/.env')
  const original =
    '# ZS_MN_SERVER=http://old:8080\nZS_MN_SERVER=http://active:8080\nZS_MYSQL_HOST=active\nZOPS_SERVER=http://active:10011/zops # keep\nTOKEN=preserved\n'
  fs.writeFileSync(file, original)
  applyBffEnvironment({ path: root, primary: root }, '192.0.2.7')
  const value = fs.readFileSync(file, 'utf8')
  assert.match(value, /# ZS_MN_SERVER=http:\/\/old:8080/)
  assert.match(value, /ZOPS_SERVER=http:\/\/192.0.2.7:10011\/zops # keep/)
  assert.match(value, /TOKEN=preserved/)
  assert.equal(fs.existsSync(file + '.orca-launcher.bak'), false)
})
test('rejects remote contexts and symlinked .env', (t) => {
  const root = fixture()
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  assert.throws(() => context({ path: root, worktreeId: 'w', executionHostId: 'ssh:x' }))
  const source = path.join(root, 'other.env')
  fs.writeFileSync(source, 'ZS_MYSQL_HOST=unchanged')
  fs.symlinkSync(source, path.join(root, 'packages/products/cloud/bff/.env'))
  assert.throws(() => applyBffEnvironment({ path: root, primary: root }, '192.0.2.1'))
  assert.equal(fs.readFileSync(source, 'utf8'), 'ZS_MYSQL_HOST=unchanged')
})
async function runFixture(t, source, preparationSource, options = {}) {
  const root = fixture()
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const file = path.join(root, 'run.json')
  const run = {
    id: 'test',
    lock: path.join(root, 'lock.json'),
    log: path.join(root, 'full.log'),
    root,
    cwd: root,
    title: 'fixture',
    preparation: preparationSource
      ? { program: process.execPath, args: ['-e', preparationSource], cwd: root }
      : undefined,
    program: process.execPath,
    args: ['-e', source],
    state: 'starting',
    createdAt: Date.now(),
    ...options
  }
  atomicJson(file, run)
  atomicJson(run.lock, { id: run.id, file })
  const child = spawn(process.execPath, [path.join(plugin, 'runner.mjs'), file], {
    stdio: ['ignore', 'pipe', 'pipe']
  })
  child.stdout.resume()
  let errors = ''
  child.stderr.on('data', (data) => (errors += data))
  t.after(() => {
    if (child.exitCode === null) child.kill('SIGTERM')
  })
  const ended = new Promise((resolve) => child.on('exit', (code) => resolve({ code, errors })))
  return { file, run, child, ended }
}
test(
  'retains full stdout and stderr and records service exit rather than terminal lifetime',
  { timeout: 10000 },
  async (t) => {
    const fixture = await runFixture(
      t,
      "process.stdout.write('A'.repeat(150000)); process.stderr.write('STDERR-END'); process.exitCode=7"
    )
    const result = await fixture.ended
    assert.equal(result.code, 7, result.errors)
    const run = readJson(fixture.file)
    assert.equal(run.state, 'failed')
    assert.equal(run.code, 7)
    const log = fs.readFileSync(run.log, 'utf8')
    assert.ok((log.match(/A/g) ?? []).length >= 150000)
    assert.ok(log.includes('STDERR-END'))
    assert.throws(() => process.kill(run.childPid, 0), { code: 'ESRCH' })
  }
)
test(
  'stop request terminates the recorded service process group',
  { timeout: 12000 },
  async (t) => {
    const fixture = await runFixture(
      t,
      'console.log("READY"); setInterval(()=>console.log("tick"),100)'
    )
    const start = Date.now()
    while (readJson(fixture.file).state !== 'running') {
      if (Date.now() - start > 5000) throw new Error('runner not started')
      await new Promise((resolve) => setTimeout(resolve, 30))
    }
    await stopRun(fixture.file)
    await fixture.ended
    const run = readJson(fixture.file)
    assert.equal(run.state, 'stopped')
    assert.throws(() => process.kill(run.childPid, 0), { code: 'ESRCH' })
    assert.throws(() => process.kill(fixture.child.pid, 0), { code: 'ESRCH' })
  }
)

test('a closed terminal is restartable only after its service group is gone', () => {
  const run = { state: 'running', updatedAt: 1, createdAt: 1, runnerPid: 100, childPid: 101 }
  assert.equal(
    observeRunState(run, 20_000, () => true),
    'failed'
  )
  assert.equal(
    observeRunState(run, 20_000, (pid) => pid === 100),
    'unknown'
  )
  assert.equal(
    observeRunState(run, 100, () => true),
    'running'
  )
})

test('startup status stays ready while a live BFF logs runtime errors', { timeout: 10000 }, async (t) => {
  const fixture = await runFixture(t,
    "console.log('Nest application successfully started'); setInterval(() => console.error('[Nest] ERROR runtime failure\\nFound 0 errors.'), 50)",
    undefined, { service: 'bff', health: 'starting' })
  await waitForState(fixture.file, 'running')
  await new Promise((resolve) => setTimeout(resolve, 700))
  const live = readJson(fixture.file)
  assert.equal(live.state, 'running')
  assert.equal(live.health, 'ready')
  assert.ok(live.startedAt)
  assert.match(fs.readFileSync(live.log, 'utf8'), /ERROR runtime failure/)
  await stopRun(fixture.file)
  await fixture.ended
  assert.equal(readJson(fixture.file).state, 'stopped')
  assert.throws(() => process.kill(live.childPid, 0), { code: 'ESRCH' })
})

test('worker uses the host default activation contract and registers both declared commands', () => {
  const handlers = new Map()
  activate({
    host: {
      call() {
        throw new Error('unexpected host call')
      }
    },
    commands: {
      register(id, handler) {
        handlers.set(id, handler)
      }
    }
  })
  assert.deepEqual([...handlers.keys()].sort(), [
    'launcher.request',
    'workspace-panel.services.probe'
  ])
  assert.deepEqual(handlers.get('workspace-panel.services.probe')({ context: null }), {
    supported: false
  })
})

test(
  'prepares dependencies before starting and still attempts the service after preparation fails',
  { timeout: 10000 },
  async (t) => {
    const ready = await runFixture(t, "console.log('SERVICE-START')", "console.log('PREPARED')")
    assert.equal((await ready.ended).code, 0)
    const log = fs.readFileSync(ready.run.log, 'utf8')
    assert.ok(log.indexOf('PREPARED\n') < log.indexOf('SERVICE-START\n'))
    const failed = await runFixture(t, "console.log('SERVICE-START')", 'process.exitCode=9')
    assert.equal((await failed.ended).code, 0)
    assert.equal(readJson(failed.file).state, 'exited')
    assert.match(readJson(failed.file).warnings[0].message, /依赖准备失败/)
    assert.ok(fs.readFileSync(failed.run.log, 'utf8').includes('SERVICE-START'))
  }
)
test(
  'stopping dependency preparation prevents the subsequent service launch',
  { timeout: 10000 },
  async (t) => {
    const fixture = await runFixture(
      t,
      "console.log('MUST-NOT-START')",
      'setInterval(() => {}, 1000)'
    )
    const deadline = Date.now() + 5000
    while (readJson(fixture.file).state !== 'preparing') {
      if (Date.now() > deadline) throw new Error('preparation not started')
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    await stopRun(fixture.file)
    await fixture.ended
    assert.equal(readJson(fixture.file).state, 'stopped')
    assert.ok(!fs.readFileSync(fixture.run.log, 'utf8').includes('MUST-NOT-START'))
  }
)

test(
  'dependency preparation has no interactive stdin and uses CI without changing the service environment',
  { timeout: 10000 },
  async (t) => {
    const fixture = await runFixture(
      t,
      "console.log('SERVICE_CI=' + (process.env.CI || 'unset'))",
      "if (process.env.CI !== 'true' || require('node:fs').readFileSync(0, 'utf8') !== '') process.exit(8); console.log('NONINTERACTIVE')"
    )
    assert.equal((await fixture.ended).code, 0)
    const log = fs.readFileSync(fixture.run.log, 'utf8')
    assert.ok(log.includes('NONINTERACTIVE'))
    assert.ok(log.includes('SERVICE_CI=' + (process.env.CI || 'unset')))
  }
)

async function waitForState(file, state) {
  const deadline = Date.now() + 5000
  while (readJson(file).state !== state) {
    if (Date.now() > deadline) throw new Error(`did not reach ${state}`)
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}
test('another service starts without waiting for an unfinished preparation', { timeout: 10000 }, async (t) => {
  const first = await runFixture(t, 'setInterval(() => {}, 1000)', 'setInterval(() => {}, 1000)')
  await waitForState(first.file, 'preparing')
  const second = await runFixture(t, 'setInterval(() => {}, 1000)', "console.log('SECOND-PREP')", {
    waitForPreparation: first.file
  })
  await waitForState(second.file, 'running')
  assert.equal(readJson(first.file).state, 'preparing')
  await stopRun(second.file)
  await second.ended
  assert.equal(readJson(first.file).state, 'preparing')
  await stopRun(first.file)
  await first.ended
})
test('cancelling one preparation leaves the other preparation untouched', { timeout: 10000 }, async (t) => {
  const first = await runFixture(t, "console.log('FIRST-SERVICE')", 'setInterval(() => {}, 1000)')
  await waitForState(first.file, 'preparing')
  const second = await runFixture(t, "console.log('MUST-NOT-START')", 'setInterval(() => {}, 1000)', {
    waitForPreparation: first.file
  })
  await waitForState(second.file, 'preparing')
  await stopRun(second.file)
  await second.ended
  assert.equal(readJson(second.file).state, 'stopped')
  assert.equal(readJson(first.file).state, 'preparing')
  assert.doesNotMatch(fs.readFileSync(second.run.log, 'utf8'), /MUST-NOT/)
  await stopRun(first.file)
  await first.ended
})

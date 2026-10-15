import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createServiceHealthObserver } from './service-health.mjs'
import { observeServiceProcesses, stopUnusedBroker } from './service-processes.mjs'
import { atomicJson } from './data.mjs'

test('frontend logs never classify a live service as failed or ready', () => {
  let state = { health: 'starting' }
  const receive = createServiceHealthObserver('fe', (next) => {
    state = next
  })
  receive('All services started!\n')
  assert.equal(state.health, 'starting')
  receive('\u001b[31merror\u001b[0m [browser] Uncaught Err')
  receive('or: broken component\n')
  assert.equal(state.health, 'starting')
  receive('ready built in 1.3s\n')
  assert.equal(state.health, 'starting')
})
test('BFF startup success survives runtime errors and later compilation logs', () => {
  let state = { health: 'starting' }
  const receive = createServiceHealthObserver('bff', (next) => {
    state = next
  })
  receive('Starting compilation in watch mode...\nFound 0 errors.\n')
  assert.equal(state.health, 'starting')
  receive('[Nest] Nest application successfully started\n')
  assert.equal(state.health, 'ready')
  const startedAt = state.startedAt
  receive('[Nest] ERROR Failed to refresh dashboard\nFound 0 errors.\n')
  assert.equal(state.health, 'ready')
  assert.equal(state.startedAt, startedAt)
})
test('FE readiness requires every selected port to belong to this run', async () => {
  const run = { childPid: 10, readinessPorts: [3000, 7001] }
  const readListeners = async () => [
    { pid: 11, port: 3000 },
    { pid: 12, port: 7001 }
  ]
  assert.equal(
    await observeServiceProcesses(run, {
      readListeners,
      readIdentity: async (pid) => ({ group: pid === 11 ? 10 : 20 })
    }),
    false
  )
  assert.equal(
    await observeServiceProcesses(run, {
      readListeners,
      readIdentity: async () => ({ group: 10 })
    }),
    true
  )
})
test('detached broker registration requires a parent in the service group', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orca-broker-owner-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const run = { root, registry: path.join(root, 'broker.json'), childPid: 10 }
  const broker = {
    pid: 99,
    parent: 11,
    identity: 'birth + command',
    command: '/node_modules/@module-federation/dts-plugin/dist/start-broker.js'
  }
  const readListeners = async () => [{ pid: 99, port: 16322 }]
  await observeServiceProcesses(run, {
    readListeners,
    readIdentity: async (pid) => (pid === 99 ? broker : { group: 20 })
  })
  assert.equal(fs.existsSync(run.registry), false)
  await observeServiceProcesses(run, {
    readListeners,
    readIdentity: async (pid) => (pid === 99 ? broker : { group: 10 })
  })
  assert.equal(JSON.parse(fs.readFileSync(run.registry)).pid, 99)
})
test('cleanup preserves reused PIDs, connected clients, and other workspaces; stops only a verified idle broker', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orca-broker-stop-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const run = { registry: path.join(root, 'broker.json') },
    owned = { pid: 99, identity: 'original birth + command' }
  atomicJson(run.registry, owned)
  let live = true,
    clients = '',
    identity = 'reused pid',
    signals = []
  const probe = {
    readIdentity: async () => (live ? { identity } : null),
    readClients: async () => clients,
    signalProcess: (pid, signal) => {
      signals.push([pid, signal])
      live = false
    }
  }
  await stopUnusedBroker(run, 'current', probe)
  assert.deepEqual(signals, [])
  identity = owned.identity
  clients = 'p99\n'
  await stopUnusedBroker(run, 'current', probe)
  assert.deepEqual(signals, [])
  clients = ''
  const peer = path.join(root, 'peer', 'run.json')
  atomicJson(peer, { state: 'starting', createdAt: Date.now(), updatedAt: Date.now() })
  atomicJson(path.join(root, 'peer', 'fe.json'), { file: peer })
  await stopUnusedBroker(run, 'current', probe)
  assert.deepEqual(signals, [])
  atomicJson(peer, { state: 'stopped' })
  await stopUnusedBroker(run, 'current', probe)
  assert.deepEqual(signals, [[99, 'SIGTERM']])
})

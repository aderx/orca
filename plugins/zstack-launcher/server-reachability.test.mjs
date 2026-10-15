import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import { createServerChecks } from './server-reachability.mjs'

test('checks run once in bounded batches; explicit refresh replaces cached results', async () => {
  let active = 0, maximum = 0, calls = 0, available = true
  const checks = createServerChecks(async (host) => {
    calls++; active++; maximum = Math.max(maximum, active)
    await delay(5)
    active--
    if (host === '192.0.2.1') throw new Error('unreachable')
    return available
  })
  const servers = Array.from({ length: 20 }, (_, index) => ({ host: `192.0.2.${index + 1}` }))
  const finish = async () => {
    for (let i = 0; i < 100 && (await checks.snapshot(servers)).checkingServers; i++) await delay(5)
    assert.equal((await checks.snapshot(servers)).checkingServers, false)
  }
  await checks.start(servers)
  await checks.start(servers)
  assert.equal((await checks.snapshot(servers)).checkingServers, true)
  await finish()
  assert.equal(calls, 20)
  assert.equal(maximum, 8)
  assert.equal((await checks.snapshot(servers)).serverChecks['192.0.2.1'].available, false)
  assert.equal((await checks.snapshot(servers)).serverChecks['192.0.2.2'].available, true)
  await checks.start(servers)
  assert.equal((await checks.snapshot(servers)).checkingServers, false)
  available = false
  await checks.start(servers, true)
  await finish()
  assert.equal(calls, 40)
  assert.equal((await checks.snapshot(servers)).serverChecks['192.0.2.2'].available, false)
})

test('reopening and reloading retain completed checks; only new addresses and manual refresh probe', async () => {
  let stored = { '192.0.2.1': { available: false, checkedAt: 1 } }, calls = 0, loads = 0
  const storage = {
    load: async () => { loads++; await delay(5); return structuredClone(stored) },
    save: (value) => { stored = structuredClone(value) }
  }
  const probe = async () => { calls++; await delay(5); return true }
  const servers = [{ host: '192.0.2.1' }, { host: '192.0.2.2' }]
  const finish = async (checks, list = servers) => {
    for (let i = 0; i < 100 && (await checks.snapshot(list)).checkingServers; i++) await delay(5)
    assert.equal((await checks.snapshot(list)).checkingServers, false)
    await delay(0)
  }
  const first = createServerChecks(probe, storage)
  await Promise.all([first.start(servers), first.start(servers), first.snapshot(servers)])
  await finish(first)
  assert.equal(loads, 1)
  assert.equal(calls, 1)
  const original = await first.snapshot(servers)
  const reloaded = createServerChecks(probe, storage)
  await reloaded.start(servers)
  assert.deepEqual(await reloaded.snapshot(servers), original)
  await reloaded.start(servers)
  await reloaded.snapshot(servers)
  assert.equal(calls, 1)
  await reloaded.start(servers, true)
  await finish(reloaded)
  assert.equal(calls, 3)
  assert.equal((await reloaded.snapshot(servers)).serverChecks['192.0.2.1'].available, true)
  const extended = [...servers, { host: '192.0.2.3' }]
  await reloaded.start(extended)
  await finish(reloaded, extended)
  assert.equal(calls, 4)
})

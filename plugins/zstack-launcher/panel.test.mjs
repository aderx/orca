import { Window } from 'happy-dom'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import assert from 'node:assert/strict'
const win = new Window()
const calls = []
let holdStarts = false
const startReplies = []
const data = {
  worktree: '/tmp/demo',
  products: [
    { id: 'cloud', label: 'Cloud（core-shell）' },
    { id: 'zns', label: 'ZNS（zns-shell）' }
  ],
  servers: [{ name: 'test', host: '192.0.2.1' }],
  modules: [
    {
      name: 'core-shell',
      port: 3000,
      available: true,
      dependenciesPresent: false,
      isShell: true,
      dependencies: []
    },
    { name: 'vpc', port: 3010, available: true, dependencies: ['account'] },
    { name: 'account', port: 3001, available: true, dependencies: [] }
  ],
  currentHost: '192.0.2.1',
  moduleError: null,
  selection: { apps: ['core-shell'], proxy: true, host: '192.0.2.1' },
  runs: { bff: null, fe: null }
}
const cloudData = data
const znsData = {
  ...data,
  modules: [
    { name: 'zns-shell', isShell: true, available: true, port: 3030, dependencies: [] },
    { name: 'zns-network', available: true, port: 3031, dependencies: [] }
  ],
  selection: { apps: [], proxy: true, host: '192.0.2.1' }
}
const parent = {
  postMessage(message) {
    calls.push(message)
    const args = message.params.args
    assert.doesNotThrow(() => JSON.stringify(args))
    const current = args.product === 'zns' ? znsData : cloudData
    if (args.action === 'saveSelection') {
      assert.ok(Array.isArray(args.apps))
      current.selection = { ...current.selection, apps: args.apps }
      assert.equal(args.proxy, false)
    }
    if (args.action === 'saveServers') current.servers = args.servers
    if (args.action === 'start')
      current.runs[args.kind] = { id: 'run', state: 'preparing', code: null }
    if (args.action === 'stop') current.runs[args.kind] = { id: 'run', state: 'stopped', code: 0 }
    const value =
      args.action === 'snapshot' ? current : args.action === 'status' ? current.runs : { ok: true }
    const reply = () =>
      win.dispatchEvent(
        new win.MessageEvent('message', {
          source: parent,
          data: { type: 'orca-panel-action-result', requestId: message.requestId, ok: true, value }
        })
      )
    if (holdStarts && args.action === 'start') startReplies.push(reply)
    else queueMicrotask(reply)
  }
}
Object.defineProperty(win, 'parent', { value: parent })
const html = fs.readFileSync(fileURLToPath(new URL('./panel.html', import.meta.url)), 'utf8')
const script = html.match(/<script>([\s\S]*)<\/script>/)[1]
win.document.write(html.replace(/<script>[\s\S]*<\/script>/, ''))
win.eval(script)
const wait = async (predicate) => {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return
    await new Promise((r) => setTimeout(r, 10))
  }
  throw new Error('UI response timeout')
}
try {
  await wait(
    () =>
      win.document.querySelectorAll('.module').length === 2 &&
      !win.document.getElementById('product').disabled
  )
  const check = win.document.querySelectorAll('.module input')[1]
  assert.equal(check.disabled, false)
  check.checked = true
  check.dispatchEvent(new win.Event('change'))
  await wait(
    () =>
      calls.some((call) => call.params.args.action === 'saveSelection') &&
      !win.document.getElementById('product').disabled
  )
  assert.equal(win.document.querySelectorAll('.module input')[1].disabled, false)
  assert.equal(JSON.stringify(data.selection.apps), JSON.stringify(['core-shell', 'vpc']))
  assert.equal(win.document.getElementById('toggle-fe').disabled, false)
  assert.equal(win.document.querySelectorAll('.server').length, 1)
  assert.equal(win.document.querySelector('.server input').checked, true)
  assert.match(win.document.getElementById('servers').textContent, /192\.0\.2\.1/)
  assert.equal(win.document.getElementById('editModules'), null)
  assert.equal(win.document.getElementById('product').value, 'cloud')
  assert.equal(win.document.querySelectorAll('#modules h3').length, 2)
  assert.ok(win.document.querySelector('.module-details button'))
  assert.equal(win.document.getElementById('proxy'), null)
  assert.equal(win.document.getElementById('logs'), null)
  assert.deepEqual(
    [...win.document.querySelectorAll('.module-name')].map((node) => node.textContent),
    ['account', 'vpc']
  )
  assert.equal(win.document.querySelector('.server-copy .path').textContent, '192.0.2.1')
  assert.match(win.document.querySelector('.server-copy').children[1].textContent, /test/)
  assert.ok(win.document.querySelector('.server-edit svg'))
  const viewport = win.document.getElementById('modules')
  viewport.getBoundingClientRect = () => ({ top: 50 })
  win.document.querySelector('.module-group[data-letter="V"]').getBoundingClientRect = () => ({
    top: 250
  })
  win.document.querySelector('#alphabet [data-letter="V"]').click()
  assert.equal(viewport.scrollTop, 200)
  assert.deepEqual(
    [...win.document.querySelectorAll('.module-name')].map((node) => node.textContent),
    ['account', 'vpc']
  )
  assert.equal(win.document.querySelector('#alphabet [data-letter="Z"]').disabled, true)
  assert.equal(win.document.querySelector('#alphabet [data-letter="V"]').getAttribute('aria-pressed'), 'true')
  assert.equal(win.document.querySelector('.server .badge').textContent, '当前')
  win.document.querySelector('[aria-label="在新标签页打开 192.0.2.1"]').click()
  await wait(
    () =>
      calls.some((call) => call.params.args.action === 'openServer') &&
      !win.document.getElementById('product').disabled
  )
  win.document.querySelector('.server-edit').click()
  assert.equal(win.document.getElementById('serverHost').value, '192.0.2.1')
  win.document.getElementById('serverName').value = '新的描述'
  win.document.getElementById('saveEditor').click()
  await wait(
    () =>
      calls.some((call) => call.params.args.action === 'saveServers') &&
      !win.document.getElementById('product').disabled
  )
  assert.equal(
    calls.find((call) => call.params.args.action === 'saveServers').params.args.servers[0].name,
    '新的描述'
  )
  const selectAll = win.document.getElementById('selectAll')
  selectAll.click()
  await wait(() => !selectAll.disabled && selectAll.getAttribute('aria-checked') === 'true')
  assert.deepEqual([...data.selection.apps].sort(), ['account', 'core-shell', 'vpc'])
  selectAll.click()
  await wait(() => !selectAll.disabled && selectAll.getAttribute('aria-checked') === 'false')
  assert.deepEqual([...data.selection.apps], ['core-shell'])
  const product = win.document.getElementById('product')
  product.value = 'zns'
  product.dispatchEvent(new win.Event('change'))
  await wait(
    () =>
      !product.disabled && win.document.querySelector('.module-name')?.textContent === 'zns-network'
  )
  assert.equal(win.document.querySelectorAll('.module').length, 1)
  assert.equal(win.document.getElementById('toggle-fe').disabled, false)
  win.document.getElementById('selectAll').click()
  await wait(() => !product.disabled && !win.document.getElementById('toggle-fe').disabled)
  holdStarts = true
  win.document.getElementById('toggle-fe').click()
  assert.equal(win.document.getElementById('toggle-fe').textContent, '启动中')
  assert.ok(win.document.querySelector('#toggle-fe svg.loading'))
  assert.equal(win.document.getElementById('toggle-bff').disabled, false)
  await wait(() => startReplies.length === 1)
  win.document.getElementById('toggle-bff').click()
  await wait(() => startReplies.length === 2)
  assert.equal(win.document.getElementById('toggle-bff').textContent, '启动中')
  holdStarts = false
  startReplies.splice(0).forEach((reply) => reply())
  await wait(
    () =>
      calls.some(
        (call) => call.params.args.action === 'start' && call.params.args.product === 'zns'
      ) && !product.disabled
  )
  assert.deepEqual(Array.from(znsData.selection.apps), ['zns-shell', 'zns-network'])
  assert.equal(win.document.getElementById('toggle-fe').textContent, '启动中')
  assert.equal(win.document.getElementById('toggle-fe').disabled, false)
  win.document.getElementById('toggle-fe').click()
  await wait(
    () => !product.disabled && win.document.getElementById('toggle-fe').textContent === '启动（1）'
  )
  assert.ok(calls.some((call) => call.params.args.action === 'stop'))
  product.value = 'cloud'
  product.dispatchEvent(new win.Event('change'))
  await wait(() => !product.disabled && win.document.querySelectorAll('.module').length === 2)
  assert.equal(win.document.querySelectorAll('.module input')[1].checked, false)
  assert.ok(win.document.querySelector('.toolbar #toggle-bff'))
  assert.ok(win.document.querySelector('.toolbar #toggle-fe'))
  console.log(
    'Panel passed: current server, browser action, inline dependencies, alphabet scrolling, select all/none, product choices, start/stop and removed controls.'
  )
} finally {
  await win.happyDOM.close()
}

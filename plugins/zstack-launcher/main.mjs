import { productConfigs } from './products.mjs'
import { changedModules } from './changed-modules.mjs'
import { preparationCommand } from './dependency-install.mjs'
import { stopRun } from './stop-run.mjs'
import { observeRunState } from './run-state.mjs'
import { createServerChecks } from './server-reachability.mjs'
import { readBffEnvironment, bffLaunchEnvironment } from './bff-environment.mjs'
import { detectBffLocalHost } from './bff-local-host.mjs'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import {
  context,
  server,
  servers,
  importServers,
  currentBffHost,
  applyBffEnvironment,
  dataDirectory,
  atomicJson,
  readJson,
  quote
} from './data.mjs'

const root = path.dirname(fileURLToPath(import.meta.url))
const directory = dataDirectory(root)
const execute = promisify(execFile)
const terminalStates = new Set(['stopped', 'exited', 'failed', 'cancelled'])
const catalogCache = new Map()
const serverChecks = createServerChecks(undefined, {
  load: async () => (await attempt(null, '读取服务器检测缓存',
    () => host.call('storage.get', { key: 'serverChecks' })))?.value,
  save: (value) => attempt(null, '保存服务器检测缓存',
    () => host.call('storage.set', { key: 'serverChecks', value }))
})
const notices = new Map()
const runMemory = new Map()
let cachedState
let host
let chain = Promise.resolve()
function warn(ctx, key, message) {
  const scope = ctx?.worktreeKey || 'global'
  const entries = notices.get(scope) ?? new Map()
  const text = String(message).slice(0, 1000)
  if (entries.get(key)?.message !== text)
    entries.set(key, { id: randomUUID(), message: text })
  while (entries.size > 16) entries.delete(entries.keys().next().value)
  notices.set(scope, entries)
}
function attemptSync(ctx, key, action, fallback) {
  try { return action() }
  catch (error) { warn(ctx, key, `${key}失败：${error.message}`); return fallback }
}
async function attempt(ctx, key, action, fallback) {
  try { return await action() }
  catch (error) { warn(ctx, key, `${key}失败：${error.message}`); return fallback }
}
function runNotices(ctx, runs) {
  return [...(notices.get('global')?.values() ?? []), ...(notices.get(ctx.worktreeKey)?.values() ?? []),
    ...runs.flatMap(run => [...(run?.warnings ?? []),
      ...(run?.state === 'failed' ? [{ id: `${run.id}:failed`, message: run.error || `${run.title} 启动失败，请查看终端` }] : [])])
  ].slice(-32)
}
function product(value) {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9]*$/.test(value)) throw new Error('无效产品')
  return value
}
function kind(value) {
  if (!['bff', 'fe'].includes(value)) throw new Error('未知服务类型')
  return value
}
async function catalog(ctx, name, refresh = false) {
  const cacheKey = `${ctx.path}:${product(name)}`
  const cached = catalogCache.get(cacheKey)
  if (!refresh && cached && Date.now() - cached.time < 30_000) return cached.modules
  const { stdout } = await execute('bun', [path.join(root, 'catalog.mjs'), ctx.path, name], {
    cwd: ctx.path,
    timeout: 15_000,
    maxBuffer: 1024 * 1024,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined }
  }).catch((error) => {
    throw new Error(error.stderr?.trim() || `无法读取 ${name} 模块目录：${error.message}`)
  })
  const modules = JSON.parse(stdout)
  catalogCache.set(cacheKey, { modules, time: Date.now() })
  return modules
}
async function state() {
  if (cachedState) return cachedState
  const saved = await attempt(null, '读取启动配置缓存',
    () => host.call('storage.get', { key: 'configuration' }))
  cachedState = { version: 1, projects: saved?.value?.projects ?? {}, selections: saved?.value?.selections ?? {} }
  return cachedState
}
const saveState = (value) => {
  cachedState = value
  return attempt(null, '保存启动配置缓存', () => host.call('storage.set', { key: 'configuration', value }))
}
function projectState(state, ctx) {
  return state.projects[ctx.projectKey] ?? { servers: attemptSync(ctx, '导入服务器列表', () => importServers(ctx), []), modules: {} }
}
function lockPath(ctx, service) {
  return path.join(directory, ctx.worktreeKey, `${kind(service)}.json`)
}
function runState(ctx, service) {
  const lock = lockPath(ctx, service)
  let pointer = runMemory.get(lock)
  if (!pointer && fs.existsSync(lock)) pointer = attemptSync(ctx, `${service} 历史记录读取`, () => readJson(lock))
  if (!pointer) return null
  const run = attemptSync(ctx, `${service} 运行状态读取`, () => readJson(pointer.file), pointer.run)
  if (!run) return null
  runMemory.set(lock, { ...pointer, run })
  const observed = observeRunState(run)
  const productIndex = run.args?.indexOf('--product') ?? -1
  const appsIndex = run.args?.indexOf('--apps') ?? -1
  return {
    id: run.id,
    state: observed,
    title: run.title,
    product: run.product ?? (productIndex >= 0 ? run.args[productIndex + 1] : null) ?? null,
    apps: service === 'fe' && appsIndex >= 0 ? (run.args[appsIndex + 1] ?? '').split(',').filter(Boolean) : [],
    host: run.host ?? (service === 'bff' ? run.title?.match(/^BFF · (.+)$/)?.[1] : null) ?? null,
    environmentSummary: run.environmentSummary ?? null,
    sshForward: run.sshForward ? { password: run.sshForward.password ?? 'password' } : null,
    sshConnected: run.sshConnected ?? null,
    sshError: run.sshError ?? null,
    warnings: run.warnings ?? [],
    url: run.url ?? null,
    operation: run.operation ?? 'start',
    health: run.startedAt ? 'ready' : run.health ?? 'starting',
    log: run.log,
    file: pointer.file,
    handle: attemptSync(ctx, `${service} 终端记录读取`, () => fs.existsSync(`${pointer.file}.terminal`)
      ? readJson(`${pointer.file}.terminal`).handle : pointer.handle ?? null, pointer.handle ?? null),
    code: run.code ?? null,
    error:
      run.error ??
      (observed === 'failed' && run.state !== 'failed'
        ? '原终端的运行器及服务进程已结束，可重新启动'
        : null),
    createdAt: run.createdAt
  }
}
function serverCandidates(saved, ctx) {
  const candidates = [...projectState(saved, ctx).servers]
  const currentHost = attemptSync(ctx, '读取当前管理节点', () => currentBffHost(ctx), '')
  if (!saved.projects[ctx.projectKey] && currentHost && !candidates.some((server) => server.host === currentHost))
    candidates.push({ host: currentHost, name: '当前工作树' })
  return candidates
}
async function snapshot(ctx, name, refresh, presentation, expanded) {
  const saved = await state()
  const runs = { bff: runState(ctx, 'bff'), fe: runState(ctx, 'fe') }
  const active = runs[presentation] && !terminalStates.has(runs[presentation].state)
  if (presentation === 'fe' && expanded === undefined && active && runs.fe.product)
    name = product(runs.fe.product)
  const includeLists = !presentation || !active || expanded === true
  const needsFrontend = includeLists && presentation !== 'bff'
  const needsBackend = includeLists && presentation !== 'fe'
  let modules = [],
    moduleError = null
  // The backend picker does not need to wait for frontend catalogs or branch-change detection.
  if (needsFrontend) {
    try {
      modules = await catalog(ctx, name, refresh)
    } catch (error) {
      moduleError = error.message
    }
  }
  const products = await Promise.all(
    attemptSync(ctx, '读取产品目录', () => productConfigs(ctx.path), [{ id: name, label: name }]).map(async (item) => {
      if (!needsFrontend) return { id: item.id, label: item.label }
      try {
        const entries = (await catalog(ctx, item.id))
          .filter((module) => module.isShell)
          .map((module) => module.name)
        return {
          id: item.id,
          label: entries.length ? `${item.label}（${entries.join(', ')}）` : item.label
        }
      } catch {
        return { id: item.id, label: item.label }
      }
    })
  )
  let changedApps = [], changeError = null
  if (needsFrontend && !moduleError) {
    try {
      changedApps = (await changedModules(ctx.path, modules)).apps
    } catch (error) {
      changeError = error.message
    }
  }
  const currentHost = attemptSync(ctx, '读取当前管理节点', () => currentBffHost(ctx), '')
  const candidates = needsBackend ? serverCandidates(saved, ctx) : []
  if (needsBackend) await attempt(ctx, '检测服务器', () => serverChecks.start(candidates))
  const selection = saved.selections[`${ctx.worktreeKey}:${name}`] ?? {
    apps: [],
    proxy: false,
    host: ''
  }
  return {
    presentation: ['bff', 'fe'].includes(presentation) ? presentation : null,
    product: name,
    worktree: ctx.path,
    currentHost,
    products,
    servers: candidates,
    ...(await attempt(ctx, '读取服务器检测结果', () => serverChecks.snapshot(candidates), {})),
    loadedLists: [needsBackend ? 'bff' : null, needsFrontend ? 'fe' : null].filter(Boolean),
    modules,
    moduleError,
    changedApps,
    changeError,
    selection: {
      ...selection,
      host: selection.host || currentHost
    },
    dependencies: {
      bff: fs.existsSync(path.join(ctx.path, 'packages/products/cloud/bff/node_modules/.bin/nest'))
    },
    runs,
    notices: runNotices(ctx, Object.values(runs))
  }
}
function sshSettings(previous, request) {
  const sshPassword = request.sshPassword === undefined
    ? previous?.sshPassword ?? 'password' : request.sshPassword
  if (typeof sshPassword !== 'string' || /[\r\n\0]/.test(sshPassword))
    throw new Error('SSH 密码不能包含换行或空字符')
  return {
    sshForward: request.sshForward === undefined
      ? previous?.sshForward !== false : request.sshForward === true,
    sshPassword
  }
}
async function saveSelection(ctx, request) {
  const service = request.kind ?? request.presentation
  const name = product(request.product)
  if (!Array.isArray(request.apps) || !request.apps.every(value => typeof value === 'string'))
    throw new Error('无效的模块参数')
  const saved = await state()
  const previous = saved.selections[`${ctx.worktreeKey}:${name}`]
  saved.selections[`${ctx.worktreeKey}:${name}`] = {
    apps: service === 'bff' ? (previous?.apps ?? []) : [...new Set(request.apps)],
    autoChanged: typeof request.autoChanged === 'boolean' ? request.autoChanged : (previous?.autoChanged ?? true),
    proxy: false,
    ...attemptSync(ctx, 'SSH 配置', () => sshSettings(previous, service === 'fe' ? {} : request),
      { sshForward: false, sshPassword: '' }),
    host: service === 'fe' ? (previous?.host ?? '') : request.host || ''
  }
  await saveState(saved)
}
const terminalJobs = new Map()
async function startTerminal(ctx, run, file, reuseHandle) {
  if (terminalJobs.has(file)) return terminalJobs.get(file)
  const completion = (async () => {
    const command = ['env', 'ELECTRON_RUN_AS_NODE=1', quote(process.execPath),
      quote(path.join(root, 'runner.mjs')), quote(file)].join(' ')
    let terminal
    if (reuseHandle) {
      try {
        const workspace = await host.call('workspace.readContext', {})
        if (!workspace?.terminals.some(item => item.id === reuseHandle)) throw new Error('原终端已关闭')
        await host.call('terminal.focusOwned', { terminalId: reuseHandle })
        const result = await host.call('terminal.sendText', { terminalId: reuseHandle, text: command, enter: true })
        if (!result.accepted) throw new Error('终端未接受命令')
        terminal = { handle: reuseHandle }
      } catch (error) {
        warn(ctx, `${run.id}:terminal`, `原终端无法复用，已改用新终端：${error.message}`)
      }
    }
    try {
      terminal ??= await host.call('terminal.create', { worktreeId: ctx.worktreeId, command, title: run.service.toUpperCase() })
    } catch (error) {
      Object.assign(run, { state: 'failed', error: error.message, updatedAt: Date.now() })
      attemptSync(ctx, '保存启动失败状态', () => atomicJson(file, run))
      throw error
    }
    const pointer = runMemory.get(run.lock)
    if (pointer?.file === file) pointer.handle = terminal.handle
    attemptSync(ctx, '保存终端记录', () => atomicJson(`${file}.terminal`, { handle: terminal.handle }))
    return { id: run.id, notices: runNotices(ctx, []) }
  })()
  terminalJobs.set(file, completion)
  return completion
}
async function launch(ctx, request, install = false) {
  const service = kind(request.kind), name = product(request.product ?? 'cloud')
  const saved = await state()
  const previous = saved.selections[`${ctx.worktreeKey}:${name}`] ?? {}
  const selected = {
    ...previous,
    apps: request.apps ?? previous.apps ?? [],
    host: request.host ?? previous.host ?? '',
    ...attemptSync(ctx, 'SSH 配置', () => sshSettings(previous, request), { sshForward: false, sshPassword: '' })
  }
  let cwd = ctx.path, program = 'pnpm', args, title, preparation, modules = [], bffSettings
  if (service === 'bff') {
    cwd = path.join(ctx.path, 'packages/products/cloud/bff')
    if (!install) {
      selected.host = server({ host: selected.host, name: selected.host }).host
      bffSettings = bffLaunchEnvironment(ctx, request.environment, selected.sshForward, selected.host)
      if (bffSettings.warning) warn(ctx, 'BFF 环境', bffSettings.warning)
    }
    preparation = preparationCommand('cloud', ['bff'])
    args = ['start:dev']
    title = `BFF · ${selected.host}`
  } else {
    if (!Array.isArray(selected.apps) || !selected.apps.length ||
        !selected.apps.every(value => typeof value === 'string' && value && !/[\0\r\n,]/.test(value)))
      throw new Error('请选择需要启动的模块')
    modules = await attempt(ctx, '读取模块目录', () => catalog(ctx, name, true), [])
    preparation = preparationCommand(name, selected.apps)
    program = 'bun'
    args = ['./scripts/start.ts', '--product', name, '--apps', selected.apps.join(','), '--proxy=false']
    title = `FE · ${name}`
  }
  if (!fs.statSync(cwd).isDirectory()) throw new Error('启动目录不存在')
  if (install) { cwd = ctx.path; ({ program, args } = preparation); title = `准备 ${service.toUpperCase()} 依赖`; preparation = null }
  const existing = runState(ctx, service)
  const id = randomUUID(), lock = lockPath(ctx, service)
  let file = path.join(directory, ctx.worktreeKey, `${service}-${id}.json`)
  const entry = modules.find(item => item.isShell && selected.apps.includes(item.name) && item.port > 0)
  const run = {
    id, lock, log: `${file}.log`, root: ctx.path, cwd, title, service, product: name,
    host: service === 'bff' ? selected.host : null,
    env: bffSettings?.env,
    environmentSummary: bffSettings?.summary ?? null,
    sshForward: bffSettings?.port ? {
      host: selected.host, port: bffSettings.port, password: selected.sshPassword,
      knownHosts: path.join(directory, 'ssh-known-hosts')
    } : null,
    url: entry ? `http://localhost:${entry.port}` : null,
    registry: path.join(directory, 'module-federation-broker.json'),
    readinessPorts: modules.filter(item => selected.apps.includes(item.name)).map(item => item.port),
    health: 'starting', program, args, preparation: preparation ? { ...preparation, cwd: ctx.path } : null,
    operation: install ? 'install' : 'start', state: 'starting', createdAt: Date.now(), updatedAt: Date.now()
  }
  try { atomicJson(file, run) }
  catch (error) {
    warn(ctx, '保存运行记录', `运行记录保存失败，改用临时目录继续启动：${error.message}`)
    file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'orca-zstack-run-')), 'run.json')
    run.log = `${file}.log`
    atomicJson(file, run)
  }
  runMemory.set(lock, { id, file, run })
  attemptSync(ctx, '保存运行索引', () => atomicJson(lock, { id, file }))
  const completion = (async () => {
    let reuseHandle
    if (existing) {
      const stopped = await stopRun(existing.file)
      if (stopped.warning) warn(ctx, `${id}:cleanup`, stopped.warning)
      if (stopped.stopped) reuseHandle = existing.handle
    }
    // A user stop while old-service cleanup is pending must cancel this submitted launch.
    if (fs.existsSync(`${file}.stop`)) return { id, notices: runNotices(ctx, []) }
    if (bffSettings) attemptSync(ctx, '保存 BFF 环境（本次配置仍通过进程环境生效）',
      () => applyBffEnvironment(ctx, selected.host, bffSettings.environment))
    return startTerminal(ctx, run, file, reuseHandle)
  })()
  return { completion }
}
async function dispatch(request) {
  const ctx = context(request.context)
  if (ctx.contextWarning) warn(ctx, 'Git 信息', ctx.contextWarning)
  const name = product(request.product ?? 'cloud')
  switch (request.action) {
    case 'snapshot':
      return snapshot(ctx, name, request.refresh === true, request.presentation, request.expanded)
    case 'bffEnvironment':
      return readBffEnvironment(ctx)
    case 'detectBffLocalHost':
      return detectBffLocalHost()
    case 'checkServers':
    case 'serverChecks': {
      const candidates = serverCandidates(await state(), ctx)
      if (request.action === 'checkServers') await serverChecks.start(candidates, true)
      return serverChecks.snapshot(candidates)
    }
    case 'changedModules':
      return changedModules(ctx.path, await catalog(ctx, name, true))
    case 'openServer': {
      const saved = await state()
      const candidate = projectState(saved, ctx).servers.find((item) => item.host === request.host)
      if (!candidate && request.host !== currentBffHost(ctx))
        throw new Error('服务器已变化，请刷新')
      const address = request.host.includes(':') ? `[${request.host}]` : request.host
      await host.call('browser.open', { worktreeId: ctx.worktreeId, url: `http://${address}:5000` })
      return { ok: true }
    }
    case 'openFrontend': {
      const run = runState(ctx, 'fe')
      if (run?.id !== request.id || run.state !== 'running' || run.health !== 'ready')
        throw new Error('前端尚未启动完成，或任务已变化，请刷新后重试')
      let url = run.url
      if (!url) {
        const entry = (await catalog(ctx, product(run.product))).find((item) =>
          item.isShell && run.apps.includes(item.name) && item.port > 0)
        if (entry) url = `http://localhost:${entry.port}`
      }
      if (!url || !/^http:\/\/localhost:\d+$/.test(url)) throw new Error('未找到本次前端运行的产品入口地址')
      // The launcher is macOS-local; open the ready product in the system's default browser.
      await execute('/usr/bin/open', [url], { timeout: 5000 })
      return { ok: true }
    }
    case 'status':
      return { bff: runState(ctx, 'bff'), fe: runState(ctx, 'fe') }
    case 'saveServers': {
      const saved = await state()
      const project = projectState(saved, ctx)
      const candidates = servers(request.servers)
      saved.projects[ctx.projectKey] = { ...project, servers: candidates }
      if (request.selectHost !== undefined) {
        if (!candidates.some((candidate) => candidate.host === request.selectHost))
          throw new Error('新服务器已变化，请重新保存')
        const selectionKey = `${ctx.worktreeKey}:${name}`
        saved.selections[selectionKey] = {
          apps: [], proxy: false, ...saved.selections[selectionKey], host: request.selectHost
        }
      }
      await saveState(saved)
      return { ok: true }
    }
    case 'saveSelection':
      await saveSelection(ctx, request)
      return { ok: true }
    case 'saveSshSettings': {
      const saved = await state(), key = `${ctx.worktreeKey}:${name}`
      const previous = saved.selections[key] ?? { apps: [], proxy: false, host: '' }
      saved.selections[key] = { ...previous, ...sshSettings(previous, request) }
      await saveState(saved)
      return { ok: true }
    }
    case 'start':
    case 'restart': {
      if (request.apps) await attempt(ctx, '保存启动选择', () => saveSelection(ctx, request))
      if (request.kind === 'bff') void attempt(ctx, '检测服务器', async () =>
        serverChecks.start(serverCandidates(await state(), ctx)))
      return launch(ctx, request)
    }
    case 'createTerminal': {
      const current = runState(ctx, kind(request.kind))
      if (current?.id !== request.id) throw new Error('启动请求已变化')
      const run = readJson(current.file)
      return { completion: startTerminal(ctx, run, current.file) }
    }
    case 'install':
      return launch(ctx, request, true)
    case 'stop': {
      const current = runState(ctx, request.kind)
      if (!current || current.id !== request.id) throw new Error('任务已变化，请刷新后重试')
      return { completion: stopRun(current.file).then(result => {
        if (result.warning) warn(ctx, `${current.id}:stop`, result.warning)
        return { ok: result.stopped, notices: runNotices(ctx, []) }
      }) }
    }
    case 'focus': {
      const current = runState(ctx, request.kind)
      if (!current?.handle) throw new Error('尚未创建终端')
      return host.call('terminal.focusOwned', { terminalId: current.handle })
    }
    case 'log': {
      const current = runState(ctx, request.kind)
      if (!current || !fs.existsSync(current.log))
        return { text: '暂无日志', path: current?.log ?? '' }
      const fd = fs.openSync(current.log, 'r')
      try {
        const size = fs.fstatSync(fd).size
        const buffer = Buffer.alloc(Math.min(size, 24_000))
        fs.readSync(fd, buffer, 0, buffer.length, Math.max(0, size - buffer.length))
        return { text: buffer.toString('utf8'), path: current.log, truncated: size > buffer.length }
      } finally {
        fs.closeSync(fd)
      }
    }
    default:
      throw new Error('未知启动器操作')
  }
}
export default function activate(orca) {
  host = orca.host
  cachedState = undefined
  notices.clear()
  runMemory.clear()
  terminalJobs.clear()
  void state().then((saved) => serverChecks.start(
    Object.values(saved.projects).flatMap((project) => project.servers ?? [])
  )).catch(() => undefined)
  orca.commands.register('workspace-panel.services.probe', async (request) => {
    try {
      context(request?.context)
      return { supported: true, toolbar: true }
    } catch {
      return { supported: false }
    }
  })
  orca.commands.register('workspace-panel.services.toolbar', async (request) => {
    let ctx
    try { ctx = context(request?.context) } catch { return { enabled: false, items: [] } }
    const items = ['bff', 'fe'].map((service) => {
      const run = runState(ctx, service)
      let status = 'idle', description = '未启动'
      if (run?.state === 'unknown' || (run && !terminalStates.has(run.state) && run.health === 'unverifiable')) { status = 'unverifiable'; description = '状态暂不可确认' }
      else if (run?.state === 'failed' || run?.state === 'pending-timeout') { status = 'error'; description = '启动失败' }
      else if (run && !terminalStates.has(run.state)) {
        status = run.health === 'ready' && run.state === 'running' ? 'ready' : 'starting'
        description = status === 'ready' ? '已启动' : run.state === 'stopping' ? '停止中' : run.state === 'preparing' ? '正在准备依赖' : '启动中'
      }
      return {
        id: service,
        title: service.toUpperCase(),
        icon: service === 'bff' ? 'Zap' : 'Lightbulb',
        width: service === 'bff' ? 384 : 448,
        status,
        description: description.slice(0, 256)
      }
    })
    return { enabled: true, items, notices: runNotices(ctx, ['bff', 'fe'].map(service => runState(ctx, service))) }
  })
  orca.commands.register('launcher.request', (request) => {
    const result = chain.then(() => dispatch(request))
    chain = result.catch(() => undefined)
    return result.then((value) => value.completion ?? value)
  })
}

import { productConfigs } from './products.mjs'
import { changedModules } from './changed-modules.mjs'
import { preparationCommand } from './dependency-install.mjs'
import { stopRun } from './stop-run.mjs'
import { observeRunState, processGone } from './run-state.mjs'
import { createServerChecks } from './server-reachability.mjs'
import { readBffEnvironment, bffLaunchEnvironment } from './bff-environment.mjs'
import { detectBffLocalHost } from './bff-local-host.mjs'
import { setTimeout as delay } from 'node:timers/promises'
import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import {
  context,
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
  load: async () => (await host.call('storage.get', { key: 'serverChecks' })).value,
  save: (value) => host.call('storage.set', { key: 'serverChecks', value })
})
const restarting = new Set()
let host
let chain = Promise.resolve()
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
  return (
    (await host.call('storage.get', { key: 'configuration' })).value ?? {
      version: 1,
      projects: {},
      selections: {}
    }
  )
}
const saveState = (value) => host.call('storage.set', { key: 'configuration', value })
function projectState(state, ctx) {
  return state.projects[ctx.projectKey] ?? { servers: importServers(ctx), modules: {} }
}
function lockPath(ctx, service) {
  return path.join(directory, ctx.worktreeKey, `${kind(service)}.json`)
}
function runState(ctx, service) {
  const lock = lockPath(ctx, service)
  if (!fs.existsSync(lock)) return null
  const pointer = readJson(lock)
  const run = readJson(pointer.file)
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
    url: run.url ?? null,
    operation: run.operation ?? 'start',
    health: run.startedAt ? 'ready' : run.health ?? 'starting',
    log: run.log,
    file: pointer.file,
    handle: fs.existsSync(`${pointer.file}.terminal`)
      ? readJson(`${pointer.file}.terminal`).handle
      : null,
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
  const currentHost = currentBffHost(ctx)
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
    productConfigs(ctx.path).map(async (item) => {
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
  const currentHost = currentBffHost(ctx)
  const candidates = needsBackend ? serverCandidates(saved, ctx) : []
  if (needsBackend) await serverChecks.start(candidates)
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
    ...(await serverChecks.snapshot(candidates)),
    loadedLists: [needsBackend ? 'bff' : null, needsFrontend ? 'fe' : null].filter(Boolean),
    modules,
    moduleError,
    changedApps,
    changeError,
    selection: {
      ...selection,
      host: !needsBackend ? selection.host || currentHost :
        (candidates.some((server) => server.host === selection.host) ? selection.host : '') ||
        (candidates.some((server) => server.host === currentHost) ? currentHost : '')
    },
    dependencies: {
      bff: fs.existsSync(path.join(ctx.path, 'packages/products/cloud/bff/node_modules/.bin/nest'))
    },
    runs
  }
}
async function saveSelection(ctx, request) {
  const service = request.kind ?? request.presentation
  const name = product(request.product)
  const modules =
    request.kind === 'bff' || request.apps?.length === 0 ? [] : await catalog(ctx, name)
  const available = new Set(modules.filter((value) => value.available).map((value) => value.name))
  if (
    !Array.isArray(request.apps) ||
    (request.kind !== 'bff' && !request.apps.every((value) => available.has(value)))
  )
    throw new Error('模块已不存在或不可启动，请刷新并重新选择')
  if (typeof request.proxy !== 'boolean') throw new Error('无效的代理选项')
  const saved = await state()
  const candidates = projectState(saved, ctx).servers
  if (
    request.host &&
    request.host !== currentBffHost(ctx) &&
    !candidates.some((value) => value.host === request.host)
  )
    throw new Error('后端服务器已被修改，请重新选择')
  const previous = saved.selections[`${ctx.worktreeKey}:${name}`]
  const sshPassword = service === 'fe' || request.sshPassword === undefined
    ? previous?.sshPassword ?? 'password' : request.sshPassword
  if (typeof sshPassword !== 'string' || /[\r\n\0]/.test(sshPassword))
    throw new Error('SSH 密码不能包含换行或空字符')
  saved.selections[`${ctx.worktreeKey}:${name}`] = {
    apps: service === 'bff' ? (previous?.apps ?? []) : [...new Set(request.apps)],
    autoChanged: typeof request.autoChanged === 'boolean' ? request.autoChanged : (previous?.autoChanged ?? true),
    proxy: false,
    sshForward: service === 'fe' || request.sshForward === undefined
      ? previous?.sshForward === true : request.sshForward === true,
    sshPassword,
    host: service === 'fe' ? (previous?.host ?? '') : request.host || ''
  }
  await saveState(saved)
}
async function waitForSshForward(file) {
  // Leave room for restart cleanup inside the host's 30-second command budget.
  const deadline = readJson(file).createdAt + 20000
  while (true) {
    const run = readJson(file)
    if (!run.sshForward || run.sshConnected) return
    if (terminalStates.has(observeRunState(run))) throw new Error(run.error || 'SSH 转发启动已取消')
    if (Date.now() >= deadline) throw new Error('SSH 转发尚未启动，已取消本次启动，请查看终端')
    await delay(100)
  }
}
async function launch(ctx, request, install = false) {
  const service = kind(request.kind)
  const existing = runState(ctx, service)
  if (existing && !terminalStates.has(existing.state))
    throw new Error('当前 worktree 的同类服务尚未结束，请先停止或取消待启动任务')
  if (existing) {
    const previous = readJson(existing.file)
    const deadline = Date.now() + 2000
    while (previous.runnerPid && !processGone(previous.runnerPid)) {
      if (Date.now() >= deadline) throw new Error('原运行器尚未退出，请稍后重试')
      await delay(50)
    }
  }
  const name = product(request.product)
  const saved = await state()
  const selected = saved.selections[`${ctx.worktreeKey}:${name}`]
  if (!selected) throw new Error('请先选择并保存启动配置')
  let cwd = ctx.path,
    program = 'pnpm',
    args,
    title,
    preparation,
    readinessPorts = [],
    url = null
  const bffSettings = service === 'bff' && !install
    ? bffLaunchEnvironment(ctx, request.environment, selected.sshForward) : null
  if (install) {
    if (service === 'bff') {
      ;({ program, args } = preparationCommand('cloud', ['bff']))
      title = '安装 BFF 依赖'
    } else {
      const available = new Set(
        (await catalog(ctx, name, true)).filter((item) => item.available).map((item) => item.name)
      )
      if (!selected.apps.length || !selected.apps.every((app) => available.has(app)))
        throw new Error('先选择有源码的前端模块')
      ;({ program, args } = preparationCommand(name, selected.apps))
      title = `安装 FE 依赖 · ${name}`
    }
  } else if (service === 'bff') {
    if (
      !selected.host ||
      (selected.host !== currentBffHost(ctx) &&
        !projectState(saved, ctx).servers.some((value) => value.host === selected.host))
    )
      throw new Error('请选择有效的后端服务器')
    cwd = path.join(ctx.path, 'packages/products/cloud/bff')
    preparation = { ...preparationCommand('cloud', ['bff']), cwd: ctx.path }
    args = ['start:dev']
    title = `BFF · ${selected.host}`
  } else {
    const modules = await catalog(ctx, name, true)
    const available = new Set(modules.filter((value) => value.available).map((value) => value.name))
    if (!selected.apps.length || !selected.apps.every((value) => available.has(value)))
      throw new Error('请至少选择一个当前可用模块')
    preparation = { ...preparationCommand(name, selected.apps), cwd: ctx.path }
    program = 'bun'
    args = [
      './scripts/start.ts',
      '--product',
      name,
      '--apps',
      selected.apps.join(','),
      '--proxy=false'
    ]
    title = `FE · ${name}`
    readinessPorts = modules.filter((item) => selected.apps.includes(item.name)).map((item) => item.port)
    const entry = modules.find((item) => item.isShell && selected.apps.includes(item.name) && item.port > 0)
    if (entry) url = `http://localhost:${entry.port}`
  }
  const id = randomUUID()
  const lock = lockPath(ctx, service)
  const file = path.join(directory, ctx.worktreeKey, `${service}-${id}.json`)
  const run = {
    id,
    lock,
    log: `${file}.log`,
    root: ctx.path,
    cwd,
    title,
    service,
    product: name,
    host: service === 'bff' ? selected.host : null,
    environmentSummary: bffSettings?.summary ?? null,
    sshForward: bffSettings?.port ? {
      host: selected.host, port: bffSettings.port,
      password: selected.sshPassword ?? 'password',
      knownHosts: path.join(directory, 'ssh-known-hosts')
    } : null,
    url,
    registry: path.join(directory, 'module-federation-broker.json'),
    readinessPorts,
    health: 'starting',
    program,
    preparation,
    operation: install ? 'install' : 'start',
    args,
    state: 'starting',
    createdAt: Date.now(),
    updatedAt: Date.now()
  }
  atomicJson(file, run)
  if (existing?.handle) atomicJson(`${file}.terminal`, { handle: existing.handle })
  atomicJson(lock, { id, file })
  // Reserve the run in order, but do not block the other service on terminal creation.
  const completion = (async () => {
    try {
      if (service === 'bff' && !install) {
        applyBffEnvironment(ctx, selected.host, bffSettings.environment)
      }
      const command = [
        'env',
        'ELECTRON_RUN_AS_NODE=1',
        quote(process.execPath),
        quote(path.join(root, 'runner.mjs')),
        quote(file)
      ].join(' ')
      let terminal
      if (existing?.handle) {
        try {
          const workspace = await host.call('workspace.readContext', {})
          if (!workspace?.terminals.some((item) => item.id === existing.handle))
            throw new Error('原终端已关闭')
          await host.call('terminal.focusOwned', { terminalId: existing.handle })
          const accepted = await host.call('terminal.sendText', {
            terminalId: existing.handle, text: command, enter: true
          })
          if (!accepted.accepted) throw new Error('终端未接受启动命令，请检查原终端后重试')
          terminal = { handle: existing.handle }
        } catch {
          // The panel shows the notice before continuing this reserved run in a new terminal.
          return { id, needsTerminal: true, notice: '原终端无法复用，将新建终端继续启动服务' }
        }
      }
      terminal ??= await host.call('terminal.create', {
        worktreeId: ctx.worktreeId,
        command,
        title: service.toUpperCase()
      })
      // The runner may already have written its state by the time terminal creation returns.
      atomicJson(`${file}.terminal`, { handle: terminal.handle })
      await waitForSshForward(file)
      return { id }
    } catch (error) {
      const latest = readJson(file)
      if (latest.runnerPid) fs.writeFileSync(`${file}.stop`, id)
      else {
        atomicJson(lock, { id: 'cancelled', file })
        atomicJson(file, { ...latest, state: 'failed', error: error.message, updatedAt: Date.now() })
      }
      throw error
    }
  })()
  return { completion }
}
async function dispatch(request) {
  const ctx = context(request.context)
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
    case 'start': {
      if (restarting.has(`${ctx.worktreeKey}:${kind(request.kind)}`))
        throw new Error('此服务正在重启')
      if (request.kind === 'bff') bffLaunchEnvironment(ctx, request.environment, request.sshForward)
      if (request.apps) await saveSelection(ctx, request)
      if (request.kind === 'bff') await serverChecks.start(serverCandidates(await state(), ctx))
      return launch(ctx, request)
    }
    case 'restart': {
      const service = kind(request.kind), key = `${ctx.worktreeKey}:${service}`
      const current = runState(ctx, service)
      if (restarting.has(key) || current?.id !== request.id || current.state !== 'running' || current.health !== 'ready')
        throw new Error('服务尚未启动完成，或任务已变化，请刷新后重试')
      if (service === 'bff') bffLaunchEnvironment(ctx, request.environment, request.sshForward)
      if (request.apps) await saveSelection(ctx, request)
      restarting.add(key)
      const completion = stopRun(current.file).then(async () => {
        // 停止确认后才复用原终端，不占用另一类服务的请求队列。
        const launched = await launch(ctx, request)
        return launched.completion
      }).finally(() => restarting.delete(key))
      return { completion }
    }
    case 'createTerminal': {
      const current = runState(ctx, kind(request.kind))
      if (current?.id !== request.id || current.state !== 'starting')
        throw new Error('启动请求已变化，请刷新后重试')
      const run = readJson(current.file)
      try { fs.closeSync(fs.openSync(`${current.file}.terminal-requested`, 'wx', 0o600)) }
      catch (error) {
        if (error.code === 'EEXIST') throw new Error('正在创建终端，请勿重复启动')
        throw error
      }
      const command = ['env', 'ELECTRON_RUN_AS_NODE=1', quote(process.execPath),
        quote(path.join(root, 'runner.mjs')), quote(current.file)].join(' ')
      const completion = host.call('terminal.create', {
        worktreeId: ctx.worktreeId, command, title: run.service.toUpperCase()
      }).then(async terminal => {
        atomicJson(`${current.file}.terminal`, { handle: terminal.handle })
        await waitForSshForward(current.file)
        return { id: run.id }
      }).catch(error => {
        const latest = readJson(current.file)
        if (latest.runnerPid) fs.writeFileSync(`${current.file}.stop`, run.id)
        else {
          atomicJson(run.lock, { id: 'cancelled', file: current.file })
          atomicJson(current.file, { ...latest, state: 'failed', error: error.message, updatedAt: Date.now() })
        }
        throw error
      })
      return { completion }
    }
    case 'install':
      return launch(ctx, request, true)
    case 'stop': {
      const current = runState(ctx, request.kind)
      if (!current || current.id !== request.id) throw new Error('任务已变化，请刷新后重试')
      return { completion: stopRun(current.file).then(() => ({ ok: true })) }
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
    return { enabled: true, items }
  })
  orca.commands.register('launcher.request', (request) => {
    const result = chain.then(() => dispatch(request))
    chain = result.catch(() => undefined)
    return result.then((value) => value.completion ?? value)
  })
}

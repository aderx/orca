// Runs inside Orca's native terminal; service output is both streamed and retained on disk.
import fs from 'node:fs'
import { spawn } from 'node:child_process'
import { atomicJson, readJson } from './data.mjs'
import { observeServiceProcesses, stopUnusedBroker } from './service-processes.mjs'
import { createServiceHealthObserver } from './service-health.mjs'
import { createSshForward } from './ssh-forward.mjs'

const file = process.argv[2]
const run = readJson(file)
if (run.state !== 'starting') throw new Error('启动请求已结束')
let child
let stopping = false
let escalation
let heartbeat
let monitoring = Promise.resolve()
let observing = false
let lastObservation = 0
let forwarding, sshTask, log
const warnings = new Map((run.warnings ?? []).map(item => [item.id, item]))
function warn(key, message) {
  const id = `${run.id}:${key}`
  if (warnings.has(id)) return
  warnings.set(id, { id, message: message.slice(0, 1000) })
  run.warnings = [...warnings.values()]
  try { process.stderr.write(`\n[提示] ${message}\n`) } catch {}
  try { atomicJson(file, run) } catch {}
}
try { fs.closeSync(fs.openSync(`${file}.claim`, 'wx', 0o600)) }
catch (error) {
  if (error.code === 'EEXIST') process.exit(0)
  warn('claim', `启动标记保存失败，继续启动：${error.message}`)
}
try { log = fs.openSync(run.log, 'a', 0o600) }
catch (error) { warn('log', `日志文件打开失败，继续在终端输出：${error.message}`) }
const output = (data) => {
  if (log !== undefined) {
    try { fs.writeSync(log, data) }
    catch (error) {
      try { fs.closeSync(log) } catch {}
      log = undefined
      warn('log-write', `日志写入失败：${error.message}`)
    }
  }
  try { process.stdout.write(data) } catch (error) { warn('output', `终端输出失败：${error.message}`) }
}
const update = (changes) => {
  Object.assign(run, changes, { updatedAt: Date.now() })
  try { atomicJson(file, run) }
  catch (error) { warn('state', `运行状态保存失败，服务继续运行：${error.message}`) }
}
const observeHealth = createServiceHealthObserver(run.service, update)
function signalGroup(signal) {
  if (!child?.pid) return
  try {
    process.kill(-child.pid, signal)
  } catch (error) {
    if (error.code !== 'ESRCH') warn('service-stop', `服务进程信号发送失败：${error.message}`)
  }
}
function stop() {
  if (['stopped', 'exited', 'failed'].includes(run.state)) { void stopForwarding(); return }
  if (stopping) return
  stopping = true
  void stopForwarding()
  const wasRunning = run.state === 'running'
  update({ state: 'stopping' })
  if (wasRunning) monitoring = monitoring.then(() => observeServiceProcesses(run))
    .catch((error) => warn('process-check', `进程检查失败：${error.message}`))
  // Stop the service immediately; status collection must not delay the user's stop request.
  signalGroup('SIGTERM')
  escalation = setTimeout(() => signalGroup('SIGKILL'), 5000)
}
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, stop)
process.stdout.on('error', error => warn('output', `终端输出失败：${error.message}`))
process.stderr.on('error', () => {})
update({ state: 'starting', runnerPid: process.pid })
const env = { ...process.env, ...run.env, FORCE_COLOR: '1' }
delete env.ELECTRON_RUN_AS_NODE

function executeStep(step, preparing) {
  output(
    Buffer.from(
      `\n[Orca] ${preparing ? '检查并准备依赖' : run.title}\n工作树: ${run.root}\n$ ${step.program} ${step.args.join(' ')}\n\n`
    )
  )
  return new Promise((resolve, reject) => {
    const stepChild = spawn(step.program, step.args, {
      cwd: step.cwd,
      env: preparing ? { ...env, CI: 'true' } : env,
      detached: true,
      stdio: [preparing ? 'ignore' : 'inherit', 'pipe', 'pipe']
    })
    child = stepChild
    let spawnError
    const receive = (data) => { output(data); if (!preparing && !stopping) observeHealth(data) }
    child.stdout.on('data', receive)
    child.stderr.on('data', receive)
    child.on('spawn', () => {
      update({
        state: stopping ? 'stopping' : preparing ? 'preparing' : 'running',
        childPid: child.pid
      })
      if (stopping) signalGroup('SIGTERM')
    })
    child.on('error', error => { spawnError = error })
    child.on('close', (code, signal) => {
      // Each stage owns its process group, including children which outlive the package runner.
      if (child === stepChild) {
        signalGroup('SIGKILL')
        child = undefined
      }
      if (spawnError) reject(spawnError)
      else resolve({ code, signal })
    })
  })
}
heartbeat = setInterval(() => {
  if (fs.existsSync(`${file}.stop`)) stop()
  update({})
  if (!observing && !stopping && run.state === 'running' && Date.now() - lastObservation >= 2000) {
    observing = true
    lastObservation = Date.now()
    monitoring = observeServiceProcesses(run).then((ready) => {
      if (!stopping && ready && !run.startedAt)
        update({ health: 'ready', healthError: null, startedAt: Date.now() })
    }).catch((error) => {
      if (!stopping && !run.startedAt)
        update({ health: 'unverifiable', healthError: `无法确认进程状态：${error.message}` })
      warn('process-check', `进程检查失败，服务继续运行：${error.message}`)
    }).finally(() => { observing = false })
  }
}, 500)
async function stopForwarding() {
  try { await forwarding?.stop() }
  catch (error) { warn('ssh-stop', `SSH 转发清理失败：${error.message}`) }
}
async function cleanup() {
  await stopForwarding()
  await sshTask
  await monitoring
  try { await stopUnusedBroker(run, file) }
  catch (error) { warn('broker', `Broker 清理失败：${error.message}`) }
}
try {
  if (fs.existsSync(`${file}.stop`)) stop()
  if (!stopping && run.sshForward) {
    output(Buffer.from(`\n[SSH] 正在连接 ${run.sshForward.host}，建立 BFF 回调转发…\n`))
    const failed = error => {
      update({ sshConnected: false, sshError: error.message })
      warn('ssh', `${error.message}；BFF 继续运行`)
    }
    try {
      forwarding = createSshForward(run.sshForward, {
        env, output, onPid: sshPid => update({ sshPid }), onFailure: failed
      })
      sshTask = forwarding.ready.then(() => update({ sshConnected: true, sshError: null }))
        .catch(error => { if (!stopping) failed(error) })
    } catch (error) { failed(error) }
  }
  let result = { code: 0, signal: null }
  if (!stopping && run.preparation) {
    try {
      const prepared = await executeStep(run.preparation, true)
      if (!stopping && prepared.code !== 0)
        warn('preparation', `依赖准备失败（${prepared.signal || prepared.code}），继续执行服务启动命令`)
    } catch (error) {
      if (!stopping) warn('preparation', `依赖准备失败，继续执行服务启动命令：${error.message}`)
    }
  }
  if (!stopping) result = await executeStep(run, run.operation === 'install')
  update({
    state: stopping ? 'stopped' : result.code === 0 ? 'exited' : 'failed',
    ...result,
    endedAt: Date.now()
  })
  await cleanup()
  output(
    Buffer.from(
      `\n[Orca] 服务已结束 code=${result.code} signal=${result.signal ?? '-'}；可返回服务 TAB 重新启动。\n`
    )
  )
  process.exitCode = result.code ?? (stopping ? 0 : 1)
} catch (error) {
  signalGroup('SIGKILL')
  const cancelled = stopping
  update({ state: cancelled ? 'stopped' : 'failed', error: cancelled ? null : error.message, endedAt: Date.now() })
  await cleanup()
  output(Buffer.from(`\n[${cancelled ? '已停止' : '启动失败'}] ${cancelled ? '启动已取消' : error.message}\n`))
  process.exitCode = cancelled ? 0 : 1
} finally {
  clearInterval(heartbeat)
  clearTimeout(escalation)
  if (log !== undefined) try { fs.closeSync(log) } catch {}
}

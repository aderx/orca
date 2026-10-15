// Runs inside Orca's native terminal; service output is both streamed and retained on disk.
import fs from 'node:fs'
import { spawn } from 'node:child_process'
import { atomicJson, readJson } from './data.mjs'
import { observeServiceProcesses, stopUnusedBroker } from './service-processes.mjs'
import { createServiceHealthObserver } from './service-health.mjs'

const file = process.argv[2]
const run = readJson(file)
if (run.state !== 'starting') throw new Error('启动请求已结束')
if (readJson(run.lock).id !== run.id) throw new Error('启动请求已失效，请在服务页重新启动')
// Claim before publishing a PID so cancellation cannot race a delayed terminal launch.
fs.closeSync(fs.openSync(`${file}.claim`, 'wx', 0o600))
let child
let stopping = false
let escalation
let heartbeat
let monitoring = Promise.resolve()
let observing = false
let lastObservation = 0
const log = fs.openSync(run.log, 'a', 0o600)
const output = (data) => {
  fs.writeSync(log, data)
  process.stdout.write(data)
}
const update = (changes) => {
  Object.assign(run, changes, { updatedAt: Date.now() })
  atomicJson(file, run)
}
const observeHealth = createServiceHealthObserver(run.service, update)
function signalGroup(signal) {
  if (!child?.pid) return
  try {
    process.kill(-child.pid, signal)
  } catch (error) {
    if (error.code !== 'ESRCH') throw error
  }
}
function stop() {
  if (stopping) return
  stopping = true
  const wasRunning = run.state === 'running'
  update({ state: 'stopping' })
  monitoring = monitoring.then(() => wasRunning ? observeServiceProcesses(run) : undefined)
    .catch((error) => output(Buffer.from(`\n[进程检查] ${error.message}\n`)))
    .finally(() => {
      signalGroup('SIGTERM')
      escalation = setTimeout(() => signalGroup('SIGKILL'), 5000)
    })
}
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, stop)
process.stdout.on('error', (error) => {
  if (error.code === 'EPIPE') stop()
  else throw error
})
update({ state: 'starting', runnerPid: process.pid })
const env = { ...process.env, FORCE_COLOR: '1' }
delete env.ELECTRON_RUN_AS_NODE

function executeStep(step, preparing) {
  output(
    Buffer.from(
      `\n[Orca] ${preparing ? '检查并准备依赖' : run.title}\n工作树: ${run.root}\n$ ${step.program} ${step.args.join(' ')}\n\n`
    )
  )
  return new Promise((resolve, reject) => {
    child = spawn(step.program, step.args, {
      cwd: step.cwd,
      env: preparing ? { ...env, CI: 'true' } : env,
      detached: true,
      stdio: [preparing ? 'ignore' : 'inherit', 'pipe', 'pipe']
    })
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
    child.on('error', reject)
    child.on('close', (code, signal) => {
      // Each stage owns its process group, including children which outlive the package runner.
      signalGroup('SIGKILL')
      child = undefined
      resolve({ code, signal })
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
    }).finally(() => { observing = false })
  }
}, 500)
try {
  if (fs.existsSync(`${file}.stop`)) stop()
  let result = { code: 0, signal: null }
  if (!stopping && run.preparation) result = await executeStep(run.preparation, true)
  if (!stopping && result.code === 0) result = await executeStep(run, run.operation === 'install')
  await monitoring
  await stopUnusedBroker(run, file)
  update({
    state: stopping ? 'stopped' : result.code === 0 ? 'exited' : 'failed',
    ...result,
    endedAt: Date.now()
  })
  output(
    Buffer.from(
      `\n[Orca] 服务已结束 code=${result.code} signal=${result.signal ?? '-'}；可返回服务 TAB 重新启动。\n`
    )
  )
  process.exitCode = result.code ?? (stopping ? 0 : 1)
} catch (error) {
  signalGroup('SIGKILL')
  await monitoring
  try { await stopUnusedBroker(run, file) } catch (cleanupError) { output(Buffer.from(`\n[清理失败] ${cleanupError.message}\n`)) }
  update({ state: 'failed', error: String(error), endedAt: Date.now() })
  output(Buffer.from(`\n[启动失败] ${error.message}\n`))
  process.exitCode = 1
} finally {
  clearInterval(heartbeat)
  clearTimeout(escalation)
  fs.closeSync(log)
}

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { atomicJson, readJson } from './data.mjs'
import { observeRunState } from './run-state.mjs'

const execute = promisify(execFile)
const finished = new Set(['stopped', 'exited', 'failed', 'cancelled'])
async function inspect(program, args) {
  try {
    return (
      await execute(program, args, {
        timeout: 1500,
        maxBuffer: 256 * 1024,
        env: { ...process.env, LC_ALL: 'C' }
      })
    ).stdout
  } catch (error) {
    if (error.code === 1 && !error.stderr) return ''
    throw error
  }
}
async function processIdentity(pid) {
  const value = (
    await inspect('/bin/ps', ['-p', String(pid), '-o', 'ppid=,pgid=,lstart=,command='])
  ).trim()
  const match = value.match(/^(\d+)\s+(\d+)\s+(.{24})\s+(.+)$/)
  return match
    ? {
        pid,
        parent: Number(match[1]),
        group: Number(match[2]),
        identity: `${match[3]} ${match[4]}`,
        command: match[4]
      }
    : null
}
export function parseListeners(output) {
  let pid
  const entries = []
  for (const line of output.split('\n')) {
    if (line.startsWith('p')) pid = Number(line.slice(1))
    const match = line.match(/^n.*:(\d+)$/)
    if (pid && match) entries.push({ pid, port: Number(match[1]) })
  }
  return entries
}
async function listeners(ports) {
  return parseListeners(
    await inspect('/usr/sbin/lsof', [
      '-nP',
      ...ports.map((port) => `-iTCP:${port}`),
      '-sTCP:LISTEN',
      '-Fpn'
    ])
  )
}

export async function observeServiceProcesses(
  run,
  { readListeners = listeners, readIdentity = processIdentity } = {}
) {
  if (process.platform !== 'darwin' || !run.childPid) return false
  const expected = run.readinessPorts ?? []
  const ports = [
    ...new Set([
      16322,
      ...expected.filter((port) => Number.isInteger(port) && port > 0 && port < 65536)
    ])
  ]
  const open = await readListeners(ports)
  const identities = new Map()
  for (const { pid } of open) if (!identities.has(pid)) identities.set(pid, await readIdentity(pid))
  const broker = open.find((entry) => entry.port === 16322)
  const identity = broker && identities.get(broker.pid)
  if (
    run.registry &&
    identity?.command.includes(`${path.sep}@module-federation${path.sep}dts-plugin${path.sep}`) &&
    identity.command.endsWith(`${path.sep}start-broker.js`)
  ) {
    const parent = await readIdentity(identity.parent)
    // Record ancestry while the parent exists; detached brokers outlive that parent.
    if (parent?.group === run.childPid) atomicJson(run.registry, { ...identity, root: run.root })
  }
  return (
    expected.length > 0 &&
    expected.every(
      (port) =>
        port > 0 &&
        open.some(
          (entry) => entry.port === port && identities.get(entry.pid)?.group === run.childPid
        )
    )
  )
}

function otherRunActive(registry, currentFile) {
  const directory = path.dirname(registry)
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    for (const service of ['bff', 'fe']) {
      const lock = path.join(directory, entry.name, `${service}.json`)
      if (!fs.existsSync(lock)) continue
      const pointer = readJson(lock)
      if (pointer.file !== currentFile && !finished.has(observeRunState(readJson(pointer.file))))
        return true
    }
  }
  return false
}

export async function stopUnusedBroker(
  run,
  currentFile,
  {
    readIdentity = processIdentity,
    readClients = (pid) =>
      inspect('/usr/sbin/lsof', [
        '-nP',
        '-a',
        '-p',
        String(pid),
        '-iTCP',
        '-sTCP:ESTABLISHED',
        '-Fp'
      ]),
    signalProcess = (pid, signal) => process.kill(pid, signal),
    wait = delay
  } = {}
) {
  if (process.platform !== 'darwin' || !run.registry || !fs.existsSync(run.registry)) return
  const owned = readJson(run.registry)
  if (!Number.isSafeInteger(owned.pid) || owned.pid <= 1)
    throw new Error('Broker 身份记录无效，未停止进程')
  if ((await readIdentity(owned.pid))?.identity !== owned.identity) return
  if (otherRunActive(run.registry, currentFile)) return
  const clients = await readClients(owned.pid)
  if (clients.trim()) return
  for (const signal of ['SIGTERM', 'SIGKILL']) {
    if ((await readIdentity(owned.pid))?.identity !== owned.identity) return
    try {
      signalProcess(owned.pid, signal)
    } catch (error) {
      if (error.code !== 'ESRCH') throw error
    }
    for (let i = 0; i < 10; i++) {
      if (!(await readIdentity(owned.pid))) return
      await wait(50)
    }
  }
  throw new Error('Broker 尚未确认退出，请查看终端后重试')
}

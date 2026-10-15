import fs from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'
import { readJson, atomicJson } from './data.mjs'
import { observeRunState } from './run-state.mjs'

const finished = new Set(['stopped', 'exited', 'failed', 'cancelled'])

export async function stopRun(file) {
  const run = readJson(file)
  if (finished.has(observeRunState(run))) return
  fs.writeFileSync(`${file}.stop`, run.id, { mode: 0o600 })
  if (!run.runnerPid) {
    let cancelledBeforeLaunch = false
    try {
      fs.closeSync(fs.openSync(`${file}.claim`, 'wx', 0o600))
      cancelledBeforeLaunch = true
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
    }
    if (cancelledBeforeLaunch) {
      atomicJson(run.lock, { id: 'cancelled', file })
      atomicJson(file, { ...run, state: 'cancelled', updatedAt: Date.now() })
      return
    }
  }
  const deadline = Date.now() + 8000
  while (!finished.has(observeRunState(readJson(file)))) {
    if (Date.now() >= deadline) throw new Error('服务进程尚未确认结束，保留终端，请稍后重试停止')
    await delay(100)
  }
}

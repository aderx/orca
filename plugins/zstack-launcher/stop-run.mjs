import fs from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'
import { readJson, atomicJson } from './data.mjs'
import { processIdentity } from './service-processes.mjs'
import { processGone } from './run-state.mjs'

// A saved PID may now belong to another app; only signal the runner for this exact run.
export async function stopRun(file, { readIdentity = processIdentity, signal = process.kill, gone = processGone } = {}) {
  let run
  try { run = readJson(file) }
  catch (error) { return { stopped: false, warning: `历史运行记录无法读取：${error.message}` } }
  const warnings = []
  const report = (message) => warnings.push(message)
  const persist = (changes) => {
    Object.assign(run, changes, { updatedAt: Date.now() })
    try { atomicJson(file, run) } catch (error) { report(`运行状态保存失败：${error.message}`) }
  }
  try {
    const identity = run.runnerPid ? await readIdentity(run.runnerPid) : null
    const owned = identity?.command.includes('zstack-launcher/runner.mjs') &&
      identity.command.includes(file)
    if (!owned) {
      if (run.runnerPid && identity) report('历史 PID 已属于其他程序，已跳过清理')
      else if (!['stopped', 'exited', 'failed', 'cancelled'].includes(run.state))
        report('原运行器已不存在，已跳过历史任务清理')
      try { fs.writeFileSync(`${file}.stop`, run.id, { mode: 0o600 }) }
      catch (error) { report(`取消历史请求失败：${error.message}`) }
      persist({ state: 'cancelled' })
      const stopped = (!run.runnerPid || gone(run.runnerPid)) && (!run.childPid || gone(-run.childPid))
      if (!stopped) report('无法确认旧服务已停止，跳过终端复用')
      return { stopped, warning: warnings.join('；') }
    }
    try { fs.writeFileSync(`${file}.stop`, run.id, { mode: 0o600 }) }
    catch (error) { report(`停止标记写入失败，改用进程信号：${error.message}`) }
    if ((await readIdentity(run.runnerPid))?.identity !== identity.identity)
      return { stopped: false, warning: '原运行器身份已变化，已跳过清理' }
    try { signal(run.runnerPid, 'SIGTERM') }
    catch (error) { if (error.code !== 'ESRCH') throw error }
    const deadline = Date.now() + 8000
    while ((await readIdentity(run.runnerPid))?.identity === identity.identity) {
      if (Date.now() >= deadline)
        return { stopped: false, warning: '旧服务停止未完成；再次启动会使用新终端，实际端口冲突由服务命令报告' }
      await delay(100)
    }
    return { stopped: true, warning: warnings.join('；') }
  } catch (error) {
    return { stopped: false, warning: `旧服务清理失败：${error.message}` }
  }
}

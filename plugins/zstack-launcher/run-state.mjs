const ended = new Set(['stopped', 'exited', 'failed', 'cancelled'])
export function processGone(pid) {
  try { process.kill(pid, 0); return false }
  catch (error) { return error.code === 'ESRCH' }
}
export function observeRunState(run, now = Date.now(), gone = processGone) {
  if (ended.has(run.state) || now - run.updatedAt <= 10_000) return run.state
  if (!run.runnerPid) return now - run.createdAt > 45_000 ? 'pending-timeout' : 'starting'
  // Closing the native terminal may prevent the runner's final write. Check the whole owned group.
  if (gone(run.runnerPid) && (!run.childPid || gone(-run.childPid))) return 'failed'
  return 'unknown'
}

import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const readyMarker = 'ORCA_BFF_FORWARD_READY'

export function createSshForward(settings, { env, output, onPid, onFailure, spawnProcess = spawn }) {
  const { host, port, knownHosts } = settings
  const options = [
    'ControlMaster=no', 'ControlPersist=no', 'ExitOnForwardFailure=yes',
    'PreferredAuthentications=password', 'PubkeyAuthentication=no',
    'NumberOfPasswordPrompts=1', 'ConnectionAttempts=1', 'ConnectTimeout=10',
    'ServerAliveInterval=15', 'ServerAliveCountMax=2',
    'StrictHostKeyChecking=accept-new', 'UpdateHostKeys=no',
    `UserKnownHostsFile="${knownHosts}"`
  ]
  const child = spawnProcess('/usr/bin/ssh', [
    '-F', '/dev/null', '-T', '-S', 'none', ...options.flatMap(value => ['-o', value]),
    '-R', `127.0.0.1:${port}:127.0.0.1:${port}`, `root@${host}`,
    // EOF follows runner death, so the remote session also releases its forwarding listener.
    `printf '${readyMarker}\\n'; cat >/dev/null`
  ], {
    env: { ...env, ORCA_ZSTACK_SSH_PASSWORD: settings.password ?? 'password',
      SSH_ASKPASS_REQUIRE: 'force', SSH_ASKPASS: fileURLToPath(new URL('./ssh-askpass.sh', import.meta.url)) },
    detached: true,
    stdio: ['pipe', 'pipe', 'pipe']
  })
  let resolveReady, rejectReady, resolveClosed, timer, escalation
  let connected = false, stopping = false, ended = false, failure = null, tail = '', errors = ''
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject })
  const closed = new Promise(resolve => { resolveClosed = resolve })
  function signal(value) {
    if (!child.pid || ended) return
    try { process.kill(-child.pid, value) }
    catch (error) {
      if (error.code !== 'ESRCH') onFailure(new Error(`SSH 转发清理失败：${error.message}`))
    }
  }
  function stop() {
    if (!stopping && !ended) {
      stopping = true
      child.stdin.end()
      signal('SIGTERM')
      escalation = setTimeout(() => signal('SIGKILL'), 1000)
    }
    return closed
  }
  child.on('spawn', () => onPid(child.pid))
  child.stdin.on('error', error => { if (error.code !== 'EPIPE') failure = error })
  child.stdout.on('data', data => {
    tail = (tail + data.toString()).slice(-2000)
    if (!connected && tail.split(/\r?\n/).includes(readyMarker)) {
      connected = true
      clearTimeout(timer)
      output(Buffer.from(`\n[SSH] ${host} 127.0.0.1:${port} → 本机 127.0.0.1:${port}\n`))
      resolveReady()
    }
  })
  child.stderr.on('data', data => { errors = (errors + data.toString()).slice(-4000); output(data) })
  child.on('error', error => { failure = error })
  child.on('close', (code, signal) => {
    ended = true
    clearTimeout(timer)
    clearTimeout(escalation)
    const message = /Permission denied|Authentication failed/i.test(errors)
      ? 'SSH 密码认证失败，已停止本次连接，不再重试'
      : /remote port forwarding failed/i.test(errors)
        ? `SSH 转发端口 ${port} 无法建立，请检查服务器端口占用`
        : `SSH 转发${connected ? '已断开' : '建立失败'}：${failure?.message || errors.trim() || signal || code}`
    const error = new Error(message)
    if (!connected) rejectReady(error)
    else if (!stopping) onFailure(error)
    resolveClosed()
  })
  timer = setTimeout(() => {
    failure = new Error('连接超时')
    void stop()
  }, 15000)
  return { ready, stop, closed }
}

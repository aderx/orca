import http from 'node:http'

export function probeServer(host, timeout = 2000) {
  return new Promise((resolve) => {
    const address = host.includes(':') ? `[${host}]` : host
    const request = http.get(`http://${address}:5000/`, { agent: false }, (response) => {
      finish(response.statusCode >= 200 && response.statusCode < 400)
      response.destroy()
    })
    const timer = setTimeout(() => { finish(false); request.destroy() }, timeout)
    function finish(available) { clearTimeout(timer); resolve(available) }
    request.on('error', () => finish(false))
  })
}

export function createServerChecks(probe = probeServer, { load = () => ({}), save = () => undefined } = {}) {
  const results = new Map(), pending = new Set(), queue = []
  let active = 0, loaded, saving = Promise.resolve()
  function restore() {
    return loaded ??= Promise.resolve().then(load).then((cached) => {
      for (const [host, result] of Object.entries(cached ?? {})) {
        if (typeof result.available === 'boolean' && Number.isFinite(result.checkedAt))
          results.set(host, result)
      }
    }).catch((error) => console.warn('读取服务器检测缓存失败', error))
  }
  function drain() {
    while (active < 8 && queue.length) {
      const host = queue.shift()
      active++
      Promise.resolve().then(() => probe(host)).catch(() => false).then((available) => {
        results.set(host, { available, checkedAt: Date.now() })
      }).finally(() => {
        pending.delete(host); active--; drain()
        if (!active && !queue.length) {
          const cached = Object.fromEntries(results)
          saving = saving.then(() => save(cached)).catch((error) => console.warn('保存服务器检测缓存失败', error))
        }
      })
    }
  }
  return {
    async start(servers, refresh = false) {
      await restore()
      for (const { host } of servers) {
        if (pending.has(host) || (!refresh && results.has(host))) continue
        pending.add(host)
        queue.push(host)
      }
      drain()
    },
    async snapshot(servers) {
      await restore()
      return {
        serverChecks: Object.fromEntries(servers.map(({ host }) => [host, {
          ...results.get(host), checking: pending.has(host)
        }])),
        checkingServers: servers.some(({ host }) => pending.has(host))
      }
    }
  }
}

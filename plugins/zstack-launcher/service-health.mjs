import { stripVTControlCharacters } from 'node:util'

export function createServiceHealthObserver(service, change) {
  let tail = ''
  let started = false
  return (chunk) => {
    const text = tail + stripVTControlCharacters(chunk.toString())
    const lines = text.split(/[\r\n]+/)
    tail = lines.pop().slice(-2000)
    for (const line of lines) {
      // 启动成功后，业务错误和热更新日志不改变本次启动结果。
      if (!started && service === 'bff' && /Nest application successfully started/.test(line)) {
        started = true
        change({ health: 'ready', healthError: null, startedAt: Date.now() })
      }
    }
  }
}

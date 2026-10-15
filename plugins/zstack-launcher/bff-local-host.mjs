import { execFile } from 'node:child_process'
import { networkInterfaces } from 'node:os'
import { isIP } from 'node:net'
import { promisify } from 'node:util'

const execute = promisify(execFile)

export function selectBffLocalHost(interfaces, serviceOrder = '') {
  const ordered = [...serviceOrder.matchAll(/^\(\d+\)[^\r\n]*\r?\n\(Hardware Port: [^\r\n]+, Device: (en\d+)\)/gm)]
    .map(match => match[1])
  const devices = new Set([...ordered, ...Object.keys(interfaces)
    .filter(name => /^en\d+$/.test(name)).sort((a, b) => Number(a.slice(2)) - Number(b.slice(2)))])
  // macOS Wi-Fi and Ethernet use en*; a route to the management node can instead select a VPN.
  for (const name of devices) {
    const address = interfaces[name]?.find(entry => !entry.internal && isIP(entry.address) === 4 &&
      !/^(?:0\.|127\.|169\.254\.|198\.(?:18|19)\.)/.test(entry.address))?.address
    if (address) return { host: address, interface: name }
  }
  throw new Error('未检测到可用的本机局域网 IPv4 地址，请手动填写 HOST')
}

export async function detectBffLocalHost() {
  if (process.platform !== 'darwin') throw new Error('本机 IP 检测当前仅支持 macOS')
  const { stdout } = await execute('/usr/sbin/networksetup', ['-listnetworkserviceorder'], {
    timeout: 3000, maxBuffer: 64 * 1024, env: { ...process.env, LC_ALL: 'C' }
  }).catch(() => ({ stdout: '' }))
  return selectBffLocalHost(networkInterfaces(), stdout)
}

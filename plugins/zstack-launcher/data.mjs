import fs from 'node:fs'
import path from 'node:path'
import { isIP } from 'node:net'
import { createHash, randomUUID } from 'node:crypto'
import os from 'node:os'
import { writeBffEnvironment } from './bff-environment.mjs'

export const key = (value) => createHash('sha256').update(value).digest('hex')
export const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'))
export function atomicJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temporary = `${file}.${randomUUID()}.tmp`
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { mode: 0o600 })
  fs.renameSync(temporary, file)
}
export function context(input) {
  if (process.platform !== 'darwin') throw new Error('此启动器当前只支持 macOS 本机工作树')
  if (input?.executionHostId !== 'local' || typeof input.path !== 'string' || !input.worktreeId) {
    throw new Error('请在本机 ZStack worktree 的服务 TAB 中操作；远程工作树暂不支持。')
  }
  const root = fs.realpathSync(input.path)
  if (
    !fs.existsSync(path.join(root, 'scripts/start.ts')) &&
    !fs.existsSync(path.join(root, 'packages/products/cloud/bff/package.json'))
  ) {
    throw new Error('当前工作树不是受支持的 zstack-ui-next 项目')
  }
  let common, contextWarning
  try {
    let gitDir = path.join(root, '.git')
    if (fs.existsSync(gitDir)) {
      if (fs.statSync(gitDir).isFile()) {
        const match = fs.readFileSync(gitDir, 'utf8').match(/^gitdir:\s*(.+)/)
        if (!match) throw new Error('无效的 worktree Git 目录')
        gitDir = path.resolve(root, match[1].trim())
      }
      common = fs.existsSync(path.join(gitDir, 'commondir'))
        ? path.resolve(gitDir, fs.readFileSync(path.join(gitDir, 'commondir'), 'utf8').trim())
        : gitDir
    }
  } catch (error) { contextWarning = `Git 信息读取失败，使用当前目录：${error.message}` }
  return {
    ...input,
    path: root,
    primary: common ? path.dirname(common) : root,
    projectKey: key(common || root),
    worktreeKey: key(root),
    contextWarning
  }
}
export function server(item) {
  let host = String(item.host ?? '')
    .trim()
    .toLowerCase()
  const name = String(item.name ?? '').trim()
  if (/^https?:\/\//.test(host)) {
    const match = host.match(/^https?:\/\/(\[[^\]]+\]|[^/:?#]+)(?::\d+)?(?:[/?#]|$)/)
    if (!match || !isIP(match[1].replace(/^\[|\]$/g, '')))
      throw new Error('URL 中的主机需为完整 IP 地址')
    host = new URL(host).hostname
  }
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1)
  if (
    !isIP(host) &&
    !(
      host.length <= 253 &&
      host.split('.').every((part) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(part))
    )
  ) {
    throw new Error('服务器地址需为有效 IP、域名或使用 IP 的 HTTP/HTTPS URL')
  }
  if (!name || name.length > 120 || /[\r\n]/.test(name))
    throw new Error('服务器名称需为 1–120 个字符')
  return { name, host }
}
export function servers(values) {
  if (!Array.isArray(values) || values.length > 200) throw new Error('最多保存 200 个服务器')
  const clean = values.map(server)
  if (new Set(clean.map((value) => value.host)).size !== clean.length)
    throw new Error('服务器地址重复')
  return clean
}
export function importServers(ctx) {
  const file = path.join(ctx.primary, 'packages/products/cloud/bff/.env')
  if (!fs.existsSync(file)) return []
  const result = new Map()
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/)
  for (const [index, line] of lines.entries()) {
    const match = line.match(/^\s*#?\s*ZS_MN_SERVER\s*=\s*["']?(https?:\/\/[^\s#"']+)/)
    if (!match) continue
    const previous = (lines[index - 1] || '').trim()
    const description =
      previous.startsWith('#') && !/ZS_MN_SERVER\s*=/.test(previous)
        ? previous.replace(/^#\s*/, '').trim()
        : ''
    try {
      const host = new URL(match[1]).hostname.replace(/^\[|\]$/g, '')
      result.set(
        host,
        server({
          host,
          name: description && !/^(改成|这里改成)/.test(description) ? description : '无描述'
        })
      )
    } catch {
      /* Ignore invalid commented examples. */
    }
  }
  return [...result.values()]
}
export function currentBffHost(ctx) {
  const file = path.join(ctx.path, 'packages/products/cloud/bff/.env')
  if (!fs.existsSync(file)) return ''
  const text = fs.readFileSync(file, 'utf8')
  const value = text.match(/^\s*ZS_MN_SERVER\s*=\s*["']?(https?:\/\/[^\s#"']+)/m)?.[1]
  if (value) {
    try {
      return new URL(value).hostname.replace(/^\[|\]$/g, '')
    } catch {
      /* Fall back to MySQL host. */
    }
  }
  const mysql = text.match(/^\s*ZS_MYSQL_HOST\s*=\s*["']?([^\s#"']+)/m)?.[1]
  if (!mysql) return ''
  try {
    return server({ host: mysql, name: mysql }).host
  } catch {
    return ''
  }
}
export function applyBffEnvironment(ctx, rawHost, environment) {
  const host = server({ host: rawHost, name: rawHost }).host
  writeBffEnvironment(ctx, host, environment)
}
export function dataDirectory(pluginRoot) {
  return path.join(
    os.homedir(),
    'Library/Application Support/Orca ZStack Launcher',
    key(pluginRoot).slice(0, 16)
  )
}
export const quote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`

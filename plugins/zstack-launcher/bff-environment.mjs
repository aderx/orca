import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { isIP } from 'node:net'

const groups = [
  { title: '本机服务', commentKey: 'HOST', keys: ['HOST', 'BASE_PORT'] },
  { title: 'MySQL', commentKey: 'ZS_MYSQL_HOST', keys: ['ZS_MYSQL_PORT', 'ZS_MYSQL_USERNAME', 'ZS_MYSQL_PASSWORD'] },
  { title: 'Redis', commentKey: 'ZS_REDIS_HOST', keys: ['ZS_REDIS_HOST', 'ZS_REDIS_PORT', 'ZS_REDIS_TTL'] },
  { title: '请求设置', keys: ['ZS_ACTION_TIMEOUT'] },
  { title: '调试与功能', keys: ['API_INSPECTOR', 'INTERACTIVE_COLLECT', 'OPEN_PLATFORM'] }
]
const editable = new Set(groups.flatMap(group => group.keys))
const revision = text => createHash('sha256').update(text).digest('hex')

function environmentSource(ctx) {
  const target = path.join(ctx.path, 'packages/products/cloud/bff/.env')
  const relative = path.relative(fs.realpathSync(ctx.path), fs.realpathSync(path.dirname(target)))
  if (relative.startsWith('..') || path.isAbsolute(relative))
    throw new Error('BFF 目录指向当前 worktree 之外，请先准备独立环境')
  if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink())
    throw new Error('BFF .env 是符号链接，请先复制为当前 worktree 的独立文件')
  const source = fs.existsSync(target) ? target : path.join(ctx.primary, 'packages/products/cloud/bff/.env')
  if (!fs.existsSync(source)) throw new Error('没有 BFF .env，请先准备项目环境配置')
  return { target, text: fs.readFileSync(source, 'utf8') }
}
function valueOf(literal) {
  const raw = literal.trim().replace(/\r\n?/g, '\n')
  const value = raw.replace(/^(['"`])([\s\S]*)\1$/, '$2')
  return raw[0] === '"' ? value.replace(/\\n/g, '\n').replace(/\\r/g, '\r') : value
}
function assignments(text) {
  // Retain value offsets so comments, quotes on untouched fields, and line endings survive edits.
  const pattern = /^([ \t]*(?:export[ \t]+)?([\w.-]+)[ \t]*=[ \t]*)('(?:\\'|[^'])*'|"(?:\\"|[^"])*"|`(?:\\`|[^`])*`|[^#\r\n]*)([ \t]*(?:#[^\r\n]*)?)(?=\r?$)/gm
  return [...text.matchAll(pattern)].map(match => ({
    key: match[2], value: valueOf(match[3]), index: match.index,
    start: match.index + match[1].length,
    end: match.index + match[1].length + match[3].trimEnd().length
  }))
}
function commentBefore(text, entry) {
  if (!entry) return ''
  const lines = text.slice(0, entry.index).trimEnd().split(/\r?\n/), comments = []
  for (const line of lines.reverse()) {
    const match = line.match(/^[ \t]*#[ \t]*(.*)$/)
    if (!match || /^[\w.-]+\s*=/.test(match[1])) break
    if (match[1]) comments.unshift(match[1])
  }
  return comments.join('\n')
}
function encodeValue(value, key) {
  if (!/[#\r\n]/.test(value) && value === value.trim() && !/^['"`]/.test(value)) return value
  for (const quote of ["'", '"', '`']) {
    const encoded = `${quote}${value}${quote}`
    if (!value.includes(quote) && valueOf(encoded) === value) return encoded
  }
  throw new Error(`${key} 包含无法直接保存的引号组合，请在 .env 文件中修改`)
}
function editsFor(text, draft) {
  if (draft === undefined) return new Map()
  if (!draft || !draft.changes || typeof draft.changes !== 'object' || Array.isArray(draft.changes))
    throw new Error('无效的高级配置')
  const changes = new Map(Object.entries(draft.changes))
  if (changes.size && draft.revision !== revision(text))
    throw new Error('.env 已被修改，请重新打开服务页面后再修改配置')
  const available = new Set(assignments(text).map(entry => entry.key))
  for (const [key, value] of changes) {
    if (!editable.has(key) || (!available.has(key) && key !== 'HOST'))
      throw new Error(`高级配置不支持修改 ${key}`)
    if (typeof value !== 'string' || value.includes('\0')) throw new Error(`${key} 的值无效`)
    encodeValue(value, key)
  }
  return changes
}
export function readBffEnvironment(ctx) {
  const { text } = environmentSource(ctx)
  const entries = new Map(assignments(text).map(entry => [entry.key, entry]))
  return {
    revision: revision(text),
    groups: groups.map(group => ({
      title: group.title,
      description: commentBefore(text, entries.get(group.commentKey)),
      fields: group.keys.filter(key => entries.has(key) || key === 'HOST').map(key => ({
        key, value: entries.get(key)?.value ?? '',
        description: key === group.commentKey ? '' : commentBefore(text, entries.get(key)),
        secret: /PASSWORD|SECRET|TOKEN/.test(key)
      }))
    })).filter(group => group.fields.length)
  }
}
export function validateBffEnvironment(ctx, draft) {
  if (draft !== undefined) editsFor(environmentSource(ctx).text, draft)
}
export function writeBffEnvironment(ctx, host, draft) {
  const { target, text } = environmentSource(ctx)
  const entries = assignments(text), changes = editsFor(text, draft)
  const literalHost = isIP(host) === 6 ? `[${host}]` : host
  changes.set('ZS_MN_SERVER', `http://${literalHost}:8080`)
  changes.set('ZS_MYSQL_HOST', host)
  const zops = entries.findLast(entry => entry.key === 'ZOPS_SERVER')
  if (zops) {
    let value = `http://${literalHost}:10010`
    try {
      const url = new URL(zops.value)
      url.hostname = literalHost
      value = url.href.replace(/\/$/, '')
    } catch { /* Keep the existing default for an invalid ZOPS URL. */ }
    changes.set('ZOPS_SERVER', value)
  }
  let result = text
  const found = new Set()
  for (const entry of entries.reverse()) {
    if (!changes.has(entry.key)) continue
    found.add(entry.key)
    result = result.slice(0, entry.start) + encodeValue(changes.get(entry.key), entry.key) + result.slice(entry.end)
  }
  const newline = text.includes('\r\n') ? '\r\n' : '\n'
  for (const [key, value] of changes) {
    if (!found.has(key)) result += `${result.endsWith('\n') ? '' : newline}${key}=${encodeValue(value, key)}${newline}`
  }
  const temporary = `${target}.${randomUUID()}.tmp`
  fs.writeFileSync(temporary, result, { mode: 0o600 })
  fs.renameSync(temporary, target)
}

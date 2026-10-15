import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

export function preparationCommand(product, apps) {
  if (!apps.length) throw new Error('缺少待准备的模块')
  return {
    program: 'python3',
    args: [
      fileURLToPath(new URL('./prepare-dependencies.py', import.meta.url)),
      '--product',
      product,
      '--apps',
      apps.join(',')
    ]
  }
}

function storeDirectory(root) {
  const file = path.join(root, 'node_modules/.modules.yaml')
  if (!fs.existsSync(file)) return null
  const raw = fs
    .readFileSync(file, 'utf8')
    .match(/^storeDir:\s*(.+?)\s*$/m)?.[1]
    ?.replace(/^['"]|['"]$/g, '')
  if (!raw) return null
  let directory = path.resolve(path.dirname(file), raw.replace(/^~(?=\/)/, os.homedir()))
  if (/^v\d+$/.test(path.basename(directory))) directory = path.dirname(directory)
  return directory
}

export function bffInstallArgs(ctx) {
  for (const relative of [
    'node_modules',
    'node_modules/.pnpm',
    'packages/products/cloud/bff/node_modules'
  ]) {
    const directory = path.join(ctx.path, relative)
    if (fs.existsSync(directory)) {
      const resolved = path.relative(fs.realpathSync(ctx.path), fs.realpathSync(directory))
      if (resolved.startsWith('..') || path.isAbsolute(resolved))
        throw new Error('依赖目录指向其他工作树，请先准备独立依赖目录')
    }
  }
  const primary = storeDirectory(ctx.primary)
  const current = storeDirectory(ctx.path)
  if (primary && current && primary !== current)
    throw new Error('当前工作树与主工作树的 pnpm store 不一致')
  const store = primary || current
  if (!store) throw new Error('未找到已有 pnpm store，请先用 zs-start 准备项目依赖')
  return [
    '--store-dir',
    store,
    'install',
    '--offline',
    '--frozen-lockfile',
    '--ignore-scripts',
    '--filter=bff...'
  ]
}

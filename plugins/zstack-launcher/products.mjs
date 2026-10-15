import fs from 'node:fs'
import path from 'node:path'

// Read only the declarative catalog; importing start.ts would launch its menu/services.
export function productConfigs(root) {
  const source = fs.readFileSync(path.join(root, 'scripts/start.ts'), 'utf8')
  const block = source.match(/const PRODUCT_CONFIGS\b[\s\S]*?=\s*\{([\s\S]*?)^\};?/m)?.[1]
  if (!block) throw new Error('无法读取 scripts/start.ts 的 PRODUCT_CONFIGS')
  const products = [...block.matchAll(/\b([a-z][a-z0-9]*)\s*:\s*\{([^{}]*)\}/g)].map(
    ([, id, fields]) => {
      const field = (name) => fields.match(new RegExp(`\\b${name}:\\s*["']([^"']+)["']`))?.[1]
      const appsPath = field('appsPath'),
        mfHubPath = field('mfHubPath')
      if (!appsPath || !mfHubPath) throw new Error(`产品 ${id} 缺少模块路径配置`)
      return {
        id,
        appsPath,
        mfHubPath,
        label: (field('displayName') || id).replace(/^ZStack\s+/, '')
      }
    }
  )
  if (!products.length) throw new Error('项目未配置前端产品')
  return products
}

// Read the same MF catalog as scripts/start.ts without executing its startup entry.
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { productConfigs } from './products.mjs'

async function readCatalog() {
  const [root, product] = process.argv.slice(2)
  const config = productConfigs(root).find((item) => item.id === product)
  if (!config) throw new Error('无效的项目或产品')
  const { appsPath } = config
  const configPath = resolve(root, config.mfHubPath)
  let modules
  if (existsSync(configPath)) {
    const { MF_CONFIG } = await import(pathToFileURL(configPath).href)
    modules = Object.entries(MF_CONFIG.apps).map(([name, config]) => {
      const candidates = [
        join(appsPath, name),
        join(appsPath, name.replace(new RegExp(`^${product}-`), '')),
        `packages/products/shared/${name}`
      ]
      const path = candidates.find((p) => existsSync(resolve(root, p, 'package.json')))
      return {
        name,
        port: config.port ?? 0,
        dependencies: config.remotes ?? [],
        isShell: name === 'core-shell' || name === 'shell' || name.includes('-shell'),
        available: Boolean(path),
        dependenciesPresent: Boolean(path && existsSync(resolve(root, path, 'node_modules'))),
        path: path || candidates[0]
      }
    })
  } else {
    if (!existsSync(resolve(root, appsPath)))
      throw new Error(`当前工作树缺少 ${config.label} 模块源码：${appsPath}`)
    modules = readdirSync(resolve(root, appsPath), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .flatMap((d) => {
        const file = resolve(root, appsPath, d.name, 'package.json')
        if (!existsSync(file)) return []
        const pkg = JSON.parse(readFileSync(file, 'utf8'))
        return pkg.scripts?.dev
          ? [
              {
                name: d.name,
                port: 0,
                dependencies: [],
                available: true,
                isShell: d.name === 'core-shell' || d.name === 'shell',
                dependenciesPresent: existsSync(resolve(root, appsPath, d.name, 'node_modules')),
                path: join(appsPath, d.name)
              }
            ]
          : []
      })
  }
  // Only offer modules with a startup directory in this product or its shared apps.
  modules = modules.filter((module) => module.available)
  modules.sort((a, b) => a.name.localeCompare(b.name))
  process.stdout.write(JSON.stringify(modules))
}

readCatalog().catch((error) => {
  process.stderr.write(`${error.message}\n`)
  process.exitCode = 1
})

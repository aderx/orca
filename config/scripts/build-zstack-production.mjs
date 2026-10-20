#!/usr/bin/env node
// Package the fetched personal dev commit with isolated ZStack metadata.
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync, spawn } from 'node:child_process'

const repo = path.resolve(import.meta.dirname, '../..')
const buildVersion = process.argv[2]
if (process.platform !== 'darwin' || process.arch !== 'arm64')
  throw new Error('This local recipe targets macOS arm64')
if (!/^\d{8}\.\d+$/.test(buildVersion ?? '')) throw new Error('Expected build number YYYYMMDD.N')
const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim()
const sourceHead = git('rev-parse', 'HEAD')
if (sourceHead !== git('rev-parse', 'origin/dev')) throw new Error('Check out the freshly fetched origin/dev commit first')
if (git('status', '--porcelain', '--untracked-files=no')) throw new Error('Tracked source changes must be committed first')
for (const file of ['out/main/index.js', 'out/preload/index.js', 'out/renderer/index.html'])
  if (!fs.existsSync(path.join(repo, file))) throw new Error(`Missing prepared build: ${file}`)
const output = path.join(repo, 'dist/local-builds.noindex', `zstack-production-${buildVersion}-${sourceHead.slice(0, 10)}`)
const recipe = path.join(output, 'recipe'), stage = path.join(recipe, 'stage')
if (fs.existsSync(output)) throw new Error(`Build directory already exists: ${output}`)
fs.mkdirSync(stage, { recursive: true })
const info = {
  sourceRemote: git('remote', 'get-url', 'origin'), sourceRef: 'origin/dev', sourceHead, buildVersion,
  architecture: process.arch, startedAt: new Date().toISOString(),
  reuse: 'Prepared main/preload/CLI/native resources with unchanged owning sources; renderer compiled from source'
}
fs.writeFileSync(path.join(output, 'BUILD-INFO.json'), JSON.stringify(info, null, 2))
fs.writeFileSync(path.join(output, 'build-root.pid'), String(process.pid))
fs.writeFileSync(path.join(output, 'build-root.pgid'), execFileSync('/bin/ps', ['-o', 'pgid=', '-p', String(process.pid)], { encoding: 'utf8' }).trim())
fs.writeFileSync(path.join(stage, 'fork-bootstrap.cjs'), `
const { app } = require('electron')
const { join } = require('node:path')
const { mkdirSync } = require('node:fs')
const profile = process.env.ORCA_ZSTACK_USER_DATA_PATH || join(app.getPath('appData'), 'Orca ZStack')
mkdirSync(profile, { recursive: true })
app.setPath('userData', profile)
require('./out/main/index.js')
`)
fs.writeFileSync(path.join(recipe, 'renderer.config.mjs'), `
import fs from 'node:fs'
import base from ${JSON.stringify(path.join(repo, 'electron.vite.config.ts'))}
const packagePath = ${JSON.stringify(path.join(repo, 'package.json'))}
const metadata = { ...JSON.parse(fs.readFileSync(packagePath, 'utf8')), buildVersion: ${JSON.stringify(buildVersion)} }
export default { renderer: { ...base.renderer,
  plugins: [...base.renderer.plugins, { name: 'zstack-build-metadata', enforce: 'pre', load(id) { if (id === packagePath) return JSON.stringify(metadata) } }],
  build: { ...base.renderer.build, outDir: ${JSON.stringify(path.join(stage, 'renderer'))} }
} }
`)
fs.writeFileSync(path.join(recipe, 'electron-builder.cjs'), `
const path = require('node:path')
const repo = ${JSON.stringify(repo)}
const base = require(path.join(repo, 'config/electron-builder.config.cjs'))
const { version } = require(path.join(repo, 'package.json'))
const buildVersion = ${JSON.stringify(buildVersion)}
module.exports = { ...base,
  appId: 'local.orca.zstack', productName: 'Orca ZStack', buildVersion, protocols: [], publish: null,
  electronDist: path.join(repo, 'node_modules/electron/dist'),
  extraMetadata: { name: 'orca-zstack', productName: 'Orca ZStack', main: 'fork-bootstrap.cjs', version, buildVersion },
  directories: { ...base.directories, output: path.resolve(__dirname, '../production') },
  files: ['out/**/*', 'resources/**/*', 'package.json', ...base.files, '!out/zstack-dev-bootstrap.cjs', '!out/renderer/**/*',
    { from: path.join(__dirname, 'stage'), to: '.', filter: ['fork-bootstrap.cjs'] },
    { from: path.join(__dirname, 'stage/renderer'), to: 'out/renderer', filter: ['**/*'] }],
  mac: { ...base.mac, identity: '-', executableName: 'Orca', target: [{ target: 'dir', arch: ['arm64'] }], fileAssociations: [],
    extraResources: [...base.mac.extraResources, { from: path.join(repo, 'plugins/zstack-launcher'), to: 'plugins/zstack-launcher', filter: ['**/*', '!*.test.mjs', '!test.mjs'] }] }
}
`)
const env = { ...process.env, ORCA_REUSE_PREPARED_NATIVE_RUNTIME: '1',
  SDKROOT: '/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk',
  CPLUS_INCLUDE_PATH: '/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk/usr/include/c++/v1',
  ORCA_COMPUTER_MACOS_BUNDLE_ID: 'local.orca.zstack.computer-use' }
for (const key of ['ELECTRON_RUN_AS_NODE', 'ORCA_BACKGROUND_LAUNCH', 'ORCA_LOCAL_BUILD_VERSION', 'VITE_EXPOSE_STORE']) delete env[key]
async function run(args, extraEnv = {}) {
  const child = spawn(process.execPath, args, { cwd: repo, env: { ...env, ...extraEnv }, stdio: 'inherit' })
  await new Promise((resolve, reject) => {
    child.on('error', reject)
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`Build step exited: ${code}`)))
  })
}
console.log(`Building ${buildVersion} from origin/dev ${sourceHead}`)
await run(['--max-old-space-size=2048', 'node_modules/electron-vite/bin/electron-vite.js', 'build', '--config', path.join(recipe, 'renderer.config.mjs')], { ORCA_ELECTRON_VITE_TARGET: 'renderer' })
await run(['node_modules/electron-builder/cli.js', '--config', path.join(recipe, 'electron-builder.cjs'), '--mac', '--arm64', '--dir', '--publish', 'never'])
info.completedAt = new Date().toISOString()
fs.writeFileSync(path.join(output, 'BUILD-INFO.json'), JSON.stringify(info, null, 2))
console.log(`Packaged: ${path.join(output, 'production/mac-arm64/Orca.app')}`)

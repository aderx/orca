import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execute = promisify(execFile)

export async function changedModules(root, modules) {
  const git = async (...args) => {
    const { stdout } = await execute('git', ['-C', root, ...args], {
      timeout: 10_000,
      maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' }
    })
    return stdout
  }
  const optional = async (...args) => {
    try {
      return (await git(...args)).trim()
    } catch (error) {
      if (error.code === 1 || error.code === 128) return ''
      throw error
    }
  }
  const branch = (await git('branch', '--show-current')).trim()
  const head = (await git('rev-parse', '--verify', 'HEAD')).trim()
  if (!branch) throw new Error('当前工作树没有分支，无法确定变更范围；已保留原选择')
  const baseline = branch.match(/^(?:xfu-dev|codex)\/(.+)\/[^/]+$/)?.[1]
  let baseRef
  if (baseline) {
    // Personal feature-branch tracking refs are not the release baseline.
    for (const candidate of [`refs/remotes/upstream/${baseline}`, `refs/remotes/origin/${baseline}`, `refs/heads/${baseline}`]) {
      if (await optional('rev-parse', '--verify', `${candidate}^{commit}`)) {
        baseRef = candidate
        break
      }
    }
  }
  if (!baseRef && !baseline) {
    const merge = await optional('config', '--get', `branch.${branch}.merge`)
    const remote = await optional('config', '--get', `branch.${branch}.remote`)
    if (merge.startsWith('refs/heads/') && merge !== `refs/heads/${branch}` && remote) {
      const candidate = remote === '.' ? merge : `refs/remotes/${remote}/${merge.slice(11)}`
      if (await optional('rev-parse', '--verify', `${candidate}^{commit}`)) baseRef = candidate
    }
  }
  if (!baseRef) throw new Error('无法确定当前分支的对比基线；已保留原选择，请先确认本地存在对应的版本分支')
  const ancestor = (await git('merge-base', head, baseRef)).trim()
  const changes = await Promise.all([
    git('diff', '--name-only', '-z', '--no-renames', ancestor, head, '--'),
    git('diff', '--name-only', '-z', '--no-renames', 'HEAD', '--'),
    git('diff', '--cached', '--name-only', '-z', '--no-renames', '--'),
    git('ls-files', '--others', '--exclude-standard', '-z', '--')
  ])
  if ((await git('branch', '--show-current')).trim() !== branch ||
      (await git('rev-parse', '--verify', 'HEAD')).trim() !== head)
    throw new Error('检测期间分支发生变化，请重试；已保留原选择')
  const files = [...new Set(changes.flatMap((output) => output.split('\0').filter(Boolean)))]
  const available = modules.filter((module) => module.available && module.path)
  const owns = (module, file) => file.startsWith(`${module.path}/`)
  return {
    branch,
    baseRef: baseRef.replace(/^refs\/(?:remotes|heads)\//, ''),
    apps: available.filter((module) => files.some((file) => owns(module, file))).map((module) => module.name),
    fileCount: files.length,
    unmatchedCount: files.filter((file) => !available.some((module) => owns(module, file))).length
  }
}

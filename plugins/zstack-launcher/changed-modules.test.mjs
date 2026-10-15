import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { execFileSync } from 'node:child_process'
import { changedModules } from './changed-modules.mjs'

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'orca-changed-modules-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  const write = (file, content = 'base') => {
    mkdirSync(dirname(join(root, file)), { recursive: true })
    writeFileSync(join(root, file), content)
  }
  git('init')
  git('config', 'user.name', 'Test')
  git('config', 'user.email', 'test@example.invalid')
  for (const name of ['alpha', 'beta', 'gamma', 'other', 'rename-from', 'rename-to']) write(`apps/${name}/file`, 'base')
  git('add', '.')
  git('commit', '-m', 'base')
  git('update-ref', 'refs/remotes/upstream/5.5.38', 'HEAD')
  git('checkout', '-b', 'xfu-dev/5.5.38/task')
  const modules = ['alpha', 'beta', 'gamma', 'delta', 'other', 'rename-from', 'rename-to'].map(name => ({ name, path: `apps/${name}`, available: true }))
  return { root, git, write, modules }
}

test('includes branch commits, staged/unstaged/untracked files and both rename paths in this worktree', async t => {
  const { root, git, write, modules } = fixture(t)
  write('apps/alpha/file', 'committed')
  git('add', '.')
  git('commit', '-m', 'feature')
  git('update-ref', 'refs/remotes/origin/xfu-dev/5.5.38/task', 'HEAD')
  git('config', 'branch.xfu-dev/5.5.38/task.remote', 'origin')
  git('config', 'branch.xfu-dev/5.5.38/task.merge', 'refs/heads/xfu-dev/5.5.38/task')
  git('checkout', '--detach', 'refs/remotes/upstream/5.5.38')
  write('apps/other/file', 'upstream only')
  git('add', '.')
  git('commit', '-m', 'upstream advanced')
  git('update-ref', 'refs/remotes/upstream/5.5.38', 'HEAD')
  git('checkout', 'xfu-dev/5.5.38/task')
  write('apps/beta/file', 'staged')
  git('add', 'apps/beta/file')
  write('apps/gamma/file', 'unstaged')
  write('apps/delta/file with spaces', 'new')
  write('docs/unrelated.md', 'docs')
  git('mv', 'apps/rename-from/file', 'apps/rename-to/moved')
  const result = await changedModules(root, modules)
  assert.equal(result.baseRef, 'upstream/5.5.38')
  assert.deepEqual(result.apps.sort(), ['alpha', 'beta', 'delta', 'gamma', 'rename-from', 'rename-to'])
  assert.equal(result.unmatchedCount, 1)
})

test('rejects unknown baselines rather than using the remote copy of the same feature branch', async t => {
  const { root, git, modules } = fixture(t)
  git('checkout', '-b', 'custom-task')
  git('update-ref', 'refs/remotes/origin/custom-task', 'HEAD')
  git('config', 'branch.custom-task.remote', 'origin')
  git('config', 'branch.custom-task.merge', 'refs/heads/custom-task')
  await assert.rejects(changedModules(root, modules), /无法确定当前分支的对比基线/)
  git('checkout', '--detach')
  await assert.rejects(changedModules(root, modules), /当前工作树没有分支/)
})

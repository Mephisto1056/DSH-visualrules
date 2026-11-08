import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { hookPreview, hookScript, hookStatus, installHooks, uninstallHooks } from '../lib/host/hooks.js'

const dirs = []

function tempRepo(name) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `visualrules-hooks-${name}-`))
  dirs.push(root)
  execFileSync('git', ['init', '-b', 'main'], { cwd: root, stdio: 'ignore' })
  execFileSync('git', ['config', 'user.name', 'Hook Fixture'], { cwd: root, stdio: 'ignore' })
  execFileSync('git', ['config', 'user.email', 'hook@example.com'], { cwd: root, stdio: 'ignore' })
  fs.mkdirSync(path.join(root, '.dsh'), { recursive: true })
  fs.writeFileSync(
    path.join(root, '.dsh', 'profile.yaml'),
    `version: 1
git:
  commit_format: conventional
  protected_branches: [main]
  require_issue: true
`,
    'utf8',
  )
  return root
}

function commit(root, message) {
  execFileSync('git', ['commit', '--allow-empty', '-m', message], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Hook Fixture',
      GIT_AUTHOR_EMAIL: 'hook@example.com',
      GIT_COMMITTER_NAME: 'Hook Fixture',
      GIT_COMMITTER_EMAIL: 'hook@example.com',
    },
  })
}

function runHook(root, kind, args = []) {
  try {
    const output = execFileSync('sh', [path.join(root, '.git', 'hooks', kind), ...args], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { ok: true, output }
  } catch (error) {
    return {
      ok: false,
      output: `${error.stdout || ''}${error.stderr || ''}`,
    }
  }
}

test.after(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

test('status reports an unmanaged repository as not installed', async () => {
  const root = tempRepo('status')
  const status = await hookStatus(root)
  assert.equal(status.repoRoot, fs.realpathSync(root))
  assert.equal(status.installed, false)
  assert.equal(status.partiallyInstalled, false)
  assert.equal(status.hooks.length, 2)
  assert.ok(status.directory.endsWith(path.join('.git', 'hooks')))
})

test('installs both hooks, writes a snapshot, and uninstalls cleanly', async () => {
  const root = tempRepo('install')
  const result = await installHooks(root, {
    workspace: {
      gitEmail: 'hook@example.com',
      validation: { enabled: true, levels: { 'commit.format': 'block' } },
    },
  })
  assert.equal(result.ok, true)
  assert.equal(result.created.length, 2)
  const installed = await hookStatus(root)
  assert.equal(installed.installed, true)
  assert.ok(installed.hooks.every((hook) => hook.executable))
  assert.ok(fs.existsSync(path.join(root, '.git', 'hooks', 'dsh-visualrules.json')))
  const snapshot = JSON.parse(fs.readFileSync(path.join(root, '.git', 'hooks', 'dsh-visualrules.json'), 'utf8'))
  assert.equal(snapshot.levels['commit.format'], 'block')
  assert.equal(snapshot.expectedEmail, 'hook@example.com')

  const removed = await uninstallHooks(root)
  assert.equal(removed.ok, true)
  assert.equal(removed.removed.length, 2)
  assert.equal((await hookStatus(root)).installed, false)
})

test('an existing hook is preserved, chained, and restored', async () => {
  const root = tempRepo('chain')
  const original = path.join(root, '.git', 'hooks', 'pre-commit')
  fs.writeFileSync(original, '#!/bin/sh\necho original > "$PWD/original-ran.txt"\nexit 0\n', 'utf8')
  fs.chmodSync(original, 0o755)
  const result = await installHooks(root, { workspace: { gitEmail: 'hook@example.com', validation: { enabled: true, levels: {} } } })
  assert.equal(result.ok, true)
  assert.equal(result.backups.length, 1)
  const hookRun = runHook(root, 'pre-commit')
  assert.equal(hookRun.ok, false)
  assert.match(hookRun.output, /branch\.protected/)
  assert.equal(fs.existsSync(path.join(root, 'original-ran.txt')), true)

  await uninstallHooks(root)
  assert.equal(fs.readFileSync(original, 'utf8').includes('original-ran.txt'), true)
})

test('pre-commit blocks a protected branch but allows a feature branch', async () => {
  const root = tempRepo('branch')
  await installHooks(root, { workspace: { gitEmail: 'hook@example.com', validation: { enabled: true, levels: {} } } })
  const blocked = runHook(root, 'pre-commit')
  assert.equal(blocked.ok, false)
  assert.match(blocked.output, /受保护分支/)

  execFileSync('git', ['checkout', '-b', 'feature/ok'], { cwd: root, stdio: 'ignore' })
  const allowed = runHook(root, 'pre-commit')
  assert.equal(allowed.ok, true)
})

test('commit-msg blocks a malformed message and accepts a compliant one', async () => {
  const root = tempRepo('message')
  await installHooks(root, { workspace: { gitEmail: 'hook@example.com', validation: { enabled: true, levels: {} } } })
  execFileSync('git', ['checkout', '-b', 'feature/msg'], { cwd: root, stdio: 'ignore' })
  const bad = path.join(root, '.git', 'BAD_MSG')
  fs.writeFileSync(bad, 'bad message\n', 'utf8')
  const badRun = runHook(root, 'commit-msg', [bad])
  assert.equal(badRun.ok, false)
  assert.match(badRun.output, /commit\.format/)

  const good = path.join(root, '.git', 'GOOD_MSG')
  fs.writeFileSync(good, 'feat: add validation\n\nRefs: #1\n', 'utf8')
  const goodRun = runHook(root, 'commit-msg', [good])
  assert.equal(goodRun.ok, true)
})

test('a real commit on a protected branch is rejected by the installed hook', async () => {
  const root = tempRepo('real')
  await installHooks(root, { workspace: { gitEmail: 'hook@example.com', validation: { enabled: true, levels: {} } } })
  let failed = false
  try {
    commit(root, 'feat: initial')
  } catch (error) {
    failed = true
    assert.match(String(error.stderr || error.message), /受保护分支/)
  }
  assert.equal(failed, true)
})

test('a custom hooks path outside the repository is refused', async () => {
  const root = tempRepo('outside')
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'visualrules-hooks-outside-'))
  dirs.push(outside)
  execFileSync('git', ['config', 'core.hooksPath', outside], { cwd: root, stdio: 'ignore' })
  const result = await installHooks(root)
  assert.equal(result.ok, false)
  assert.match(result.error, /仓库外/)
  assert.equal(fs.existsSync(path.join(outside, 'pre-commit')), false)
})

test('hook preview and script contain the managed marker and checker', () => {
  const preview = hookPreview()
  assert.equal(preview.hooks.length, 2)
  assert.ok(preview.note.includes('--no-verify'))
  for (const hook of preview.hooks) {
    assert.match(hook.content, /dsh-visualrules/)
    assert.match(hook.content, /lib\/hook\/check\.mjs/)
  }
  assert.match(hookScript('pre-commit'), /pre-commit\.dsh-visualrules-original/)
})

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { apply } from '../lib/index.js'

let gitAvailable = true
try {
  execFileSync('git', ['--version'], { stdio: 'ignore' })
} catch {
  gitAvailable = false
}

function tempRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'visualrules-api-'))
  execFileSync('git', ['init', '-b', 'main'], { cwd: root, stdio: 'ignore' })
  execFileSync('git', ['config', 'user.name', 'API Fixture'], { cwd: root, stdio: 'ignore' })
  execFileSync('git', ['config', 'user.email', 'api@example.com'], { cwd: root, stdio: 'ignore' })
  fs.mkdirSync(path.join(root, '.dsh', 'rules'), { recursive: true })
  fs.writeFileSync(path.join(root, '.dsh', 'rules', 'probe.md'), '- 使用 feature 前缀\n', 'utf8')
  fs.writeFileSync(
    path.join(root, '.dsh', 'profile.yaml'),
    `version: 1
team: API 团队
environment: staging
environments:
  - { name: staging, host: stg.example.com, level: warn }
git:
  branch_pattern: "^(feature|fix)/[a-z0-9-]+$"
  protected_branches: [main]
  review:
    min_approvals: 1
packs:
  - id: team/probe
    title: API 规范包
    file: .dsh/rules/probe.md
`,
    'utf8',
  )
  return root
}

function fakeContext() {
  const handlers = new Map()
  const tables = new Map()
  const table = (name) => {
    if (!tables.has(name)) tables.set(name, new Map())
    const map = tables.get(name)
    return {
      get: (key) => map.get(key),
      entries: () => map.entries(),
      put: async (key, value) => {
        map.set(key, value)
      },
      delete: async (key) => map.delete(key),
    }
  }
  const services = {
    connection: {
      fetch: {
        register: (route) => {
          handlers.set(route.path, route.fetch)
          return () => handlers.delete(route.path)
        },
      },
    },
    storageDomain: {
      open: async () => ({ table, close: async () => {} }),
    },
    agents: { list: () => [] },
    workingDirectory: { get: () => '', defaultDirectory: process.cwd() },
  }
  const ctx = {
    effect(fn) {
      return fn()
    },
    inject(_names, callback) {
      return callback({ get: (name) => services[name], effect: ctx.effect })
    },
    on() {
      return () => {}
    },
    get(name) {
      return services[name]
    },
    logger: { warn() {}, info() {} },
  }
  return { ctx, handlers }
}

async function call(handlers, pathname, body) {
  const handler = handlers.get(`/api/visualrules${pathname}`)
  assert.ok(handler, `route ${pathname}`)
  const response = await handler(
    new Request(`http://local/api/visualrules${pathname}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    }),
  )
  return response.json()
}

test('all client API routes work through the plugin entry', { skip: !gitAvailable }, async () => {
  const root = tempRepo()
  const { ctx, handlers } = fakeContext()
  apply(ctx)
  assert.equal(handlers.size, 21)

  const missing = await call(handlers, '/profile', {})
  assert.equal(missing.ok, false)

  const profile = await call(handlers, '/profile', { cwd: root })
  assert.equal(profile.ok, true)
  assert.equal(profile.value.profile.repo.branch, 'main')
  assert.equal(profile.value.profile.environment.name, 'staging')
  assert.equal(profile.value.profile.packs.enabled.length, 0)
  assert.equal(profile.value.profile.injection.totalChars, 0)

  const library = await call(handlers, '/library', { cwd: root })
  assert.equal(library.ok, true)
  assert.equal(library.value.teamPacks.length, 1)
  assert.ok(library.value.template.includes('version: 1'))

  const savedPack = await call(handlers, '/packs/save', {
    cwd: root,
    id: 'personal/probe',
    title: '个人探针',
    content: '在回答开头输出 PROBE-OK。',
  })
  assert.equal(savedPack.ok, true)
  assert.equal(savedPack.value.pack.id, 'personal/probe')

  const teamPackSave = await call(handlers, '/packs/save', {
    cwd: root,
    id: 'team/probe',
    title: '冲突',
    content: 'x',
  })
  assert.equal(teamPackSave.ok, false)
  assert.match(teamPackSave.error.message, /团队规范包/)

  const savedWorkspace = await call(handlers, '/workspace/save', {
    cwd: root,
    enabledPacks: ['personal/probe', 'team/probe'],
    injectRules: true,
    extraRules: '- 工作区补充',
  })
  assert.equal(savedWorkspace.ok, true)
  assert.deepEqual(savedWorkspace.value.workspace.enabledPacks.sort(), ['personal/probe', 'team/probe'])

  const after = await call(handlers, '/profile', { cwd: root, force: true })
  assert.equal(after.ok, true)
  assert.equal(after.value.profile.packs.enabled.length, 2)
  assert.ok(after.value.profile.injection.totalChars > 0)

  const preview = await call(handlers, '/preview', { cwd: root })
  assert.equal(preview.ok, true)
  assert.ok(preview.value.text.includes('PROBE-OK'))
  assert.ok(preview.value.text.includes('工作区补充'))
  assert.ok(preview.value.text.includes('API 规范包'))

  const toggle = await call(handlers, '/workspace/toggle', { cwd: root, packId: 'personal/probe', enabled: false })
  assert.equal(toggle.ok, true)
  assert.ok(toggle.value.workspace.disabledPacks.includes('personal/probe'))

  const next = await call(handlers, '/preview', { cwd: root, force: true })
  assert.equal(next.ok, true)
  assert.doesNotMatch(next.value.text, /PROBE-OK/)

  const deleted = await call(handlers, '/packs/delete', { cwd: root, id: 'personal/probe' })
  assert.equal(deleted.ok, true)
  assert.equal(deleted.value.deleted, true)

  const template = await call(handlers, '/team/template', {})
  assert.equal(template.ok, true)
  assert.ok(template.value.template.length > 50)

  const refreshed = await call(handlers, '/refresh', { cwd: root })
  assert.equal(refreshed.ok, true)


  const validation = await call(handlers, '/validation/status', { cwd: root })
  assert.equal(validation.ok, true)
  assert.equal(validation.value.repo.isGit, true)
  assert.equal(validation.value.rules.branchPattern, '^(feature|fix)/[a-z0-9-]+$')
  assert.equal(validation.value.enabled, true)

  const validationSave = await call(handlers, '/validation/save', {
    cwd: root,
    levels: { 'branch.pattern': 'block', 'commit.format': 'off' },
    confirmDanger: true,
  })
  assert.equal(validationSave.ok, true)
  assert.equal(validationSave.value.workspace.validation.levels['branch.pattern'], 'block')
  assert.equal(validationSave.value.workspace.validation.confirmDanger, true)

  const badLevel = await call(handlers, '/validation/save', { cwd: root, levels: { 'commit.format': 'explode' } })
  assert.equal(badLevel.ok, false)

  const check = await call(handlers, '/validation/check', {
    cwd: root,
    message: 'feat: 这是一个合法提交',
    branch: 'feature/ok',
  })
  assert.equal(check.ok, true)
  assert.equal(check.value.blocked, false)

  const blockedCheck = await call(handlers, '/validation/check', {
    cwd: root,
    message: 'bad message',
    branch: 'main',
  })
  assert.equal(blockedCheck.ok, true)
  assert.equal(blockedCheck.value.blocked, true)
  assert.ok(blockedCheck.value.findings.some((finding) => finding.id === 'branch.protected'))

  const hookPreview = await call(handlers, '/hook/preview')
  assert.equal(hookPreview.ok, true)
  assert.ok(hookPreview.value.hooks.some((hook) => hook.kind === 'commit-msg'))

  const hookStatus = await call(handlers, '/hook/status', { cwd: root })
  assert.equal(hookStatus.ok, true)
  assert.equal(hookStatus.value.installed, false)

  const bypass = await call(handlers, '/bypass/create', { cwd: root, sessionId: 's1', reason: 'hotfix approved' })
  assert.equal(bypass.ok, true)
  assert.ok(bypass.value.bypass.id)
  const revoke = await call(handlers, '/bypass/revoke', { id: bypass.value.bypass.id })
  assert.equal(revoke.ok, true)

  const commits = await call(handlers, '/commits/list', { cwd: root })
  assert.equal(commits.ok, true)
  assert.deepEqual(commits.value.commits, [])

  fs.rmSync(root, { recursive: true, force: true })
})

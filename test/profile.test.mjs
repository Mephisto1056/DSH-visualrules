import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { buildProfile } from '../lib/host/profile.js'
import { clearTeamConfigCache } from '../lib/host/team-config.js'

let gitAvailable = true
try {
  execFileSync('git', ['--version'], { stdio: 'ignore' })
} catch {
  gitAvailable = false
}

const tempDirs = []

function tempDir(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `visualrules-profile-${name}-`))
  tempDirs.push(dir)
  return dir
}

test.after(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

function makeStore(workspacePatch = {}) {
  const personal = [
    {
      id: 'personal/general',
      title: '我的通用习惯',
      scope: 'personal',
      content: '- 先写测试',
      globalEnabled: false,
      description: '',
      updated: 1,
    },
  ]
  return {
    ready: Promise.resolve(),
    degraded: false,
    degradedReason: '',
    packs: () => personal,
    workspace: (cwd) => ({
      path: cwd,
      gitName: '',
      gitEmail: '',
      environment: '',
      showServerInfo: false,
      injectRules: true,
      extraRules: '',
      enabledPacks: ['personal/general', 'team/git-rules'],
      disabledPacks: [],
      servers: {},
      updated: 1,
      ...workspacePatch,
    }),
    workspaces: () => [],
  }
}

function fakeCtx() {
  return {
    get: () => undefined,
    logger: { warn() {}, info() {} },
  }
}

test('builds a complete profile for a Git workspace', { skip: !gitAvailable }, async () => {
  clearTeamConfigCache()
  const root = tempDir('git')
  git(root, ['init', '-b', 'main'])
  git(root, ['config', 'user.name', 'Fixture User'])
  git(root, ['config', 'user.email', 'fixture@example.com'])
  fs.mkdirSync(path.join(root, '.dsh'), { recursive: true })
  fs.writeFileSync(
    path.join(root, '.dsh', 'profile.yaml'),
    `version: 1
team: 支付平台组
environment: staging
environments:
  - { name: staging, host: stg.example.com, level: warn }
git:
  branch_pattern: "^(feature|fix)/[a-z0-9-]+$"
  commit_format: conventional
  require_issue: true
  protected_branches: [main]
  review:
    min_approvals: 2
team_info:
  owner: 张三
packs:
  - id: team/git-rules
    title: 团队 Git 规范
    content: "- 使用 feature 前缀"
`,
    'utf8',
  )

  const profile = await buildProfile(fakeCtx(), { store: makeStore() }, root, {})
  assert.equal(profile.repo.isGit, true)
  assert.equal(profile.repo.branch, 'main')
  assert.equal(profile.repo.protected, true)
  assert.equal(profile.repo.protectedBy, 'main')
  assert.equal(profile.identity.actual.name, 'Fixture User')
  assert.equal(profile.identity.actual.email, 'fixture@example.com')
  assert.equal(profile.identity.actual.emailScope, 'local')
  assert.equal(profile.environment.name, 'staging')
  assert.equal(profile.environment.level, 'warn')
  assert.equal(profile.environment.host, '')
  assert.equal(profile.team.name, '支付平台组')
  assert.equal(profile.team.owner, '张三')
  assert.equal(profile.packs.enabled.length, 2)
  assert.ok(profile.packs.enabled.some((pack) => pack.id === 'team/git-rules'))
  assert.ok(profile.injection.packs.length >= 3)
  assert.ok(profile.injection.totalChars > 0)
  assert.ok(profile.warnings.some((warning) => warning.id === 'protected-branch'))
  assert.ok(profile.badgeCount >= 1)
})

test('non-Git directories degrade without throwing', async () => {
  clearTeamConfigCache()
  const root = tempDir('plain')
  const profile = await buildProfile(fakeCtx(), { store: makeStore({ enabledPacks: [], injectRules: false }) }, root, {})
  assert.equal(profile.repo.isGit, false)
  assert.ok(profile.repo.reason)
  assert.equal(profile.config.exists, false)
  assert.equal(profile.rules, null)
  assert.equal(profile.injection.totalChars, 0)
  assert.ok(profile.warnings.some((warning) => warning.id === 'config-missing'))
  assert.ok(profile.warnings.some((warning) => warning.id === 'no-injection'))
  assert.ok(profile.warnings.some((warning) => warning.severity === 'info'))
})

test('invalid team config is display-only and never becomes rules', async () => {
  clearTeamConfigCache()
  const root = tempDir('invalid')
  fs.mkdirSync(path.join(root, '.dsh'), { recursive: true })
  fs.writeFileSync(path.join(root, '.dsh', 'profile.yaml'), 'version: 1\ngit:\n  branch_pattern: "["\n', 'utf8')
  const profile = await buildProfile(fakeCtx(), { store: makeStore({ enabledPacks: [], injectRules: true }) }, root, {})
  assert.equal(profile.config.status, 'invalid')
  assert.equal(profile.rules, null)
  assert.equal(profile.injection.totalChars, 0)
  assert.ok(profile.warnings.some((warning) => warning.severity === 'error'))
  assert.ok(profile.badgeCount >= 1)
})

test('personal layer mismatch and server info gate', { skip: !gitAvailable }, async () => {
  clearTeamConfigCache()
  const root = tempDir('mismatch')
  git(root, ['init', '-b', 'main'])
  git(root, ['config', 'user.name', 'Fixture User'])
  git(root, ['config', 'user.email', 'actual@example.com'])
  fs.mkdirSync(path.join(root, '.dsh'), { recursive: true })
  fs.writeFileSync(
    path.join(root, '.dsh', 'profile.yaml'),
    `version: 1
environment: staging
environments:
  - { name: staging, host: stg.example.com, level: warn, port: 2222 }
packs: []
`,
    'utf8',
  )
  const store = makeStore({
    gitEmail: 'expected@example.com',
    enabledPacks: [],
    injectRules: false,
    showServerInfo: true,
    servers: { staging: { user: 'deploy', keyRef: 'dsh-ssh-a' } },
  })
  const profile = await buildProfile(fakeCtx(), { store }, root, {})
  assert.equal(profile.identity.mismatch, true)
  assert.ok(profile.warnings.some((warning) => warning.id === 'git-identity-mismatch'))
  assert.equal(profile.environment.host, 'stg.example.com')
  assert.equal(profile.environment.port, 2222)
  assert.equal(profile.environment.user, 'deploy')
  assert.equal(profile.environment.keyRef, 'dsh-ssh-a')
})

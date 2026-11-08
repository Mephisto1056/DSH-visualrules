import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  clearTeamConfigCache,
  findTeamConfigPath,
  loadTeamConfigSync,
  resolveTeamPacks,
  teamConfigTemplate,
} from '../lib/host/team-config.js'

const tempDirs = []

function tempDir(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `visualrules-${name}-`))
  tempDirs.push(dir)
  return dir
}

test.after(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

function writeConfig(root, content) {
  fs.mkdirSync(path.join(root, '.dsh'), { recursive: true })
  const file = path.join(root, '.dsh', 'profile.yaml')
  fs.writeFileSync(file, content, 'utf8')
  return file
}

test.beforeEach(() => clearTeamConfigCache())

test('reads a valid team config with line-aware structure', () => {
  const root = tempDir('valid')
  writeConfig(
    root,
    `version: 1
team: 支付平台组
environment: staging
environments:
  - { name: staging, host: stg.example.com, level: warn }
  - { name: prod, host: prod.example.com, level: danger }
git:
  branch_pattern: "^(feature|fix)/[a-z0-9-]+$"
  commit_format: conventional
  require_issue: true
  protected_branches: [main, "release/*"]
  review:
    min_approvals: 2
packs:
  - id: team/git
    title: Git 规则
    content: |
      - 使用 feature 前缀
`,
  )
  const file = findTeamConfigPath(path.join(root, 'src'), root)
  assert.ok(file)
  assert.equal(file, fs.realpathSync(path.join(root, '.dsh', 'profile.yaml')))
  const result = loadTeamConfigSync(file)
  assert.equal(result.status, 'ok')
  assert.deepEqual(result.errors, [])
  assert.equal(result.config.team, '支付平台组')
  assert.equal(result.config.environment, 'staging')
  assert.equal(result.config.git.requireIssue, true)
  assert.deepEqual(result.config.git.protectedBranches, ['main', 'release/*'])
  assert.equal(result.config.git.reviewMin, 2)
  assert.equal(result.config.packs.length, 1)
  assert.equal(result.config.environments[1].level, 'danger')
})

test('reports a bad regex with its source line', () => {
  const root = tempDir('bad-regex')
  writeConfig(
    root,
    `version: 1
git:
  branch_pattern: "^(feature/[a-z"
`,
  )
  const result = loadTeamConfigSync(path.join(root, '.dsh', 'profile.yaml'))
  assert.equal(result.status, 'invalid')
  assert.equal(result.config, null)
  assert.equal(result.errors.length, 1)
  assert.equal(result.errors[0].path, 'git.branch_pattern')
  assert.equal(result.errors[0].line, 3)
})

test('warns about personal fields in the team layer and unknown keys', () => {
  const root = tempDir('personal-fields')
  writeConfig(
    root,
    `version: 1
team: A
identity:
  git_email: me@example.com
unknown_top: true
git:
  protected_branches: main
  require_issue: "yes"
`,
  )
  const result = loadTeamConfigSync(path.join(root, '.dsh', 'profile.yaml'))
  assert.equal(result.status, 'ok')
  assert.ok(result.warnings.some((warning) => warning.path === 'identity' && /个人字段/.test(warning.message)))
  assert.ok(result.warnings.some((warning) => warning.path === 'unknown_top'))
  assert.ok(result.warnings.some((warning) => warning.path === 'git.require_issue'))
})

test('a YAML syntax error keeps the parser line', () => {
  const root = tempDir('yaml-error')
  writeConfig(
    root,
    `version: 1
git:
  branch_pattern: [
`,
  )
  const result = loadTeamConfigSync(path.join(root, '.dsh', 'profile.yaml'))
  assert.equal(result.status, 'invalid')
  assert.equal(result.errors[0].code, 'yaml-parse')
  assert.equal(typeof result.errors[0].line, 'number')
  assert.ok(result.errors[0].line >= 3)
})

test('resolves team pack files inside the repository and rejects outside paths', () => {
  const root = tempDir('packs')
  fs.mkdirSync(path.join(root, '.dsh', 'rules'), { recursive: true })
  fs.writeFileSync(path.join(root, '.dsh', 'rules', 'git.md'), '- 内部规范\n', 'utf8')
  const file = writeConfig(
    root,
    `version: 1
packs:
  - id: team/inside
    title: 内部
    file: .dsh/rules/git.md
  - id: team/outside
    title: 外部
    file: ../outside.md
  - id: team/inline
    title: 内联
    content: "- 内联规范"
`,
  )
  const result = loadTeamConfigSync(file)
  assert.equal(result.status, 'ok')
  const packs = resolveTeamPacks(result.config, result.path)
  assert.deepEqual(
    packs.packs.map((pack) => pack.id).sort(),
    ['team/inline', 'team/inside'],
  )
  assert.ok(packs.warnings.some((warning) => warning.code === 'pack-outside-repo'))
  const inside = packs.packs.find((pack) => pack.id === 'team/inside')
  assert.match(inside.content, /内部规范/)
})

test('missing and empty configs degrade without throwing', () => {
  const missing = loadTeamConfigSync(null)
  assert.equal(missing.status, 'missing')
  assert.equal(missing.exists, false)
  assert.equal(missing.config, null)

  const root = tempDir('empty')
  writeConfig(root, '')
  const empty = loadTeamConfigSync(path.join(root, '.dsh', 'profile.yaml'))
  assert.equal(empty.status, 'ok')
  assert.equal(empty.config.version, 1)
  assert.deepEqual(empty.config.environments, [])
})

test('team template is copyable YAML', () => {
  const template = teamConfigTemplate()
  assert.match(template, /^version: 1/m)
  assert.match(template, /packs:/)
})

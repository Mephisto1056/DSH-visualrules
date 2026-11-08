import assert from 'node:assert/strict'
import test from 'node:test'
import {
  cleanMessage,
  defaultLevels,
  effectiveMessageRules,
  evaluateBranch,
  evaluateCommit,
  findingsText,
  globToRegExp,
  matchesProtectedBranch,
  normalizeLevel,
  resolveLevels,
  validationEnabled,
} from '../lib/host/rules.js'

const TEAM = {
  git: {
    branchPattern: '^(feature|fix|hotfix)/[a-z0-9-]+$',
    commitFormat: 'conventional',
    headerMaxLength: 72,
    requireIssue: true,
    issuePattern: null,
    mergeStrategy: 'squash',
    protectedBranches: ['main', 'release/*'],
    allowedCommitTypes: ['feat', 'fix', 'docs', 'chore'],
    reviewMin: 1,
    tagPattern: null,
  },
}

function workspace(patch = {}) {
  return { validation: { enabled: true, levels: {}, confirmDanger: false, trackCommits: true, ...patch } }
}

function evaluate(overrides = {}) {
  return evaluateCommit({
    branch: 'feature/login',
    identity: { actual: { name: 'Dev', email: 'dev@example.com' }, expected: { email: 'dev@example.com' } },
    message: 'feat(login): add sms login\n\nRefs: #12',
    commit: {},
    team: TEAM,
    sources: null,
    workspace: workspace(),
    ...overrides,
  })
}

test('a compliant conventional commit passes', () => {
  const result = evaluate()
  assert.equal(result.blocked, false)
  assert.equal(result.findings.length, 0)
})

test('protected branches block by default and the text names the source and fix', () => {
  const result = evaluate({ branch: 'main' })
  assert.equal(result.blocked, true)
  const finding = result.findings.find((item) => item.id === 'branch.protected')
  assert.ok(finding)
  assert.equal(finding.level, 'block')
  assert.ok(finding.fix.includes('特性分支'))
  const text = findingsText(result)
  assert.match(text, /\[branch\.protected\]/)
  assert.match(text, /来源/)
  assert.match(text, /--no-verify/)
})

test('workspace overrides change a rule level', () => {
  const result = evaluate({ branch: 'main', workspace: workspace({ levels: { 'branch.protected': 'warn' } }) })
  assert.equal(result.blocked, false)
  const finding = result.findings.find((item) => item.id === 'branch.protected')
  assert.equal(finding.level, 'warn')
})

test('invalid or unknown levels are ignored', () => {
  assert.equal(normalizeLevel('WARN'), 'warn')
  assert.equal(normalizeLevel('explode'), null)
  const levels = resolveLevels(workspace({ levels: { 'branch.protected': 'explode', unknown: 'block' } }))
  assert.equal(levels['branch.protected'], 'block')
  assert.equal(levels.unknown, undefined)
  assert.equal(validationEnabled(workspace({ enabled: false })), false)
})

test('conventional format rejects arbitrary messages and enforces type list', () => {
  const bad = evaluate({ message: 'add sms login\n\nRefs: #12' })
  assert.equal(bad.blocked, true)
  assert.ok(bad.findings.some((item) => item.id === 'commit.format'))

  const wrongType = evaluate({ message: 'perf(login): make it fast\n\nRefs: #12' })
  assert.ok(wrongType.findings.some((item) => item.id === 'commit.type'))
  assert.equal(wrongType.blocked, true)
})

test('required issue references are enforced for both patterns', () => {
  const missing = evaluate({ message: 'feat: add sms login' })
  assert.ok(missing.findings.some((item) => item.id === 'commit.issue'))
  assert.equal(missing.blocked, true)

  const teamWithPattern = {
    git: { ...TEAM.git, issuePattern: 'PROJ-\\d+' },
  }
  const customMissing = evaluate({ message: 'feat: add sms login', team: teamWithPattern })
  assert.ok(customMissing.findings.some((item) => item.id === 'commit.issue'))
  const customPresent = evaluate({ message: 'feat: add sms login\n\nRefs: PROJ-42', team: teamWithPattern })
  assert.equal(customPresent.findings.some((item) => item.id === 'commit.issue'), false)
})

test('header length and merge messages only warn', () => {
  const long = evaluate({ message: `feat: ${'x'.repeat(80)}\n\nRefs: #1` })
  const finding = long.findings.find((item) => item.id === 'commit.headerLength')
  assert.equal(finding.level, 'warn')
  assert.equal(long.blocked, false)

  const merge = evaluate({ message: 'Merge branch feature/login\n\nRefs: #1' })
  assert.ok(merge.findings.some((item) => item.id === 'commit.mergeMessage'))
})

test('commitlint sources fill type, scope, and header rules', () => {
  const sources = {
    commitlint: {
      path: 'commitlint.config.mjs',
      rules: { typeEnum: ['feat', 'fix'], scopeEnum: ['api', 'ui'], headerMaxLength: 20 },
    },
  }
  const rules = effectiveMessageRules({ git: {} }, sources)
  assert.deepEqual(rules.allowedTypes, ['feat', 'fix'])
  assert.equal(rules.headerMax, 20)
  const scoped = evaluate({
    message: 'feat(db): add index\n\nRefs: #1',
    team: { git: {} },
    sources,
    workspace: workspace(),
  })
  assert.ok(scoped.findings.some((item) => item.id === 'commit.scope'))
})

test('identity mismatch and missing identity are reported', () => {
  const mismatch = evaluate({ identity: { actual: { name: 'Dev', email: 'other@example.com' }, expected: { email: 'dev@example.com' } } })
  assert.equal(mismatch.findings.find((item) => item.id === 'identity.email').level, 'warn')
  const missing = evaluate({ identity: { actual: { name: '', email: '' }, expected: { email: '' } } })
  assert.ok(missing.findings.some((item) => item.id === 'identity.missing'))
})

test('skipMessage supports the pre-commit hook phase', () => {
  const result = evaluate({ message: null, commit: { skipMessage: true } })
  assert.equal(result.findings.some((item) => item.id === 'commit.messageMissing'), false)
  assert.equal(result.findings.some((item) => item.id === 'commit.format'), false)
})

test('cleanMessage drops comments and normalizes CRLF', () => {
  assert.equal(cleanMessage('feat: x\r\n\r\n# comment\r\nbody\r\n'), 'feat: x\n\nbody')
})

test('branch validation covers naming and protection', () => {
  const good = evaluateBranch({ branch: 'feature/add-login', team: TEAM, workspace: workspace() })
  assert.equal(good.blocked, false)
  const bad = evaluateBranch({ branch: 'MyBranch', team: TEAM, workspace: workspace() })
  assert.equal(bad.blocked, false)
  assert.ok(bad.findings.some((item) => item.id === 'branch.pattern'))
  const protectedBranch = evaluateBranch({ branch: 'main', team: TEAM, workspace: workspace() })
  assert.equal(protectedBranch.blocked, true)
})

test('glob patterns are anchored and escaped', () => {
  assert.equal(globToRegExp('release/*').test('release/v1'), true)
  assert.equal(globToRegExp('release/*').test('xrelease/v1'), false)
  assert.equal(globToRegExp('v1.0').test('v1x0'), false)
  assert.equal(matchesProtectedBranch('release/1.0', ['main', 'release/*']), 'release/*')
  assert.equal(matchesProtectedBranch('main', ['main']), 'main')
  assert.equal(matchesProtectedBranch('dev', ['main']), '')
})

test('disabling validation removes all findings', () => {
  const result = evaluate({ branch: 'main', workspace: workspace({ enabled: false }) })
  assert.equal(result.findings.length, 0)
  assert.equal(result.blocked, false)
})

test('default levels cover every documented rule', () => {
  const levels = defaultLevels()
  assert.equal(levels['branch.protected'], 'block')
  assert.equal(levels['commit.format'], 'block')
  assert.equal(levels['commit.headerLength'], 'warn')
  assert.equal(levels['commit.amend'], 'info')
})

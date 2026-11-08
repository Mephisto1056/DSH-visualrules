import assert from 'node:assert/strict'
import test from 'node:test'
import { buildStructuredRules, composeInjection, promptBudget, summarizeInjection } from '../lib/host/injection.js'

const teamConfig = {
  environment: 'staging',
  environments: [],
  git: {
    branchPattern: '^(feature|fix)/[a-z0-9-]+$',
    commitFormat: 'conventional',
    requireIssue: true,
    mergeStrategy: 'squash',
    protectedBranches: ['main', 'release/*'],
    reviewMin: 2,
    tagPattern: null,
    issuePattern: '[A-Z]+-[0-9]+',
    allowedCommitTypes: ['feat', 'fix'],
  },
}

const workspace = {
  enabledPacks: ['team/git', 'personal/general'],
  disabledPacks: [],
  injectRules: true,
  extraRules: '- 禁止 force push',
}

const personalPacks = [
  {
    id: 'personal/general',
    title: '我的通用习惯',
    content: '- 先写测试',
    globalEnabled: false,
  },
  {
    id: 'personal/off',
    title: '未启用',
    content: '- 不应出现',
    globalEnabled: false,
  },
]

const teamPacks = [
  { id: 'team/git', title: '团队 Git 规范', content: '- 使用 feature 前缀', source: '.dsh/rules/git.md' },
  { id: 'team/other', title: '未启用团队包', content: '- 不应出现', source: '.dsh/rules/other.md' },
]

test('structured rules include configured fields only', () => {
  const text = buildStructuredRules(teamConfig)
  assert.match(text, /分支命名必须匹配/)
  assert.match(text, /受保护分支/)
  assert.match(text, /2 个批准/)
  assert.doesNotMatch(text, /Tag 命名/)
})

test('composes personal, team and workspace layers in order', () => {
  const result = composeInjection({
    cwd: '/repo',
    teamConfig,
    configPath: '/repo/.dsh/profile.yaml',
    teamPacks,
    workspace,
    personalPacks,
    maxChars: 20_000,
    environment: 'staging',
    branch: 'feature/x',
  })
  assert.ok(result.text.length > 0)
  assert.equal(result.truncated, false)
  const personalAt = result.text.indexOf('### [个人]')
  const teamRulesAt = result.text.indexOf('### [团队规则]')
  const teamAt = result.text.indexOf('### [团队]')
  const workspaceAt = result.text.indexOf('### [工作区补充]')
  assert.ok(personalAt >= 0)
  assert.ok(teamRulesAt > personalAt)
  assert.ok(teamAt > teamRulesAt)
  assert.ok(workspaceAt > teamAt)
  assert.doesNotMatch(result.text, /不应出现/)
  assert.match(result.text, /VISUALRULES|dsh-visualrules:begin/)
  assert.match(result.text, /禁止 force push/)
  assert.match(result.text, /分支：`feature\/x`/)
})

test('respects disabled packs even when they are enabled globally', () => {
  const result = composeInjection({
    cwd: '/repo',
    teamConfig: null,
    configPath: null,
    teamPacks: [],
    workspace: { enabledPacks: [], disabledPacks: ['personal/general'], injectRules: false, extraRules: '' },
    personalPacks: [{ ...personalPacks[0], globalEnabled: true }],
    maxChars: 10_000,
    environment: '',
    branch: '',
  })
  assert.equal(result.text, '')
})

test('production environments add an explicit warning', () => {
  const result = composeInjection({
    cwd: '/repo',
    teamConfig,
    configPath: null,
    teamPacks: [],
    workspace: { enabledPacks: [], disabledPacks: [], injectRules: true, extraRules: '' },
    personalPacks: [],
    maxChars: 10_000,
    environment: 'prod',
    branch: 'main',
  })
  assert.match(result.text, /生产/)
  assert.match(result.text, /二次确认/)
})

test('truncates deterministically within the character budget', () => {
  const huge = 'x'.repeat(9000)
  const result = composeInjection({
    cwd: '/repo',
    teamConfig: null,
    configPath: null,
    teamPacks: [{ id: 'team/huge', title: '大包', content: huge, source: 'x' }],
    workspace: { enabledPacks: ['team/huge'], disabledPacks: [], injectRules: false, extraRules: '' },
    personalPacks: [],
    maxChars: 4000,
    environment: '',
    branch: '',
  })
  assert.equal(result.truncated, true)
  assert.ok(result.text.length <= 4000)
  assert.match(result.text, /已截断/)
})

test('summarizeInjection keeps pack metadata', () => {
  const result = composeInjection({
    cwd: '/repo',
    teamConfig,
    configPath: null,
    teamPacks,
    workspace,
    personalPacks,
    maxChars: 10_000,
    environment: '',
    branch: '',
  })
  const summary = summarizeInjection(result)
  assert.equal(summary.totalChars, result.text.length)
  assert.ok(summary.packs.some((pack) => pack.id === 'team/git'))
  assert.ok(summary.maxChars >= 2000)
})

test('promptBudget scales with the context window', () => {
  assert.equal(promptBudget(null), 24_000)
  assert.equal(promptBudget(128_000), 23_040)
  assert.equal(promptBudget(1_000_000), 60_000)
})

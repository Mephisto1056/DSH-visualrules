import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import vm from 'node:vm'
import React from 'react'
import { renderToString } from 'react-dom/server'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function loadClient() {
  const source = fs.readFileSync(path.join(root, 'lib', 'client.js'), 'utf8')
  let factory
  const sandbox = {
    window: {
      __ModuleLoader__: {
        load(definition) {
          factory = definition.factory
        },
      },
      setInterval: () => 1,
      clearInterval: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
    },
    document: {
      createElement: () => ({ dataset: {}, textContent: '', remove() {} }),
      head: { appendChild() {}, removeChild() {} },
      addEventListener() {},
      removeEventListener() {},
      visibilityState: 'visible',
    },
    navigator: { clipboard: { writeText: async () => {} } },
    console,
    setTimeout,
    clearTimeout,
  }
  vm.runInNewContext(source, sandbox, { filename: 'lib/client.js' })
  assert.ok(factory, 'client module registered a factory')

  const ReactProxy = {
    ...React,
    useState(initial) {
      // Render the requested tab directly instead of running effects.
      const value = initial === 'overview' || initial === 'packs' ? 'validation' : initial
      const [state, setState] = React.useState(value)
      return [state, setState]
    },
  }

  const registrations = []
  const dispose = () => {}
  const ctx = {
    locale: {
      bind: () => (key) => key,
      register: () => dispose,
    },
    effect(fn) {
      const value = fn()
      return typeof value === 'function' ? value : dispose
    },
    on: () => dispose,
    inject: (_names, callback) => callback(),
    slots: {
      inject: (_name, callback) => {
        callback()
        return dispose
      },
      register(options, component) {
        registrations.push({ options, component })
        return dispose
      },
    },
    get(name) {
      if (name === 'sidebarRightTabs') return { register: () => dispose }
      if (name === 'layout') return { openPanel: () => {} }
      return undefined
    },
    logger: { info() {}, warn() {} },
  }

  const module = factory((name) => {
    if (name === 'react') return ReactProxy
    throw new Error(`unexpected require: ${name}`)
  })
  module.apply(ctx)
  return { React: ReactProxy, registrations }
}

const PROFILE = {
  cwd: '/repo/pay-core',
  sessionId: 'session-1',
  repo: {
    isGit: true,
    root: '/repo/pay-core',
    name: 'pay-core',
    branch: 'feature/split-coupon',
    detached: false,
    remote: { name: 'origin', url: 'git@example.com:pay/core.git' },
    upstream: 'origin/main',
    ahead: 0,
    behind: 0,
    lastCommit: { subject: 'feat: split coupons', sha: 'abc1234', at: 1 },
    protected: false,
    protectedBy: '',
  },
  identity: {
    actual: { name: 'Ruo Yu', email: 'ruoyu@example.com', nameScope: 'repo', emailScope: 'repo' },
    expected: { name: '', email: 'ruoyu@example.com' },
    mismatch: false,
  },
  environment: { name: 'staging', level: 'warn', source: 'team', host: '', user: '', keyRef: '', port: null, jump: '', note: '' },
  rules: {
    branchPattern: '^(feature|fix)/[a-z0-9-]+$',
    commitFormat: 'conventional',
    requireIssue: true,
    issuePattern: null,
    mergeStrategy: 'squash',
    protectedBranches: ['main'],
    reviewMin: 2,
    tagPattern: null,
    allowedCommitTypes: ['feat', 'fix'],
    headerMaxLength: 72,
  },
  team: {
    name: '支付平台组',
    owner: '张三',
    contacts: ['张三 · 负责人'],
    releaseWindow: '周四',
    docs: { wiki: '', issues: '' },
    environments: [],
  },
  dev: null,
  config: { path: '/repo/pay-core/.dsh/profile.yaml', exists: true, status: 'ok', errors: [], warnings: [], packWarnings: [] },
  packs: { available: [], enabled: [], disabledCount: 0 },
  workspace: {
    gitName: '',
    gitEmail: 'ruoyu@example.com',
    environment: '',
    showServerInfo: false,
    injectRules: false,
    extraRules: '',
    enabledPacks: [],
    disabledPacks: [],
    servers: {},
    serversConfigured: 0,
    validation: { enabled: true, levels: {}, confirmDanger: false, trackCommits: true },
  },
  validation: { enabled: true, levels: {}, confirmDanger: false, trackCommits: true, recentEvents: [], recentBlocks: 0 },
  sources: { commitlint: null, editorconfig: null, eslint: null, docs: {}, warnings: [] },
  injection: { totalChars: 0, maxChars: 1000, truncated: false, entries: [], omitted: [] },
  warnings: [],
  badgeCount: 0,
  updatedAt: Date.now(),
}

const VALIDATION = {
  enabled: true,
  workspace: PROFILE.workspace,
  levels: { 'branch.protected': 'block', 'commit.format': 'block' },
  rules: PROFILE.rules,
  sources: {
    commitlint: {
      path: '/repo/pay-core/commitlint.config.mjs',
      rules: { typeEnum: ['feat', 'fix'], headerMaxLength: 72 },
    },
    editorconfig: { path: '/repo/pay-core/.editorconfig', rules: { indentStyle: 'space', indentSize: '2' } },
    eslint: { path: '/repo/pay-core/eslint.config.js', name: 'eslint.config.js' },
    docs: { contributing: { path: '/repo/pay-core/CONTRIBUTING.md', title: 'Contributing' }, prTemplate: null },
    warnings: [],
  },
  hook: {
    ok: true,
    repoRoot: '/repo/pay-core',
    directory: '/repo/pay-core/.git/hooks',
    customDirectory: false,
    installed: true,
    partiallyInstalled: false,
    hooks: [
      { kind: 'pre-commit', path: '/repo/pay-core/.git/hooks/pre-commit', installed: true, executable: true, original: null, stale: false },
      { kind: 'commit-msg', path: '/repo/pay-core/.git/hooks/commit-msg', installed: true, executable: true, original: null, stale: false },
    ],
    pluginRoot: '/plugin',
    checker: '/plugin/lib/hook/check.mjs',
  },
  events: [
    {
      id: 'e1',
      kind: 'block',
      command: 'git commit -m "update"',
      createdAt: Date.now(),
      findings: [{ id: 'branch.protected', level: 'block', title: '受保护分支', message: '当前在 main 上。' }],
    },
  ],
  bypasses: [
    { id: 'b1', reason: 'hotfix approved', createdAt: Date.now(), expiresAt: Date.now() + 600000, consumedAt: 0 },
  ],
  commits: [
    {
      hash: 'b91949ea4ebdabddd30dc360103cf10f453731f1',
      subject: 'feat: split coupons',
      message: 'feat: split coupons',
      branch: 'feature/split-coupon',
      authorName: 'Ruo Yu',
      committedAt: Math.floor(Date.now() / 1000),
    },
  ],
  recent: [],
  repo: { isGit: true, root: '/repo/pay-core', branch: 'feature/split-coupon' },
  updatedAt: Date.now(),
}

function fakeStore() {
  const snapshot = {
    revision: 1,
    cwd: PROFILE.cwd,
    sessionId: PROFILE.sessionId,
    profile: PROFILE,
    profileStatus: 'ready',
    profileError: '',
    library: {
      profile: PROFILE,
      personalPacks: [],
      teamPacks: [],
      workspaces: [],
      template: 'version: 1',
      storage: { degraded: false, reason: '' },
    },
    libraryStatus: 'ready',
    preview: null,
    previewStatus: 'idle',
    validation: VALIDATION,
    validationStatus: 'ready',
    validationError: '',
    hookPreview: null,
    overlayOpen: false,
    pendingTab: null,
  }
  return {
    subscribe: () => () => {},
    getSnapshot: () => snapshot,
    refreshProfile: async () => snapshot.profile,
    loadLibrary: async () => snapshot.library,
    loadPreview: async () => null,
    loadValidation: async () => snapshot.validation,
    saveValidation: async () => ({}),
    checkProposal: async () => ({ findings: [], blocked: false }),
    createBypass: async () => ({}),
    revokeBypass: async () => ({}),
    loadHookPreview: async () => ({}),
    installHook: async () => ({ ok: true }),
    uninstallHook: async () => ({ ok: true }),
    loadCommits: async () => ({}),
    deleteCommit: async () => ({}),
    clearCommits: async () => ({}),
    setOverlay: () => {},
    setPendingTab: () => {},
    clearPendingTab: () => {},
  }
}

const sessions = { current: 'session-1', byId: { 'session-1': { cwd: PROFILE.cwd, retainedBy: { mainView: 1 } } } }

function renderComponent(component) {
  const vr = fakeStore()
  const props = {
    t: (key) => key,
    vr,
    ctx: {},
    sessionId: 'session-1',
    useSessions: (selector) => React.useSyncExternalStore(() => () => {}, () => (selector ? selector(sessions) : sessions), () => (selector ? selector(sessions) : sessions)),
    usePanelInfo: (selector) => React.useSyncExternalStore(() => () => {}, () => ({ activePanelId: 'visualrules' }), () => ({ activePanelId: 'visualrules' })),
  }
  return renderToString(React.createElement(component, props))
}

test('the client module loads and registers the validation surfaces', () => {
  const { registrations } = loadClient()
  const names = registrations.map((entry) => entry.options.name)
  assert.ok(names.includes('conversation.session.header.utilities'))
  assert.ok(names.includes('settings.section'))
  assert.ok(names.includes('main'))
  assert.ok(names.includes('sidebar.right.pane.tab'))
})

test('the client store exposes every method the views call', () => {
  const { registrations } = loadClient()
  const entry = registrations.find((item) => item.options.name === 'settings.section')
  assert.ok(entry?.options?.inject, 'settings section injects the store')
  const { vr } = entry.options.inject()
  for (const method of [
    'loadValidation',
    'saveValidation',
    'checkProposal',
    'createBypass',
    'revokeBypass',
    'loadHookPreview',
    'installHook',
    'uninstallHook',
    'loadCommits',
    'deleteCommit',
    'clearCommits',
  ]) {
    assert.equal(typeof vr[method], 'function', `vr.${method} must be exported from createStore`)
  }
})

test('every registered surface server-renders without throwing', () => {
  const { registrations } = loadClient()
  for (const entry of registrations) {
    assert.doesNotThrow(
      () => renderComponent(entry.component),
      `component for ${entry.options.name} threw during render`,
    )
  }
})

test('the full profile page renders the Validation tab', () => {
  const { registrations } = loadClient()
  const entry = registrations.find((item) => item.options.name === 'main')
  assert.ok(entry)
  const html = renderComponent(entry.component)
  assert.match(html, /validation\.title/)
  assert.match(html, /validation\.hook\.title/)
  assert.match(html, /branch\.protected/)
  assert.match(html, /validation\.commits\.title/)
  assert.match(html, /b91949ea4e/)
})

test('the settings page renders the Validation panel', () => {
  const { registrations } = loadClient()
  const entry = registrations.find((item) => item.options.name === 'settings.section')
  assert.ok(entry)
  const html = renderComponent(entry.component)
  assert.match(html, /validation\.rules\.title/)
  assert.match(html, /validation\.bypass\.title/)
  assert.match(html, /validation\.sources\.title/)
})

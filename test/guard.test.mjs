import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createValidator } from '../lib/host/guard.js'
import { clearTeamConfigCache } from '../lib/host/team-config.js'

const dirs = []

function tempRepo(name) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `visualrules-guard-${name}-`))
  dirs.push(root)
  execFileSync('git', ['init', '-b', 'main'], { cwd: root, stdio: 'ignore' })
  execFileSync('git', ['config', 'user.name', 'Guard Fixture'], { cwd: root, stdio: 'ignore' })
  execFileSync('git', ['config', 'user.email', 'guard@example.com'], { cwd: root, stdio: 'ignore' })
  fs.mkdirSync(path.join(root, '.dsh'), { recursive: true })
  fs.writeFileSync(
    path.join(root, '.dsh', 'profile.yaml'),
    `version: 1
git:
  branch_pattern: "^(feature|fix)/[a-z0-9-]+$"
  commit_format: conventional
  allowed_commit_types: [feat, fix]
  protected_branches: [main]
`,
    'utf8',
  )
  return root
}

function makeStore(root) {
  const state = {
    workspace: {
      path: root,
      gitName: '',
      gitEmail: '',
      environment: '',
      showServerInfo: false,
      injectRules: false,
      extraRules: '',
      enabledPacks: [],
      disabledPacks: [],
      servers: {},
      validation: { enabled: true, levels: {}, confirmDanger: false, trackCommits: true },
    },
    events: [],
    commits: [],
    bypass: null,
    consumed: [],
  }
  const store = {
    ready: Promise.resolve(),
    degraded: false,
    degradedReason: '',
    workspace: () => state.workspace,
    workspaces: () => [state.workspace],
    packs: () => [],
    events: () => state.events,
    putEvent: async (event) => {
      state.events.push(event)
      return event
    },
    activeBypass: () => state.bypass,
    consumeBypass: async (id, patch) => {
      state.consumed.push({ id, patch })
      state.bypass = null
      return { id, ...patch }
    },
    bypasses: () => [],
    commits: () => state.commits,
    getCommit: (hash) => state.commits.find((commit) => commit.hash === hash),
    putCommit: async (commit) => {
      state.commits.push(commit)
      return commit
    },
    deleteCommit: async () => true,
    clearCommits: async () => {},
  }
  return { store, state }
}

function fakeContext(root) {
  const handlers = new Map()
  const services = {
    workingDirectory: {
      get: () => root,
      defaultDirectory: root,
    },
    tools: null,
  }
  const ctx = {
    effect(fn) {
      const dispose = fn()
      return typeof dispose === 'function' ? dispose : () => {}
    },
    on(name, handler) {
      const list = handlers.get(name) ?? []
      list.push(handler)
      handlers.set(name, list)
      return () => {
        const current = handlers.get(name) ?? []
        handlers.set(
          name,
          current.filter((item) => item !== handler),
        )
      }
    },
    inject(_names, callback) {
      return callback({ get: (name) => services[name], effect: ctx.effect })
    },
    get(name) {
      return services[name]
    },
    logger: { warn() {}, info() {} },
  }
  return { ctx, handlers }
}

function makeExec(command, root) {
  return {
    name: 'bash',
    arguments: { command, workdir: root },
    agent: { id: 'session-1', session: { id: 'session-1' } },
    callId: 'call-1',
    rootCallId: 'call-1',
    signal: new AbortController().signal,
  }
}

async function runPreExecute(handlers, exec) {
  const handler = handlers.get('tools/pre-execute')?.[0]
  assert.ok(handler, 'pre-execute handler registered')
  let nextCalled = false
  const decision = await handler(exec, async () => {
    nextCalled = true
    return { kind: 'allow' }
  })
  return { decision, nextCalled }
}

test.after(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

test('the guard denies a protected-branch commit with a model-readable reason', async () => {
  clearTeamConfigCache()
  const root = tempRepo('protect')
  const { store, state } = makeStore(root)
  const { ctx, handlers } = fakeContext(root)
  createValidator(ctx, { store })
  const { decision, nextCalled } = await runPreExecute(handlers, makeExec('git commit -m "bad message"', root))
  assert.equal(nextCalled, false)
  assert.equal(decision.kind, 'deny')
  assert.match(decision.reason, /branch\.protected/)
  assert.match(decision.reason, /\[commit\.format\]/)
  assert.match(decision.reason, /来源/)
  assert.equal(decision.info.code, 'visualrules/commit-blocked')
  assert.equal(state.events.length, 1)
  assert.equal(state.events[0].kind, 'block')
})

test('the guard allows a compliant commit on a feature branch', async () => {
  clearTeamConfigCache()
  const root = tempRepo('allow')
  execFileSync('git', ['checkout', '-b', 'feature/ok'], { cwd: root, stdio: 'ignore' })
  const { store, state } = makeStore(root)
  const { ctx, handlers } = fakeContext(root)
  createValidator(ctx, { store })
  const { decision, nextCalled } = await runPreExecute(handlers, makeExec('git commit -m "feat: add login"', root))
  assert.equal(nextCalled, true)
  assert.equal(decision.kind, 'allow')
  assert.equal(state.events.length, 0)
})

test('a branch creation earlier in the same command changes the validated branch', async () => {
  clearTeamConfigCache()
  const root = tempRepo('switch-create')
  const { store } = makeStore(root)
  const { ctx, handlers } = fakeContext(root)
  createValidator(ctx, { store })
  const created = await runPreExecute(
    handlers,
    makeExec('git switch -c feature/from-command && git commit -m "feat: add login"', root),
  )
  assert.equal(created.nextCalled, true)
})

test('a branch switch back to main earlier in the same command is still blocked', async () => {
  clearTeamConfigCache()
  const root = tempRepo('switch-main')
  execFileSync('git', ['checkout', '-b', 'feature/current'], { cwd: root, stdio: 'ignore' })
  const { store } = makeStore(root)
  const { ctx, handlers } = fakeContext(root)
  createValidator(ctx, { store })
  const blocked = await runPreExecute(
    handlers,
    makeExec('git switch main && git commit -m "feat: add login"', root),
  )
  assert.equal(blocked.nextCalled, false)
  assert.match(blocked.decision.reason, /branch\.protected/)
})

test('a user-created bypass allows one blocked commit and is consumed', async () => {
  clearTeamConfigCache()
  const root = tempRepo('bypass')
  const { store, state } = makeStore(root)
  state.bypass = { id: 'bypass-1', ruleIds: [], reason: 'incident hotfix approved' }
  const { ctx, handlers } = fakeContext(root)
  createValidator(ctx, { store })
  const { decision, nextCalled } = await runPreExecute(handlers, makeExec('git commit -m "bad message"', root))
  assert.equal(nextCalled, true)
  assert.equal(decision.kind, 'allow')
  assert.equal(state.consumed.length, 1)
  assert.equal(state.consumed[0].id, 'bypass-1')
})

test('branch creation is checked before it runs', async () => {
  clearTeamConfigCache()
  const root = tempRepo('branch')
  const { store, state } = makeStore(root)
  state.workspace.validation.levels = { 'branch.pattern': 'block' }
  const { ctx, handlers } = fakeContext(root)
  createValidator(ctx, { store })
  const bad = await runPreExecute(handlers, makeExec('git switch -c BadName', root))
  assert.equal(bad.nextCalled, false)
  assert.match(bad.decision.reason, /branch\.pattern/)
  const good = await runPreExecute(handlers, makeExec('git switch -c feature/good', root))
  assert.equal(good.nextCalled, true)
})

test('checkProposal validates message and branch without executing Git', async () => {
  clearTeamConfigCache()
  const root = tempRepo('check')
  const { store } = makeStore(root)
  const { ctx } = fakeContext(root)
  const validator = createValidator(ctx, { store })
  const blocked = await validator.checkProposal({ cwd: root, message: 'bad', branch: 'main' })
  assert.equal(blocked.blocked, true)
  assert.ok(blocked.findings.some((finding) => finding.id === 'branch.protected'))
  assert.match(blocked.text, /拦截/)
  const ok = await validator.checkProposal({ cwd: root, message: 'feat: add login', branch: 'feature/ok' })
  assert.equal(ok.blocked, false)
})

test('dangerous production commands ask for approval when enabled', async () => {
  clearTeamConfigCache()
  const root = tempRepo('danger')
  fs.writeFileSync(
    path.join(root, '.dsh', 'profile.yaml'),
    `version: 1
environment: prod
environments:
  - { name: prod, host: prod.example.com, level: danger }
git:
  commit_format: conventional
`,
    'utf8',
  )
  const { store, state } = makeStore(root)
  state.workspace.validation.confirmDanger = true
  state.workspace.environment = 'prod'
  const { ctx, handlers } = fakeContext(root)
  createValidator(ctx, { store })
  const { decision } = await runPreExecute(handlers, makeExec('kubectl delete pod api-0', root))
  assert.equal(decision.kind, 'ask')
  assert.match(decision.reason, /生产环境/)
  assert.match(decision.displayReason.zh, /Kubernetes/)
})

test('a successful AI commit is recorded in the local index', async () => {
  clearTeamConfigCache()
  const root = tempRepo('record')
  execFileSync('git', ['checkout', '-b', 'feature/record'], { cwd: root, stdio: 'ignore' })
  execFileSync('git', ['commit', '--allow-empty', '-m', 'feat: record me'], {
    cwd: root,
    stdio: 'ignore',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Guard Fixture',
      GIT_AUTHOR_EMAIL: 'guard@example.com',
      GIT_COMMITTER_NAME: 'Guard Fixture',
      GIT_COMMITTER_EMAIL: 'guard@example.com',
    },
  })
  const { store, state } = makeStore(root)
  const { ctx, handlers } = fakeContext(root)
  createValidator(ctx, { store })
  const handler = handlers.get('tools/result')?.[0]
  assert.ok(handler)
  handler(makeExec('git commit --allow-empty -m "feat: record me"', root), { isError: false, value: {} })
  const deadline = Date.now() + 2_000
  while (state.commits.length === 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  assert.equal(state.commits.length, 1)
  assert.equal(state.commits[0].source, 'ai')
  assert.equal(state.commits[0].sessionId, 'session-1')
  assert.match(state.commits[0].hash, /^[0-9a-f]{40}$/)
  assert.equal(state.commits[0].subject, 'feat: record me')
})

test('the guard fails open when rule composition throws', async () => {
  clearTeamConfigCache()
  const root = tempRepo('open')
  const { store } = makeStore(root)
  const { ctx, handlers } = fakeContext(root)
  createValidator(ctx, { store })
  const original = store.activeBypass
  store.activeBypass = () => {
    throw new Error('storage exploded')
  }
  const { decision, nextCalled } = await runPreExecute(handlers, makeExec('git commit -m "feat: x"', root))
  assert.equal(nextCalled, true)
  assert.equal(decision.kind, 'allow')
  store.activeBypass = original
})

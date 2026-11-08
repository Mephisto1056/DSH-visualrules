/**
 * Tool-layer commit guard, AI commit index, and the model-facing check tool.
 *
 * Three surfaces share one validator:
 * - `tools/pre-execute` rejects an AI-issued `git commit` / branch creation
 *   that violates the workspace rules and hands the model a fixable reason;
 * - `tools/result` records commits that actually landed, as a local AI index;
 * - `visualrules_check` lets the model pre-flight a message or command.
 *
 * Human commits in a terminal are covered by the optional Git hooks instead.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { findGitOperations, operationMessage, shortCommand } from './command.js'
import { effectiveMessageRules, evaluateBranch, evaluateCommit, findingsText, resolveLevels, validationEnabled } from './rules.js'
import { discoverSources } from './sources.js'
import { findTeamConfigPath, loadTeamConfigSync } from './team-config.js'
import { gitOutput, probeGit } from './git.js'
import { hookStatus } from './hooks.js'
import { inferEnvironmentLevel } from './profile.js'

const MAX_RECENT = 8
const DENIAL_TTL_MS = 60_000
const SHELL_TOOLS = new Set(['bash', 'shell', 'terminal', 'run_terminal_cmd'])

function sessionIdOf(agent) {
  return String(agent?.id ?? agent?.session?.id ?? '')
}

function sessionCwd(ctx, agent) {
  try {
    const value = ctx.get('workingDirectory')?.get?.(agent?.session ?? agent)
    if (typeof value === 'string' && value !== '') return value
  } catch {
    /* service absent */
  }
  return ''
}

function environmentLevel(team, workspace) {
  const name = workspace?.environment || team?.environment || ''
  if (!name) return 'none'
  const entry = (team?.environments ?? []).find((item) => item.name === name)
  return entry?.level && entry.level !== '' ? entry.level : inferEnvironmentLevel(name)
}

function safeRead(file) {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch {
    return null
  }
}

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {{ store: ReturnType<import('./store.js').createStore> }} deps
 */
export function createValidator(ctx, deps) {
  const { store } = deps
  const recent = new Map()
  const denials = new Map()

  function remember(sessionId, cwd, entry) {
    if (!sessionId) return
    const list = recent.get(sessionId) ?? []
    list.unshift({ ...entry, at: Date.now(), cwd })
    recent.set(sessionId, list.slice(0, MAX_RECENT))
  }

  function recentFor(sessionId) {
    return recent.get(sessionId) ?? []
  }

  function pruneDenials() {
    const now = Date.now()
    for (const [key, value] of denials) {
      if (now - value.at > DENIAL_TTL_MS) denials.delete(key)
    }
  }

  async function contextFor(cwd) {
    const git = await probeGit(ctx, cwd)
    const root = git.isGit ? git.root : null
    const team = loadTeamConfigSync(findTeamConfigPath(cwd, root))
    const sources = discoverSources(root)
    return { git, root, team, sources }
  }

  async function resolveMessage(op) {
    if (op.heredoc) return { message: op.heredoc, source: 'file' }
    if (op.messageParts?.length > 0) return { message: op.messageParts.join('\n\n'), source: 'argument' }
    if (op.messageFile) {
      if (op.messageFile === '-') return { message: op.heredoc ?? null, source: 'file' }
      const file = path.resolve(op.cwd, op.messageFile)
      return { message: safeRead(file), source: 'file' }
    }
    if (op.reuseFrom) {
      const message = await gitOutput(ctx, op.cwd, ['show', '-s', '--format=%B', op.reuseFrom])
      return { message: message || null, source: 'reuse' }
    }
    if (op.amend) {
      const message = await gitOutput(ctx, op.cwd, ['log', '-1', '--format=%B'])
      return { message: message || null, source: 'amend' }
    }
    return { message: null, source: 'absent' }
  }

  /**
   * Validate every Git operation in one shell command.
   * @returns {Promise<{ findings: Array<object>, blocked: boolean, asks: Array<object>, bypassed: object | null, contexts: Array<object> }>}
   */
  async function validateCommand({ command, baseCwd, sessionId, workspaceCwd }) {
    const { operations, dangers } = findGitOperations(command, baseCwd)
    const findings = []
    const asks = []
    const contexts = []
    const spawned = []
    const workspace = store.workspace(workspaceCwd || baseCwd)
    if (!validationEnabled(workspace)) return { findings, blocked: false, asks, bypassed: null, contexts }

    const cache = new Map()
    const contextAt = async (cwd) => {
      const key = path.resolve(cwd)
      if (!cache.has(key)) cache.set(key, await contextFor(key))
      return cache.get(key)
    }
    // A single shell line commonly switches/creates a branch and commits in
    // one go. Validate the branch the command will actually be on, not the
    // one HEAD points at before the command starts.
    const branchByCwd = new Map()

    for (const op of operations) {
      const targetCwd = path.resolve(op.cwd || baseCwd)
      const info = await contextAt(targetCwd)
      if (!info.git.isGit) continue
      contexts.push({ cwd: targetCwd, root: info.root, team: info.team })
      const key = path.resolve(targetCwd)
      const effective = branchByCwd.get(key) ?? { branch: info.git.branch ?? '', detached: Boolean(info.git.detached) }
      if (op.kind === 'switch-branch') {
        branchByCwd.set(key, { branch: op.name, detached: false })
        continue
      }
      if (op.kind === 'commit') {
        const resolved = await resolveMessage(op)
        const result = evaluateCommit({
          branch: effective.branch,
          detached: effective.detached,
          identity: { actual: info.git.identity ?? {}, expected: { email: workspace.gitEmail, name: workspace.gitName } },
          message: resolved.message,
          messageSource: resolved.source,
          commit: { amend: op.amend, noVerify: op.noVerify },
          team: info.team.config,
          sources: info.sources,
          workspace,
        })
        findings.push(...result.findings)
        spawned.push({ op, result, info, resolved })
      } else if (op.kind === 'create-branch') {
        const result = evaluateBranch({ branch: op.name, team: info.team.config, workspace })
        for (const finding of result.findings) {
          findings.push({ ...finding, message: `新分支 ${op.name}：${finding.message}` })
        }
        branchByCwd.set(key, { branch: op.name, detached: false })
      }
    }

    let bypassed = null
    const bypass = store.activeBypass(workspaceCwd || baseCwd, sessionId)
    if (bypass) {
      let applied = false
      for (const finding of findings) {
        if (finding.level !== 'block') continue
        if (bypass.ruleIds.length > 0 && !bypass.ruleIds.includes(finding.id)) continue
        finding.level = 'warn'
        finding.message = `${finding.message}（已由用户临时放行：${bypass.reason || '未填写原因'}）`
        applied = true
      }
      if (applied) bypassed = bypass
    }

    if (workspace.validation.confirmDanger === true) {
      const teamConfig = contexts[0]?.team?.config ?? null
      const effectiveLevel = environmentLevel(teamConfig, workspace)
      if (effectiveLevel === 'prod' || effectiveLevel === 'danger') {
        for (const danger of dangers) {
          asks.push({
            label: danger.label,
            command: shortCommand(danger.raw),
            reason: `当前工作区标记为生产环境，这条命令会${danger.label}。请确认目标主机与影响范围。`,
          })
        }
      }
    }

    return {
      findings,
      blocked: findings.some((finding) => finding.level === 'block'),
      asks,
      bypassed: bypassed ? { id: bypassed.id, reason: bypassed.reason } : null,
      contexts,
    }
  }

  async function recordValidationEvent({ cwd, sessionId, command, findings, kind }) {
    try {
      await store.putEvent({
        cwd,
        sessionId,
        command: shortCommand(command, 1_000),
        kind,
        findings: findings.map((finding) => ({
          id: finding.id,
          level: finding.level,
          title: finding.title,
          message: finding.message,
        })),
      })
    } catch {
      /* auditing must never block the command */
    }
  }

  async function consumeBypass(bypassed, hash) {
    if (!bypassed?.id) return
    try {
      await store.consumeBypass(bypassed.id, { consumedBy: hash || '' })
    } catch {
      /* best effort */
    }
  }

  async function recordCommit(exec, command, baseCwd, sessionId, workspaceCwd) {
    const workspace = store.workspace(workspaceCwd || baseCwd)
    if (workspace.validation.trackCommits === false) return
    const { operations } = findGitOperations(command, baseCwd)
    for (const op of operations) {
      if (op.kind !== 'commit') continue
      const cwd = path.resolve(op.cwd || baseCwd)
      const git = await probeGit(ctx, cwd, { force: true })
      if (!git.isGit) continue
      const hash = await gitOutput(ctx, cwd, ['rev-parse', 'HEAD'])
      if (!hash) continue
      const existing = store.getCommit(hash)
      const raw = await gitOutput(ctx, cwd, ['show', '-s', '--format=%an%x00%ae%x00%ct%x00%B', hash])
      const [authorName = '', authorEmail = '', committedAt = '', message = ''] = raw.split('\u0000')
      if (!existing) {
        await store.putCommit({
          hash,
          repo: git.root ?? '',
          branch: git.branch ?? '',
          message,
          subject: message.split('\n')[0] ?? '',
          sessionId,
          source: 'ai',
          command: shortCommand(command, 2_000),
          authorName,
          authorEmail,
          committedAt: Number(committedAt) || Math.floor(Date.now() / 1000),
          recordedAt: Date.now(),
        })
      }
    }
  }

  function baseCwdFor(exec, args) {
    const cwd = sessionCwd(ctx, exec.agent)
    const workdir = typeof args?.workdir === 'string' ? args.workdir : ''
    if (workdir) {
      const expanded = workdir === '~' ? os.homedir() : workdir.startsWith('~/') ? path.join(os.homedir(), workdir.slice(2)) : workdir
      return path.resolve(cwd || propsCwd(), expanded)
    }
    return cwd || propsCwd()
  }

  function propsCwd() {
    try {
      return ctx.get('workingDirectory')?.defaultDirectory ?? ''
    } catch {
      return ''
    }
  }

  // Tool-layer interception: committed before the shell runs.
  const offPreExecute = ctx.on('tools/pre-execute', async (exec, next) => {
    try {
      if (!SHELL_TOOLS.has(exec.name)) return next()
      const args = exec.arguments && typeof exec.arguments === 'object' ? exec.arguments : {}
      const command = typeof args.command === 'string' ? args.command : ''
      if (!command) return next()
      const direct = findGitOperations(command, '')
      if (direct.operations.length === 0 && direct.dangers.length === 0) return next()
      const sessionId = sessionIdOf(exec.agent)
      const baseCwd = baseCwdFor(exec, args)
      if (!baseCwd) return next()
      const outcome = await validateCommand({ command, baseCwd, sessionId, workspaceCwd: sessionCwd(ctx, exec.agent) || baseCwd })
      if (outcome.findings.length > 0) {
        remember(sessionId, baseCwd, {
          command: shortCommand(command),
          findings: outcome.findings.filter((finding) => finding.level !== 'info'),
        })
      }
      if (outcome.asks.length > 0) {
        const first = outcome.asks[0]
        return {
          kind: 'ask',
          reason: first.reason,
          displayReason: {
            en: `This workspace is marked as production. This command will ${first.label}. Confirm the target and the blast radius.`,
            zh: first.reason,
          },
        }
      }
      if (outcome.blocked) {
        const text = findingsText({ findings: outcome.findings })
        const key = exec.rootCallId ?? exec.callId
        if (key) {
          pruneDenials()
          denials.set(key, { reason: text, at: Date.now() })
        }
        void recordValidationEvent({ cwd: baseCwd, sessionId, command, findings: outcome.findings, kind: 'block' })
        return {
          kind: 'deny',
          reason: text,
          info: { name: 'DSH VisualRules', code: 'visualrules/commit-blocked' },
        }
      }
      if (outcome.findings.length > 0) {
        void recordValidationEvent({ cwd: baseCwd, sessionId, command, findings: outcome.findings, kind: 'warn' })
      }
      if (outcome.bypassed) void consumeBypass(outcome.bypassed, '')
      return next()
    } catch (error) {
      try {
        ctx.logger?.warn?.(`visualrules: commit guard failed open: ${error instanceof Error ? error.message : String(error)}`)
      } catch {
        /* logging is best-effort */
      }
      return next()
    }
  })

  // A second, order-independent denial in case another waterfall listener
  // replaces the pre-execute decision.
  const offGuard = ctx.inject(['tools'], (scoped) => {
    const tools = scoped.get('tools')
    if (!tools || typeof tools.guard !== 'function') return () => {}
    return tools.guard((exec) => {
      const key = exec.rootCallId ?? exec.callId
      const entry = key ? denials.get(key) : undefined
      if (!entry) return undefined
      if (Date.now() - entry.at > DENIAL_TTL_MS) {
        denials.delete(key)
        return undefined
      }
      return entry.reason
    })
  })

  // Observe successful commits for the local AI index.
  const offResult = ctx.on('tools/result', (exec, result) => {
    try {
      if (result?.isError) return
      if (!SHELL_TOOLS.has(exec.name)) return
      const args = exec.arguments && typeof exec.arguments === 'object' ? exec.arguments : {}
      const command = typeof args.command === 'string' ? args.command : ''
      if (!command || !/(^|[\s;&|])git\s+commit\b/.test(command)) return
      const baseCwd = baseCwdFor(exec, args)
      if (!baseCwd) return
      const sessionId = sessionIdOf(exec.agent)
      void recordCommit(exec, command, baseCwd, sessionId, sessionCwd(ctx, exec.agent) || baseCwd)
    } catch {
      /* the index is best effort */
    }
  })

  // The model-facing pre-flight tool.
  const offTools = ctx.inject(['tools'], (scoped) => {
    const tools = scoped.get('tools')
    if (!tools || typeof tools.register !== 'function') return () => {}
    const disposers = []
    disposers.push(tools.register({
      name: 'visualrules_check',
      description:
        'Pre-flight a Git commit or branch against this workspace’s VisualRules (identity, protected branch, branch naming, commit message format, required Issue). Use it before running git commit when you are unsure, or after a blocked commit to confirm the fix. It never modifies the repository.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          message: { type: 'string', description: 'The commit message you intend to use.' },
          branch: { type: 'string', description: 'The branch you intend to create or commit on.' },
          command: { type: 'string', description: 'A full shell command to inspect, e.g. git commit -m "feat: x".' },
          cwd: { type: 'string', description: 'Working directory; defaults to the session directory.' },
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['blocked', 'text', 'findings'],
          properties: {
            blocked: { type: 'boolean' },
            text: { type: 'string' },
            branch: { type: 'string' },
            message: { type: 'string' },
            findings: { type: 'array', items: { type: 'object' } },
          },
        },
        render(_args, value) {
          return [{ type: 'text', text: String(value?.text ?? 'DSH VisualRules：没有需要报告的问题。') }]
        },
      },
      async execute(args, exec) {
        const sessionDir = sessionCwd(ctx, exec?.agent) || propsCwd()
        const cwd = typeof args?.cwd === 'string' && args.cwd.trim() !== '' ? path.resolve(sessionDir, args.cwd) : sessionDir
        return checkProposal({
          cwd,
          message: typeof args?.message === 'string' ? args.message : undefined,
          branch: typeof args?.branch === 'string' ? args.branch : undefined,
          command: typeof args?.command === 'string' ? args.command : undefined,
        })
      },
    }))
    disposers.push(tools.register({
      name: 'visualrules_status',
      description:
        'Read this workspace’s VisualRules status: whether validation is enabled, effective Git rules, Git hook installation, recent validation events, active one-time bypasses, and the local AI commit index. Read-only.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          cwd: { type: 'string', description: 'Working directory; defaults to the session directory.' },
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['text', 'enabled', 'hookInstalled', 'commits'],
          properties: {
            text: { type: 'string' },
            enabled: { type: 'boolean' },
            hookInstalled: { type: 'boolean' },
            activeBypasses: { type: 'number' },
            commitCount: { type: 'number' },
            commits: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['hash', 'subject'],
                properties: {
                  hash: { type: 'string' },
                  subject: { type: 'string' },
                  branch: { type: 'string' },
                  committedAt: { type: 'number' },
                },
              },
            },
          },
        },
        render(_args, value) {
          return [{ type: 'text', text: String(value?.text ?? 'DSH VisualRules：没有可报告的状态。') }]
        },
      },
      async execute(args, exec) {
        const sessionDir = sessionCwd(ctx, exec?.agent) || propsCwd()
        const cwd = typeof args?.cwd === 'string' && args.cwd.trim() !== '' ? path.resolve(sessionDir, args.cwd) : sessionDir
        const value = await status(cwd, sessionIdOf(exec?.agent))
        const rules = value.rules || {}
        const lines = [
          `DSH VisualRules · ${cwd || '(未知目录)'}`,
          `校验：${value.enabled ? '已开启' : '已关闭'}${value.repo?.isGit ? `；分支 ${value.repo.branch || '(detached)'}` : '；当前目录不是 Git 仓库'}`,
          `规则：分支 ${rules.branchPattern || '—'}；受保护 ${(rules.protectedBranches || []).join('、') || '—'}；提交格式 ${rules.format || '—'}；允许类型 ${(rules.allowedTypes || []).join('/') || '—'}；首行上限 ${rules.headerMax || '—'}；关联 Issue ${rules.requireIssue ? '是' : '否'}`,
          `Git 钩子：${value.hook?.installed ? '已安装' : value.hook?.partiallyInstalled ? '部分安装' : '未安装'}${value.hook?.directory ? `（${value.hook.directory}）` : ''}`,
          `待使用放行：${(value.bypasses || []).filter((item) => item.consumedAt === 0 && item.expiresAt > Date.now()).length} 条`,
          `最近校验事件：${(value.events || []).length} 条`,
          `AI 提交索引：${(value.commits || []).length} 条`,
          ...(value.commits || []).slice(0, 5).map((commit) => `- ${commit.hash.slice(0, 10)} ${commit.subject || commit.message?.split('\n')[0] || ''}`),
        ]
        return {
          text: lines.join('\n'),
          enabled: value.enabled,
          hookInstalled: Boolean(value.hook?.installed),
          activeBypasses: (value.bypasses || []).filter((item) => item.consumedAt === 0 && item.expiresAt > Date.now()).length,
          commitCount: (value.commits || []).length,
          commits: (value.commits || []).slice(0, 20).map((commit) => ({
            hash: commit.hash,
            subject: commit.subject || (commit.message || '').split('\n')[0] || '',
            branch: commit.branch || '',
            committedAt: commit.committedAt || 0,
          })),
        }
      },
    }))
    return () => {
      for (const dispose of disposers.splice(0)) {
        try {
          dispose()
        } catch {
          /* already disposed */
        }
      }
    }
  })

  async function checkProposal(input) {
    const cwd = input.cwd || ''
    if (!cwd) return { blocked: false, findings: [], text: 'DSH VisualRules：无法确定当前工作区目录，未执行校验。' }
    const info = await contextFor(cwd)
    if (!info.git.isGit) {
      return { blocked: false, findings: [], text: 'DSH VisualRules：当前目录不是 Git 仓库，没有可校验的规则。' }
    }
    const workspace = store.workspace(cwd)
    if (!validationEnabled(workspace)) {
      return { blocked: false, findings: [], text: 'DSH VisualRules：当前工作区已关闭提交校验。' }
    }
    const command = typeof input.command === 'string' ? input.command : ''
    let findings = []
    const branch = typeof input.branch === 'string' && input.branch.trim() !== '' ? input.branch.trim() : info.git.branch ?? ''
    let message = typeof input.message === 'string' ? input.message : null
    let checked = false
    if (command) {
      const parsed = findGitOperations(command, cwd)
      let effectiveBranch = branch
      for (const op of parsed.operations) {
        if (op.kind === 'switch-branch') effectiveBranch = op.name
        if (op.kind === 'create-branch') {
          effectiveBranch = op.name
          const branchResult = evaluateBranch({ branch: op.name, team: info.team.config, workspace })
          findings.push(...branchResult.findings)
          checked = true
        }
      }
      const create = parsed.operations.find((op) => op.kind === 'create-branch')
      const commit = parsed.operations.find((op) => op.kind === 'commit')
      if (commit) {
        if (message === null) {
          const resolved = await resolveMessage(commit)
          message = resolved.message
        }
        const result = evaluateCommit({
          branch: effectiveBranch,
          detached: Boolean(info.git.detached) && effectiveBranch === branch,
          identity: { actual: info.git.identity ?? {}, expected: { email: workspace.gitEmail, name: workspace.gitName } },
          message,
          messageSource: 'argument',
          commit: { amend: commit.amend, noVerify: commit.noVerify },
          team: info.team.config,
          sources: info.sources,
          workspace,
        })
        findings = findings.concat(result.findings)
        checked = true
      }
      for (const danger of parsed.dangers) {
        if (workspace.validation.confirmDanger !== true) continue
        const level = environmentLevel(info.team.config, workspace)
        if (level === 'prod' || level === 'danger') {
          findings.push({
            id: 'danger.confirm',
            level: 'warn',
            title: '生产环境高危命令',
            message: `当前工作区标记为生产环境，这条命令会${danger.label}。`,
            fix: '执行前确认目标主机与影响范围。',
            source: '工作区校验设置',
          })
        }
      }
      if (!checked) {
        return { blocked: false, findings: [], text: 'DSH VisualRules：命令里没有识别到 git commit 或创建分支，未执行校验。' }
      }
    } else {
      const result = evaluateCommit({
        branch,
        detached: Boolean(info.git.detached),
        identity: { actual: info.git.identity ?? {}, expected: { email: workspace.gitEmail, name: workspace.gitName } },
        message,
        messageSource: message === null ? 'absent' : 'argument',
        commit: {},
        team: info.team.config,
        sources: info.sources,
        workspace,
      })
      findings = result.findings
    }
    const blocked = findings.some((finding) => finding.level === 'block')
    return {
      blocked,
      findings: findings.map((finding) => ({
        id: finding.id,
        level: finding.level,
        title: finding.title,
        message: finding.message,
        fix: finding.fix,
        source: finding.source,
      })),
      text: findingsText({ findings }),
      branch,
      message,
    }
  }

  async function status(cwd, sessionId) {
    const resolved = cwd || ''
    const info = await contextFor(resolved)
    const workspace = store.workspace(resolved)
    const team = info.team.config
    const sources = info.sources
    const rules = effectiveMessageRules(team, sources)
    const levels = resolveLevels(workspace)
    const hooks = await hookStatus(resolved)
    return {
      enabled: validationEnabled(workspace),
      workspace: {
        validation: workspace.validation,
        gitEmail: workspace.gitEmail,
        gitName: workspace.gitName,
        environment: workspace.environment,
      },
      levels,
      rules,
      sources,
      hook: {
        ...hooks,
        snapshot: undefined,
      },
      events: store.events({ cwd: resolved, limit: 30 }),
      bypasses: store.bypasses({ cwd: resolved, limit: 20 }),
      commits: store.commits({ repo: info.root ?? '', limit: 30 }),
      recent: recentFor(sessionId),
      repo: { isGit: info.git.isGit, root: info.root, branch: info.git.branch ?? '' },
      updatedAt: Date.now(),
    }
  }

  async function syncHookSnapshot(cwd, workspace) {
    const repoRoot = (await probeGit(ctx, cwd)).root
    if (!repoRoot) return null
    const hooks = await hookStatus(cwd)
    if (!hooks.installed && !hooks.partiallyInstalled) return null
    const { writeHookSnapshot } = await import('./hooks.js')
    return writeHookSnapshot(repoRoot, {
      enabled: workspace.validation.enabled,
      levels: workspace.validation.levels,
      expectedEmail: workspace.gitEmail,
      expectedName: workspace.gitName,
    })
  }

  return {
    validateCommand,
    checkProposal,
    status,
    recentFor,
    syncHookSnapshot,
    promptText(sessionId, cwd) {
      const list = recentFor(sessionId)
      if (list.length === 0) return ''
      const lines = ['## 最近一次提交校验（DSH VisualRules）', '']
      for (const entry of list.slice(0, 2)) {
        lines.push(`- 命令：\`${entry.command}\``)
        for (const finding of (entry.findings ?? []).slice(0, 4)) {
          lines.push(`  - [${finding.level}] ${finding.title}：${finding.message}`)
        }
      }
      lines.push('', '按上面的修正处理后再提交；不要使用 --no-verify 绕过。临时放行只能由用户在 DSH 界面操作。')
      return lines.join('\n')
    },
  }
}

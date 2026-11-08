/**
 * Assemble the workspace profile shown by the Client and summarized by the
 * status bar. Everything here is read-only except the caller's own storage
 * record, which the API routes mutate deliberately.
 */

import fs from 'node:fs'
import path from 'node:path'
import { probeGit } from './git.js'
import { composeInjection, summarizeInjection, promptBudget } from './injection.js'
import { findTeamConfigPath, loadTeamConfigSync, resolveTeamPacks } from './team-config.js'
import { discoverSources } from './sources.js'
import { effectiveMessageRules } from './rules.js'
import { FALLBACK_PROMPT_CHARS } from './constants.js'
import { rememberRepo } from './roots.js'

const ENV_LEVELS = {
  dev: 'dev',
  development: 'dev',
  local: 'dev',
  test: 'test',
  testing: 'test',
  qa: 'test',
  uat: 'test',
  staging: 'staging',
  stage: 'staging',
  stg: 'staging',
  pre: 'staging',
  prod: 'prod',
  production: 'prod',
  prd: 'prod',
}

export function inferEnvironmentLevel(name) {
  if (!name) return 'none'
  return ENV_LEVELS[String(name).trim().toLowerCase()] ?? 'info'
}

export function normalizeCwd(cwd, fallback) {
  const value = typeof cwd === 'string' && cwd.trim() !== '' ? cwd.trim() : fallback
  if (!value) return ''
  try {
    return path.resolve(value)
  } catch {
    return value
  }
}

function directoryExists(cwd) {
  try {
    return fs.statSync(cwd).isDirectory()
  } catch {
    return false
  }
}

function charCount(text) {
  return typeof text === 'string' ? text.length : 0
}

function enabledFor(pack, workspace) {
  const enabled = new Set(workspace.enabledPacks ?? [])
  const disabled = new Set(workspace.disabledPacks ?? [])
  if (disabled.has(pack.id)) return false
  if (pack.scope === 'personal') return pack.globalEnabled === true || enabled.has(pack.id)
  return enabled.has(pack.id)
}

function resolveEnvironment(config, workspace) {
  const teamName = config?.environment || ''
  const personalName = workspace.environment || ''
  const name = personalName || teamName
  const source = personalName ? 'personal' : teamName ? 'team' : 'none'
  const entry = name ? (config?.environments ?? []).find((item) => item.name === name) : undefined
  const level = entry?.level && entry.level !== '' ? entry.level : inferEnvironmentLevel(name)
  const info = {
    name: name || '',
    level: name ? level : 'none',
    source,
    host: '',
    port: null,
    jump: '',
    user: '',
    keyRef: '',
    note: entry?.note ?? '',
    overridden: Boolean(personalName && teamName && personalName !== teamName),
  }
  if (workspace.showServerInfo && name) {
    info.host = entry?.host ?? ''
    info.port = entry?.port ?? null
    info.jump = entry?.jump ?? ''
    const account = workspace.servers?.[name]
    info.user = typeof account?.user === 'string' ? account.user : ''
    info.keyRef = typeof account?.keyRef === 'string' ? account.keyRef : ''
  }
  return info
}

function pushConfigWarnings(warnings, result) {
  for (const error of result.errors ?? []) {
    warnings.push({
      id: `config-error:${error.path || 'root'}:${error.line ?? 0}`,
      severity: 'error',
      title: '团队配置不可用',
      message: `${error.line ? `第 ${error.line} 行 · ` : ''}${error.path ? `${error.path}：` : ''}${error.message}`,
      source: result.path,
    })
  }
  for (const warning of result.warnings ?? []) {
    const benign = /未知字段/.test(warning.message)
    warnings.push({
      id: `config-warning:${warning.path || 'root'}:${warning.line ?? 0}`,
      severity: benign ? 'info' : 'warn',
      title: '团队配置提醒',
      message: `${warning.line ? `第 ${warning.line} 行 · ` : ''}${warning.path ? `${warning.path}：` : ''}${warning.message}`,
      source: result.path,
    })
  }
}

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {object} deps
 * @param {ReturnType<import('./store.js').createStore>} deps.store
 * @param {string} cwd
 * @param {{ force?: boolean, maxChars?: number, contextWindow?: number | null }} [options]
 */
export async function buildProfile(ctx, deps, cwd, options = {}) {
  const { store } = deps
  const resolved = normalizeCwd(cwd)
  if (!resolved) {
    throw new Error('缺少工作区目录')
  }
  if (!directoryExists(resolved)) {
    throw new Error(`目录不存在：${resolved}`)
  }
  await store.ready

  const git = await probeGit(ctx, resolved, { force: options.force === true })
  const repoRoot = git.isGit ? git.root : null
  if (git.isGit) rememberRepo(resolved, { root: git.root, branch: git.branch ?? '' })
  const configPath = findTeamConfigPath(resolved, repoRoot)
  const team = loadTeamConfigSync(configPath)
  const teamPackResult = resolveTeamPacks(team.config, team.path)
  const workspace = store.workspace(resolved)
  const sources = discoverSources(repoRoot)

  const warnings = []
  pushConfigWarnings(warnings, team)
  for (const warning of teamPackResult.warnings) {
    warnings.push({
      id: `team-pack:${warning.path}`,
      severity: 'warn',
      title: '团队规范包不可用',
      message: warning.message,
      source: configPath,
    })
  }
  if (store.degraded) {
    warnings.push({
      id: 'storage-degraded',
      severity: 'error',
      title: '本机存储不可用',
      message: `个人层与规范库不会持久化：${store.degradedReason}`,
    })
  }
  if (!team.exists) {
    warnings.push({
      id: 'config-missing',
      severity: 'info',
      title: '尚未创建团队配置',
      message: '在仓库内添加 .dsh/profile.yaml 后可展示团队规范与 Git 规则。',
      source: repoRoot || resolved,
    })
  }

  const environment = resolveEnvironment(team.config, workspace)
  if (environment.overridden) {
    warnings.push({
      id: 'environment-overridden',
      severity: 'warn',
      title: '个人层覆盖了团队环境标识',
      message: `团队层为 "${team.config.environment}"，个人层设置为 "${workspace.environment}"。请确认这不是在隐藏生产环境。`,
      source: configPath,
    })
  }

  const personalPacks = store.packs()
  const allPacks = [
    ...personalPacks.map((pack) => ({
      id: pack.id,
      title: pack.title,
      description: pack.description ?? '',
      scope: 'personal',
      content: pack.content ?? '',
      source: '个人规范库',
      globalEnabled: pack.globalEnabled === true,
      readonly: false,
      updated: pack.updated ?? null,
    })),
    ...teamPackResult.packs.map((pack) => ({
      id: pack.id,
      title: pack.title,
      description: pack.description ?? '',
      scope: 'team',
      content: pack.content ?? '',
      source: pack.source,
      globalEnabled: false,
      readonly: true,
      updated: team.mtimeMs || null,
    })),
  ]
  const availablePacks = allPacks.map((pack) => ({
    id: pack.id,
    title: pack.title,
    description: pack.description,
    scope: pack.scope,
    source: pack.source,
    globalEnabled: pack.globalEnabled,
    readonly: pack.readonly,
    chars: charCount(pack.content),
    enabled: enabledFor(pack, workspace),
  }))
  const enabledPacks = allPacks.filter((pack) => enabledFor(pack, workspace))

  const maxChars =
    Number.isFinite(options.maxChars) && options.maxChars > 0
      ? Math.floor(options.maxChars)
      : promptBudget(options.contextWindow ?? null) || FALLBACK_PROMPT_CHARS

  const injectionResult = composeInjection({
    cwd: resolved,
    teamConfig: team.config,
    configPath: team.path,
    teamPacks: teamPackResult.packs,
    workspace,
    personalPacks,
    maxChars,
    environment: environment.name,
    branch: git.isGit ? git.branch ?? '' : '',
  })
  const injection = summarizeInjection(injectionResult)

  const actualEmail = git.isGit ? git.identity?.email ?? '' : ''
  const expectedEmail = workspace.gitEmail
  const emailMismatch = Boolean(expectedEmail && actualEmail && expectedEmail.toLowerCase() !== actualEmail.toLowerCase())
  const emailMissing = Boolean(git.isGit && !actualEmail)
  const nameMissing = Boolean(git.isGit && !(git.identity?.name ?? ''))
  if (emailMissing || nameMissing) {
    warnings.push({
      id: 'git-identity-missing',
      severity: 'error',
      title: 'Git 身份未配置完整',
      message: `${nameMissing ? 'user.name ' : ''}${emailMissing ? 'user.email ' : ''}为空，提交可能失败或被远端拒绝。`,
      source: git.root,
    })
  }
  if (emailMismatch) {
    warnings.push({
      id: 'git-identity-mismatch',
      severity: 'warn',
      title: 'Git 邮箱与工作区期望不一致',
      message: `实际使用 ${actualEmail}，个人层期望 ${expectedEmail}。插件不会自动修改 Git 配置。`,
      source: git.root,
    })
  }

  let protectedMatch = ''
  if (git.isGit && git.branch && team.config) {
    for (const pattern of team.config.git.protectedBranches) {
      try {
        const regex = new RegExp(`^(?:${pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')})$`)
        if (regex.test(git.branch)) {
          protectedMatch = pattern
          break
        }
      } catch {
        /* an invalid pattern was already reported by validation */
      }
    }
  }
  if (protectedMatch) {
    warnings.push({
      id: 'protected-branch',
      severity: 'warn',
      title: '当前在受保护分支上',
      message: `分支 ${git.branch} 命中受保护规则 ${protectedMatch}。提交前应走 PR/MR 流程。`,
      source: team.path,
    })
  }
  if (git.isGit && git.detached) {
    warnings.push({
      id: 'detached-head',
      severity: 'info',
      title: '当前处于 detached HEAD',
      message: '提交不会自动进入任何分支，请确认这是预期状态。',
      source: git.root,
    })
  }
  if (git.isGit && !protectedMatch) {
    const pattern = team.config?.git.branchPattern
    if (pattern) {
      try {
        if (!new RegExp(pattern).test(git.branch ?? '')) {
          warnings.push({
            id: 'branch-pattern',
            severity: 'warn',
            title: '分支名不符合团队规范',
            message: `分支 ${git.branch ?? '(detached)'} 不匹配 ${pattern}。`,
            source: team.path,
          })
        }
      } catch {
        /* invalid pattern already reported */
      }
    }
  }
  if (git.isGit && !git.remote?.url) {
    warnings.push({
      id: 'remote-missing',
      severity: 'info',
      title: '未配置 Git 远端',
      message: '推送和 PR 流程需要先配置 remote。',
      source: git.root,
    })
  }
  if (enabledPacks.length === 0 && !workspace.injectRules) {
    warnings.push({
      id: 'no-injection',
      severity: 'info',
      title: '尚未启用规范注入',
      message: '启用至少一个规范包，或打开「注入团队 Git 规则」，当前会话的模型才会收到规范。',
    })
  }
  if (!environment.name) {
    warnings.push({
      id: 'environment-missing',
      severity: 'info',
      title: '未设置环境标识',
      message: '在团队配置或本工作区个人设置中指定 dev / test / staging / prod。',
    })
  }

  const validationEvents = typeof store.events === 'function' ? store.events({ cwd: resolved, limit: 20 }) : []
  const recentBlocks = validationEvents.filter(
    (event) => event.kind === 'block' && event.createdAt > Date.now() - 7 * 24 * 60 * 60 * 1000,
  )
  if (recentBlocks.length > 0) {
    warnings.push({
      id: 'validation-blocked',
      severity: 'warn',
      title: '最近有提交被校验拦截',
      message: `过去 7 天有 ${recentBlocks.length} 次提交未通过校验，最后一次：${recentBlocks[0]?.findings?.[0]?.title ?? '查看校验页'}。`,
      source: resolved,
    })
  }

  const badgeCount = warnings.filter((warning) => warning.severity === 'warn' || warning.severity === 'error').length

  const effectiveConfig =
    team.config === null
      ? null
      : {
          ...team.config,
          environments: team.config.environments,
        }

  return {
    cwd: resolved,
    repo: {
      isGit: git.isGit,
      reason: git.reason ?? '',
      root: git.root ?? null,
      name: git.name ?? '',
      branch: git.branch ?? null,
      detached: Boolean(git.detached),
      sha: git.sha ?? '',
      remote: git.remote ?? { name: '', url: '' },
      upstream: git.upstream ?? '',
      ahead: git.ahead ?? null,
      behind: git.behind ?? null,
      lastCommit: git.lastCommit ?? null,
      protected: Boolean(protectedMatch),
      protectedBy: protectedMatch,
      probeMs: git.durationMs ?? 0,
    },
    identity: {
      actual: {
        name: git.identity?.name ?? '',
        email: git.identity?.email ?? '',
        nameScope: git.identity?.nameScope ?? '',
        emailScope: git.identity?.emailScope ?? '',
      },
      expected: {
        name: workspace.gitName,
        email: workspace.gitEmail,
      },
      mismatch: emailMismatch,
    },
    environment,
    rules: effectiveConfig?.git ?? null,
    team: effectiveConfig
      ? {
          name: effectiveConfig.team,
          owner: effectiveConfig.teamInfo.owner,
          contacts: effectiveConfig.teamInfo.contacts,
          releaseWindow: effectiveConfig.teamInfo.releaseWindow,
          docs: effectiveConfig.docs,
          // F1.2: names and levels are safe to display; host / port / jump
          // stay in the Host until the user enables server information.
          environments: (effectiveConfig.environments ?? []).map((entry) =>
            workspace.showServerInfo
              ? entry
              : { name: entry.name, level: entry.level, note: entry.note, host: '', port: null, jump: '' },
          ),
        }
      : null,
    dev: effectiveConfig?.dev ?? null,
    config: {
      path: team.path,
      exists: team.exists,
      status: team.status,
      errors: team.errors,
      warnings: team.warnings,
      packWarnings: teamPackResult.warnings,
    },
    packs: {
      available: availablePacks,
      enabled: enabledPacks.map((pack) => ({
        id: pack.id,
        title: pack.title,
        scope: pack.scope,
        chars: charCount(pack.content),
        source: pack.source,
        readonly: pack.readonly,
      })),
      disabledCount: availablePacks.filter((pack) => !pack.enabled).length,
    },
    workspace: {
      gitName: workspace.gitName,
      gitEmail: workspace.gitEmail,
      environment: workspace.environment,
      showServerInfo: workspace.showServerInfo,
      injectRules: workspace.injectRules,
      extraRules: workspace.extraRules,
      enabledPacks: workspace.enabledPacks,
      disabledPacks: workspace.disabledPacks,
      // F1.2 data gating: server accounts leave the Host only after the user
      // explicitly enabled the optional server section.
      servers: workspace.showServerInfo ? workspace.servers : {},
      serversConfigured: Object.keys(workspace.servers ?? {}).length,
      validation: workspace.validation ?? null,
    },
    validation: {
      enabled: workspace.validation?.enabled !== false,
      recentEvents: validationEvents.slice(0, 10),
      recentBlocks: recentBlocks.length,
      levels: workspace.validation?.levels ?? {},
      confirmDanger: workspace.validation?.confirmDanger === true,
      trackCommits: workspace.validation?.trackCommits !== false,
      rules: effectiveMessageRules(team.config, sources),
    },
    sources,
    injection,
    warnings,
    badgeCount,
    maxChars,
    updatedAt: Date.now(),
  }
}

/**
 * The exact text the next model step will receive for this directory.
 */
export function previewInjection(store, team, teamPacks, cwd, workspace, options = {}) {
  const maxChars =
    Number.isFinite(options.maxChars) && options.maxChars > 0
      ? Math.floor(options.maxChars)
      : promptBudget(options.contextWindow ?? null) || FALLBACK_PROMPT_CHARS
  const environment = resolveEnvironment(team.config, workspace)
  return composeInjection({
    cwd,
    teamConfig: team.config,
    configPath: team.path,
    teamPacks,
    workspace,
    personalPacks: store.packs(),
    maxChars,
    environment: environment.name,
    branch: options.branch ?? '',
  })
}

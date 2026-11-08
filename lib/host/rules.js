/**
 * Commit and branch rules (F2.1–F2.4, F2.6, F2.8).
 *
 * Pure functions only: the same engine feeds the model-facing guard, the Host
 * API, the Git hook, and the unit tests. No filesystem and no service access.
 */

export const RULE_LEVELS = ['off', 'info', 'warn', 'block']

export const RULE_DEFS = {
  'identity.email': {
    title: 'Git 邮箱不一致',
    defaultLevel: 'warn',
    description: '实际提交邮箱与个人层登记的期望邮箱不同。',
  },
  'identity.missing': {
    title: 'Git 身份不完整',
    defaultLevel: 'warn',
    description: 'user.name 或 user.email 为空，提交可能失败或被远端拒绝。',
  },
  'branch.protected': {
    title: '受保护分支',
    defaultLevel: 'block',
    description: '当前分支命中团队的受保护分支规则，应走 PR/MR 流程。',
  },
  'branch.pattern': {
    title: '分支命名',
    defaultLevel: 'warn',
    description: '当前分支名不匹配团队的分支命名规则。',
  },
  'branch.detached': {
    title: 'detached HEAD',
    defaultLevel: 'warn',
    description: '当前处于 detached HEAD，提交不会进入任何分支。',
  },
  'commit.format': {
    title: '提交信息格式',
    defaultLevel: 'block',
    description: '提交信息不符合团队约定的格式。',
  },
  'commit.type': {
    title: '提交类型',
    defaultLevel: 'block',
    description: '提交类型不在团队允许的列表中。',
  },
  'commit.scope': {
    title: '提交作用域',
    defaultLevel: 'warn',
    description: '提交 scope 不在团队允许的列表中。',
  },
  'commit.headerLength': {
    title: '首行长度',
    defaultLevel: 'warn',
    description: '提交信息首行超过团队约定的长度。',
  },
  'commit.issue': {
    title: '关联 Issue',
    defaultLevel: 'block',
    description: '团队要求每次提交关联 Issue 编号。',
  },
  'commit.messageMissing': {
    title: '无法读取提交信息',
    defaultLevel: 'warn',
    description: '没有从命令中解析到提交信息，无法校验格式与内容。',
  },
  'commit.mergeMessage': {
    title: '合并提交信息',
    defaultLevel: 'warn',
    description: '团队使用 squash 合并，直接产生 merge commit 通常不是预期流程。',
  },
  'commit.noVerify': {
    title: '--no-verify',
    defaultLevel: 'warn',
    description: '该提交跳过了仓库内 Git 钩子，插件只能覆盖工具调用的这一层。',
  },
  'commit.amend': {
    title: 'amend 提交',
    defaultLevel: 'info',
    description: '本次提交会改写最近的提交。',
  },
}

const DEFAULT_LEVELS = Object.fromEntries(
  Object.entries(RULE_DEFS).map(([id, def]) => [id, def.defaultLevel]),
)

const CONVENTIONAL_RE = /^(?<type>[a-zA-Z][a-zA-Z0-9_-]*)(?:\((?<scope>[^()\r\n]+)\))?(?<breaking>!)?: (?<subject>\S.*)$/
const DEFAULT_ISSUE_RE = /(?:#\d+|[A-Z][A-Z0-9]{1,9}-\d+)/

export function normalizeLevel(value) {
  const level = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return RULE_LEVELS.includes(level) ? level : null
}

/** Convert the team's glob-ish branch patterns into anchored regular expressions. */
export function globToRegExp(pattern) {
  const text = typeof pattern === 'string' ? pattern.trim() : ''
  if (!text) return null
  try {
    return new RegExp(
      `^(?:${text
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.')})$`,
    )
  } catch {
    return null
  }
}

export function matchesProtectedBranch(branch, patterns) {
  if (!branch || !Array.isArray(patterns)) return ''
  for (const pattern of patterns) {
    const regex = globToRegExp(pattern)
    if (regex && regex.test(branch)) return pattern
  }
  return ''
}

/** The newest pattern that matches a proposed branch name. */
export function protectedPatternFor(branch, team) {
  return matchesProtectedBranch(branch, team?.git?.protectedBranches ?? [])
}

export function defaultLevels() {
  return { ...DEFAULT_LEVELS }
}

/**
 * Merge the built-in defaults with the per-workspace overrides.
 * @param {{ validation?: { levels?: Record<string, string> } } | null | undefined} workspace
 */
export function resolveLevels(workspace) {
  const levels = defaultLevels()
  const overrides = workspace?.validation?.levels
  if (!overrides || typeof overrides !== 'object') return levels
  for (const [id, raw] of Object.entries(overrides)) {
    const level = normalizeLevel(raw)
    if (!level) continue
    if (!(id in levels) && !RULE_DEFS[id]) continue
    levels[id] = level
  }
  return levels
}

export function validationEnabled(workspace) {
  return workspace?.validation?.enabled !== false
}

function compileRegex(pattern) {
  if (typeof pattern !== 'string' || pattern.trim() === '') return null
  try {
    return new RegExp(pattern)
  } catch {
    return null
  }
}

function firstLine(message) {
  return String(message ?? '')
    .replace(/\r\n/g, '\n')
    .split('\n')[0]
    .trim()
}

/** Strip Git comment lines before evaluating a commit-msg file. */
export function cleanMessage(message) {
  if (typeof message !== 'string') return ''
  const lines = message.replace(/\r\n/g, '\n').split('\n')
  const kept = []
  for (const line of lines) {
    if (line.startsWith('#')) continue
    kept.push(line)
  }
  return kept.join('\n').trim()
}

/**
 * The effective message rules for a repository.
 * Team config wins; commitlint fills the gaps when no team value exists.
 */
export function effectiveMessageRules(team, sources) {
  const git = team?.git ?? {}
  const commitlint = sources?.commitlint?.rules ?? null
  const format = typeof git.commitFormat === 'string' ? git.commitFormat : null
  const allowedTypes =
    git.allowedCommitTypes?.length > 0 ? git.allowedCommitTypes : (commitlint?.typeEnum ?? [])
  const scopes = commitlint?.scopeEnum ?? []
  let headerMax = Number.isFinite(git.headerMaxLength) ? git.headerMaxLength : null
  if (!headerMax && Number.isFinite(commitlint?.headerMaxLength)) headerMax = commitlint.headerMaxLength
  return {
    format,
    allowedTypes,
    scopes,
    headerMax,
    requireIssue: git.requireIssue === true,
    issuePattern: git.issuePattern || null,
    mergeStrategy: git.mergeStrategy || null,
    branchPattern: git.branchPattern || null,
    protectedBranches: git.protectedBranches ?? [],
    source: commitlint ? sources.commitlint.path : team ? 'team' : 'none',
  }
}

/**
 * @param {object} input
 * @param {string} [input.branch]
 * @param {boolean} [input.detached]
 * @param {{ actual?: { name?: string, email?: string }, expected?: { name?: string, email?: string } }} [input.identity]
 * @param {string | null} [input.message] null means the message could not be resolved
 * @param {string} [input.messageSource]
 * @param {{ amend?: boolean, noVerify?: boolean, skipMessage?: boolean }} [input.commit]
 * @param {object | null} [input.team]
 * @param {object | null} [input.sources]
 * @param {object} [input.workspace]
 * @param {string} [input.expectedEmail]
 * @returns {{ findings: Array<object>, levels: Record<string, string>, blocked: boolean, warnings: number, checkedAt: number }}
 */
export function evaluateCommit(input) {
  const findings = []
  if (!validationEnabled(input.workspace)) {
    return { findings, levels: resolveLevels(input.workspace), blocked: false, warnings: 0, checkedAt: Date.now() }
  }
  const levels = resolveLevels(input.workspace)
  const team = input.team ?? null
  const sources = input.sources ?? null
  const rules = effectiveMessageRules(team, sources)
  const commit = input.commit ?? {}
  const identity = input.identity ?? {}
  const actual = identity.actual ?? {}
  const expected = identity.expected ?? {}
  const expectedEmail = (expected.email || input.expectedEmail || '').trim()
  const branch = typeof input.branch === 'string' ? input.branch : ''

  const add = (id, title, message, fix, source = '') => {
    const level = levels[id] ?? 'warn'
    if (level === 'off') return
    findings.push({
      id,
      level,
      title: title || RULE_DEFS[id]?.title || id,
      message,
      fix,
      source: source || (team ? '.dsh/profile.yaml' : 'DSH VisualRules 默认规则'),
    })
  }

  // F2.1 identity
  if (actual.email === undefined && expectedEmail) {
    // The caller could not read Git identity at all; do not invent a mismatch.
  } else if (expectedEmail && actual.email && expectedEmail.toLowerCase() !== String(actual.email).toLowerCase()) {
    add(
      'identity.email',
      'Git 邮箱不一致',
      `实际提交邮箱 ${actual.email} 与个人层期望 ${expectedEmail} 不一致。`,
      `在仓库执行 git config user.email "${expectedEmail}"，或修改个人配置后重试。`,
      '个人配置',
    )
  }
  if (actual.email === '' || actual.name === '') {
    const missing = [actual.name === '' ? 'user.name' : '', actual.email === '' ? 'user.email' : ''].filter(Boolean)
    if (missing.length > 0) {
      add(
        'identity.missing',
        'Git 身份不完整',
        `${missing.join('、')} 为空，提交可能失败或被远端拒绝。`,
        '先配置仓库级或全局 Git 身份，再提交。',
        'Git 配置',
      )
    }
  }

  // F2.2 / F2.4 branch
  if (branch) {
    const protectedPattern = matchesProtectedBranch(branch, rules.protectedBranches)
    if (protectedPattern) {
      add(
        'branch.protected',
        '受保护分支',
        `当前分支 ${branch} 命中受保护规则 ${protectedPattern}，团队约定不允许直接提交。`,
        '创建特性分支（例如 git switch -c feature/<name>）后提交，并通过 PR/MR 合并。',
      )
    }
    const branchRegex = compileRegex(rules.branchPattern)
    if (branchRegex && !branchRegex.test(branch) && !protectedPattern) {
      add(
        'branch.pattern',
        '分支命名不符合规范',
        `分支 ${branch} 不匹配 ${rules.branchPattern}。`,
        '重命名分支或从正确命名的分支重新提交。',
      )
    }
  }
  if (input.detached) {
    add('branch.detached', 'detached HEAD', '当前处于 detached HEAD，提交不会自动进入任何分支。', '先切回或新建分支再提交。')
  }

  // F2.3 commit message
  const skipMessage = commit.skipMessage === true
  const message = skipMessage
    ? null
    : input.message === null || input.message === undefined
      ? null
      : cleanMessage(input.message)
  if (skipMessage) {
    // pre-commit hooks have no message yet; branch/identity rules still apply.
  } else if (message === null || message === '') {
    add(
      'commit.messageMissing',
      '无法读取提交信息',
      '没有从命令中解析到提交信息，无法校验格式、类型与 Issue 关联。',
      '使用 git commit -m "<message>" 或 git commit -F <file> 重新提交。',
      commit.amend ? 'git 提交（amend）' : '提交命令',
    )
  } else {
    const subject = firstLine(message)
    const conventional =
      rules.format === 'conventional' ||
      rules.format === 'conventional-commits' ||
      (!rules.format && (rules.allowedTypes.length > 0 || rules.scopes.length > 0))
    if (conventional) {
      const match = CONVENTIONAL_RE.exec(subject)
      if (!match) {
        add(
          'commit.format',
          '提交信息格式不符合 Conventional Commits',
          `首行「${subject}」不符合 <type>(<scope>): <subject>。`,
          '例如：feat(auth): 支持手机号登录。',
        )
      } else {
        const type = match.groups?.type ?? ''
        if (rules.allowedTypes.length > 0 && !rules.allowedTypes.includes(type)) {
          add(
            'commit.type',
            '提交类型不在允许列表',
            `类型 "${type}" 不在 ${rules.allowedTypes.map((item) => `\`${item}\``).join('、')} 中。`,
            `改用团队允许的类型之一：${rules.allowedTypes.join(' / ')}。`,
            sources?.commitlint?.path ?? '.dsh/profile.yaml',
          )
        }
        const scope = match.groups?.scope ?? ''
        if (scope && rules.scopes.length > 0 && !rules.scopes.includes(scope)) {
          add(
            'commit.scope',
            '提交 scope 不在允许列表',
            `scope "${scope}" 不在 ${rules.scopes.map((item) => `\`${item}\``).join('、')} 中。`,
            '改用允许的 scope，或省略 scope。',
            sources?.commitlint?.path ?? '.dsh/profile.yaml',
          )
        }
      }
    } else if (rules.format) {
      const custom = compileRegex(rules.format)
      if (custom && !custom.test(subject)) {
        add(
          'commit.format',
          '提交信息格式不符合团队规则',
          `首行「${subject}」不匹配 ${rules.format}。`,
          '按团队配置中的 commit_format 正则修正首行。',
        )
      }
    }
    if (rules.headerMax && subject.length > rules.headerMax) {
      add(
        'commit.headerLength',
        '提交信息首行过长',
        `首行 ${subject.length} 个字符，超过上限 ${rules.headerMax}。`,
        '把细节移到正文，首行只保留一句话摘要。',
        sources?.commitlint?.path ?? '.dsh/profile.yaml',
      )
    }
    if (rules.requireIssue) {
      const issueRegex = compileRegex(rules.issuePattern) ?? DEFAULT_ISSUE_RE
      if (!issueRegex.test(message)) {
        add(
          'commit.issue',
          '提交未关联 Issue',
          `团队要求提交关联 Issue 编号${rules.issuePattern ? `，格式为 ${rules.issuePattern}` : ''}，当前信息中没有找到。`,
          '在提交信息正文中补上 Issue 编号，例如 Refs: #123。',
        )
      }
    }
    if (rules.mergeStrategy === 'squash' && /^Merge\b/.test(subject)) {
      add(
        'commit.mergeMessage',
        '合并提交与团队策略不符',
        '团队使用 squash 合并，直接生成 merge commit 通常不是预期流程。',
        '改用 squash / rebase 流程，并写一条说明变更的提交信息。',
      )
    }
  }

  if (commit.noVerify) {
    add(
      'commit.noVerify',
      '跳过 Git 钩子',
      '命令带有 --no-verify，仓库内 Git 钩子不会执行；插件只在工具层校验。',
      '去掉 --no-verify，让钩子也执行一次。',
      '命令行',
    )
  }
  if (commit.amend) {
    add('commit.amend', 'amend 提交', '本次提交会改写最近一次提交。', '确认目标提交正确，且不要改写已推送的公共历史。')
  }

  const blocked = findings.some((finding) => finding.level === 'block')
  const warnings = findings.filter((finding) => finding.level === 'warn').length
  return { findings, levels, blocked, warnings, checkedAt: Date.now() }
}

/** Validate a proposed branch name against the team rules. */
export function evaluateBranch(input) {
  const findings = []
  if (!validationEnabled(input.workspace)) {
    return { findings, blocked: false, warnings: 0, levels: resolveLevels(input.workspace), checkedAt: Date.now() }
  }
  const levels = resolveLevels(input.workspace)
  const team = input.team ?? null
  const branch = String(input.branch ?? '').trim()
  const add = (id, message, fix, source = '.dsh/profile.yaml') => {
    const level = levels[id] ?? 'warn'
    if (level === 'off') return
    findings.push({ id, level, title: RULE_DEFS[id]?.title ?? id, message, fix, source })
  }
  if (!branch) {
    add('branch.pattern', '分支名为空。', '提供一个分支名，例如 feature/login。')
  } else {
    if (matchesProtectedBranch(branch, team?.git?.protectedBranches ?? [])) {
      add(
        'branch.protected',
        `分支 ${branch} 是受保护分支，不能作为新分支的基础或直接提交。`,
        '先创建特性分支，再通过 PR/MR 合并。',
      )
    }
    const pattern = team?.git?.branchPattern
    const regex = compileRegex(pattern)
    if (regex && !regex.test(branch)) {
      add('branch.pattern', `分支 ${branch} 不匹配 ${pattern}。`, '按团队命名规则重命名。')
    }
  }
  return {
    findings,
    blocked: findings.some((finding) => finding.level === 'block'),
    warnings: findings.filter((finding) => finding.level === 'warn').length,
    levels,
    checkedAt: Date.now(),
  }
}

/** Model-facing text for a denial or a check result (F2.8). */
export function findingsText(result, options = {}) {
  const findings = result?.findings ?? []
  if (findings.length === 0) {
    return options.okText ?? 'DSH VisualRules：本次提交通过全部已启用的校验规则。'
  }
  const blocked = findings.filter((finding) => finding.level === 'block')
  const warned = findings.filter((finding) => finding.level === 'warn')
  const infos = findings.filter((finding) => finding.level === 'info')
  const lines = []
  lines.push(
    blocked.length > 0
      ? `Git 提交被 DSH VisualRules 拦截（${blocked.length} 条阻断${warned.length ? `、${warned.length} 条警告` : ''}）。`
      : `DSH VisualRules 提交校验（${warned.length} 条警告）：`,
  )
  lines.push('')
  let index = 1
  for (const finding of [...blocked, ...warned, ...infos]) {
    lines.push(`${index}. [${finding.id}] ${finding.title}`)
    lines.push(`   ${finding.message}`)
    if (finding.source) lines.push(`   来源：${finding.source}`)
    if (finding.fix) lines.push(`   修正：${finding.fix}`)
    index += 1
  }
  if (blocked.length > 0) {
    lines.push('')
    lines.push('如何处理：')
    lines.push('- 按上面的「修正」改完后重新执行提交命令；不要使用 --no-verify 绕过。')
    lines.push('- 只有用户明确同意例外时，才请用户在 DSH「工作区规范 → 校验」中点击「临时放行」，然后重试。')
    lines.push('- 也可以先调用 visualrules_check 工具校验拟用的提交信息与分支。')
  }
  return lines.join('\n')
}

export function summarizeFindings(result) {
  const findings = result?.findings ?? []
  return {
    blocked: findings.filter((finding) => finding.level === 'block').length,
    warnings: findings.filter((finding) => finding.level === 'warn').length,
    total: findings.length,
  }
}

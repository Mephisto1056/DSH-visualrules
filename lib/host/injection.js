import { CHARS_PER_TOKEN, FALLBACK_PROMPT_CHARS, PROMPT_BUDGET_RATIO } from './constants.js'

/**
 * Compose the model-facing rules block.
 *
 * The same composer feeds both the live Session prompt and the preview endpoint,
 * so what the UI shows is exactly what the model receives.
 */

const SCOPE_ORDER = { personal: 0, team: 1, 'team-rules': 1, workspace: 2 }
const SCOPE_PRIORITY = { personal: 1, team: 2, 'team-rules': 2, workspace: 3 }
export const SCOPE_LABEL = {
  personal: '个人',
  team: '团队',
  'team-rules': '团队规则',
  workspace: '工作区补充',
}

function trimContent(text) {
  return typeof text === 'string' ? text.replace(/\r\n/g, '\n').trim() : ''
}

export function buildStructuredRules(teamConfig) {
  if (!teamConfig) return ''
  const git = teamConfig.git
  const lines = []
  if (git.branchPattern) lines.push(`- 分支命名必须匹配：\`${git.branchPattern}\``)
  if (git.commitFormat) lines.push(`- Commit message 格式：\`${git.commitFormat}\``)
  if (git.allowedCommitTypes.length > 0) lines.push(`- 允许的提交类型：${git.allowedCommitTypes.map((t) => `\`${t}\``).join('、')}`)
  if (git.requireIssue) lines.push('- 每次提交必须关联 Issue 编号')
  if (git.issuePattern) lines.push(`- Issue 编号格式：\`${git.issuePattern}\``)
  if (git.mergeStrategy) lines.push(`- 合并策略：\`${git.mergeStrategy}\``)
  if (git.protectedBranches.length > 0) {
    lines.push(`- 受保护分支（禁止直接提交，走 PR/MR）：${git.protectedBranches.map((b) => `\`${b}\``).join('、')}`)
  }
  if (git.reviewMin !== null && git.reviewMin !== undefined) lines.push(`- 合并前至少需要 ${git.reviewMin} 个批准`)
  if (git.tagPattern) lines.push(`- Tag 命名必须匹配：\`${git.tagPattern}\``)
  return lines.join('\n')
}

/**
 * @param {object} input
 * @param {string} input.cwd
 * @param {object | null} input.teamConfig
 * @param {string | null} input.configPath
 * @param {{ id: string, title: string, description?: string, content: string, source?: string }[]} input.teamPacks
 * @param {{ enabledPacks: string[], disabledPacks: string[], injectRules: boolean, extraRules: string }} input.workspace
 * @param {{ id: string, title: string, scope: string, content: string, globalEnabled?: boolean }[]} input.personalPacks
 * @param {number} input.maxChars
 * @param {string} [input.environment]
 * @param {string} [input.branch]
 */
export function composeInjection(input) {
  const {
    cwd,
    teamConfig,
    configPath,
    teamPacks,
    workspace,
    personalPacks,
    maxChars,
    environment = '',
    branch = '',
  } = input
  const enabled = new Set(workspace?.enabledPacks ?? [])
  const disabled = new Set(workspace?.disabledPacks ?? [])

  /** @type {Array<{key:string,id:string,title:string,scope:string,source:string,content:string}>} */
  const candidates = []

  if (workspace?.injectRules && teamConfig) {
    const rules = buildStructuredRules(teamConfig)
    if (rules) {
      candidates.push({
        key: 'team-rules',
        id: 'team-rules',
        title: '团队 Git 规则',
        scope: 'team-rules',
        source: configPath || '.dsh/profile.yaml',
        content: rules,
      })
    }
  }

  for (const pack of personalPacks) {
    const on = pack.globalEnabled === true || enabled.has(pack.id)
    if (!on || disabled.has(pack.id)) continue
    const content = trimContent(pack.content)
    if (!content) continue
    candidates.push({
      key: `pack:${pack.id}`,
      id: pack.id,
      title: pack.title,
      scope: 'personal',
      source: `个人规范库 · ${pack.id}`,
      content,
    })
  }

  for (const pack of teamPacks) {
    if (!enabled.has(pack.id) || disabled.has(pack.id)) continue
    const content = trimContent(pack.content)
    if (!content) continue
    candidates.push({
      key: `pack:${pack.id}`,
      id: pack.id,
      title: pack.title,
      scope: 'team',
      source: pack.source || configPath || '.dsh/profile.yaml',
      content,
    })
  }

  const extra = trimContent(workspace?.extraRules ?? '')
  if (extra) {
    candidates.push({
      key: 'workspace-extra',
      id: 'workspace-extra',
      title: '工作区补充规范',
      scope: 'workspace',
      source: cwd,
      content: extra,
    })
  }

  const header = [
    '<!-- dsh-visualrules:begin -->',
    '## 工作区规范（由 DSH VisualRules 注入）',
    '',
    `当前会话目录：\`${cwd}\`${branch ? `；分支：\`${branch}\`` : ''}${environment ? `；环境：\`${environment}\`` : ''}。`,
    '层序：个人 → 团队 → 工作区补充；条目冲突时，后出现的条目优先。',
  ]
  if (environment && /^(prod|production|prd)$/i.test(environment)) {
    header.push('', '> ⚠️ 当前环境标记为 **prod（生产）**。执行远程、删除、部署等高风险操作前必须向用户二次确认。')
  }
  header.push('')

  const budget = Math.max(2_000, Number.isFinite(maxChars) ? maxChars : 24_000)
  const baseLength = header.join('\n').length + '\n<!-- dsh-visualrules:end -->\n'.length
  const reserve = 600

  // Choose by specificity first so the most specific rules survive truncation,
  // then render in layer order so the model reads general rules before specific.
  const ranked = [...candidates].sort(
    (a, b) => (SCOPE_PRIORITY[b.scope] ?? 0) - (SCOPE_PRIORITY[a.scope] ?? 0) || a.title.localeCompare(b.title),
  )
  const selected = []
  const omitted = []
  let used = baseLength + reserve
  for (const entry of ranked) {
    const head = `\n### [${SCOPE_LABEL[entry.scope]}] ${entry.title}（${entry.id}）\n来源：\`${entry.source}\`\n\n`
    const tail = '\n'
    const full = `${head}${entry.content}${tail}`
    if (used + full.length <= budget) {
      selected.push({ ...entry, render: full, included: true, truncated: false, chars: entry.content.length })
      used += full.length
      continue
    }
    const marker = '\n\n…（内容超出注入预算，已截断）\n'
    const available = budget - used - head.length - marker.length
    if (available > 400) {
      const cut = entry.content.slice(0, available).replace(/\s+\S*$/, '')
      const render = `${head}${cut}${marker}`
      selected.push({ ...entry, render, included: true, truncated: true, chars: entry.content.length })
      used += render.length
      continue
    }
    omitted.push({ key: entry.key, id: entry.id, title: entry.title, scope: entry.scope, chars: entry.content.length })
  }

  if (selected.length === 0 && omitted.length === 0) {
    return {
      text: '',
      totalChars: 0,
      maxChars: budget,
      truncated: false,
      entries: [],
      omitted: [],
    }
  }

  selected.sort((a, b) => (SCOPE_ORDER[a.scope] ?? 0) - (SCOPE_ORDER[b.scope] ?? 0) || a.title.localeCompare(b.title))
  const body = selected.map((entry) => entry.render)
  if (omitted.length > 0) {
    body.push(
      `\n> 另有 ${omitted.length} 个条目因超出注入预算未包含：${omitted
        .map((entry) => `${entry.title}（${entry.id}）`)
        .join('、')}。\n`,
    )
  }
  const text = `${header.join('\n')}${body.join('')}\n<!-- dsh-visualrules:end -->\n`
  const entries = selected.map((entry) => ({
    key: entry.key,
    id: entry.id,
    title: entry.title,
    scope: entry.scope,
    source: entry.source,
    chars: entry.content.length,
    included: true,
    truncated: entry.truncated,
  }))
  return {
    text,
    totalChars: text.length,
    maxChars: budget,
    truncated: omitted.length > 0 || selected.some((entry) => entry.truncated),
    entries,
    omitted,
  }
}

/**
 * Human-readable summary used by the compact preview and status bar.
 */
export function summarizeInjection(result) {
  return {
    totalChars: result.totalChars,
    maxChars: result.maxChars,
    truncated: result.truncated,
    packs: result.entries.map((entry) => ({
      id: entry.id,
      title: entry.title,
      scope: entry.scope,
      chars: entry.chars,
      truncated: entry.truncated,
    })),
    omitted: result.omitted,
  }
}

/**
 * Convert a context window into a character budget for this plugin.
 * @param {number | null | undefined} contextWindow
 */
export function promptBudget(contextWindow) {
  if (!Number.isFinite(contextWindow) || contextWindow <= 0) return FALLBACK_PROMPT_CHARS
  return Math.max(
    6_000,
    Math.min(60_000, Math.floor(contextWindow * PROMPT_BUDGET_RATIO * CHARS_PER_TOKEN)),
  )
}

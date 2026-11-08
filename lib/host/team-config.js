/**
 * Team-layer configuration: read-only `.dsh/profile.yaml` inside the repository.
 *
 * The loader never writes this file. It validates structurally, reports the
 * source line for every problem, ignores unknown fields with a warning, and
 * degrades to display-only data when the document is invalid.
 */

import fs from 'node:fs'
import path from 'node:path'
import { parseDocument } from 'yaml'
import { CONFIG_FILE_NAMES, MAX_TEAM_FILE_BYTES } from './constants.js'

const cache = new Map()
const fileCache = new Map()

const TOP_LEVEL = new Set([
  'version',
  'team',
  'environment',
  'environments',
  'git',
  'dev',
  'docs',
  'team_info',
  'packs',
])

const PRIVATE_TOP_LEVEL = new Set(['identity', 'servers', 'exclusive', 'personal'])

const ENV_LEVELS = new Set(['dev', 'test', 'staging', 'prod', 'info', 'warn', 'danger', 'none'])

function lineAt(text, offset) {
  if (!Number.isFinite(offset) || offset < 0) return undefined
  let line = 1
  for (let i = 0; i < offset && i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) line += 1
  }
  return line
}

function lineOf(doc, text, keyPath) {
  try {
    const node = doc.getIn(keyPath, true)
    if (node && Array.isArray(node.range) && Number.isFinite(node.range[0])) {
      return lineAt(text, node.range[0])
    }
  } catch {
    /* an unknown path simply has no line */
  }
  return undefined
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function asString(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function asStringArray(value) {
  if (Array.isArray(value)) {
    return value.filter((item) => typeof item === 'string' && item.trim() !== '').map((item) => item.trim())
  }
  if (typeof value === 'string' && value.trim() !== '') return [value.trim()]
  return []
}

function safeRegex(pattern, addError, keyPath) {
  const text = asString(pattern)
  if (!text) return null
  try {
    new RegExp(text)
    return text
  } catch (error) {
    addError(keyPath, `不是合法的正则表达式：${error instanceof Error ? error.message : String(error)}`)
    return null
  }
}

function normalizeEnvironment(raw, index, addError, addWarning) {
  const base = `environments.${index}`
  if (!isPlainObject(raw)) {
    addError(base, '环境条目必须是对象，例如 { name: staging, host: stg.example.com, level: warn }')
    return null
  }
  const name = asString(raw.name)
  if (!name) {
    addError(`${base}.name`, '环境条目缺少 name')
    return null
  }
  for (const key of Object.keys(raw)) {
    if (!['name', 'host', 'port', 'level', 'jump', 'jump_host', 'note'].includes(key)) {
      addWarning(`${base}.${key}`, `未知字段 "${key}"，已忽略`)
    }
  }
  let level = asString(raw.level).toLowerCase()
  if (level && !ENV_LEVELS.has(level)) {
    addWarning(`${base}.level`, `未知环境级别 "${level}"，按 info 处理`)
    level = 'info'
  }
  let port = null
  if (raw.port !== undefined && raw.port !== null && raw.port !== '') {
    const parsed = typeof raw.port === 'number' ? raw.port : Number(raw.port)
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
      addWarning(`${base}.port`, '端口不是 1-65535 的整数，已忽略')
    } else {
      port = parsed
    }
  }
  return {
    name,
    host: asString(raw.host),
    port,
    level,
    jump: asString(raw.jump ?? raw.jump_host),
    note: asString(raw.note),
  }
}

function normalizeContact(raw) {
  if (typeof raw === 'string') return raw.trim()
  if (isPlainObject(raw)) {
    const name = asString(raw.name)
    const role = asString(raw.role)
    const contact = asString(raw.contact ?? raw.email ?? raw.handle)
    if (!name && !contact) return ''
    return [name, role, contact].filter(Boolean).join(' · ')
  }
  return ''
}

function normalizeDev(raw, addWarning) {
  const dev = isPlainObject(raw) ? raw : {}
  if (raw !== undefined && !isPlainObject(raw)) addWarning('dev', 'dev 必须是对象，已按默认值处理')
  const allowed = new Set(['toolchain', 'lint', 'formatter', 'test', 'ci_required', 'dirs'])
  for (const key of Object.keys(dev)) {
    if (!allowed.has(key)) addWarning(`dev.${key}`, `未知字段 "${key}"，已忽略`)
  }
  const toolchain = {}
  if (isPlainObject(dev.toolchain)) {
    for (const [name, version] of Object.entries(dev.toolchain)) {
      if (typeof version === 'string' || typeof version === 'number') toolchain[name] = String(version)
    }
  } else if (dev.toolchain !== undefined) {
    addWarning('dev.toolchain', 'toolchain 必须是 { 工具: 版本 } 对象，已忽略')
  }
  const dirs = {}
  if (isPlainObject(dev.dirs)) {
    for (const [name, target] of Object.entries(dev.dirs)) {
      if (typeof target === 'string') dirs[name] = target
    }
  }
  return {
    toolchain,
    lint: asString(dev.lint),
    formatter: asString(dev.formatter),
    test: asStringArray(dev.test),
    ciRequired: asStringArray(dev.ci_required),
    dirs,
  }
}

function normalizeDocs(raw, addWarning) {
  const docs = isPlainObject(raw) ? raw : {}
  if (raw !== undefined && !isPlainObject(raw)) addWarning('docs', 'docs 必须是对象，已按默认值处理')
  const allowed = new Set(['wiki', 'issues', 'contributing', 'pr_template', 'prTemplate'])
  for (const key of Object.keys(docs)) {
    if (!allowed.has(key)) addWarning(`docs.${key}`, `未知字段 "${key}"，已忽略`)
  }
  return {
    wiki: asString(docs.wiki),
    issues: asString(docs.issues),
    contributing: asString(docs.contributing),
    prTemplate: asString(docs.pr_template ?? docs.prTemplate),
  }
}

function normalizeTeamInfo(raw, addWarning) {
  const info = isPlainObject(raw) ? raw : {}
  if (raw !== undefined && !isPlainObject(raw)) addWarning('team_info', 'team_info 必须是对象，已按默认值处理')
  const allowed = new Set(['owner', 'contacts', 'release_window', 'timezone'])
  for (const key of Object.keys(info)) {
    if (!allowed.has(key)) addWarning(`team_info.${key}`, `未知字段 "${key}"，已忽略`)
  }
  const contacts = Array.isArray(info.contacts)
    ? info.contacts.map(normalizeContact).filter(Boolean)
    : info.contacts
      ? [normalizeContact(info.contacts)].filter(Boolean)
      : []
  return {
    owner: asString(info.owner),
    contacts,
    releaseWindow: asString(info.release_window),
    timezone: asString(info.timezone),
  }
}

function normalizePacks(raw, addError, addWarning) {
  if (raw === undefined) return []
  if (!Array.isArray(raw)) {
    addError('packs', 'packs 必须是数组')
    return []
  }
  const packs = []
  const seen = new Set()
  raw.forEach((item, index) => {
    const base = `packs.${index}`
    if (!isPlainObject(item)) {
      addError(base, '规范包条目必须是对象')
      return
    }
    const allowed = new Set(['id', 'title', 'description', 'file', 'content'])
    for (const key of Object.keys(item)) {
      if (!allowed.has(key)) addWarning(`${base}.${key}`, `未知字段 "${key}"，已忽略`)
    }
    const id = asString(item.id)
    if (!id) {
      addError(`${base}.id`, '团队规范包缺少 id')
      return
    }
    if (seen.has(id)) {
      addWarning(`${base}.id`, `规范包 id "${id}" 重复，后一个已忽略`)
      return
    }
    seen.add(id)
    const file = asString(item.file)
    const content = typeof item.content === 'string' ? item.content : ''
    if (!file && !content) {
      addWarning(`${base}`, `规范包 "${id}" 既没有 file 也没有 content，已忽略`)
      return
    }
    packs.push({
      id,
      title: asString(item.title) || id,
      description: asString(item.description),
      file,
      content,
    })
  })
  return packs
}

/**
 * Validate and normalize a parsed document.
 * @param {unknown} raw
 * @param {import('yaml').Document} doc
 * @param {string} text
 */
export function normalizeTeamConfig(raw, doc, text) {
  const errors = []
  const warnings = []
  const addError = (keyPath, message) => {
    const line = lineOf(doc, text, keyPath.split('.'))
    errors.push({ code: 'config-invalid', path: keyPath, message, line })
  }
  const addWarning = (keyPath, message) => {
    const line = lineOf(doc, text, keyPath.split('.'))
    warnings.push({ code: 'config-warning', path: keyPath, message, line })
  }

  if (raw === null || raw === undefined) raw = {}
  if (!isPlainObject(raw)) {
    addError('', '配置根节点必须是映射（key: value）')
    return { config: null, errors, warnings }
  }

  for (const key of Object.keys(raw)) {
    if (PRIVATE_TOP_LEVEL.has(key)) {
      addWarning(key, '个人字段不得出现在团队层，已忽略该字段')
    } else if (!TOP_LEVEL.has(key)) {
      addWarning(key, `未知字段 "${key}"，已忽略（向前兼容）`)
    }
  }

  let version = 1
  if (raw.version !== undefined) {
    if (!Number.isInteger(raw.version) || raw.version < 1) {
      addError('version', 'version 必须是大于 0 的整数')
    } else {
      version = raw.version
      if (version > 1) addWarning('version', `配置版本 ${version} 高于本插件支持的 1，将按已知字段尽力解析`)
    }
  }

  const environments = []
  if (raw.environments !== undefined) {
    if (!Array.isArray(raw.environments)) {
      addError('environments', 'environments 必须是数组')
    } else {
      raw.environments.forEach((entry, index) => {
        const normalized = normalizeEnvironment(entry, index, addError, addWarning)
        if (normalized) environments.push(normalized)
      })
    }
  }

  const environmentNames = new Set()
  for (const entry of environments) {
    if (environmentNames.has(entry.name)) {
      addWarning('environments', `环境名 "${entry.name}" 重复，后一个仅用于展示`)
    }
    environmentNames.add(entry.name)
  }

  const gitRaw = isPlainObject(raw.git) ? raw.git : {}
  if (raw.git !== undefined && !isPlainObject(raw.git)) addError('git', 'git 必须是对象')
  const gitAllowed = new Set([
    'branch_pattern',
    'commit_format',
    'require_issue',
    'merge_strategy',
    'protected_branches',
    'review',
    'tag_pattern',
    'issue_pattern',
    'allowed_commit_types',
    'header_max_length',
  ])
  for (const key of Object.keys(gitRaw)) {
    if (!gitAllowed.has(key)) addWarning(`git.${key}`, `未知字段 "${key}"，已忽略`)
  }
  let requireIssue = false
  if (gitRaw.require_issue !== undefined) {
    if (typeof gitRaw.require_issue !== 'boolean') {
      addWarning('git.require_issue', 'require_issue 必须是布尔值，已按 false 处理')
    } else {
      requireIssue = gitRaw.require_issue
    }
  }
  let reviewMin = null
  if (gitRaw.review !== undefined) {
    if (!isPlainObject(gitRaw.review)) {
      addWarning('git.review', 'review 必须是对象，已忽略')
    } else if (gitRaw.review.min_approvals !== undefined) {
      const value = gitRaw.review.min_approvals
      if (!Number.isInteger(value) || value < 0) {
        addWarning('git.review.min_approvals', 'min_approvals 必须是非负整数，已忽略')
      } else {
        reviewMin = value
      }
    }
  }
  const protectedBranches = asStringArray(gitRaw.protected_branches)
  let headerMaxLength = null
  if (gitRaw.header_max_length !== undefined) {
    const value = gitRaw.header_max_length
    if (!Number.isInteger(value) || value < 10 || value > 500) {
      addWarning('git.header_max_length', 'header_max_length 必须是 10-500 的整数，已忽略')
    } else {
      headerMaxLength = value
    }
  }
  let environment = asString(raw.environment)
  if (environment && environments.length > 0 && !environments.some((entry) => entry.name === environment)) {
    addWarning('environment', `environment "${environment}" 不在 environments 列表中`)
  }

  const config = {
    version,
    team: asString(raw.team),
    environment: environment || null,
    environments,
    git: {
      branchPattern: safeRegex(gitRaw.branch_pattern, addError, 'git.branch_pattern'),
      commitFormat: asString(gitRaw.commit_format) || null,
      requireIssue,
      mergeStrategy: asString(gitRaw.merge_strategy) || null,
      protectedBranches,
      reviewMin,
      tagPattern: safeRegex(gitRaw.tag_pattern, addError, 'git.tag_pattern'),
      issuePattern: safeRegex(gitRaw.issue_pattern, addError, 'git.issue_pattern'),
      allowedCommitTypes: asStringArray(gitRaw.allowed_commit_types),
      headerMaxLength,
    },
    dev: normalizeDev(raw.dev, addWarning),
    docs: normalizeDocs(raw.docs, addWarning),
    teamInfo: normalizeTeamInfo(raw.team_info, addWarning),
    packs: normalizePacks(raw.packs, addError, addWarning),
  }

  return { config, errors, warnings }
}

/**
 * Find the nearest team config for a directory.
 * @param {string} cwd
 * @param {string | null} repoRoot
 */
export function findTeamConfigPath(cwd, repoRoot) {
  const realpath = (value) => {
    let current = path.resolve(value)
    const missing = []
    while (!fs.existsSync(current)) {
      const parent = path.dirname(current)
      if (parent === current) break
      missing.unshift(path.basename(current))
      current = parent
    }
    try {
      return path.join(fs.realpathSync(current), ...missing)
    } catch {
      return path.resolve(value)
    }
  }
  const start = realpath(cwd)
  const stop = repoRoot ? realpath(repoRoot) : start
  const dirs = []
  let current = start
  for (let i = 0; i < 32; i += 1) {
    if (stop && current !== stop && !current.startsWith(stop + path.sep)) break
    dirs.push(current)
    if (current === stop) break
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }
  for (const dir of dirs) {
    for (const name of CONFIG_FILE_NAMES) {
      const candidate = path.join(dir, name)
      try {
        if (fs.statSync(candidate).isFile()) return candidate
      } catch {
        /* keep looking */
      }
    }
  }
  return null
}

function readTextFile(file) {
  const stat = fs.statSync(file)
  if (!stat.isFile()) throw new Error('not a file')
  if (stat.size > MAX_TEAM_FILE_BYTES) throw new Error(`file exceeds ${MAX_TEAM_FILE_BYTES} bytes`)
  const cached = fileCache.get(file)
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached
  const value = { text: fs.readFileSync(file, 'utf8'), mtimeMs: stat.mtimeMs, size: stat.size }
  fileCache.set(file, value)
  return value
}

/**
 * Load one config synchronously, with an mtime/size cache.
 * @param {string | null} file
 */
export function loadTeamConfigSync(file) {
  if (!file) {
    return {
      path: null,
      exists: false,
      status: 'missing',
      config: null,
      errors: [],
      warnings: [],
      text: '',
      mtimeMs: 0,
    }
  }
  let stat
  try {
    stat = fs.statSync(file)
  } catch (error) {
    return {
      path: file,
      exists: false,
      status: 'missing',
      config: null,
      errors: [
        {
          code: 'config-missing',
          path: '',
          message: `无法读取配置文件：${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      warnings: [],
      text: '',
      mtimeMs: 0,
    }
  }
  const cached = cache.get(file)
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.result

  let text = ''
  try {
    text = readTextFile(file).text
  } catch (error) {
    const result = {
      path: file,
      exists: true,
      status: 'invalid',
      config: null,
      errors: [
        {
          code: 'config-unreadable',
          path: '',
          message: error instanceof Error ? error.message : String(error),
        },
      ],
      warnings: [],
      text: '',
      mtimeMs: stat.mtimeMs,
    }
    cache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, result })
    return result
  }

  const doc = parseDocument(text, { prettyErrors: false, maxAliasCount: 100 })
  if (doc.errors.length > 0) {
    const errors = doc.errors.map((error) => ({
      code: 'yaml-parse',
      path: '',
      message: error.message,
      line: error.linePos?.[0]?.line ?? lineAt(text, error.pos?.[0]),
    }))
    const result = { path: file, exists: true, status: 'invalid', config: null, errors, warnings: [], text, mtimeMs: stat.mtimeMs }
    cache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, result })
    return result
  }

  let raw
  try {
    raw = doc.toJS({ maxAliasCount: 100 })
  } catch (error) {
    const result = {
      path: file,
      exists: true,
      status: 'invalid',
      config: null,
      errors: [{ code: 'config-unreadable', path: '', message: error instanceof Error ? error.message : String(error) }],
      warnings: [],
      text,
      mtimeMs: stat.mtimeMs,
    }
    cache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, result })
    return result
  }

  const { config, errors, warnings } = normalizeTeamConfig(raw, doc, text)
  const result = {
    path: file,
    exists: true,
    status: errors.length > 0 ? 'invalid' : 'ok',
    config: errors.length > 0 ? null : config,
    errors,
    warnings,
    text,
    mtimeMs: stat.mtimeMs,
  }
  cache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, result })
  return result
}

/**
 * Resolve team packs declared by the config into readable documents.
 * Paths must stay inside the repository root.
 * @param {object | null} config
 * @param {string | null} configPath
 */
export function resolveTeamPacks(config, configPath) {
  if (!config || !configPath) return { packs: [], warnings: [] }
  const baseDir = path.dirname(path.dirname(configPath))
  const warnings = []
  const packs = []
  for (const declared of config.packs) {
    let content = declared.content
    let source = configPath
    if (!content && declared.file) {
      const target = path.resolve(baseDir, declared.file)
      const relative = path.relative(baseDir, target)
      if (relative.startsWith('..') || path.isAbsolute(relative)) {
        warnings.push({
          code: 'pack-outside-repo',
          path: `packs.${declared.id}`,
          message: `规范包 "${declared.id}" 的文件指向仓库外，已忽略`,
        })
        continue
      }
      try {
        const file = readTextFile(target)
        content = file.text
        source = target
      } catch (error) {
        warnings.push({
          code: 'pack-unreadable',
          path: `packs.${declared.id}`,
          message: `无法读取规范包 "${declared.id}"：${error instanceof Error ? error.message : String(error)}`,
        })
        continue
      }
    }
    if (!content || content.trim() === '') {
      warnings.push({
        code: 'pack-empty',
        path: `packs.${declared.id}`,
        message: `规范包 "${declared.id}" 内容为空，已忽略`,
      })
      continue
    }
    packs.push({
      id: declared.id,
      title: declared.title,
      description: declared.description,
      scope: 'team',
      content,
      source,
    })
  }
  return { packs, warnings }
}

export function clearTeamConfigCache() {
  cache.clear()
  fileCache.clear()
}

export function invalidateTeamConfig(file) {
  if (!file) return
  cache.delete(file)
  fileCache.delete(file)
}

export function teamConfigTemplate() {
  return `# 团队层配置示例：随仓库提交，插件只读；按团队实际值修改。
version: 1
team: 支付平台组
environment: staging
environments:
  - { name: staging, host: stg.example.com, level: warn }
  - { name: prod, host: prod.example.com, level: danger }
git:
  # 分支命名与保护规则属于团队约定。
  branch_pattern: "^(feature|fix|hotfix)/[a-z0-9-]+$"
  commit_format: conventional
  header_max_length: 72
  require_issue: true
  merge_strategy: squash
  protected_branches: [main, "release/*"]
  # 评审人数属于团队规则；默认规范包不会重复。
  review:
    min_approvals: 2
dev:
  toolchain: { node: "20.x", python: "3.11" }
  lint: eslint
  test: [unit-test]
  ci_required: [lint, unit-test]
docs:
  wiki: https://example.com/wiki
  issues: https://example.com/board
team_info:
  owner: 张三
  contacts: [张三 · 负责人 · zhang@example.com]
  release_window: 每周四 20:00
packs:
  - id: team/git-rules
    title: 团队提交规范
    file: .dsh/rules/git-rules.md
`
}

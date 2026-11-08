/**
 * Existing rule sources inside a repository (F4.7).
 *
 * The plugin deliberately does not execute project configuration. It reads
 * commitlint / .editorconfig / eslint / CONTRIBUTING / PR-template files as
 * read-only evidence, extracts the few stable rules it can, and reports what it
 * could not parse instead of guessing.
 */

import fs from 'node:fs'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'

const MAX_FILE_BYTES = 256 * 1024
const cache = new Map()

const COMMITLINT_NAMES = [
  'commitlint.config.js',
  'commitlint.config.cjs',
  'commitlint.config.mjs',
  'commitlint.config.ts',
  '.commitlintrc',
  '.commitlintrc.json',
  '.commitlintrc.yaml',
  '.commitlintrc.yml',
  '.commitlintrc.js',
  '.commitlintrc.cjs',
]

const ESLINT_NAMES = [
  'eslint.config.js',
  'eslint.config.mjs',
  'eslint.config.cjs',
  'eslint.config.ts',
  '.eslintrc',
  '.eslintrc.json',
  '.eslintrc.js',
  '.eslintrc.cjs',
  '.eslintrc.yml',
  '.eslintrc.yaml',
]

const CONVENTIONAL_TYPES = ['build', 'chore', 'ci', 'docs', 'feat', 'fix', 'perf', 'refactor', 'revert', 'style', 'test']

function readText(file) {
  let stat
  try {
    stat = fs.statSync(file)
  } catch {
    return null
  }
  if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return null
  const cached = cache.get(file)
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.text
  try {
    const text = fs.readFileSync(file, 'utf8')
    cache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, text })
    return text
  } catch {
    return null
  }
}

function findFirst(root, names) {
  for (const name of names) {
    const file = path.join(root, name)
    try {
      if (fs.statSync(file).isFile()) return file
    } catch {
      /* keep looking */
    }
  }
  return null
}

function extractStringArray(text, key) {
  const index = text.indexOf(key)
  if (index < 0) return []
  const open = text.indexOf('[', index)
  if (open < 0) return []
  const close = text.indexOf(']', open)
  if (close < 0) return []
  const body = text.slice(open + 1, close)
  return [...body.matchAll(/['"`]([^'"`]+)['"`]/g)]
    .map((match) => match[1])
    .filter((value) => value !== 'always' && value !== 'never')
}

function extractNumber(text, key) {
  const index = text.indexOf(key)
  if (index < 0) return null
  const line = text.slice(index, index + 160)
  const array = /\[([^\]]*)\]/.exec(line)
  const body = array ? array[1] : line
  const numbers = [...body.matchAll(/\b(\d{1,4})\b/g)].map((match) => Number(match[1]))
  return numbers.length > 0 ? numbers[numbers.length - 1] : null
}

function parseCommitlintFile(file) {
  const text = readText(file)
  if (text === null) return { rules: {}, warnings: [`无法读取 ${path.basename(file)}`] }
  const ext = path.extname(file).toLowerCase()
  const warnings = []
  const rules = {}
  let document = null
  if (ext === '.json' || path.basename(file) === '.commitlintrc') {
    try {
      const raw = JSON.parse(text)
      if (raw && typeof raw === 'object') {
        document = raw.rules && typeof raw.rules === 'object' ? raw.rules : raw
        if (raw.extends) rules.extends = [].concat(raw.extends).filter((item) => typeof item === 'string')
      }
    } catch {
      // .commitlintrc without an extension may be YAML.
      try {
        const raw = parseYaml(text)
        if (raw && typeof raw === 'object') {
          document = raw.rules && typeof raw.rules === 'object' ? raw.rules : raw
          if (raw.extends) rules.extends = [].concat(raw.extends).filter((item) => typeof item === 'string')
        }
      } catch {
        warnings.push(`无法解析 ${path.basename(file)}`)
      }
    }
  } else if (ext === '.yaml' || ext === '.yml') {
    try {
      const raw = parseYaml(text)
      if (raw && typeof raw === 'object') {
        document = raw.rules && typeof raw.rules === 'object' ? raw.rules : raw
        if (raw.extends) rules.extends = [].concat(raw.extends).filter((item) => typeof item === 'string')
      }
    } catch {
      warnings.push(`无法解析 ${path.basename(file)}`)
    }
  } else {
    // JS / CJS / MJS / TS: static extraction only; never execute project code.
    rules.extends = [...text.matchAll(/['"](@commitlint\/config-[a-z-]+)['"]/g)].map((match) => match[1])
    rules.typeEnum = extractStringArray(text, 'type-enum')
    rules.scopeEnum = extractStringArray(text, 'scope-enum')
    const header = extractNumber(text, 'header-max-length')
    if (Number.isInteger(header)) rules.headerMaxLength = header
    const typeCase = /type-case['"]?\s*[:,]\s*\[\s*\d*\s*,?\s*['"](\w+)['"]/.exec(text)
    if (typeCase) rules.typeCase = typeCase[1]
    const meaningful = rules.typeEnum?.length > 0 || rules.scopeEnum?.length > 0 || rules.headerMaxLength || rules.extends?.length > 0
    if (!meaningful) {
      warnings.push(`${path.basename(file)} 是 JavaScript 配置，插件只做静态读取，未能提取规则`)
    }
  }
  if (document && typeof document === 'object') {
    const pick = (key) => document[key]
    const enumOf = (value) => {
      if (Array.isArray(value)) {
        const last = value[value.length - 1]
        return Array.isArray(last) ? last.filter((item) => typeof item === 'string') : []
      }
      return []
    }
    const typeEnum = enumOf(pick('type-enum'))
    if (typeEnum.length > 0) rules.typeEnum = typeEnum
    const scopeEnum = enumOf(pick('scope-enum'))
    if (scopeEnum.length > 0) rules.scopeEnum = scopeEnum
    const header = pick('header-max-length')
    if (Array.isArray(header) && Number.isInteger(header[2])) rules.headerMaxLength = header[2]
    const typeCaseValue = pick('type-case')
    if (Array.isArray(typeCaseValue) && typeof typeCaseValue[2] === 'string') rules.typeCase = typeCaseValue[2]
  }
  if (rules.extends?.some((item) => item.includes('config-conventional'))) {
    if (!rules.typeEnum || rules.typeEnum.length === 0) rules.typeEnum = [...CONVENTIONAL_TYPES]
    if (!rules.headerMaxLength) rules.headerMaxLength = 100
  }
  return { rules, warnings }
}

function parseEditorconfig(file) {
  const text = readText(file)
  if (text === null) return { rules: {}, warnings: [] }
  const rules = {}
  for (const line of text.split('\n')) {
    const match = /^\s*([A-Za-z_]+)\s*=\s*(.+?)\s*$/.exec(line)
    if (!match) continue
    const key = match[1].toLowerCase()
    const value = match[2]
    if (key === 'indent_style') rules.indentStyle = value
    if (key === 'indent_size') rules.indentSize = value
    if (key === 'max_line_length' && /^\d+$/.test(value)) rules.maxLineLength = Number(value)
  }
  return { rules, warnings: [] }
}

function findContributing(root) {
  for (const name of ['CONTRIBUTING.md', 'CONTRIBUTING.zh-CN.md', 'CONTRIBUTING.zh.md', 'docs/CONTRIBUTING.md']) {
    const file = path.join(root, name)
    try {
      if (fs.statSync(file).isFile()) return file
    } catch {
      /* keep looking */
    }
  }
  return null
}

function findPrTemplate(root) {
  for (const name of [
    '.github/PULL_REQUEST_TEMPLATE.md',
    '.github/pull_request_template.md',
    'docs/PULL_REQUEST_TEMPLATE.md',
    'PULL_REQUEST_TEMPLATE.md',
  ]) {
    const file = path.join(root, name)
    try {
      if (fs.statSync(file).isFile()) return file
    } catch {
      /* keep looking */
    }
  }
  return null
}

function readTitle(file) {
  const text = readText(file)
  if (!text) return ''
  const match = /^#\s+(.+)$/m.exec(text)
  return match ? match[1].trim().slice(0, 120) : ''
}

/**
 * @param {string | null} repoRoot
 * @returns {{ commitlint: object | null, editorconfig: object | null, eslint: object | null, docs: object, warnings: string[] }}
 */
export function discoverSources(repoRoot) {
  if (!repoRoot) return { commitlint: null, editorconfig: null, eslint: null, docs: {}, warnings: [] }
  const warnings = []
  let commitlint = null
  const commitlintFile = findFirst(repoRoot, COMMITLINT_NAMES)
  let packageFile = path.join(repoRoot, 'package.json')
  let packageCommitlint = null
  let packageJson = null
  const packageText = readText(packageFile)
  if (packageText) {
    try {
      packageJson = JSON.parse(packageText)
      if (packageJson?.commitlint) packageCommitlint = packageJson.commitlint
    } catch {
      /* a malformed package.json is not this plugin's problem */
    }
  }
  if (commitlintFile) {
    const parsed = parseCommitlintFile(commitlintFile)
    commitlint = { path: commitlintFile, ...parsed }
    warnings.push(...parsed.warnings)
  } else if (packageCommitlint) {
    const rules = {}
    const raw = packageCommitlint.rules ?? packageCommitlint
    const enumOf = (value) => (Array.isArray(value) && Array.isArray(value[value.length - 1]) ? value[value.length - 1] : [])
    const typeEnum = enumOf(raw['type-enum'])
    if (typeEnum.length > 0) rules.typeEnum = typeEnum
    const scopeEnum = enumOf(raw['scope-enum'])
    if (scopeEnum.length > 0) rules.scopeEnum = scopeEnum
    const header = raw['header-max-length']
    if (Array.isArray(header) && Number.isInteger(header[2])) rules.headerMaxLength = header[2]
    const extendsList = [].concat(packageCommitlint.extends ?? []).filter((item) => typeof item === 'string')
    if (extendsList.includes('@commitlint/config-conventional')) {
      if (!rules.typeEnum || rules.typeEnum.length === 0) rules.typeEnum = [...CONVENTIONAL_TYPES]
      if (!rules.headerMaxLength) rules.headerMaxLength = 100
    }
    commitlint = { path: packageFile, rules, warnings: [] }
  }

  const editorFile = findFirst(repoRoot, ['.editorconfig'])
  const editorconfig = editorFile ? { path: editorFile, ...parseEditorconfig(editorFile) } : null

  const eslintFile = findFirst(repoRoot, ESLINT_NAMES)
  let eslint = null
  if (eslintFile) {
    eslint = { path: eslintFile, name: path.basename(eslintFile) }
    if (packageJson?.eslintConfig) eslint.packageField = true
  } else if (packageFile && packageJson?.eslintConfig) {
    eslint = { path: packageFile, name: 'package.json#eslintConfig', packageField: true }
  }

  const contributing = findContributing(repoRoot)
  const prTemplate = findPrTemplate(repoRoot)
  const docs = {
    contributing: contributing ? { path: contributing, title: readTitle(contributing) } : null,
    prTemplate: prTemplate ? { path: prTemplate, title: readTitle(prTemplate) } : null,
  }
  return { commitlint, editorconfig, eslint, docs, warnings }
}

export function clearSourceCache() {
  cache.clear()
}

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { clearSourceCache, discoverSources } from '../lib/host/sources.js'

const dirs = []

function tempRepo(name) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `visualrules-sources-${name}-`))
  dirs.push(root)
  return root
}

test.after(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
  clearSourceCache()
})

test('statically reads a JavaScript commitlint config', () => {
  const root = tempRepo('js')
  fs.writeFileSync(
    path.join(root, 'commitlint.config.mjs'),
    `export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [2, 'always', ['feat', 'fix', 'chore']],
    'scope-enum': [2, 'always', ['api', 'ui']],
    'header-max-length': [2, 'always', 72],
  },
}
`,
  )
  const sources = discoverSources(root)
  assert.equal(sources.commitlint.path.endsWith('commitlint.config.mjs'), true)
  assert.deepEqual(sources.commitlint.rules.typeEnum, ['feat', 'fix', 'chore'])
  assert.deepEqual(sources.commitlint.rules.scopeEnum, ['api', 'ui'])
  assert.equal(sources.commitlint.rules.headerMaxLength, 72)
  assert.deepEqual(sources.warnings, [])
})

test('parses JSON and YAML commitlint configs', () => {
  const root = tempRepo('json')
  fs.writeFileSync(
    path.join(root, '.commitlintrc.json'),
    JSON.stringify({ rules: { 'type-enum': [2, 'always', ['feat', 'fix']], 'header-max-length': [2, 'always', 60] } }),
  )
  const json = discoverSources(root)
  assert.deepEqual(json.commitlint.rules.typeEnum, ['feat', 'fix'])
  assert.equal(json.commitlint.rules.headerMaxLength, 60)

  const yamlRoot = tempRepo('yaml')
  fs.writeFileSync(
    path.join(yamlRoot, '.commitlintrc.yml'),
    `extends:
  - "@commitlint/config-conventional"
rules:
  type-enum:
    - 2
    - always
    - [feat, fix, docs]
  header-max-length:
    - 2
    - always
    - 80
`,
  )
  const yaml = discoverSources(yamlRoot)
  assert.deepEqual(yaml.commitlint.rules.typeEnum, ['feat', 'fix', 'docs'])
  assert.equal(yaml.commitlint.rules.headerMaxLength, 80)
})

test('reads package.json commitlint and conventional defaults', () => {
  const root = tempRepo('package')
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ commitlint: { extends: ['@commitlint/config-conventional'] } }))
  const sources = discoverSources(root)
  assert.ok(sources.commitlint.rules.typeEnum.includes('feat'))
  assert.equal(sources.commitlint.rules.headerMaxLength, 100)
})

test('reports a JS config it cannot statically read', () => {
  const root = tempRepo('opaque')
  fs.writeFileSync(path.join(root, 'commitlint.config.js'), `module.exports = require('./rules.js')\n`)
  const sources = discoverSources(root)
  assert.ok(sources.commitlint)
  assert.ok(sources.warnings.some((warning) => warning.includes('静态读取')))
})

test('reads editorconfig, eslint, and docs', () => {
  const root = tempRepo('docs')
  fs.writeFileSync(path.join(root, '.editorconfig'), 'root = true\n[*]\nindent_style = space\nindent_size = 2\nmax_line_length = 100\n')
  fs.writeFileSync(path.join(root, '.eslintrc.json'), '{}')
  fs.mkdirSync(path.join(root, '.github'), { recursive: true })
  fs.writeFileSync(path.join(root, 'CONTRIBUTING.md'), '# Contributing\n\nUse conventional commits.\n')
  fs.writeFileSync(path.join(root, '.github', 'PULL_REQUEST_TEMPLATE.md'), '# Pull request\n')
  const sources = discoverSources(root)
  assert.deepEqual(sources.editorconfig.rules, { indentStyle: 'space', indentSize: '2', maxLineLength: 100 })
  assert.equal(sources.eslint.path.endsWith('.eslintrc.json'), true)
  assert.equal(sources.docs.contributing.title, 'Contributing')
  assert.equal(sources.docs.prTemplate.title, 'Pull request')
})

test('a directory without rule sources is empty, not an error', () => {
  const root = tempRepo('empty')
  const sources = discoverSources(root)
  assert.equal(sources.commitlint, null)
  assert.equal(sources.editorconfig, null)
  assert.equal(sources.eslint, null)
  assert.deepEqual(sources.warnings, [])
  assert.deepEqual(discoverSources(null), { commitlint: null, editorconfig: null, eslint: null, docs: {}, warnings: [] })
})

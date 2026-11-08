#!/usr/bin/env node
/**
 * Repository checks that do not need a live Harness:
 * syntax of every runtime file, JSON validity of the manifests, and the
 * package export surface.
 */

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const problems = []

function walk(dir, extensions, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, extensions, out)
    else if (extensions.includes(path.extname(entry.name))) out.push(full)
  }
  return out
}

for (const file of walk(path.join(root, 'lib'), ['.js', '.mjs'])) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' })
  } catch (error) {
    problems.push(`${path.relative(root, file)}: ${String(error.stderr || error.message).trim()}`)
  }
}

for (const file of walk(path.join(root, 'test'), ['.mjs'])) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' })
  } catch (error) {
    problems.push(`${path.relative(root, file)}: ${String(error.stderr || error.message).trim()}`)
  }
}

for (const file of ['package.json', 'locale/en.json', 'locale/zh.json']) {
  try {
    JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'))
  } catch (error) {
    problems.push(`${file}: invalid JSON (${error.message})`)
  }
}

const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
for (const [specifier, target] of Object.entries(manifest.exports ?? {})) {
  if (specifier.includes('*')) continue
  const resolved = path.join(root, target)
  if (!fs.existsSync(resolved)) problems.push(`exports["${specifier}"] points at missing ${target}`)
}
const files = manifest.files ?? []
if (!files.some((entry) => entry.includes('lib'))) problems.push('package.json files must include lib')
if (!manifest.dsh?.bundle?.patch) problems.push('package.json must declare dsh.bundle.patch')

if (problems.length > 0) {
  console.error(`visualrules check failed (${problems.length}):`)
  for (const problem of problems) console.error(`- ${problem}`)
  process.exit(1)
}
console.log(`visualrules check: ${walk(path.join(root, 'lib'), ['.js', '.mjs']).length} runtime files, manifest and locales OK`)

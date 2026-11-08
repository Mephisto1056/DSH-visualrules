#!/usr/bin/env node
/**
 * Standalone Git hook runner for DSH VisualRules.
 *
 * This file is executed by the repository hooks, outside the Harness process.
 * It only reads the repository, the team config, and the local hook snapshot;
 * any failure degrades to "do not block" (PRD §6.3).
 */

import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

function git(args, cwd) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).trim()
  } catch {
    return ''
  }
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function skip(message) {
  if (message) process.stderr.write(`dsh-visualrules: ${message}\n`)
  process.exit(0)
}

async function main() {
  const kind = process.argv[2] === 'commit-msg' ? 'commit-msg' : 'pre-commit'
  const cwd = process.cwd()
  const repoRoot = git(['rev-parse', '--show-toplevel'], cwd)
  if (!repoRoot) skip('not inside a Git repository; skipping')

  let rules
  let teamConfig
  let sourcesModule
  try {
    rules = await import(new URL('../host/rules.js', import.meta.url))
    teamConfig = await import(new URL('../host/team-config.js', import.meta.url))
    sourcesModule = await import(new URL('../host/sources.js', import.meta.url))
  } catch (error) {
    skip(`rule engine is unavailable (${error instanceof Error ? error.message : String(error)}); skipping`)
  }

  const hooksDir = process.env.DSH_VISUALRULES_HOOKS_DIR || path.join(repoRoot, '.git', 'hooks')
  const snapshot = readJson(path.join(hooksDir, 'dsh-visualrules.json'))
  if (snapshot && snapshot.enabled === false) skip('validation is disabled for this workspace')

  const configPath = teamConfig.findTeamConfigPath(repoRoot, repoRoot)
  const team = teamConfig.loadTeamConfigSync(configPath)
  if (team.errors.length > 0) {
    skip(`team config is invalid (${team.errors[0]?.message ?? 'unknown error'}); skipping validation`)
  }
  if (!team.config) skip('')

  const sources = sourcesModule.discoverSources(repoRoot)
  const branch = git(['symbolic-ref', '--short', '-q', 'HEAD'], repoRoot)
  const identity = {
    actual: {
      name: git(['config', '--get', 'user.name'], repoRoot),
      email: git(['config', '--get', 'user.email'], repoRoot),
    },
    expected: {
      name: snapshot?.expectedName ?? '',
      email: snapshot?.expectedEmail ?? '',
    },
  }
  let message = null
  if (kind === 'commit-msg') {
    const file = process.argv[3]
    if (!file) skip('commit-msg hook received no message file')
    try {
      message = fs.readFileSync(path.resolve(cwd, file), 'utf8')
    } catch (error) {
      skip(`cannot read the commit message file (${error instanceof Error ? error.message : String(error)})`)
    }
  }
  const workspace = {
    validation: {
      enabled: snapshot ? snapshot.enabled !== false : true,
      levels: snapshot?.levels && typeof snapshot.levels === 'object' ? snapshot.levels : {},
    },
  }
  let result
  try {
    result = rules.evaluateCommit({
      branch,
      detached: !branch,
      identity,
      message,
      messageSource: kind === 'commit-msg' ? 'file' : 'absent',
      commit: { amend: false, noVerify: false, skipMessage: kind === 'pre-commit' },
      team: team.config,
      sources,
      workspace,
    })
  } catch (error) {
    skip(`rule evaluation failed (${error instanceof Error ? error.message : String(error)}); skipping`)
  }
  if (result.findings.length === 0) process.exit(0)
  const blocked = result.findings.filter((finding) => finding.level === 'block')
  const warnings = result.findings.filter((finding) => finding.level === 'warn')
  if (blocked.length === 0 && warnings.length === 0) process.exit(0)
  process.stderr.write(`\n${rules.findingsText(result)}\n`)
  process.stderr.write(
    blocked.length > 0
      ? '\n提示：这是本地辅助检查，替代不了服务端分支保护和 CI；--no-verify 可以绕过它。\n\n'
      : '\n',
  )
  process.exit(blocked.length > 0 ? 1 : 0)
}

main().catch((error) => {
  process.stderr.write(`dsh-visualrules: hook failed to run (${error instanceof Error ? error.message : String(error)}); skipping\n`)
  process.exit(0)
})

#!/usr/bin/env node
/**
 * Command-line companion for the optional repository hooks.
 *
 * The Harness UI is the primary path; this script exists for headless hosts,
 * CI images, and users who prefer a terminal. It writes only inside the
 * repository's hooks directory and refuses a core.hooksPath outside it.
 *
 * Usage:
 *   node scripts/hooks.mjs status [cwd]
 *   node scripts/hooks.mjs install [cwd]
 *   node scripts/hooks.mjs uninstall [cwd]
 */

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { hookStatus, installHooks, uninstallHooks } from '../lib/host/hooks.js'

const action = process.argv[2] ?? 'status'
const cwd = path.resolve(process.argv[3] ?? process.cwd())

function printStatus(status) {
  if (!status.repoRoot) {
    console.log('visualrules: not a Git repository')
    return
  }
  console.log(`repo: ${status.repoRoot}`)
  console.log(`hooks: ${status.directory}${status.customDirectory ? ' (core.hooksPath)' : ''}`)
  console.log(`installed: ${status.installed ? 'yes' : status.partiallyInstalled ? 'partial' : 'no'}`)
  for (const hook of status.hooks) {
    console.log(`  ${hook.kind}: ${hook.installed ? 'managed' : 'not managed'}${hook.original ? `, previous: ${hook.original}` : ''}`)
  }
}

async function main() {
  if (!['status', 'install', 'uninstall'].includes(action)) {
    console.error('usage: node scripts/hooks.mjs <status|install|uninstall> [cwd]')
    process.exit(1)
  }
  if (!fs.existsSync(cwd)) {
    console.error(`visualrules: directory does not exist: ${cwd}`)
    process.exit(1)
  }
  if (action === 'status') {
    printStatus(await hookStatus(cwd))
    return
  }
  if (action === 'install') {
    const workspace = {
      gitEmail: '',
      gitName: '',
      validation: { enabled: true, levels: {} },
    }
    const result = await installHooks(cwd, { workspace })
    if (!result.ok) {
      console.error(`visualrules: ${result.error ?? 'installation failed'}`)
      for (const warning of result.warnings ?? []) console.error(`- ${warning}`)
      process.exit(1)
    }
    console.log(`visualrules: installed ${result.created.length} hooks in ${result.directory}`)
    for (const backup of result.backups) console.log(`  preserved previous hook: ${backup}`)
    console.log('  open Settings -> VisualRules -> Validation to review levels, or edit .dsh/profile.yaml for team rules.')
    return
  }
  const result = await uninstallHooks(cwd)
  if (!result.ok) {
    console.error(`visualrules: ${result.error ?? 'uninstall incomplete'}`)
    for (const warning of result.warnings ?? []) console.error(`- ${warning}`)
    process.exit(1)
  }
  console.log(`visualrules: removed ${result.removed.length} hooks, restored ${result.restored.length}`)
}

main().catch((error) => {
  console.error(`visualrules: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})

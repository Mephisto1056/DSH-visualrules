/**
 * Optional repository Git hooks (F2.9).
 *
 * Two hooks cooperate with the tool-layer guard:
 * - `pre-commit` checks identity, branch, and protected branches;
 * - `commit-msg` checks the message rules.
 *
 * Installation is explicit, reversible, and never overwrites an existing hook:
 * the previous hook is moved aside and executed first from the managed wrapper.
 */

import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const MARKER_START = '>>> dsh-visualrules >>>'
const MARKER_END = '<<< dsh-visualrules <<<'
const SNAPSHOT_NAME = 'dsh-visualrules.json'
const HOOK_NAMES = ['pre-commit', 'commit-msg']

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const CHECKER = path.join(PLUGIN_ROOT, 'lib', 'hook', 'check.mjs')

function shQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`
}

function runGit(cwd, args, timeoutMs = 5_000) {
  return new Promise((resolve) => {
    execFile(
      'git',
      args,
      { cwd, timeout: timeoutMs, maxBuffer: 512 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
      (error, stdout, stderr) => {
        resolve({
          ok: !error,
          stdout: typeof stdout === 'string' ? stdout.trim() : '',
          stderr: typeof stderr === 'string' ? stderr.trim() : '',
          error: error ? String(error.message ?? error) : '',
        })
      },
    )
  })
}

export async function resolveRepoRoot(cwd) {
  if (!cwd) return null
  const result = await runGit(cwd, ['rev-parse', '--show-toplevel'])
  return result.ok && result.stdout ? result.stdout : null
}

async function hooksDirectory(repoRoot) {
  const configured = await runGit(repoRoot, ['config', '--get', 'core.hooksPath'])
  if (configured.ok && configured.stdout) {
    const value = configured.stdout
    if (path.isAbsolute(value)) {
      return { dir: value, custom: true, ok: isInside(repoRoot, value) }
    }
    const resolved = path.resolve(repoRoot, value)
    return { dir: resolved, custom: true, ok: isInside(repoRoot, resolved) }
  }
  return { dir: path.join(repoRoot, '.git', 'hooks'), custom: false, ok: true }
}

function isInside(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child))
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

export function hookScript(kind) {
  return `#!/bin/sh
# ${MARKER_START}
# Managed by dsh-visualrules. Uninstall from Settings -> VisualRules -> Validation.
# Existing hook content is preserved as *.dsh-visualrules-original and runs first.
set -u
DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ORIGINAL="$DIR/${kind}.dsh-visualrules-original"
if [ -x "$ORIGINAL" ]; then
  "$ORIGINAL" "$@" || exit $?
fi
CHECKER=${shQuote(CHECKER)}
export DSH_VISUALRULES_HOOKS_DIR="$DIR"
if [ ! -f "$CHECKER" ]; then
  echo "dsh-visualrules: hook checker is missing at $CHECKER; skipping." >&2
  exit 0
fi
if ! command -v node >/dev/null 2>&1; then
  echo "dsh-visualrules: node was not found on PATH; skipping Git hook checks." >&2
  exit 0
fi
exec node "$CHECKER" ${kind} "$@"
# ${MARKER_END}
`
}

function hasMarker(file) {
  try {
    return fs.readFileSync(file, 'utf8').includes(MARKER_START)
  } catch {
    return false
  }
}

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch {
    return ''
  }
}

function readSnapshot(dir) {
  try {
    const value = JSON.parse(fs.readFileSync(path.join(dir, SNAPSHOT_NAME), 'utf8'))
    return value && typeof value === 'object' ? value : null
  } catch {
    return null
  }
}

/** Write the personal override snapshot the standalone hook reads. */
export async function writeHookSnapshot(repoRoot, snapshot) {
  if (!repoRoot) return null
  const hooks = await hooksDirectory(repoRoot)
  if (!hooks.ok) return null
  try {
    fs.mkdirSync(hooks.dir, { recursive: true })
    const file = path.join(hooks.dir, SNAPSHOT_NAME)
    const value = {
      version: 1,
      updatedAt: Date.now(),
      enabled: snapshot.enabled !== false,
      levels: snapshot.levels && typeof snapshot.levels === 'object' ? snapshot.levels : {},
      expectedEmail: typeof snapshot.expectedEmail === 'string' ? snapshot.expectedEmail : '',
      expectedName: typeof snapshot.expectedName === 'string' ? snapshot.expectedName : '',
      pluginRoot: PLUGIN_ROOT,
    }
    fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
    return file
  } catch {
    return null
  }
}

export async function removeHookSnapshot(repoRoot) {
  if (!repoRoot) return false
  const hooks = await hooksDirectory(repoRoot)
  if (!hooks.ok) return false
  try {
    fs.rmSync(path.join(hooks.dir, SNAPSHOT_NAME), { force: true })
    return true
  } catch {
    return false
  }
}

export async function hookStatus(cwd) {
  const repoRoot = await resolveRepoRoot(cwd)
  if (!repoRoot) {
    return { ok: false, reason: 'not-a-git-repository', repoRoot: null, hooks: [], installed: false }
  }
  const dirInfo = await hooksDirectory(repoRoot)
  const hooks = HOOK_NAMES.map((kind) => {
    const file = path.join(dirInfo.dir, kind)
    const original = `${file}.dsh-visualrules-original`
    const managed = hasMarker(file)
    let executable = false
    try {
      executable = Boolean(fs.statSync(file).mode & 0o111)
    } catch {
      /* missing */
    }
    const expected = hookScript(kind)
    const current = readText(file)
    return {
      kind,
      path: file,
      installed: managed,
      executable,
      original: fs.existsSync(original) ? original : null,
      stale: managed && current !== expected,
    }
  })
  const installed = hooks.every((hook) => hook.installed)
  const partiallyInstalled = hooks.some((hook) => hook.installed)
  return {
    ok: dirInfo.ok,
    reason: dirInfo.ok ? '' : 'hooks-path-outside-repository',
    repoRoot,
    directory: dirInfo.dir,
    customDirectory: dirInfo.custom,
    installed,
    partiallyInstalled,
    hooks,
    pluginRoot: PLUGIN_ROOT,
    checker: CHECKER,
    snapshot: readSnapshot(dirInfo.dir),
  }
}

export function hookPreview() {
  return {
    pluginRoot: PLUGIN_ROOT,
    checker: CHECKER,
    hooks: HOOK_NAMES.map((kind) => ({ kind, path: `${kind}`, content: hookScript(kind) })),
    note: '安装后：AI 发起的提交由工具层拦截；终端 / IDE / 脚本里的提交由这两个 Git 钩子覆盖。git commit --no-verify 无法被本地机制拦截。',
  }
}

export async function installHooks(cwd, options = {}) {
  const status = await hookStatus(cwd)
  if (!status.repoRoot) return { ok: false, error: '当前目录不是 Git 仓库' }
  if (!status.ok) {
    return {
      ok: false,
      error: `core.hooksPath 指向仓库外（${status.directory}），插件不会在仓库外写文件`,
      status,
    }
  }
  const created = []
  const backups = []
  const warnings = []
  for (const kind of HOOK_NAMES) {
    const file = path.join(status.directory, kind)
    const original = `${file}.dsh-visualrules-original`
    try {
      fs.mkdirSync(status.directory, { recursive: true })
      if (fs.existsSync(file) && !hasMarker(file) && !fs.existsSync(original)) {
        fs.renameSync(file, original)
        backups.push(original)
      }
      fs.writeFileSync(file, hookScript(kind), 'utf8')
      fs.chmodSync(file, 0o755)
      created.push(file)
    } catch (error) {
      warnings.push(`${kind}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  if (options.workspace) {
    await writeHookSnapshot(status.repoRoot, {
      enabled: options.workspace.validation?.enabled !== false,
      levels: options.workspace.validation?.levels ?? {},
      expectedEmail: options.workspace.gitEmail ?? '',
      expectedName: options.workspace.gitName ?? '',
    })
  }
  const after = await hookStatus(cwd)
  return {
    ok: after.installed,
    repoRoot: status.repoRoot,
    directory: status.directory,
    created,
    backups,
    warnings,
    status: after,
  }
}

export async function uninstallHooks(cwd) {
  const status = await hookStatus(cwd)
  if (!status.repoRoot) return { ok: false, error: '当前目录不是 Git 仓库' }
  const removed = []
  const restored = []
  const warnings = []
  for (const kind of HOOK_NAMES) {
    const file = path.join(status.directory, kind)
    const original = `${file}.dsh-visualrules-original`
    try {
      if (hasMarker(file)) {
        fs.rmSync(file, { force: true })
        removed.push(file)
      } else if (fs.existsSync(file)) {
        warnings.push(`${kind} 不是由本插件安装，已保留`)
      }
      if (fs.existsSync(original)) {
        fs.renameSync(original, file)
        restored.push(file)
      }
    } catch (error) {
      warnings.push(`${kind}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  await removeHookSnapshot(status.repoRoot)
  const after = await hookStatus(cwd)
  return { ok: !after.partiallyInstalled, removed, restored, warnings, status: after }
}

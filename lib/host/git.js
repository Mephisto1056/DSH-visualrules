/** Read-only Git probing for the workspace profile. */

import { execFile } from 'node:child_process'

const CACHE_TTL_MS = 4_000
const cache = new Map()

function clean(text) {
  return typeof text === 'string' ? text.replace(/\r\n/g, '\n').trim() : ''
}

function runExecFile(cwd, args, timeoutMs) {
  return new Promise((resolve) => {
    execFile(
      'git',
      args,
      {
        cwd,
        timeout: timeoutMs,
        maxBuffer: 2 * 1024 * 1024,
        env: {
          ...process.env,
          GIT_OPTIONAL_LOCKS: '0',
          GIT_TERMINAL_PROMPT: '0',
          LC_ALL: 'C',
        },
      },
      (error, stdout, stderr) => {
        const code = error && typeof error.code === 'number' ? error.code : error ? 1 : 0
        resolve({
          ok: !error || (typeof error.code === 'number' && error.code === 0),
          code,
          stdout: typeof stdout === 'string' ? stdout : '',
          stderr: typeof stderr === 'string' ? stderr : '',
          timedOut: Boolean(error && error.killed),
          error: error && error.killed ? 'timeout' : error ? String(error.message ?? error) : '',
        })
      },
    )
  })
}

async function runViaSubprocess(ctx, subprocess, cwd, args, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs)
  let handle
  try {
    handle = subprocess.spawn({
      argv: ['git', ...args],
      cwd,
      graceMs: 300,
      signal: controller.signal,
      env: {
        ...process.env,
        GIT_OPTIONAL_LOCKS: '0',
        GIT_TERMINAL_PROMPT: '0',
        LC_ALL: 'C',
      },
      stdio: {
        stdin: 'ignore',
        stdout: { maxBytes: 2 * 1024 * 1024 },
        stderr: { maxBytes: 256 * 1024 },
      },
    })
    const outcome = await handle.done
    return {
      ok: outcome.exitCode === 0,
      code: outcome.exitCode ?? 1,
      stdout: clean(handle.collected?.stdout?.readFrom(0).text),
      stderr: clean(handle.collected?.stderr?.readFrom(0).text),
      timedOut: false,
      error: '',
    }
  } catch (error) {
    return {
      ok: false,
      code: 1,
      stdout: '',
      stderr: '',
      timedOut: controller.signal.aborted,
      error: error instanceof Error ? error.message : String(error),
    }
  } finally {
    clearTimeout(timer)
    try {
      handle?.terminate?.()
    } catch {
      /* already exited */
    }
  }
}

export async function gitOutput(ctx, cwd, args, timeoutMs = 2_500) {
  const result = await runGit(ctx, cwd, args, timeoutMs)
  return result.ok ? clean(result.stdout) : ''
}

async function runGit(ctx, cwd, args, timeoutMs = 2_500) {
  const subprocess = ctx.get('subprocess')
  if (subprocess && typeof subprocess.spawn === 'function') {
    try {
      return await runViaSubprocess(ctx, subprocess, cwd, args, timeoutMs)
    } catch {
      /* fall back to direct execFile */
    }
  }
  return runExecFile(cwd, args, timeoutMs)
}

function parseScopedValue(text) {
  const line = clean(text).split('\n').pop()
  if (!line) return null
  const tab = line.indexOf('\t')
  if (tab < 0) return { value: line, scope: '' }
  return { scope: line.slice(0, tab).trim(), value: line.slice(tab + 1).trim() }
}

function normalizeCwd(cwd) {
  if (typeof cwd !== 'string' || cwd.trim() === '') return ''
  return cwd.trim()
}

async function probeUncached(ctx, cwd) {
  const started = Date.now()
  const rootResult = await runGit(ctx, cwd, ['rev-parse', '--show-toplevel'])
  if (!rootResult.ok) {
    const reason = clean(rootResult.stderr) || clean(rootResult.error) || 'not a git repository'
    return {
      isGit: false,
      reason,
      root: null,
      name: '',
      durationMs: Date.now() - started,
    }
  }
  const root = clean(rootResult.stdout)
  if (!root) {
    return { isGit: false, reason: 'git returned an empty repository root', root: null, name: '', durationMs: Date.now() - started }
  }

  const [nameResult, emailResult, branchResult, remoteListResult, lastCommitResult] = await Promise.all([
    runGit(ctx, root, ['config', '--show-scope', '--get', 'user.name']),
    runGit(ctx, root, ['config', '--show-scope', '--get', 'user.email']),
    runGit(ctx, root, ['symbolic-ref', '--short', '-q', 'HEAD']),
    runGit(ctx, root, ['remote']),
    runGit(ctx, root, ['log', '-1', '--format=%h%x00%s%x00%an%x00%ct']),
  ])

  const name = nameResult.ok ? parseScopedValue(nameResult.stdout) : null
  const email = emailResult.ok ? parseScopedValue(emailResult.stdout) : null
  const symbolicBranch = branchResult.ok ? clean(branchResult.stdout) : ''
  let sha = ''
  if (!symbolicBranch) {
    const short = await runGit(ctx, root, ['rev-parse', '--short', 'HEAD'])
    sha = short.ok ? clean(short.stdout) : ''
  }

  const remotes = remoteListResult.ok ? clean(remoteListResult.stdout).split('\n').filter(Boolean) : []
  const remoteName = remotes.includes('origin') ? 'origin' : remotes[0] ?? ''
  const remoteUrlResult = remoteName ? await runGit(ctx, root, ['remote', 'get-url', remoteName]) : null

  let upstream = ''
  let ahead = null
  let behind = null
  const upstreamResult = await runGit(ctx, root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'])
  if (upstreamResult.ok) {
    upstream = clean(upstreamResult.stdout)
    if (upstream) {
      const counts = await runGit(ctx, root, ['rev-list', '--left-right', '--count', `HEAD...${upstream}`])
      if (counts.ok) {
        const [left, right] = clean(counts.stdout).split(/\s+/)
        ahead = Number.isFinite(Number(left)) ? Number(left) : null
        behind = Number.isFinite(Number(right)) ? Number(right) : null
      }
    }
  }

  let lastCommit = null
  if (lastCommitResult.ok) {
    const parts = clean(lastCommitResult.stdout).split('\u0000')
    if (parts.length >= 4) {
      lastCommit = {
        sha: parts[0],
        subject: parts[1],
        author: parts[2],
        time: Number(parts[3]) * 1000 || null,
      }
    }
  }

  return {
    isGit: true,
    reason: '',
    root,
    name: root.split(/[\\/]/).filter(Boolean).pop() ?? root,
    branch: symbolicBranch || null,
    detached: !symbolicBranch,
    sha: sha || lastCommit?.sha || '',
    identity: {
      name: name?.value ?? '',
      nameScope: name?.scope ?? '',
      email: email?.value ?? '',
      emailScope: email?.scope ?? '',
    },
    remote: {
      name: remoteName,
      url: remoteUrlResult?.ok ? clean(remoteUrlResult.stdout) : '',
    },
    upstream,
    ahead,
    behind,
    lastCommit,
    durationMs: Date.now() - started,
  }
}

/**
 * Probe one directory. Results are cached briefly; `force` skips the cache.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {string} cwd
 * @param {{ force?: boolean }} [options]
 */
export async function probeGit(ctx, cwd, options = {}) {
  const key = normalizeCwd(cwd)
  if (!key) {
    return { isGit: false, reason: 'empty working directory', root: null, name: '', durationMs: 0 }
  }
  const cached = cache.get(key)
  const now = Date.now()
  if (!options.force && cached && now - cached.at < CACHE_TTL_MS) return cached.promise
  const promise = probeUncached(ctx, key).catch((error) => ({
    isGit: false,
    reason: error instanceof Error ? error.message : String(error),
    root: null,
    name: '',
    durationMs: 0,
  }))
  cache.set(key, { at: now, promise })
  return promise
}

export function invalidateGitCache(cwd) {
  if (cwd) cache.delete(normalizeCwd(cwd))
  else cache.clear()
}

export function gitScopeLabel(scope) {
  switch (scope) {
    case 'local':
      return 'repo'
    case 'global':
      return 'global'
    case 'system':
      return 'system'
    case 'command':
      return 'command'
    default:
      return scope || 'unknown'
  }
}

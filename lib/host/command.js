/**
 * Shell/Git command parsing for the commit guard (F2.1–F2.4).
 *
 * The parser is deliberately conservative: it recognizes plain `git` commands,
 * `cd`-prefixed sequences, `VAR=value` prefixes, and nested `sh -c` / `bash -c`
 * strings. It never executes anything and never throws on malformed input.
 */

import path from 'node:path'

const SHELL_OPERATORS = new Set([';', '&&', '||', '|', '&', '\n'])
const SHELL_NAMES = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh'])
const GIT_GLOBAL_VALUE_FLAGS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path'])
const PREFIX_WORDS = new Set(['sudo', 'command', 'builtin', 'exec', 'nohup', 'time', 'env'])

/** Split a command line on unquoted top-level shell operators. */
export function splitSegments(command) {
  const text = typeof command === 'string' ? command : ''
  const segments = []
  let current = ''
  let quote = null
  let escape = false
  let depth = 0
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    if (escape) {
      current += char
      escape = false
      continue
    }
    if (char === '\\' && quote !== "'") {
      current += char
      escape = true
      continue
    }
    if (quote) {
      current += char
      if (char === quote) quote = null
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      current += char
      continue
    }
    if (char === '(' && text[i + 1] === '(') {
      depth += 1
      current += char
      continue
    }
    if (char === '(' && i > 0 && text[i - 1] === '$') {
      depth += 1
      current += char
      continue
    }
    if (char === ')' && depth > 0) {
      depth -= 1
      current += char
      continue
    }
    if (depth === 0 && SHELL_OPERATORS.has(char)) {
      // Consume the two-character operators as one separator.
      if ((char === '&' || char === '|') && text[i + 1] === char) {
        i += 1
      }
      if (current.trim()) segments.push(current.trim())
      current = ''
      continue
    }
    current += char
  }
  if (current.trim()) segments.push(current.trim())
  return segments
}

/** Tokenize one segment, removing quotes and keeping escaped characters. */
export function tokenize(segment) {
  const text = typeof segment === 'string' ? segment : ''
  const tokens = []
  let current = ''
  let quote = null
  let escape = false
  let has = false
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    if (escape) {
      current += char
      has = true
      escape = false
      continue
    }
    if (char === '\\' && quote !== "'") {
      escape = true
      continue
    }
    if (quote) {
      if (char === quote) {
        quote = null
      } else {
        current += char
      }
      has = true
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      has = true
      continue
    }
    if (/\s/.test(char)) {
      if (has) {
        tokens.push(current)
        current = ''
        has = false
      }
      continue
    }
    current += char
    has = true
  }
  if (has) tokens.push(current)
  return tokens
}

/** Extract heredoc bodies: `<<EOF`, `<<-EOF`, `<<'EOF'`, `<<"EOF"`. */
export function extractHeredocs(command) {
  const text = typeof command === 'string' ? command : ''
  const heredocs = []
  const lines = text.split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    const match = /<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/.exec(lines[index])
    if (!match) continue
    const delimiter = match[2]
    const body = []
    let cursor = index + 1
    for (; cursor < lines.length; cursor += 1) {
      const candidate = lines[cursor].replace(/\r$/, '')
      if (candidate.trim() === delimiter) break
      body.push(candidate)
    }
    if (cursor < lines.length) {
      heredocs.push({ delimiter, body: body.join('\n'), line: index })
      index = cursor
    }
  }
  return heredocs
}

function stripPrefixes(tokens) {
  let index = 0
  const env = {}
  while (index < tokens.length) {
    const token = tokens[index]
    if (PREFIX_WORDS.has(token)) {
      index += 1
      // `env` may be followed by assignments; the loop below handles them.
      continue
    }
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) {
      const eq = token.indexOf('=')
      env[token.slice(0, eq)] = token.slice(eq + 1)
      index += 1
      continue
    }
    break
  }
  return { argv: tokens.slice(index), env }
}

function valueAfter(args, index, flag) {
  const token = args[index]
  if (token === flag) {
    return args[index + 1] !== undefined ? { value: args[index + 1], next: index + 2 } : { value: null, next: index + 1 }
  }
  if (token.startsWith(`${flag}=`)) return { value: token.slice(flag.length + 1), next: index + 1 }
  return null
}

function parseCommitArgs(args, cwd, heredocs) {
  const op = {
    kind: 'commit',
    cwd,
    amend: false,
    noVerify: false,
    allowEmpty: false,
    messageParts: [],
    messageFile: null,
    reuseFrom: null,
    paths: [],
    heredoc: null,
    raw: '',
  }
  const messages = []
  let index = 0
  while (index < args.length) {
    const token = args[index]
    if (token === '--') {
      op.paths.push(...args.slice(index + 1))
      break
    }
    const longMessage = valueAfter(args, index, '--message')
    if (longMessage) {
      if (typeof longMessage.value === 'string') messages.push(longMessage.value)
      index = longMessage.next
      continue
    }
    if (token === '-m') {
      if (typeof args[index + 1] === 'string') messages.push(args[index + 1])
      index += 2
      continue
    }
    const longFile = valueAfter(args, index, '--file')
    if (longFile) {
      if (typeof longFile.value === 'string') op.messageFile = longFile.value
      index = longFile.next
      continue
    }
    if (token === '-F') {
      if (typeof args[index + 1] === 'string') op.messageFile = args[index + 1]
      index += 2
      continue
    }
    if (token === '--amend') {
      op.amend = true
      index += 1
      continue
    }
    if (token === '--no-verify' || token === '-n') {
      op.noVerify = true
      index += 1
      continue
    }
    if (token === '--allow-empty' || token === '--allow-empty-message') {
      op.allowEmpty = true
      index += 1
      continue
    }
    const reuse = valueAfter(args, index, '--reuse-message')
    if (reuse) {
      if (typeof reuse.value === 'string') op.reuseFrom = reuse.value
      index = reuse.next
      continue
    }
    if (token === '-C' || token === '-c') {
      if (typeof args[index + 1] === 'string') op.reuseFrom = args[index + 1]
      index += 2
      continue
    }
    if (/^-[A-Za-z]*[mF]$/.test(token)) {
      const flag = token[token.length - 1]
      const value = args[index + 1]
      if (flag === 'm' && typeof value === 'string') messages.push(value)
      if (flag === 'F' && typeof value === 'string') op.messageFile = value
      index += 2
      continue
    }
    if (/^-[A-Za-z]*[anqv]$/.test(token)) {
      if (token.includes('n')) op.noVerify = true
      index += 1
      continue
    }
    if (token.startsWith('-')) {
      index += 1
      continue
    }
    op.paths.push(token)
    index += 1
  }
  if (messages.length > 0) {
    const joined = messages.join('\n\n')
    if (joined.trim().startsWith('$(') || joined.trim().startsWith('`')) {
      const heredoc = heredocs.find((item) => item.body.trim() !== '')
      if (heredoc) op.heredoc = heredoc.body
    } else {
      op.messageParts = messages
    }
  }
  if (op.messageFile === '-' && heredocs.length > 0) {
    op.heredoc = heredocs[0].body
  }
  return op
}

function parseCheckout(args, cwd) {
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index]
    if (token === '-b' || token === '-B' || token === '--orphan') {
      const name = args[index + 1]
      if (typeof name === 'string' && name.trim() !== '') return { kind: 'create-branch', cwd, name: name.trim(), raw: '' }
    }
    if (token === '--') return null
    if (!token.startsWith('-')) return { kind: 'switch-branch', cwd, name: token.trim(), raw: '' }
  }
  return null
}

function parseSwitch(args, cwd) {
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index]
    if (token === '-c' || token === '-C' || token === '--create' || token === '--force-create') {
      const name = args[index + 1]
      if (typeof name === 'string' && name.trim() !== '') return { kind: 'create-branch', cwd, name: name.trim(), raw: '' }
    }
    if (token === '--detach' || token === '--orphan') return null
    if (!token.startsWith('-')) return { kind: 'switch-branch', cwd, name: token.trim(), raw: '' }
  }
  return null
}

function parseBranch(args, cwd) {
  const disallowed = new Set([
    '-d',
    '-D',
    '--delete',
    '-m',
    '-M',
    '--move',
    '-c',
    '-C',
    '--copy',
    '-l',
    '--list',
    '-a',
    '-r',
    '--all',
    '--remotes',
    '-v',
    '-vv',
    '--verbose',
    '--show-current',
    '-u',
    '--set-upstream-to',
    '-f',
    '--force',
  ])
  for (const token of args) {
    if (token === '--') break
    if (token.startsWith('-')) {
      if (disallowed.has(token)) return null
      continue
    }
    return { kind: 'create-branch', cwd, name: token.trim(), raw: '' }
  }
  return null
}

function parseWorktree(args, cwd) {
  if (args[0] !== 'add') return null
  for (let index = 1; index < args.length; index += 1) {
    const token = args[index]
    if (token === '-b' || token === '-B') {
      const name = args[index + 1]
      if (typeof name === 'string' && name.trim() !== '') return { kind: 'create-branch', cwd, name: name.trim(), raw: '' }
    }
  }
  return null
}

function parseGitArgs(args, baseCwd, raw, heredocs) {
  let cwd = baseCwd
  let index = 0
  while (index < args.length) {
    const token = args[index]
    const next = GIT_GLOBAL_VALUE_FLAGS.has(token) ? args[index + 1] : undefined
    if (token === '-C' || token.startsWith('-C=')) {
      const value = token === '-C' ? next : token.slice(3)
      if (typeof value === 'string' && value !== '') cwd = path.resolve(cwd, value)
      index += token === '-C' ? 2 : 1
      continue
    }
    if (GIT_GLOBAL_VALUE_FLAGS.has(token)) {
      index += 2
      continue
    }
    if (token.startsWith('-')) {
      index += 1
      continue
    }
    break
  }
  const subcommand = args[index]
  if (!subcommand) return []
  const rest = args.slice(index + 1)
  const base = { raw, cwd }
  if (subcommand === 'commit') {
    const op = parseCommitArgs(rest, cwd, heredocs)
    op.raw = raw
    return [op]
  }
  if (subcommand === 'checkout') {
    const op = parseCheckout(rest, cwd)
    if (op) op.raw = raw
    return op ? [op] : []
  }
  if (subcommand === 'switch') {
    const op = parseSwitch(rest, cwd)
    if (op) op.raw = raw
    return op ? [op] : []
  }
  if (subcommand === 'branch') {
    const op = parseBranch(rest, cwd)
    if (op) op.raw = raw
    return op ? [op] : []
  }
  if (subcommand === 'worktree') {
    const op = parseWorktree(rest, cwd)
    if (op) op.raw = raw
    return op ? [op] : []
  }
  if (subcommand === 'push') {
    return [{ kind: 'push', cwd, args: rest, raw }]
  }
  return []
}

const DANGER_PATTERNS = [
  { kind: 'ssh', re: /\bssh\s+(?!-)/, label: '通过 SSH 连接远程主机' },
  { kind: 'scp', re: /\b(?:scp|rsync)\s+/, label: '向远程主机传输文件' },
  { kind: 'kubectl', re: /\bkubectl\s+(?:delete|apply|replace|patch|edit|drain|cordon)\b/, label: '修改 Kubernetes 资源' },
  { kind: 'helm', re: /\bhelm\s+(?:upgrade|install|uninstall|rollback)\b/, label: '修改 Helm release' },
  { kind: 'terraform', re: /\bterraform\s+(?:apply|destroy|import)\b/, label: '修改 Terraform 基础设施' },
  { kind: 'docker', re: /\bdocker(?:\s+compose)?\s+(?:down|rm|system\s+prune)\b/, label: '删除容器或清理 Docker 资源' },
  { kind: 'cloud', re: /\b(?:aws|gcloud|az)\s+\S+\s+(?:delete|create|update|terminate)\b/, label: '修改云资源' },
  { kind: 'sql', re: /\b(?:drop\s+table|truncate\s+table|delete\s+from)\b/i, label: '执行破坏性数据库语句' },
  { kind: 'force-push', re: /\bgit\s+push\b[^\n]*\s(?:--force|-f)(?:\s|$)/, label: '强制推送 Git 历史' },
]

/**
 * Find Git operations and dangerous commands in a shell command string.
 * @param {string} command
 * @param {string} baseCwd
 * @returns {{ operations: Array<object>, dangers: Array<object> }}
 */
export function findGitOperations(command, baseCwd = process.cwd()) {
  const operations = []
  const dangers = []
  const text = typeof command === 'string' ? command : ''
  const heredocs = extractHeredocs(text)
  const segments = splitSegments(text)
  let cwd = baseCwd
  let lastSegment = ''
  for (const segment of segments) {
    lastSegment = segment
    const { argv } = stripPrefixes(tokenize(segment))
    if (argv.length === 0) continue
    if (argv[0] === 'cd') {
      const target = argv[1]
      if (typeof target === 'string' && target !== '' && !target.includes('$')) {
        cwd = path.resolve(cwd, target)
      }
      continue
    }
    if (SHELL_NAMES.has(argv[0])) {
      const flagIndex = argv.findIndex((token) => token === '-c' || /^-[A-Za-z]*c$/.test(token))
      if (flagIndex >= 0 && typeof argv[flagIndex + 1] === 'string') {
        const nested = findGitOperations(argv[flagIndex + 1], cwd)
        operations.push(...nested.operations)
        dangers.push(...nested.dangers)
        continue
      }
    }
    const gitIndex = argv.findIndex((token) => token === 'git' || token.endsWith('/git'))
    if (gitIndex >= 0) {
      const gitArgs = argv.slice(gitIndex + 1)
      const found = parseGitArgs(gitArgs, cwd, segment, heredocs)
      for (const op of found) {
        if (!op.raw) op.raw = segment
        operations.push(op)
      }
      for (const pattern of DANGER_PATTERNS) {
        if (pattern.re.test(segment)) {
          dangers.push({ kind: pattern.kind, label: pattern.label, cwd, raw: segment })
          break
        }
      }
      continue
    }
    for (const pattern of DANGER_PATTERNS) {
      if (pattern.re.test(segment)) {
        dangers.push({ kind: pattern.kind, label: pattern.label, cwd, raw: segment })
        break
      }
    }
  }
  return { operations, dangers }
}

/** Best-effort message for an operation, before reading files. */
export function operationMessage(op) {
  if (op.heredoc) return op.heredoc
  if (op.messageParts?.length > 0) return op.messageParts.join('\n\n')
  return null
}

export function shortCommand(text, limit = 180) {
  const value = String(text ?? '').replace(/\s+/g, ' ').trim()
  return value.length > limit ? `${value.slice(0, limit)}…` : value
}

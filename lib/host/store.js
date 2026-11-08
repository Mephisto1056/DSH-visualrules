/**
 * Durable plugin storage.
 *
 * The two tables are deliberately separate: a pack is stored once and referenced
 * by every workspace that enables it (F0.4), while personal/workspace state is
 * keyed by the Session's effective directory.
 */

import crypto from 'node:crypto'
import { z } from 'zod'
import { DOMAIN_NAME, DOMAIN_VERSION } from './constants.js'

const RULE_LEVEL = z.enum(['off', 'info', 'warn', 'block'])

const validationSchema = z
  .object({
    enabled: z.boolean().default(true),
    levels: z.record(z.string(), RULE_LEVEL).default({}),
    confirmDanger: z.boolean().default(false),
    trackCommits: z.boolean().default(true),
  })
  .strict()
  .default({})

const packSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    scope: z.enum(['personal', 'team', 'workspace']).default('personal'),
    description: z.string().default(''),
    content: z.string().default(''),
    globalEnabled: z.boolean().default(false),
    updated: z.number().default(0),
  })
  .strict()

const serverAccountSchema = z
  .object({
    user: z.string().default(''),
    keyRef: z.string().default(''),
  })
  .strict()

const workspaceSchema = z
  .object({
    path: z.string().min(1),
    gitName: z.string().default(''),
    gitEmail: z.string().default(''),
    environment: z.string().default(''),
    showServerInfo: z.boolean().default(false),
    injectRules: z.boolean().default(false),
    extraRules: z.string().default(''),
    enabledPacks: z.array(z.string()).default([]),
    disabledPacks: z.array(z.string()).default([]),
    servers: z.record(z.string(), serverAccountSchema).default({}),
    validation: validationSchema,
    updated: z.number().default(0),
  })
  .strict()

const commitSchema = z
  .object({
    hash: z.string().min(1),
    repo: z.string().default(''),
    branch: z.string().default(''),
    message: z.string().default(''),
    subject: z.string().default(''),
    sessionId: z.string().default(''),
    source: z.enum(['ai', 'hook', 'unknown']).default('ai'),
    command: z.string().default(''),
    authorName: z.string().default(''),
    authorEmail: z.string().default(''),
    committedAt: z.number().default(0),
    recordedAt: z.number().default(0),
  })
  .strict()

const bypassSchema = z
  .object({
    id: z.string().min(1),
    cwd: z.string().default(''),
    sessionId: z.string().default(''),
    reason: z.string().default(''),
    ruleIds: z.array(z.string()).default([]),
    createdAt: z.number().default(0),
    expiresAt: z.number().default(0),
    consumedAt: z.number().default(0),
    consumedBy: z.string().default(''),
  })
  .strict()

const eventSchema = z
  .object({
    id: z.string().min(1),
    cwd: z.string().default(''),
    sessionId: z.string().default(''),
    kind: z.enum(['block', 'warn', 'allow', 'bypass']).default('warn'),
    command: z.string().default(''),
    findings: z
      .array(
        z
          .object({
            id: z.string().default(''),
            level: z.string().default('warn'),
            title: z.string().default(''),
            message: z.string().default(''),
          })
          .strict(),
      )
      .default([]),
    createdAt: z.number().default(0),
  })
  .strict()

export const DOMAIN_SPEC = {
  name: DOMAIN_NAME,
  version: DOMAIN_VERSION,
  tables: {
    packs: { valueSchema: packSchema },
    workspaces: { valueSchema: workspaceSchema },
    commits: { valueSchema: commitSchema },
    bypasses: { valueSchema: bypassSchema },
    events: { valueSchema: eventSchema },
  },
}

function now() {
  return Date.now()
}

export function normalizeWorkspace(path, input = {}) {
  const value = input && typeof input === 'object' ? input : {}
  return {
    path,
    gitName: typeof value.gitName === 'string' ? value.gitName : '',
    gitEmail: typeof value.gitEmail === 'string' ? value.gitEmail : '',
    environment: typeof value.environment === 'string' ? value.environment : '',
    showServerInfo: value.showServerInfo === true,
    injectRules: value.injectRules === true,
    extraRules: typeof value.extraRules === 'string' ? value.extraRules : '',
    enabledPacks: Array.isArray(value.enabledPacks)
      ? [...new Set(value.enabledPacks.filter((id) => typeof id === 'string' && id !== ''))]
      : [],
    disabledPacks: Array.isArray(value.disabledPacks)
      ? [...new Set(value.disabledPacks.filter((id) => typeof id === 'string' && id !== ''))]
      : [],
    servers: value.servers && typeof value.servers === 'object' ? { ...value.servers } : {},
    validation: normalizeValidation(value.validation),
    updated: Number.isFinite(value.updated) ? value.updated : now(),
  }
}

export function normalizeValidation(input = {}) {
  const value = input && typeof input === 'object' ? input : {}
  const levels = {}
  if (value.levels && typeof value.levels === 'object') {
    for (const [id, level] of Object.entries(value.levels)) {
      if (RULE_LEVEL.safeParse(level).success) levels[id] = level
    }
  }
  return {
    enabled: value.enabled !== false,
    levels,
    confirmDanger: value.confirmDanger === true,
    trackCommits: value.trackCommits !== false,
  }
}

export function normalizePack(input = {}) {
  return {
    id: String(input.id ?? '').trim(),
    title: String(input.title ?? '').trim(),
    scope: input.scope === 'team' || input.scope === 'workspace' ? input.scope : 'personal',
    description: typeof input.description === 'string' ? input.description : '',
    content: typeof input.content === 'string' ? input.content : '',
    globalEnabled: input.globalEnabled === true,
    updated: Number.isFinite(input.updated) ? input.updated : now(),
  }
}

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function createStore(ctx) {
  let domain
  let closed = false
  let degraded = false
  let degradedReason = ''
  const memoryPacks = new Map()
  const memoryWorkspaces = new Map()
  const memoryCommits = new Map()
  const memoryBypasses = new Map()
  const memoryEvents = new Map()

  const ready = (async () => {
    let facility
    try {
      facility = ctx.get('storageDomain')
    } catch {
      facility = undefined
    }
    if (!facility || typeof facility.open !== 'function') {
      degraded = true
      degradedReason = 'storageDomain service is not mounted in this profile'
      return
    }
    let lastError
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const opened = await facility.open(DOMAIN_SPEC)
        if (closed) {
          await opened.close()
          break
        }
        domain = opened
        lastError = undefined
        break
      } catch (error) {
        lastError = error
        const code = error && typeof error === 'object' ? error.code : undefined
        if (code !== 'already-open') break
        // A previous plugin generation may still be closing its handle.
        await new Promise((resolve) => setTimeout(resolve, 80))
      }
    }
    if (lastError) {
      degraded = true
      degradedReason = lastError instanceof Error ? lastError.message : String(lastError)
      try {
        ctx.logger?.warn?.(`visualrules: domain storage unavailable (${degradedReason}); using memory only`)
      } catch {
        /* logging is best-effort */
      }
    }
  })()

  function packs() {
    if (domain) {
      return [...domain.table('packs').entries()].map(([, pack]) => pack)
    }
    return [...memoryPacks.values()]
  }

  function getPack(id) {
    if (domain) return domain.table('packs').get(id)
    return memoryPacks.get(id)
  }

  async function putPack(pack) {
    const value = normalizePack(pack)
    if (domain) {
      await domain.table('packs').put(value.id, value)
      return value
    }
    memoryPacks.set(value.id, value)
    return value
  }

  async function deletePack(id) {
    if (domain) return domain.table('packs').delete(id)
    return memoryPacks.delete(id)
  }

  function workspace(path) {
    if (domain) {
      const found = domain.table('workspaces').get(path)
      return found ? normalizeWorkspace(path, found) : normalizeWorkspace(path)
    }
    const found = memoryWorkspaces.get(path)
    return found ? normalizeWorkspace(path, found) : normalizeWorkspace(path)
  }

  function workspaces() {
    if (domain) {
      return [...domain.table('workspaces').entries()].map(([key, record]) => normalizeWorkspace(key, record))
    }
    return [...memoryWorkspaces.entries()].map(([key, record]) => normalizeWorkspace(key, record))
  }

  async function putWorkspace(path, patch) {
    const current = workspace(path)
    const value = normalizeWorkspace(path, { ...current, ...patch, updated: now() })
    if (domain) {
      await domain.table('workspaces').put(path, value)
      return value
    }
    memoryWorkspaces.set(path, value)
    return value
  }

  function tableEntries(name, memory) {
    if (domain) return [...domain.table(name).entries()].map(([, value]) => value)
    return [...memory.values()]
  }

  function commits(options = {}) {
    const limit = Number.isInteger(options.limit) ? Math.max(1, Math.min(500, options.limit)) : 50
    let list = tableEntries('commits', memoryCommits)
    if (options.repo) list = list.filter((item) => item.repo === options.repo)
    return list.sort((a, b) => b.committedAt - a.committedAt || b.recordedAt - a.recordedAt).slice(0, limit)
  }

  function getCommit(hash) {
    if (domain) return domain.table('commits').get(hash)
    return memoryCommits.get(hash)
  }

  async function putCommit(record) {
    const value = {
      hash: String(record.hash ?? '').trim(),
      repo: typeof record.repo === 'string' ? record.repo : '',
      branch: typeof record.branch === 'string' ? record.branch : '',
      message: typeof record.message === 'string' ? record.message.slice(0, 20_000) : '',
      subject: typeof record.subject === 'string' ? record.subject.slice(0, 300) : '',
      sessionId: typeof record.sessionId === 'string' ? record.sessionId : '',
      source: record.source === 'hook' || record.source === 'unknown' ? record.source : 'ai',
      command: typeof record.command === 'string' ? record.command.slice(0, 4_000) : '',
      authorName: typeof record.authorName === 'string' ? record.authorName.slice(0, 200) : '',
      authorEmail: typeof record.authorEmail === 'string' ? record.authorEmail.slice(0, 320) : '',
      committedAt: Number.isFinite(record.committedAt) ? record.committedAt : Math.floor(Date.now() / 1000),
      recordedAt: Number.isFinite(record.recordedAt) ? record.recordedAt : now(),
    }
    if (!value.hash) return null
    if (domain) {
      await domain.table('commits').put(value.hash, value)
      await prune('commits')
    } else {
      memoryCommits.set(value.hash, value)
      pruneMemory(memoryCommits, 500)
    }
    return value
  }

  async function deleteCommit(hash) {
    if (domain) return domain.table('commits').delete(hash)
    return memoryCommits.delete(hash)
  }

  async function clearCommits() {
    if (!domain) {
      memoryCommits.clear()
      return
    }
    for (const [key] of [...domain.table('commits').entries()]) await domain.table('commits').delete(key)
  }

  function bypasses(options = {}) {
    const now_ = Date.now()
    let list = tableEntries('bypasses', memoryBypasses)
    if (options.cwd) list = list.filter((item) => item.cwd === options.cwd)
    if (options.activeOnly) list = list.filter((item) => item.consumedAt === 0 && item.expiresAt > now_)
    return list.sort((a, b) => b.createdAt - a.createdAt).slice(0, Number.isInteger(options.limit) ? options.limit : 50)
  }

  function activeBypass(cwd, sessionId) {
    const now_ = Date.now()
    return bypasses({ cwd, activeOnly: true }).find(
      (item) => item.consumedAt === 0 && item.expiresAt > now_ && (!item.sessionId || !sessionId || item.sessionId === sessionId),
    )
  }

  async function putBypass(record) {
    const createdAt = now()
    const value = {
      id: crypto.randomUUID(),
      cwd: typeof record.cwd === 'string' ? record.cwd : '',
      sessionId: typeof record.sessionId === 'string' ? record.sessionId : '',
      reason: typeof record.reason === 'string' ? record.reason.slice(0, 500) : '',
      ruleIds: Array.isArray(record.ruleIds) ? [...new Set(record.ruleIds.filter((id) => typeof id === 'string'))].slice(0, 40) : [],
      createdAt,
      expiresAt: createdAt + (Number.isFinite(record.ttlMs) ? Math.min(60 * 60_000, Math.max(60_000, record.ttlMs)) : 10 * 60_000),
      consumedAt: 0,
      consumedBy: '',
    }
    if (domain) {
      await domain.table('bypasses').put(value.id, value)
      await prune('bypasses')
    } else {
      memoryBypasses.set(value.id, value)
      pruneMemory(memoryBypasses, 100)
    }
    return value
  }

  async function consumeBypass(id, patch = {}) {
    if (!id) return null
    const value = { ...(domain ? domain.table('bypasses').get(id) : memoryBypasses.get(id)), ...patch }
    if (!value || !value.id) return null
    if (!value.consumedAt) value.consumedAt = now()
    if (domain) await domain.table('bypasses').put(value.id, value)
    else memoryBypasses.set(value.id, value)
    return value
  }

  async function deleteBypass(id) {
    if (domain) return domain.table('bypasses').delete(id)
    return memoryBypasses.delete(id)
  }

  function events(options = {}) {
    let list = tableEntries('events', memoryEvents)
    if (options.cwd) list = list.filter((item) => item.cwd === options.cwd)
    if (options.sessionId) list = list.filter((item) => item.sessionId === options.sessionId)
    return list.sort((a, b) => b.createdAt - a.createdAt).slice(0, Number.isInteger(options.limit) ? options.limit : 50)
  }

  async function putEvent(record) {
    const value = {
      id: crypto.randomUUID(),
      cwd: typeof record.cwd === 'string' ? record.cwd : '',
      sessionId: typeof record.sessionId === 'string' ? record.sessionId : '',
      kind: ['block', 'warn', 'allow', 'bypass'].includes(record.kind) ? record.kind : 'warn',
      command: typeof record.command === 'string' ? record.command.slice(0, 4_000) : '',
      findings: Array.isArray(record.findings)
        ? record.findings.slice(0, 40).map((finding) => ({
            id: String(finding.id ?? ''),
            level: String(finding.level ?? 'warn'),
            title: String(finding.title ?? ''),
            message: String(finding.message ?? '').slice(0, 1_000),
          }))
        : [],
      createdAt: Number.isFinite(record.createdAt) ? record.createdAt : now(),
    }
    if (domain) {
      await domain.table('events').put(value.id, value)
      await prune('events')
    } else {
      memoryEvents.set(value.id, value)
      pruneMemory(memoryEvents, 1000)
    }
    return value
  }

  function pruneMemory(map, max) {
    if (map.size <= max) return
    const entries = [...map.entries()].sort(
      (a, b) => (a[1].createdAt ?? a[1].recordedAt ?? 0) - (b[1].createdAt ?? b[1].recordedAt ?? 0),
    )
    for (const [key] of entries.slice(0, map.size - max)) map.delete(key)
  }

  async function prune(name) {
    const table = domain.table(name)
    const entries = [...table.entries()]
    const max = name === 'events' ? 1_000 : name === 'bypasses' ? 100 : 500
    if (entries.length <= max) return
    entries.sort((a, b) => (a[1].createdAt ?? a[1].recordedAt ?? 0) - (b[1].createdAt ?? b[1].recordedAt ?? 0))
    for (const [key] of entries.slice(0, entries.length - max)) {
      try {
        await table.delete(key)
      } catch {
        /* best effort */
      }
    }
  }

  async function close() {
    if (closed) return
    closed = true
    if (domain) {
      try {
        await domain.close()
      } catch {
        /* close is best-effort during unload */
      }
      domain = undefined
    }
  }

  ctx.effect(
    () => () => {
      void close()
    },
    'visualrules: close storage domain',
  )

  return {
    ready,
    get degraded() {
      return degraded
    },
    get degradedReason() {
      return degradedReason
    },
    packs,
    getPack,
    putPack,
    deletePack,
    workspace,
    workspaces,
    putWorkspace,
    commits,
    getCommit,
    putCommit,
    deleteCommit,
    clearCommits,
    bypasses,
    activeBypass,
    putBypass,
    consumeBypass,
    deleteBypass,
    events,
    putEvent,
    close,
  }
}

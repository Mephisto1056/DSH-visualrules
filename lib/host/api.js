/** Client-callable Host API, mounted on the shared `/api` fetch handler. */

import { API_PREFIX, MAX_EXTRA_RULES, MAX_PACK_CONTENT } from './constants.js'
import { buildProfile, normalizeCwd, previewInjection } from './profile.js'
import { clearTeamConfigCache, findTeamConfigPath, loadTeamConfigSync, resolveTeamPacks, teamConfigTemplate } from './team-config.js'
import { invalidateGitCache, probeGit } from './git.js'
import { RULE_LEVELS, normalizeLevel } from './rules.js'
import { hookPreview, hookStatus, installHooks, uninstallHooks } from './hooks.js'

const PACK_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,119}$/

function json(value, status = 200) {
  return Response.json(value, {
    status,
    headers: { 'cache-control': 'no-store' },
  })
}

function ok(value) {
  return json({ ok: true, value })
}

function fail(code, message, details) {
  return json({ ok: false, error: { code, message, ...(details === undefined ? {} : { details }) } })
}

async function readBody(req) {
  try {
    const value = await req.json()
    return value && typeof value === 'object' ? value : {}
  } catch {
    return {}
  }
}

function resolveSession(ctx, sessionId) {
  if (typeof sessionId !== 'string' || sessionId === '') return null
  try {
    const agent = ctx.get('agents')?.get?.(sessionId)
    if (agent?.session) return agent
  } catch {
    /* service absent */
  }
  return null
}

function resolveTarget(ctx, body) {
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
  const agent = resolveSession(ctx, sessionId)
  let cwd = typeof body.cwd === 'string' ? body.cwd : ''
  let contextWindow = null
  if (!cwd && agent) {
    try {
      cwd = ctx.get('workingDirectory')?.get?.(agent.session) ?? ''
    } catch {
      cwd = ''
    }
  }
  if (!cwd && sessionId) {
    try {
      const session = ctx.get('sessions')?.get?.(sessionId)
      if (session) cwd = ctx.get('workingDirectory')?.get?.(session) ?? ''
    } catch {
      /* service absent */
    }
  }
  // No fallback directory: a request without a cwd or session must not read
  // a workspace it was not given. Routes that need one reject explicitly.
  if (agent) {
    try {
      contextWindow = ctx.get('tokenMeter')?.contextPressure?.(agent.session)?.contextWindow ?? null
    } catch {
      contextWindow = null
    }
  }
  return { sessionId, cwd: normalizeCwd(cwd), contextWindow }
}

function workspaceView(record) {
  const servers = record?.servers && typeof record.servers === 'object' ? record.servers : {}
  return {
    ...record,
    servers: record?.showServerInfo === true ? servers : {},
    serversConfigured: Object.keys(servers).length,
  }
}

function enabledIds(workspace, pack) {
  const enabled = new Set(workspace.enabledPacks ?? [])
  const disabled = new Set(workspace.disabledPacks ?? [])
  if (disabled.has(pack.id)) return false
  if (pack.scope === 'personal') return pack.globalEnabled === true || enabled.has(pack.id)
  return enabled.has(pack.id)
}

function validatePack(body) {
  const id = String(body.id ?? '').trim()
  const title = String(body.title ?? '').trim()
  const content = typeof body.content === 'string' ? body.content : ''
  const description = typeof body.description === 'string' ? body.description : ''
  if (!PACK_ID_RE.test(id)) {
    return { error: '规范包 id 只能包含字母、数字、点、下划线、斜杠和连字符，且以字母或数字开头' }
  }
  if (!title) return { error: '规范包标题不能为空' }
  if (title.length > 160) return { error: '规范包标题最多 160 个字符' }
  if (content.length > MAX_PACK_CONTENT) return { error: `规范包正文最多 ${MAX_PACK_CONTENT} 个字符` }
  if (description.length > 400) return { error: '规范包描述最多 400 个字符' }
  return { value: { id, title, content, description, globalEnabled: body.globalEnabled === true } }
}

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {{ store: ReturnType<import('./store.js').createStore>, validator: ReturnType<import('./guard.js').createValidator> }} deps
 */
export function registerApi(ctx, deps) {
  return ctx.inject(['connection'], (scoped) => {
    const { store } = deps
    const routes = []
    const connection = scoped.get('connection')
    const fetchHandler = connection?.fetch
    if (!fetchHandler || typeof fetchHandler.register !== 'function') {
      try {
        ctx.logger?.warn?.('visualrules: connection.fetch is unavailable; the Client API is disabled')
      } catch {
        /* logging is best-effort */
      }
      return () => {}
    }

  function route(pathname, handler, label) {
    let dispose
    try {
      dispose = scoped.effect(
        () =>
          fetchHandler.register(
            {
              path: `${API_PREFIX}${pathname}`,
              methods: ['POST'],
              requestBody: 'buffered',
              fetch: async (request) => {
                try {
                  return await handler(request)
                } catch (error) {
                  return fail('visualrules/internal', error instanceof Error ? error.message : String(error))
                }
              },
            },
            label,
          ),
        `visualrules: route ${pathname}`,
      )
    } catch (error) {
      try {
        ctx.logger?.warn?.(`visualrules: failed to register ${pathname}: ${error instanceof Error ? error.message : String(error)}`)
      } catch {
        /* logging is best-effort */
      }
      return () => {}
    }
    routes.push(dispose)
    return dispose
  }

  route(
    '/profile',
    async (request) => {
      const body = await readBody(request)
      const target = resolveTarget(ctx, body)
      if (!target.cwd) return fail('visualrules/invalid-workspace', '缺少工作区目录或会话')
      const profile = await buildProfile(ctx, deps, target.cwd, {
        force: body.force === true,
        contextWindow: target.contextWindow,
      })
      profile.sessionId = target.sessionId || ''
      return ok({ profile })
    },
    'visualrules: profile route',
  )

  route(
    '/preview',
    async (request) => {
      const body = await readBody(request)
      const target = resolveTarget(ctx, body)
      if (!target.cwd) return fail('visualrules/invalid-workspace', '缺少工作区目录或会话')
      await store.ready
      const profile = await buildProfile(ctx, deps, target.cwd, {
        force: body.force === true,
        contextWindow: target.contextWindow,
      })
      const team = loadTeamConfigSync(profile.config.path)
      const teamPacks = resolveTeamPacks(team.config, team.path)
      const workspace = store.workspace(profile.cwd)
      const result = previewInjection(store, team, teamPacks.packs, profile.cwd, workspace, {
        contextWindow: target.contextWindow,
        branch: profile.repo.branch ?? '',
      })
      return ok({
        cwd: profile.cwd,
        text: result.text,
        totalChars: result.totalChars,
        maxChars: result.maxChars,
        truncated: result.truncated,
        entries: result.entries,
        omitted: result.omitted,
        enabledPacks: profile.packs.enabled,
        warnings: profile.warnings,
      })
    },
    'visualrules: injection preview route',
  )

  route(
    '/library',
    async (request) => {
      const body = await readBody(request)
      const target = resolveTarget(ctx, body)
      await store.ready
      let profile = null
      let team = null
      let teamPacks = []
      if (target.cwd) {
        try {
          profile = await buildProfile(ctx, deps, target.cwd, {
            force: body.force === true,
            contextWindow: target.contextWindow,
          })
          team = loadTeamConfigSync(profile.config.path)
          teamPacks = resolveTeamPacks(team.config, team.path)
        } catch (error) {
          profile = null
          team = null
          teamPacks = []
        }
      }
      const personalPacks = store.packs().map((pack) => ({
        ...pack,
        scope: 'personal',
        chars: typeof pack.content === 'string' ? pack.content.length : 0,
        enabled: profile ? enabledIds(store.workspace(profile.cwd), pack) : pack.globalEnabled === true,
      }))
      const teamPacksView = teamPacks.packs.map((pack) => ({
        id: pack.id,
        title: pack.title,
        description: pack.description ?? '',
        scope: 'team',
        content: pack.content,
        source: pack.source,
        readonly: true,
        chars: pack.content.length,
        enabled: profile ? enabledIds(store.workspace(profile.cwd), { ...pack, scope: 'team' }) : false,
      }))
      return ok({
        profile,
        personalPacks,
        teamPacks: teamPacksView,
        workspaces: store.workspaces().map(workspaceView),
        teamConfig: team
          ? {
              path: team.path,
              exists: team.exists,
              status: team.status,
              errors: team.errors,
              warnings: team.warnings,
              packWarnings: teamPacks.warnings,
            }
          : null,
        template: teamConfigTemplate(),
        storage: {
          degraded: store.degraded,
          reason: store.degradedReason,
        },
        updatedAt: Date.now(),
      })
    },
    'visualrules: library route',
  )

  route(
    '/packs/save',
    async (request) => {
      const body = await readBody(request)
      await store.ready
      const validated = validatePack(body)
      if (validated.error) return fail('visualrules/invalid-pack', validated.error)
      const target = resolveTarget(ctx, body)
      const team = await teamConfigForCwd(ctx, target.cwd)
      if (team.config?.packs?.some((pack) => pack.id === validated.value.id)) {
        return fail('visualrules/team-pack-readonly', '团队规范包在仓库内定义，只能通过提交 .dsh 文件修改')
      }
      const existing = store.getPack(validated.value.id)
      const saved = await store.putPack({
        ...validated.value,
        scope: 'personal',
        globalEnabled: body.globalEnabled === undefined ? existing?.globalEnabled === true : body.globalEnabled === true,
        updated: Date.now(),
      })
      return ok({ pack: saved })
    },
    'visualrules: save pack route',
  )

  route(
    '/packs/delete',
    async (request) => {
      const body = await readBody(request)
      await store.ready
      const id = String(body.id ?? '').trim()
      if (!id) return fail('visualrules/invalid-pack', '缺少规范包 id')
      const target = resolveTarget(ctx, body)
      const team = await teamConfigForCwd(ctx, target.cwd)
      if (team.config?.packs?.some((pack) => pack.id === id)) {
        return fail('visualrules/team-pack-readonly', '团队规范包不能从个人规范库删除')
      }
      const deleted = await store.deletePack(id)
      return ok({ deleted })
    },
    'visualrules: delete pack route',
  )

  route(
    '/workspace/save',
    async (request) => {
      const body = await readBody(request)
      await store.ready
      const target = resolveTarget(ctx, body)
      if (!target.cwd) return fail('visualrules/invalid-workspace', '缺少工作区目录')
      if (typeof body.gitEmail === 'string' && body.gitEmail.length > 320) {
        return fail('visualrules/invalid-workspace', '邮箱过长')
      }
      if (typeof body.gitName === 'string' && body.gitName.length > 160) {
        return fail('visualrules/invalid-workspace', '用户名过长')
      }
      if (typeof body.extraRules === 'string' && body.extraRules.length > MAX_EXTRA_RULES) {
        return fail('visualrules/invalid-workspace', `工作区补充规范最多 ${MAX_EXTRA_RULES} 个字符`)
      }
      if (body.servers !== undefined && (body.servers === null || typeof body.servers !== 'object' || Array.isArray(body.servers))) {
        return fail('visualrules/invalid-workspace', 'servers 必须是对象')
      }
      const patch = {}
      for (const key of ['gitName', 'gitEmail', 'environment', 'extraRules']) {
        if (body[key] === undefined) continue
        if (typeof body[key] !== 'string') return fail('visualrules/invalid-workspace', `${key} 必须是字符串`)
        patch[key] = body[key].trim()
      }
      for (const key of ['showServerInfo', 'injectRules']) {
        if (body[key] !== undefined) patch[key] = body[key] === true
      }
      if (body.servers !== undefined) {
        const servers = {}
        for (const [name, raw] of Object.entries(body.servers).slice(0, 40)) {
          if (!raw || typeof raw !== 'object') continue
          const user = typeof raw.user === 'string' ? raw.user.trim().slice(0, 200) : ''
          const keyRef = typeof raw.keyRef === 'string' ? raw.keyRef.trim().slice(0, 200) : ''
          if (!user && !keyRef) continue
          servers[name.slice(0, 80)] = { user, keyRef }
        }
        patch.servers = servers
      }
      for (const key of ['enabledPacks', 'disabledPacks']) {
        if (body[key] === undefined) continue
        if (!Array.isArray(body[key])) return fail('visualrules/invalid-workspace', `${key} 必须是数组`)
        patch[key] = [...new Set(body[key].filter((id) => typeof id === 'string' && id.trim() !== '').map((id) => id.trim()))]
      }
      const record = await store.putWorkspace(target.cwd, patch)
      void deps.validator?.syncHookSnapshot?.(target.cwd, record).catch(() => {})
      return ok({ workspace: workspaceView(record) })
    },
    'visualrules: save workspace route',
  )

  route(
    '/workspace/toggle',
    async (request) => {
      const body = await readBody(request)
      await store.ready
      const target = resolveTarget(ctx, body)
      const id = String(body.packId ?? '').trim()
      if (!target.cwd || !id) return fail('visualrules/invalid-workspace', '缺少工作区目录或规范包 id')
      const enabled = body.enabled === true
      const current = store.workspace(target.cwd)
      const enabledPacks = new Set(current.enabledPacks)
      const disabledPacks = new Set(current.disabledPacks)
      if (enabled) {
        enabledPacks.add(id)
        disabledPacks.delete(id)
      } else {
        enabledPacks.delete(id)
        disabledPacks.add(id)
      }
      const record = await store.putWorkspace(target.cwd, {
        enabledPacks: [...enabledPacks],
        disabledPacks: [...disabledPacks],
      })
      return ok({ workspace: workspaceView(record) })
    },
    'visualrules: toggle pack route',
  )

  route(
    '/team/template',
    async () => ok({ template: teamConfigTemplate() }),
    'visualrules: team template route',
  )

  route(
    '/refresh',
    async (request) => {
      const body = await readBody(request)
      const target = resolveTarget(ctx, body)
      if (!target.cwd) return fail('visualrules/invalid-workspace', '缺少工作区目录或会话')
      clearTeamConfigCache()
      invalidateGitCache(target.cwd)
      const profile = await buildProfile(ctx, deps, target.cwd, { force: true, contextWindow: target.contextWindow })
      profile.sessionId = target.sessionId || ''
      return ok({ profile })
    },
    'visualrules: refresh route',
  )

  // -------------------------------------------------------------------
  // Validation, Git hooks, bypasses, and the AI commit index
  // -------------------------------------------------------------------

  route(
    '/validation/status',
    async (request) => {
      const body = await readBody(request)
      const target = resolveTarget(ctx, body)
      if (!target.cwd) return fail('visualrules/invalid-workspace', '缺少工作区目录或会话')
      await store.ready
      if (!deps.validator) return fail('visualrules/unavailable', '提交校验尚未挂载')
      const status = await deps.validator.status(target.cwd, target.sessionId)
      return ok(status)
    },
    'visualrules: validation status route',
  )

  route(
    '/validation/save',
    async (request) => {
      const body = await readBody(request)
      const target = resolveTarget(ctx, body)
      if (!target.cwd) return fail('visualrules/invalid-workspace', '缺少工作区目录')
      await store.ready
      const current = store.workspace(target.cwd)
      const next = { ...current.validation }
      if (body.enabled !== undefined) next.enabled = body.enabled === true
      if (body.confirmDanger !== undefined) next.confirmDanger = body.confirmDanger === true
      if (body.trackCommits !== undefined) next.trackCommits = body.trackCommits === true
      if (body.levels !== undefined) {
        if (body.levels === null || typeof body.levels !== 'object' || Array.isArray(body.levels)) {
          return fail('visualrules/invalid-validation', 'levels 必须是 { ruleId: level } 对象')
        }
        const levels = {}
        for (const [id, raw] of Object.entries(body.levels)) {
          const level = normalizeLevel(raw)
          if (!level) {
            return fail('visualrules/invalid-validation', `未知的校验级别 ${JSON.stringify(raw)}；允许 ${RULE_LEVELS.join(' / ')}`)
          }
          if (id.length > 80) return fail('visualrules/invalid-validation', '规则 id 过长')
          levels[id] = level
        }
        next.levels = levels
      }
      const record = await store.putWorkspace(target.cwd, { validation: next })
      void deps.validator?.syncHookSnapshot?.(target.cwd, record).catch(() => {})
      const status = deps.validator ? await deps.validator.status(target.cwd, target.sessionId) : null
      return ok({ workspace: workspaceView(record), status })
    },
    'visualrules: save validation route',
  )

  route(
    '/validation/check',
    async (request) => {
      const body = await readBody(request)
      const target = resolveTarget(ctx, body)
      if (!target.cwd) return fail('visualrules/invalid-workspace', '缺少工作区目录')
      if (!deps.validator) return fail('visualrules/unavailable', '提交校验尚未挂载')
      const result = await deps.validator.checkProposal({
        cwd: target.cwd,
        message: typeof body.message === 'string' ? body.message : undefined,
        branch: typeof body.branch === 'string' ? body.branch : undefined,
        command: typeof body.command === 'string' ? body.command : undefined,
      })
      return ok(result)
    },
    'visualrules: validation check route',
  )

  route(
    '/bypass/create',
    async (request) => {
      const body = await readBody(request)
      const target = resolveTarget(ctx, body)
      if (!target.cwd) return fail('visualrules/invalid-workspace', '缺少工作区目录')
      const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
      if (reason.length < 3) return fail('visualrules/invalid-bypass', '放行原因至少 3 个字符，并会记录在本机')
      if (reason.length > 500) return fail('visualrules/invalid-bypass', '放行原因最多 500 个字符')
      const ruleIds = Array.isArray(body.ruleIds)
        ? [...new Set(body.ruleIds.filter((id) => typeof id === 'string' && id.trim() !== ''))].slice(0, 40)
        : []
      const ttlMinutes = Number.isFinite(body.ttlMinutes) ? Math.max(1, Math.min(60, Math.floor(body.ttlMinutes))) : 10
      await store.ready
      const bypass = await store.putBypass({
        cwd: target.cwd,
        sessionId: target.sessionId || '',
        reason,
        ruleIds,
        ttlMs: ttlMinutes * 60_000,
      })
      return ok({ bypass })
    },
    'visualrules: create bypass route',
  )

  route(
    '/bypass/revoke',
    async (request) => {
      const body = await readBody(request)
      const id = String(body.id ?? '').trim()
      if (!id) return fail('visualrules/invalid-bypass', '缺少放行记录 id')
      await store.ready
      const deleted = await store.deleteBypass(id)
      return ok({ deleted })
    },
    'visualrules: revoke bypass route',
  )

  route(
    '/hook/status',
    async (request) => {
      const body = await readBody(request)
      const target = resolveTarget(ctx, body)
      if (!target.cwd) return fail('visualrules/invalid-workspace', '缺少工作区目录')
      const status = await hookStatus(target.cwd)
      return ok(status)
    },
    'visualrules: hook status route',
  )

  route(
    '/hook/preview',
    async () => ok(hookPreview()),
    'visualrules: hook preview route',
  )

  route(
    '/hook/install',
    async (request) => {
      const body = await readBody(request)
      const target = resolveTarget(ctx, body)
      if (!target.cwd) return fail('visualrules/invalid-workspace', '缺少工作区目录')
      await store.ready
      const workspace = store.workspace(target.cwd)
      const result = await installHooks(target.cwd, { workspace })
      if (result.ok) await deps.validator?.syncHookSnapshot?.(target.cwd, workspace)
      return ok(result)
    },
    'visualrules: install hooks route',
  )

  route(
    '/hook/uninstall',
    async (request) => {
      const body = await readBody(request)
      const target = resolveTarget(ctx, body)
      if (!target.cwd) return fail('visualrules/invalid-workspace', '缺少工作区目录')
      const result = await uninstallHooks(target.cwd)
      return ok(result)
    },
    'visualrules: uninstall hooks route',
  )

  route(
    '/commits/list',
    async (request) => {
      const body = await readBody(request)
      const target = resolveTarget(ctx, body)
      if (!target.cwd) return fail('visualrules/invalid-workspace', '缺少工作区目录')
      await store.ready
      let root = null
      try {
        const git = await probeGit(ctx, target.cwd)
        root = git.isGit ? git.root : null
      } catch {
        root = null
      }
      const limit = Number.isInteger(body.limit) ? body.limit : 50
      return ok({ commits: store.commits({ repo: root ?? '', limit }), repo: root })
    },
    'visualrules: commit index route',
  )

  route(
    '/commits/delete',
    async (request) => {
      const body = await readBody(request)
      const hash = String(body.hash ?? '').trim()
      if (!hash) return fail('visualrules/invalid-commit', '缺少提交 hash')
      await store.ready
      const deleted = await store.deleteCommit(hash)
      return ok({ deleted })
    },
    'visualrules: delete commit route',
  )

  route(
    '/commits/clear',
    async () => {
      await store.ready
      await store.clearCommits()
      return ok({ cleared: true })
    },
    'visualrules: clear commits route',
  )

  return () => {
    for (const dispose of routes.splice(0)) {
      try {
        dispose()
      } catch {
        /* route already disposed */
      }
    }
  }
  })
}

async function teamConfigForCwd(ctx, cwd) {
  if (!cwd) return loadTeamConfigSync(null)
  try {
    const git = await probeGit(ctx, cwd)
    return loadTeamConfigSync(findTeamConfigPath(cwd, git.isGit ? git.root : null))
  } catch {
    return loadTeamConfigSync(null)
  }
}

/**
 * Host half of DSH VisualRules.
 *
 * - serves the Client API over the shared `/api` fetch handler
 * - contributes one session-scoped system-prompt section per live Agent
 * - never modifies agents.md, the repository, or the user's Git config
 */

import {
  PROMPT_GUARD_SECTION_NAME,
  PROMPT_GUARD_SECTION_ORDER,
  PROMPT_SECTION_NAME,
  PROMPT_SECTION_ORDER,
} from './host/constants.js'
import { createStore } from './host/store.js'
import { registerApi } from './host/api.js'
import { findTeamConfigPath, loadTeamConfigSync, resolveTeamPacks } from './host/team-config.js'
import { probeGit } from './host/git.js'
import { composeInjection, promptBudget } from './host/injection.js'
import { branchOf, rememberRepo, repoRootOf } from './host/roots.js'
import { createValidator } from './host/guard.js'

function cwdOf(agent, workingDirectory) {
  try {
    const cwd = workingDirectory?.get?.(agent.session)
    return typeof cwd === 'string' ? cwd : ''
  } catch {
    return ''
  }
}

function environmentName(teamConfig, workspace) {
  return workspace?.environment || teamConfig?.environment || ''
}

export function apply(ctx) {
  const store = createStore(ctx)
  const validator = createValidator(ctx, { store })
  registerApi(ctx, { store, validator })

  const repoChecks = new Map()
  function ensureRepo(cwd) {
    if (!cwd) return Promise.resolve(null)
    if (repoRootOf(cwd) !== null) return Promise.resolve(repoRootOf(cwd))
    const existing = repoChecks.get(cwd)
    if (existing) return existing
    const promise = probeGit(ctx, cwd)
      .then((git) => {
        if (git?.isGit) rememberRepo(cwd, { root: git.root, branch: git.branch ?? '' })
        return git?.root ?? null
      })
      .catch(() => null)
      .finally(() => {
        repoChecks.delete(cwd)
      })
    repoChecks.set(cwd, promise)
    return promise
  }

  ctx.inject(['systemPrompt'], (scoped) => {
    const systemPrompt = scoped.get('systemPrompt')
    if (!systemPrompt || typeof systemPrompt.section !== 'function') return () => {}
    const workingDirectory = (() => {
      try {
        return ctx.get('workingDirectory')
      } catch {
        return undefined
      }
    })()
    const tokenMeter = (() => {
      try {
        return ctx.get('tokenMeter')
      } catch {
        return undefined
      }
    })()

    const disposers = new Map()
    const warned = new Set()

    function textFor(agent) {
      const cwd = cwdOf(agent, workingDirectory)
      if (!cwd) return ''
      try {
        const root = repoRootOf(cwd)
        if (!root) void ensureRepo(cwd)
        const configPath = findTeamConfigPath(cwd, root)
        const team = loadTeamConfigSync(configPath)
        const teamPackResult = resolveTeamPacks(team.config, team.path)
        const workspace = store.workspace(cwd)
        let contextWindow = null
        try {
          contextWindow = tokenMeter?.contextPressure?.(agent.session)?.contextWindow ?? null
        } catch {
          contextWindow = null
        }
        const result = composeInjection({
          cwd,
          teamConfig: team.config,
          configPath: team.path,
          teamPacks: teamPackResult.packs,
          workspace,
          personalPacks: store.packs(),
          maxChars: promptBudget(contextWindow),
          environment: environmentName(team.config, workspace),
          branch: branchOf(cwd),
        })
        return result.text
      } catch (error) {
        const key = error instanceof Error ? error.message : String(error)
        if (!warned.has(key)) {
          warned.add(key)
          try {
            ctx.logger?.warn?.(`visualrules: prompt composition failed: ${key}`)
          } catch {
            /* logging is best-effort */
          }
        }
        return ''
      }
    }

    function installAgent(agent) {
      if (!agent?.session || !agent.ctx) return
      const prompt = agent.ctx.systemPrompt
      if (!prompt || typeof prompt.section !== 'function') return
      const sessionId = agent.session.id
      if (disposers.has(sessionId)) return
      let dispose
      try {
        dispose = agent.ctx.effect(() => {
          const offRules = agent.ctx.systemPrompt.section({
            name: PROMPT_SECTION_NAME,
            order: PROMPT_SECTION_ORDER,
            interpolate: false,
            text: () => textFor(agent),
          })
          const offGuard = agent.ctx.systemPrompt.section({
            name: PROMPT_GUARD_SECTION_NAME,
            order: PROMPT_GUARD_SECTION_ORDER,
            interpolate: false,
            text: () => validator.promptText(sessionId, cwdOf(agent, workingDirectory)),
          })
          return () => {
            try {
              offRules()
            } catch {
              /* already disposed */
            }
            try {
              offGuard()
            } catch {
              /* already disposed */
            }
          }
        }, 'visualrules: session-scoped workspace rules')
      } catch (error) {
        try {
          ctx.logger?.warn?.(
            `visualrules: could not register the prompt section for ${sessionId}: ${error instanceof Error ? error.message : String(error)}`,
          )
        } catch {
          /* logging is best-effort */
        }
        return
      }
      disposers.set(sessionId, dispose)
      // Warm the repository cache for this directory; the prompt provider
      // stays synchronous and reads whatever is available at assembly time.
      void store.ready
        .then(() => ensureRepo(cwdOf(agent, workingDirectory)))
        .catch(() => {})
    }

    const offCreated = ctx.on('agent/created', ({ agent }) => {
      installAgent(agent)
    })

    // A plugin reload mid-session should reach already-live Agents too.
    try {
      const live = ctx.get('agents')?.list?.() ?? []
      for (const agent of live) installAgent(agent)
    } catch {
      /* the registry may not be mounted yet */
    }

    const offDisposed = ctx.on('agent/disposed', ({ agent }) => {
      const sessionId = agent?.session?.id
      if (!sessionId) return
      const dispose = disposers.get(sessionId)
      disposers.delete(sessionId)
      try {
        dispose?.()
      } catch {
        /* already disposed with the agent scope */
      }
    })

    const offSessionEvent = ctx.on('session/event', (_session, event) => {
      if (event?.type !== 'working-directory/change') return
      const cwd = event.data?.cwd
      if (typeof cwd !== 'string' || cwd === '') return
      void store.ready.then(() => ensureRepo(cwd)).catch(() => {})
    })

    return () => {
      try {
        offCreated()
      } catch {
        /* already removed */
      }
      try {
        offDisposed()
      } catch {
        /* already removed */
      }
      try {
        offSessionEvent()
      } catch {
        /* already removed */
      }
      for (const dispose of disposers.values()) {
        try {
          dispose()
        } catch {
          /* already disposed */
        }
      }
      disposers.clear()
    }
  })
}

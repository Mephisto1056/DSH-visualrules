# Architecture

VisualRules is one npm package with a Host half and a Client half. The Host owns files, Git probes, rules, storage, API routes, tools, and prompt sections; the Client renders native slots and talks to the Host over the plugin's `/api/visualrules/*` routes.

```
┌───────────────────────────── Client (plain JS, React via the loader) ─────────────────────────────┐
│ lib/client.js                                                                                     │
│  session header entry · right-sidebar tab · full page · settings section · quick-preview overlay  │
└───────────────────────────────────────────────┬───────────────────────────────────────────────────┘
                                                │ POST /api/visualrules/*
┌───────────────────────────────────────────────▼───────────────────────────────────────────────────┐
│ lib/index.js                                                                                      │
│  createStore(storageDomain)  ·  createValidator(ctx, { store })  ·  registerApi(ctx, { … })       │
│                                                                                                   │
│  lib/host/api.js        routes                                                                    │
│  lib/host/guard.js      tools/pre-execute · tools/result · visualrules_check · visualrules_status  │
│  lib/host/rules.js      pure rule engine                                                          │
│  lib/host/command.js    shell / Git parser                                                        │
│  lib/host/hooks.js      managed pre-commit / commit-msg                                            │
│  lib/host/sources.js    commitlint / editorconfig / eslint / docs                                  │
│  lib/host/team-config.js .dsh/profile.yaml (read-only, line-aware)                                 │
│  lib/host/profile.js    assembled profile                                                         │
│  lib/host/injection.js  layered prompt composer and budget                                         │
│  lib/host/git.js        read-only Git probes (subprocess service or execFile)                      │
│  lib/host/store.js      packs · workspaces · commits · bypasses · events                           │
│  lib/host/roots.js      directory → repository cache                                               │
└───────────────────────────────────────────────┬───────────────────────────────────────────────────┘
                                                │
                                   ~/.dsh/storages/dsh_visualrules.json
```

## Data flow

### Profile request

1. Client resolves the target `{ cwd, sessionId }` from the slot props or the main panel's retained session.
2. `POST /profile` → `resolveTarget` → `buildProfile`.
3. `buildProfile` probes Git (4s cache), loads the nearest team config, resolves team packs, reads the personal workspace record, composes injection, and returns warnings + `badgeCount`.
4. Only the sanitized personal record is returned; `servers` is omitted unless `showServerInfo` is enabled.

### Commit guard

1. A `bash` tool call reaches `tools/pre-execute`.
2. `findGitOperations` extracts commit / branch-create / branch-switch / push operations and dangerous patterns.
3. For each commit, the validator probes Git, loads the team config and discovered sources, resolves the message (`-m`, `-F`, heredoc, `--amend`, `-C`), and evaluates the rules.
4. `block` → `{ kind: 'deny', reason }`; the reason is rendered to the model and the event is persisted. `ask` (prod danger) → DSH approval. Otherwise the call proceeds.
5. A monotonic `tools.guard()` repeats a cached denial if another waterfall listener tries to replace the decision.
6. `tools/result` observes a successful shell call, reads the new HEAD, and writes the local AI commit index.

### Injection

1. `agent/created` installs two prompt sections on the Agent scope.
2. Before each model step, the sections call the composer with the current directory.
3. The composer reads team config + packs + personal packs + supplement, budgets, and returns text.
4. The commit-feedback section carries only recent guard findings.

## Storage

The domain name is `dsh_visualrules`, version 1:

| Table | Key | Purpose |
| --- | --- | --- |
| `packs` | pack id | Personal rule packs (one copy, many workspaces). |
| `workspaces` | resolved directory | Personal settings, pack enablement, validation overrides, servers. |
| `commits` | full hash | Local AI commit index. |
| `bypasses` | uuid | One-time user bypasses with TTL and consumption. |
| `events` | uuid | Recent validation events (block/warn/allow/bypass). |

Reads are synchronous from the validated in-memory state; writes are durable before the promise resolves. Records are pruned to bounded sizes (500 commits, 100 bypasses, 1,000 events). The storage is a plain JSON file when the JSON backend is mounted (`~/.dsh/storages/dsh_visualrules.json`), so all of it is local and none of it enters Git.

If the storage domain cannot open, the plugin runs in a memory-only degraded mode that is surfaced in the UI. It never blocks a commit or a model request because of storage.

## UI seats

| Slot | Registration | Purpose |
| --- | --- | --- |
| `conversation.session.header.utilities` | `order: -20` | Shield, environment dot, warning badge, quick-preview toggle. |
| `sidebarRightTabs` | `register({ id: 'visualrules' })` | Native right-sidebar tab type. |
| `sidebar.right.pane.tab` / `.title` | key `visualrules` | Quick preview body and title. |
| `shell.overlay` | fallback | Same preview when the right sidebar is unavailable. |
| `sidebar.panellist` + `main` | panel key `visualrules` | Full profile page. |
| `settings.section` | section id `visualrules` | Settings page. |

The Client uses theme tokens only (`--dsw-alias-*`), registers its own CSS once, and never imports a Harness Client package. All controls (switch, select, notice, cards) are local implementations matching the host look.

## Deliberate constraints

- No writes to `agents.md`, session logs, Git config, or repository content (hooks excepted, opt-in).
- No new session event type; feedback to the model travels through prompt sections.
- No network requests; Git is read through the Host `subprocess` service when present, falling back to `execFile`.
- No secrets: server records contain a login name and a key reference name.
- Failure policy: fail open for enforcement, degrade to display for inspection. A plugin bug must not stop a commit, a model step, or DSH startup.

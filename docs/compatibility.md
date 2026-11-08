# Compatibility

## DSH

| Plugin line | DSH line | Notes |
| --- | --- | --- |
| `0.2.x` | **0.2.2-rc.1+** | Current. Adds commit validation, tools, and Git hooks on the 0.2.2 service surface. |
| `0.1.x` | 0.2.0 – 0.2.1 | Profile, packs, injection, sidebar preview only. Not published separately. |

The plugin declares `engines.dsh` in `package.json`. DSH's installer rejects a version it cannot satisfy; an old host should either upgrade or pin the matching plugin version. A `0.x` caret never spans a minor version, so one plugin build cannot serve two host lines.

### What is used from the host

- `systemPrompt.section()` — per-Agent prompt sections.
- `tools/pre-execute`, `tools/result` — commit guard and AI index.
- `tools.register()`, `tools.guard()` — pre-flight tool and order-independent denial.
- `storageDomain.open()` — five local tables.
- `connection.fetch.register()` — plugin API routes.
- `sidebarRightTabs`, `slots`, `locale`, `layout` — native UI.
- `subprocess` when mounted, for Git probes; otherwise `execFile`.

All are looked up defensively. A profile without one of the optional services keeps the plugin active and degrades the corresponding feature.

## Node.js

- Plugin: Node 20+ (DSH ships its own runtime).
- Git hooks: `node` must be on `PATH`. If it is missing, the hook prints a warning and exits 0 rather than blocking a commit.
- Tests: `node --test` on Node 20 / 22.

## Platforms

| Platform | Status |
| --- | --- |
| macOS | Daily development target. |
| Linux | CI runner; hook scripts use POSIX `sh`. |
| Windows | Git Bash hook execution; the UI follows the desktop web host. Native Windows shells are not the hook target. |

## Versioning and data

- Plugin version follows semver for user-visible behavior.
- Storage domain version is `1`. New tables were added within version 1 and older records are accepted with defaults.
- Uninstalling the plugin leaves the storage file in place. Delete `~/.dsh/storages/dsh_visualrules.json` (or use the DSH storage tooling) if you want a full reset.
- Git hooks are independent of plugin installation and must be uninstalled explicitly (`Validation → Git hooks` or `node scripts/hooks.mjs uninstall`).

## Upgrade checklist

1. Back up `.dsh/profile.yaml` and any personal rule packs you rely on.
2. Update the plugin through `dsh plugin` or `plugin_manager`.
3. Hard-refresh the browser.
4. Open **Validation** and confirm rule levels and hook status.
5. If the hook reports `stale`, reinstall it so the checker path points at the current package.

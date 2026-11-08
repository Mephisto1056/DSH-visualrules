# Repository rules

These rules apply to every change in this repository. User-facing behavior is documented in `README.md` / `README_ZH.md`; deeper notes are in `docs/`.

## Branches and PRs

- `main` is the release branch. Develop on `feat/*`, `fix/*`, `docs/*`, `test/*`, `chore/*` and open a PR.
- Do not force-push `main`.
- Docs-only changes may go directly to `main` with review when the repository owner is the author.
- The plugin's own commit guard may block a commit on `main` if this repository ever ships a `.dsh/profile.yaml`; use a feature branch.

## Gates

| Change | Must run |
| --- | --- |
| Any code change | `npm run verify` |
| Rule engine / parser | `npm run verify` + the new case must fail without the change |
| Hook installer / runner | `npm run verify` (temporary real repositories) |
| Client UI | `npm run verify`; describe the real-Harness check |
| Storage schema | `npm run verify`; confirm old records still load |
| Manifest / export surface | `npm run check` |
| Docs | at least a link check and a read-through |

## Hard constraints

- **Never modify DSH source.** Use documented Host services, events, and slots.
- **Never write `agents.md`, the session log, Git config, or repository content** outside the opt-in hooks.
- **Never add a secret field.** Server records carry a user and a key reference name only.
- **Enforcement must fail open.** If rule evaluation, storage, Git probing, or the hook runner fails, allow the commit and print a diagnostic. Never block a user because the plugin itself broke.
- **Client code is plain JavaScript.** Do not import a Harness Client package; use `require('react')` from the loader and local controls.
- **Client styling uses theme tokens.** `--dsw-alias-*` only for UI; literal colours are for artwork under `docs/screenshots/`.
- **No new session event types.** Model feedback travels through prompt sections.
- **Bounded caches.** Every map or table has a size cap and an eviction policy.
- **No build step unless it is truly needed.** The package ships source ESM.

## Release

- Version is bumped in `package.json` (and lockfile) and documented in `CHANGELOG.md`.
- `npm pack --dry-run` is inspected before publishing.
- A release note states what changed, the verification run, and any compatibility move.
- See [docs/release.md](docs/release.md).

## Language

- Code comments and docs are English.
- User-facing strings exist in both `locale/zh.json` and `locale/en.json`; Client dictionaries carry both.
- Model-facing rejection text is Chinese-first with stable rule ids, because the primary audience is Chinese-speaking teams; rule ids keep it machine-greppable.

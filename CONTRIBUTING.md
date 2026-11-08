# Contributing

Thanks for taking the time to improve dsh-visualrules. This project is a DSH plugin, so correctness is judged on a real Harness as well as in unit tests.

## Before you start

- Open an issue for a behavior change or a new rule. Small fixes can go straight to a PR.
- Read [AGENTS.md](./AGENTS.md) — it lists the repository rules that matter during review.
- Check the current DSH baseline in [docs/compatibility.md](./docs/compatibility.md).

## Development setup

```sh
git clone https://github.com/Mephisto1056/DSH-visualrules.git
cd DSH-visualrules
npm install
npm run verify
```

`npm run verify` runs the syntax/manifest check and the full Node test suite. No build step is required: the package ships plain ESM and the Client is a single plain-JavaScript module.

### Install into a scratch profile

```sh
dsh plugin --profile <profile> add /absolute/path/to/DSH-visualrules
```

After changing `lib/client.js`, hard-refresh the page. After changing Host code, reload the plugin row (disable + enable) so a new module generation is loaded.

## Making a change

1. Branch from `main`: `feat/<topic>`, `fix/<topic>`, `docs/<topic>`, `test/<topic>`.
2. Keep the change focused; do not mix formatting-only edits with behavior.
3. Add a test that fails without your change. The suites live in `test/`:
   - `rules.test.mjs` — pure rule engine
   - `command.test.mjs` — shell/Git parsing
   - `sources.test.mjs` — commitlint / editorconfig / docs discovery
   - `hooks.test.mjs` — managed Git hooks in a real temporary repository
   - `guard.test.mjs` — `tools/pre-execute`, bypass, AI index
   - `api.test.mjs` — every Client route through the plugin entry
   - `client-ui.test.mjs` — server-renders the Client module and the new Validation surfaces
   - `profile.test.mjs`, `injection.test.mjs`, `team-config.test.mjs`
4. Update documentation when a user-visible behavior or field changes:
   - `README.md` / `README_ZH.md` for the headline behavior
   - `docs/configuration.md` for fields
   - `docs/commit-validation.md` for rules and coverage
   - `CHANGELOG.md` under `[Unreleased]`
5. Run `npm run verify` before pushing.

## Commit messages

Use Conventional Commits: `feat: …`, `fix: …`, `docs: …`, `test: …`, `chore: …`. A body is welcome for behavior changes. The plugin's own guard may block a commit on a protected branch; use a feature branch, as the plugin asks.

## Pull requests

A PR should state:

- the problem and the intended behavior;
- the surfaces affected (Host API, guard, hooks, Client slot, storage);
- the tests run, and what was verified on a real Harness;
- any compatibility or security consequence.

Reviewers check that enforcement failures fail open, that the repository is never written outside the opt-in hooks, and that no secret can end up in storage or a prompt.

## Reporting bugs

Use the issue template and include:

- DSH version, plugin version, OS, and Node version;
- the workspace type (Git / non-Git, monorepo, worktree);
- the exact commit command or UI action;
- what you expected and what happened;
- whether a Git hook was installed.

Do not paste tokens, private keys, or customer data. Redact paths if needed.

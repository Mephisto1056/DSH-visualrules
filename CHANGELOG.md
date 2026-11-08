# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Planned

- Multi-document rule packs.
- Git graph evaluation as a separate product.
- SVN adapter behind an optional layer.

## [0.2.0] — 2026-11-09

### Added

- **Commit validation engine** (`commit.format`, `commit.type`, `commit.scope`, `commit.headerLength`, `commit.issue`, `commit.mergeMessage`, `identity.email`, `identity.missing`, `branch.protected`, `branch.pattern`, `branch.detached`, `commit.messageMissing`, `commit.noVerify`, `commit.amend`) with per-workspace `off / info / warn / block` levels.
- **Tool-layer commit guard** on `tools/pre-execute`: AI-issued `git commit` and branch creation are validated before execution, and the denial carries the rule id, source, and a concrete fix back to the model.
- **Shell/Git command parser** covering `-m`, multiple `-m`, `-F`, heredocs, `--amend`, `--no-verify`, `git -C`, `cd`, prefix assignments, nested `sh -c`, branch creation/switching, and dangerous-command patterns.
- **Optional managed Git hooks** (`pre-commit`, `commit-msg`) with preview, backup/chaining of existing hooks, `core.hooksPath` containment, and clean uninstall. Standalone runner in `lib/hook/check.mjs`; CLI in `scripts/hooks.mjs`.
- **User-only one-time bypass** with reason and TTL, consumed by the next matching commit and kept in a local audit list. The agent has no bypass tool.
- **AI commit index** fed by `tools/result`; records repository, branch, author, message, and full hash locally.
- **Model tools** `visualrules_check` (pre-flight) and `visualrules_status` (read-only summary).
- **Existing rule sources** (F4.7): static commitlint discovery (JSON / YAML / JS), `.editorconfig`, eslint, `CONTRIBUTING.md`, and PR template.
- **Validation UI tab** with rule levels, hook card, bypass form, pre-flight check, recent events, AI commit index, and discovered sources.
- **Dangerous production command confirmation** (`validation.confirmDanger`) using DSH's approval service.
- English and Chinese dictionaries for the new surfaces.

### Changed

- Server information is now omitted from profile and library responses unless `showServerInfo` is explicitly enabled; enabling it asks for confirmation in the UI.
- The profile page gained a **Validation** tab; the Settings page exposes the same panel.
- The plugin now declares `engines.dsh` and release metadata for public distribution.
- The repository gained a public README, docs, CI, issue/PR templates, and contribution/security policies.

### Fixed

- A combined `git switch -c feature && git commit` command is now validated against the new branch, not the branch the shell started on; `git switch main && git commit` is blocked from a feature branch.
- A Git email mismatch is only reported when a personal expectation is configured; empty name/email is reported separately as `identity.missing`.
- Empty or unparsable commit messages are reported as `commit.messageMissing` instead of silently passing.

### Security

- Rule packs, personal settings, bypasses, events, and commits stay in the DSH local storage domain.
- The team configuration remains read-only; hooks are the only repository write and are explicit and reversible.
- Hook execution fails open when the checker or Node.js is missing.

### Verification

- 73 automated tests across rules, command parsing, sources, hooks, guard behavior, API routes, profile assembly, and injection.
- Real-host smoke on DSH 0.2.2-rc.1 (desktop profile):
  - a protected-branch commit through the tool layer is denied with the expected text;
  - `git switch -c feature/... && git commit` succeeds;
  - the commit appears in the AI index and via `visualrules_status`;
  - the commit-feedback prompt section appears after a block and disappears after success.

## [0.1.0] — 2026-11-08

### Added

- Workspace profile: Git identity and source, environment level, branch/remote/upstream/ahead-behind, last commit, team and developer information, server information behind an explicit switch.
- Team configuration `.dsh/profile.yaml` with line-aware validation and warnings.
- Personal/workspace layer in DSH storage.
- Rule pack library with per-workspace enablement, global defaults, and team packs.
- Session-scoped injection through `systemPrompt.section()` with layered composition, context-window budget, truncation reporting, and a live preview.
- Session-header entry, right-sidebar native tab, full profile page, settings section, and overlay fallback.
- JSON API under `/api/visualrules/*`, Client and Host halves, English/Chinese UI.
- 19 automated tests.

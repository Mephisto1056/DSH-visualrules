# Commit validation

VisualRules checks a commit in two independent places. Together they cover the normal paths, and the UI states plainly what they cannot cover.

```
AI model
  │  bash: git commit -m "…"
  ▼
tools/pre-execute  ── rule engine ──► deny + reason (model reads it next step)
  │ allow
  ▼
shell runs git commit
  │
  ▼
repository hooks (optional)
  pre-commit  → identity, branch, protected branch
  commit-msg  → message rules
  │
  ▼
commit created
  │
  ▼
tools/result observes success → local AI commit index
```

## What is checked

The pure rule engine lives in `lib/host/rules.js`; the same functions power the guard, the hooks, the UI check form, and the tests.

| Rule | Default | Trigger |
| --- | --- | --- |
| `identity.email` | warn | A personal expected email is set and differs from the repository's effective `user.email`. |
| `identity.missing` | warn | Effective `user.name` or `user.email` is empty. |
| `branch.protected` | block | Current branch matches a glob in `git.protected_branches`. |
| `branch.pattern` | warn | Branch does not match `git.branch_pattern`. |
| `branch.detached` | warn | HEAD is detached. |
| `commit.format` | block | Header does not match `conventional` or the configured regex. When commitlint provides `type-enum`/`scope-enum` and no format is set, conventional parsing is used. |
| `commit.type` | block | Parsed type is not in `allowed_commit_types` / commitlint `type-enum`. |
| `commit.scope` | warn | Parsed scope is not in commitlint `scope-enum`. |
| `commit.headerLength` | warn | Header exceeds `header_max_length` / commitlint `header-max-length`. |
| `commit.issue` | block | `require_issue: true` and the message does not match `issue_pattern` (default `#123` / `PROJ-42`). |
| `commit.messageMissing` | warn | The command exposes no message (`-m`, `-F`, heredoc, `--amend`, `-C`). |
| `commit.mergeMessage` | warn | A `Merge …` subject under `merge_strategy: squash`. |
| `commit.noVerify` | warn | The command carries `--no-verify`; hooks are skipped. |
| `commit.amend` | info | The command rewrites the previous commit. |

Each rule can be `off`, `info`, `warn`, or `block`. Only `block` rejects. Defaults are in `RULE_DEFS`; a workspace override in `validation.levels` replaces the default for that workspace. `validation.enabled: false` disables the whole engine.

## What the command parser understands

`lib/host/command.js` is a conservative shell scanner, not a shell:

- `git commit` with `-m`, `--message`, multiple `-m`, `-F file`, `-F -` + heredoc, `--amend`, `--no-verify`, `-a`, combined short flags such as `-am`.
- `git -C <dir>`, `cd <dir> && …`, leading `VAR=value`, `sudo` / `env` / `command` prefixes.
- `sh -c` / `bash -lc` nested strings (one level of recursion).
- `git checkout -b`, `git switch -c/-C`, `git branch <name>`, `git worktree add -b`.
- Branch switches (`git switch <name>`, `git checkout <name>`) earlier in the same command line, so `git switch -c feature/x && git commit …` is validated against `feature/x`, not the branch the command started on.
- Dangerous-command patterns for `prod` confirmation: SSH, scp/rsync, kubectl mutations, helm, terraform, docker cleanup, cloud mutations, destructive SQL, force push.

It deliberately ignores prose: `echo "git commit"` and `git log --grep="git commit"` are not treated as commits. If a command is too exotic to parse, the guard fails **open** (allows) and logs a warning; the Git hook is still available.

## Model-facing rejection (F2.8)

A block returns this shape to the model:

```text
Git 提交被 DSH VisualRules 拦截（1 条阻断、1 条警告）。

1. [branch.protected] 受保护分支
   当前分支 main 命中受保护规则 main，团队约定不允许直接提交。
   来源：.dsh/profile.yaml
   修正：创建特性分支（例如 git switch -c feature/<name>）后提交，并通过 PR/MR 合并。
2. [identity.email] Git 邮箱不一致
   …

如何处理：
- 按上面的「修正」改完后重新执行提交命令；不要使用 --no-verify 绕过。
- 只有用户明确同意例外时，才请用户在 DSH「工作区规范 → 校验」中点击「临时放行」，然后重试。
- 也可以先调用 visualrules_check 工具校验拟用的提交信息与分支。
```

The same findings are recorded as a local event and summarized in a short prompt section for the next model step (`visualrules:commit-feedback`). The section disappears naturally as the session moves on; it never rewrites history.

## Model-facing tools

### `visualrules_check`

Pre-flight without executing Git.

| Parameter | Meaning |
| --- | --- |
| `message` | Proposed commit message. |
| `branch` | Proposed branch. |
| `command` | A full shell command; the guard parser extracts the commit/branch operations. |
| `cwd` | Defaults to the session directory. |

Returns `{ blocked, findings, text, branch, message }`. The rendered result is the human-readable text, so the model can reason about it immediately.

### `visualrules_status`

Read-only summary: enabled state, effective rules, hook installation, active bypasses, recent event count, AI commit index. Returns the text plus structured counts and the latest commits.

## One-time bypass (F2.7)

Bypass is a **user action only**:

1. The model is blocked.
2. The user opens **Validation → One-time bypass**, writes a reason (≥ 3 characters), picks 5 / 10 / 30 minutes, and creates it.
3. The next matching commit is allowed; the record is consumed and the warning text carries the reason.
4. The record remains in the local “used bypass” list for audit.

There is no agent tool to create, extend, or consume a bypass. The reason and timestamps live in the local storage domain, never in the repository.

## Git hooks (F2.9)

The plugin installs two managed hooks:

| Hook | Checks |
| --- | --- |
| `pre-commit` | identity, protected branch, branch pattern, detached HEAD (message skipped) |
| `commit-msg <file>` | the same branch/identity checks plus message rules |

Installation rules:

- Explicit and reversible. The UI previews the exact content before writing.
- An existing hook is renamed to `<name>.dsh-visualrules-original`, and the managed wrapper runs it first.
- `core.hooksPath` is honored only when it resolves inside the repository; otherwise installation is refused.
- The hook runner reads `.git/hooks/dsh-visualrules.json` written by the plugin (levels, expected email/name). Without a snapshot, defaults and team rules still apply.
- If the checker path or `node` is missing, the hook prints a warning and exits 0. A missing plugin must never brick a commit.
- Uninstall removes only managed files and restores the backups.

```sh
node scripts/hooks.mjs status
node scripts/hooks.mjs install
node scripts/hooks.mjs uninstall
```

### Coverage statement

| Path | Covered | Why |
| --- | --- | --- |
| Agent `git commit` through the tool layer | tool guard | The reason is returned to the model. |
| Terminal, IDE, scripts, delayed jobs | Git hooks | The only place that sees every commit before it is created. |
| `git commit --no-verify` | **neither layer** | The hook cannot run; the tool guard still sees the literal command. |
| Another machine, server-side settings | **neither layer** | Local tooling cannot govern them. |

Local validation is an assistant. Server-side branch protection and CI remain the authority.

## Dangerous command confirmation (F2.5)

Opt-in per workspace (`validation.confirmDanger`). When the environment resolves to `prod`/`danger`, commands matching the destructive patterns return an `ask` decision through DSH's approval service. Declining the approval cancels the call. This is independent of commit rules and only applies to the tool layer.

## Performance and failure policy

- The guard has a short Git probe cache (4 seconds). A failed probe degrades to “not a Git repository” and allows the command.
- Rule evaluation is synchronous, local, and bounded; there are no network calls.
- A storage failure never blocks a commit: audit writes are best-effort, and the guard catches its own errors and fails open.
- The hook has a 5-second Git timeout and exits 0 on any internal error, with a diagnostic on stderr.

# Configuration

VisualRules has three storage locations and one read-only convention:

| Layer | Location | Written by | Shared via Git |
| --- | --- | --- | --- |
| Team | `<repo>/.dsh/profile.yaml` (or `.yml`) | the team, through normal commits | yes |
| Personal / workspace | DSH storage domain `dsh_visualrules` | the plugin UI | no |
| Rule packs | DSH storage domain `dsh_visualrules` | the plugin UI | no (team packs live in the repo) |
| Project rule sources | commitlint, `.editorconfig`, eslint, `CONTRIBUTING.md`, PR template | the project | yes |

The plugin never writes the team layer. The only repository writes are the optional Git hooks described in [commit-validation.md](./commit-validation.md).

## Team layer

The nearest `.dsh/profile.yaml` between the session directory and the repository root wins. The file is limited to 512 KiB and is parsed with line numbers.

### Minimal file

```yaml
version: 1
git:
  commit_format: conventional
  protected_branches: [main]
```

### Full field reference

```yaml
version: 1                     # integer >= 1
team: 支付平台组
environment: staging            # must appear in environments when that list is non-empty

environments:
  - name: dev
    host: dev.example.com
    port: 22
    level: dev                 # dev | test | staging | prod | info | warn | danger | none
    jump: bastion.example.com
    note: 本地联调
  - name: staging
    host: stg.example.com
    level: warn
  - name: prod
    host: prod.example.com
    level: danger

git:
  branch_pattern: "^(feature|fix|hotfix)/[a-z0-9-]+$"
  commit_format: conventional   # or a regular expression for the header
  allowed_commit_types: [feat, fix, docs, refactor, test, chore]
  header_max_length: 72         # 10..500
  require_issue: true
  issue_pattern: "PROJ-\\d+"    # optional; defaults to #123 / PROJ-42
  merge_strategy: squash
  protected_branches: [main, "release/*"]
  review:
    min_approvals: 2
  tag_pattern: "^v\\d+\\.\\d+\\.\\d+$"

dev:
  toolchain: { node: "20.x", python: "3.11" }
  lint: eslint
  formatter: prettier
  test: [unit-test, integration]
  ci_required: [lint, unit-test]
  dirs: { src: src, tests: test }

docs:
  wiki: https://example.com/wiki
  issues: https://example.com/board
  contributing: CONTRIBUTING.md
  pr_template: .github/PULL_REQUEST_TEMPLATE.md

team_info:
  owner: 张三
  contacts:
    - 张三 · 负责人 · zhang@example.com
    - 李四 · 值班 · li@example.com
  release_window: 每周四 20:00
  timezone: Asia/Shanghai

packs:
  - id: team/git-rules
    title: 团队提交规范
    description: 分支、提交信息与评审流程
    file: .dsh/rules/git-rules.md
  - id: team/review
    title: 评审清单
    content: |
      - 每个 PR 至少一位非作者批准
      - 数据库变更必须附带回滚方案
```

### Validation and failure behavior

- YAML syntax errors produce a line and a message; the profile becomes display-only and no rules are enforced.
- A field with the wrong type is ignored with a warning; other valid fields still apply.
- Unknown fields are ignored with an `info` notice — forward compatibility over strict rejection.
- `identity`, `servers`, `exclusive`, and `personal` are rejected with a warning if they appear in the team layer.
- A team pack `file` outside the repository is refused.
- A missing file is not an error; it becomes the “no team configuration” state.
- Invalid regexes are reported at load time and the corresponding rule is disabled, never evaluated loosely.

## Personal / workspace layer

Stored in the DSH storage domain, keyed by the session's resolved directory. It never enters the repository and survives plugin reloads.

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `gitName` | string | `''` | Expected `user.name`; display only. |
| `gitEmail` | string | `''` | Expected `user.email`; drives `identity.email` and the hook snapshot. |
| `environment` | string | `''` | Personal override of the team environment; hiding a team value produces a warning. |
| `showServerInfo` | boolean | `false` | Gates host / login user / key reference data. Requires UI confirmation. |
| `servers` | map | `{}` | `{ [envName]: { user, keyRef } }` — a login name and a reference name only. |
| `injectRules` | boolean | `false` | Inject structured Git rules even without a pack. |
| `extraRules` | string | `''` | Workspace supplement, composed last. |
| `enabledPacks` | string[] | `[]` | Packs enabled here. |
| `disabledPacks` | string[] | `[]` | Packs disabled here; wins over a global default. |
| `validation.enabled` | boolean | `true` | Master switch for commit validation. |
| `validation.levels` | map | `{}` | `{ ruleId: 'off' | 'info' | 'warn' | 'block' }`. |
| `validation.confirmDanger` | boolean | `false` | Ask before destructive commands in a prod workspace. |
| `validation.trackCommits` | boolean | `true` | Record successful AI commits locally. |

### Server information

`host`, `port`, `jump`, and `note` come from the team `environments` entry. `user` and `keyRef` come from the personal layer. Until `showServerInfo` is explicitly enabled, the Host omits `servers` from profile responses entirely and the environment object contains no host or user. The plugin never reads a key file and never asks for key content.

### Enabled packs

A pack is active for a workspace when:

```
disabledPacks does not contain id
AND (
  (personal pack AND (globalEnabled OR enabledPacks contains id))
  OR (team pack AND enabledPacks contains id)
)
```

Disabling a pack wins over a global default. A team pack cannot be enabled by a personal global flag.

## Rule packs

Personal packs are created in the UI and stored once in the DSH domain; every workspace references the same id. Editing the pack changes every reference.

Team packs are declared in `.dsh/profile.yaml`:

- `file:` — a path inside the repository, resolved relative to the repository root.
- `content:` — inline Markdown in the YAML file.
- Exactly one of the two must be non-empty; empty packs are reported and skipped.

A team pack id cannot be saved from the personal UI or deleted from the personal library.

## Discovered project sources

When present, these are read (not executed) and fill gaps in the structured rules:

| Source | Files | Extracted |
| --- | --- | --- |
| commitlint | `commitlint.config.{js,cjs,mjs,ts}`, `.commitlintrc(.json|.yaml|.yml|.js|.cjs)`, `package.json#commitlint` | `type-enum`, `scope-enum`, `header-max-length`, `type-case` |
| `.editorconfig` | `.editorconfig` | `indent_style`, `indent_size`, `max_line_length` |
| eslint | `eslint.config.*`, `.eslintrc*`, `package.json#eslintConfig` | path and presence |
| docs | `CONTRIBUTING.md`, `docs/CONTRIBUTING.md`, PR templates | path and first heading |

Team values always win over discovered values. JavaScript commitlint configs are parsed statically; if no stable rule can be extracted, the Validation page reports that instead of synthesizing one.

## Precedence summary

1. Built-in rule defaults (table in the README).
2. Per-workspace `validation.levels`.
3. `validation.enabled: false` disables every rule regardless of levels.
4. Team rules define *what* to check; discovered project sources fill missing values.
5. Personal identity expectations are only warnings unless their level is changed to `block`.

## Template

The **Team configuration** tab and the `team/template` API return a copyable template with a complete default set. The plugin does not write the file; copy it into the repository and commit it through the normal review flow. `examples/profile.yaml` in this repository is the same shape with comments.

# Security policy

## Supported versions

The latest released `0.2.x` line is supported on DSH 0.2.2-rc.1+. Earlier lines are not maintained.

## Reporting a vulnerability

Please **do not** open a public issue for a vulnerability. Report it privately:

- GitHub → **Security** → **Report a vulnerability** (preferred), or
- open a minimal issue asking a maintainer to establish a private channel.

Include the version, platform, a reproduction, and the impact you believe is possible. We will acknowledge the report and coordinate a fix and disclosure.

## Security model and boundaries

VisualRules runs inside the DSH Host and is subject to the same local trust boundary as the Harness. It does not add a remote service.

- **Data** — rule packs, personal settings, bypass records, validation events, and the AI commit index are stored in the DSH local storage domain. No data is uploaded by the plugin.
- **Secrets** — the plugin never requests, reads, or stores a password, token, or private-key content. Server records contain a login name and a key **reference name** only.
- **Server information** — omitted from Host responses until the user explicitly enables `showServerInfo`.
- **Repository writes** — none by default. The only write is the optional managed Git hook pair, shown in a preview and reversible; existing hooks are preserved and chained.
- **Git** — read-only probes. The plugin never commits, pushes, fetches, checks out, or changes Git config.
- **Prompt injection** — rule packs are user-authored content sent to the model; they can influence the model. Treat pack authorship with the same trust you give to a repository's instructions. Team packs are read from the repository and shown with their source.
- **Local validation** — a convenience, not a security boundary. `--no-verify`, another machine, and server-side settings are outside its reach.

## Hook safety

Hooks execute outside DSH, as the repository owner, whenever Git runs. The managed hook:

- contains a clear marker and is installed only in the repository's hooks directory;
- refuses a `core.hooksPath` that resolves outside the repository;
- runs a previous hook from a preserved backup path;
- exits 0 with a diagnostic if the checker or Node.js is unavailable, so a missing plugin cannot block every commit.

Review hook content before installing it. Remove it with `node scripts/hooks.mjs uninstall` or from the UI.

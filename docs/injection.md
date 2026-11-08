# Rule injection

The injection path answers one question: **what should the model know about this workspace right now?**

It is deliberately separate from commit validation. Injection adds context; validation rejects actions. Both resolve from the same session directory and both are previewable.

## Composition

Layers, in order, with the later layer winning on conflict:

1. **Structured team Git rules** (`validation`/`git` in `.dsh/profile.yaml`, when `injectRules` is on).
2. **Personal packs** — enabled for this workspace, or globally enabled and not disabled here. Sorted by pack id for stability.
3. **Team packs** — enabled and not disabled here.
4. **Workspace supplement** — `extraRules`, personal and local-only.

The output starts with a small header:

```markdown
<!-- dsh-visualrules:begin -->
## 工作区规范（由 DSH VisualRules 注入）

当前会话目录：`/Users/me/code/pay-core`；分支：`feature/split-coupon`；环境：`staging`。
层序：个人 → 团队 → 工作区补充；条目冲突时，后出现的条目优先。

### [个人] 提交信息规范（personal/general）
来源：`个人规范库 · personal/general`

…content…

<!-- dsh-visualrules:end -->
```

When the environment is `prod`/`production`/`prd`, a second warning line tells the model to ask before remote, deletion, or deployment operations.

## Budget

- Budget = `6%` of the model's context window, converted at roughly 3 characters per token.
- The Host asks `tokenMeter.contextPressure(session).contextWindow` on each assembly. If unavailable, it uses 24,000 characters.
- The header is always emitted. Layers are added in order; when the remaining budget is exhausted, more specific layers are kept first and the rest are marked **truncated** or **omitted** in the preview.
- No pack can exceed the budget by being long; a single oversized entry is trimmed with an explicit marker.
- The reservation floor is 2,000 characters, so tiny windows still get a usable block.

The preview endpoint uses the same composer as the live prompt, so what you see is what the next request carries.

## Timing

- Registered with `systemPrompt.section()` on each Agent's scope after `agent/created`, and also for already-live Agents when the plugin reloads.
- The section text is a function, evaluated when the request is assembled. A change to config, a directory switch, or a pack edit therefore applies on the **next model request**.
- Closing the plugin or disabling the section removes the block on the next request. Nothing is written to `agents.md`, the session log, or the repository.
- A separate short section, `visualrules:commit-feedback`, carries the latest guard rejection/warning summary. It is not part of the injection budget and is intentionally capped.

## Directory resolution

The section resolves from the Agent's current working directory, not the workspace that created the session. DSH can change a session directory (including into a linked worktree); the next assembly uses the new path, the nearest `.dsh/profile.yaml`, and that directory's local settings.

A directory switch does not replay old messages; it only changes the next request's context.

## Disabling

- Turn off individual packs, or disable injection entirely by clearing the workspace supplement and leaving no packs enabled.
- `validation.enabled` affects commit checks only; it does not change injection.
- Removing the plugin unmounts both prompt sections. The DSH prompt returns to its previous shape on the next request.

## What not to put in a pack

Rule packs are model context, not a secret store. Do not include passwords, tokens, private keys, customer data, or anything that should not be sent to the model provider. Server information belongs in the personal layer, and even there only as a reference name.

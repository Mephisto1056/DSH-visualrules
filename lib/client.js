/**
 * Client half of DSH VisualRules.
 *
 * Renders the session-header entry, the right-sidebar quick preview, the full
 * workspace profile page, and the settings page. All Host data arrives over the
 * plugin's `/api/visualrules/*` routes; this module never reads files itself.
 */

window.__ModuleLoader__.load({
  id: 'dsh-visualrules',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } = React

    const NS = 'visualrules'
    const PANEL_KEY = 'visualrules'
    const PREVIEW_KIND = 'visualrules'
    const API_BASE = 'api/visualrules'

    // ---------------------------------------------------------------------
    // Dictionaries
    // ---------------------------------------------------------------------

    const ZH = {
      'meta.title': '工作区规范',
      'meta.description': '展示每个工作区的 Git 身份、环境与团队规范，并把启用的规范包注入当前会话。',
      'nav.title': '工作区规范',
      'nav.preview': '工作区档案',
      'nav.guide': '查看当前工作区的身份、环境、分支与规范，并预览注入内容。',
      'common.refresh': '刷新',
      'common.save': '保存',
      'common.saving': '保存中…',
      'common.cancel': '取消',
      'common.delete': '删除',
      'common.edit': '编辑',
      'common.copy': '复制',
      'common.copied': '已复制',
      'common.close': '关闭',
      'common.open': '打开',
      'common.retry': '重试',
      'common.loading': '读取中…',
      'common.none': '未配置',
      'common.unknown': '未知',
      'common.yes': '是',
      'common.no': '否',
      'common.optional': '可选',
      'common.workspace': '本工作区',
      'common.allWorkspaces': '所有工作区',
      'common.more': '更多',
      'defaults.fill': '填入推荐默认值',
      'defaults.filled': '已填入推荐默认值，请确认后保存',
      'defaults.hint': '只写入本机 DSH 存储，不会修改仓库或 Git 配置。',
      'defaults.packTitle': '提交信息规范',
      'defaults.packDescription': '提交信息、正文结构与提交前检查的默认约定',
      'defaults.packContent': [
        '# 提交信息规范',
        '',
        '## 首行',
        '格式：`<type>: <摘要>`，首行不超过 60 个字。',
        'type 使用 `feat` / `fix` / `docs` / `refactor` / `test` / `chore`。',
        '',
        '## 提交信息模板',
        '',
        '```text',
        'feat: 新增优惠券按订单拆分',
        '# ↑ 首行 ≤ 60 字',
        '',
        '# 为什么改：',
        '# 怎么改的：',
        '# 影响面：',
        '```',
        '',
        '首行后空一行，按三段补齐；实际提交时把 `# 为什么改：` 写成 `为什么改：<内容>`，Git 默认把 `#` 开头的行当注释。',
        '',
        '## 提交前',
        '- 一次提交只做一件事，不要把无关改动混在一起。',
        '- 运行 lint 与相关测试。',
        '- 不提交密钥、令牌、个人配置或生成物。',
        '',
        '## 团队规则',
        '分支命名、受保护分支、评审人数、合并策略以团队 `.dsh/profile.yaml` 的 `git` 配置为准；个人规范包不重复这些规则。',
      ].join('\n'),
      'defaults.enablePack': '创建并启用默认规范包',
      'defaults.enablingPack': '正在启用…',
      'defaults.newPackHint': '已填入一份默认模板，可直接修改后保存。',
      'defaults.gitHint': '默认来自当前仓库的实际 Git 身份，可修改。',
      'env.dev': '开发',
      'env.test': '测试',
      'env.staging': '预发',
      'env.prod': '生产',
      'env.info': '环境',
      'env.none': '未设置环境',
      'status.noSession': '先打开一个会话',
      'status.loading': '正在读取工作区档案…',
      'status.error': '读取失败',
      'status.tooltip': '{name} · {env} · {email}',
      'status.badge': '{count} 条待处理提醒',
      'profile.title': '工作区规范',
      'profile.subtitle': '身份、环境、分支与团队规范一屏看完；规范会按需注入当前会话。',
      'profile.tab.overview': '档案',
      'profile.tab.packs': '规范包',
      'profile.tab.personal': '个人配置',
      'profile.tab.team': '团队配置',
      'profile.tab.preview': '注入预览',
      "profile.tab.validation": "校验",
      "validation.title": "提交校验",
      "validation.hint": "在 AI 提交前检查身份、分支与提交信息；可选安装 Git 钩子覆盖终端与 IDE 里的提交。",
      "validation.enabledOn": "校验已开启",
      "validation.enabledOff": "校验已关闭",
      "validation.enabled": "启用提交校验",
      "validation.saved": "校验设置已保存",
      "validation.notGit": "当前目录不是 Git 仓库",
      "validation.notGitHint": "没有 Git 仓库时无法校验提交；切换到仓库目录后会恢复。",
      "validation.level.off": "关闭",
      "validation.level.info": "提示",
      "validation.level.warn": "警告",
      "validation.level.block": "拦截",
      "validation.rule.identity.email": "Git 邮箱一致性",
      "validation.rule.identity.missing": "Git 身份完整性",
      "validation.rule.branch.protected": "受保护分支",
      "validation.rule.branch.pattern": "分支命名",
      "validation.rule.branch.detached": "detached HEAD",
      "validation.rule.commit.format": "提交信息格式",
      "validation.rule.commit.type": "提交类型",
      "validation.rule.commit.scope": "提交 scope",
      "validation.rule.commit.headerLength": "首行长度",
      "validation.rule.commit.issue": "关联 Issue",
      "validation.rule.commit.messageMissing": "提交信息可读性",
      "validation.rule.commit.mergeMessage": "合并提交",
      "validation.rule.commit.noVerify": "跳过 Git 钩子",
      "validation.rule.commit.amend": "amend 提交",
      "validation.rules.title": "规则级别",
      "validation.rules.hint": "每条规则可单独设为关闭 / 提示 / 警告 / 拦截；团队配置提供默认值，本工作区的选择优先生效。",
      "validation.rules.ruleCount": "规则数",
      "validation.summary.branch": "分支命名",
      "validation.summary.protected": "受保护分支",
      "validation.summary.format": "提交格式",
      "validation.summary.types": "允许类型",
      "validation.summary.header": "首行上限",
      "validation.summary.issue": "关联 Issue",
      "validation.confirmDanger": "生产环境高危命令二次确认",
      "validation.confirmDangerHint": "工作区环境为 prod 时，SSH、kubectl、terraform 等破坏性命令会先请求确认；默认关闭。",
      "validation.trackCommits": "记录 AI 提交索引",
      "validation.trackCommitsHint": "AI 发起并成功的提交会记录在本机，不写入 Git 提交内容。",
      "validation.hook.title": "Git 钩子（覆盖终端 / IDE）",
      "validation.hook.hint": "工具层只能拦住 AI 通过命令执行的提交；仓库钩子覆盖其余路径。安装是可选的，可一键卸载。",
      "validation.hook.installed": "已安装",
      "validation.hook.partial": "部分安装",
      "validation.hook.notInstalled": "未安装",
      "validation.hook.notGit": "当前目录不是 Git 仓库，无法安装钩子。",
      "validation.hook.directory": "hooks 目录",
      "validation.hook.customPath": "仓库设置了自定义 core.hooksPath，插件只会在该目录（且必须在仓库内）安装。",
      "validation.hook.backup": "原钩子已备份",
      "validation.hook.stale": "插件已更新，建议重装",
      "validation.hook.coverage": "覆盖范围：插件拦截 AI 的命令提交；Git 钩子覆盖终端、IDE、脚本和后台任务里的提交。git commit --no-verify 无法被本地机制拦截，服务端分支保护与 CI 仍是最终防线。",
      "validation.hook.preview": "预览将写入的内容",
      "validation.hook.confirmInstall": "确认安装到上面的目录？已有同名钩子会先备份并串接执行。",
      "validation.hook.install": "安装钩子",
      "validation.hook.reinstall": "重新安装",
      "validation.hook.uninstall": "卸载钩子",
      "validation.hook.confirmUninstall": "确认卸载？原钩子会恢复。",
      "validation.hook.installDone": "Git 钩子已安装",
      "validation.hook.installFailed": "Git 钩子安装失败",
      "validation.hook.previewTitle": "钩子内容",
      "validation.bypass.title": "临时放行",
      "validation.bypass.hint": "拦截后用一次即失效；原因会留在本机记录里。AI 不能自行创建放行，只有你能在界面操作。",
      "validation.bypass.reason": "放行原因",
      "validation.bypass.reasonPlaceholder": "例如：紧急修复线上问题，用户已确认",
      "validation.bypass.reasonRequired": "请填写至少 3 个字符的放行原因",
      "validation.bypass.ttl": "有效期",
      "validation.bypass.minutes": "分钟",
      "validation.bypass.create": "创建放行",
      "validation.bypass.created": "已创建临时放行，下次提交生效一次",
      "validation.bypass.empty": "当前没有待使用的放行记录。",
      "validation.bypass.expires": "过期于",
      "validation.bypass.revoke": "撤销",
      "validation.bypass.revoked": "已撤销",
      "validation.bypass.consumed": "已使用的放行记录",
      "validation.check.title": "提交前试算",
      "validation.check.hint": "不会真的提交，只按当前规则检查一条提交信息或分支名。",
      "validation.check.message": "拟用的提交信息",
      "validation.check.branch": "拟用的分支",
      "validation.check.run": "开始校验",
      "validation.check.pass": "没有发现问题，可以提交。",
      "validation.check.fix": "修正",
      "validation.events.title": "最近校验记录",
      "validation.events.hint": "保留在本机，用于追踪拦截与放行；不写入仓库。",
      "validation.events.empty": "还没有校验记录。",
      "validation.event.block": "拦截",
      "validation.event.warn": "警告",
      "validation.event.allow": "通过",
      "validation.event.bypass": "放行",
      "validation.commits.title": "AI 提交索引",
      "validation.commits.hint": "按会话记录 AI 发起并成功的提交，方便追溯每次改动。",
      "validation.commits.empty": "还没有记录到 AI 提交。",
      "validation.commits.confirmClear": "确认清空全部 AI 提交索引？",
      "validation.commits.clear": "清空",
      "validation.commits.cleared": "已清空",
      "validation.commits.copy": "复制完整 hash",
      "validation.commits.localOnly": "只存本机索引，不修改提交内容、不写 Git notes。",
      "validation.sources.title": "项目已有规范来源",
      "validation.sources.hint": "只读解析 commitlint、.editorconfig、eslint、CONTRIBUTING 和 PR 模板；无法静态解析的配置会明确提示。",
      "validation.sources.none": "未找到",
      "personal.showServerInfoConfirmTitle": "启用服务器信息展示？",
      "personal.showServerInfoConfirmHint": "启用后，环境的主机、登录用户与密钥引用名会出现在工作区档案和右侧预览中。插件不会读取或保存密钥内容。",
      "personal.showServerInfoConfirm": "我了解，启用",
      'profile.empty.title': '没有可展示的工作区',
      'profile.empty.body': '先在左侧打开或新建一个会话，插件会以会话当前目录解析工作区。',
      'profile.updated': '更新于 {time}',
      'section.warnings': '提醒',
      'section.identity': 'Git 身份',
      'section.branch': '分支与远端',
      'section.environment': '环境与连接',
      'section.rules': 'Git 规范',
      'section.injection': '规范注入',
      'section.team': '团队信息',
      'section.dev': '开发规范',
      'section.config': '团队配置',
      'label.name': 'user.name',
      'label.email': 'user.email',
      'label.source': '来源',
      'label.branch': '当前分支',
      'label.remote': '远端',
      'label.upstream': '上游分支',
      'label.ahead': '领先',
      'label.behind': '落后',
      'label.lastCommit': '最近提交',
      'label.host': '主机',
      'label.port': '端口',
      'label.user': '登录用户',
      'label.keyRef': '密钥引用',
      'label.jump': '跳板机',
      'label.environment': '环境',
      'label.protected': '受保护分支',
      'label.review': '最少批准数',
      'label.merge': '合并策略',
      'label.commitFormat': 'Commit 格式',
      'label.branchPattern': '分支命名',
      'label.requireIssue': '关联 Issue',
      'label.issuePattern': 'Issue 编号',
      'label.tagPattern': 'Tag 规则',
      'label.allowedTypes': '提交类型',
      'label.teamName': '团队',
      'label.owner': '负责人',
      'label.contacts': '联系人',
      'label.wiki': '文档入口',
      'label.issues': 'Issue 看板',
      'label.releaseWindow': '发布窗口',
      'label.toolchain': '工具链',
      'label.lint': 'Lint',
      'label.formatter': 'Formatter',
      'label.test': '测试',
      'label.ci': 'CI 要求',
      'label.dirs': '目录约定',
      'label.packs': '启用的规范包',
      'label.injectRules': '团队规则注入',
      'label.extraRules': '工作区补充规范',
      'label.configPath': '配置文件',
      'label.status': '状态',
      'label.line': '第 {line} 行',
      'label.chars': '{count} 字符',
      'label.totalChars': '合计',
      'label.limit': '上限',
      'label.truncated': '已截断',
      'label.readonly': '只读',
      'label.global': '全局',
      'label.enabled': '已启用',
      'label.disabled': '未启用',
      'label.description': '描述',
      'label.id': 'ID',
      'label.scope': '层级',
      'identity.mismatch': '实际 Git 邮箱与个人层期望不一致。插件只提醒，不会修改 Git 配置。',
      'environment.overridden': '个人层覆盖了团队环境标识，请确认没有隐藏生产环境。',
      'value.repo': '仓库级',
      'value.global': '全局',
      'value.system': '系统级',
      'value.command': '命令行',
      'value.personal': '个人',
      'value.team': '团队',
      'value.workspace': '工作区',
      'value.teamRules': '团队规则',
      'value.notConfigured': '未配置',
      'value.detached': 'detached HEAD',
      'value.noRemote': '未配置远端',
      'value.noUpstream': '未设置上游',
      'value.noCommit': '暂无提交',
      'value.empty': '无',
      'action.openProfile': '打开完整档案',
      'action.editConfig': '编辑配置',
      'action.managePacks': '管理规范包',
      'action.newPack': '新建规范包',
      'action.import': '导入 Markdown',
      'action.savePack': '保存规范包',
      'action.copyTemplate': '复制配置模板',
      'action.reload': '重新读取',
      'action.copyText': '复制全文',
      'action.openPreview': '预览注入文本',
      'action.enableServerInfo': '启用服务器信息',
      'empty.noRepo': '当前目录不是 Git 仓库，Git 身份、分支与远端模块已隐藏。',
      'empty.noConfig': '仓库里还没有 .dsh/profile.yaml。可复制模板后提交到仓库，团队规范会随仓库共享。',
      'empty.noPacks': '还没有启用规范包。启用后，新会话的模型会收到这些规则。',
      'empty.noInjection': '当前没有可注入的规范：请启用规范包，或打开「团队规则注入」。',
      'empty.noWarnings': '没有需要处理的提醒。',
      'warn.count': '{count} 条提醒',
      'warn.configure': '去配置',
      'pack.personalTitle': '个人规范库',
      'pack.teamTitle': '团队规范包',
      'pack.personalHint': '规范只存一份，所有工作区引用同一份；修改一处，所有引用同步。',
      'pack.teamHint': '来自仓库内 .dsh/profile.yaml，只读；修改请走正常仓库提交流程。',
      'pack.newTitle': '新建规范包',
      'pack.editTitle': '编辑规范包',
      'pack.id': 'ID',
      'pack.idHint': '例如 personal/general 或 team-a/git-rules',
      'pack.title': '标题',
      'pack.description': '描述',
      'pack.content': '正文（Markdown）',
      'pack.global': '在所有工作区默认启用',
      'pack.globalHint': '关闭后仅在本工作区启用；默认全部关闭。',
      'pack.enabledHere': '本工作区启用',
      'pack.deleteConfirm': '确认删除',
      'pack.saved': '规范包已保存',
      'pack.deleted': '规范包已删除',
      'pack.readonlyHint': '团队规范包只读',
      'pack.empty': '个人规范库还是空的。新建或导入一份 Markdown，就能在所有工作区复用。',
      'pack.importHint': '选择 .md / .txt 文件，内容会进入规范包正文，不会上传到外部服务。',
      'pack.idExists': '该 ID 已存在，请换一个。',
      'personal.title': '个人层配置',
      'personal.hint': '只存在本机 DSH 存储，不进入仓库；插件不会修改你的 Git 配置。',
      'personal.gitName': '期望 Git 用户名',
      'personal.gitEmail': '期望 Git 邮箱',
      'personal.gitHint': '用于提交前校验和提醒；留空表示不校验。',
      'personal.environment': '环境标识',
      'personal.environmentHint': '留空则使用团队配置中的 environment；个人设置会覆盖团队值并给出提醒。',
      'personal.showServerInfo': '展示服务器连接信息',
      'personal.showServerInfoHint': '关闭时只显示环境色标，不显示 host、端口与登录用户。',
      'personal.servers': '服务器账号',
      'personal.serverUser': '登录用户',
      'personal.serverKeyRef': '密钥引用名',
      'personal.serverKeyHint': '只保存引用名，不保存密钥内容。',
      'personal.injectRules': '注入团队 Git 规则',
      'personal.injectRulesHint': '把 .dsh/profile.yaml 里的分支、提交、合并、Review 规则注入模型。',
      'personal.extraRules': '工作区补充规范',
      'personal.extraRulesHint': '最高优先级，追加在团队与个人规范之后；适合记录本仓库特有的约定。',
      'personal.saved': '个人配置已保存',
      'personal.noWorkspace': '先在左侧打开一个会话，才能编辑该工作区的个人配置。',
      'personal.noEnv': '团队配置里还没有 environments，可先填写环境名，稍后再在仓库里补充 host。',
      'preview.title': '注入预览',
      'preview.hint': '这就是当前工作区下一轮模型请求会收到的规范文本。修改配置后在下一轮生效。',
      'preview.empty': '当前没有可注入的规范。',
      'preview.loading': '正在拼装注入文本…',
      'preview.entries': '条目',
      'preview.omitted': '因预算未包含',
      'preview.truncated': '有内容因超出预算被截断',
      'preview.copied': '注入文本已复制',
      'preview.copyFailed': '复制失败，请手动选择文本。',
      'config.ok': '解析正常',
      'config.missing': '不存在',
      'config.invalid': '解析失败，已降级为只展示',
      'config.path': '文件位置',
      'config.templateTitle': '团队配置模板',
      'config.templateHint': '模板已包含一套默认值。复制后在仓库中添加 .dsh/profile.yaml，按团队实际修改；插件不会自动写入仓库文件。',
      'config.unknown': '未知字段会被忽略并给出提示。',
      'config.errors': '错误',
      'config.warnings': '提醒',
      'config.reload': '重新读取配置',
      'config.noFile': '未找到 .dsh/profile.yaml',
      'settings.title': '工作区规范',
      'settings.subtitle': '管理规范包、个人层配置与注入预览。团队层只读。',
      'settings.noWorkspace': '未绑定工作区',
      'statusbar.title': '工作区规范',
      'statusbar.emptyTitle': '当前没有可识别的工作区',
      'statusbar.noRepo': '当前工作区没有仓库',
      'statusbar.openHint': '点击打开快速预览',
      'overlay.title': '工作区档案',
      'overlay.noSession': '先打开一个会话，插件会以会话当前目录解析工作区。',
      'error.prefix': '操作失败：',
    }

    const EN = {
      'meta.title': 'Workspace rules',
      'meta.description': 'Shows the Git identity, environment, and team rules of each workspace, and injects enabled rule packs into the current session.',
      'nav.title': 'Workspace rules',
      'nav.preview': 'Workspace profile',
      'nav.guide': 'Inspect the current workspace identity, environment, branch, and rules, and preview the injected text.',
      'common.refresh': 'Refresh',
      'common.save': 'Save',
      'common.saving': 'Saving…',
      'common.cancel': 'Cancel',
      'common.delete': 'Delete',
      'common.edit': 'Edit',
      'common.copy': 'Copy',
      'common.copied': 'Copied',
      'common.close': 'Close',
      'common.open': 'Open',
      'common.retry': 'Retry',
      'common.loading': 'Loading…',
      'common.none': 'Not configured',
      'common.unknown': 'Unknown',
      'common.yes': 'Yes',
      'common.no': 'No',
      'common.optional': 'Optional',
      'common.workspace': 'This workspace',
      'common.allWorkspaces': 'All workspaces',
      'common.more': 'More',
      'defaults.fill': 'Fill recommended defaults',
      'defaults.filled': 'Recommended defaults filled; review and save.',
      'defaults.hint': 'Written only to local DSH storage; repository and Git config are never modified.',
      'defaults.packTitle': 'Commit message rules',
      'defaults.packDescription': 'Default conventions for commit subject, body structure, and pre-commit checks',
      'defaults.packContent': [
        '# Commit message rules',
        '',
        '## Subject line',
        'Format: `<type>: <summary>`, at most 60 characters.',
        'Use `feat` / `fix` / `docs` / `refactor` / `test` / `chore`.',
        '',
        '## Template',
        '',
        '```text',
        'feat: split coupons by order',
        '# ↑ subject line ≤ 60 characters',
        '',
        '# Why:',
        '# How:',
        '# Impact:',
        '```',
        '',
        'Leave one blank line after the subject and fill in the three sections. When committing, write `Why: <content>` instead of `# Why:`; Git treats lines starting with `#` as comments by default.',
        '',
        '## Before committing',
        '- Keep one logical change per commit; do not mix unrelated changes.',
        '- Run lint and the relevant tests.',
        '- Never commit secrets, tokens, personal settings, or generated artifacts.',
        '',
        '## Team rules',
        'Branch naming, protected branches, required approvals, and merge strategy come from the team `.dsh/profile.yaml` (`git` section); personal rule packs do not duplicate them.',
      ].join('\n'),
      'defaults.enablePack': 'Create and enable default pack',
      'defaults.enablingPack': 'Enabling…',
      'defaults.newPackHint': 'A default template is prefilled; edit it and save.',
      'defaults.gitHint': 'Prefilled from the current repository Git identity; editable.',
      'env.dev': 'Development',
      'env.test': 'Test',
      'env.staging': 'Staging',
      'env.prod': 'Production',
      'env.info': 'Environment',
      'env.none': 'No environment',
      'status.noSession': 'Open a session first',
      'status.loading': 'Reading the workspace profile…',
      'status.error': 'Read failed',
      'status.tooltip': '{name} · {env} · {email}',
      'status.badge': '{count} pending notices',
      'profile.title': 'Workspace rules',
      'profile.subtitle': 'Identity, environment, branch, and team rules in one place; rules are injected into the current session only when enabled.',
      'profile.tab.overview': 'Profile',
      'profile.tab.packs': 'Rule packs',
      'profile.tab.personal': 'Personal',
      'profile.tab.team': 'Team config',
      'profile.tab.preview': 'Injection preview',
      "profile.tab.validation": "Validation",
      "validation.title": "Commit validation",
      "validation.hint": "Check identity, branch, and message before AI commits; optionally install Git hooks to cover terminal and IDE commits.",
      "validation.enabledOn": "Validation on",
      "validation.enabledOff": "Validation off",
      "validation.enabled": "Enable commit validation",
      "validation.saved": "Validation settings saved",
      "validation.notGit": "Not a Git repository",
      "validation.notGitHint": "Commit validation needs a Git repository; it returns when you switch to one.",
      "validation.level.off": "Off",
      "validation.level.info": "Info",
      "validation.level.warn": "Warn",
      "validation.level.block": "Block",
      "validation.rule.identity.email": "Git email match",
      "validation.rule.identity.missing": "Git identity complete",
      "validation.rule.branch.protected": "Protected branch",
      "validation.rule.branch.pattern": "Branch naming",
      "validation.rule.branch.detached": "Detached HEAD",
      "validation.rule.commit.format": "Message format",
      "validation.rule.commit.type": "Commit type",
      "validation.rule.commit.scope": "Commit scope",
      "validation.rule.commit.headerLength": "Header length",
      "validation.rule.commit.issue": "Linked issue",
      "validation.rule.commit.messageMissing": "Message readability",
      "validation.rule.commit.mergeMessage": "Merge commit",
      "validation.rule.commit.noVerify": "Hooks skipped",
      "validation.rule.commit.amend": "Amended commit",
      "validation.rules.title": "Rule levels",
      "validation.rules.hint": "Each rule can be off, info, warn, or block. Team config supplies defaults; this workspace overrides them.",
      "validation.rules.ruleCount": "Rules",
      "validation.summary.branch": "Branch rule",
      "validation.summary.protected": "Protected",
      "validation.summary.format": "Format",
      "validation.summary.types": "Types",
      "validation.summary.header": "Header max",
      "validation.summary.issue": "Issue required",
      "validation.confirmDanger": "Confirm dangerous production commands",
      "validation.confirmDangerHint": "When the workspace environment is prod, destructive SSH / kubectl / terraform commands ask first. Off by default.",
      "validation.trackCommits": "Record the AI commit index",
      "validation.trackCommitsHint": "Successful AI-issued commits are recorded locally, never written into Git.",
      "validation.hook.title": "Git hooks (terminal / IDE)",
      "validation.hook.hint": "The tool layer only sees AI commands; repository hooks cover the rest. Installation is optional and reversible.",
      "validation.hook.installed": "Installed",
      "validation.hook.partial": "Partially installed",
      "validation.hook.notInstalled": "Not installed",
      "validation.hook.notGit": "This directory is not a Git repository, so hooks cannot be installed.",
      "validation.hook.directory": "hooks directory",
      "validation.hook.customPath": "core.hooksPath points elsewhere; the plugin only installs inside that directory when it stays inside the repository.",
      "validation.hook.backup": "Previous hook backed up",
      "validation.hook.stale": "Plugin updated; reinstall recommended",
      "validation.hook.coverage": "Coverage: the tool guard blocks AI-issued commits; Git hooks cover terminal, IDE, scripts, and background tasks. git commit --no-verify cannot be stopped locally — server-side protection and CI remain the final gate.",
      "validation.hook.preview": "Preview what will be written",
      "validation.hook.confirmInstall": "Install into the directory above? An existing hook is backed up and still runs first.",
      "validation.hook.install": "Install hooks",
      "validation.hook.reinstall": "Reinstall",
      "validation.hook.uninstall": "Uninstall hooks",
      "validation.hook.confirmUninstall": "Uninstall and restore the previous hooks?",
      "validation.hook.installDone": "Git hooks installed",
      "validation.hook.installFailed": "Git hooks installation failed",
      "validation.hook.previewTitle": "Hook content",
      "validation.bypass.title": "One-time bypass",
      "validation.bypass.hint": "Valid for one commit; the reason is kept locally. Only you can create a bypass from this UI — the agent cannot.",
      "validation.bypass.reason": "Reason",
      "validation.bypass.reasonPlaceholder": "e.g. emergency production fix, confirmed by the user",
      "validation.bypass.reasonRequired": "Enter a reason of at least 3 characters",
      "validation.bypass.ttl": "Valid for",
      "validation.bypass.minutes": "minutes",
      "validation.bypass.create": "Create bypass",
      "validation.bypass.created": "Bypass created; it applies to the next matching commit",
      "validation.bypass.empty": "No unused bypass records.",
      "validation.bypass.expires": "Expires",
      "validation.bypass.revoke": "Revoke",
      "validation.bypass.revoked": "Revoked",
      "validation.bypass.consumed": "Used bypass records",
      "validation.check.title": "Pre-flight check",
      "validation.check.hint": "Checks a message or branch against the current rules without committing.",
      "validation.check.message": "Proposed commit message",
      "validation.check.branch": "Proposed branch",
      "validation.check.run": "Run check",
      "validation.check.pass": "No problems found; ready to commit.",
      "validation.check.fix": "Fix",
      "validation.events.title": "Recent validation events",
      "validation.events.hint": "Kept locally to trace blocks and bypasses; never written into the repository.",
      "validation.events.empty": "No validation events yet.",
      "validation.event.block": "Blocked",
      "validation.event.warn": "Warning",
      "validation.event.allow": "Passed",
      "validation.event.bypass": "Bypassed",
      "validation.commits.title": "AI commit index",
      "validation.commits.hint": "Successful AI-issued commits by session, for tracing each change.",
      "validation.commits.empty": "No AI commits recorded yet.",
      "validation.commits.confirmClear": "Clear the entire AI commit index?",
      "validation.commits.clear": "Clear",
      "validation.commits.cleared": "Cleared",
      "validation.commits.copy": "Copy full hash",
      "validation.commits.localOnly": "Local index only; commit contents and Git notes are untouched.",
      "validation.sources.title": "Existing project rule sources",
      "validation.sources.hint": "Read-only parsing of commitlint, .editorconfig, eslint, CONTRIBUTING, and the PR template. Configs that cannot be parsed statically are reported explicitly.",
      "validation.sources.none": "Not found",
      "personal.showServerInfoConfirmTitle": "Show server information?",
      "personal.showServerInfoConfirmHint": "When enabled, the environment host, login user, and key reference appear in the profile and quick preview. The plugin never reads or stores key contents.",
      "personal.showServerInfoConfirm": "I understand, enable",
      'profile.empty.title': 'No workspace to show',
      'profile.empty.body': 'Open or create a session first; the plugin resolves the workspace from the session current directory.',
      'profile.updated': 'Updated {time}',
      'section.warnings': 'Notices',
      'section.identity': 'Git identity',
      'section.branch': 'Branch and remote',
      'section.environment': 'Environment and connection',
      'section.rules': 'Git rules',
      'section.injection': 'Rule injection',
      'section.team': 'Team',
      'section.dev': 'Development',
      'section.config': 'Team config',
      'label.name': 'user.name',
      'label.email': 'user.email',
      'label.source': 'Source',
      'label.branch': 'Current branch',
      'label.remote': 'Remote',
      'label.upstream': 'Upstream',
      'label.ahead': 'Ahead',
      'label.behind': 'Behind',
      'label.lastCommit': 'Last commit',
      'label.host': 'Host',
      'label.port': 'Port',
      'label.user': 'Login user',
      'label.keyRef': 'Key reference',
      'label.jump': 'Jump host',
      'label.environment': 'Environment',
      'label.protected': 'Protected branches',
      'label.review': 'Min approvals',
      'label.merge': 'Merge strategy',
      'label.commitFormat': 'Commit format',
      'label.branchPattern': 'Branch naming',
      'label.requireIssue': 'Require issue',
      'label.issuePattern': 'Issue pattern',
      'label.tagPattern': 'Tag rules',
      'label.allowedTypes': 'Commit types',
      'label.teamName': 'Team',
      'label.owner': 'Owner',
      'label.contacts': 'Contacts',
      'label.wiki': 'Wiki',
      'label.issues': 'Issue board',
      'label.releaseWindow': 'Release window',
      'label.toolchain': 'Toolchain',
      'label.lint': 'Lint',
      'label.formatter': 'Formatter',
      'label.test': 'Tests',
      'label.ci': 'CI requirements',
      'label.dirs': 'Directory conventions',
      'label.packs': 'Enabled packs',
      'label.injectRules': 'Team rule injection',
      'label.extraRules': 'Workspace additions',
      'label.configPath': 'Config file',
      'label.status': 'Status',
      'label.line': 'Line {line}',
      'label.chars': '{count} chars',
      'label.totalChars': 'Total',
      'label.limit': 'Limit',
      'label.truncated': 'Truncated',
      'label.readonly': 'Read-only',
      'label.global': 'Global',
      'label.enabled': 'Enabled',
      'label.disabled': 'Disabled',
      'label.description': 'Description',
      'label.id': 'ID',
      'label.scope': 'Layer',
      'identity.mismatch': 'The actual Git email differs from the personal expectation. The plugin warns only; it never edits Git config.',
      'environment.overridden': 'The personal layer overrides the team environment. Confirm this is not hiding production.',
      'value.repo': 'Repository',
      'value.global': 'Global',
      'value.system': 'System',
      'value.command': 'Command line',
      'value.personal': 'Personal',
      'value.team': 'Team',
      'value.workspace': 'Workspace',
      'value.teamRules': 'Team rules',
      'value.notConfigured': 'Not configured',
      'value.detached': 'detached HEAD',
      'value.noRemote': 'No remote',
      'value.noUpstream': 'No upstream',
      'value.noCommit': 'No commits',
      'value.empty': 'None',
      'action.openProfile': 'Open full profile',
      'action.editConfig': 'Edit configuration',
      'action.managePacks': 'Manage rule packs',
      'action.newPack': 'New rule pack',
      'action.import': 'Import Markdown',
      'action.savePack': 'Save rule pack',
      'action.copyTemplate': 'Copy config template',
      'action.reload': 'Reload',
      'action.copyText': 'Copy text',
      'action.openPreview': 'Preview injected text',
      'action.enableServerInfo': 'Enable server info',
      'empty.noRepo': 'The current directory is not a Git repository; identity, branch, and remote modules are hidden.',
      'empty.noConfig': 'This repository has no .dsh/profile.yaml yet. Copy the template and commit it so your team shares the same rules.',
      'empty.noPacks': 'No rule packs are enabled. Once enabled, new sessions receive these rules.',
      'empty.noInjection': 'Nothing to inject yet. Enable a rule pack, or turn on team rule injection.',
      'empty.noWarnings': 'Nothing needs attention.',
      'warn.count': '{count} notices',
      'warn.configure': 'Configure',
      'pack.personalTitle': 'Personal library',
      'pack.teamTitle': 'Team packs',
      'pack.personalHint': 'A pack is stored once and referenced by every workspace; editing it updates every reference.',
      'pack.teamHint': 'Declared in the repository .dsh/profile.yaml; read-only here. Change it through a normal commit.',
      'pack.newTitle': 'New rule pack',
      'pack.editTitle': 'Edit rule pack',
      'pack.id': 'ID',
      'pack.idHint': 'For example personal/general or team-a/git-rules',
      'pack.title': 'Title',
      'pack.description': 'Description',
      'pack.content': 'Content (Markdown)',
      'pack.global': 'Enable in all workspaces by default',
      'pack.globalHint': 'When off, the pack is only enabled per workspace. Everything is off by default.',
      'pack.enabledHere': 'Enable in this workspace',
      'pack.deleteConfirm': 'Confirm delete',
      'pack.saved': 'Rule pack saved',
      'pack.deleted': 'Rule pack deleted',
      'pack.readonlyHint': 'Team packs are read-only',
      'pack.empty': 'The personal library is empty. Create or import a Markdown pack to reuse it across workspaces.',
      'pack.importHint': 'Choose a .md or .txt file. Its text becomes the pack content; nothing is uploaded.',
      'pack.idExists': 'This ID already exists. Choose another one.',
      'personal.title': 'Personal layer',
      'personal.hint': 'Stored only in local DSH storage, never in the repository. The plugin never edits your Git config.',
      'personal.gitName': 'Expected Git name',
      'personal.gitEmail': 'Expected Git email',
      'personal.gitHint': 'Used for pre-commit checks and warnings; leave empty to skip the check.',
      'personal.environment': 'Environment label',
      'personal.environmentHint': 'Empty uses the team config environment. A personal override is allowed but reported as a notice.',
      'personal.showServerInfo': 'Show server connection info',
      'personal.showServerInfoHint': 'When off, only the environment badge is shown; host, port, and login user stay hidden.',
      'personal.servers': 'Server accounts',
      'personal.serverUser': 'Login user',
      'personal.serverKeyRef': 'Key reference',
      'personal.serverKeyHint': 'Only a reference name is stored, never key material.',
      'personal.injectRules': 'Inject team Git rules',
      'personal.injectRulesHint': 'Injects branch, commit, merge, and review rules from .dsh/profile.yaml.',
      'personal.extraRules': 'Workspace additions',
      'personal.extraRulesHint': 'Highest precedence, appended after personal and team packs. Use it for repository-specific conventions.',
      'personal.saved': 'Personal configuration saved',
      'personal.noWorkspace': 'Open a session first to edit this workspace personal configuration.',
      'personal.noEnv': 'The team config has no environments yet. You can set a name now and add host details later.',
      'preview.title': 'Injection preview',
      'preview.hint': 'This is exactly the rules text the next model request in this workspace receives. Changes apply on the next turn.',
      'preview.empty': 'There is nothing to inject right now.',
      'preview.loading': 'Composing the injected text…',
      'preview.entries': 'Entries',
      'preview.omitted': 'Omitted by budget',
      'preview.truncated': 'Some content was truncated to fit the budget',
      'preview.copied': 'Injected text copied',
      'preview.copyFailed': 'Copy failed; select the text manually.',
      'config.ok': 'Parsed successfully',
      'config.missing': 'Missing',
      'config.invalid': 'Parse failed; display-only fallback',
      'config.path': 'File',
      'config.templateTitle': 'Team config template',
      'config.templateHint': 'The template includes a set of defaults. Copy it into .dsh/profile.yaml and adjust it for your team; the plugin never writes repository files.',
      'config.unknown': 'Unknown fields are ignored with a notice.',
      'config.errors': 'Errors',
      'config.warnings': 'Warnings',
      'config.reload': 'Reload config',
      'config.noFile': '.dsh/profile.yaml not found',
      'settings.title': 'Workspace rules',
      'settings.subtitle': 'Manage rule packs, personal settings, and the injection preview. The team layer is read-only.',
      'settings.noWorkspace': 'No workspace bound',
      'statusbar.title': 'Workspace rules',
      'statusbar.emptyTitle': 'No workspace identified',
      'statusbar.noRepo': 'The current workspace has no repository',
      'statusbar.openHint': 'Click to open the quick preview',
      'overlay.title': 'Workspace profile',
      'overlay.noSession': 'Open a session first; the plugin resolves the workspace from the session current directory.',
      'error.prefix': 'Operation failed: ',
    }

    function fill(text, params) {
      if (!params) return text
      return text.replace(/\{(\w+)\}/g, (match, key) => (params[key] === undefined ? match : String(params[key])))
    }

    // ---------------------------------------------------------------------
    // Host API
    // ---------------------------------------------------------------------

    async function callApiAt(base, path, body, timeoutMs) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      try {
        const response = await fetch(`${base}${path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body ?? {}),
          signal: controller.signal,
        })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const payload = await response.json()
        if (!payload || payload.ok !== true) {
          const message = payload?.error?.message || `HTTP ${response.status}`
          throw new Error(message)
        }
        return payload.value
      } finally {
        clearTimeout(timer)
      }
    }

    async function callApi(path, body = {}, timeoutMs = 20_000) {
      let lastError
      for (const base of ['/api/visualrules', API_BASE]) {
        try {
          return await callApiAt(base, path, body, timeoutMs)
        } catch (error) {
          lastError = error
        }
      }
      throw lastError instanceof Error ? lastError : new Error(String(lastError))
    }

    // ---------------------------------------------------------------------
    // Client data store
    // ---------------------------------------------------------------------

    function createStore(ctx) {
      let state = {
        revision: 0,
        cwd: '',
        sessionId: '',
        profile: null,
        profileStatus: 'idle',
        profileError: '',
        library: null,
        libraryStatus: 'idle',
        libraryError: '',
        preview: null,
        previewStatus: 'idle',
        previewError: '',
        validation: null,
        validationStatus: 'idle',
        validationError: '',
        hookPreview: null,
        overlayOpen: false,
        pendingTab: null,
        hasRightSidebar: false,
      }
      const listeners = new Set()
      const inflight = new Map()
      let profileSeq = 0
      let librarySeq = 0
      let previewSeq = 0
      let validationSeq = 0

      function emit(patch) {
        state = { ...state, ...patch, revision: state.revision + 1 }
        for (const listener of [...listeners]) {
          try {
            listener()
          } catch {
            /* a broken subscriber must not stop the others */
          }
        }
      }

      function subscribe(listener) {
        listeners.add(listener)
        return () => listeners.delete(listener)
      }

      function getSnapshot() {
        return state
      }

      function targetKey(target) {
        return target.cwd ? `cwd:${target.cwd}` : target.sessionId ? `session:${target.sessionId}` : ''
      }

      async function once(kind, key, run) {
        const inflightKey = `${kind}:${key}`
        const existing = inflight.get(inflightKey)
        if (existing) return existing
        const promise = Promise.resolve()
          .then(run)
          .finally(() => inflight.delete(inflightKey))
        inflight.set(inflightKey, promise)
        return promise
      }

      async function refreshProfile(target = {}, options = {}) {
        const key = targetKey(target)
        if (!key) return null
        const quiet = options.quiet === true
        const seq = ++profileSeq
        if (!quiet) {
          emit({
            profileStatus: 'loading',
            profileError: '',
            ...(state.cwd && state.cwd !== target.cwd ? { profile: null } : {}),
          })
        }
        try {
          const value = await once('profile', key, () => callApi('/profile', target))
          if (seq !== profileSeq) return value.profile
          emit({
            cwd: value.profile.cwd,
            sessionId: value.profile.sessionId || target.sessionId || '',
            profile: value.profile,
            profileStatus: 'ready',
            profileError: '',
          })
          return value.profile
        } catch (error) {
          if (seq !== profileSeq) return null
          emit({ profileStatus: 'error', profileError: error instanceof Error ? error.message : String(error) })
          return null
        }
      }

      async function loadLibrary(target = {}, options = {}) {
        const key = targetKey(target) || 'global'
        const seq = ++librarySeq
        if (state.libraryStatus !== 'ready' || options.force) emit({ libraryStatus: 'loading', libraryError: '' })
        try {
          const value = await once('library', key, () => callApi('/library', target))
          if (seq !== librarySeq) return value
          emit({ library: value, libraryStatus: 'ready', libraryError: '' })
          return value
        } catch (error) {
          if (seq !== librarySeq) return null
          emit({ libraryStatus: 'error', libraryError: error instanceof Error ? error.message : String(error) })
          return null
        }
      }

      async function loadPreview(target = {}, options = {}) {
        const key = targetKey(target) || 'global'
        const seq = ++previewSeq
        if (!options.quiet) emit({ previewStatus: 'loading', previewError: '' })
        try {
          const value = await once('preview', key, () => callApi('/preview', target))
          if (seq !== previewSeq) return value
          emit({ preview: value, previewStatus: 'ready', previewError: '' })
          return value
        } catch (error) {
          if (seq !== previewSeq) return null
          emit({ previewStatus: 'error', previewError: error instanceof Error ? error.message : String(error) })
          return null
        }
      }

      async function loadValidation(target = {}, options = {}) {
        const key = targetKey(target) || 'global'
        const seq = ++validationSeq
        if (!options.quiet) emit({ validationStatus: 'loading', validationError: '' })
        try {
          const value = await once('validation', key, () => callApi('/validation/status', target))
          if (seq !== validationSeq) return value
          emit({ validation: value, validationStatus: 'ready', validationError: '' })
          return value
        } catch (error) {
          if (seq !== validationSeq) return null
          emit({ validationStatus: 'error', validationError: error instanceof Error ? error.message : String(error) })
          return null
        }
      }

      async function saveValidation(patch, target) {
        const value = await callApi('/validation/save', { ...patch, ...target })
        if (value.status) emit({ validation: value.status, validationStatus: 'ready', validationError: '' })
        else await loadValidation(target, { force: true })
        await refreshProfile(target, { quiet: true })
        return value
      }

      async function checkProposal(payload, target) {
        return callApi('/validation/check', { ...payload, ...target })
      }

      async function createBypass(payload, target) {
        const value = await callApi('/bypass/create', { ...payload, ...target })
        await loadValidation(target, { quiet: true })
        return value
      }

      async function revokeBypass(id, target) {
        const value = await callApi('/bypass/revoke', { id })
        await loadValidation(target, { quiet: true })
        return value
      }

      async function loadHookPreview() {
        const value = await callApi('/hook/preview')
        emit({ hookPreview: value })
        return value
      }

      async function installHook(target) {
        const value = await callApi('/hook/install', target)
        await loadValidation(target, { quiet: true })
        return value
      }

      async function uninstallHook(target) {
        const value = await callApi('/hook/uninstall', target)
        await loadValidation(target, { quiet: true })
        return value
      }

      async function loadCommits(target, options = {}) {
        const value = await callApi('/commits/list', { ...target, limit: options.limit })
        await loadValidation(target, { quiet: true })
        return value
      }

      async function deleteCommit(hash, target) {
        const value = await callApi('/commits/delete', { hash })
        await loadValidation(target, { quiet: true })
        return value
      }

      async function clearCommits(target) {
        const value = await callApi('/commits/clear')
        await loadValidation(target, { quiet: true })
        return value
      }

      async function refreshEverything(target, options = {}) {
        await Promise.all([
          refreshProfile(target, options),
          loadLibrary(target, options),
          loadPreview(target, options),
          loadValidation(target, { quiet: true }),
        ])
      }

      async function savePack(pack, target) {
        const value = await callApi('/packs/save', { ...pack, ...target })
        await Promise.all([loadLibrary(target, { force: true }), refreshProfile(target, { quiet: true })])
        return value
      }

      async function deletePack(id, target) {
        const value = await callApi('/packs/delete', { id, ...target })
        await Promise.all([loadLibrary(target, { force: true }), refreshProfile(target, { quiet: true })])
        return value
      }

      async function saveWorkspace(patch, target) {
        const value = await callApi('/workspace/save', { ...patch, ...target })
        await Promise.all([
          refreshProfile(target, { force: true }),
          loadLibrary(target, { force: true }),
          loadPreview(target, { quiet: true }),
        ])
        return value
      }

      async function togglePack(packId, enabled, target) {
        const value = await callApi('/workspace/toggle', { packId, enabled, ...target })
        await Promise.all([
          refreshProfile(target, { force: true, quiet: true }),
          loadLibrary(target, { force: true }),
          loadPreview(target, { quiet: true }),
        ])
        return value
      }

      function setOverlay(open) {
        emit({ overlayOpen: open === true })
      }

      function setPendingTab(tab) {
        emit({ pendingTab: tab })
      }

      function clearPendingTab() {
        if (state.pendingTab === null) return
        emit({ pendingTab: null })
      }

      return {
        subscribe,
        getSnapshot,
        refreshProfile,
        loadLibrary,
        loadPreview,
        loadValidation,
        saveValidation,
        checkProposal,
        createBypass,
        revokeBypass,
        loadHookPreview,
        installHook,
        uninstallHook,
        loadCommits,
        deleteCommit,
        clearCommits,
        refreshEverything,
        savePack,
        deletePack,
        saveWorkspace,
        togglePack,
        setOverlay,
        setPendingTab,
        clearPendingTab,
      }
    }

    function useVR(vr) {
      return useSyncExternalStore(vr.subscribe, vr.getSnapshot, vr.getSnapshot)
    }

    // ---------------------------------------------------------------------
    // Small utilities
    // ---------------------------------------------------------------------

    function classNames(...values) {
      return values.filter(Boolean).join(' ')
    }

    function scopeLabel(t, scope) {
      if (scope === 'repo') return t('value.repo')
      if (scope === 'global') return t('value.global')
      if (scope === 'system') return t('value.system')
      if (scope === 'command') return t('value.command')
      if (scope === 'personal') return t('value.personal')
      if (scope === 'team') return t('value.team')
      if (scope === 'team-rules') return t('value.teamRules')
      if (scope === 'workspace') return t('value.workspace')
      return scope || t('common.unknown')
    }

    function envLabel(t, levelOrName) {
      const key = String(levelOrName || 'none').toLowerCase()
      if (key === 'dev' || key === 'test' || key === 'staging' || key === 'prod') return t(`env.${key}`)
      if (key === 'info') return t('env.info')
      return t('env.none')
    }

    function envClass(levelOrName) {
      const key = String(levelOrName || 'none').toLowerCase()
      if (key === 'dev') return 'vr-env-dev'
      if (key === 'test') return 'vr-env-test'
      if (key === 'staging' || key === 'warn') return 'vr-env-staging'
      if (key === 'prod' || key === 'production' || key === 'prd' || key === 'danger') return 'vr-env-prod'
      if (key === 'info') return 'vr-env-info'
      return 'vr-env-none'
    }

    function isProdLevel(levelOrName) {
      return envClass(levelOrName) === 'vr-env-prod'
    }

    function basename(p) {
      if (typeof p !== 'string' || p === '') return ''
      const parts = p.split(/[\\/]/).filter(Boolean)
      return parts[parts.length - 1] ?? p
    }

    function formatTime(value, locale) {
      if (!Number.isFinite(value)) return ''
      try {
        return new Date(value).toLocaleString(locale === 'zh' ? 'zh-CN' : undefined, {
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        })
      } catch {
        return ''
      }
    }

    function formatNumber(value) {
      return Number.isFinite(value) ? new Intl.NumberFormat().format(value) : '0'
    }

    function currentSessionId(snapshot) {
      if (!snapshot || typeof snapshot !== 'object') return ''
      // Newer DSH builds mark the foreground Session by its main-view retention
      // instead of exposing a `current` id.
      if (typeof snapshot.current === 'string' && snapshot.current !== '') return snapshot.current
      const byId = snapshot.byId
      if (byId && typeof byId === 'object') {
        for (const [id, item] of Object.entries(byId)) {
          if ((item?.retainedBy?.mainView ?? 0) > 0) return id
        }
        for (const [id, item] of Object.entries(byId)) {
          if (item?.current === true) return id
        }
      }
      return ''
    }

    function currentCwd(snapshot) {
      if (!snapshot || typeof snapshot !== 'object') return ''
      const current = currentSessionId(snapshot)
      const item = current && snapshot.byId ? snapshot.byId[current] : undefined
      return typeof item?.cwd === 'string' ? item.cwd : ''
    }

    async function copyText(text) {
      try {
        await navigator.clipboard.writeText(text)
        return true
      } catch {
        try {
          const area = document.createElement('textarea')
          area.value = text
          area.style.position = 'fixed'
          area.style.opacity = '0'
          document.body.appendChild(area)
          area.select()
          const ok = document.execCommand('copy')
          area.remove()
          return ok
        } catch {
          return false
        }
      }
    }

    // A built-in starter pack keeps a fresh workspace useful without asking the
    // user to write Markdown first. It is only a local personal pack; the team
    // layer stays read-only.
    function defaultPackDraft(t, existingIds) {
      let id = 'personal/general'
      let index = 2
      while (existingIds && existingIds.has(id)) {
        id = `personal/general-${index}`
        index += 1
      }
      return {
        id,
        title: t('defaults.packTitle'),
        description: t('defaults.packDescription'),
        content: t('defaults.packContent'),
        globalEnabled: false,
      }
    }

    function findDefaultPack(packs, t) {
      return (packs || []).find(
        (pack) => pack.title === t('defaults.packTitle') && pack.description === t('defaults.packDescription'),
      )
    }

    async function enableDefaultPack(vr, t, target) {
      const library = await vr.loadLibrary(target, { force: true })
      const personal = library?.personalPacks ?? []
      const existing = findDefaultPack(personal, t)
      if (existing) {
        await vr.togglePack(existing.id, true, target)
        return existing
      }
      const draft = defaultPackDraft(t, new Set(personal.map((pack) => pack.id)))
      await vr.savePack(draft, target)
      await vr.togglePack(draft.id, true, target)
      return draft
    }

    // ---------------------------------------------------------------------
    // Icons (original artwork)
    // ---------------------------------------------------------------------

    function ShieldIcon({ size = 16, className }) {
      return h(
        'svg',
        { viewBox: '0 0 24 24', width: size, height: size, className, 'aria-hidden': true, fill: 'none' },
        h('path', {
          d: 'M12 2.5 20.5 5.6v6.1c0 4.7-3.2 8.3-8.5 10.1C6.7 20 3.5 16.4 3.5 11.7V5.6L12 2.5Z',
          stroke: 'currentColor',
          strokeWidth: 1.6,
          strokeLinejoin: 'round',
        }),
        h('path', {
          d: 'm8 11.6 2.6 2.6 5.3-5.5',
          stroke: 'currentColor',
          strokeWidth: 1.8,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
      )
    }

    function RefreshIcon({ size = 14 }) {
      return h(
        'svg',
        { viewBox: '0 0 24 24', width: size, height: size, 'aria-hidden': true, fill: 'none' },
        h('path', {
          d: 'M20 11a8 8 0 1 0-2.3 6.2M20 5v6h-6',
          stroke: 'currentColor',
          strokeWidth: 1.7,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
      )
    }

    function CopyIcon({ size = 14 }) {
      return h(
        'svg',
        { viewBox: '0 0 24 24', width: size, height: size, 'aria-hidden': true, fill: 'none' },
        h('rect', { x: 9, y: 9, width: 11, height: 11, rx: 2, stroke: 'currentColor', strokeWidth: 1.6 }),
        h('path', { d: 'M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3', stroke: 'currentColor', strokeWidth: 1.6 }),
      )
    }

    function CloseIcon({ size = 14 }) {
      return h(
        'svg',
        { viewBox: '0 0 24 24', width: size, height: size, 'aria-hidden': true, fill: 'none' },
        h('path', { d: 'M6 6l12 12M18 6 6 18', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' }),
      )
    }

    function PlusIcon({ size = 14 }) {
      return h(
        'svg',
        { viewBox: '0 0 24 24', width: size, height: size, 'aria-hidden': true, fill: 'none' },
        h('path', { d: 'M12 5v14M5 12h14', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' }),
      )
    }

    function TrashIcon({ size = 14 }) {
      return h(
        'svg',
        { viewBox: '0 0 24 24', width: size, height: size, 'aria-hidden': true, fill: 'none' },
        h('path', {
          d: 'M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12M10 11v5M14 11v5',
          stroke: 'currentColor',
          strokeWidth: 1.6,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
      )
    }

    function ExternalIcon({ size = 14 }) {
      return h(
        'svg',
        { viewBox: '0 0 24 24', width: size, height: size, 'aria-hidden': true, fill: 'none' },
        h('path', {
          d: 'M14 5h5v5M19 5l-8 8M18 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h4',
          stroke: 'currentColor',
          strokeWidth: 1.6,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
      )
    }

    function InfoIcon({ size = 14 }) {
      return h(
        'svg',
        { viewBox: '0 0 24 24', width: size, height: size, 'aria-hidden': true, fill: 'none' },
        h('circle', { cx: 12, cy: 12, r: 9, stroke: 'currentColor', strokeWidth: 1.6 }),
        h('path', { d: 'M12 11v6M12 7.5v.5', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' }),
      )
    }

    function AlertCircleIcon({ size = 14 }) {
      return h(
        'svg',
        { viewBox: '0 0 24 24', width: size, height: size, 'aria-hidden': true, fill: 'none' },
        h('circle', { cx: 12, cy: 12, r: 9, stroke: 'currentColor', strokeWidth: 1.6 }),
        h('path', { d: 'M12 7.5v6M12 16.5v.5', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round' }),
      )
    }

    function WarnIcon({ size = 14 }) {
      return h(
        'svg',
        { viewBox: '0 0 24 24', width: size, height: size, 'aria-hidden': true, fill: 'none' },
        h('path', {
          d: 'M12 3.5 21 20H3L12 3.5Z',
          stroke: 'currentColor',
          strokeWidth: 1.6,
          strokeLinejoin: 'round',
        }),
        h('path', { d: 'M12 9v5M12 17v.5', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' }),
      )
    }

    function CheckIcon({ size = 14 }) {
      return h(
        'svg',
        { viewBox: '0 0 24 24', width: size, height: size, 'aria-hidden': true, fill: 'none' },
        h('path', { d: 'm5 12.5 4.5 4.5L19 7.5', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round', strokeLinejoin: 'round' }),
      )
    }

    // ---------------------------------------------------------------------
    // Render guard
    // ---------------------------------------------------------------------

    // A plugin view must never blank a host slot. This boundary keeps a
    // rendering fault local to the plugin's own control and prints the exact
    // message so a support report can name it.
    class VisualRulesBoundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { error: null }
      }

      static getDerivedStateFromError(error) {
        return { error }
      }

      componentDidCatch(error, info) {
        try {
          console.error('[visualrules] render failed', error, info)
        } catch {
          /* console may be unavailable */
        }
      }

      render() {
        if (this.state.error) {
          const message = this.state.error instanceof Error ? this.state.error.message : String(this.state.error)
          return h(
            'div',
            { className: 'vr-crash', role: 'alert', title: message },
            h(WarnIcon, { size: 13 }),
            h('span', null, `VisualRules: ${message}`),
          )
        }
        return this.props.children
      }
    }

    function guarded(Component) {
      function VisualRulesGuarded(props) {
        return h(VisualRulesBoundary, null, h(Component, props))
      }
      VisualRulesGuarded.displayName = `VisualRules(${Component.displayName || Component.name || 'view'})`
      return VisualRulesGuarded
    }

    // ---------------------------------------------------------------------
    // Shared UI
    // ---------------------------------------------------------------------

    function EnvChip({ t, env, size }) {
      if (!env || !env.name) {
        return h('span', { className: classNames('vr-chip', 'vr-chip-muted', size === 'sm' && 'vr-chip-sm') }, t('env.none'))
      }
      return h(
        'span',
        {
          className: classNames('vr-chip', 'vr-env-chip', envClass(env.level || env.name), size === 'sm' && 'vr-chip-sm', isProdLevel(env.level || env.name) && 'vr-chip-pulse'),
          title: `${env.name}${env.source ? ` · ${env.source}` : ''}`,
        },
        h('span', { className: 'vr-dot' }),
        env.name,
      )
    }

    function Badge({ count }) {
      if (!count) return null
      return h('span', { className: 'vr-badge' }, count > 99 ? '99+' : String(count))
    }

    function Button({ children, onClick, variant, size, disabled, title, icon, type = 'button', className }) {
      return h(
        'button',
        {
          type,
          className: classNames('vr-btn', variant && `vr-btn-${variant}`, size && `vr-btn-${size}`, className),
          onClick,
          disabled: disabled === true,
          title,
        },
        icon ? h('span', { className: 'vr-btn-icon' }, icon) : null,
        children ? h('span', null, children) : null,
      )
    }

    function IconButton({ label, onClick, icon, variant, disabled }) {
      return h(
        'button',
        {
          type: 'button',
          className: classNames('vr-icon-btn', variant && `vr-icon-btn-${variant}`),
          onClick,
          title: label,
          'aria-label': label,
          disabled: disabled === true,
        },
        icon,
      )
    }

    function Switch({ checked, onChange, label, disabled }) {
      return h(
        'button',
        {
          type: 'button',
          role: 'switch',
          'aria-checked': checked === true,
          'aria-label': label,
          title: label,
          className: classNames('vr-switch', checked && 'vr-switch-on'),
          onClick: () => {
            if (!disabled) onChange(!checked)
          },
          disabled: disabled === true,
        },
        h('span', { className: 'vr-switch-track' }, h('span', { className: 'vr-switch-thumb' })),
      )
    }

    function Skeleton({ rows = 3 }) {
      return h(
        'div',
        { className: 'vr-skeleton' },
        Array.from({ length: rows }, (_, index) => h('div', { key: index, className: classNames('vr-skeleton-row', index === 0 && 'vr-skeleton-row-lg') })),
      )
    }

    function Notice({ tone = 'info', title, children, icon, actions }) {
      return h(
        'div',
        { className: classNames('vr-notice', `vr-notice-${tone}`) },
        h('span', { className: 'vr-notice-icon' }, icon || (tone === 'warn' || tone === 'error' ? h(WarnIcon, { size: 15 }) : h(InfoIcon, { size: 15 }))),
        h(
          'div',
          { className: 'vr-notice-body' },
          title ? h('div', { className: 'vr-notice-title' }, title) : null,
          children ? h('div', { className: 'vr-notice-text' }, children) : null,
        ),
        actions ? h('div', { className: 'vr-notice-actions' }, actions) : null,
      )
    }

    function Card({ title, subtitle, actions, children, span, className }) {
      return h(
        'section',
        { className: classNames('vr-card', span === 2 && 'vr-span-2', className) },
        title || actions
          ? h(
              'header',
              { className: 'vr-card-head' },
              h('div', null, h('h3', { className: 'vr-card-title' }, title), subtitle ? h('p', { className: 'vr-card-subtitle' }, subtitle) : null),
              actions ? h('div', { className: 'vr-card-actions' }, actions) : null,
            )
          : null,
        h('div', { className: 'vr-card-body' }, children),
      )
    }

    function Row({ label, children, mono, muted, actions }) {
      return h(
        'div',
        { className: 'vr-row' },
        h('div', { className: 'vr-row-label' }, label),
        h('div', { className: classNames('vr-row-value', mono && 'vr-mono', muted && 'vr-muted') }, children),
        actions ? h('div', { className: 'vr-row-actions' }, actions) : null,
      )
    }

    function EmptyState({ title, body, actions }) {
      return h(
        'div',
        { className: 'vr-empty' },
        h(ShieldIcon, { size: 28, className: 'vr-empty-icon' }),
        title ? h('div', { className: 'vr-empty-title' }, title) : null,
        body ? h('div', { className: 'vr-empty-body' }, body) : null,
        actions ? h('div', { className: 'vr-empty-actions' }, actions) : null,
      )
    }

    function Chips({ items, render }) {
      if (!items || items.length === 0) return null
      return h('div', { className: 'vr-chips' }, items.map((item, index) => h('span', { key: index, className: 'vr-chip vr-chip-sm' }, render ? render(item) : item)))
    }

    function WarningList({ t, warnings, limit, includeInfo, onConfigure, alert }) {
      const list = (warnings || []).filter((warning) => includeInfo === true || warning.severity !== 'info')
      if (list.length === 0) {
        return h('div', { className: 'vr-ok-line' }, h(CheckIcon, { size: 14 }), h('span', null, t('empty.noWarnings')))
      }
      const shown = limit ? list.slice(0, limit) : list
      return h(
        'div',
        { className: 'vr-warning-list' },
        shown.map((warning, index) =>
          h(
            'div',
            { key: `${warning.id || warning.message}:${index}`, className: classNames('vr-warning', `vr-warning-${warning.severity}`) },
            h(
              'span',
              { className: classNames('vr-warning-icon', alert && 'vr-warning-icon-alert') },
              alert ? h(AlertCircleIcon, { size: 15 }) : warning.severity === 'info' ? h(InfoIcon, { size: 14 }) : h(WarnIcon, { size: 14 }),
            ),
            h(
              'div',
              { className: 'vr-warning-body' },
              h('div', { className: 'vr-warning-title' }, warning.title),
              h('div', { className: 'vr-warning-text' }, warning.message),
            ),
          ),
        ),
        limit && list.length > limit
          ? h(
              'div',
              { className: 'vr-warning-more' },
              h('span', null, t('warn.count').replace('{count}', String(list.length - limit))),
              onConfigure ? h('button', { type: 'button', className: 'vr-link', onClick: onConfigure }, t('warn.configure')) : null,
            )
          : null,
      )
    }

    function DefaultPackButton({ t, vr, target, variant = 'primary', size }) {
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState('')
      if (!target?.cwd && !target?.sessionId) return null
      async function run() {
        setBusy(true)
        setError('')
        try {
          await enableDefaultPack(vr, t, target)
        } catch (failure) {
          setError(failure instanceof Error ? failure.message : String(failure))
        } finally {
          setBusy(false)
        }
      }
      return h(
        'div',
        { className: 'vr-default-pack' },
        h(
          Button,
          {
            variant,
            size,
            icon: h(PlusIcon),
            disabled: busy,
            title: t('defaults.hint'),
            onClick: run,
          },
          busy ? t('defaults.enablingPack') : t('defaults.enablePack'),
        ),
        error ? h('span', { className: 'vr-default-pack-error' }, error) : null,
      )
    }

    function useTarget(props) {
      const sessions = props.useSessions ? props.useSessions((value) => value) : null
      const panelInfo = props.usePanelInfo ? props.usePanelInfo((value) => value) : null
      const storeSnapshot = props.vr ? useVR(props.vr) : null
      let cwd = currentCwd(sessions)
      let sessionId = currentSessionId(sessions)
      // A global main panel (including this plugin's full profile page) removes
      // the conversation's main-view retention. Keep the last resolved target
      // so the page and the session-header entry do not lose their workspace.
      if ((!cwd || !sessionId) && panelInfo && panelInfo.activePanelId != null && storeSnapshot) {
        cwd = storeSnapshot.cwd || cwd
        sessionId = storeSnapshot.sessionId || sessionId
      }
      return { cwd, sessionId, sessions, panelActive: Boolean(panelInfo && panelInfo.activePanelId != null) }
    }

    function profileMatches(profile, target) {
      if (!profile) return false
      if (target.sessionId && profile.sessionId) return profile.sessionId === target.sessionId
      if (target.cwd && profile.cwd) return profile.cwd === target.cwd
      return true
    }

    // ---------------------------------------------------------------------
    // Session-header entry
    // ---------------------------------------------------------------------

    function toggleQuickPreview(ctx, vr, cwd, sessionId) {
      if (vr.getSnapshot().overlayOpen) {
        vr.setOverlay(false)
        return
      }
      const right = (() => {
        try {
          return ctx.get('sidebarRight')
        } catch {
          return undefined
        }
      })()
      if (right && typeof right.openTab === 'function' && (cwd || sessionId)) {
        try {
          const active = typeof right.active === 'function' ? right.active() : undefined
          const expanded = typeof right.isExpanded === 'function' ? right.isExpanded() : false
          const activeKind = active?.kind ?? active?.tab?.kind
          const activeId = active?.id ?? active?.tab?.id
          if (expanded && activeKind === PREVIEW_KIND && activeId && typeof right.close === 'function') {
            right.close(activeId)
            return
          }
          right.openTab(PREVIEW_KIND)
          return
        } catch {
          /* fall back to the overlay */
        }
      }
      vr.setOverlay(!vr.getSnapshot().overlayOpen)
    }

    function HeaderEntry(props) {
      const { t, vr, ctx } = props
      const { cwd, sessionId } = useTarget(props)
      const snapshot = useVR(vr)
      useEffect(() => {
        if (cwd || sessionId) vr.refreshProfile({ cwd, sessionId }, { quiet: Boolean(snapshot.profile) })
      }, [cwd, sessionId])
      const profile = profileMatches(snapshot.profile, { cwd, sessionId }) ? snapshot.profile : null
      const env = profile?.environment
      const email = profile?.identity?.actual?.email || ''
      const name = profile?.repo?.name || basename(profile?.cwd || cwd)
      const level = env?.level || 'none'
      const title = profile
        ? fill(t('status.tooltip'), {
            name: name || t('common.unknown'),
            env: env?.name || envLabel(t, level),
            email: email || t('common.none'),
          })
        : t('statusbar.openHint')
      const loading = snapshot.profileStatus === 'loading' && !profile
      const failed = snapshot.profileStatus === 'error' && !profile
      const status = !cwd && !sessionId ? 'empty' : failed ? 'error' : profile ? 'ready' : 'loading'
      const badgeCount = profile?.badgeCount ?? 0
      const ariaLabel = badgeCount > 0 ? `${title} · ${fill(t('status.badge'), { count: badgeCount })}` : title
      return h(
        'button',
        {
          type: 'button',
          'data-vr-status': '1',
          'data-status': status,
          className: classNames(
            'vr-header-btn',
            snapshot.overlayOpen && 'vr-header-btn-open',
            status === 'empty' && 'vr-header-btn-empty',
            status === 'error' && 'vr-header-btn-error',
            profile && !profile.repo.isGit && 'vr-header-btn-nogit',
          ),
          title,
          'aria-label': ariaLabel,
          onClick: () => {
            if (!cwd && !sessionId) {
              vr.setOverlay(!vr.getSnapshot().overlayOpen)
              return
            }
            toggleQuickPreview(ctx, vr, cwd, sessionId)
          },
        },
        h(ShieldIcon, { size: 16, className: 'vr-header-icon' }),
        h('span', {
          className: classNames(
            'vr-dot',
            'vr-header-dot',
            envClass(level),
            loading && 'vr-dot-loading',
            isProdLevel(level) && 'vr-dot-pulse',
          ),
        }),
        h(Badge, { count: badgeCount }),
      )
    }

    // ---------------------------------------------------------------------
    // Quick preview (right sidebar tab body and overlay fallback)
    // ---------------------------------------------------------------------

    function QuickSection({ title, meta, children }) {
      return h(
        'section',
        { className: 'vr-quick-section' },
        h(
          'div',
          { className: 'vr-quick-section-head' },
          h('h3', { className: 'vr-quick-section-title' }, title),
          meta ? h('span', { className: 'vr-quick-section-meta' }, meta) : null,
        ),
        h('div', { className: 'vr-quick-section-body' }, children),
      )
    }

    function QuickPreviewContent({ t, vr, ctx, target, compact }) {
      const snapshot = useVR(vr)
      useEffect(() => {
        if (!target.cwd && !target.sessionId) return
        vr.refreshProfile(target, { quiet: Boolean(snapshot.profile) })
      }, [target.cwd, target.sessionId])
      const profile = profileMatches(snapshot.profile, target) ? snapshot.profile : null
      if (snapshot.profileStatus === 'loading' && !profile) {
        return h('div', { className: 'vr-quick' }, h(Skeleton, { rows: 5 }))
      }
      if (!target.cwd && !target.sessionId) {
        return h(EmptyState, { title: t('statusbar.emptyTitle'), body: t('overlay.noSession') })
      }
      if (snapshot.profileStatus === 'error' && !profile) {
        return h(
          EmptyState,
          {
            title: t('status.error'),
            body: snapshot.profileError,
            actions: h(Button, { variant: 'primary', size: 'sm', onClick: () => vr.refreshProfile(target, { force: true }), icon: h(RefreshIcon) }, t('common.retry')),
          },
        )
      }
      if (!profile) return h(Skeleton, { rows: 5 })
      const repo = profile.repo
      const env = profile.environment
      const rules = profile.rules
      const injected = {
        packs: [],
        totalChars: 0,
        maxChars: 0,
        truncated: false,
        ...(profile.injection || {}),
      }
      if (!Array.isArray(injected.packs)) injected.packs = []
      const charsUnit = t('label.chars').replace('{count}', '').trim()
      const packLimit = compact ? 4 : 8
      return h(
        'div',
        { className: 'vr-quick' },
        h(
          'div',
          { className: 'vr-quick-head' },
          h(
            'div',
            { className: 'vr-quick-title-wrap' },
            h('div', { className: 'vr-quick-title' }, repo.name || basename(profile.cwd)),
            h('div', { className: 'vr-quick-path', title: profile.cwd }, profile.cwd),
          ),
          h('div', { className: 'vr-quick-head-actions' }, h(EnvChip, { t, env, size: 'sm' }), h(IconButton, { label: t('common.refresh'), icon: h(RefreshIcon), onClick: () => vr.refreshProfile(target, { force: true }) })),
        ),
        repo.isGit
          ? h(
              QuickSection,
              {
                title: t('section.identity'),
                meta: `${t('label.source')} · ${scopeLabel(t, profile.identity.actual.emailScope)}`,
              },
              h(Row, { label: 'user.name', mono: true }, profile.identity.actual.name || h('span', { className: 'vr-muted' }, t('common.none'))),
              h(Row, { label: 'user.email', mono: true }, profile.identity.actual.email || h('span', { className: 'vr-muted' }, t('common.none'))),
            )
          : null,
        h(
          QuickSection,
          { title: t('section.branch') },
          repo.isGit
            ? h(Row, { label: t('label.branch'), mono: true }, repo.branch || repo.sha || t('value.detached'))
            : h(Row, { label: t('label.branch'), mono: true }, h('span', { className: 'vr-muted' }, t('value.notConfigured'))),
          repo.isGit ? null : h('div', { className: 'vr-quick-empty' }, t('empty.noRepo')),
          repo.isGit && repo.remote.url
            ? h(Row, { label: t('label.remote'), mono: true }, h('span', { className: 'vr-truncate', title: repo.remote.url }, repo.remote.url))
            : null,
          repo.isGit && (repo.ahead > 0 || repo.behind > 0 || repo.protected)
            ? h(
                'div',
                { className: 'vr-quick-inline' },
                h('span', { className: classNames('vr-pill', repo.ahead > 0 && 'vr-pill-warn') }, `↑ ${repo.ahead ?? 0}`),
                h('span', { className: classNames('vr-pill', repo.behind > 0 && 'vr-pill-warn') }, `↓ ${repo.behind ?? 0}`),
                repo.protected ? h('span', { className: 'vr-pill vr-pill-danger' }, t('label.protected')) : null,
              )
            : null,
        ),
        h(
          QuickSection,
          { title: t('section.environment') },
          h(Row, { label: t('label.environment') }, h(EnvChip, { t, env, size: 'sm' })),
          env.host
            ? h(Row, { label: t('label.host'), mono: true }, `${env.user ? `${env.user}@` : ''}${env.host}${env.port ? `:${env.port}` : ''}`)
            : h('div', { className: 'vr-quick-note' }, t('personal.showServerInfoHint')),
        ),
        h(
          QuickSection,
          { title: t('section.rules') },
          rules
            ? h(
                'div',
                { className: 'vr-rule-mini' },
                rules.branchPattern ? h('div', null, `${t('label.branchPattern')}：`, h('code', null, rules.branchPattern)) : null,
                rules.commitFormat ? h('div', null, `${t('label.commitFormat')}：`, h('code', null, rules.commitFormat)) : null,
                rules.protectedBranches?.length ? h('div', null, `${t('label.protected')}：`, rules.protectedBranches.join('、')) : null,
                rules.reviewMin !== null && rules.reviewMin !== undefined ? h('div', null, `${t('label.review')}：${rules.reviewMin}`) : null,
              )
            : h('div', { className: 'vr-quick-empty' }, t('empty.noConfig')),
        ),
        h(
          QuickSection,
          {
            title: t('section.injection'),
            meta: `${formatNumber(injected.totalChars)} / ${formatNumber(injected.maxChars)} ${charsUnit}`,
          },
          injected.packs.length > 0
            ? h(
                'div',
                { className: 'vr-quick-packs' },
                injected.packs.slice(0, packLimit).map((pack) => h('span', { key: `${pack.scope}:${pack.id}`, className: 'vr-chip vr-chip-sm', title: pack.id }, `${pack.title} · ${scopeLabel(t, pack.scope)}`)),
                injected.packs.length > packLimit ? h('span', { className: 'vr-chip vr-chip-sm vr-chip-muted' }, `+${injected.packs.length - packLimit}`) : null,
              )
            : h('div', { className: 'vr-quick-empty' }, t('empty.noPacks')),
          injected.packs.length === 0 ? h(DefaultPackButton, { t, vr, target, size: 'sm', variant: 'secondary' }) : null,
          injected.truncated ? h('div', { className: 'vr-quick-note vr-warn-text' }, t('preview.truncated')) : null,
        ),
        profile.badgeCount > 0
          ? h(
              QuickSection,
              { title: t('section.warnings') },
              h(WarningList, { t, warnings: profile.warnings, limit: 3, onConfigure: () => openProfile(ctx, vr, 'personal') }),
            )
          : null,
        h(
          'div',
          { className: 'vr-quick-actions' },
          h(Button, { variant: 'primary', icon: h(ExternalIcon), onClick: () => openProfile(ctx, vr, 'overview') }, t('action.openProfile')),
          h(Button, { onClick: () => openProfile(ctx, vr, 'personal') }, t('action.editConfig')),
        ),
      )
    }

    function QuickPreviewTab(props) {
      const { t, vr, ctx, sessionId } = props
      const fallback = useTarget(props)
      const target = sessionId ? { sessionId } : { cwd: fallback.cwd, sessionId: fallback.sessionId }
      return h(QuickPreviewContent, { t, vr, ctx, target, compact: true })
    }

    function QuickPreviewOverlay(props) {
      const { t, vr, ctx } = props
      const snapshot = useVR(vr)
      const { cwd, sessionId } = useTarget(props)
      const panelRef = useRef(null)
      useEffect(() => {
        if (!snapshot.overlayOpen) return
        function onPointer(event) {
          const target = event.target
          if (target && typeof target.closest === 'function' && target.closest('[data-vr-status]')) return
          if (panelRef.current && !panelRef.current.contains(target)) vr.setOverlay(false)
        }
        function onKey(event) {
          if (event.key === 'Escape') vr.setOverlay(false)
        }
        document.addEventListener('mousedown', onPointer)
        document.addEventListener('keydown', onKey)
        return () => {
          document.removeEventListener('mousedown', onPointer)
          document.removeEventListener('keydown', onKey)
        }
      }, [snapshot.overlayOpen])
      if (!snapshot.overlayOpen) return null
      return h(
        'div',
        { className: 'vr-overlay-layer' },
        h(
          'div',
          { className: 'vr-overlay-panel', ref: panelRef },
          h(
            'div',
            { className: 'vr-overlay-head' },
            h('div', { className: 'vr-overlay-title' }, h(ShieldIcon, { size: 16 }), t('overlay.title')),
            h(IconButton, { label: t('common.close'), icon: h(CloseIcon), onClick: () => vr.setOverlay(false) }),
          ),
          h(
            'div',
            { className: 'vr-overlay-body' },
            h(QuickPreviewContent, { t, vr, ctx, target: { cwd, sessionId }, compact: true }),
          ),
        ),
      )
    }

    function QuickPreviewTitle(props) {
      const { t } = props
      return h('span', { className: 'vr-tab-title' }, h(ShieldIcon, { size: 14 }), h('span', null, t('nav.preview')))
    }

    function PanelIcon(props) {
      return h(ShieldIcon, { size: props.size || 18 })
    }

    // ---------------------------------------------------------------------
    // Full profile page
    // ---------------------------------------------------------------------

    function layoutService(ctx) {
      // `ctx.layout` only exists for a hard-injected dependency; this plugin
      // keeps layout optional, so resolve it through the service registry.
      try {
        return ctx.get('layout') ?? ctx.layout
      } catch {
        return ctx.layout
      }
    }

    function openProfile(ctx, vr, tab = 'overview') {
      vr.setOverlay(false)
      vr.setPendingTab(tab)
      const layout = layoutService(ctx)
      if (!layout) {
        ctx.logger?.warn?.('visualrules: layout service is unavailable; cannot open the full profile panel')
        return
      }
      try {
        layout.selectPanel?.(PANEL_KEY)
      } catch (error) {
        ctx.logger?.warn?.(`visualrules: could not open the profile panel: ${error instanceof Error ? error.message : String(error)}`)
      }
      try {
        layout.closeRightbar?.()
      } catch {
        /* already closed */
      }
    }

    function IdentityCard({ t, profile, onEdit }) {
      const actual = profile.identity.actual
      const expected = profile.identity.expected
      const hasExpected = Boolean(expected.name || expected.email)
      return h(
        Card,
        {
          title: t('section.identity'),
          actions: h(IconButton, { label: t('common.edit'), icon: h(ExternalIcon), onClick: onEdit }),
        },
        h(
          Row,
          { label: t('label.name'), mono: true, actions: actual.nameScope ? h('span', { className: 'vr-scope' }, scopeLabel(t, actual.nameScope)) : null },
          actual.name || h('span', { className: 'vr-muted' }, t('common.none')),
        ),
        h(
          Row,
          { label: t('label.email'), mono: true, actions: actual.emailScope ? h('span', { className: 'vr-scope' }, scopeLabel(t, actual.emailScope)) : null },
          actual.email || h('span', { className: 'vr-muted' }, t('common.none')),
        ),
        hasExpected
          ? h(
              'div',
              { className: 'vr-sub-block' },
              h('div', { className: 'vr-sub-title' }, t('personal.title')),
              h(Row, { label: t('personal.gitName') }, expected.name || h('span', { className: 'vr-muted' }, t('common.none'))),
              h(Row, { label: t('personal.gitEmail') }, expected.email || h('span', { className: 'vr-muted' }, t('common.none'))),
              profile.identity.mismatch ? h('div', { className: 'vr-inline-warn' }, h(WarnIcon, { size: 13 }), t('identity.mismatch')) : null,
            )
          : h('p', { className: 'vr-hint' }, t('personal.gitHint')),
      )
    }

    function BranchCard({ t, profile }) {
      const repo = profile.repo
      if (!repo.isGit) {
        return h(Card, { title: t('section.branch') }, h('p', { className: 'vr-hint' }, `${t('empty.noRepo')}${repo.reason ? `（${repo.reason}）` : ''}`))
      }
      return h(
        Card,
        { title: t('section.branch') },
        h(Row, { label: t('label.branch'), mono: true }, repo.branch || repo.sha || t('value.detached'), repo.detached ? h('span', { className: 'vr-pill' }, t('value.detached')) : null),
        h(Row, { label: t('label.remote'), mono: true }, repo.remote.url ? h('span', { className: 'vr-truncate', title: repo.remote.url }, repo.remote.url) : h('span', { className: 'vr-muted' }, t('value.noRemote'))),
        h(Row, { label: t('label.upstream'), mono: true }, repo.upstream || h('span', { className: 'vr-muted' }, t('value.noUpstream'))),
        h(
          'div',
          { className: 'vr-quick-inline' },
          h('span', { className: classNames('vr-pill', repo.ahead > 0 && 'vr-pill-warn') }, `↑ ${repo.ahead ?? 0}`),
          h('span', { className: classNames('vr-pill', repo.behind > 0 && 'vr-pill-warn') }, `↓ ${repo.behind ?? 0}`),
          repo.protected ? h('span', { className: 'vr-pill vr-pill-danger' }, `${t('label.protected')} · ${repo.protectedBy}`) : null,
        ),
        repo.lastCommit
          ? h(
              'div',
              { className: 'vr-sub-block' },
              h('div', { className: 'vr-sub-title' }, t('label.lastCommit')),
              h('div', { className: 'vr-commit' }, h('code', null, repo.lastCommit.sha), h('span', { className: 'vr-commit-subject' }, repo.lastCommit.subject)),
              h('div', { className: 'vr-hint' }, `${repo.lastCommit.author} · ${formatTime(repo.lastCommit.time)}`),
            )
          : null,
      )
    }

    function EnvironmentCard({ t, profile, onEdit }) {
      const env = profile.environment
      return h(
        Card,
        {
          title: t('section.environment'),
          actions: h(IconButton, { label: t('common.edit'), icon: h(ExternalIcon), onClick: onEdit }),
        },
        h(Row, { label: t('label.environment') }, h(EnvChip, { t, env }), h('span', { className: 'vr-scope' }, env.source === 'personal' ? t('value.personal') : env.source === 'team' ? t('value.team') : t('common.none'))),
        env.host
          ? h(Row, { label: t('label.host'), mono: true }, `${env.user ? `${env.user}@` : ''}${env.host}${env.port ? `:${env.port}` : ''}`)
          : h(Row, { label: t('label.host') }, h('span', { className: 'vr-muted' }, t('personal.showServerInfoHint'))),
        env.user ? h(Row, { label: t('label.user'), mono: true }, env.user) : null,
        env.keyRef ? h(Row, { label: t('label.keyRef'), mono: true }, env.keyRef) : null,
        env.jump ? h(Row, { label: t('label.jump'), mono: true }, env.jump) : null,
        env.overridden ? h('div', { className: 'vr-inline-warn' }, h(WarnIcon, { size: 13 }), t('environment.overridden')) : null,
      )
    }

    function RulesCard({ t, profile }) {
      const rules = profile.rules
      if (!rules) {
        return h(Card, { title: t('section.rules') }, h('p', { className: 'vr-hint' }, t('empty.noConfig')))
      }
      return h(
        Card,
        { title: t('section.rules'), subtitle: profile.config.path || undefined },
        h(Row, { label: t('label.branchPattern'), mono: true }, rules.branchPattern ? h('code', null, rules.branchPattern) : h('span', { className: 'vr-muted' }, t('common.none'))),
        h(Row, { label: t('label.commitFormat'), mono: true }, rules.commitFormat || h('span', { className: 'vr-muted' }, t('common.none'))),
        h(Row, { label: t('label.requireIssue') }, rules.requireIssue ? t('common.yes') : t('common.no')),
        rules.issuePattern ? h(Row, { label: t('label.issuePattern'), mono: true }, h('code', null, rules.issuePattern)) : null,
        rules.allowedCommitTypes?.length ? h(Row, { label: t('label.allowedTypes') }, h(Chips, { items: rules.allowedCommitTypes })) : null,
        h(Row, { label: t('label.merge') }, rules.mergeStrategy || h('span', { className: 'vr-muted' }, t('common.none'))),
        h(Row, { label: t('label.protected') }, rules.protectedBranches?.length ? h(Chips, { items: rules.protectedBranches }) : h('span', { className: 'vr-muted' }, t('common.none'))),
        h(Row, { label: t('label.review') }, rules.reviewMin === null || rules.reviewMin === undefined ? h('span', { className: 'vr-muted' }, t('common.none')) : String(rules.reviewMin)),
        rules.tagPattern ? h(Row, { label: t('label.tagPattern'), mono: true }, h('code', null, rules.tagPattern)) : null,
      )
    }

    function InjectionCard({ t, vr, profile, target, onManage, onPreview }) {
      const injection = profile.injection || { packs: [], totalChars: 0, maxChars: 0, truncated: false, omitted: [] }
      return h(
        Card,
        {
          title: t('section.injection'),
          span: 2,
          actions: h(
            'div',
            { className: 'vr-inline-actions' },
            h(Button, { size: 'sm', onClick: onManage }, t('action.managePacks')),
            injection.packs.length > 0 ? h(Button, { size: 'sm', variant: 'primary', onClick: onPreview }, t('action.openPreview')) : null,
          ),
        },
        injection.packs.length > 0
          ? h(
              'div',
              { className: 'vr-pack-chips' },
              injection.packs.map((pack) =>
                h(
                  'span',
                  { key: `${pack.scope}:${pack.id}`, className: classNames('vr-chip', pack.truncated && 'vr-chip-warn'), title: `${pack.id} · ${formatNumber(pack.chars)}` },
                  h('span', { className: 'vr-chip-scope' }, scopeLabel(t, pack.scope)),
                  pack.title,
                ),
              ),
            )
          : h(
              'div',
              null,
              h('p', { className: 'vr-hint' }, t('empty.noPacks')),
              h(DefaultPackButton, { t, vr, target }),
            ),
        h(
          'div',
          { className: 'vr-meter-row' },
          h('span', null, `${t('label.totalChars')} ${formatNumber(injection.totalChars)} / ${formatNumber(injection.maxChars)}`),
          injection.truncated ? h('span', { className: 'vr-inline-warn' }, t('label.truncated')) : null,
        ),
        h('div', { className: 'vr-meter' }, h('div', { className: 'vr-meter-fill', style: { width: `${Math.min(100, injection.maxChars ? (injection.totalChars / injection.maxChars) * 100 : 0)}%` } })),
        injection.omitted?.length ? h('p', { className: 'vr-hint' }, `${t('preview.omitted')}：${injection.omitted.map((entry) => entry.title).join('、')}`) : null,
        h('p', { className: 'vr-hint' }, t('preview.hint')),
      )
    }

    function TeamCard({ t, profile }) {
      const team = profile.team
      if (!team) {
        return h(Card, { title: t('section.team') }, h('p', { className: 'vr-hint' }, t('empty.noConfig')))
      }
      return h(
        Card,
        { title: t('section.team') },
        h(Row, { label: t('label.teamName') }, team.name || h('span', { className: 'vr-muted' }, t('common.none'))),
        h(Row, { label: t('label.owner') }, team.owner || h('span', { className: 'vr-muted' }, t('common.none'))),
        h(Row, { label: t('label.contacts') }, team.contacts?.length ? h(Chips, { items: team.contacts }) : h('span', { className: 'vr-muted' }, t('common.none'))),
        team.docs?.wiki ? h(Row, { label: t('label.wiki'), mono: true }, h('a', { className: 'vr-link', href: team.docs.wiki, target: '_blank', rel: 'noreferrer' }, team.docs.wiki)) : null,
        team.docs?.issues ? h(Row, { label: t('label.issues'), mono: true }, h('a', { className: 'vr-link', href: team.docs.issues, target: '_blank', rel: 'noreferrer' }, team.docs.issues)) : null,
        h(Row, { label: t('label.releaseWindow') }, team.releaseWindow || h('span', { className: 'vr-muted' }, t('common.none'))),
      )
    }

    function DevCard({ t, profile }) {
      const dev = profile.dev
      if (!dev) {
        return h(Card, { title: t('section.dev') }, h('p', { className: 'vr-hint' }, t('empty.noConfig')))
      }
      const toolchain = Object.entries(dev.toolchain || {})
      return h(
        Card,
        { title: t('section.dev') },
        h(Row, { label: t('label.toolchain') }, toolchain.length ? h(Chips, { items: toolchain.map(([name, version]) => `${name} ${version}`) }) : h('span', { className: 'vr-muted' }, t('common.none'))),
        h(Row, { label: t('label.lint') }, dev.lint || h('span', { className: 'vr-muted' }, t('common.none'))),
        h(Row, { label: t('label.formatter') }, dev.formatter || h('span', { className: 'vr-muted' }, t('common.none'))),
        h(Row, { label: t('label.test') }, dev.test?.length ? h(Chips, { items: dev.test }) : h('span', { className: 'vr-muted' }, t('common.none'))),
        h(Row, { label: t('label.ci') }, dev.ciRequired?.length ? h(Chips, { items: dev.ciRequired }) : h('span', { className: 'vr-muted' }, t('common.none'))),
        h(
          Row,
          { label: t('label.dirs') },
          Object.entries(dev.dirs || {}).length
            ? h(Chips, { items: Object.entries(dev.dirs).map(([name, target]) => `${name} → ${target}`) })
            : h('span', { className: 'vr-muted' }, t('common.none')),
        ),
      )
    }

    function ConfigStatus({ t, config }) {
      if (!config) return h('span', { className: 'vr-pill' }, t('config.missing'))
      const tone = config.status === 'ok' ? 'ok' : config.status === 'invalid' ? 'danger' : 'muted'
      return h('span', { className: classNames('vr-pill', `vr-pill-${tone}`) }, config.status === 'ok' ? t('config.ok') : config.status === 'invalid' ? t('config.invalid') : t('config.missing'))
    }

    function ConfigCard({ t, profile, onReload }) {
      const config = profile.config
      const [copied, setCopied] = useState(false)
      return h(
        Card,
        {
          title: t('section.config'),
          span: 2,
          actions: h(
            'div',
            { className: 'vr-inline-actions' },
            h(Button, { size: 'sm', onClick: onReload, icon: h(RefreshIcon) }, t('action.reload')),
            h(
              Button,
              {
                size: 'sm',
                icon: h(CopyIcon),
                onClick: async () => {
                  try {
                    const value = await callApi('/team/template')
                    if (await copyText(value.template)) {
                      setCopied(true)
                      setTimeout(() => setCopied(false), 2000)
                    }
                  } catch {
                    /* the template tab shows the same text */
                  }
                },
              },
              copied ? t('common.copied') : t('action.copyTemplate'),
            ),
          ),
        },
        h(Row, { label: t('label.configPath'), mono: true, actions: h(ConfigStatus, { t, config }) }, config.path || h('span', { className: 'vr-muted' }, t('config.noFile'))),
        config.errors?.length
          ? h(
              'div',
              { className: 'vr-config-errors' },
              config.errors.map((error, index) =>
                h(
                  'div',
                  { key: index, className: 'vr-config-error' },
                  h('span', { className: 'vr-config-line' }, error.line ? t('label.line').replace('{line}', String(error.line)) : t('config.invalid')),
                  h('span', null, `${error.path ? `${error.path}：` : ''}${error.message}`),
                ),
              ),
            )
          : null,
        config.warnings?.length
          ? h(
              'div',
              { className: 'vr-config-warnings' },
              config.warnings.slice(0, 6).map((warning, index) =>
                h(
                  'div',
                  { key: index, className: 'vr-config-warning' },
                  warning.line ? `${t('label.line').replace('{line}', String(warning.line))} · ` : '',
                  `${warning.path ? `${warning.path}：` : ''}${warning.message}`,
                ),
              ),
            )
          : null,
        !config.exists ? h('p', { className: 'vr-hint' }, t('config.templateHint')) : null,
      )
    }

    function OverviewTab({ t, vr, profile, ctx, target }) {
      return h(
        'div',
        { className: 'vr-stack vr-stack-page' },
        profile.warnings.length > 0
          ? h(
              'div',
              { className: 'vr-notice-stack' },
              h(WarningList, { t, warnings: profile.warnings, limit: 5, includeInfo: true, alert: true, onConfigure: () => openProfile(ctx, vr, 'personal') }),
            )
          : null,
        h(
          'div',
          { className: 'vr-grid' },
          profile.repo.isGit ? h(IdentityCard, { t, profile, onEdit: () => openProfile(ctx, vr, 'personal') }) : null,
          h(BranchCard, { t, profile }),
          h(EnvironmentCard, { t, profile, onEdit: () => openProfile(ctx, vr, 'personal') }),
          h(RulesCard, { t, profile }),
          h(InjectionCard, {
            t,
            vr,
            profile,
            target,
            onManage: () => openProfile(ctx, vr, 'packs'),
            onPreview: () => openProfile(ctx, vr, 'preview'),
          }),
          h(TeamCard, { t, profile }),
          h(DevCard, { t, profile }),
          h(ConfigCard, {
            t,
            profile,
            onReload: () => vr.refreshEverything(target, { force: true }),
          }),
        ),
      )
    }

    // ---------------------------------------------------------------------
    // Validation, Git hooks, and the AI commit index
    // ---------------------------------------------------------------------

    const RULE_ORDER = [
      'identity.email',
      'identity.missing',
      'branch.protected',
      'branch.pattern',
      'branch.detached',
      'commit.format',
      'commit.type',
      'commit.scope',
      'commit.headerLength',
      'commit.issue',
      'commit.messageMissing',
      'commit.mergeMessage',
      'commit.noVerify',
      'commit.amend',
    ]
    const RULE_LEVELS = ['off', 'info', 'warn', 'block']

    function ValidationLevelSelect({ t, value, onChange, disabled }) {
      return h(
        'select',
        {
          className: 'vr-select',
          value: RULE_LEVELS.includes(value) ? value : 'warn',
          disabled: disabled === true,
          onChange: (event) => onChange(event.target.value),
        },
        RULE_LEVELS.map((level) => h('option', { key: level, value: level }, t(`validation.level.${level}`))),
      )
    }

    function FindingsList({ t, findings }) {
      if (!findings || findings.length === 0) {
        return h('div', { className: 'vr-ok-line' }, h(CheckIcon, { size: 14 }), h('span', null, t('validation.check.pass')))
      }
      return h(
        'div',
        { className: 'vr-findings' },
        findings.map((finding, index) =>
          h(
            'div',
            { key: `${finding.id}:${index}`, className: classNames('vr-finding', `vr-finding-${finding.level}`) },
            h('div', { className: 'vr-finding-head' }, h('span', { className: 'vr-finding-level' }, t(`validation.level.${finding.level}`)), h('span', { className: 'vr-finding-title' }, finding.title), h('code', { className: 'vr-finding-id' }, finding.id)),
            h('div', { className: 'vr-finding-text' }, finding.message),
            finding.fix ? h('div', { className: 'vr-finding-fix' }, `${t('validation.check.fix')}：${finding.fix}`) : null,
          ),
        ),
      )
    }

    function ValidationPanel({ t, vr, target, page }) {
      const snapshot = useVR(vr)
      const [busy, setBusy] = useState('')
      const [error, setError] = useState('')
      const [saved, setSaved] = useState('')
      const [levels, setLevels] = useState(null)
      const [hookOpen, setHookOpen] = useState(false)
      const [hookPreview, setHookPreview] = useState(null)
      const [hookResult, setHookResult] = useState(null)
      const [confirmInstall, setConfirmInstall] = useState(false)
      const [confirmUninstall, setConfirmUninstall] = useState(false)
      const [confirmClear, setConfirmClear] = useState(false)
      const [bypassReason, setBypassReason] = useState('')
      const [bypassTtl, setBypassTtl] = useState(10)
      const [checkMessage, setCheckMessage] = useState('')
      const [checkBranch, setCheckBranch] = useState('')
      const [checkResult, setCheckResult] = useState(null)

      useEffect(() => {
        vr.loadValidation(target)
      }, [target.cwd, target.sessionId])

      const status = snapshot.validation
      useEffect(() => {
        if (status?.levels) setLevels({ ...status.levels })
        if (status?.repo?.branch && !checkBranch) setCheckBranch(status.repo.branch)
      }, [status?.updatedAt, status?.repo?.branch])

      if (!target.cwd && !target.sessionId) {
        return h(EmptyState, { title: t('validation.title'), body: t('overlay.noSession') })
      }
      if (!status) {
        return snapshot.validationStatus === 'error'
          ? h(EmptyState, { title: t('validation.title'), body: snapshot.validationError || t('status.error'), actions: h(Button, { variant: 'primary', onClick: () => vr.loadValidation(target, { force: true }) }, t('common.retry')) })
          : h(Skeleton, { rows: 6 })
      }

      const workspaceValidation = status.workspace?.validation || {}
      const enabled = status.enabled !== false
      const hook = status.hook || {}
      const commits = status.commits || []
      const events = status.events || []
      const bypasses = status.bypasses || []
      const activeBypasses = bypasses.filter((item) => item.consumedAt === 0 && item.expiresAt > Date.now())
      const sources = status.sources || {}
      const rules = status.rules || {}

      async function run(key, action, successText) {
        setBusy(key)
        setError('')
        setSaved('')
        try {
          const value = await action()
          if (successText) setSaved(successText)
          return value
        } catch (failure) {
          setError(failure instanceof Error ? failure.message : String(failure))
          return null
        } finally {
          setBusy('')
        }
      }

      async function saveLevels(nextLevels) {
        setLevels(nextLevels)
        await run('levels', () => vr.saveValidation({ levels: nextLevels }, target), t('validation.saved'))
      }

      async function toggleEnabled(value) {
        await run('enabled', () => vr.saveValidation({ enabled: value }, target), t('validation.saved'))
      }

      async function toggleDanger(value) {
        await run('danger', () => vr.saveValidation({ confirmDanger: value }, target), t('validation.saved'))
      }

      async function toggleTrack(value) {
        await run('track', () => vr.saveValidation({ trackCommits: value }, target), t('validation.saved'))
      }

      async function openHookPreview() {
        setHookOpen(true)
        if (!hookPreview) {
          const value = await run('preview', () => vr.loadHookPreview())
          if (value) setHookPreview(value)
        }
      }

      async function installHook() {
        setConfirmInstall(false)
        const value = await run('install', () => vr.installHook(target))
        setHookResult(value)
      }

      async function uninstallHook() {
        setConfirmUninstall(false)
        const value = await run('uninstall', () => vr.uninstallHook(target))
        setHookResult(value)
      }

      async function createBypass() {
        if (bypassReason.trim().length < 3) {
          setError(t('validation.bypass.reasonRequired'))
          return
        }
        const value = await run('bypass', () => vr.createBypass({ reason: bypassReason.trim(), ttlMinutes: bypassTtl }, target), t('validation.bypass.created'))
        if (value) setBypassReason('')
      }

      async function runCheck() {
        const value = await run('check', () =>
          vr.checkProposal({ message: checkMessage, branch: checkBranch }, target),
        )
        if (value) {
          setCheckResult(value)
          vr.loadValidation(target, { quiet: true })
        }
      }

      return h(
        'div',
        { className: classNames('vr-stack', page && 'vr-stack-page') },
        h(
          'div',
          { className: 'vr-section-head' },
          h(
            'div',
            null,
            h('h2', { className: 'vr-section-title' }, t('validation.title')),
            h('p', { className: 'vr-section-subtitle' }, t('validation.hint')),
          ),
          h(
            'div',
            { className: 'vr-inline-actions' },
            h(
              'span',
              { className: classNames('vr-chip', enabled ? 'vr-chip-ok' : 'vr-chip-muted') },
              enabled ? t('validation.enabledOn') : t('validation.enabledOff'),
            ),
            h(Switch, { checked: enabled, onChange: toggleEnabled, label: t('validation.enabled'), disabled: busy === 'enabled' }),
            h(Button, { size: 'sm', icon: h(RefreshIcon), onClick: () => vr.loadValidation(target, { force: true }) }, t('common.refresh')),
          ),
        ),
        error ? h(Notice, { tone: 'error' }, error) : null,
        saved ? h('div', { className: 'vr-saved' }, h(CheckIcon, { size: 13 }), saved) : null,
        !status.repo?.isGit
          ? h(Notice, { tone: 'info', title: t('validation.notGit') }, t('validation.notGitHint'))
          : null,

        // Effective rules + per-workspace levels
        h(
          Card,
          {
            title: t('validation.rules.title'),
            subtitle: t('validation.rules.hint'),
            actions: h('span', { className: 'vr-pill' }, `${t('validation.rules.ruleCount')} ${RULE_ORDER.length}`),
          },
          h(
            'div',
            { className: 'vr-rule-summary' },
            h('span', { className: 'vr-pill' }, `${t('validation.summary.branch')} ${rules.branchPattern || '—'}`),
            h('span', { className: 'vr-pill' }, `${t('validation.summary.protected')} ${(rules.protectedBranches || []).join('、') || '—'}`),
            h('span', { className: 'vr-pill' }, `${t('validation.summary.format')} ${rules.format || '—'}`),
            h('span', { className: 'vr-pill' }, `${t('validation.summary.types')} ${(rules.allowedTypes || []).join(' / ') || '—'}`),
            h('span', { className: 'vr-pill' }, `${t('validation.summary.header')} ${rules.headerMax || '—'}`),
            h('span', { className: 'vr-pill' }, `${t('validation.summary.issue')} ${rules.requireIssue ? t('common.yes') : t('common.no')}`),
          ),
          h(
            'div',
            { className: 'vr-rule-list' },
            RULE_ORDER.map((id) =>
              h(
                'div',
                { key: id, className: 'vr-rule-row' },
                h(
                  'div',
                  { className: 'vr-rule-main' },
                  h('div', { className: 'vr-rule-title' }, t(`validation.rule.${id}`)),
                  h('div', { className: 'vr-rule-id vr-mono' }, id),
                ),
                h(ValidationLevelSelect, {
                  t,
                  value: (levels || {})[id] || 'warn',
                  disabled: busy === 'levels',
                  onChange: (value) => saveLevels({ ...(levels || {}), [id]: value }),
                }),
              ),
            ),
          ),
          h(
            'div',
            { className: 'vr-switch-row' },
            h(
              'div',
              null,
              h('div', { className: 'vr-field-label' }, t('validation.confirmDanger')),
              h('div', { className: 'vr-field-hint' }, t('validation.confirmDangerHint')),
            ),
            h(Switch, { checked: workspaceValidation.confirmDanger === true, onChange: toggleDanger, label: t('validation.confirmDanger'), disabled: busy === 'danger' }),
          ),
          h(
            'div',
            { className: 'vr-switch-row' },
            h(
              'div',
              null,
              h('div', { className: 'vr-field-label' }, t('validation.trackCommits')),
              h('div', { className: 'vr-field-hint' }, t('validation.trackCommitsHint')),
            ),
            h(Switch, { checked: workspaceValidation.trackCommits !== false, onChange: toggleTrack, label: t('validation.trackCommits'), disabled: busy === 'track' }),
          ),
        ),

        // Git hook
        h(
          Card,
          {
            title: t('validation.hook.title'),
            subtitle: t('validation.hook.hint'),
            actions: h(
              'span',
              {
                className: classNames(
                  'vr-chip',
                  hook.installed ? 'vr-chip-ok' : hook.partiallyInstalled ? 'vr-chip-warn' : 'vr-chip-muted',
                ),
              },
              hook.installed ? t('validation.hook.installed') : hook.partiallyInstalled ? t('validation.hook.partial') : t('validation.hook.notInstalled'),
            ),
          },
          !hook.repoRoot
            ? h('p', { className: 'vr-hint' }, t('validation.hook.notGit'))
            : h(
                'div',
                { className: 'vr-stack-tight' },
                h(Row, { label: t('validation.hook.directory'), mono: true }, hook.directory || '—'),
                hook.customDirectory
                  ? h(Notice, { tone: 'warn' }, t('validation.hook.customPath'))
                  : null,
                h(
                  'div',
                  { className: 'vr-hook-list' },
                  (hook.hooks || []).map((entry) =>
                    h(
                      'div',
                      { key: entry.kind, className: 'vr-hook-row' },
                      h('code', { className: 'vr-mono' }, entry.kind),
                      h('span', { className: classNames('vr-chip', entry.installed ? 'vr-chip-ok' : 'vr-chip-muted') }, entry.installed ? t('validation.hook.installed') : t('validation.hook.notInstalled')),
                      entry.original ? h('span', { className: 'vr-hint' }, `${t('validation.hook.backup')}: ${basename(entry.original)}`) : null,
                      entry.stale ? h('span', { className: 'vr-pill vr-pill-warn' }, t('validation.hook.stale')) : null,
                    ),
                  ),
                ),
                h('p', { className: 'vr-hint' }, t('validation.hook.coverage')),
                h(
                  'div',
                  { className: 'vr-inline-actions' },
                  h(Button, { size: 'sm', onClick: openHookPreview }, t('validation.hook.preview')),
                  confirmInstall
                    ? h(
                        'div',
                        { className: 'vr-inline-actions' },
                        h('span', { className: 'vr-hint' }, t('validation.hook.confirmInstall')),
                        h(Button, { size: 'sm', variant: 'primary', disabled: busy === 'install', onClick: installHook }, t('validation.hook.install')),
                        h(Button, { size: 'sm', onClick: () => setConfirmInstall(false) }, t('common.cancel')),
                      )
                    : h(Button, { size: 'sm', variant: hook.installed ? undefined : 'primary', onClick: () => setConfirmInstall(true) }, hook.installed ? t('validation.hook.reinstall') : t('validation.hook.install')),
                  confirmUninstall
                    ? h(
                        'div',
                        { className: 'vr-inline-actions' },
                        h('span', { className: 'vr-hint' }, t('validation.hook.confirmUninstall')),
                        h(Button, { size: 'sm', variant: 'danger', disabled: busy === 'uninstall', onClick: uninstallHook }, t('validation.hook.uninstall')),
                        h(Button, { size: 'sm', onClick: () => setConfirmUninstall(false) }, t('common.cancel')),
                      )
                    : hook.installed || hook.partiallyInstalled
                      ? h(Button, { size: 'sm', onClick: () => setConfirmUninstall(true) }, t('validation.hook.uninstall'))
                      : null,
                ),
                hookResult
                  ? h(
                      Notice,
                      { tone: hookResult.ok ? 'info' : 'error', title: hookResult.ok ? t('validation.hook.installDone') : t('validation.hook.installFailed') },
                      h(
                        'div',
                        null,
                        (hookResult.created || []).map((file) => h('div', { key: file, className: 'vr-mono' }, file)),
                        hookResult.error ? h('div', null, hookResult.error) : null,
                        (hookResult.backups || []).map((file) => h('div', { key: file }, `${t('validation.hook.backup')}: ${file}`)),
                        (hookResult.warnings || []).map((warning) => h('div', { key: warning }, warning)),
                      ),
                    )
                  : null,
                hookOpen
                  ? h(
                      'div',
                      null,
                      h(
                        'div',
                        { className: 'vr-sub-title' },
                        `${t('validation.hook.previewTitle')} · ${hookPreview?.pluginRoot || ''}`,
                      ),
                      (hookPreview?.hooks || []).map((entry) =>
                        h(
                          'div',
                          { key: entry.kind },
                          h('div', { className: 'vr-field-label' }, `${entry.kind} → ${(hook.hooks || []).find((item) => item.kind === entry.kind)?.path || entry.path}`),
                          h('pre', { className: 'vr-code-block vr-hook-code' }, entry.content),
                        ),
                      ),
                      h('p', { className: 'vr-hint' }, hookPreview?.note || t('validation.hook.coverage')),
                    )
                  : null,
              ),
        ),

        // One-time bypass
        h(
          Card,
          {
            title: t('validation.bypass.title'),
            subtitle: t('validation.bypass.hint'),
          },
          h(
            'div',
            { className: 'vr-form-grid' },
            h(
              'label',
              { className: 'vr-field' },
              h('span', { className: 'vr-field-label' }, t('validation.bypass.reason')),
              h('input', {
                className: 'vr-input',
                value: bypassReason,
                placeholder: t('validation.bypass.reasonPlaceholder'),
                onChange: (event) => setBypassReason(event.target.value),
              }),
            ),
            h(
              'label',
              { className: 'vr-field' },
              h('span', { className: 'vr-field-label' }, t('validation.bypass.ttl')),
              h(
                'select',
                { className: 'vr-select', value: bypassTtl, onChange: (event) => setBypassTtl(Number(event.target.value)) },
                [5, 10, 30].map((minutes) => h('option', { key: minutes, value: minutes }, `${minutes} ${t('validation.bypass.minutes')}`)),
              ),
            ),
          ),
          h(
            'div',
            { className: 'vr-inline-actions' },
            h(Button, { size: 'sm', variant: 'primary', disabled: busy === 'bypass', onClick: createBypass }, t('validation.bypass.create')),
          ),
          activeBypasses.length === 0
            ? h('p', { className: 'vr-hint' }, t('validation.bypass.empty'))
            : h(
                'div',
                { className: 'vr-bypass-list' },
                activeBypasses.map((item) =>
                  h(
                    'div',
                    { key: item.id, className: 'vr-bypass-row' },
                    h('div', { className: 'vr-bypass-main' }, h('div', null, item.reason), h('div', { className: 'vr-field-hint' }, `${t('validation.bypass.expires')} ${formatTime(item.expiresAt)}`)),
                    h(Button, { size: 'sm', onClick: () => run('revoke', () => vr.revokeBypass(item.id, target), t('validation.bypass.revoked')) }, t('validation.bypass.revoke')),
                  ),
                ),
              ),
          bypasses.filter((item) => item.consumedAt > 0).length
            ? h(
                'details',
                { className: 'vr-details' },
                h('summary', null, t('validation.bypass.consumed')),
                bypasses
                  .filter((item) => item.consumedAt > 0)
                  .map((item) =>
                    h(
                      'div',
                      { key: item.id, className: 'vr-hint' },
                      `${formatTime(item.consumedAt)} · ${item.reason}${item.consumedBy ? ` · ${item.consumedBy.slice(0, 10)}` : ''}`,
                    ),
                  ),
              )
            : null,
        ),

        // Pre-flight check
        h(
          Card,
          { title: t('validation.check.title'), subtitle: t('validation.check.hint') },
          h(
            'div',
            { className: 'vr-form-grid' },
            h(
              'label',
              { className: 'vr-field vr-span-2' },
              h('span', { className: 'vr-field-label' }, t('validation.check.message')),
              h('textarea', {
                className: 'vr-textarea vr-mono',
                rows: 3,
                value: checkMessage,
                placeholder: 'feat(auth): 支持手机号登录\n\nRefs: #123',
                onChange: (event) => setCheckMessage(event.target.value),
              }),
            ),
            h(
              'label',
              { className: 'vr-field' },
              h('span', { className: 'vr-field-label' }, t('validation.check.branch')),
              h('input', { className: 'vr-input vr-mono', value: checkBranch, onChange: (event) => setCheckBranch(event.target.value) }),
            ),
          ),
          h(
            'div',
            { className: 'vr-inline-actions' },
            h(Button, { size: 'sm', variant: 'primary', disabled: busy === 'check', onClick: runCheck }, t('validation.check.run')),
          ),
          checkResult ? h(FindingsList, { t, findings: checkResult.findings }) : null,
        ),

        // Recent validation events
        h(
          Card,
          { title: t('validation.events.title'), subtitle: t('validation.events.hint') },
          events.length === 0
            ? h('p', { className: 'vr-hint' }, t('validation.events.empty'))
            : h(
                'div',
                { className: 'vr-event-list' },
                events.map((event) =>
                  h(
                    'div',
                    { key: event.id, className: classNames('vr-event', `vr-event-${event.kind}`) },
                    h(
                      'div',
                      { className: 'vr-event-head' },
                      h('span', { className: classNames('vr-chip', `vr-chip-${event.kind === 'block' ? 'danger' : event.kind === 'warn' ? 'warn' : 'ok'}`) }, t(`validation.event.${event.kind}`)),
                      h('span', { className: 'vr-event-time' }, formatTime(event.createdAt)),
                      h('code', { className: 'vr-event-command' }, event.command),
                    ),
                    (event.findings || []).map((finding, index) =>
                      h('div', { key: index, className: `vr-event-finding vr-event-finding-${finding.level}` }, `[${finding.id}] ${finding.title}：${finding.message}`),
                    ),
                  ),
                ),
              ),
        ),

        // AI commit index
        h(
          Card,
          {
            title: t('validation.commits.title'),
            subtitle: t('validation.commits.hint'),
            actions: h(
              'div',
              { className: 'vr-inline-actions' },
              h('span', { className: 'vr-pill' }, `${commits.length}`),
              confirmClear
                ? h(
                    'div',
                    { className: 'vr-inline-actions' },
                    h('span', { className: 'vr-hint' }, t('validation.commits.confirmClear')),
                    h(Button, { size: 'sm', variant: 'danger', onClick: async () => { setConfirmClear(false); await run('clear', () => vr.clearCommits(target), t('validation.commits.cleared')) } }, t('validation.commits.clear')),
                    h(Button, { size: 'sm', onClick: () => setConfirmClear(false) }, t('common.cancel')),
                  )
                : commits.length > 0
                  ? h(Button, { size: 'sm', onClick: () => setConfirmClear(true) }, t('validation.commits.clear'))
                  : null,
            ),
          },
          commits.length === 0
            ? h('p', { className: 'vr-hint' }, t('validation.commits.empty'))
            : h(
                'div',
                { className: 'vr-commit-list' },
                commits.map((commit) =>
                  h(
                    'div',
                    { key: commit.hash, className: 'vr-commit-row' },
                    h('code', { className: 'vr-commit-hash' }, commit.hash.slice(0, 10)),
                    h(
                      'div',
                      { className: 'vr-commit-main' },
                      h('div', { className: 'vr-commit-subject' }, commit.subject || (commit.message || '').split('\n')[0] || commit.hash.slice(0, 10)),
                      h('div', { className: 'vr-commit-meta' }, [commit.branch, commit.authorName, formatTime(commit.committedAt * 1000)].filter(Boolean).join(' · ')),
                    ),
                    h(
                      'div',
                      { className: 'vr-commit-actions' },
                      h(IconButton, { label: t('validation.commits.copy'), icon: h(CopyIcon), onClick: () => copyText(commit.hash) }),
                      h(IconButton, { label: t('common.delete'), icon: h(CloseIcon), onClick: () => run(`delete:${commit.hash}`, () => vr.deleteCommit(commit.hash, target)) }),
                    ),
                  ),
                ),
              ),
          h('p', { className: 'vr-hint' }, t('validation.commits.localOnly')),
        ),

        // Existing project rule sources
        h(
          Card,
          { title: t('validation.sources.title'), subtitle: t('validation.sources.hint') },
          h(
            'div',
            { className: 'vr-source-list' },
            h(SourceRow, { t, label: 'commitlint', value: sources.commitlint?.path, detail: sources.commitlint ? commitlintDetail(sources.commitlint) : '' }),
            h(SourceRow, { t, label: '.editorconfig', value: sources.editorconfig?.path, detail: sources.editorconfig?.rules ? Object.entries(sources.editorconfig.rules).map(([key, value]) => `${key}=${value}`).join(' · ') : '' }),
            h(SourceRow, { t, label: 'eslint', value: sources.eslint?.path, detail: sources.eslint?.name || '' }),
            h(SourceRow, { t, label: 'CONTRIBUTING', value: sources.docs?.contributing?.path, detail: sources.docs?.contributing?.title || '' }),
            h(SourceRow, { t, label: 'PR template', value: sources.docs?.prTemplate?.path, detail: sources.docs?.prTemplate?.title || '' }),
          ),
          (sources.warnings || []).length
            ? h('div', { className: 'vr-config-warnings' }, sources.warnings.map((warning) => h('div', { key: warning, className: 'vr-config-warning' }, warning)))
            : null,
        ),
      )
    }

    function SourceRow({ t, label, value, detail }) {
      return h(
        'div',
        { className: 'vr-source-row' },
        h('span', { className: 'vr-source-label' }, label),
        value
          ? h('div', { className: 'vr-source-value' }, h('div', { className: 'vr-mono' }, value), detail ? h('div', { className: 'vr-field-hint' }, detail) : null)
          : h('span', { className: 'vr-hint' }, t('validation.sources.none')),
      )
    }

    function commitlintDetail(commitlint) {
      const rules = commitlint.rules || {}
      const parts = []
      if (rules.typeEnum?.length) parts.push(`types: ${rules.typeEnum.join('/')}`)
      if (rules.scopeEnum?.length) parts.push(`scopes: ${rules.scopeEnum.join('/')}`)
      if (rules.headerMaxLength) parts.push(`header ≤ ${rules.headerMaxLength}`)
      return parts.join(' · ')
    }

    function ProfilePage(props) {
      const { t, vr, ctx } = props
      const { cwd, sessionId } = useTarget(props)
      const snapshot = useVR(vr)
      const [tab, setTab] = useState('overview')
      useEffect(() => {
        if (cwd || sessionId) vr.refreshProfile({ cwd, sessionId })
      }, [cwd, sessionId])
      useEffect(() => {
        if (snapshot.pendingTab) {
          setTab(snapshot.pendingTab)
          vr.clearPendingTab()
        }
      }, [snapshot.pendingTab])
      const profile = profileMatches(snapshot.profile, { cwd, sessionId }) ? snapshot.profile : null
      const target = { cwd, sessionId }
      const tabs = [
        ['overview', t('profile.tab.overview')],
        ['validation', t('profile.tab.validation')],
        ['packs', t('profile.tab.packs')],
        ['personal', t('profile.tab.personal')],
        ['team', t('profile.tab.team')],
        ['preview', t('profile.tab.preview')],
      ]
      if (!cwd && !sessionId) {
        return h(
          'div',
          { className: 'vr-page' },
          h(EmptyState, { title: t('profile.empty.title'), body: t('profile.empty.body') }),
        )
      }
      return h(
        'div',
        { className: 'vr-page' },
        h(
          'header',
          { className: 'vr-page-head' },
          h(
            'div',
            { className: 'vr-page-title-wrap' },
            h('div', { className: 'vr-eyebrow' }, h(ShieldIcon, { size: 13 }), t('nav.title')),
            h('h1', { className: 'vr-page-title' }, profile?.repo?.name || basename(profile?.cwd || cwd)),
            h('div', { className: 'vr-page-path', title: profile?.cwd || cwd }, profile?.cwd || cwd),
          ),
          h(
            'div',
            { className: 'vr-page-head-actions' },
            profile ? h(EnvChip, { t, env: profile.environment }) : null,
            h(Button, { size: 'sm', icon: h(RefreshIcon), onClick: () => vr.refreshProfile(target, { force: true }) }, t('common.refresh')),
          ),
        ),
        h(
          'div',
          { className: 'vr-tabs', role: 'tablist' },
          tabs.map(([id, label]) =>
            h(
              'button',
              { key: id, type: 'button', role: 'tab', 'aria-selected': tab === id, className: classNames('vr-tab', tab === id && 'vr-tab-active'), onClick: () => setTab(id) },
              label,
            ),
          ),
          profile ? h('span', { className: 'vr-tab-meta' }, fill(t('profile.updated'), { time: formatTime(profile.updatedAt) })) : null,
        ),
        h(
          'div',
          { className: 'vr-page-body' },
          !profile && snapshot.profileStatus !== 'error' ? h(Skeleton, { rows: 6 }) : null,
          snapshot.profileStatus === 'error' && !profile
            ? h(EmptyState, { title: t('status.error'), body: snapshot.profileError, actions: h(Button, { variant: 'primary', onClick: () => vr.refreshProfile(target, { force: true }) }, t('common.retry')) })
            : null,
          profile && tab === 'overview' ? h(OverviewTab, { t, vr, profile, ctx, target }) : null,
          tab === 'validation' ? h(ValidationPanel, { t, vr, target, page: true }) : null,
          tab === 'packs' ? h(PackManager, { t, vr, ctx, target, page: true }) : null,
          tab === 'personal' ? h(PersonalConfig, { t, vr, target, page: true }) : null,
          tab === 'team' ? h(TeamConfigTab, { t, vr, target }) : null,
          tab === 'preview' ? h(InjectionPreview, { t, vr, target }) : null,
        ),
      )
    }

    // ---------------------------------------------------------------------
    // Pack manager
    // ---------------------------------------------------------------------

    function slugify(name) {
      const base = String(name || '')
        .replace(/\.[^.]+$/, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
      return base || `imported-${Date.now()}`
    }

    function PackEditor({ t, vr, target, initial, onDone, existingIds }) {
      const [form, setForm] = useState(() =>
        initial?.id
          ? {
              id: initial.id,
              title: initial.title || '',
              description: initial.description || '',
              content: initial.content || '',
              globalEnabled: initial.globalEnabled === true,
            }
          : defaultPackDraft(t, existingIds),
      )
      const [saving, setSaving] = useState(false)
      const [error, setError] = useState('')
      const editing = Boolean(initial?.id)
      const update = (patch) => setForm((current) => ({ ...current, ...patch }))
      async function submit() {
        setError('')
        if (!form.id.trim() || !form.title.trim()) {
          setError(t('pack.idHint'))
          return
        }
        if (!editing && existingIds?.has(form.id.trim())) {
          setError(t('pack.idExists'))
          return
        }
        setSaving(true)
        try {
          await vr.savePack({ ...form, id: form.id.trim(), title: form.title.trim() }, target)
          onDone?.()
        } catch (failure) {
          setError(failure instanceof Error ? failure.message : String(failure))
        } finally {
          setSaving(false)
        }
      }
      return h(
        'div',
        { className: 'vr-editor' },
        h(
          'div',
          { className: 'vr-editor-head' },
          h('h3', { className: 'vr-editor-title' }, editing ? t('pack.editTitle') : t('pack.newTitle')),
          h(IconButton, { label: t('common.cancel'), icon: h(CloseIcon), onClick: onDone }),
        ),
        !editing ? h('p', { className: 'vr-hint vr-editor-hint' }, t('defaults.newPackHint')) : null,
        h(
          'div',
          { className: 'vr-form-grid' },
          h(
            'label',
            { className: 'vr-field' },
            h('span', { className: 'vr-field-label' }, t('pack.id')),
            h('input', {
              className: 'vr-input vr-mono',
              value: form.id,
              disabled: editing,
              placeholder: 'personal/general',
              onChange: (event) => update({ id: event.target.value }),
            }),
            h('span', { className: 'vr-field-hint' }, t('pack.idHint')),
          ),
          h(
            'label',
            { className: 'vr-field' },
            h('span', { className: 'vr-field-label' }, t('pack.title')),
            h('input', {
              className: 'vr-input',
              value: form.title,
              placeholder: t('pack.title'),
              onChange: (event) => update({ title: event.target.value }),
            }),
          ),
          h(
            'label',
            { className: 'vr-field vr-span-2' },
            h('span', { className: 'vr-field-label' }, t('pack.description')),
            h('input', {
              className: 'vr-input',
              value: form.description,
              placeholder: t('common.optional'),
              onChange: (event) => update({ description: event.target.value }),
            }),
          ),
          h(
            'label',
            { className: 'vr-field vr-span-2' },
            h('span', { className: 'vr-field-label' }, t('pack.content')),
            h('textarea', {
              className: 'vr-textarea vr-mono',
              rows: 14,
              value: form.content,
              placeholder: '# 规范正文（Markdown）',
              onChange: (event) => update({ content: event.target.value }),
            }),
          ),
        ),
        h(
          'label',
          { className: 'vr-check-row' },
          h('input', { type: 'checkbox', checked: form.globalEnabled, onChange: (event) => update({ globalEnabled: event.target.checked }) }),
          h('span', null, t('pack.global')),
          h('span', { className: 'vr-field-hint' }, t('pack.globalHint')),
        ),
        error ? h(Notice, { tone: 'error' }, error) : null,
        h(
          'div',
          { className: 'vr-editor-actions' },
          h(Button, { variant: 'primary', onClick: submit, disabled: saving }, saving ? t('common.saving') : t('action.savePack')),
          h(Button, { onClick: onDone }, t('common.cancel')),
        ),
      )
    }

    function PackManager({ t, vr, ctx, target, page }) {
      const snapshot = useVR(vr)
      useEffect(() => {
        vr.loadLibrary(target)
      }, [target.cwd, target.sessionId])
      const library = snapshot.library
      const [editor, setEditor] = useState(null)
      const [busy, setBusy] = useState('')
      const [error, setError] = useState('')
      const [confirmDelete, setConfirmDelete] = useState('')
      const fileInput = useRef(null)

      const personal = library?.personalPacks ?? []
      const team = library?.teamPacks ?? []
      const existingIds = useMemo(() => new Set([...personal.map((pack) => pack.id), ...team.map((pack) => pack.id)]), [library])

      async function toggle(pack, enabled) {
        setError('')
        setBusy(pack.id)
        try {
          await vr.togglePack(pack.id, enabled, target)
        } catch (failure) {
          setError(failure instanceof Error ? failure.message : String(failure))
        } finally {
          setBusy('')
        }
      }

      async function toggleGlobal(pack, enabled) {
        setError('')
        setBusy(`global:${pack.id}`)
        try {
          await vr.savePack({ ...pack, globalEnabled: enabled }, target)
        } catch (failure) {
          setError(failure instanceof Error ? failure.message : String(failure))
        } finally {
          setBusy('')
        }
      }

      async function remove(pack) {
        if (confirmDelete !== pack.id) {
          setConfirmDelete(pack.id)
          return
        }
        setConfirmDelete('')
        setBusy(`delete:${pack.id}`)
        try {
          await vr.deletePack(pack.id, target)
        } catch (failure) {
          setError(failure instanceof Error ? failure.message : String(failure))
        } finally {
          setBusy('')
        }
      }

      function importFile(event) {
        const file = event.target.files?.[0]
        if (!file) return
        const reader = new FileReader()
        reader.onload = () => {
          const content = typeof reader.result === 'string' ? reader.result : ''
          const base = slugify(file.name)
          let id = `personal/${base}`
          let index = 2
          while (existingIds.has(id)) {
            id = `personal/${base}-${index}`
            index += 1
          }
          setEditor({ id, title: file.name.replace(/\.[^.]+$/, ''), description: '', content, globalEnabled: false })
        }
        reader.readAsText(file, 'utf-8')
        event.target.value = ''
      }

      function renderPack(pack) {
        const isTeam = pack.scope === 'team'
        return h(
          'div',
          { key: pack.id, className: classNames('vr-pack-row', pack.enabled && 'vr-pack-row-on') },
          h(
            'div',
            { className: 'vr-pack-main' },
            h(
              'div',
              { className: 'vr-pack-title-line' },
              h('span', { className: 'vr-pack-title' }, pack.title),
              h('span', { className: 'vr-scope' }, isTeam ? t('value.team') : t('value.personal')),
              isTeam ? h('span', { className: 'vr-pill vr-pill-muted' }, t('label.readonly')) : null,
            ),
            h('div', { className: 'vr-pack-id vr-mono' }, pack.id),
            pack.description ? h('div', { className: 'vr-pack-desc' }, pack.description) : null,
            h('div', { className: 'vr-pack-meta' }, `${formatNumber(pack.chars)} ${t('label.chars').replace('{count}', '').trim()}`, isTeam && pack.source ? ` · ${pack.source}` : ''),
          ),
          h(
            'div',
            { className: 'vr-pack-actions' },
            h(
              'div',
              { className: 'vr-pack-switch' },
              h('span', { className: 'vr-field-label' }, t('pack.enabledHere')),
              h(Switch, {
                checked: pack.enabled,
                onChange: (value) => toggle(pack, value),
                label: t('pack.enabledHere'),
                disabled: busy === pack.id || (!target.cwd && !target.sessionId),
              }),
            ),
            !isTeam
              ? h(
                  'div',
                  { className: 'vr-pack-switch' },
                  h('span', { className: 'vr-field-label' }, t('common.allWorkspaces')),
                  h(Switch, { checked: pack.globalEnabled === true, onChange: (value) => toggleGlobal(pack, value), label: t('pack.global'), disabled: busy === `global:${pack.id}` }),
                )
              : null,
            !isTeam
              ? h(
                  'div',
                  { className: 'vr-inline-actions' },
                  h(IconButton, { label: t('common.edit'), icon: h(ExternalIcon), onClick: () => setEditor({ ...pack }) }),
                  h(IconButton, {
                    label: confirmDelete === pack.id ? t('pack.deleteConfirm') : t('common.delete'),
                    icon: h(TrashIcon),
                    variant: confirmDelete === pack.id ? 'danger' : undefined,
                    onClick: () => remove(pack),
                  }),
                )
              : null,
          ),
        )
      }

      if (!library && snapshot.libraryStatus === 'loading') {
        return h('div', { className: 'vr-stack' }, h(Skeleton, { rows: 5 }))
      }
      return h(
        'div',
        { className: classNames('vr-stack', page && 'vr-stack-page') },
        error ? h(Notice, { tone: 'error' }, error) : null,
        snapshot.libraryStatus === 'error' && !library ? h(Notice, { tone: 'error' }, snapshot.libraryError || t('status.error')) : null,
        !target.cwd && !target.sessionId
          ? h(Notice, { tone: 'info' }, t('personal.noWorkspace'))
          : null,
        h(
          'div',
          { className: 'vr-section-head' },
          h(
            'div',
            null,
            h('h2', { className: 'vr-section-title' }, t('pack.personalTitle')),
            h('p', { className: 'vr-section-subtitle' }, t('pack.personalHint')),
          ),
          h(
            'div',
            { className: 'vr-inline-actions' },
            h('input', { ref: fileInput, type: 'file', accept: '.md,.markdown,.txt', style: { display: 'none' }, onChange: importFile }),
            h(Button, { size: 'sm', icon: h(PlusIcon), onClick: () => setEditor({}) }, t('action.newPack')),
            h(Button, { size: 'sm', onClick: () => fileInput.current?.click() }, t('action.import')),
          ),
        ),
        editor ? h(PackEditor, { t, vr, target, initial: editor.id ? editor : undefined, existingIds, onDone: () => setEditor(null) }) : null,
        personal.length === 0 && !editor
          ? h(
              'div',
              { className: 'vr-empty-strip' },
              h('p', { className: 'vr-hint' }, t('pack.empty')),
              h(DefaultPackButton, { t, vr, target, size: 'sm' }),
            )
          : null,
        h('div', { className: 'vr-pack-list' }, personal.map(renderPack)),
        h(
          'div',
          { className: 'vr-section-head vr-section-head-team' },
          h(
            'div',
            null,
            h('h2', { className: 'vr-section-title' }, t('pack.teamTitle')),
            h('p', { className: 'vr-section-subtitle' }, t('pack.teamHint')),
          ),
        ),
        team.length === 0 ? h('p', { className: 'vr-hint' }, t('empty.noConfig')) : null,
        h('div', { className: 'vr-pack-list' }, team.map(renderPack)),
        library?.storage?.degraded ? h(Notice, { tone: 'error', title: t('section.config') }, library.storage.reason) : null,
      )
    }

    // ---------------------------------------------------------------------
    // Personal config
    // ---------------------------------------------------------------------

    function PersonalConfig({ t, vr, target, page }) {
      const snapshot = useVR(vr)
      useEffect(() => {
        vr.refreshProfile(target)
        vr.loadLibrary(target)
      }, [target.cwd, target.sessionId])
      const profile = profileMatches(snapshot.profile, target) ? snapshot.profile : null
      const [form, setForm] = useState(null)
      const [saving, setSaving] = useState(false)
      const [saved, setSaved] = useState(false)
      const [filled, setFilled] = useState(false)
      const [error, setError] = useState('')
      const [serverConfirm, setServerConfirm] = useState(false)
      const envListId = useId()
      useEffect(() => {
        if (!profile) return
        setForm({
          gitName: profile.workspace.gitName || '',
          gitEmail: profile.workspace.gitEmail || '',
          environment: profile.workspace.environment || '',
          showServerInfo: profile.workspace.showServerInfo === true,
          injectRules: profile.workspace.injectRules === true,
          extraRules: profile.workspace.extraRules || '',
          servers: { ...(profile.workspace.servers || {}) },
        })
      }, [profile?.cwd, profile?.workspace?.gitEmail, profile?.workspace?.showServerInfo, profile?.workspace?.injectRules])
      if (!target.cwd && !target.sessionId) {
        return h(EmptyState, { title: t('personal.title'), body: t('personal.noWorkspace') })
      }
      if (!profile || !form) {
        return snapshot.profileStatus === 'error'
          ? h(EmptyState, { title: t('personal.title'), body: snapshot.profileError || t('status.error') })
          : h(Skeleton, { rows: 5 })
      }
      const update = (patch) => {
        setSaved(false)
        setFilled(false)
        setForm((current) => ({ ...current, ...patch }))
      }
      function fillRecommended() {
        const actual = profile.identity?.actual || {}
        const environment = profile.environment?.name || 'dev'
        const hasTeamRules = Boolean(profile.team)
        setSaved(false)
        setFilled(true)
        setForm((current) => ({
          ...current,
          gitName: current.gitName || actual.name || '',
          gitEmail: current.gitEmail || actual.email || '',
          environment: current.environment || environment,
          injectRules: current.injectRules || hasTeamRules,
        }))
      }
      const teamEnvs = profile.team?.environments ?? []
      const envOptions = Array.from(new Set([profile.environment?.name, ...teamEnvs.map((env) => env.name)].filter(Boolean)))
      async function submit() {
        setSaving(true)
        setError('')
        setSaved(false)
        try {
          await vr.saveWorkspace(form, target)
          setSaved(true)
          setFilled(false)
        } catch (failure) {
          setError(failure instanceof Error ? failure.message : String(failure))
        } finally {
          setSaving(false)
        }
      }
      return h(
        'div',
        { className: classNames('vr-stack', page && 'vr-stack-page') },
        h(
          'div',
          { className: 'vr-section-head' },
          h('div', null, h('h2', { className: 'vr-section-title' }, t('personal.title')), h('p', { className: 'vr-section-subtitle' }, t('personal.hint'))),
          h(
            'div',
            { className: 'vr-inline-actions' },
            h(Button, { size: 'sm', icon: h(PlusIcon), title: t('defaults.hint'), onClick: fillRecommended }, t('defaults.fill')),
            filled ? h('span', { className: 'vr-saved' }, h(CheckIcon, { size: 13 }), t('defaults.filled')) : null,
            saved ? h('span', { className: 'vr-saved' }, h(CheckIcon, { size: 13 }), t('personal.saved')) : null,
          ),
        ),
        error ? h(Notice, { tone: 'error' }, error) : null,
        h(
          'div',
          { className: 'vr-form-grid' },
          h(
            'label',
            { className: 'vr-field' },
            h('span', { className: 'vr-field-label' }, t('personal.gitName')),
            h('input', { className: 'vr-input', value: form.gitName, onChange: (event) => update({ gitName: event.target.value }) }),
            profile.identity?.actual?.name ? h('span', { className: 'vr-field-hint' }, t('defaults.gitHint')) : null,
          ),
          h(
            'label',
            { className: 'vr-field' },
            h('span', { className: 'vr-field-label' }, t('personal.gitEmail')),
            h('input', { className: 'vr-input vr-mono', value: form.gitEmail, onChange: (event) => update({ gitEmail: event.target.value }) }),
            h('span', { className: 'vr-field-hint' }, t('personal.gitHint')),
          ),
          h(
            'label',
            { className: 'vr-field' },
            h('span', { className: 'vr-field-label' }, t('personal.environment')),
            h('input', { className: 'vr-input', list: envListId, value: form.environment, onChange: (event) => update({ environment: event.target.value }) }),
            h('datalist', { id: envListId }, envOptions.map((name) => h('option', { key: name, value: name }))),
            h('span', { className: 'vr-field-hint' }, t('personal.environmentHint')),
          ),
        ),
        h(
          'div',
          { className: 'vr-switch-row' },
          h('div', null, h('div', { className: 'vr-field-label' }, t('personal.showServerInfo')), h('div', { className: 'vr-field-hint' }, t('personal.showServerInfoHint'))),
          h(Switch, {
            checked: form.showServerInfo,
            onChange: (value) => {
              if (value && !form.showServerInfo) setServerConfirm(true)
              else update({ showServerInfo: value })
            },
            label: t('personal.showServerInfo'),
          }),
        ),
        serverConfirm
          ? h(Notice, {
              tone: 'warn',
              title: t('personal.showServerInfoConfirmTitle'),
              actions: h(
                'div',
                { className: 'vr-inline-actions' },
                h(Button, { size: 'sm', variant: 'primary', onClick: () => { update({ showServerInfo: true }); setServerConfirm(false) } }, t('personal.showServerInfoConfirm')),
                h(Button, { size: 'sm', onClick: () => setServerConfirm(false) }, t('common.cancel')),
              ),
            }, t('personal.showServerInfoConfirmHint'))
          : null,
        form.showServerInfo
          ? h(
              'div',
              { className: 'vr-sub-block' },
              h('div', { className: 'vr-sub-title' }, t('personal.servers')),
              teamEnvs.length
                ? teamEnvs.map((env) =>
                    h(
                      'div',
                      { key: env.name, className: 'vr-server-row' },
                      h('div', { className: 'vr-server-name' }, h(EnvChip, { t, env, size: 'sm' })),
                      h('input', {
                        className: 'vr-input',
                        placeholder: t('personal.serverUser'),
                        value: form.servers?.[env.name]?.user || '',
                        onChange: (event) =>
                          update({
                            servers: {
                              ...form.servers,
                              [env.name]: { ...(form.servers?.[env.name] || {}), user: event.target.value },
                            },
                          }),
                      }),
                      h('input', {
                        className: 'vr-input vr-mono',
                        placeholder: t('personal.serverKeyRef'),
                        value: form.servers?.[env.name]?.keyRef || '',
                        onChange: (event) =>
                          update({
                            servers: {
                              ...form.servers,
                              [env.name]: { ...(form.servers?.[env.name] || {}), keyRef: event.target.value },
                            },
                          }),
                      }),
                    ),
                  )
                : h('p', { className: 'vr-hint' }, t('personal.noEnv')),
              h('p', { className: 'vr-hint' }, t('personal.serverKeyHint')),
            )
          : null,
        h(
          'div',
          { className: 'vr-switch-row' },
          h('div', null, h('div', { className: 'vr-field-label' }, t('personal.injectRules')), h('div', { className: 'vr-field-hint' }, t('personal.injectRulesHint'))),
          h(Switch, { checked: form.injectRules, onChange: (value) => update({ injectRules: value }), label: t('personal.injectRules') }),
        ),
        h(
          'label',
          { className: 'vr-field' },
          h('span', { className: 'vr-field-label' }, t('personal.extraRules')),
          h('textarea', {
            className: 'vr-textarea vr-mono',
            rows: 5,
            value: form.extraRules,
            placeholder: t('personal.extraRulesHint'),
            onChange: (event) => update({ extraRules: event.target.value }),
          }),
          h('span', { className: 'vr-field-hint' }, t('personal.extraRulesHint')),
        ),
        h(
          'div',
          { className: 'vr-editor-actions' },
          h(Button, { variant: 'primary', onClick: submit, disabled: saving }, saving ? t('common.saving') : t('common.save')),
        ),
      )
    }

    // ---------------------------------------------------------------------
    // Team config tab
    // ---------------------------------------------------------------------

    function TeamConfigTab({ t, vr, target }) {
      const snapshot = useVR(vr)
      const [template, setTemplate] = useState('')
      const [copied, setCopied] = useState(false)
      useEffect(() => {
        let alive = true
        callApi('/team/template')
          .then((value) => {
            if (alive) setTemplate(value.template)
          })
          .catch(() => {})
        return () => {
          alive = false
        }
      }, [])
      const profile = snapshot.profile
      const config = profile?.config
      return h(
        'div',
        { className: 'vr-stack vr-stack-page' },
        config
          ? h(
              'div',
              { className: 'vr-section-head' },
              h('div', null, h('h2', { className: 'vr-section-title' }, t('section.config')), h('p', { className: 'vr-section-subtitle' }, config.path || t('config.noFile'))),
              h(
                'div',
                { className: 'vr-inline-actions' },
                h(ConfigStatus, { t, config }),
                h(Button, { size: 'sm', icon: h(RefreshIcon), onClick: () => vr.refreshEverything(target, { force: true }) }, t('config.reload')),
              ),
            )
          : null,
        config?.errors?.length
          ? h(
              'div',
              { className: 'vr-config-errors' },
              config.errors.map((error, index) =>
                h(
                  'div',
                  { key: index, className: 'vr-config-error' },
                  h('span', { className: 'vr-config-line' }, error.line ? t('label.line').replace('{line}', String(error.line)) : t('config.invalid')),
                  h('span', null, `${error.path ? `${error.path}：` : ''}${error.message}`),
                ),
              ),
            )
          : null,
        config?.warnings?.length
          ? h(
              'div',
              { className: 'vr-config-warnings' },
              config.warnings.map((warning, index) =>
                h(
                  'div',
                  { key: index, className: 'vr-config-warning' },
                  warning.line ? `${t('label.line').replace('{line}', String(warning.line))} · ` : '',
                  `${warning.path ? `${warning.path}：` : ''}${warning.message}`,
                ),
              ),
            )
          : null,
        h('p', { className: 'vr-hint' }, t('config.templateHint')),
        h(
          'div',
          { className: 'vr-template-head' },
          h('h3', { className: 'vr-sub-title' }, t('config.templateTitle')),
          h(
            'div',
            { className: 'vr-inline-actions' },
            copied ? h('span', { className: 'vr-saved' }, h(CheckIcon, { size: 13 }), t('common.copied')) : null,
            h(
              Button,
              {
                size: 'sm',
                icon: h(CopyIcon),
                onClick: async () => {
                  if (await copyText(template)) {
                    setCopied(true)
                    setTimeout(() => setCopied(false), 2000)
                  }
                },
              },
              t('action.copyTemplate'),
            ),
          ),
        ),
        h('pre', { className: 'vr-code-block' }, template || t('common.loading')),
      )
    }

    // ---------------------------------------------------------------------
    // Injection preview
    // ---------------------------------------------------------------------

    function InjectionPreview({ t, vr, target }) {
      const snapshot = useVR(vr)
      const [copied, setCopied] = useState(false)
      useEffect(() => {
        vr.loadPreview(target)
      }, [target.cwd, target.sessionId])
      const preview = snapshot.preview
      const loading = snapshot.previewStatus === 'loading' && !preview
      if (!target.cwd && !target.sessionId) {
        return h(EmptyState, { title: t('preview.title'), body: t('overlay.noSession') })
      }
      return h(
        'div',
        { className: 'vr-stack vr-stack-page' },
        h(
          'div',
          { className: 'vr-section-head' },
          h('div', null, h('h2', { className: 'vr-section-title' }, t('preview.title')), h('p', { className: 'vr-section-subtitle' }, t('preview.hint'))),
          h(
            'div',
            { className: 'vr-inline-actions' },
            h(Button, { size: 'sm', icon: h(RefreshIcon), onClick: () => vr.loadPreview(target, { force: true }) }, t('common.refresh')),
            preview?.text
              ? h(
                  Button,
                  {
                    size: 'sm',
                    variant: 'primary',
                    icon: h(CopyIcon),
                    onClick: async () => {
                      if (await copyText(preview.text)) {
                        setCopied(true)
                        setTimeout(() => setCopied(false), 2000)
                      }
                    },
                  },
                  copied ? t('common.copied') : t('action.copyText'),
                )
              : null,
          ),
        ),
        loading ? h(Skeleton, { rows: 6 }) : null,
        snapshot.previewStatus === 'error' && !preview ? h(Notice, { tone: 'error' }, snapshot.previewError) : null,
        preview
          ? h(
              'div',
              { className: 'vr-preview-meta' },
              h('span', { className: 'vr-pill' }, `${t('label.totalChars')} ${formatNumber(preview.totalChars)}`),
              h('span', { className: 'vr-pill' }, `${t('label.limit')} ${formatNumber(preview.maxChars)}`),
              h('span', { className: 'vr-pill' }, `${t('label.packs')} ${preview.entries.length}`),
              preview.truncated ? h('span', { className: 'vr-pill vr-pill-warn' }, t('preview.truncated')) : null,
            )
          : null,
        preview?.entries?.length
          ? h(
              'div',
              { className: 'vr-pack-chips' },
              preview.entries.map((entry) =>
                h('span', { key: `${entry.scope}:${entry.id}`, className: classNames('vr-chip', entry.truncated && 'vr-chip-warn') }, `${entry.title} · ${scopeLabel(t, entry.scope)} · ${formatNumber(entry.chars)}`),
              ),
            )
          : null,
        preview?.omitted?.length
          ? h(
              'div',
              { className: 'vr-hint' },
              `${t('preview.omitted')}：${preview.omitted.map((entry) => `${entry.title}（${entry.id}）`).join('、')}`,
            )
          : null,
        preview?.text
          ? h('pre', { className: 'vr-code-block vr-preview-text' }, preview.text)
          : snapshot.previewStatus === 'ready'
            ? h(EmptyState, { title: t('preview.title'), body: t('preview.empty') })
            : null,
      )
    }

    // ---------------------------------------------------------------------
    // Settings page
    // ---------------------------------------------------------------------

    function SettingsPage(props) {
      const { t, vr, ctx } = props
      const { cwd, sessionId } = useTarget(props)
      const [tab, setTab] = useState('packs')
      const target = { cwd, sessionId }
      const tabs = [
        ['packs', t('profile.tab.packs')],
        ['validation', t('profile.tab.validation')],
        ['personal', t('profile.tab.personal')],
        ['preview', t('profile.tab.preview')],
      ]
      return h(
        'div',
        { className: 'vr-settings' },
        h(
          'header',
          { className: 'vr-settings-head' },
          h('div', null, h('h1', { className: 'vr-settings-title' }, t('settings.title')), h('p', { className: 'vr-settings-subtitle' }, t('settings.subtitle'))),
          h(
            'div',
            { className: 'vr-inline-actions' },
            h(Button, { size: 'sm', icon: h(ExternalIcon), onClick: () => openProfile(ctx, vr, tab) }, t('action.openProfile')),
          ),
        ),
        h(
          'div',
          { className: 'vr-tabs', role: 'tablist' },
          tabs.map(([id, label]) =>
            h(
              'button',
              { key: id, type: 'button', role: 'tab', 'aria-selected': tab === id, className: classNames('vr-tab', tab === id && 'vr-tab-active'), onClick: () => setTab(id) },
              label,
            ),
          ),
        ),
        !cwd && !sessionId ? h('p', { className: 'vr-hint' }, t('settings.noWorkspace')) : null,
        h(
          'div',
          { className: 'vr-settings-body' },
          tab === 'packs' ? h(PackManager, { t, vr, ctx, target, page: true }) : null,
          tab === 'validation' ? h(ValidationPanel, { t, vr, target, page: true }) : null,
          tab === 'personal' ? h(PersonalConfig, { t, vr, target, page: true }) : null,
          tab === 'preview' ? h(InjectionPreview, { t, vr, target }) : null,
        ),
      )
    }

    // ---------------------------------------------------------------------
    // Styles
    // ---------------------------------------------------------------------

    const CLIENT_CSS = `
      .vr-header-btn {
        position: relative;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        padding: 0;
        border: 0;
        border-radius: 6px;
        background: transparent;
        color: var(--dsw-alias-label-secondary);
        cursor: pointer;
        font: inherit;
        flex: none;
      }
      .vr-header-btn:hover, .vr-header-btn-open {
        background: var(--dsw-alias-bg-layer-2);
        color: var(--dsw-alias-label-primary);
      }
      .vr-header-btn:focus-visible {
        outline: 2px solid var(--dsw-alias-brand-primary);
        outline-offset: 1px;
      }
      .vr-header-icon { opacity: .92; }
      .vr-header-btn-empty { opacity: .6; }
      .vr-header-btn-nogit { opacity: .68; }
      .vr-dot-pulse { animation: vr-pulse 2.2s ease-in-out infinite; }
      .vr-dot {
        width: 7px; height: 7px; border-radius: 50%;
        background: var(--dsw-alias-label-secondary);
        display: inline-block;
        flex: none;
      }
      .vr-dot.vr-env-dev { background: var(--dsw-alias-state-idle-primary); }
      .vr-dot.vr-env-test { background: var(--dsw-alias-brand-primary); }
      .vr-dot.vr-env-staging { background: var(--dsw-alias-state-warn-primary); }
      .vr-dot.vr-env-prod { background: var(--dsw-alias-state-error-primary); }
      .vr-dot.vr-env-info { background: var(--dsw-alias-brand-primary); }
      .vr-dot-loading { animation: vr-pulse 1.2s ease-in-out infinite; }
      .vr-badge {
        min-width: 14px; height: 14px; padding: 0 4px; border-radius: 7px;
        background: var(--dsw-alias-state-error-primary); color: #fff;
        font-size: 10px; line-height: 14px; text-align: center; font-weight: 600;
        box-sizing: border-box;
      }
      .vr-header-btn .vr-header-dot {
        position: absolute;
        right: 4px;
        bottom: 4px;
        width: 6px;
        height: 6px;
        box-shadow: 0 0 0 1.5px var(--dsw-alias-bg-base);
      }
      .vr-header-btn-error .vr-header-dot { background: var(--dsw-alias-state-error-primary); }
      .vr-header-btn .vr-badge {
        position: absolute;
        top: -3px;
        right: -4px;
        min-width: 13px;
        height: 13px;
        padding: 0 3px;
        border-radius: 7px;
        font-size: 9px;
        line-height: 13px;
        box-shadow: 0 0 0 1.5px var(--dsw-alias-bg-base);
      }
      .vr-env-chip {
        display: inline-flex; align-items: center; gap: 5px;
        padding: 2px 8px; border-radius: 999px;
        font-size: 12px; line-height: 18px;
        border: 1px solid var(--dsw-alias-border-l1);
        background: var(--dsw-alias-bg-layer-2);
        color: var(--dsw-alias-label-primary);
        white-space: nowrap;
      }
      .vr-env-chip.vr-env-prod { border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 55%, transparent); background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 12%, transparent); color: var(--dsw-alias-state-error-primary); }
      .vr-env-chip.vr-env-staging { border-color: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 45%, transparent); background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 10%, transparent); color: var(--dsw-alias-state-warn-primary); }
      .vr-env-chip.vr-env-test, .vr-env-chip.vr-env-info { border-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 40%, transparent); background: color-mix(in srgb, var(--dsw-alias-brand-primary) 9%, transparent); color: var(--dsw-alias-brand-primary); }
      .vr-env-chip.vr-env-dev { color: var(--dsw-alias-label-secondary); }
      .vr-chip-pulse { animation: vr-pulse-border 2.2s ease-in-out infinite; }
      .vr-chip { display: inline-flex; align-items: center; gap: 5px; padding: 2px 8px; border-radius: 6px; background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-border-l1); color: var(--dsw-alias-label-primary); font-size: 12px; line-height: 18px; max-width: 100%; }
      .vr-chip-sm { font-size: 11px; padding: 1px 6px; line-height: 16px; }
      .vr-chip-muted { color: var(--dsw-alias-label-secondary); }
      .vr-chip-warn { border-color: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 45%, transparent); }
      .vr-chip-scope { color: var(--dsw-alias-label-secondary); font-size: 10px; }
      .vr-chips { display: flex; flex-wrap: wrap; gap: 5px; }
      .vr-pill { display: inline-flex; align-items: center; gap: 4px; padding: 1px 7px; border-radius: 999px; background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-border-l1); font-size: 11px; line-height: 17px; color: var(--dsw-alias-label-secondary); white-space: nowrap; }
      .vr-pill-warn { color: var(--dsw-alias-state-warn-primary); border-color: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 40%, transparent); }
      .vr-pill-danger { color: var(--dsw-alias-state-error-primary); border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 40%, transparent); }
      .vr-pill-ok { color: var(--dsw-alias-state-success-primary); border-color: color-mix(in srgb, var(--dsw-alias-state-success-primary) 40%, transparent); }
      .vr-pill-muted { color: var(--dsw-alias-label-secondary); }
      .vr-btn { display: inline-flex; align-items: center; justify-content: center; gap: 5px; height: 28px; padding: 0 10px; border-radius: 7px; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font: inherit; font-size: 12px; cursor: pointer; white-space: nowrap; }
      .vr-btn:hover { border-color: var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-2); }
      .vr-btn:disabled { opacity: .55; cursor: default; }
      .vr-btn-primary { background: var(--dsw-alias-brand-primary); border-color: var(--dsw-alias-brand-primary); color: #fff; }
      .vr-btn-primary:hover { background: var(--dsw-alias-brand-primary); border-color: var(--dsw-alias-brand-primary); filter: brightness(1.05); }
      .vr-btn-sm { height: 24px; padding: 0 8px; font-size: 11px; border-radius: 6px; }
      .vr-btn-icon { display: inline-flex; align-items: center; }
      .vr-icon-btn { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; padding: 0; border: 0; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; }
      .vr-icon-btn:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
      .vr-icon-btn-danger { color: var(--dsw-alias-state-error-primary); }
      .vr-link { color: var(--dsw-alias-brand-primary); text-decoration: none; background: none; border: 0; padding: 0; font: inherit; cursor: pointer; word-break: break-all; }
      .vr-link:hover { text-decoration: underline; }
      .vr-mono, .vr-code-block, code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
      .vr-muted { color: var(--dsw-alias-label-secondary); }
      .vr-truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; display: inline-block; vertical-align: bottom; }
      .vr-warn-text { color: var(--dsw-alias-state-warn-primary); }
      .vr-env-none { color: var(--dsw-alias-label-secondary); }
      .vr-env-info { color: var(--dsw-alias-brand-primary); }
      .vr-env-test { color: var(--dsw-alias-brand-primary); }
      .vr-env-dev { color: var(--dsw-alias-label-secondary); }
      .vr-env-staging { color: var(--dsw-alias-state-warn-primary); }
      .vr-env-prod { color: var(--dsw-alias-state-error-primary); }
      .vr-skeleton { display: flex; flex-direction: column; gap: 8px; padding: 4px 0; width: 100%; }
      .vr-skeleton-row { height: 12px; border-radius: 5px; background: var(--dsw-alias-bg-layer-2); animation: vr-shimmer 1.4s ease-in-out infinite; }
      .vr-skeleton-row-lg { height: 18px; width: 62%; }
      .vr-notice { display: flex; align-items: flex-start; gap: 8px; padding: 9px 10px; border-radius: 8px; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); font-size: 12px; }
      .vr-notice + .vr-notice { margin-top: 6px; }
      .vr-notice-info { border-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 35%, transparent); }
      .vr-notice-warn { border-color: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 45%, transparent); }
      .vr-notice-error { border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 45%, transparent); }
      .vr-notice-icon { color: var(--dsw-alias-label-secondary); padding-top: 1px; flex: none; }
      .vr-notice-warn .vr-notice-icon { color: var(--dsw-alias-state-warn-primary); }
      .vr-notice-error .vr-notice-icon { color: var(--dsw-alias-state-error-primary); }
      .vr-notice-body { min-width: 0; flex: 1; }
      .vr-notice-title { font-weight: 600; color: var(--dsw-alias-label-primary); }
      .vr-notice-text { color: var(--dsw-alias-label-secondary); margin-top: 2px; line-height: 1.5; word-break: break-word; }
      .vr-notice-actions { flex: none; }
      .vr-page { height: 100%; overflow: auto; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font-size: 13px; }
      .vr-page-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding: 22px 28px 12px; }
      .vr-page-title-wrap { min-width: 0; }
      .vr-eyebrow { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: var(--dsw-alias-label-secondary); }
      .vr-page-title { margin: 6px 0 2px; font-size: 22px; line-height: 1.25; font-weight: 650; letter-spacing: -.01em; }
      .vr-page-path { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; color: var(--dsw-alias-label-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 70vw; }
      .vr-page-head-actions { display: flex; align-items: center; gap: 8px; flex: none; padding-top: 4px; }
      .vr-tabs { display: flex; align-items: center; gap: 2px; padding: 0 28px; border-bottom: 1px solid var(--dsw-alias-border-l1); }
      .vr-tab { appearance: none; border: 0; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 12px; padding: 9px 10px; border-bottom: 2px solid transparent; cursor: pointer; }
      .vr-tab:hover { color: var(--dsw-alias-label-primary); }
      .vr-tab-active { color: var(--dsw-alias-label-primary); border-bottom-color: var(--dsw-alias-brand-primary); }
      .vr-tab-meta { margin-left: auto; font-size: 11px; color: var(--dsw-alias-label-secondary); }
      .vr-page-body { padding: 18px 28px 40px; max-width: 1120px; }
      .vr-grid { display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; align-items: start; }
      .vr-span-2 { grid-column: 1 / -1; }
      .vr-stack { display: flex; flex-direction: column; gap: 12px; }
      .vr-stack-page { max-width: 900px; }
      .vr-card { border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); overflow: hidden; }
      .vr-card-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; padding: 13px 14px 0; }
      .vr-card-title { margin: 0; font-size: 13px; font-weight: 600; }
      .vr-card-subtitle { margin: 3px 0 0; font-size: 11px; color: var(--dsw-alias-label-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .vr-card-actions { flex: none; }
      .vr-card-body { padding: 10px 14px 14px; }
      .vr-row { display: flex; align-items: baseline; gap: 10px; padding: 4px 0; min-height: 22px; }
      .vr-row-label { flex: none; width: 92px; color: var(--dsw-alias-label-secondary); font-size: 11px; }
      .vr-row-value { flex: 1; min-width: 0; word-break: break-word; font-size: 12px; }
      .vr-row-actions { flex: none; }
      .vr-scope { display: inline-block; margin-left: 6px; color: var(--dsw-alias-label-secondary); font-size: 10px; }
      .vr-inline-warn { display: flex; align-items: center; gap: 5px; color: var(--dsw-alias-state-warn-primary); font-size: 11px; margin-top: 4px; }
      .vr-hint { margin: 6px 0 0; color: var(--dsw-alias-label-secondary); font-size: 11px; line-height: 1.55; }
      .vr-sub-block { margin-top: 10px; padding-top: 9px; border-top: 1px dashed var(--dsw-alias-border-l1); }
      .vr-sub-title { font-size: 11px; font-weight: 600; color: var(--dsw-alias-label-secondary); margin-bottom: 5px; }
      .vr-commit { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
      .vr-commit code { font-size: 11px; color: var(--dsw-alias-brand-primary); background: var(--dsw-alias-bg-layer-2); padding: 1px 5px; border-radius: 4px; }
      .vr-commit-subject { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
      .vr-inline-actions { display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap; }
      .vr-pack-chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 2px 0 8px; }
      .vr-meter-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; font-size: 11px; color: var(--dsw-alias-label-secondary); margin-top: 9px; }
      .vr-meter { height: 5px; border-radius: 3px; background: var(--dsw-alias-bg-layer-2); overflow: hidden; margin-top: 5px; }
      .vr-meter-fill { height: 100%; border-radius: 3px; background: var(--dsw-alias-brand-primary); }
      .vr-warning-list { display: flex; flex-direction: column; gap: 6px; }
      .vr-warning { display: flex; gap: 8px; padding: 8px 10px; border-radius: 8px; background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l1); font-size: 12px; }
      .vr-warning-info { opacity: .86; }
      .vr-warning-warn { border-color: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 36%, transparent); }
      .vr-warning-error { border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 40%, transparent); }
      .vr-warning-icon { color: var(--dsw-alias-label-secondary); flex: none; padding-top: 1px; }
      .vr-warning-warn .vr-warning-icon { color: var(--dsw-alias-state-warn-primary); }
      .vr-warning-error .vr-warning-icon { color: var(--dsw-alias-state-error-primary); }
      .vr-warning .vr-warning-icon-alert { color: var(--dsw-alias-state-error-primary); }
      .vr-warning-body { min-width: 0; }
      .vr-warning-title { font-weight: 600; }
      .vr-warning-text { color: var(--dsw-alias-label-secondary); margin-top: 2px; line-height: 1.5; word-break: break-word; }
      .vr-warning-more { display: flex; align-items: center; gap: 8px; font-size: 11px; color: var(--dsw-alias-label-secondary); }
      .vr-ok-line { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--dsw-alias-state-success-primary); }
      .vr-notice-stack { margin-bottom: 2px; }
      .vr-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; gap: 8px; padding: 48px 24px; color: var(--dsw-alias-label-secondary); min-height: 220px; }
      .vr-empty-icon { opacity: .45; }
      .vr-empty-title { font-size: 14px; font-weight: 600; color: var(--dsw-alias-label-primary); }
      .vr-empty-body { font-size: 12px; max-width: 460px; line-height: 1.6; }
      .vr-empty-actions { display: flex; gap: 8px; margin-top: 4px; }
      .vr-quick { display: flex; flex-direction: column; gap: 10px; padding: 12px 12px 16px; color: var(--dsw-alias-label-primary); font-size: 12px; line-height: 1.55; overflow-y: auto; height: 100%; box-sizing: border-box; }
      .vr-quick-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; padding: 0 1px; }
      .vr-quick-title-wrap { min-width: 0; }
      .vr-quick-title { font-size: 14px; font-weight: 600; line-height: 1.35; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .vr-quick-path { margin-top: 3px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; line-height: 1.4; color: var(--dsw-alias-label-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .vr-quick-head-actions { display: flex; align-items: center; gap: 4px; flex: none; }
      .vr-quick-section { min-width: 0; border: 1px solid var(--dsw-alias-border-l1); border-radius: 9px; background: var(--dsw-alias-bg-layer-1); padding: 10px 11px 11px; }
      .vr-quick-section-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin-bottom: 7px; }
      .vr-quick-section-title { margin: 0; min-width: 0; font-size: 12px; font-weight: 600; line-height: 1.4; color: var(--dsw-alias-label-primary); letter-spacing: 0; text-transform: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .vr-quick-section-meta { flex: none; font-size: 11px; line-height: 1.4; color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; white-space: nowrap; }
      .vr-quick-section-body { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
      .vr-quick .vr-row { display: grid; grid-template-columns: 72px minmax(0, 1fr); gap: 9px; align-items: start; padding: 2px 0; min-height: 0; }
      .vr-quick .vr-row-label { width: auto; font-size: 12px; line-height: 1.55; padding-top: 1px; }
      .vr-quick .vr-row-value { font-size: 12px; line-height: 1.55; }
      .vr-quick-note { color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 1.6; }
      .vr-quick-note + .vr-quick-note { margin-top: 3px; }
      .vr-quick .vr-row + .vr-quick-note { margin-top: 5px; }
      .vr-quick-empty { border-radius: 6px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 1.6; padding: 7px 9px; }
      .vr-quick .vr-row + .vr-quick-empty { margin-top: 6px; }
      .vr-quick .vr-warning { background: var(--dsw-alias-bg-layer-2); }
      .vr-quick-inline { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 6px; }
      .vr-rule-mini { display: flex; flex-direction: column; gap: 4px; font-size: 12px; line-height: 1.55; }
      .vr-rule-mini code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11px; background: var(--dsw-alias-bg-layer-2); padding: 1px 5px; border-radius: 4px; word-break: break-all; }
      .vr-quick-packs { display: flex; flex-wrap: wrap; gap: 5px; }
      .vr-quick-actions { display: flex; flex-wrap: wrap; gap: 8px; padding: 2px 1px 0; }
      .vr-quick-actions .vr-btn { flex: 1 1 120px; }
      .vr-quick .vr-default-pack { display: flex; flex-direction: column; align-items: stretch; gap: 4px; margin-top: 6px; }
      .vr-quick .vr-default-pack .vr-btn { width: 100%; }
      .vr-overlay-layer { position: fixed; inset: 0; z-index: 60; pointer-events: none; }
      .vr-overlay-panel { pointer-events: auto; position: fixed; right: 14px; bottom: 14px; width: min(400px, calc(100vw - 28px)); max-height: min(72vh, 660px); display: flex; flex-direction: column; background: var(--dsw-alias-bg-overlay); border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; box-shadow: 0 14px 38px rgba(0,0,0,.22); overflow: hidden; }
      .vr-overlay-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--dsw-alias-border-l1); }
      .vr-overlay-title { display: flex; align-items: center; gap: 7px; font-size: 12px; font-weight: 600; }
      .vr-overlay-body { flex: 1; min-height: 0; overflow: hidden; }
      .vr-overlay-body .vr-quick { height: auto; max-height: calc(min(72vh, 660px) - 45px); }
      .vr-tab-title { display: inline-flex; align-items: center; gap: 5px; }
      .vr-editor { border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); padding: 14px; display: flex; flex-direction: column; gap: 10px; }
      .vr-editor-head { display: flex; align-items: center; justify-content: space-between; }
      .vr-editor-title { margin: 0; font-size: 13px; font-weight: 650; }
      .vr-editor-actions { display: flex; gap: 8px; }
      .vr-form-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px; }
      .vr-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
      .vr-field-label { font-size: 11px; font-weight: 550; color: var(--dsw-alias-label-secondary); }
      .vr-field-hint { font-size: 10.5px; color: var(--dsw-alias-label-secondary); line-height: 1.5; }
      .vr-input, .vr-textarea { width: 100%; box-sizing: border-box; border: 1px solid var(--dsw-alias-border-l1); border-radius: 7px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font: inherit; font-size: 12px; padding: 6px 8px; outline: none; }
      .vr-input:focus, .vr-textarea:focus { border-color: var(--dsw-alias-brand-primary); }
      .vr-input:disabled { opacity: .65; }
      .vr-textarea { resize: vertical; line-height: 1.55; min-height: 80px; }
      .vr-check-row { display: flex; align-items: center; gap: 7px; font-size: 12px; flex-wrap: wrap; }
      .vr-check-row .vr-field-hint { width: 100%; padding-left: 20px; }
      .vr-switch { border: 0; background: transparent; padding: 0; cursor: pointer; }
      .vr-switch-track { display: inline-flex; align-items: center; width: 30px; height: 18px; border-radius: 9px; background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-border-l2); padding: 1px; box-sizing: border-box; transition: background .15s ease; }
      .vr-switch-thumb { width: 14px; height: 14px; border-radius: 50%; background: var(--dsw-alias-label-secondary); transition: transform .15s ease, background .15s ease; }
      .vr-switch-on .vr-switch-track { background: var(--dsw-alias-brand-primary); border-color: var(--dsw-alias-brand-primary); }
      .vr-switch-on .vr-switch-thumb { transform: translateX(12px); background: #fff; }
      .vr-switch-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 9px 0; border-top: 1px dashed var(--dsw-alias-border-l1); }
      .vr-section-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
      .vr-section-head-team { margin-top: 18px; }
      .vr-section-title { margin: 0; font-size: 14px; font-weight: 650; }
      .vr-section-subtitle { margin: 3px 0 0; font-size: 11px; color: var(--dsw-alias-label-secondary); line-height: 1.55; }
      .vr-pack-list { display: flex; flex-direction: column; gap: 7px; margin-top: 8px; }
      .vr-default-pack { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
      .vr-default-pack-error { color: var(--dsw-alias-state-error-primary); font-size: 11px; line-height: 1.5; }
      .vr-empty-strip { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; padding: 10px 12px; border: 1px dashed var(--dsw-alias-border-l1); border-radius: 8px; background: var(--dsw-alias-bg-layer-1); }
      .vr-empty-strip .vr-hint { margin: 0; }
      .vr-empty-strip .vr-default-pack { margin-top: 0; }
      .vr-editor-hint { margin: -2px 0 2px; }
      .vr-pack-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; padding: 10px 12px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 9px; background: var(--dsw-alias-bg-layer-1); }
      .vr-pack-row-on { border-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 36%, transparent); }
      .vr-pack-main { min-width: 0; flex: 1; }
      .vr-pack-title-line { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }
      .vr-pack-title { font-size: 12.5px; font-weight: 600; }
      .vr-pack-id { font-size: 10.5px; color: var(--dsw-alias-label-secondary); margin-top: 1px; }
      .vr-pack-desc { font-size: 11px; color: var(--dsw-alias-label-secondary); margin-top: 3px; }
      .vr-pack-meta { font-size: 10.5px; color: var(--dsw-alias-label-secondary); margin-top: 3px; }
      .vr-pack-actions { display: flex; align-items: center; gap: 14px; flex: none; flex-wrap: wrap; justify-content: flex-end; }
      .vr-pack-switch { display: flex; align-items: center; gap: 6px; }
      .vr-pack-switch .vr-field-label { white-space: nowrap; }
      .vr-server-row { display: grid; grid-template-columns: 110px minmax(0,1fr) minmax(0,1fr); gap: 7px; align-items: center; margin-top: 6px; }
      .vr-server-name { min-width: 0; }
      .vr-saved { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; color: var(--dsw-alias-state-success-primary); }
      .vr-settings { padding: 18px 22px 40px; color: var(--dsw-alias-label-primary); font-size: 13px; height: 100%; overflow: auto; box-sizing: border-box; }
      .vr-settings-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
      .vr-settings-title { margin: 0; font-size: 17px; font-weight: 650; }
      .vr-settings-subtitle { margin: 4px 0 0; font-size: 11.5px; color: var(--dsw-alias-label-secondary); }
      .vr-settings .vr-tabs { padding: 0; margin: 14px 0 12px; }
      .vr-settings-body { display: flex; flex-direction: column; gap: 12px; }
      .vr-config-errors, .vr-config-warnings { display: flex; flex-direction: column; gap: 5px; margin-top: 8px; }
      .vr-config-error, .vr-config-warning { display: flex; gap: 8px; font-size: 11.5px; line-height: 1.5; padding: 6px 8px; border-radius: 6px; background: var(--dsw-alias-bg-layer-2); }
      .vr-config-error { border-left: 2px solid var(--dsw-alias-state-error-primary); }
      .vr-config-warning { border-left: 2px solid var(--dsw-alias-state-warn-primary); }
      .vr-config-line { flex: none; color: var(--dsw-alias-label-secondary); }
      .vr-template-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 14px; }
      .vr-code-block { margin: 8px 0 0; padding: 12px; border-radius: 8px; background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-border-l1); font-size: 11px; line-height: 1.55; overflow: auto; max-height: 52vh; white-space: pre-wrap; word-break: break-word; color: var(--dsw-alias-label-primary); }
      .vr-preview-meta { display: flex; flex-wrap: wrap; gap: 6px; }
      .vr-preview-text { max-height: none; }
      .vr-tab-meta, .vr-quick-section-meta, .vr-field-hint { font-variant-numeric: tabular-nums; }
      .vr-crash { display: inline-flex; align-items: center; gap: 6px; max-width: 320px; padding: 4px 8px; border: 1px solid var(--dsw-alias-state-error-primary); border-radius: 6px; color: var(--dsw-alias-state-error-primary); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .vr-stack-tight { display: flex; flex-direction: column; gap: 8px; }
      .vr-select { appearance: auto; font: inherit; font-size: 12px; padding: 4px 7px; border-radius: 6px; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); }
      .vr-select:disabled { opacity: .55; }
      .vr-chip-ok { color: var(--dsw-alias-state-success-primary); border-color: color-mix(in srgb, var(--dsw-alias-state-success-primary) 34%, transparent); }
      .vr-chip-warn { color: var(--dsw-alias-state-warn-primary); border-color: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 34%, transparent); }
      .vr-chip-danger { color: var(--dsw-alias-state-error-primary); border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 34%, transparent); }
      .vr-rule-summary { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
      .vr-rule-list { display: flex; flex-direction: column; border: 1px solid var(--dsw-alias-border-l1); border-radius: 9px; overflow: hidden; }
      .vr-rule-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 7px 11px; border-bottom: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); }
      .vr-rule-row:last-child { border-bottom: 0; }
      .vr-rule-main { min-width: 0; display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
      .vr-rule-title { font-size: 12.5px; }
      .vr-rule-id { font-size: 10.5px; color: var(--dsw-alias-label-secondary); }
      .vr-findings { display: flex; flex-direction: column; gap: 7px; margin-top: 10px; }
      .vr-finding { border-left: 2px solid var(--dsw-alias-border-l1); padding: 7px 10px; border-radius: 0 7px 7px 0; background: var(--dsw-alias-bg-layer-2); font-size: 12px; }
      .vr-finding-block { border-left-color: var(--dsw-alias-state-error-primary); }
      .vr-finding-warn { border-left-color: var(--dsw-alias-state-warn-primary); }
      .vr-finding-info { border-left-color: var(--dsw-alias-border-l2); }
      .vr-finding-head { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }
      .vr-finding-level { font-size: 10.5px; text-transform: uppercase; color: var(--dsw-alias-label-secondary); }
      .vr-finding-title { font-weight: 600; }
      .vr-finding-id { font-size: 10px; color: var(--dsw-alias-label-secondary); }
      .vr-finding-text { margin-top: 3px; color: var(--dsw-alias-label-primary); }
      .vr-finding-fix { margin-top: 3px; color: var(--dsw-alias-label-secondary); font-size: 11.5px; }
      .vr-hook-list { display: flex; flex-direction: column; gap: 5px; }
      .vr-hook-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 12px; padding: 6px 9px; border-radius: 7px; background: var(--dsw-alias-bg-layer-2); }
      .vr-hook-code { max-height: 240px; font-size: 10.5px; }
      .vr-bypass-list { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; }
      .vr-bypass-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 7px 10px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; background: var(--dsw-alias-bg-layer-1); }
      .vr-bypass-main { min-width: 0; }
      .vr-details { margin-top: 9px; font-size: 11.5px; color: var(--dsw-alias-label-secondary); }
      .vr-details summary { cursor: pointer; }
      .vr-event-list { display: flex; flex-direction: column; gap: 7px; }
      .vr-event { border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; padding: 7px 10px; background: var(--dsw-alias-bg-layer-1); }
      .vr-event-block { border-left: 2px solid var(--dsw-alias-state-error-primary); }
      .vr-event-warn { border-left: 2px solid var(--dsw-alias-state-warn-primary); }
      .vr-event-allow { border-left: 2px solid var(--dsw-alias-state-success-primary); }
      .vr-event-bypass { border-left: 2px solid var(--dsw-alias-state-warn-primary); }
      .vr-event-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 11.5px; }
      .vr-event-time { color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; }
      .vr-event-command { margin-left: auto; max-width: 62%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 10.5px; color: var(--dsw-alias-label-secondary); }
      .vr-event-finding { margin-top: 4px; font-size: 11.5px; color: var(--dsw-alias-label-primary); }
      .vr-event-finding-block { color: var(--dsw-alias-state-error-primary); }
      .vr-commit-list { display: flex; flex-direction: column; border: 1px solid var(--dsw-alias-border-l1); border-radius: 9px; overflow: hidden; }
      .vr-commit-row { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-bottom: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); }
      .vr-commit-row:last-child { border-bottom: 0; }
      .vr-commit-hash { font-size: 11px; color: var(--dsw-alias-brand-primary); flex: none; }
      .vr-commit-main { min-width: 0; flex: 1; }
      .vr-commit-subject { font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .vr-commit-meta { font-size: 10.5px; color: var(--dsw-alias-label-secondary); margin-top: 1px; }
      .vr-commit-actions { display: flex; align-items: center; gap: 4px; flex: none; }
      .vr-source-list { display: flex; flex-direction: column; gap: 6px; }
      .vr-source-row { display: grid; grid-template-columns: 108px minmax(0, 1fr); gap: 8px; align-items: baseline; padding: 6px 0; border-bottom: 1px dashed var(--dsw-alias-border-l1); }
      .vr-source-row:last-child { border-bottom: 0; }
      .vr-source-label { font-size: 11px; color: var(--dsw-alias-label-secondary); }
      .vr-source-value { min-width: 0; font-size: 11.5px; word-break: break-all; }
      @keyframes vr-pulse { 0%, 100% { opacity: .45; } 50% { opacity: 1; } }
      @keyframes vr-pulse-border { 0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--dsw-alias-state-error-primary) 34%, transparent); } 50% { box-shadow: 0 0 0 4px transparent; } }
      @keyframes vr-shimmer { 0%, 100% { opacity: .5; } 50% { opacity: 1; } }
      @media (max-width: 640px) {
        .vr-page-head, .vr-page-body, .vr-tabs { padding-left: 16px; padding-right: 16px; }
        .vr-page-title { font-size: 19px; }
        .vr-server-row { grid-template-columns: 1fr; }
        .vr-pack-row { flex-direction: column; }
        .vr-pack-actions { justify-content: flex-start; }
        .vr-overlay-panel { right: 8px; left: 8px; width: auto; }
      }
    `

    // ---------------------------------------------------------------------
    // Plugin entry
    // ---------------------------------------------------------------------

    return {
      inject: ['slots', 'locale', 'layout'],
      apply(ctx) {
        const vr = createStore(ctx)
        const t = ctx.locale.bind(NS)
        ctx.effect(() => ctx.locale.register(NS, 'zh', ZH), 'visualrules: locale zh')
        ctx.effect(() => ctx.locale.register(NS, 'en', EN), 'visualrules: locale en')

        try {
          ctx.effect(
            () => {
              const style = document.createElement('style')
              style.dataset.visualrules = 'styles'
              style.textContent = CLIENT_CSS
              document.head.appendChild(style)
              return () => style.remove()
            },
            'visualrules: styles',
          )
        } catch {
          /* no document (tests) */
        }

        // Session header: the leading edge of the right-aligned utility
        // cluster, to the left of the shipped header controls.
        try {
          ctx.slots.inject('conversation.session.header.utilities', () =>
            ctx.slots.register(
              {
                name: 'conversation.session.header.utilities',
                id: 'visualrules-status',
                order: -20,
                label: () => t('nav.title'),
                locale: NS,
                inject: () => ({ vr, ctx }),
              },
              guarded(HeaderEntry),
            ),
          )
        } catch (error) {
          ctx.logger?.warn?.(`visualrules: could not register the session-header entry: ${error instanceof Error ? error.message : String(error)}`)
        }

        // Sidebar panel icon + full profile page.
        try {
          ctx.slots.inject('sidebar.panellist', () =>
            ctx.slots.register(
              {
                name: 'sidebar.panellist',
                id: PANEL_KEY,
                order: 7,
                label: () => t('nav.title'),
                locale: NS,
                inject: () => ({ vr, ctx }),
              },
              guarded(PanelIcon),
            ),
          )
        } catch {
          /* the shell may not declare the seat */
        }
        try {
          ctx.slots.inject('main', () =>
            ctx.slots.register(
              {
                name: 'main',
                key: PANEL_KEY,
                locale: NS,
                inject: () => ({ vr, ctx }),
              },
              guarded(ProfilePage),
            ),
          )
        } catch {
          /* the shell may not declare the seat */
        }

        // Settings section.
        try {
          ctx.slots.inject('settings.section', () =>
            ctx.slots.register(
              {
                name: 'settings.section',
                id: PANEL_KEY,
                order: 30,
                label: () => t('nav.title'),
                locale: NS,
                inject: () => ({ vr, ctx }),
              },
              guarded(SettingsPage),
            ),
          )
        } catch {
          /* settings may be disabled in this profile */
        }

        // Right sidebar quick preview: register a native tab type + body +
        // title. This is the official extension seat of ui-sidebar-right.
        try {
          const rightTabs = ctx.get('sidebarRightTabs')
          if (rightTabs && typeof rightTabs.register === 'function') {
            ctx.effect(
              () =>
                rightTabs.register({
                  id: PREVIEW_KIND,
                  kind: PREVIEW_KIND,
                  keepMounted: true,
                  title: () => t('nav.preview'),
                  guide: [
                    {
                      id: PREVIEW_KIND,
                      order: 30,
                      title: () => t('nav.title'),
                      description: () => t('nav.guide'),
                    },
                  ],
                }),
              'visualrules: right sidebar tab type',
            )
            ctx.slots.inject('sidebar.right.pane.tab', () =>
              ctx.slots.register(
                {
                  name: 'sidebar.right.pane.tab',
                  key: PREVIEW_KIND,
                  locale: NS,
                  inject: (sessionId) => ({ vr, ctx, sessionId }),
                },
                guarded(QuickPreviewTab),
              ),
            )
            ctx.slots.inject('sidebar.right.pane.tab.title', () =>
              ctx.slots.register(
                {
                  name: 'sidebar.right.pane.tab.title',
                  key: PREVIEW_KIND,
                  locale: NS,
                },
                guarded(QuickPreviewTitle),
              ),
            )
          } else {
            ctx.logger?.info?.('visualrules: sidebarRightTabs is unavailable; using the overlay fallback')
          }
        } catch (error) {
          ctx.logger?.warn?.(`visualrules: right sidebar registration failed: ${error instanceof Error ? error.message : String(error)}`)
        }

        // Overlay fallback (also the no-session explanation on narrow hosts).
        try {
          ctx.slots.inject('shell.overlay', () =>
            ctx.slots.register(
              {
                name: 'shell.overlay',
                id: 'visualrules-quick-preview',
                order: 40,
                locale: NS,
                inject: () => ({ vr, ctx }),
              },
              guarded(QuickPreviewOverlay),
            ),
          )
        } catch {
          /* overlay seat unavailable */
        }

        // Background refresh: cheap, visible-only, and never blocks rendering.
        try {
          const timer = window.setInterval(() => {
            if (document.visibilityState !== 'visible') return
            const snapshot = vr.getSnapshot()
            const target = snapshot.profile?.cwd ? { cwd: snapshot.profile.cwd } : null
            if (!target) return
            vr.refreshProfile(target, { quiet: true })
          }, 30_000)
          const onVisible = () => {
            if (document.visibilityState !== 'visible') return
            const snapshot = vr.getSnapshot()
            if (snapshot.profile?.cwd) vr.refreshProfile({ cwd: snapshot.profile.cwd }, { quiet: true })
          }
          document.addEventListener('visibilitychange', onVisible)
          ctx.effect(() => () => {
            window.clearInterval(timer)
            document.removeEventListener('visibilitychange', onVisible)
          }, 'visualrules: background refresh timer')
        } catch {
          /* no window (tests) */
        }
      },
    }
  },
})

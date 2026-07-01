# 项目规则

## 软件命名（UE Coworker）

- 本软件正式名称为 **UE Coworker**。**CodeWeaver / code weaver 是曾用名，今后一律禁止使用**。
- 所有**显示文本、文档、代码注释、AI 自我认知（系统提示）**中涉及软件名的，必须用 UE Coworker。
- **代码标识符统一用 `ue-coworker`**：userData 配置文件名（`ue-coworker-*.json`）、localStorage 键、运行时目录、appId（`com.uecoworker.app`）、包名等。新增此类标识符时沿用该前缀，不得再用 `codeweaver`。
- 用户项目指南文件名为 `UE-COWORKER.md`。

## 文档同步（强制）

- **所有更新、修改、新增功能，必须同步更新对应文档**——不允许只改代码不改文档。
- 涉及实现原理/排障的改动，同步更新 `resources/agent-docs/` 下对应的原理文档（这些是注入给软件内 AI 的渐进披露文档，过时会误导排障）。
- 每次改动按规则登记 `CHANGES_CHECKLIST.md`。
- 改了某子系统的行为/配置/数据布局，检查 agent-docs 里相关描述是否仍准确。

## 禁止操作 git（除非用户明确要求）

- 未经用户明确指示，**禁止运行任何 git 命令**，尤其是破坏性 / 改写工作区的命令：
  `git checkout` / `git restore` / `git reset` / `git stash` / `git clean` / `git rm` / `git revert` / `git commit` / `git push` 等。
- 也禁止用 `sed -i`、删除文件、覆盖文件等方式"清理"看起来多余/可疑的代码。
- 发现任何看起来"不对、多余、像是越权添加"的内容时，**先停下来问用户**，绝不自行判断后删除或回退。工作区里未提交的内容可能是用户正在进行的真实工作，丢失无法恢复。
- 只读 git 查询（`git status` / `git log` / `git diff` 等）在确有需要时可用，但不得改动任何文件或引用。
- 任务范围之外的改动（如"只做翻译"时）：只动任务要求的内容，绝不顺手改/删其它代码。与现有代码产生冲突时，无条件丢弃自己的改动、保留用户的。

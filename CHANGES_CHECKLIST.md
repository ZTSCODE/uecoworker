                                    # 改动核对列表（Change & Risk Checklist）

                                    > 规则：每次完成代码更改后，在此登记「改动 + 风险」，状态标为 ⏳ 等待测试。
                                    > 由用户实测后改为 ✅ 通过 / ❌ 失败（失败附现象）。AI 不得自行标记为通过。
                                    > 静态可验证项（typecheck/build）AI 可自行标 ✅，并注明验证方式。

                                    图例：⏳ 等待用户测试 ｜ ✅ 已通过 ｜ ❌ 失败 ｜ 🔧 代码静态已验证

## 2026-07-01 品牌改名 CodeWeaver → UE Coworker（彻底）+ 3 附加项

> 用户：正式名 UE Coworker，CodeWeaver 是曾用名。能改的都改、确保完整无误（测试数据无需兼容）。

### 品牌/标识符全量替换（src/ 下 codeweaver 归零，仅 CLAUDE.md 规则里特意提及旧名保留）
- **代码标识符**：`codeweaver-*.json`→`ue-coworker-*.json`（9 配置文件名）、localStorage 键（~13）、appId `com.codeweaver.app`→`com.uecoworker.app`（[index.ts](src/main/index.ts) + [package.json](package.json)）、包名 `codeweaver`→`ue-coworker`、`CodeweaverAPI`→`UeCoworkerAPI`（[preload/index.d.ts](src/preload/index.d.ts)）、Vite 插件名、config type `codeweaver-config`→`ue-coworker-config`、运行时目录 `codeweaver-images/-screenshots`、MQTT clientId、MCP 握手名、UA、影子 git 身份（`checkpoints@ue-coworker.local`）。
- **显示文本/品牌**：Tray tooltip、终端主题名（UE Coworker Dark/Light）、各 UI 文案（ConfigTransfer/Discord/Telegram/Analytics/ChatView）、relay 回发文案（discord/telegram adapter + relay-tools + discord-bot-manager）、会话导出标题、package description/author。
- **AI 自我认知**：[agent-loop.ts](src/main/agent-loop.ts) buildSystemPrompt `## About this app (UE Coworker)` + "You run inside UE Coworker..."；`ue-coworker-mcp.json` 同步。
- **文档**：7 篇 [agent-docs](resources/agent-docs/) 标题 + 正文文件名/路径（`%APPDATA%\ue-coworker` 等）同步真实文件名；Docs/。
- **代码注释**：~15 处品牌自称。
- **用户项目指南文件名**：`CODEWEAVER.md`→`UE-COWORKER.md`（slash-commands + telegram-adapter）。

### 3 附加项
- **A. 项目 [CLAUDE.md](CLAUDE.md)** 加两节核心规则：①软件命名（UE Coworker，禁用旧名，标识符用 ue-coworker）②文档同步（所有改动必须同步更新 agent-docs/CHANGES_CHECKLIST）。
- **B. 系统提示** [agent-loop.ts](src/main/agent-loop.ts) `## Grounding` 加 bullet：不依赖记忆，语境变化/下结论/行动前用工具获取最新状态、验证记忆是否仍成立。字节恒定不破缓存。
- **C. 新对话 4 预设选项** [ChatView.tsx](src/renderer/src/components/chat/ChatView.tsx)：通用编程示例 → 贴近项目（做 UE 插件 / 解释本项目结构 / 配置 MCP / 软件 prompt 缓存原理）。

**风险**：userData 文件名/localStorage 键全变 → 旧测试配置会"消失"（预期，重配即可）。
**🔧 验证**：全项目 codeweaver grep 归零（仅 CLAUDE.md 规则文本特意保留）；node+web typecheck 0 错误（证明标识符无漏引用）；electron-vite build 通过。
**待实测**：① 软件启动正常 ② Tray/终端主题/各 UI 显示 UE Coworker ③ 问 AI「你是谁/这软件叫什么」答 UE Coworker ④ 4 预设选项已更新 ⑤ 配置/会话能正常新建读写（旧配置消失属预期）。

---

## 2026-07-01 界面统一：AI 消息复制选区 + 打开目录按钮归位

1. **AI 消息右键「复制」复制选区而非全文** [ChatView.tsx](src/renderer/src/components/chat/ChatView.tsx)：原 `buildMsgMenu` 无条件 `copyText(message.content)`（整条全文）。改为 onContextMenu 时快照 `window.getSelection().toString().trim()` 传入 `buildMsgMenu(sel)`——有选区→「复制选中」复制真实选区，无选区→「复制」全文；文字消息有选区时全文项改名「复制全文」。两个气泡组件（AgentMessageBase 文字气泡 + 工具气泡）四处 onContextMenu 绑定全改。右键不清选区（ContextMenu.tsx 经核实只 setState 不动 selection），故快照可靠。🔧 typecheck 过。状态 ⏳。

2. **页面级「打开目录」按钮统一**（方案：统一位置=PageHeader actions 槽 + 统一组件 GhostButton + 图标 FolderOpen size=12，**文案保留各自语义**）：
   - [MemorySettings.tsx](src/renderer/src/components/config/MemorySettings.tsx)：原是工具栏行里的原生 button（`border border-border` 旧方框风、文案「目录」），移进 PageHeader actions、改 GhostButton、文案「记忆目录」。
   - [ConfigPanel.tsx](src/renderer/src/components/config/ConfigPanel.tsx) Skills 区 & Agents 区：原在标题下独立 div，移进各自 PageHeader actions（与「重新扫描」并排），文案「打开项目 skills/agents 目录」保留。
   - [McpMarketplace.tsx](src/renderer/src/components/config/McpMarketplace.tsx)：已在 actions，仅 FolderOpen size 13→12 统一。
   - 基准 ContextManager（CLAUDE.md）未动（已是标准）。传输日志区（区块级内联）、SkillRow/AgentRow 行内图标按钮（列表项级，两者已一致）不属页面级，保留。🔧 typecheck 过。状态 ⏳。

**缓存前缀影响**：无（纯渲染层 UI）。
**待实测**：① 选中 AI 消息部分文字右键→「复制选中」只复制选区；不选→「复制全文」②各配置二级页（CLAUDE.md/MCP/Skills/Agents/Memory）打开目录按钮都在右上角、样式一致、文案各自清晰。

---

## 2026-07-01 给 LLM 的详细原理/排障文档（渐进披露）

> 用户澄清：要给软件内 AI 看的**详细**原理/排障文档（含 token 组装、缓存策略、各功能实现原理），方便 agent 帮用户排查软件本身故障；只写软件特有、AI 不知道的，不写通用知识。之前只塞了概览，远不够。

仿 skills 三层渐进披露：第一层「文档索引」进系统提示，详细内容 6 篇 md 放打包资源，按需 read_file。

1. 新建 [resources/agent-docs/](resources/agent-docs/) 6 篇（基于 3 个探索 agent 挖出的真实代码实现）：data-layout / agent-loop（token 组装 + prompt 缓存策略）/ providers（三协议）/ mcp / skills-agents-memory / permissions-checkpoints / relay-remote-control。
2. [agent-loop.ts](src/main/agent-loop.ts) buildSystemPrompt：原「自我说明概览」改为**文档索引**——每篇主题+一句话+绝对路径（`app.isPackaged ? resourcesPath/agent-docs : resources/agent-docs`），指引先 read_file 再答。索引字节恒定不破缓存。
3. [package.json](package.json) extraResources 打包 `resources/agent-docs → agent-docs`。

🔧 node typecheck 0 错误。待实测：问软件内 AI「prompt 缓存怎么做/MCP 连不上/权限为何一直弹」看是否 read_file 对应文档并答到点。

---

## 2026-07-01 第二批大功能（GitHub 登录 / 自我文档 / 内置 node）

### GitHub 一键登录（OAuth Device Flow）
1. 新建 [github-auth.ts](src/main/github-auth.ts)：Device Flow（client_id `Ov23liCbCebPWK6oQnSg`，公开值硬编码）。请求设备码→轮询 token→`secretsManager` 加密存 `__github_oauth_token__`。轮询骨架仿 weixin/login。token 只在用户本地，绝不外发。
2. [git-manager.ts](src/main/git-manager.ts)：① `setGithubTokenProvider` 注入取 token 回调（避免循环依赖）；② push/pull 用 `git -c http.extraheader=Authorization: Basic ...` 注入 token 鉴权（仅对 github.com 远程，不改 remote URL/不落盘）；③ `createPullRequest` 已登录时走 GitHub REST API（`api.github.com/repos/.../pulls`），**不依赖 gh CLI**；未登录回退原 gh 路径。新增 `parseGithubSlug`/`githubApi` helper。
3. [ipc-handlers.ts](src/main/ipc-handlers.ts)：`github:status/startLogin/cancelLogin/logout` + `github:loginResult` 事件回推；创建 `GitHubAuth` 实例并 `setGithubTokenProvider`。preload + d.ts 加 `githubStatus/githubStartLogin/githubCancelLogin/githubLogout/onGithubLoginResult`。
4. [GitPanel.tsx](src/renderer/src/components/git/GitPanel.tsx) PRDialog：未登录改为「用 GitHub 登录」按钮（开浏览器+显示设备码+轮询），替代原「需要 gh CLI」黄框。已登录直接进 PR 表单。状态 ⏳（需实测：登录授权全链路、push/PR 不依赖 gh）。

### 内置软件自我说明文档（渐进式披露）
5. [agent-loop.ts](src/main/agent-loop.ts) `buildSystemPrompt` 末尾加 "About this app" 小节：userData 各配置/log 目录清单、核心功能怎么用、常见问题排查指引。**字节恒定不含运行时数据 → 不破系统提示缓存前缀**。让 agent 能帮用户排查软件本身问题/教用法。状态 ⏳（实测：问 agent「配置在哪/MCP 连不上怎么办」能答到点）。

### 内置 Node.js 运行时（去掉「装软件还要装 node」）
6. 随包打 node v20.19.2 win-x64（含 npm/npx）到 `resources/node`（84MB，**.gitignore 排除不进 git**），[package.json](package.json) `extraResources` 打进 `resourcesPath/node`。
7. 新建 [node-runtime.ts](src/main/node-runtime.ts)：定位内置 node（打包 `resourcesPath/node` vs dev `resources/node`）；`resolveCommand`（node/npm/npx→内置绝对路径）；`augmentPath`（env.PATH 前置内置 node 目录）。dev 无 resources/node 时回退系统 PATH。
8. 集成点：[mcp-manager.ts](src/main/mcp-manager.ts) buildTransport（MCP stdio 服务器）、[pty-manager.ts](src/main/pty-manager.ts)（终端 + CLI provider）、[tools.ts](src/main/tools.ts) runCommandTool（run_command 工具）均注入内置 node PATH。状态 ⏳（实测：不装系统 node 也能跑 npx 型 MCP、终端能用 node/npm）。

**缓存前缀影响**：自我说明文档块字节恒定进稳定前缀，无破坏；其余均主进程/UI，不触碰 LLM 消息拼接。
**🔧 静态验证**：web + node typecheck 均 0 错误。
**体积**：安装包 +~84MB（内置 node）。
**待用户提供**：无（client_id 已接入）。

---

## 2026-07-01 打包后 Bug 第一批快修（7 项）

> 用户实测 Squirrel 包后报的一批问题。本批纯快修，不含 node 内置/自我文档/GitHub OAuth（第二批）。

1. **托盘/窗口图标打包后空白** [package.json](package.json) + [index.ts](src/main/index.ts)：根因 `resources/` 未打包、运行时 `../../resources` 指向 asar 内不存在路径。加 `extraResources`（icon.png/ico → resourcesPath）；新增 `appIconPath()`（`app.isPackaged ? resourcesPath : __dirname/../../resources`），窗口 icon 与 createTray 共用。🔧 typecheck 过；需打包后实测。状态 ⏳。
2. **文件侧边栏图标全丢** [file-icons.ts](src/renderer/src/lib/file-icons.ts)：根因 `ICONS_URL="/material-icons"` 根绝对路径在 `file://` 下解析到盘符根 404。改为 `import.meta.env.DEV ? "/material-icons" : "./material-icons"`（SVG 已复制进 out/renderer/material-icons）。🔧。状态 ⏳。
3. **禁止多开** [index.ts](src/main/index.ts)：加 `requestSingleInstanceLock()`，拿不到锁即 quit；`second-instance` 复用现有 `showMainWindow()` 把已有窗口拉前台。放在 Squirrel 分支后。🔧。状态 ⏳。
4. **终端右键菜单 + Ctrl+C 复制** [XtermInstance.tsx](src/renderer/src/components/terminal/XtermInstance.tsx)：复用 `ui/ContextMenu.tsx` 的 `useContextMenu`；右键菜单=复制/粘贴/发送选中给 Agent(`requestChatInput`)/全选。`attachCustomKeyEventHandler`：有选区 Ctrl+C 复制(拦截)、无选区放行 SIGINT；Ctrl+V 粘贴。🔧。状态 ⏳。
5. **CLAUDE.md / MCP 打开目录按钮** [ContextManager.tsx](src/renderer/src/components/config/ContextManager.tsx) + [McpMarketplace.tsx](src/renderer/src/components/config/McpMarketplace.tsx)：PageHeader actions 槽加按钮。CLAUDE.md 用 `ensureDirAndOpen` 打开当前文件父目录；MCP 新增 `mcp:configPath` IPC（[mcp-manager.ts](src/main/mcp-manager.ts) `getConfigPath()` + [ipc-handlers.ts](src/main/ipc-handlers.ts) + preload `mcpConfigPath`）→ `showInFolder`。🔧。状态 ⏳。
6. **MCP 已安装服务器编辑表单** [McpMarketplace.tsx](src/renderer/src/components/config/McpMarketplace.tsx)：`AddServerDialog` 加 `initial` 入参（编辑模式，env/headers 回填 KEY=value 文本、id 锁定、保留 enabled）；已安装行加「编辑」按钮；新增 `updateServer()`（按原 id 覆盖+断开旧连接+启用则重连）。解决一键装服务器装完无处补密钥。🔧。状态 ⏳。
7. **去掉批准卡片黄色竖线** [ChatView.tsx](src/renderer/src/components/chat/ChatView.tsx:2414)：删 `<span ... bg-yellow-500 />` 一行（黄三角图标保留为语义标识）。🔧。状态 ⏳。

**缓存前缀影响**：无（纯 UI/主进程窗口与打包配置，不触碰 LLM 消息拼接）。

**Win10 圆角**：经评估不做——原生不支持窗口圆角 API，透明方案会牺牲原生阴影+云母材质(.cw-mica)，得不偿失。

**🔧 静态验证**：web + node 两个 typecheck 均 0 错误通过。
**待打包后实测**：① 托盘图标显示 ② 文件侧边栏图标显示 ③ 不能多开(第二次启动只激活已有窗口) ④ 终端右键菜单/复制/粘贴/发送给Agent/Ctrl+C智能复制 ⑤ CLAUDE.md/MCP 打开目录按钮 ⑥ MCP 已安装服务器可编辑补密钥 ⑦ 批准卡片无黄竖线。[text](vscode-webview://1di5fgfihrg8s1aqrahpou36t8rpao1k31nm11t0l64fe2r7qcic/index.html?id%3D16801199-9e2d-424d-a7b3-f3f9212bc248%26parentId%3D1%26origin%3Deef06aab-c066-4b7c-93dd-794360695fcd%26swVersion%3D5%26extensionId%3DAnthropic.claude-code%26platform%3Delectron%26vscode-resource-base-authority%3Dvscode-resource.vscode-cdn.net%26parentOrigin%3Dvscode-file%3A%2F%2Fvscode-app%26session%3D5eef1ada-e1eb-428e-99f3-e4bd80c92656)

---

## 2026-06-30 打包成 Squirrel.Windows 安装包 + 安全清理

**改动**：
1. [package.json](package.json) `build` 段：`win.target` 由 `nsis` 改为 `squirrel`；加 `npmRebuild: false`（node-pty 自带 `prebuilds/win32-x64` 预编译二进制，无需 VS 重编，否则报 "Could not find Visual Studio"）；`files` 去掉 `"!node_modules/**/*"`（该行会排除所有生产依赖，导致打包后终端/Discord 运行时崩溃；electron-builder 默认自动纳入生产依赖）；加 `asarUnpack: ["**/node_modules/node-pty/**"]`（原生模块须解包出 asar 才能在运行时加载 .node）。
2. [src/main/index.ts](src/main/index.ts) 顶部加 `handleSquirrelStartup()`：拦截 `--squirrel-install/updated/uninstall/obsolete`，调用同级 `Update.exe` 建/删快捷方式后退出（Squirrel 安装事件标准样板，仅 win 打包后生效，dev/其它平台跳过）。
3. 新建 [LICENSE](LICENSE)：标准 MIT，含免责条款（保护作者，用户拿开源软件做坏事责任在用户）；安装界面不弹协议页。
4. [.gitignore](.gitignore) 扩充：忽略 `out/`、`dist/`、`.playwright-mcp/`、散落测试截图；`git rm -r --cached out .playwright-mcp` 移除追踪（本地文件保留）。

**安全核实（不打包任何个人信息）**：
- 源码无硬编码 token/链接；编译产物 `out/` 经 grep 无真实密钥。
- 所有 provider/token/会话/记忆存 `%APPDATA%/codeweaver`（系统 userData），**不在项目内**，与安装包无关。
- 打包只含 `out/**/*` + 生产依赖；`.claude/settings.local.json`（仅 Claude Code 权限白名单，无密钥）不在 `out/` 内，不会被打包。

**风险/影响**：
- ⚠️ Squirrel 强制装到 `%LocalAppData%\codeweaver`，用户**不能选安装路径**（换取零点击体验，同 Discord/VSCode）。
- ⚠️ 缓存前缀：本次改动不涉及 LLM 消息拼接，**不影响 prompt 缓存**。
- 🔧 `electron-vite build` 通过；`npmRebuild:false` 已生效（日志 "skipped dependencies rebuild"）。

**状态**：⏳ 打包进行中 / 待用户实测——① `dist/` 是否生成 Setup.exe；② 安装后软件能否启动；③ **终端功能**（验证 node-pty 经 asarUnpack 正确加载）；④ Discord/Telegram、生图等依赖原生/生产模块的功能是否正常。

**未决**：relay/Telegram 重构的 4 处类型错（A: relay-core.ts:19 路径 `./`→`../`；B/C: 148/176/183 多余 `type:"status"`；F: ConfigPanel.tsx:277 `string|null`）——用户验证功能正常后授权再修，本次未改。git 提交亦待用户确认（工作区含用户未完成的 relay 重构）。

---

## 2026-06-30 「自己做插件」引导词去 UE 特化

**改动**：[UEPluginView.tsx](src/renderer/src/components/plugins/UEPluginView.tsx) `MAKE_PLUGIN_PROMPT` 去掉「Unreal Engine 插件」硬假设——改为先访谈宿主（UE 工程 / UE Coworker 本体 / 其它平台），按宿主决定插件形态（UE 用 .uplugin+Source/Build.cs，UE Coworker 本体按其插件规范，其它同理）。发布步骤（打 GitHub topic `ue-coworker-plugin` 上架市场）不变。

**风险/影响**：纯预填提示词文案改动，无逻辑变化；typecheck 🔧 通过。

**状态**：⏳ 等待用户实测——点「自己做插件」确认预填词不再限定 UE、可做含 UE Coworker 本体在内的任意插件。

---

## 2026-06-30 底部终端面板 收起/展开动画

**改动**：[BottomPanel.tsx](src/renderer/src/components/layout/BottomPanel.tsx) 改为**常驻挂载**，靠外层 `transition-[height] 200ms` 在 `0 ↔ height` 间过渡做开合动画；[App.tsx](src/renderer/src/App.tsx) 去掉 `{bottomPanelOpen && ...}` 条件渲染、改为始终渲染 `<BottomPanel/>`（否则卸载就没有收起动画）。
- 展开：先挂载内容(`rendered`)，下一帧 `requestAnimationFrame` 再撑高(`expanded`)——保证 0→height 真正有过渡而非瞬开。
- 收起：高度落回 0，`onTransitionEnd` 监听 height 过渡结束后才卸载内容（`rendered=false`）并回落为 0 高占位，避免后台空跑终端。
- 拖拽调高时临时关闭过渡（`dragging` 标志），保证跟手不滞后。

**风险/影响**：纯前端动画/挂载时序调整，终端会话来源与同步逻辑不变；typecheck 🔧 + build 🔧 通过。

**状态**：⏳ 等待用户实测——点 Terminal / Ctrl+\` 开合是否有平滑高度动画、收起后终端正确卸载、拖拽调高仍跟手。

---

## 2026-06-30 终端改为底部停靠面板（取代右下角浮动窗）

**改动**：
- 新增 [BottomPanel.tsx](src/renderer/src/components/layout/BottomPanel.tsx)：类似 VSCode 的底部集成终端——全宽、贴在内容区底部/状态栏之上、可拖拽顶边调高。复用主 Terminal 视图的 PTY 会话（`terminal-store`），双向同步；顶部可切换/新建/关闭会话标签，右上「在主视图打开」跳到 Terminal 标签页。收起仅隐藏不结束会话。
- [app-store.ts](src/renderer/src/stores/app-store.ts)：新增 `bottomPanelOpen`（不持久化，启动收起）/`toggleBottomPanel`/`setBottomPanelOpen` 与 `bottomPanelHeight`（持久化 localStorage，夹 160–720px）。
- [App.tsx](src/renderer/src/App.tsx)：在内容列底部条件渲染 `<BottomPanel/>`；新增快捷键 Ctrl/Cmd+\` 切换。
- [StatusBar.tsx](src/renderer/src/components/layout/StatusBar.tsx)：左下角 Terminal 按钮改为 `toggleBottomPanel`（高亮跟随开合状态）；**删除原右下角浮动 `MiniTerminal` 组件**及其 `useTerminalStore`/`XtermInstance`/`TERMINAL_THEMES` 等导入。

**风险/影响**：
- 终端会话来源不变（仍是 `terminal-store` + `ptyCreate`），与 Terminal 标签页共享、双向同步——只是换了承载容器。XtermInstance 自带 ResizeObserver，拖拽调高会自动 refit。
- 布局：BottomPanel 作为内容列的 flex 子项挤压上方视图高度（非覆盖），符合 IDE 习惯。
- typecheck 🔧 `tsc --noEmit` 无报错；`npm run build` 🔧 通过。

**状态**：⏳ 等待用户实测——点状态栏 Terminal 或按 Ctrl+\` 是否从底部弹出全宽面板；拖顶边调高、刷新后高度记忆；多会话标签切换/新建/关闭；「在主视图打开」跳转；与 Terminal 标签页是否同一会话。

---

## 2026-06-30 网络搜索清除按钮换行修复 + 侧边栏美化

**改动**：
- 网络搜索「清除」按钮竖排：[ConfigPanel.tsx](src/renderer/src/components/config/ConfigPanel.tsx) `SearchBackendRow` 行内 input 改 `flex-1 min-w-0`，保存/清除按钮加 `shrink-0` + `whitespace-nowrap`，按钮不再被挤压成竖向文字。
- 侧边栏美化：[FileExplorer.tsx](src/renderer/src/components/explorer/FileExplorer.tsx) 去标题分割线、标题字号/字距收敛；搜索框改柔和面（`bg-muted/60` + focus ring，无硬边）；文件树行与搜索结果行加 `rounded-md` hover、缩进基数 8→6 / 步长 16→14 更紧凑；操作图标按钮 hover 改 `rounded-md`。[GitPanel.tsx](src/renderer/src/components/git/GitPanel.tsx) 头部分割线降到 `border-border/50`。（Sidebar 外壳上一条已美化。）

**风险/影响**：纯 CSS/类名调整，无逻辑改动；typecheck 🔧 `tsc --noEmit` 无报错。

**状态**：⏳ 等待用户实测——网络搜索「清除」按钮横排不换行；侧边栏文件树/搜索观感。

---

## 2026-06-30 设置一致性收尾（黑色选中 / 统一 tab / 去 emoji / 折叠长文 / 侧栏 / 弹层动画）

**新增原子**：[ui/settings.tsx](src/renderer/src/components/ui/settings.tsx) 增 `Tabs`（页面级分区 tab，实心黑选中药丸）与 `Collapsible`（折叠区，收长步骤/命令）。

**改动**：
- 选中态统一：`Segmented` / `Tabs` 选中态一律实心黑（`bg-foreground text-background`），字重恒为 `font-medium`（选中/未选一致）——修复「点击切换 tab 按钮宽度跳动」（原因：仅选中加 `font-medium` 变粗撑宽）。`PrimaryButton/GhostButton` 加 `whitespace-nowrap`——修复「按钮文字被切成两排」。
- 标签页统一：[McpMarketplace.tsx](src/renderer/src/components/config/McpMarketplace.tsx)（已安装/在线市场/常用）、ConfigPanel 的 Skills（已安装/市场）与链接（Telegram/微信/Discord）全部由旧式 `border-b-2` 下划线 tab 换成统一 `Tabs` 药丸。
- 标题补图标：[McpMarketplace](src/renderer/src/components/config/McpMarketplace.tsx)、[PermissionsSettings](src/renderer/src/components/config/PermissionsSettings.tsx)、[MemorySettings](src/renderer/src/components/config/MemorySettings.tsx)、[ContextManager](src/renderer/src/components/config/ContextManager.tsx) 头部统一改 `PageHeader`（带图标 + 副标题 + Hint），与其它页一致。
- 链接页去 emoji：[TelegramSettings](src/renderer/src/components/config/TelegramSettings.tsx) / [DiscordSettings](src/renderer/src/components/config/DiscordSettings.tsx) / [WeixinSettings](src/renderer/src/components/config/WeixinSettings.tsx) 状态文案与保存反馈的 🟢🟡🔴⚫✅❌📋🎮 全部移除，状态点改用已有单色 lucide 图标（Wifi/Loader2/AlertCircle/WifiOff），配置状态用 `Check`/`Circle`；「配置步骤」「可用命令」两大段收进 `Collapsible`（默认收起）；头部说明收进 `Hint`；状态栏/输入框/登录框改柔和面。
- TabBar 主标签 `设置` → `配置`（二级菜单内 `appearance` 仍叫「设置」）。
- 导出配置补全：[config-transfer.ts](src/renderer/src/lib/config-transfer.ts) appearance 分区新增导出/导入 `lang`（界面语言，直写 `localStorage codeweaver-ui-lang`）与 `miniShortcut`（全局快捷键，best-effort 注册）；分区名改「设置（主题/字体/语言/快捷键）」。
- 侧边栏 [Sidebar.tsx](src/renderer/src/components/layout/Sidebar.tsx)：折叠态图标按钮选中改卡片药丸（`bg-card + ring + 品牌色图标`），边框统一降到 `border-border/50`，hover 更柔。
- 会话列表弹层动画提速：[globals.css](src/renderer/src/styles/globals.css) 新增 `animate-pop-in`（0.12s，位移更小，`transform-origin: top`），[ChatView.tsx](src/renderer/src/components/chat/ChatView.tsx) 历史/会话弹层由 `animate-fade-in`(0.2s) 换成它，去硬边改 `ring`。

**风险/影响**：
- 纯前端 UI 调整，**未触碰业务逻辑 / IPC / 消息拼接 / 缓存前缀**。
- 导入旧导出文件仍兼容（新增字段缺失时各自跳过）。导入界面语言会改 localStorage，需下次读取（切页/重开）才完全生效——已有逻辑。
- typecheck 🔧 `tsc --noEmit` 无报错。

**状态**：⏳ 等待用户实测——切换各 tab 看选中是否黑色且按钮不再跳动/换行；链接三页无 emoji、长文已折叠；侧栏观感；点会话列表弹出是否更干脆；导出 JSON 内含 lang/miniShortcut 且换机导入能恢复语言与快捷键。

---

## 2026-06-30 插件 + 设置全页重设计（高级 / 简约 / 减弱线框感）

**新增设计语言原子**：[ui/settings.tsx](src/renderer/src/components/ui/settings.tsx)
- `PageHeader / Section / SoftCard / SettingRow / Segmented / PrimaryButton / GhostButton / Hint / INPUT_CLS / INPUT_MONO_CLS`。
- 核心思路：用「柔和面」(`bg-muted/40 + ring-1 ring-border/40`，圆角 `rounded-xl`) 取代到处的 `border border-border bg-card` 方框；大段说明文字折叠进 `<Hint>`（问号气泡，portal 弹出），默认不铺满版面；统一更舒展的间距与分段控件。

**改动页面**：
- 插件页 [UEPluginView.tsx](src/renderer/src/components/plugins/UEPluginView.tsx)：市场 / 我的插件 全部改柔和卡片、统一空态/加载态、说明收进 Hint，内容居中限宽 `max-w-3xl`。次级栏标签「插件市场」→「市场」。
- API 供应商 [ProviderSettings.tsx](src/renderer/src/components/config/ProviderSettings.tsx)：整列改柔和面 + 分段控件（协议 / Vision / 出图后缀），协议/Vision/出图大段说明收进 Hint，输入框统一样式。
- 设置主页 + 二级页 [ConfigPanel.tsx](src/renderer/src/components/config/ConfigPanel.tsx)：内容区限宽居中；外观/通知/日志/字体/快捷键卡片改 `SettingCard` + Hint；网络搜索、Skills、Sub-agents、Hooks、链接（Telegram/微信/Discord tab）全部去硬边、改柔和面与分段 tab，长描述收进 Hint。

**风险/影响**：
- 纯前端 UI 重构，**未触碰任何业务逻辑 / IPC / 消息拼接 / 缓存前缀**（安装、卸载、搜索、provider 测试、余额脚本、hooks 读写、skills/agents 扫描等行为全部保持原样）。
- 风险点：大量类名替换，需肉眼核对暗/亮主题下对比度与 Hint 弹层定位（portal `fixed`，靠近右边缘时左移避免溢出）。
- 删除死代码 `MakePluginButton`（唯一入口保留在次级栏）。
- typecheck 🔧 `tsc --noEmit` 无报错；`npm run build` 🔧 通过（renderer 构建成功）。

**状态**：⏳ 等待用户实测——逐页查看插件 / API 供应商 / 设置主页 / 网络搜索 / Skills / Agents / Hooks / 链接，确认观感（高级、简约、线框感减弱）、Hint 气泡可弹出且不溢出、暗亮主题对比度正常、各功能按钮照常工作。

---

## 2026-06-30 插件标签更名 + 精简「自己做插件」入口（重设计前快照）

**改动**：
- [TabBar.tsx](src/renderer/src/components/layout/TabBar.tsx)：主标签 `UE插件 / UE Plugins` → `插件 / Plugins`。
- [UEPluginView.tsx](src/renderer/src/components/plugins/UEPluginView.tsx)：删除页内重复的「自己做插件」按钮（市场头、我的插件头、两处空态各一），并移除已无引用的 `MakePluginButton` 组件与 `Wand2` 图标导入。唯一入口保留在次级栏 [SecondaryBar.tsx](src/renderer/src/components/layout/SecondaryBar.tsx) `PluginSecondary`。`startMakePluginChat` 仍导出供其调用。

**风险/影响**：
- 纯 UI/文案与死代码删除，不触碰安装/卸载/搜索逻辑与任何消息拼接，**不影响缓存前缀**。
- 空态文案从「自己做一个」改指引到顶部按钮，无功能变化。
- typecheck 🔧 已过（`tsc --noEmit` 无报错）。

**状态**：⏳ 等待用户实测（标签显示、按钮只剩次级栏一个、空态文案）。

---

## 2026-06-30 capture_window 排查：临时调试日志（待复现后恢复）

> **背景**：Claude（anthropic 协议）100% 不调用 capture_window，DeepSeek（openai 协议）正常调用。已用传输日志证伪多个假设：工具清单每轮都含 capture_window（builtin 第 11 个）、schema 字节合法（49 工具全过 Anthropic 合规校验）、vision 判定正确（走 vision-on 分支非 no-vision）、与浏览器工具是否在场无关（tools=26 无任何 browser 工具时仍失败）。**唯一缺失证据**：看不到 Claude 的原始响应，无法区分「模型没发 tool_use」vs「发了但本地序列化/中转站吞掉」。
>
> **原因**：响应原文 `raw` 仅在 `isEmpty || thinkingMode` 时记录；失败会话关思考且模型回了文字（content 非空）→ `raw` 不记。

**改动**：[agent-loop.ts](src/main/agent-loop.ts) 约 2689：`raw` 记录条件由 `(isEmpty || thinkingMode) ? slice(8000) : undefined` 临时改为**无条件** `rawStream.slice(0, 16000)`。

**风险/影响**：
- 纯日志改动，**不触碰任何功能/序列化/缓存逻辑**，不影响请求内容与缓存前缀。
- 副作用：开启传输日志时每条响应都会落原文（体积变大）。**排查完必须恢复原条件**。
- typecheck 🔧（待验证）。

**状态**：⏳ 等待用户开传输日志 + 用 Claude 复现一次「截图 vscode窗口」，然后把新日志给 AI 分析。

---

## 2026-06-30 缓存击穿修复（图片持久化 + 工具轮锚点）

还是不行模型
> **背景**：分析传输日志 `分析_@three-lines.html-chat17`（Anthropic 协议）发现 14 次请求 **5 次 cache_read=0**、整体命中率仅 **46.8%**（应 ~90%）。逐条哈希历史消息 + usage 实测定位到两个**独立**根因，都改写了已缓存的历史前缀、按全价重算整段历史。
> **与 06-29 那条记录的区别**：那条讲的是 OpenAI/DeepSeek 协议（结论：假问题、不动 buildReplayMessages 合并）。本次是 **Anthropic 协议**的真实击穿，且**未触碰** buildReplayMessages 阶段 A 的贪婪合并（那对真·单轮多工具是必需的），而是从**源头**消除「连续相邻 tool」。两者不冲突。
> typecheck 🔧（`tsc --noEmit` 退出 0）。运行时**待用户实测**。

**根因一：工具产图进入历史后被剥离（主因）**。三类产图（generate_image / capture_window / MCP 截图）当轮带图正常，下一轮全部丢图。链路断点：图跨轮存活需落进 store 的 `toolCall.images`，唯一写入口 `setToolImages` 由 IPC 事件 `agent:generated-images` 触发，**但后端从未发送过该事件**（preload 转发、renderer 监听都在，发送方是空的）。

**根因二：连续纯工具轮被合并成单条 assistant 多 tool_use**。模型实际每轮只调 1 个工具（日志每个响应 `stop_reason:tool_use` 单个），非并行、非刻意设计。`attachAssistantMeta` 仅在本轮有 thinking/reasoning 时才合成 assistant 锚点；thinking 是 adaptive（模型自主），无思考的纯工具轮（如 navigate→screenshot）不产生锚点 → store 里两条 tool 相邻无分隔 → buildReplayMessages 贪婪合并。

**改动**：
1. **修复 #1（锚点）** [agent-loop.ts](src/main/agent-loop.ts)：
   - `attachAssistantMeta`（约 254）新增第三参 `hasTools`；guard 从「有思考才动作」放宽为「有思考/推理/**工具**才动作」——纯工具轮也合成空 assistant 锚点，使每个工具轮在历史里各自独立。三者皆无（空响应轮）仍不合成，无噪音。
   - 调用点（约 848）传 `turnHasTools = assistantMsg.tool_calls?.length > 0`。
   - [ChatView.tsx](src/renderer/src/components/chat/ChatView.tsx) `isMetaCarrier`（约 2186）：放宽为「空 content + 无 toolCall + 无 images」即视为载体跳过渲染（原仅跳过带思考的），否则无思考的锚点空泡会渲染成可见空气泡并打断工具组聚合。与阶段 C「空文本无 tool_calls 当噪音丢弃」口径一致。
2. **修复 #2（图片持久化）** [agent-loop.ts](src/main/agent-loop.ts) 主循环（约 1239-1287）：工具执行产图后，收集稳定本地路径并发 `agent:generated-images` 事件（`{sessionId, runId, id, paths}`）→ 经 `setToolImages` 写进 `toolCall.images`。路径来源：优先用工具输出的 `GENERATED_IMAGE_PATHS` 标记（generate_image/capture_window/read 图都有）；仅纯 MCP 截图（只回 base64）用 `saveImageBytes` 落原始字节到 `userData/chat-images` 换路径。
   - [tools.ts](src/main/tools.ts)：`saveImageBytes`（约 1646）改为 `export`，供 agent-loop 复用。

**缓存前缀影响（核心，按 CLAUDE.md 要求标注）**：
- 两项均**缓存友好**：只在历史**尾部追加**结构（锚点 assistant / 图片块随路径回放），**不改动已缓存的前缀**。
- 修复 #1 让新会话的纯工具轮各自独立，**不再逐轮改写**中部 assistant（消除根因二的击穿）。旧会话（修复前落库、无锚点）重载仍是合并态，但字节稳定、不报错、不影响功能（只影响历史结构，不二次击穿）。
- 修复 #2 落盘落**原始（未缩放）字节**，跨轮重建走既有「读盘→downscale」确定性变换，与首次发送 `downscale(原图)` **字节一致** → 稳定命中。**只落一次**（图首次产生那轮；重建的 tool 消息来自 req.messages 已带路径，不重复落盘换路径）。`applyTurn` 的 `prevImages` 机制保证后续全量快照不覆盖已写入的 images。

**风险与必测项（⏳ 待用户实测）**：
- ⚠️ **修复 #2 主验证**：开启传输日志（CW_TRANSPORT_LOG），让 AI 连续调带图工具（capture_window / generate_image / playwright 截图各一次）跨 ≥2 轮，用分析脚本核对：图片块变成历史后**仍保留**（不再 image→消失），对应轮 `cache_read>0`。
- ⚠️ **修复 #1 主验证**：让 AI 连续做无思考的纯工具轮（如 navigate→screenshot），日志核对：每轮是**独立 assistant 消息**（不再合并成单条多 tool_use），前缀逐轮稳定命中。
- ⚠️ **UI 不回归**：纯工具轮不冒出可见空气泡；工具组聚合/折叠正常；思考正文样式显示正常。
- ⚠️ **不报 400**：Anthropic thinking+工具、DeepSeek 推理+工具、真·单轮多工具（一次返回多 tool_use 仍合并为一条 assistant）、旧会话重载，均正常。
- ⚠️ **capture_window 局限（既有，非本次引入）**：其图落系统临时目录，若跨轮前被 OS 清理则该轮退回占位（仅一次击穿）。纯 MCP 截图落 userData 持久目录，无此问题。

## 2026-06-29 — 修复磁盘持久化白名单漏字段（思考链关闭重开后丢失）；缓存穿刺经验证为假问题不修

> **背景**：用户让我「继续修缓存穿刺」（指之前把 normalizeAssistantToolStructure 限定仅 Anthropic、未对 OpenAI 生效）。我**用真实传输日志逐一验证了每个假设的真伪**，结论与最初推断相反：
>
> **① 缓存穿刺（OpenAI/DeepSeek）= 假问题,不修。** 实测 10 个 deepseek-v4-pro 会话缓存命中 **85%~98%**（健康）。个别低命中(31%)经查是上下文消息数暴涨(165→292)的自然失效,非串行塌缩。DeepSeek 用自动前缀缓存,不像 Anthropic「结构发散即整段失效」。**若贸然恢复 OpenAI 归一化反而有害**——见②。
>
> **② V4 Pro 拒绝空串 = 对本端点不成立,不改。** 网传 V4 Pro 拒绝空串 reasoning_content。但实测你的端点:几十个带工具 assistant 的 reasoning_content **缺失/空,全部 200**,从不强制。无需改空格。
>
> **③ 400 的真正触发条件**（实测铁证）：唯一的 400 来自 `阅读_@simple.html` 那次——`m6 tool_calls=2[glob,read]`（**一条 assistant 多 tool_calls**）+ reasoning_content 缺失。所有**单工具** assistant 缺 reasoning_content 全是 200。**即:多 tool_calls assistant 缺 rc 才 400,单工具不会。** 该 400 早已被「仅 Anthropic 归一化」止血修好,无复发。**恢复 OpenAI 归一化会把单工具合并成多 tool_calls,恰好制造 400** → 当前止血状态对 OpenAI 是正确的。
>
> typecheck 🔧（web 干净）；build 🔧。

**唯一改动（真问题,低优先,零风险）**：磁盘持久化白名单补思考字段
- [chat-store.ts:243-248 toRecordSession](src/renderer/src/stores/chat-store.ts#L243-L248)：message 白名单补 `thinking` + `reasoning_content`。
- **根因**：真正的会话持久化走磁盘 JSONL（`toRecordSession`→`writeChatSession`），**不是** localStorage（session-persistence.ts 在 chat-store 从未被调用）。上一轮「思考链全链路保真」只测了同进程多轮（内存保真），漏看磁盘白名单缺这两字段 → **关闭应用重开后思考链丢失**(退化为缺失)。这是上一轮的真实疏漏。
- 磁盘读写层（[chat-store-manager.ts:164](src/main/chat-store-manager.ts#L164)）已 JSON 原样透传,补白名单即跨进程保真。
- **缓存/数据影响**：纯持久化字段补全,不改发送结构,对缓存前缀无影响。

**风险与必测项（⏳ 待用户实测）**：
- ⚠️ **关闭重开后思考链保真**：DeepSeek/Anthropic 思考+工具对话后**关闭应用重开**,继续对话,确认历史思考内容仍在(UI 显示)、且(开 CW_TRANSPORT_LOG)发送的历史 assistant 带真实 thinking/reasoning_content。
- ⚠️ **不回归**：现有同进程多轮、缓存命中、不报 400 等均不受影响（仅新增持久化字段）。

## 2026-06-29 — 思考过程提为正文样式 + 撤销工具组强行合并（纯 UI）

> **起因（承接前序）**：用户要求把思考内容从「可折叠工具卡」里拿出来,作为独立正文样式文本直接显示;并指出上一条为消间距加的「载体穿透+工具强行合并为一个 ToolGroup」是过度设计——思考一旦提为正文,本就该自然把工具组分块。
> **用户确认的设计点**：思考样式=与正文同字号/缩进/Markdown,**颜色淡一点点**(text-foreground/70);**始终展开不折叠**;工具组**自然分块**(撤销合并)。
> typecheck 🔧（web 干净）；build 🔧（13s 无错）；分组逻辑脚本 🔧（「思考→工具→思考→工具→正文」序列：思考独立成项、工具按思考边界分成多组、载体跳过不渲染、不再合并）。运行时**待用户实测**。
> **缓存/数据影响**：纯 UI 渲染层。思考数据仍流式累积在 `toolCall.output`（数据层未动），buildReplayMessages 读 store 原始 messages，思考跨轮回传/缓存**完全不受影响**。

**改动**[ChatView.tsx](src/renderer/src/components/chat/ChatView.tsx)：
1. **分组 useMemo**：新增 `isThinking(m)` 判据；思考气泡(`__thinking__`)从 tool 聚合中**分离**、走 `renderSingle` 独立渲染；tool 聚合循环条件加 `&& !isThinking()`，工具组按思考/正文边界**自然分块**。**撤销**上一条的「isMetaCarrier 穿透合并」——载体仍跳过不渲染，但不再让工具组穿透它（载体/思考天然中断聚合）；`hasFollowing` 用自然边界 `i < msgs.length`。
2. **AgentMessage 新增 `__thinking__` 正文渲染分支**（在 tool 渲染分支前）：复刻正文结构（provider header + `pl-8` 缩进 + `var(--chat-font-size)` 字号 + `<Markdown>`），颜色 `text-foreground/70`（比正文 /90 淡），始终展开无折叠按钮，流式光标 `bg-foreground/40`。右键保留「复制思考」。
3. 旧 ToolBubble 的 `__thinking__` 折叠卡分支（[ChatView.tsx 约 3950](src/renderer/src/components/chat/ChatView.tsx)）保留作兜底（主路径不再走到）。
   - memo 失效正常：思考流式更新时 appendTurnDelta 新建消息对象引用 → `prev.message===next.message` 比较失效 → 重渲染。

**风险与必测项（⏳ 待用户实测）**：
- ⚠️ **思考以正文样式显示**：思考内容在工具组外、淡色(略淡于正文)、与正文同字号缩进、Markdown 渲染、始终展开。
- ⚠️ **工具组自然分块**：同一轮的「思考→工具→思考→工具」按思考边界分成多个 ToolGroup（不再强行合一），间距正常（思考不再夹在工具间）。
- ⚠️ **流式实时**：思考逐字流式显示正常、流式光标正常。
- ⚠️ **Anthropic /think 同样正文样式显示**。
- ⚠️ **历史/重载**：已落库的思考(toolCall.output)重载后仍以正文样式显示；跨轮回传数据不受影响（与 UI 独立）。

## 2026-06-29 — 修复思考链根治引入的 UI 间距问题（工具组被「数据载体」打断）

> **起因（实测发现，承接上一条根治方案）**：DeepSeek 实测思考内容已可见，但工具折叠卡之间间距过大、被拆成多个独立 ToolGroup（截图：思考过程 / glob×2、思考过程 / read_file 三张卡，卡间空出 mt-4）。
> **根因**：上一条根治方案里,纯工具轮(模型只回 reasoning+tool_call 无正文)由 `attachAssistantMeta` 合成一条空 assistant(`content:""` + reasoning_content)承载思考数据。这条 `role:"assistant"` 消息**夹在思考气泡(role:tool)和工具气泡(role:tool)之间**,打断了 [ChatView.tsx:2188](src/renderer/src/components/chat/ChatView.tsx) 的「连续 tool 聚合成一个 ToolGroup」循环 → 每轮被拆成独立组、组间 mt-4 间距。
> typecheck 🔧（web 干净）；build 🔧；分组逻辑脚本 🔧（三轮思考+工具序列聚合成单个 ToolGroup、载体被穿透）。运行时**待用户实测**。
> **缓存/数据影响**：纯 UI 渲染层改动。buildReplayMessages 读 store 原始 messages、与 UI 分组**完全独立**,思考数据回传不受影响。

**改动**[ChatView.tsx 消息分组 useMemo](src/renderer/src/components/chat/ChatView.tsx)：
- 新增 `isMetaCarrier(m)` 判据:`role==="assistant"` 且 content 空、无 tool_calls、无 images、但带 thinking/reasoning_content —— 即纯回传数据载体。
- 渲染分组时**透明处理**:① 单独遇到直接跳过不渲染;② tool 聚合循环**穿透**它(夹在工具间不打断聚合)。
- `hasFollowing` 改用 `i`(已穿透载体的真实消费位置)而非 `start+group.length`,避免误判默认折叠态。
- 安全边界:`isMetaCarrier` **必须**带 thinking/reasoning_content,普通空 assistant(如出图占位空壳)无此二字段、不被误判跳过。

**风险与必测项（⏳ 待用户实测）**：
- ⚠️ **间距恢复正常**：DeepSeek 多工具轮的折叠卡不再有异常大间距,思考气泡+工具聚合为连续组。
- ⚠️ **视觉变化告知**：同一轮用户消息触发的思考+多工具现在聚合为**一个** ToolGroup(摘要如「思考过程 ×2、glob_files ×2、read_file」),不再按子轮拆成多张卡——更合理但与之前不同。
- ⚠️ **思考过程仍可点开**：聚合后思考气泡内容仍可在组内展开查看。
- ⚠️ **Anthropic /think 同样正常**：Anthropic 思考轮的分组与间距也正常(同一套逻辑)。

## 2026-06-29 — 根治：思考链/推理内容跨轮全链路保真（消除空串折中，高风险）

> **起因**：上一条用「跨轮缺失补空串 reasoning_content」止血——是折中（跨轮模型拿到空串而非真实思考链）。用户要求从根本解决、所有折中改为完整方案。
> **根因（两个 Explore agent 全链路追踪确认，统一架构缺陷，Anthropic thinking 与 OpenAI reasoning_content 同病）**：思考原始数据(signature/reasoning_content)只活在 `streamCompletion 返回值`→内存 messages 数组，**会话 localStorage 持久化/重载后彻底消失**；而唯一落库通道 `TurnEmitter 快照(UiMsg)→applyTurn→localStorage` 的结构里**根本没有承载它们的字段**，思考只剩 `toolCall.output` 可读文本。跨轮重建(buildReplayMessages)从 store 取数时签名/reasoning 早已不存在 → Anthropic 缺签名配 tool_use 报 400 / DeepSeek 缺 reasoning_content 报 400。
> **解法**：让思考原始数据作为结构化字段挂在 assistant 消息上,搭上唯一落库通道,端到端保真(产生→落库→localStorage→重载→重建→原样回传)。展示用思考气泡(__thinking__)维持现状,与回传数据解耦。
> typecheck 🔧（node+web 均干净）；build 🔧（13s 无错）；端到端逻辑脚本 🔧（4 场景：Anthropic thinking/DeepSeek 纯工具轮/纯文本轮/redacted_thinking，签名与 reasoning_content 落库→localStorage 往返→重建**字节一致**；另含「多轮交替锚点不串轮」专项验证通过）。运行时**必须用户实测**。
> **缓存前缀影响**：思考原始数据每轮字节一致（signature 不透明串、reasoning_content 定值），跨轮原样回放**强化**前缀稳定性，与既有「图片缓存字节一致」原则一致,不击穿缓存。

**改动文件与要点**
1. [agent-loop.ts TurnEmitter](src/main/agent-loop.ts)：
   - `UiMsg` 新增 `thinking?`/`reasoning_content?` 字段。
   - 新增 `attachAssistantMeta(thinking?, reasoning_content?)`：把本轮思考原始数据挂到承载本轮的 assistant 气泡（纯工具轮合成空 assistant 承载）；主循环在每轮 `endText()` 后、`addTool` 前调用（传入 streamCompletion 返回的 assistantMsg 的字段）。
   - `endText()` 改为**无条件**更新锚点 `lastEndedTextBubble`（含置 null）——修复「纯文字轮残留旧气泡被下一无文字轮误用、思考挂错 assistant 致签名错位 400」的串轮隐患。
2. [agent-loop.ts streamCompletion OpenAI 分支](src/main/agent-loop.ts)：reasoning_content 累积时**同步 `onThinking`** → 三协议思考过程都实时显示在思考气泡（此前 DeepSeek 思考完全不可见）。
3. [agent-loop.ts buildApiMessage](src/main/agent-loop.ts)：assistant 分支透传 `thinking`/`reasoning_content`（跨轮重建历史回传必需）。
4. [agent-loop.ts cleanMessages(OpenAI 序列化)](src/main/agent-loop.ts)：剥离 Anthropic 专用 `thinking` 字段（避免 OpenAI 端点未知字段报错）；空串兜底降级为**双保险**（仅旧会话历史/确无思考的轮次，此时空即真实值，非折中）。
5. [chat-store.ts](src/renderer/src/stores/chat-store.ts)：导出 `ThinkingBlock` 类型；`ChatMessage` 新增 `thinking?`/`reasoning_content?`；`applyTurn` 映射白名单**加这两字段**（→ 随 localStorage `JSON.stringify` 持久化）。
6. [ChatView.tsx buildReplayMessages](src/renderer/src/components/chat/ChatView.tsx)：阶段 A 重建 assistant 带回 thinking/reasoning_content；**阶段 C 配对校验重组时同步带回**（关键易漏点，否则刚带回又被丢）。

**风险与必测项（⏳ 待用户实测）**：
- ⚠️ **DeepSeek v4 跨轮重载不再 400**：先 glob 再 read 串行多工具后，**关闭应用重开**（强制走 localStorage 重载 + buildReplayMessages 重建）继续对话——开 `CW_TRANSPORT_LOG=1` 确认历史 assistant 带的是**真实 reasoning_content**（非空串）、不报 400。
- ⚠️ **Anthropic /think 跨轮重载**：开 /think 多轮带工具，重载会话后继续——确认 thinking 块 signature 原样回放、不报 400、缓存前缀稳定前移。
- ⚠️ **DeepSeek 思考过程现在可见**：确认 DeepSeek 等推理模型的思考过程实时显示在「思考过程」气泡（此前不可见）。
- ⚠️ **思考不污染正文**：reasoning_content/thinking 只进思考气泡与回传，不出现在回答正文。
- ⚠️ **非推理 OpenAI 模型回归**：普通 OpenAI 兼容模型（不返回 reasoning_content）多轮工具调用仍正常、不报错。
- ⚠️ **缓存命中回归**：思考数据字节一致，`cache_read` 随历史增长前移、命中率不因思考块漂移而下降。
- 参考：[DeepSeek Thinking Mode](https://api-docs.deepseek.com/guides/thinking_mode)、[litellm #26395](https://github.com/BerriAI/litellm/issues/26395)。
- **已知边界**：步骤 6「撤销 OpenAI 不合并止血、恢复全协议归一化」本次**未做**（保持仅 Anthropic 归一化）——留作独立增量，需先验证 DeepSeek 对「一条 assistant 多 tool_calls + 单份 reasoning_content」是否接受。

## 2026-06-29 — 修复 DeepSeek 推理模型多轮工具调用 400（回归止血 + reasoning_content 补强）

> **起因（诚实定性：本次回归由上一条「归一化合并」改动引入）**：实测 `deepseek-v4-pro`（OpenAI 协议，api.deepseek.com）对话在第 3 个请求 400：`The reasoning_content in the thinking mode must be passed back to the API`。
> **对照旧日志 `hello-chat17` DeepSeek 段已证**：改动前每条 assistant 最多 1 个 tool_call，9 个请求全 200；改动后我的 `normalizeAssistantToolStructure` 把串行多工具合并成「一条 assistant 多 tool_calls」，触发 DeepSeek「带 tool_calls 必须回传 reasoning_content」的严格校验 → 400。根因是项目从不回传 reasoning_content（既有缺陷，旧代码单工具未触发），我的合并把潜伏缺陷变成必现。
> typecheck 🔧（node+web 均干净）；build 🔧（`npm run build` 无错）；兜底逻辑 🔧（三场景脚本验证：跨轮补空串/同轮留真值/纯文本不补）。运行时**必须用户实测**。
> **缓存前缀影响**：① 止血让归一化仅 Anthropic 生效，OpenAI 前缀缓存是端点自动的、不依赖合并，无负面影响；② reasoning_content 回传只加在带 tool_calls 的 assistant 尾部字段，不改 system/tools/历史文本顺序，对前缀缓存中性。

**改动（两步：先止血、后补强）**

1. **止血**[agent-loop.ts streamCompletion](src/main/agent-loop.ts)：`normalizeAssistantToolStructure` 改为**仅 Anthropic 协议**调用（`if (isAnthropic) messages = normalize(...)`）。OpenAI/Responses 不再合并串行多工具，立即消除 400 回归。
   - 代价：OpenAI 协议下 Bug 1（串行塌缩击穿）不再由首次发送侧消除；但 OpenAI 端缓存自动、影响小。

2. **补强（根治既有缺陷）**：捕获并回传 `reasoning_content`。
   - [agent-loop.ts](src/main/agent-loop.ts) OpenAI 流解析：新增 `reasoningContent` 累加 `delta.reasoning_content`（兼容 `delta.reasoning`），不经 onDelta 显示（是思考非回答）。
   - 组装 assistantMsg：**只要本轮有 tool_calls 就无条件挂 `reasoning_content`，空则用 `""`**（官方+litellm #26395 实证：没产思考的工具轮也必须带，空串被接受）。纯文本回答轮不挂。
   - `ChatMessage` 类型加 `reasoning_content?: string`。
   - [agent-loop.ts cleanMessages](src/main/agent-loop.ts) OpenAI 序列化兜底：带 tool_calls 但缺 reasoning_content 的 assistant（**跨轮重建**的历史拿不到，store 未持久化）统一补 `""`，覆盖同轮迭代+跨轮两条路径。对不校验此字段的端点无害（被忽略）。

**已知边界 / 降级**：跨轮重建用空串而非真实 reasoning_content（store 未持久化思考串），DeepSeek 接受但模型丢失跨轮真实思考链。彻底保真需把 reasoning_content 全链路落库（store+IPC+buildReplayMessages），改动大，本次未做。**不报错能用 > 报错中断**的止损取舍。

**风险与必测项（⏳ 待用户实测）**：
- ⚠️ **DeepSeek 多轮工具调用不再 400**：用 `deepseek-v4-pro` 重跑「阅读 @simple.html」这类先 glob 再 read 的串行多工具，确认连续迭代+跨轮都不再 400。
- ⚠️ **思考串不污染正文**：reasoning_content 只用于回传，不应显示在聊天正文里（onDelta 未接它）。
- ⚠️ **非推理 OpenAI 模型回归**：换一个普通 OpenAI 兼容模型（不返回 reasoning_content），确认带 tool_calls 的 assistant 补空串后仍正常（不报错、被忽略）。
- ⚠️ **Anthropic 路径不受影响**：Anthropic provider 的串行多工具合并仍生效、缓存仍友好、不报错。
- 参考：[DeepSeek Thinking Mode 文档](https://api-docs.deepseek.com/guides/thinking_mode)、[litellm #26395](https://github.com/BerriAI/litellm/issues/26395)。

## 2026-06-29 — 修复跨轮回放击穿 prompt 缓存的两个客户端 Bug（高风险，改主发送路径）

> 起因：分析传输日志 `hello-chat17-2026-06-29.jsonl` 发现，同一段历史「首次实时发送」与「跨轮重建」结构不一致，造成 4 处前缀发散、自我击穿缓存。vilao 段命中仅 36.2%（DeepSeek 段同代码 92.3%，说明命中率低的**主因是中转站**；本次只修客户端自我击穿部分，对任何端点都有益）。
> typecheck 🔧 通过（`tsc --noEmit -p tsconfig.node.json` 与 `-p tsconfig.web.json` 均干净）；build 🔧 通过（`npm run build`，13s 无错）。运行时命中率改善**必须用户实测**。
> **缓存前缀影响（关键）**：本次改动的**唯一目的就是修复缓存前缀**——让两条发送路径产出字节级一致的历史，使前缀稳定可命中。两项改动都**不改变稳定前缀的内容/顺序**，只消除「同一历史两种字节」的发散。规避要点见各项「字节一致性」说明。

**Bug 1：串行多工具被塌缩成并行（结构发散）**
- 根因：模型一轮里串行多次调用工具（先 glob、再单独 read，第二步无前导文字）。实时循环每次调用各存一条独立 assistant；但落库后无前导文字的回合不生成 assistant 气泡，跨轮重建（`buildReplayMessages` 阶段 A）会把相邻 tool 贪婪并入前一条 assistant，形成「一条 assistant 多 tool_use」的合并态。于是首次=串行多条、重建=合并单条 → 从该处击穿。
- 改法：[agent-loop.ts](src/main/agent-loop.ts) 新增纯函数 `normalizeAssistantToolStructure`，在 `streamCompletion` 序列化成请求体**之前**对 messages 归一化——把「紧跟 tool 结果之后、无实质文字、无 thinking」的 assistant 其 tool_calls 上提合并进前一条，复刻重建的合并态。使**首次发送即合并**，两路径同构。单点注入覆盖三协议+所有调用方+重试。
- **字节一致性 / 缓存**：归一化幂等（重建态再过一次不变）、纯函数不污染主循环复用的 messages 数组（浅拷贝替换）。真并行（一条多工具）原样保留。
- ⚠️ **thinking 约束**：带 thinking 块的 assistant **绝不合并**（signature 与单次响应绑定，合并会 400；且重建路径不保留 thinking，只有无 thinking 的回合两路径才同构）。本会话未开 thinking；带 thinking 会话保持串行独立。

**Bug 2：带图工具结果跨轮重建后图片丢失（结构发散）**
- 根因：实时发送时 tool 结果带 downscale 后的图（`toolMsg.images`）；图片落库在 `toolCall.images`（本地路径），但 `buildReplayMessages` 重建 tool 消息只取纯文本、丢了 images，且 main 侧 `buildApiMessage` 的 tool 分支也不处理 images。结果首次有图、重建无图，每个带图回合从该消息起击穿（日志中发生 3 次）。
- 改法（两端）：
  1. [ChatView.tsx](src/renderer/src/components/chat/ChatView.tsx) `buildReplayMessages` 主分支 + orphan 分支：重建 tool 消息时带回 `images: tc.images`（路径）。
  2. [agent-loop.ts](src/main/agent-loop.ts) `buildApiMessage` tool 分支：带 images 时读盘（`imagePathToAgentImage`）→ `downscaleImageIfNeeded` → `AgentImage[]` 挂 `m.images`；读不出/超阈值的图丢弃并在文本追加 `[N image(s) unavailable for replay]`。三协议序列化已支持 `m.images`，无需改。
- **字节一致性 / 缓存**：capture_window 落盘的 PNG 与首次交给 collectImages 的是**同一 buffer**，重建读同一文件 → 经**同一确定性 downscale** → base64 字节一致，稳定命中缓存（与本列表既往「图片缓存返回字节级一致」原则一致）。

改动文件：
1. [src/main/agent-loop.ts](src/main/agent-loop.ts)：新增 `normalizeAssistantToolStructure` 并在 `streamCompletion` 开头调用；`buildApiMessage` tool 分支补图片读盘+downscale。
2. [src/renderer/src/components/chat/ChatView.tsx](src/renderer/src/components/chat/ChatView.tsx)：`buildReplayMessages` 主分支与 orphan 分支重建 tool 消息时带回 `images`。

**风险与必测项（高，状态 ⏳ 待用户实测）**：
- ⚠️ **串行多工具回放正确性**：让模型先 glob 再 read（第二步无前导文字），跨轮再发消息；开 `CW_TRANSPORT_LOG=1` 比对新日志，确认上一轮该回合结构在两次请求间**不再发散**（首次发送即合并态），且模型跨轮记得做过的工具操作、不重复读。
- ⚠️ **带图工具回放**：触发 capture_window / 截图类 MCP，下一轮继续对话，确认重建请求里该 tool 结果**仍带 image block**，`cache_read` 覆盖到该消息之后（不再从图消息处掉回 0）。
- ⚠️ **真并行多工具不受影响**：一轮内模型同时调多个工具（如多个 task），回放结构正确、配对不乱、不报 400。
- ⚠️ **thinking 会话**（/think 开启）：串行多工具 + thinking 不被错误合并、不报 400。
- ⚠️ **协议覆盖**：Anthropic / Responses / OpenAI-chat 三种 provider 各跑一遍带图工具回放（OpenAI-chat 应剥图加文字占位、不报错）。
- 验证方式：开传输日志，跑上述场景，比对前缀 hash 是否随历史增长稳定前移、命中率上升（参照 DeepSeek 段形态）。

## 2026-06-29 — 运行时性能优化（第 8 项：agent:turn 增量传输，高风险）

> typecheck 🔧 通过（`npx tsc --noEmit` 干净）；build 验证见文末。功能**必须用户实测**。
> **改动前已备份**原始 5 文件到 `c:\tmp\codeweaver-phase8-backup\`（agent-loop / preload index+d.ts / chat-store / ChatView）。出问题可原样还原。
> **缓存前缀影响**：本项只改「主进程→渲染层」的 UI 快照传输方式，**完全不触碰发往 LLM 的 system/tools/messages**，对 prompt 缓存**零影响**。
> **设计原则（全量永远兜底，增量只叠加）**：原全量 `agent:turn` 快照逻辑保留，所有结构性变化（新气泡/加工具/工具结果/usage/done）仍发完整快照；只把「纯文字/思考逐字增长」从「每 60ms 重发整个消息数组」改为发「增量帧」（只带 `{id, append}`）。增量与全量同走 `agent:turn` 通道（IPC FIFO 保证不乱序）。

**多重兜底（任一偏差都会被全量纠正）**：
- ① 新气泡的第一帧强制走全量（接收端先建出消息），增量才追加 → 增量到达时消息一定已存在；
- ② 纯文字流式每满 1s 强制发一次全量校正，把潜在偏差上限锁在 1 秒内；
- ③ `done()` 在 `finally` 块调用（正常/中断/异常都执行），终态必发**含完整文本**的全量快照；
- ④ 接收端 `appendTurnDelta` 找不到该 id 时**忽略增量**（绝不凭增量新建消息），等下次全量补齐；
- ⑤ 发送端校验增量必须是已发文本的纯后缀（`startsWith`），否则回退全量。

改动文件：
1. [agent-loop.ts TurnEmitter](src/main/agent-loop.ts)：新增 `sendFull()`（发全量并重置增量基线 lastDeltaId/lastSentText/lastFullAt）、`flushStreaming()`（增量路径，appendText/appendThinking 改调它）、`streamTextOf()`。`flush()`/`done()` 委托 `sendFull()`。增量与全量共用同一套 `pending`/`flushTimer` 节流，发送前都 clear+reset。
2. [chat-store.ts appendTurnDelta](src/renderer/src/stores/chat-store.ts)：按 `id`+`runId` 找消息，思考气泡追加到 `toolCall.output`、其余追加到 `content`；**新建消息对象**（身份变 → 触发第 7 项 memo 刷新）；找不到 id 返回空（忽略）。
3. [ChatView.tsx onAgentTurn](src/renderer/src/components/chat/ChatView.tsx)：收到帧先判 `data.delta` → 走 `appendTurnDelta` 并刷新心跳/转圈，`return`；否则走原 `applyTurn` 全量路径（usage/done/看门狗逻辑一字未改）。
4. [preload/index.d.ts](src/preload/index.d.ts)：`onAgentTurn` 类型加可选 `delta` 字段、`messages` 改可选。preload 运行时代码（index.ts）**无需改**（透传 data）。

**风险与必测项（高）**：
- ⚠️ **逐字流式绝不能丢字/重复/串字**：长回复（尤其几千字、含多段代码块）逐字输出是否完整、顺序对、无重复字符；流式末尾最后几个字是否正常显示（不卡）。
- ⚠️ **思考流（/think）**：思考摘要逐字增长是否正常；思考→正文切换无错乱。
- ⚠️ **工具穿插**：文字→工具调用→再文字，多段交替时每段文字都完整。
- ⚠️ **中断（停止按钮）**：流式中途停止，已输出文字保留正确、不丢不重。
- ⚠️ **多会话并发**：A 会话流式时切到 B，A 的增量不串到 B（已按 sessionId+runId+id 三重定位）。
- ⚠️ **落库**：done 后刷新/重开，历史消息内容完整正确（落库只在 done 全量，增量不落库）。
- 验证方式：用一个长回复 + 多代码块 + 工具调用 + /think 的会话，逐项对照。出任何异常立即用备份还原该文件。

## 2026-06-29 — 运行时性能优化（第一批：低/中风险 7 项；第 8 项增量传输待后续）

> typecheck 🔧 通过（`npx tsc --noEmit` 干净）。功能/性能均需用户实测后改 ✅/❌。
> **缓存前缀影响（统一说明）**：本批 7 项**均不改变发往 LLM 的 system/tools/messages 拼接内容与顺序**，对 prompt 缓存前缀**零影响**。其中第 5 项图片缓存返回**字节级一致**的 base64，反而**强化**了历史消息字节稳定性（不会让历史图片字节漂移），是缓存友好的。第 2 项只影响 /context 面板的分项数字计算方式，结果与现算完全一致。

1. **flush 尾随触发**（高频流式末尾不丢帧）[agent-loop.ts TurnEmitter](src/main/agent-loop.ts)：节流被挡下时挂 60ms 兜底定时器补发最新快照；真正 flush 与 `done()` 时清掉定时器。
   - 风险：定时器与正常事件竞争——已在 `done()` 清 timer + 置 `pending=false`，杜绝 `done:true` 后再迟到 `done:false`。需验证：流式回复末尾几个字是否还会「突然出现/停顿」；中断(abort)后界面状态正常。

2. **token 计数微调**（纯性能，不改任何对外数字）[agent-loop.ts splitContextTokens](src/main/agent-loop.ts)：`JSON.stringify(tools).length` 改为按工具数组引用 WeakMap 缓存（`toolsCharLength`），避免每轮往返重序列化整个工具定义。
   - 风险：极低。结果与现算一致。需验证：/context 面板分项数字正常显示。

3. **git status 合并进程**（每次省一个子进程）[git-manager.ts status](src/main/git-manager.ts)：去掉前置 `rev-parse` 探测，直接 `git status` 并据 stderr 判断非仓库（`isRepo()` 方法保留给其它调用方）。
   - 风险：非仓库判定依赖 stderr 文案匹配 `not a git repository`。需验证：非 git 目录下源代码管理面板正常显示「非仓库」；正常仓库 status/分支/ahead-behind 无误。

4. **analytics 只读 meta 行**（不再反序列化每条消息）[chat-store-manager.ts](src/main/chat-store-manager.ts)：新增 `listSessionSummaries`（只 parse 首行 meta + 行数计 messageCount），`analytics()` 改用它替代 `listChats`。
   - 风险：messageCount 用「非空行数-1」近似（每消息一行），与原 `messages.length` 等价。需验证：分析面板的会话数/各会话 token/消息数与之前一致。

5. **图片异步读 + mtime 缓存**（消除每轮同步读盘阻塞）[agent-loop.ts imagePathToDataUrl/imagePathToAgentImage](src/main/agent-loop.ts)：`readFileSync` → `fs/promises` 异步；加「路径+mtime+size」LRU 缓存（48 条 / 96MB 双上限）；`buildApiMessage` 改为对带图 user 消息返回 Promise（多图 `Promise.all` 并发读、按原序拼装），两处调用点 `await`。
   - 风险：异步化触及 `buildApiMessage` 与 generate_image 补图两处调用链。需验证：① 带图提问图片能正常发给模型；② 多图顺序正确；③ 图片被外部修改后（mtime 变）能重新读到新内容；④ 长带图会话内存稳定。

6. **文件监听排除 node_modules 等**（防 install/构建事件风暴）[file-watcher.ts](src/main/file-watcher.ts)：recursive 监听回调里，路径任一段命中 `node_modules/.git/dist/out/.cache/.next/build/coverage/.turbo` 即丢弃事件。
   - 风险：这些目录下的文件变动不再反映到资源管理器（通常正是期望）。需验证：项目源码文件增删改仍能即时刷新文件树；`npm install`/构建时不再卡顿。

7. **Markdown/CodeBlock/工具卡片 memo**（切断流式重复高亮）[Markdown.tsx](src/renderer/src/components/chat/Markdown.tsx) + [ChatView.tsx](src/renderer/src/components/chat/ChatView.tsx)：`Markdown`(按 children)、`CodeBlock`(按 language+value)、`ToolBubble`(按 message 身份+expanded)、`ToolGroup`(逐项 message 身份比较)加 memo。比较策略与既有 `AgentMessage` memo 一致——流式中 `applyTurn` 每 chunk 重建消息对象(身份变)→ 比较 false → **照常刷新**；已定型历史消息身份稳定 → 跳过重渲染。
   - 风险：**重点验证「AI 消息流式刷新」绝不卡住** —— 逐字输出、工具调用输出填充、代码块/diff 渲染、思考气泡、展开/折叠交互全部需实测正常；长回复后半段是否变流畅。

## 2026-06-29 — UE 插件从「设置子分区」提升为顶级栏目「UE插件」+ 新增「我的插件」+「自己做插件」AI 引导

> typecheck 🔧 通过（`npm run typecheck` / tsc --noEmit 干净）。功能需用户实测。
> **缓存前缀影响**：本批纯 UI/导航 + 本地文件扫描（IPC），**不触碰** LLM 请求的 system/tools/messages 拼接，对 prompt 缓存前缀**零影响**。「自己做插件」仅向输入框预填草稿文本，由用户自行发送，不改历史拼接逻辑。

1. **顶级栏目「UE插件」**（分析↔设置之间）[TabBar.tsx](src/renderer/src/components/layout/TabBar.tsx) + [App.tsx](src/renderer/src/App.tsx) + [app-store.ts](src/renderer/src/stores/app-store.ts)：`ActiveView` 加 `"ueplugin"`；TabBar 在 analytics 后、config 前插入一项；App.tsx 渲染区加 `{activeView === "ueplugin" && <UEPluginView />}`。
   - 风险：`ActiveView` 是联合类型，新增取值后所有 switch/比较点需覆盖——已 typecheck 干净。原 Ctrl+5 仍指 config（未给新栏目配快捷键）。

2. **新视图组件** [UEPluginView.tsx](src/renderer/src/components/plugins/UEPluginView.tsx)：两分区——`market`（原市场逻辑整体迁入，含搜索/安装/刷新/打开 Plugins 目录）+ `installed`（我的插件：列出/打开目录/卸载）。分区由全局 `pluginSection` 状态驱动，[SecondaryBar.tsx](src/renderer/src/components/layout/SecondaryBar.tsx) 加 `PluginSecondary` 横排切换 + 右侧「自己做插件」按钮。
   - 风险：市场逻辑是从 ConfigPanel 的 `PluginsSettings` **整体搬运**（非重写），行为应与原一致；需验证搜索/安装在新位置仍工作。

3. **「自己做插件」AI 引导** [UEPluginView.tsx startMakePluginChat](src/renderer/src/components/plugins/UEPluginView.tsx)：点击 → `createSession` 新开会话 + `setInputDraft` 预填引导 prompt（访谈需求→建插件到 Plugins/→引导 git 上传打 topic 上架）+ `setActiveView("chat")` 跳聊天。顶部按钮、空态按钮、次级栏按钮共用此入口。
   - 风险：依赖 provider-store 的 `selectedProviderId`；未选 provider 时仍建会话（provider 名落 "Agent"），用户在聊天里可再选。预填只填草稿不自动发送（需用户确认后回车）。

4. **后端：我的插件扫描 + 卸载** [plugins-market.ts](src/main/plugins-market.ts)：新增 `listInstalled(projectPath)`（扫 `Plugins/` 下含 `.uplugin` 的目录，解析 FriendlyName/Description/VersionName）与 `uninstall(name, projectPath)`（删目录，**安全栅：目录必须含 .uplugin 才删 + 拒绝路径穿越**）。IPC `pluginsMarket:listInstalled` / `pluginsMarket:uninstall`（[ipc-handlers.ts](src/main/ipc-handlers.ts)），preload 暴露 [index.ts](src/preload/index.ts)。
   - 风险：卸载是删整个插件目录——已加双重防护（名字含 `..`/分隔符拒绝；目录无 `.uplugin` 拒绝）。需验证卸载只删目标、不误伤。

5. **移除 config 子分区** [ConfigPanel.tsx](src/renderer/src/components/config/ConfigPanel.tsx)：`configSections` 删 `plugins` 项、删 render 分支、删整个 `PluginsSettings` 函数及不再用的 `Package`/`Clock` import。
   - 风险：原深链 `configTab="plugins"`（若有调用方）现会落空——已全局搜索确认无残留调用方。


## 2026-06-29 — `/think` 收尾：面板内显示开关态、去掉首条系统消息、日志按会话分文件、思考诊断

> typecheck 🔧 通过（tsc web+node 均干净）+ electron-vite build 🔧 通过（exit 0）。均需用户实测确认。
> **缓存前缀影响**：本批改动全部在「请求构建之外」（UI 文案、日志文件名、命令是否塞消息），**不触碰** Anthropic `system`/`tools`/`messages` 拼接，对 prompt 缓存前缀**零影响**。（思考开关本身对缓存的影响见 06-28 条目：仅切换轮一次性失效 messages 缓存，system+tools 前缀全程存活。）

1. **斜杠面板显示开关态** [ChatView.tsx updateInput](src/renderer/src/components/chat/ChatView.tsx)：`/think` 命令描述实时附加「(当前: 已开启/关闭)」，由 `activeSession.thinkingMode` 驱动，加进 useCallback 依赖。用户在面板里直接看到开/关再决定是否切换，不另加横幅/UI。
   - 风险：依赖 `activeSession?.thinkingMode` 原始布尔值（非对象引用），避免每 render 重建 updateInput。切会话/切开关后描述应即时刷新。

2. **去掉切换后的对话流提示** [slash-commands.ts /think](src/renderer/src/lib/slash-commands.ts)：移除 `ctx.notify("已开启/关闭扩展思考")`，切换不再往对话流塞 `role:"assistant"` 提示。只在端点不支持时提示一次。
   - 风险（已解决）：旧版 notify 会让空会话首条消息变成「已开启扩展思考」，导致标题卡在 "New Chat"。现 notify 去掉 + `isFirstMessage` 只数 user 消息（既有防护），双保险。

3. **传输日志按会话分文件** [transport-logger.ts logFile](src/main/transport-logger.ts)：文件名由 `<标题>-<日期>` 改为 `<标题>-<sessionId前6位>-<日期>`。
   - 根因：多个新会话默认标题都叫「New Chat」，只用标题会让不同会话日志混进同一文件（表现为「同名会话覆盖」，实为 appendFileSync 追加到同一文件）。带 sessionId 片段后一会话一文件。

4. **思考诊断（临时排查用）** [agent-loop.ts streamCompletion](src/main/agent-loop.ts)：thinkingMode 开启时，统计实际收到的思考 SSE 事件数（content_block_start thinking/redacted + thinking_delta），写进响应日志 `note: "thinking diag: events=N blocks=M"`；若**零思考事件**，把原始流头（前 8KB）记进日志 `raw`，用于定位「请求带了 thinking 但中转站不回思考块」vs「本地解析漏了」。
   - 背景：用户实测 `occ/claude-opus-4-8`（occ/ 前缀=中转站）看不到思考。已确认请求侧正确发出 `thinking:{type:"adaptive",display:"summarized"}`，疑似中转站不回思考块（参考既往中转站降级问题）。需用户用**新构建**复现一次，把日志发来核对 events 计数与原始流。
   - 注：此为临时诊断，定位后可移除。

## 2026-06-28 — 新增 `/think` 扩展思考斜杠命令（仅 Anthropic 端点，复用工具折叠卡片展示思考摘要）

> typecheck 🔧 通过（tsc --noEmit web+node 均干净）+ electron-vite build 🔧 通过（exit 0）。仅 Anthropic 原生协议生效，其它端点忽略。复用现有工具折叠卡片渲染，不新建 UI 组件。

**功能**：对标 `/effort`，新增每会话持久的「扩展思考」开关。开启后在 Anthropic `/v1/messages` 请求体注入 `thinking` 参数（按模型版本分流），模型回传思考摘要，在对话流里以**可折叠卡片**（脑图标 + 「思考过程」标题，默认展开、下一条消息产生时自动折叠）展示——复用工具组的折叠机制。`/effort`（OpenAI）与 `/think`（Anthropic）按端点互斥显示。

1. **后端请求注入** [agent-loop.ts](src/main/agent-loop.ts)：
   - 新增 `anthropicThinkingConfig(model, maxTokens)`：**按模型名分流**——adaptive 系（opus 4.6/4.7/4.8、sonnet 4.6、fable/mythos）发 `{type:"adaptive", display:"summarized"}`；budget 系（3.7、4.0/4.1、opus 4.5、haiku 4.5、sonnet 4.5）发 `{type:"enabled", budget_tokens:N}`（N=max/2 夹在 [1024,32000]）；未知模型默认 adaptive（项目默认用最新模型）。**发错形态会被 API 400**。
   - `streamCompletion` / `streamCompletionWithRetry` 新增 `thinkingMode` + `onThinking` 两个可选尾参；isAnthropic 分支 `thinkingMode` 时注入 `reqBody.thinking`。
   - `AgentRequest` 加 `thinkingMode?: boolean`；主循环把 `req.thinkingMode` 与思考增量回调透传。
2. **后端思考块捕获/回放** [agent-loop.ts](src/main/agent-loop.ts)：
   - SSE 解析扩展：`content_block_start`(thinking/redacted_thinking)、`thinking_delta`、`signature_delta` 按 block index 累计成 `ThinkingBlock[]`，挂到返回的 assistantMsg。
   - `ChatMessage` 加 `thinking?: ThinkingBlock[]`；`toAnthropicRequest` 的 assistant 分支把思考块**逐字原样**前置到 `[text, tool_use]` 之前（signature 不透明、绝不改字节）。**这是硬性要求**：带 tool_use 的 assistant 缺思考块会 400。
   - `TurnEmitter` 加 `appendThinking/endThinking`：思考摘要增量 → 一条 `role:"tool"` + `name:"__thinking__"` 的伪工具消息（summary 存 `toolCall.output`）。
3. **前端** [chat-store.ts](src/renderer/src/stores/chat-store.ts)、[slash-commands.ts](src/renderer/src/lib/slash-commands.ts)、[ChatView.tsx](src/renderer/src/components/chat/ChatView.tsx)、[DiscordRelay.tsx](src/renderer/src/components/discord/DiscordRelay.tsx)：
   - chat-store 加 `thinkingMode` 字段 + `setSessionThinking` + 持久化/反序列化（仿 effort）。
   - `/think`（别名 `/thinking`）action 命令；`SlashContext.toggleThinking()`；命令列表按端点互斥过滤。
   - agentSend payload 透传 `thinkingMode`；Discord relay 同步带上。
   - `ToolBubble` 加 `__thinking__` 专属早返回分支（Brain 图标 + Markdown 渲染摘要）；`summarizeToolGroup` 折叠态友好名「思考过程」。

**缓存前缀影响（按全局规则标注）**：
- **不破坏稳定前缀**：核对官方缓存失效层级——`thinking` 开/关只失效 **messages** 缓存，**tools 缓存✅存活、system 缓存✅存活**。最大的稳定前缀（工具定义+系统提示）全程不受思考开关影响。
- **仅切换轮一次性重算**：用户 `/think` 切换的那一轮失效一次 messages 缓存（历史按全价重算一次=一次 cache write），之后思考稳定开启、messages 缓存照常重建命中。设成**每会话持久标志**（非每轮翻转），不会反复击穿。
- **思考块回放缓存友好**：思考块逐字原样回放、字节级一致（signature 不改），不移动缓存断点。Opus 4.5+/Sonnet 4.6+ 默认跨轮保留思考块并走缓存读取（~0.1x）。
- **思考参数不进 system**：thinking 是请求参数、绝不进系统提示，不污染稳定前缀。

**风险与待测重点**：
- THINK1：Anthropic 端点输入 `/` 能看到 `/think`（看不到 `/effort`）；非 Anthropic 端点反之。⏳
- THINK2：`/think` 开启后发消息，对话流出现「思考过程」可折叠卡片（脑图标），展开能看到思考摘要 Markdown；下一条 AI 文字消息出现时该卡片自动折叠。⏳
- THINK3：**带工具调用的回合**思考正常工作、不报 400（思考块随 tool_use 回放的硬性要求）——用会连续调多个工具的任务验证。⏳
- THINK4：再次 `/think` 关闭后，思考卡片不再出现，回复正常。⏳
- THINK5：不同模型分流正确——adaptive 模型（如 opus-4-8）与 budget 模型（如 sonnet-4-5/haiku-4-5，若中转支持）都不报「budget_tokens/adaptive 不被支持」类 400。⏳
- THINK6：切换思考开关那一轮缓存按预期（仅 messages 失效一次，system/tools 命中率不掉）；持续开启时后续轮 messages 缓存正常命中。⏳
- THINK7：思考卡片落盘后重开会话仍可见、可展开；历史会话回放不因思考伪工具消息报协议错（无 id 应被 buildReplayMessages 跳过）。⏳
- 注：display 用 `summarized`（可读摘要，非原始思考——原始思考 Anthropic 永不返回）。中转站若不支持 thinking 参数可能报错，属端点问题非代码问题（参考 relay-tool-call-degradation）。

## 2026-06-28 — 新增 UE 插件市场（去中心化 GitHub topic，一键装到当前工程 Plugins/）

> typecheck 🔧 通过（tsc --noEmit 干净）。新功能，纯新增、不改既有逻辑；零新增依赖（用 Node 内置 zlib + 手写最小 tar 解析）。

1. **后端市场** [plugins-market.ts](src/main/plugins-market.ts)（新建）：
   - 发现：GitHub Search Repositories API，`q=topic:ue-coworker-plugin`，按 stars 排序，整体缓存 10 分钟，搜索/分页在本地做（仿 [skills-market.ts](src/main/skills-market.ts)）。
   - 下载/安装：用 GitHub 官方 tarball（`codeload .../tar.gz`），`zlib.gunzipSync` 解 gzip + 手写 `parseTar` 按字节读 blob（支持 GNU 长名）。**关键**：按字节处理，正确支持 `.uasset`/`.png` 等二进制——绝不能像 skills 那样按 UTF-8 文本下载（会损坏二进制）。
   - 安装定位：仓库内层级最浅的 `*.uplugin` 所在目录即插件根，其文件名（去扩展名）= 安装目录名；原子安装（临时目录下载完整 + 校验 .uplugin 落地后 rename 到 `<projectPath>/Plugins/<名>/`）。
2. **IPC** [ipc-handlers.ts](src/main/ipc-handlers.ts)：注册 `pluginsMarket:search` / `pluginsMarket:install`。
3. **preload** [preload/index.ts](src/preload/index.ts)：暴露 `pluginsMarketSearch` / `pluginsMarketInstall`。
4. **UI** [ConfigPanel.tsx](src/renderer/src/components/config/ConfigPanel.tsx)：`configSections` 加「插件市场」分区（id=`plugins`，Package 图标）+ 新增 `PluginsSettings` 组件（仿 SkillMarket：搜索框、卡片网格、安装态、未开工程时禁用并提示）。

**风险与待测重点**：
- PM1：插件市场分区能正常打开，首次自动加载出打了 topic 的仓库（联网，匿名 Search API 限流 10 次/分）。⏳
- PM2：搜索关键词能本地过滤；点「安装」后插件正确落到 `<当前工程>/Plugins/<插件名>/`，含 `.uplugin` 与二进制资源（用真实含 .uasset 的插件验证未损坏）。⏳
- PM3：未打开工程时安装按钮禁用并给出黄条提示；重复安装同名插件被拒。⏳
- PM4：安装中途失败/断网时不留半成品（临时目录被清理，正式目录要么完整要么不存在）。⏳
- PM5：`ensureDirAndOpen` 打开工程 Plugins 目录正常。⏳
- 注：当前 `FALLBACK_REPOS` 为空（刚发布、暂无精选兜底）；约定 topic = `ue-coworker-plugin`（小写连字符，界面展示 "UE Coworker Plugin"）。

## 2026-06-28 — 缓存命中率口径修正（>100% bug）+ 移除截图淘汰（防缓存击穿）

> typecheck 🔧 通过（tsc --noEmit 干净）。两项均与 prompt 缓存相关，按全局规则标注缓存前缀影响如下。

1. **缓存命中率 >100% 修正** [agent-loop.ts](src/main/agent-loop.ts)、[ChatView.tsx](src/renderer/src/components/chat/ChatView.tsx)、[chat-store.ts](src/renderer/src/stores/chat-store.ts)：
   - 根因：/context 面板「上一条消息」命中率 = `cacheRead / contextTokens`，分子 `turnCacheRead` 是 turn 内跨多次工具往返**累加**值，分母 `contextTokens` 是最后一次往返**瞬时**值；一个 turn 内工具往返越多比值越大（基准测试 67 次往返 → 约 3800%）。
   - 修法：主进程新增 `lastTurnCacheRead`（本次往返缓存读取瞬时值，与 `contextTokens` 同口径），随 `setUsage` 新增第 8 参 `turnCacheRead` 贯通到 emitter 快照；面板「上一条」改用 `turnCacheRead/contextTokens`，旧数据无该字段时退回 `cacheRead` 并 `Math.min(1, …)` 封顶兜底。「会话平均」（`ΣcacheRead/ΣpromptTokens`）维持不变（本就自洽）。
   - **缓存前缀影响**：无。仅新增一个随快照下发的只读统计字段，不参与发往 LLM 的 messages/system/tools 拼接，不动任何前缀。

2. **移除 enforceImageCap 截图淘汰** [agent-loop.ts](src/main/agent-loop.ts)：
   - 根因：每新增一张截图就删最早的历史图片（`m.images=undefined` + 给 `m.content` 追加占位符），但被删消息位于**已缓存的前缀**内，其 API 表示从「含 base64」变为「不含」→ 击穿 prompt 缓存、整段历史按全价重算（基准测试 turn 64 实测一次击穿、cache_read 从 7.4 万跌到 6964、cache_write 飙到 8 万）。
   - 修法：删除 `IMAGE_CAP` 常量与 `enforceImageCap` 函数及其调用。图片总量改为随 `/compact` 压缩时连同旧消息一起出局（与 buildReplayMessages「阶段 B 已移除动态淘汰」的设计一致）。
   - **缓存前缀影响**：正向修复——此改动**消除**了一处会改写历史前缀的逻辑，从此历史消息一旦进入缓存前缀不再被任何代码改写，图片每轮字节级一致、稳定命中缓存。

**风险与待测重点**：
- CACHE1：/context 面板「上一条消息」缓存命中率不再超过 100%（任意工具密集回合后查看，应 ≤100%）。⏳
- CACHE2：「本会话平均」命中率仍正常显示、与改动前一致。⏳
- CACHE3：图片密集回合（如带浏览器截图的任务）连续多张图后，后续轮次缓存命中率不再出现单轮暴跌（无 turn 64 式击穿）。⏳
- CACHE4：回归——视觉模型仍能看到截图；图片仍随工具结果正常下发、不超体积阈值；`/compact` 后旧截图随旧消息一起从发送历史移除。⏳
- 注（未改动）：自动压缩阈值 `CONTEXT_AUTO_THRESHOLD=850000` 与实测 `contextTokens`（单次往返输入）口径偏高，20 万级窗口模型自动压缩难触发、依赖 context_overflow 事后兜底；本次按用户决定**暂不调整**，仅记录。

## 2026-06-28 — 链接面板文案：Telegram 加一句简介 + 微信加命令列表区块

> typecheck 🔧 通过；build 🔧 通过（built in 14.70s）。纯文案/UI 改动，不影响逻辑。

1. **Telegram 简介** [TelegramSettings.tsx](src/renderer/src/components/config/TelegramSettings.tsx)：在「通过 Telegram Bot 在手机上远程控制」之后加粗追加一句「功能支持最多，体验也最好。」。
2. **微信命令列表** [WeixinSettings.tsx](src/renderer/src/components/config/WeixinSettings.tsx)：在「使用步骤」区块后新增「🎮 可用命令」区块（样式同 Telegram），列出 `/help`、`/mode`、`/provider`、`/clear`、`/stop` 及「直接发消息/图片/文件」，并说明微信无斜杠补全/按钮、命令走「发文本 + 回数字选择」。

**风险与待测重点**：
- UI1：设置→链接→Telegram 面板顶部简介出现「功能支持最多，体验也最好。」。⏳
- UI2：设置→链接→微信 面板出现「🎮 可用命令」区块，命令与说明正确。⏳

## 2026-06-28 — 微信：介绍文案精简 + 加命令交互（文本命令 + 编号菜单 + 回数字）

> typecheck 🔧 通过；build 🔧 通过（relay-gateway.js 100.39kB）。微信官方机器人协议**无可点击按钮**（消息条目仅 TEXT/IMAGE/VOICE/FILE/VIDEO），无法做「点击列表执行」；故命令一律走「文本命令 + 编号菜单 + 回数字」（与 Telegram 数字回退同源）。

1. **介绍文案精简** [WeixinSettings.tsx](src/renderer/src/components/config/WeixinSettings.tsx)：互传说明去掉「（图片保留原画质；暂不支持语音/视频）」括注，改为「支持文本与图片/文件互传。」。
2. **命令路由** [weixin-adapter.ts](src/main/relay/weixin-adapter.ts)：`handleInbound` 文本分支在「提问答复」后、「普通提问」前插入 `handleCommandText`。支持斜杠与中文别名：`/help`(菜单/帮助/?)、`/clear`(新建会话/清空)、`/stop`(停止/中止)、`/mode`(模式)、`/provider`(供应商/模型)。未知 `/` 命令给轻提示、不当提问。新增 `HELP_TEXT` 速览。
3. **编号菜单 + 回数字** [weixin-adapter.ts](src/main/relay/weixin-adapter.ts)：新增 `pendingChoice` per channel；`emit` 的 `kind:"menu"` 分支按 value 前缀判定 provider/mode，存编号映射并发「标题 + 1.xx 2.yy + 回复编号选择」。用户回纯数字→取第 N 项 value 派发：provider 的 `provpick:`/`provsw:` 原样作 switch 的 arg、`provpage:`→`list page:`、`provback`→重列；mode 的 `modeset:<m>`→`mode mode=<m>`。两段式（选供应商→弹模型菜单→再回数字）天然支持。
4. **通用派发** [weixin-adapter.ts](src/main/relay/weixin-adapter.ts)：`emitCommand`(ask 专用) 改为转调新的通用 `dispatchCommand`（可发 provider/mode/session 等任意 RelayCommand payload）。

**风险与待测重点**：
- WX1：手机发 `/help` 或「菜单」→ 回命令速览。⏳
- WX2：`/mode`（或「模式」）→ 列出 4 个权限模式编号 → 回数字 → 桌面权限模式跟随切换。⏳
- WX3：`/provider`（或「模型」）→ 列供应商编号 → 回数字选供应商 → 列该供应商模型编号 → 回数字 → 桌面顶栏模型跟随切换；供应商多页时回翻页项编号。⏳
- WX4：`/clear`（新建会话）、`/stop`（中止当前请求）生效。⏳
- WX5：回归——普通提问（不带 `/`、非纯数字）仍正常当 ask 提问；菜单后回非数字文本不被吞（应回提示或当提问）。⏳

### 追加（同日）：/help 改为编号菜单 + 诊断日志 + provider 状态说明

> typecheck 🔧 通过；build 🔧 通过。

5. **/help 改编号菜单** [weixin-adapter.ts](src/main/relay/weixin-adapter.ts)：`HELP_TEXT`（纯文本速览）改为 `HELP_TITLE` + `HELP_ITEMS`（1.切换权限模式 2.切换供应商/模型 3.新建空白会话 4.中止当前请求）。`pendingChoice` 的 kind 加 `"help"`；发 `/help` 时存 help 菜单，用户回数字 → 取对应项 value（命令名）→ 经新抽出的 `runNamedCommand` 执行（mode/provider 会再各自弹编号菜单，两层菜单天然支持）。命令词分支（mode/provider/clear/stop）也统一改调 `runNamedCommand`。
6. **诊断日志** [weixin-adapter.ts](src/main/relay/weixin-adapter.ts)：`handleInbound` 打印入站文本、`handleCommandText` 打印命中文本、`sendText` 在缺 contextToken 时告警；命令发送失败 `.catch` 由静默改为 `console.error`。用于排查「命令没回」类问题。
7. **provider「当前」标记说明**：`/provider` 菜单的 `▶=当前` 来自 `bridge.providerOp` 的 label（与桌面共享同一份 provider 状态）。用户曾遇到「桌面 Claude 在回但 `/provider` 标记 DeepSeek」——切换后即同步，判定为切换前的残留不同步状态，非 bug。

**追加待测**：
- WX6：手机发 `/help` → 回「编号命令菜单」→ 回数字 `1` 进入权限模式菜单、`2` 进入供应商菜单、`3` 新建会话、`4` 中止。⏳

## 2026-06-27 — 小窗：隐藏水平滚动条 + 输入框上限放宽到 200px

> typecheck 🔧 通过（ChatView 零报错）。

1. **隐藏水平滚动条** [ChatView.tsx](src/renderer/src/components/chat/ChatView.tsx)：消息滚动容器加 `overflow-x-hidden`（原 `overflow-y-auto` 在内容超宽时浏览器会冒出横向滚动条）。大窗同样适用、无害。
2. **输入框字多时增高（小窗放宽上限）** [ChatView.tsx](src/renderer/src/components/chat/ChatView.tsx)：textarea 自增上限大窗 96px、**小窗放宽到 200px**（autoGrow 的 cap 与 inline style maxHeight 都按 miniMode 区分）。增高机制同大窗——composer 向上长、消息区 flex 让出空间、inputAreaHeight 经 ResizeObserver 跟随，窗口高度不变。

**风险点**：
- EE1 overflow-x-hidden：是否会裁掉本该横向滚动的内容（如宽表格/代码块——它们自身有 overflow-x:auto 容器，不受外层影响，应安全）。
- EE2 输入 200px：小窗很矮时 200px 输入框是否挤压消息区过多（极端下消息区可能很小，但符合"输入优先"预期）。

**待测**：
- ⏳ 小窗不再出现水平滚动条。
- ⏳ 小窗输入框字多时实时增高（最高 200px，超出后内部滚动），与大窗体验一致。

## 2026-06-27 — 小窗拖动判定放宽（与双击统一为元素判定）

> typecheck 🔧 通过（ChatView 零报错）。

1. **拖动判定改元素判定** [ChatView.tsx](src/renderer/src/components/chat/ChatView.tsx)：原拖动仅当 mousedown 落在 `data-mini-dragzone` 元素自身才触发（太苛刻，消息间隙等空白拖不动）。抽出共用模块函数 `isMiniBlankTarget`（dragzone 自身 / elementFromPoint 落点非交互非文字即空白），拖动、双击切换、空白右键三处统一改用它——按住任何非内容处即可拖动窗口。

**风险点**：
- DD1 拖动 vs 选词：在文字上按下拖动应不触发拖窗（isMiniBlankTarget 判文字返回 false），需实测能否正常选中文本。
- DD2 elementFromPoint 命中：各类消息（Markdown 段/列表/图片/代码）间隙空白是否都判为可拖。

**待测**：
- ⏳ 小窗消息间隙、空白区按住即可拖动窗口（不再苛刻）。
- ⏳ 按住消息文字仍可选中、不误拖窗。
- ⏳ 双击/右键空白判定与拖动一致（同样宽松）。

## 2026-06-27 — 小窗模式修跳动（尊重手动调整尺寸 / hover 提问卡片不再弹回默认）

> typecheck 🔧 通过（ChatView/index.ts 零报错）。

1. **修「手动调整小窗大小后突然跳回默认」** [ChatView.tsx](src/renderer/src/components/chat/ChatView.tsx)：根因有二——① 收缩动画 effect 依赖 `inputAreaHeight`，hover 提问卡片/输入框高度变化时 effect 重跑，把展开态窗口强行设回硬编码 360；② 展开目标硬编码 MINI_H_RENDER。修：effect **去掉 inputAreaHeight 依赖**（只依赖 miniMode/miniBubblesHidden）；新增 `expandedHeightRef`，收拢前记录当前 `window.innerHeight`（含用户手动调整）作为展开目标，不再硬编码。
2. **主进程拖动/收缩不再吸回默认宽高** [index.ts](src/main/index.ts)：`window:setPosition`（拖动）原硬编码 `width:MINI_W,height:MINI_H`（为修透明窗 DPI 放大 bug 而加，现已是不透明窗、bug 不存在）→ 改用当前 `b.width/b.height`，拖动不再重置用户调整过的尺寸、也不会把收拢态高度顶回 360。`window:setMiniHeight`/`resetMiniHeight` 的 `width:MINI_W` → `b.width`，保留手动调整的宽度。

**风险点**：
- CC1 展开高度记录时机：收拢瞬间窗口仍是展开态，`window.innerHeight` 应为用户当前高度（含手动调整）；若用户在收拢态再调尺寸（窗口很矮，难操作）边界未覆盖，可接受。
- CC2 拖动用当前 bounds：不透明窗下反复 setBounds 是否仍稳定（透明窗 DPI 放大 bug 已不存在，应稳）。

**待测**：
- ⏳ 手动调整小窗大小后，hover 提问卡片/输入框区域，窗口**不再跳回默认大小**。
- ⏳ 手动调整后 15s 收拢→再展开，恢复到的是**手动调整后的高度**，不是 360。
- ⏳ 拖动小窗不改变其尺寸（宽高都保持）。

## 2026-06-28 — 统一侧边栏（文件 + Git）行 hover：非圆角条状、无动画

> 问题：① 亮色文件树行是「圆角矩形 + hover 右移动画」；② Git 面板各行用 `hover:bg-accent/XX`，亮色下因 accent≈sidebar-bg 几乎不可见、暗色下可见但是条状无圆角 → 三种表现不一致。统一为：**非圆角整行条状、`--sidebar-hover` 背景、仅颜色过渡无位移动画**。仅改侧边栏内（FileExplorer / GitPanel），不动其它区域。
>
> 纯样式改动，不影响 LLM 缓存前缀。

1. **文件树行** [FileExplorer.tsx](src/renderer/src/components/explorer/FileExplorer.tsx)：移除 `rounded-md`、`hover:translate-x-0.5`、`transition-all duration-150` → 改为 `hover:bg-[hsl(var(--sidebar-hover))] transition-colors`（去圆角、去右移动画）。搜索结果行此前已是该样式，保持一致。
2. **Git 面板行/分组头** [GitPanel.tsx](src/renderer/src/components/git/GitPanel.tsx)：文件变更行、浏览项目文件行、提交历史行，及「浏览项目文件 / 提交历史 / FileGroup」三处分组头的 `hover:bg-accent/{40,30,20}` 全部 → `hover:bg-[hsl(var(--sidebar-hover))]`，与文件树同色同条状。
3. 仅触碰侧边栏列表行的 hover 类名；弹窗（PR/文件历史）、按钮等其它 `hover:bg-accent` 未动。

**待测**：
- ⏳ 亮色：文件树与 Git 各行 hover 均有可见背景加深、为整行条状、无右移动画。
- ⏳ 暗色：同上，且与亮色行为一致。
- ⏳ Git 分组头（暂存/更改/浏览/历史）hover 背景与文件行一致。

## 2026-06-28 — 暗色模式去蓝调，改为中性灰

> 用户反馈暗色整体偏蓝。根因：暗色调色板各 token 用了蓝灰色相（h≈219~223、饱和度 12~16%），叠加后整体泛蓝。改为中性灰：全部表面/文字 token 的色相归零、饱和度 0%，**保留原有明度分层**（sidebar 11% < bg 14% < card 18% < popover 20% < muted/secondary 23% < accent 27% < border 33%），故层次与对比度不变，仅去除色偏。品牌强调色 `--accent-color`/`--ring`（紫 250）与 `--destructive`（红）刻意保留。
>
> 纯样式改动，不影响 LLM 缓存前缀。

1. **暗色调色板中性化** [globals.css](src/renderer/src/styles/globals.css) `.dark` 块：`--background/card/popover/primary/secondary/muted/accent/border/input/sidebar-*/tab-*` 等全部改为 `0 0% L%`（L 沿用原明度）。`--accent-color`(250 84% 66%) 与 `--destructive` 不动。
2. 已扫描 globals.css 与 components，无其它硬编码蓝灰 hsl 残留。

**待测**：
- ⏳ 暗色模式整体观感为中性灰、无蓝调。
- ⏳ 各层级（侧边栏/背景/卡片/输入框/边框）层次与对比度仍清晰、无「糊成一片」。
- ⏳ 紫色强调（active/链接/ring）与红色危险态仍正常显示。

## 2026-06-27 — 小窗模式微调5（自做高度收拢/展开动画 / 彻底不隐藏信息流）

> typecheck 🔧 通过（ChatView/App 零报错）。

1. **自己做窗口高度动画（不靠原生）** [ChatView.tsx](src/renderer/src/components/chat/ChatView.tsx)：Windows 原生 resize 无动画，故用渲染层 **requestAnimationFrame 逐帧缓动**窗口高度（easeOutCubic，260ms）实现收拢/展开动画——每帧调 `setMiniHeight(h)`，从当前高度平滑过渡到目标（收起=输入框实测高、展开=MINI_H_RENDER=360）。新增模块常量 `MINI_H_RENDER`（须与主进程 MINI_H 一致）。进小窗首帧 from≈target 不触发动画（由 enterMiniMode 直接定高）。
2. **彻底不隐藏信息流** [ChatView.tsx](src/renderer/src/components/chat/ChatView.tsx)：移除消息流的 `opacity-0`/`transition-opacity` 淡出（之前用户仍看到信息被隐藏）。现在 `miniBubblesHidden` 只驱动窗口高度动画——信息流始终渲染，收拢时只是被裁到窗口外，展开时随窗口变高自然重现。
3. **去掉进小窗淡入** [App.tsx](src/renderer/src/App.tsx)：按用户「不要淡入淡出」移除 mini 容器的 animate-fade-in。

**风险点**：
- BB1 逐帧 setMiniHeight：260ms 内 ~16 次 IPC + setBounds，Windows 上窗口逐帧 resize 是否流畅、有无卡顿/撕裂。
- BB2 动画与 idle：收拢动画途中若鼠标活动触发展开，cancelAnimationFrame 后反向缓动是否平滑（from 用 miniHeightRef 当前值，应能无缝反向）。
- BB3 收起目标高度=输入框实测，跨缩放/分辨率一致（DIP 单位，不需换算）。

**待测**：
- ⏳ 15s 收拢有**高度动画**（平滑缩到输入框），不是瞬变也不是淡出。
- ⏳ 活动/新消息展开有高度动画（平滑变高），信息流随之重现、不再被隐藏。
- ⏳ 收拢途中动鼠标能平滑反向展开。
- ⏳ 进小窗无淡入淡出。

## 2026-06-27 — 小窗模式微调4（收缩高度精确/跨DPI / 双击判定再修 / 不再隐藏流 / 过渡动画）

> typecheck 🔧 通过（ChatView/App/index.ts 零报错）。

1. **收缩高度精确 + 跨设备一致** [ChatView.tsx](src/renderer/src/components/chat/ChatView.tsx)：高度改用 `inputAreaRef.getBoundingClientRect().height`（实测、含 padding）而非滞后的 offsetHeight+16。**澄清 DPI 疑虑**：Electron setBounds/getBounds 用 DIP（设备无关像素），与 CSS px 同单位，故缩放 125%/150%/不同分辨率下 1:1 一致、无需换算——之前「比输入框高」纯粹是上一轮的 minimumSize(200) 卡死（已修），不是 DPI 问题。多行/带附件时 effect 依赖 inputAreaHeight 会重测自适应。
2. **不再隐藏信息流** [ChatView.tsx](src/renderer/src/components/chat/ChatView.tsx)：既然窗口已真收缩，信息流自然被裁到窗口外，无需再 `pointer-events-none` 卸载交互；改为仅淡出（透明度过渡），简化逻辑。
3. **双击判定再修（同高不同横向仍误判选中）** [ChatView.tsx](src/renderer/src/components/chat/ChatView.tsx)：放弃「看 selection 是否非空」（双击空白靠近文字时浏览器会误选邻词）。改为**落点元素判断**：dragzone 自身=纯空白直接切换；否则用 `elementFromPoint` 取双击点元素，若命中 button/a/input/textarea/img/svg/pre/code/table 或该元素有非空直接文本节点（=点在文字上）则不切换，否则视为空白切换并清掉误选区。
4. **过渡动画** [App.tsx](src/renderer/src/App.tsx)/[ChatView.tsx](src/renderer/src/components/chat/ChatView.tsx)：进小窗容器加 `animate-fade-in` 淡入；消息流收缩/展开加 `transition-opacity duration-300`。**说明**：Windows 原生窗口 resize 无动画（Electron animate 参数仅 macOS 有效），故窗口尺寸变化是瞬时的，动画体现在内容淡入淡出与进出小窗的淡入。

**风险点**：
- AA1 双击判定：elementFromPoint + 文本节点检测能否覆盖各类消息（Markdown 段落/代码/列表）；空白处是否都能切换。
- AA2 收缩高度：getBoundingClientRect 在收缩瞬间是否拿到稳定值（composer 内容此刻不变，应稳）。
- AA3 动画：进小窗淡入是否突兀；收缩时窗口瞬变+流淡出是否违和（Windows 平台限制，无法给窗口本身加动画）。

**待测**：
- ⏳ 15s 收缩后窗口高度=输入框（不同缩放/分辨率机器上一致，不再偏高）。
- ⏳ 聊天区任意空白处（含与文字同高、不同横向位置）双击都能切换；双击文字仍选词。
- ⏳ 进小窗有淡入；收缩/展开消息流有淡出淡入过渡。
- ⏳ 收缩后信息流不挡视图（被裁出窗口）。

## 2026-06-27 — 小窗模式微调3（收缩高度卡死修复 / 双击判定放宽 / 已在小窗也聚焦）

> typecheck 🔧 通过（ChatView/App/index.ts 零报错）。

1. **修收缩没缩到只剩输入框** [index.ts](src/main/index.ts)：根因——`enterMiniMode` 设了 `setMinimumSize(320,200)`，收缩的 setBounds 被最小高度 200 夹住，所以停在比输入框高一截。`setMiniHeight` 改为先 `setMinimumSize(320, min(200,目标))` 放宽再 setBounds；`resetMiniHeight` 恢复时设回 320×200。现在能缩到 inputAreaHeight+16(≈输入框高)。
2. **双击判定放宽（不再依赖窄 dragzone）** [ChatView.tsx](src/renderer/src/components/chat/ChatView.tsx)：之前只认 `data-mini-dragzone` 元素自身，聊天中部空白点不到。改为**基于选区**——双击后若 `window.getSelection()` 为空（点在空白）则切换大/小窗；选到文字（双击选词）则不切换。另排除 button/a/input/textarea。大窗双击空白进小窗、小窗双击空白还原，逻辑统一。
3. **已在小窗但未聚焦时快捷键也聚焦** [App.tsx](src/renderer/src/App.tsx)/[ChatView.tsx](src/renderer/src/components/chat/ChatView.tsx)：之前 toggle 仅在 `!miniMode` 时动作，已在小窗按快捷键无反应。改为 App 每次快捷键都派发 `cw:focus-mini-input` 事件（延时 90ms），ChatView 监听该事件聚焦输入框（叠加原 miniMode 变 true 的聚焦）。主进程快捷键本就 win.show+focus，故已显示但失焦的小窗也能聚焦。

**风险点**：
- Z1 收缩高度：inputAreaHeight 多行/带附件时变化，收缩高度跟随是否准确（effect 依赖 inputAreaHeight 会重算）。
- Z2 双击选区判定：双击空白瞬间是否偶发已有残留 selection 导致不切换（一般空白双击 selection 为空，应稳）。
- Z3 聚焦事件 90ms：已显示小窗按快捷键聚焦是否稳定。

**待测**：
- ⏳ 15s 闲置后窗口真的缩到只剩输入框高度（不再高一截）。
- ⏳ 聊天界面**中部**空白处双击也能切换大/小窗（不再只两侧）；双击文字仍是选词。
- ⏳ 已在小窗但点了别处失焦，按 Ctrl+Q 能重新聚焦输入框直接打字。

## 2026-06-27 — 小窗模式微调2（呼出自动聚焦 / 大窗双击进小窗 / 空白右键菜单 / 删欢迎提示）

> typecheck 🔧 通过（ChatView/WelcomeScreen 零报错）。

1. **呼出小窗自动聚焦输入框** [ChatView.tsx](src/renderer/src/components/chat/ChatView.tsx)：新增 effect——`miniMode` 变 true 后延时 80ms `inputRef.focus()`，免点击直接打字（主进程呼出时已 win.focus，延时确保窗口就绪）。
2. **大窗空白双击进小窗（统一逻辑）** [ChatView.tsx](src/renderer/src/components/chat/ChatView.tsx)：消息滚动容器/列表 wrapper 始终打 `data-mini-dragzone`；onDoubleClick 统一——空白处大窗→进小窗（setActiveView chat + setMiniMode true）、小窗→还原大窗。落在消息/按钮/文本上不触发。
3. **小窗空白右键菜单** [ChatView.tsx](src/renderer/src/components/chat/ChatView.tsx)：右键菜单从右上角小按钮移到**整个消息空白区**（滚动容器 onContextMenu，仅 dragzone 命中时弹）；选项：还原窗口 / 重置位置 / 关闭窗口。右上角还原按钮保留（去掉其自带右键）。
4. **删除欢迎界面无效提示** [WelcomeScreen.tsx](src/renderer/src/components/dashboard/WelcomeScreen.tsx)：移除「Press Ctrl+O to open a project」（该快捷键无实际效果）。

**风险点**：
- Y1 自动聚焦：呼出瞬间窗口若未获 OS 焦点，80ms 后 focus 是否生效（多数情况主进程已 win.focus，应可）。
- Y2 大窗双击进小窗：是否会与正常双击选词/操作冲突（仅 dragzone 空白命中才触发，消息区不受影响）。
- Y3 空白右键：消息上右键应走默认（不弹小窗菜单）；空白处右键弹自定义菜单。

**待测**：
- ⏳ Ctrl+Q 呼出小窗后无需点击即可直接打字。
- ⏳ 大窗空白处双击 → 进小窗；小窗空白双击 → 还原大窗。
- ⏳ 小窗空白处右键 → 还原窗口 / 重置位置 / 关闭窗口。
- ⏳ 欢迎界面不再显示 Ctrl+O 提示。

## 2026-06-27 — 小窗模式微调（闲置真收缩窗口 / 空白拖动 / 双击还原）

> typecheck 🔧 通过（ChatView/App/index.ts/preload 零报错；ConfigPanel:300 报错为用户未提交代码，与本改动无关）。

1. **15s 闲置真·收缩窗口（不再只隐藏 DOM）** [index.ts](src/main/index.ts)/[preload](src/preload/index.ts)/[ChatView.tsx](src/renderer/src/components/chat/ChatView.tsx)：之前只 `opacity-0` 隐藏消息流，窗口仍占满 360 高、背景挡视图。新增 IPC `window:setMiniHeight`(收缩到只剩输入框高度) / `window:resetMiniHeight`(恢复 MINI_H)，都保持窗口**左上角不动**——收缩时输入框随之"移到顶部"。ChatView 新增 effect：`miniBubblesHidden` 时调 setMiniHeight(inputAreaHeight+16)，恢复时 resetMiniHeight。hover/活动（全局 mousemove→miniPing）自动恢复。
2. **按住空白处拖动窗口** [ChatView.tsx](src/renderer/src/components/chat/ChatView.tsx)：消息滚动容器 + 消息列表 wrapper 在小窗时打 `data-mini-dragzone`；`onMiniBgMouseDown` 仅当 mousedown **直接落在 dragzone 元素**（空白背景，非消息/按钮/文本）时 JS 拖动窗口（getWindowPosition→setWindowPosition）。落在消息/可选文本上不拖，保证可选中。
3. **双击空白还原大窗** [ChatView.tsx](src/renderer/src/components/chat/ChatView.tsx)：滚动容器 onDoubleClick——目标是 dragzone 空白时 setMiniMode(false) 回大窗。

**风险点**：
- X1 窗口收缩：setMiniHeight 用 inputAreaHeight+16，输入框多行/带附件时高度变化能否跟随（依赖 inputAreaHeight，effect 依赖它会重算）。
- X2 收缩/恢复抖动：隐藏→收缩、活动→恢复，频繁切换是否平滑（窗口 setBounds 无动画，是瞬时跳变，但符合"只剩输入框"目标）。
- X3 空白拖动判定：dragzone 仅标在容器自身与列表 wrapper，点消息间隙空白能否拖；点消息文本不应拖（能否选中）。
- X4 双击还原 vs 双击选词：双击消息文本=选词，双击空白=还原，两者不冲突。

**待测**：
- ⏳ 15 秒无操作：窗口**真的收缩**到只剩输入框（背景不再挡视图），输入框在顶部。
- ⏳ 动鼠标/打字/新消息：窗口恢复高度、消息流重现。
- ⏳ 小窗按住空白处可拖动窗口；按消息文本能正常选中不误拖。
- ⏳ 双击小窗空白处=还原大窗。
- ⏳ 双击恢复仍可用、右键菜单仍可用。

## 2026-06-27 — 小窗模式重做（方案大改：放弃透明气泡，改「精简版大窗聊天界面」）

> 用户改方案：放弃透明窗+气泡，改为不透明窗 + 小窗=精简版大窗聊天界面（去侧栏/状态栏/标题栏/顶部栏），直接用原版消息流（图片等天然正常显示）。保留：简化输入框、15s 闲置隐藏、动画。typecheck 🔧 通过（ChatView/App/index.ts/preload 零报错；ConfigPanel:300 报错为用户未提交代码，与本改动无关）。

1. **恢复不透明窗口** [index.ts](src/main/index.ts)：`new BrowserWindow` 移除 `transparent/backgroundColor/hasShadow` → 恢复系统自带圆角/边框/阴影（不再需要 CSS 模拟）。
2. **清理透明相关 CSS** [globals.css](src/renderer/src/styles/globals.css)：删除 `html.mini-mode` 透明规则、`.cw-app-frame`/`.cw-app-shell`/`html.win-maximized` 圆角模拟、`.cw-mini-md` 气泡 Markdown 样式。
3. **清理 App** [App.tsx](src/renderer/src/App.tsx)：移除 cw-app-frame/shell 包裹（大窗回到原结构）、win-maximized 与 mini-mode 的 class 切换 effect；mini 分支容器改回不透明 `bg-background`。
4. **ChatView 小窗改用原版消息流** [ChatView.tsx](src/renderer/src/components/chat/ChatView.tsx)：删除整个两气泡分支 + `MiniBubble` 组件 + `miniBubbles` useMemo。小窗下消息滚动容器照常显示（仅把顶部留白 `pt-[104px]`→`pt-3`，因小窗无悬浮面板）；右上角浮一个「还原大窗」按钮（hover 加深）+ 右键菜单（还原/重置位置/关闭）。
5. **15s 闲置隐藏改作用于消息流** [ChatView.tsx](src/renderer/src/components/chat/ChatView.tsx)：闲置时整块消息流 `opacity-0` 淡出只剩输入框（输入框留底部不再上移）；鼠标/键盘活动或新消息（依赖 `miniMsgCount`）淡入。
6. **保留简化输入框**（沿用前轮）：小窗隐藏加文件/斜杠按钮、Provider 仅图标、模型名截 5 字、权限按钮简化字（面板仍完整）。

**风险点**：
- W1 不透明窗恢复后：大窗圆角/边框/阴影/最大化是否回到改动前正常状态（重点验，这是回退验证）。
- W2 小窗消息流：原版消息流在 420×360 小窗里是否可读、图片/工具调用/Markdown 都正常显示。
- W3 15s 淡出：消息流淡出后输入框仍可用；动鼠标/打字/新消息能淡入。
- W4 还原按钮 + 右键菜单在小窗内可用；托盘还原仍生效（沿用前轮 restore-request）。

**待测**：
- ⏳ 大窗口外观回到改动前（圆角/边框/阴影/最大化正常）。
- ⏳ Ctrl+Q 进小窗：精简聊天界面，无侧栏/状态栏/标题栏/顶部栏，消息流正常（图片能显示）。
- ⏳ 简化输入框在小窗里按钮不挤。
- ⏳ 15 秒无操作消息流淡出只剩输入框；活动/新消息淡入。
- ⏳ 小窗右上「还原」按钮 + 右键「还原/重置位置/关闭」均生效。

## 2026-06-27 — 小窗模式第七轮（大窗圆角边框真修 / 标题栏双击还原 / 气泡图片）

> typecheck 🔧 通过（ChatView/App/index.ts 零报错）。

**根本矛盾说明**：为做小窗透明（透出桌面），主窗口必须 `transparent:true`（运行期不可切），而 Windows 系统圆角/边框/阴影只给不透明窗 → 大窗丢了原生外观。又因小窗与大窗是同一窗口同一 store（方案 A，保证消息一致），不能改回不透明窗。**解法：保持透明窗，用 CSS 模拟大窗的圆角+边框+阴影。**

1. **大窗圆角/边框/阴影（真修）** [globals.css](src/renderer/src/styles/globals.css)/[App.tsx](src/renderer/src/App.tsx)：上一轮在 body 加 border-radius 无效——被 `#root`/App 容器的不透明 `bg-background` 盖成直角。改为：普通模式 body/#root **透明**，由 App 新增的两层容器绘制——`.cw-app-frame`（铺满窗口、留 8px 透明边距给阴影）+ `.cw-app-shell`（不透明圆角卡片 `border-radius:10px` + `border` + `box-shadow`，`overflow:hidden` 裁切内容）。最大化（`.win-maximized`）时去圆角/边框/阴影/边距贴满屏。welcome 与主界面两个返回分支都套上。
2. **标题栏双击还原窗口** [ChatView.tsx](src/renderer/src/components/chat/ChatView.tsx)：之前气泡整体双击=复制，标题栏双击也触发复制。改为气泡头部（标题栏）`onDoubleClick`=还原窗口（`onRestore`→setMiniMode(false)，`stopPropagation` 阻止冒泡到正文复制）；正文双击仍复制。MiniBubble 加 `onRestore` prop。
3. **气泡图片显示** [ChatView.tsx](src/renderer/src/components/chat/ChatView.tsx)：之前 MiniBubble 只渲染 content 文本，图片完全不显示。改为收集 user 的 `message.images` 与 AI 本轮 `toolCall.images`，用 `ChatImage` 渲染 16×16 缩略图（点击看大图）。`miniBubbles` 同步放宽：纯图片（无文字）的 user 消息也纳入（原来要求 content 非空会漏掉图片消息）；纯图片消息不再显示「等待发送」占位。

**风险点**：
- V1 大窗圆角：透明窗 + CSS 阴影边距，四角是否干净露出桌面、无黑边/无白边；拖动标题栏移动、resize 边缘是否正常（无系统边框，靠 CSS frame）。
- V2 最大化切换：`.win-maximized` 类切换时圆角/边距即时开关，最大化是否真的贴满屏无缝隙。
- V3 8px 透明边距：窗口边缘 8px 区域是否还能触发系统 resize（无边框窗 resize 依赖渲染层热区，需确认大窗能否拖边缩放）。
- V4 标题栏双击：单击仍能拖、双击触发还原，两者不打架（拖动阈值 4px）。
- V5 图片缩略图：user 附图与 AI 生成图都能显示；点击灯箱在透明小窗下正常。

**待测**：
- ⏳ 大窗口四角恢复圆角、有边框和投影阴影（接近原生不透明窗外观）。
- ⏳ 最大化时无圆角贴满屏；还原后圆角恢复。
- ⏳ 大窗能否正常拖动标题栏移动、拖边缘缩放（重点验 V3）。
- ⏳ 小窗气泡：标题栏双击=还原窗口；正文双击=复制。
- ⏳ 小窗气泡能显示 user 发的图片与 AI 生成的图片。

## 2026-06-27 — 小窗模式第六轮（收拢动画 / 托盘还原修复 / 状态化菜单 / 重置位置 / 大窗圆角）

> typecheck 🔧 通过（ChatView/App/index.ts 零报错）。

1. **气泡收拢动画** [ChatView.tsx](src/renderer/src/components/chat/ChatView.tsx)：之前折叠时内容结构从全文瞬切回 summary + line-clamp，导致只有展开动、收拢秒缩。改为**始终渲染全文**，仅靠 `max-height`（13rem↔3.9em）过渡收放，两个方向都平滑。移除不再用的 `summary` 变量。
2. **修托盘「还原窗口」无效** [index.ts](src/main/index.ts)/[preload](src/preload/index.ts)/[App.tsx](src/renderer/src/App.tsx)：真因——主进程 `exitMiniMode` 只改窗口尺寸，渲染层 `miniMode` store 没同步，UI 仍是小窗视图。改为主进程发 `window:restore-request` 事件→渲染层 `setMiniMode(false)`→回调 `setMini`→`exitMiniMode`，形态与 UI 同步。新增 preload `onRestoreRequest`。
3. **托盘菜单状态化** [index.ts](src/main/index.ts)：去掉「显示主窗口/小窗口显示/还原窗口」三按钮并存（迷惑）。改 `updateTrayMenu()` 按 `isMiniMode` 二选一——小窗时显「还原窗口」，大窗时显「小窗口模式」；`enterMiniMode`/`exitMiniMode` 后刷新菜单。
4. **重置位置** [index.ts](src/main/index.ts)/[preload](src/preload/index.ts)/[ChatView.tsx](src/renderer/src/components/chat/ChatView.tsx)：新增 `window:resetPosition` IPC + `resetWindowPosition()`（小窗→右上角、大窗→屏幕居中，修拖到屏幕外）。托盘菜单 + 气泡右键菜单都加「重置位置」。
5. **气泡右键去重复** [ChatView.tsx](src/renderer/src/components/chat/ChatView.tsx)：还原窗口 / 重置位置 / 关闭。
6. **大窗圆角恢复** [globals.css](src/renderer/src/styles/globals.css)/[App.tsx](src/renderer/src/App.tsx)：`transparent:true` 使 Windows 丢失系统自动圆角→直角。普通模式由不透明 body 自画 `border-radius:10px`（`html:not(.mini-mode):not(.win-maximized) body`）；最大化加 `.win-maximized` 去圆角贴满屏（App 监听 onWindowMaximized 切类）。
7. **双击托盘以大窗打开**（沿用上轮，showMainWindow 现走 restore-request 事件）。

**风险点**：
- U1 收拢动画：始终渲染全文是否增加开销（仅最后一条 assistant，可接受）；折叠 3.9em 裁切是否干净（无 line-clamp 省略号，纯裁切）。
- U2 托盘还原链路：restore-request→store→setMini 是否可靠把窗口变回大窗 + UI 同步。
- U3 状态化菜单：进出小窗后菜单项是否正确切换（依赖 enter/exitMiniMode 都触发 updateTrayMenu）。
- U4 重置位置：多显示器下「右上/居中」是否落在主屏可视区。
- U5 大窗圆角：最大化↔还原切换时圆角是否正确开关；圆角处是否露出桌面/黑边。

**待测**：
- ⏳ 气泡 hover 展开与移出收拢**都有**平滑动画。
- ⏳ 托盘右键「还原窗口」能真正变回大窗（UI 也变，原 bug）。
- ⏳ 托盘菜单按当前形态只显示一个切换项（小窗显还原/大窗显小窗）。
- ⏳ 托盘 + 气泡右键的「重置位置」能把拖出屏幕的窗口拉回。
- ⏳ 大窗口四角恢复圆角；最大化时无圆角贴满屏。

## 2026-06-27 — 小窗模式第五轮（修真·尺寸漂移 / 工具内联 / 右键菜单 / 托盘 / 15s）

> typecheck 🔧 通过（ChatView/index.ts 零报错）。

1. **修拖动窗口尺寸持续变大（真因）** [index.ts](src/main/index.ts)：撤销上一轮「拖动强制折叠」（误判，体验差）。真因是 Windows 透明无边框窗在 DPI 缩放下反复 `setPosition` 会被缩放系数逐次放大尺寸。改 `window:setPosition` IPC——小窗形态下用 `setBounds` 并把 width/height **显式锁死为 MINI_W/MINI_H**，尺寸无法漂移。渲染层恢复：拖动不折叠气泡（[ChatView.tsx](src/renderer/src/components/chat/ChatView.tsx) 去掉 draggingRef/强制 setExpanded(false)），点标题栏不再误折叠。
2. **工具调用内联回信息流** [ChatView.tsx](src/renderer/src/components/chat/ChatView.tsx)：上一轮误删→完全不显示。改为 `miniBubbles` 收集「最后一条 assistant 之后」的工具调用，在 AI 气泡正文**末尾内联**渲染（随内容滚动，非置顶常驻）；完成显 ✓、进行中转圈 + 工具名。
3. **气泡右键菜单** [ChatView.tsx](src/renderer/src/components/chat/ChatView.tsx)：小窗容器 `onContextMenu` 弹「还原窗口 / 关闭」（复用 useContextMenu）。还原=退出小窗回大窗；关闭=`window.api.close()`（隐藏到托盘）。
4. **托盘右键菜单** [index.ts](src/main/index.ts)：新增「小窗口显示」（发 toggle-mini-request 走渲染层统一路径）+「还原窗口」。
5. **双击托盘总以大窗打开** [index.ts](src/main/index.ts)：`showMainWindow` 内若在小窗形态先 `exitMiniMode`；托盘 `click`/`double-click` 与「显示主窗口」「还原窗口」都走它 → 总是大窗。
6. **闲置隐藏 60s→15s** [ChatView.tsx](src/renderer/src/components/chat/ChatView.tsx)。

**风险点**：
- T1 setBounds 锁尺寸：拖动是否仍跟手、无抖动；尺寸是否彻底不再漂移（重点验，原 bug）。
- T2 工具内联：流式过程中工具状态（✓/转圈）是否实时；工具多时气泡是否过高（受 max-height 限，可滚）。
- T3 右键菜单在透明小窗下定位/点击是否正常；「关闭」隐藏到托盘后能否从托盘恢复。
- T4 托盘「小窗口显示」：从大窗/隐藏态点它能否正确进小窗。
- T5 双击托盘：无论当前是小窗还是隐藏，都应弹出大窗。

**待测**：
- ⏳ 拖动标题栏移动：窗口尺寸恒定不变大（控制台 size 不再增长）。
- ⏳ 点/按标题栏不再误折叠气泡；hover 展开正常。
- ⏳ 工具调用内联显示在 AI 气泡里（随流，非置顶）。
- ⏳ 气泡右键：还原窗口 / 关闭 均生效。
- ⏳ 托盘右键有「小窗口显示 / 还原窗口」且生效。
- ⏳ 双击托盘图标始终打开大窗口。
- ⏳ 15 秒无操作气泡隐藏。

## 2026-06-27 — 小窗模式第四轮修正（拖动抖动 / 展开动画 / 工具栏回归流 / 隐藏过渡）

> 一批回归与体验问题。typecheck 🔧 通过（ChatView/index.ts/globals.css 零报错；ConfigPanel:300 报错为用户未提交代码，与本改动无关）。

1. **修拖动时气泡变大** [ChatView.tsx](src/renderer/src/components/chat/ChatView.tsx)：拖动标题栏时鼠标停在气泡上反复触发 `onMouseEnter`→展开，配合窗口移动导致尺寸抖动。加 `draggingRef`：mousedown 即置真并强制折叠、`onEnter` 在拖动中不展开、mouseup 复位。另修拖动起点 race——加 `ready` 标志，未取到窗口位置前不移动（避免瞬跳）。
2. **撤销工具调用单列置顶** [ChatView.tsx](src/renderer/src/components/chat/ChatView.tsx)：上一轮误把工具调用做成 AI 气泡顶部的常驻状态行——错。工具调用本属消息流（大窗一样在流里），小窗只镜像最后一条 assistant 文本。移除 `miniBubbles.tool`/`toolName`/状态行。
3. **恢复展开动画** [ChatView.tsx](src/renderer/src/components/chat/ChatView.tsx)：JS 受控展开后用三元换 DOM 导致「突然展开」。改为**单一容器** + `transition-[max-height]`（折叠 3.9em→展开 13rem，0.3s ease-out），内容随 expanded 切换截断/全文。
4. **context 面板去遮罩** [ChatView.tsx](src/renderer/src/components/chat/ChatView.tsx)：ContextPanel 加 `mini` 参数，小窗下去掉 `bg-black/40` 全屏暗色遮罩（仅留卡片+阴影），不挡桌面。
5. **隐藏/恢复 + 输入框移动动画** [ChatView.tsx](src/renderer/src/components/chat/ChatView.tsx)：气泡区由「卸载」改「保留挂载 + `opacity`/`-translate-y` 过渡」淡入淡出；composer 加 `transition-transform`，隐藏时 `translateY(-(窗口高-自身高))` 平滑上移到顶部、恢复时移回底部。闲置重置改为**全局** mousemove/mousedown/keydown 监听（移到顶部的输入框上操作也能唤回气泡）。

**风险点**：
- S1 拖动 race：`ready` 前不动是否造成「按下后要等一下才跟手」（getWindowPosition 很快，应无感）。
- S2 composer 上移距离用 `window.innerHeight`：多分辨率/缩放下是否准确移到顶部（小窗固定 360 高，应稳）。
- S3 展开 max-height 过渡：超长内容展开到 13rem 后内部滚动是否正常；折叠高度 3.9em 是否正好 3 行。
- S4 全局 keydown 重置：是否与其它快捷键冲突（仅 setState，无 preventDefault，应无副作用）。

**待测**：
- ⏳ 拖动标题栏移动窗口时气泡尺寸稳定、不再变大/抖动。
- ⏳ 工具调用不再单列置顶，回到 assistant 流式文本里。
- ⏳ hover 展开/收起有平滑动画（非突变）。
- ⏳ 小窗下打开 /context 面板无背后暗色遮罩。
- ⏳ 1 分钟闲置：气泡淡出 + 输入框平滑移到顶部；动鼠标/打字/来新消息：输入框移回 + 气泡淡入。

## 2026-06-27 — 小窗模式第三轮精修（标题栏拖动 / 受控展开 / 暗色气泡 / 工具状态 / 闲置隐藏）

> 一批反馈。typecheck 🔧 通过（ChatView/index.ts 零报错）。

1. **仅标题栏可拖** [ChatView.tsx](src/renderer/src/components/chat/ChatView.tsx)：JS 拖动从「整个气泡」收窄到「气泡头部标题栏」（`onTitleMouseDown`），正文区域恢复普通（可选中、可双击复制）。
2. **修 hover 闪缩** [ChatView.tsx](src/renderer/src/components/chat/ChatView.tsx)/[globals.css](src/renderer/src/styles/globals.css)：之前用纯 CSS `:hover` 展开，流式重渲染时 hover 态丢失 → 展开一下又缩回。改为 **JS 受控**（`onMouseEnter` 展开 / `onMouseLeave` 延时 160ms 收起），删掉 `.cw-mini-collapsed/.cw-mini-expanded` CSS。
3. **头部布局** [ChatView.tsx](src/renderer/src/components/chat/ChatView.tsx)：AI 气泡角色名改为**模型名**（传 `displayModelName`）；时间 + 复制按钮用 `flex-1` 推到**右对齐**。
4. **权限按钮/面板分离** [ChatView.tsx](src/renderer/src/components/chat/ChatView.tsx)：ModelPicker option 加 `triggerLabel`——小窗时按钮显简化字（询问/自动/计划/放行），下拉**面板仍显完整**（自动批准编辑/计划（只读）/完全放行）。
5. **暗色 AI 气泡** [ChatView.tsx](src/renderer/src/components/chat/ChatView.tsx)/[globals.css](src/renderer/src/styles/globals.css)：AI 气泡加 `dark:bg-neutral-800 dark:text-neutral-100`；`.dark .cw-mini-md` 文字改浅色。
6. **工具调用状态** [ChatView.tsx](src/renderer/src/components/chat/ChatView.tsx)：`miniBubbles` 额外找最后一条带 `toolCall` 的消息；AI 气泡显示「🔧 工具名」状态行，busy 占位文案也带「调用 X…」。
7. **展开不裁顶** [ChatView.tsx](src/renderer/src/components/chat/ChatView.tsx)：气泡容器改 `overflow-y-auto` + 内层 `mt-auto min-h-full justify-end`（规避 flex+justify-end+scroll 裁顶的已知 bug），展开超高可向上滚。
8. **默认右上** [index.ts](src/main/index.ts)：`enterMiniMode` 初始位置从右下角改右上角（`y = wa.y + 24`）。
9. **闲置自动隐藏** [ChatView.tsx](src/renderer/src/components/chat/ChatView.tsx)：1 分钟无鼠标活动/无新消息 → 隐藏气泡只剩输入框（`miniBubblesHidden`）；任何鼠标移动/按下（`miniPing`）或会话内容变化重置计时并重新显示；退出小窗清理定时器。

**风险点**：
- Q1 受控展开的收起延时（160ms）：鼠标在两气泡间移动是否顺滑、会否误收起。
- Q2 闲置隐藏：流式输出途中是否被误判闲置（已把 `miniBubbles` 变化纳入重置依赖，流式应持续刷新；但若 60s 无任何新内容且无鼠标会隐藏——需确认符合预期）。
- Q3 标题栏拖动范围是否够大好按；正文双击复制是否正常。
- Q4 暗色模式气泡对比与桌面透出后的可读性。
- Q5 工具状态行能否实时反映当前调用的工具。

**待测**：
- ⏳ 仅按标题栏可拖窗；正文可选中/双击复制；hover 展开后稳定不缩回。
- ⏳ AI 气泡显示模型名；时间+复制右对齐。
- ⏳ 权限按钮显简化字、点开面板显完整文案。
- ⏳ 暗色模式 AI 气泡为深色背景浅色字。
- ⏳ 工具调用时气泡显示工具名状态。
- ⏳ 展开长内容顶部不被裁、可向上滚。
- ⏳ 默认出现在屏幕右上角。
- ⏳ 1 分钟无操作气泡自动隐藏只剩输入框，动一下鼠标/来新消息重新出现。

## 2026-06-27 — 小窗模式交互精修（JS 拖动 / 双击复制 / 简化底栏）

> 一批小窗交互问题，**根因统一**：上一版气泡用 `-webkit-app-region:drag` 拖窗，它在 OS 合成层拦截鼠标 → 气泡 hover 不展开、双击无效、且让下拉面板在气泡区域点不动。改用 **JS 自定义拖动**后三者一并修复。typecheck 🔧 通过（ChatView/TitleBar/App/index.ts/preload 零报错）。

**缓存前缀影响**：无（纯 UI/窗口控制）。

1. **JS 拖动窗口** [index.ts](src/main/index.ts)/[preload](src/preload/index.ts)/[ChatView.tsx](src/renderer/src/components/chat/ChatView.tsx)：新增 IPC `window:getPosition`/`window:setPosition` + preload `getWindowPosition`/`setWindowPosition`。`MiniBubble` 用 `onMouseDown`→`mousemove` 算位移调 IPC 移窗，位移 <4px 视为点击不拖。去掉所有 `WebkitAppRegion:drag/no-drag`。
2. **hover 展开修复**：去掉 drag region 后 hover 恢复；可选中/按钮区用 `data-mini-nodrag` 标记，拖动时跳过（让文字可选中、复制按钮可点）。气泡容器改 `overflow-visible`，展开向上生长不被裁。
3. **双击复制 + 复制按钮**：气泡 `onDoubleClick` 复制全文；头部加复制按钮（复制后短暂显示 ✓）。
4. **头部时间**：气泡头部「你/AI」旁显示消息 `timestamp`（时:分）。
5. **整窗 hover 显示展开按钮**：展开为主窗口按钮的 hover 触发从「顶部条」改为整个小窗区（`group/mini`，本就如此，确认覆盖全区）。
6. **简化底栏** [ChatView.tsx](src/renderer/src/components/chat/ChatView.tsx)：小窗模式隐藏「附加图片(Plus)/斜杠命令(Command)」按钮（仍可拖入文件、输入 "/" 触发）；Provider 选择器只显示图标(`iconOnly`)；模型名截前 5 字符(`maxLabel`)；权限文案简化为 询问/自动/计划/放行（PERM_MODES 加 zhMini/enMini，ModelPicker 加 iconOnly/maxLabel 两参）。

**风险点**：
- P1 JS 拖动跟手性：异步取窗口起点 + 逐帧 setPosition，快速拖动是否跟手/有无抖动（多显示器缩放下坐标是否正确）。
- P2 双击与拖动/选中冲突：双击复制是否会被「按下即拖」误吞；展开区选中文字时不应触发拖窗（已用 data-mini-nodrag）。
- P3 简化底栏后小窗按钮是否都放得下、不再溢出（图示原 bug）。
- P4 去掉加文件/斜杠按钮后，拖入文件与输入 "/" 触发命令在小窗内是否仍正常。

**待测**：
- ⏳ 气泡 hover 平滑展开全文、气泡内滚动；展开内容可选中、可双击复制、可点复制按钮。
- ⏳ 按住气泡空白处拖动 = 移动窗口，松手不误触发复制。
- ⏳ 底栏不再拥挤：Provider 图标 + 模型名(5字) + 权限(询问/自动/计划/放行) + 发送键都可见可点。
- ⏳ Provider/权限/context 下拉面板在小窗内任意位置都能点中选项（原 bug：气泡上点不动）。
- ⏳ 头部时间显示正确；展开按钮在小窗任意位置 hover 都浮现。

## 2026-06-27 — 小窗模式重做（透明桌面气泡，对齐 antigravity-float）

> 上一版小窗渲染成了「带森林背景 + 标题栏 + 整套界面」的缩小窗，**错**。重读参考软件 antigravity-float 源码（index.html/style.css/main.js）确认正确形态：**窗口本身透明，背后即用户桌面**，只有两个气泡 + 输入框浮在桌面上；user 气泡右上深色、ai 气泡左下白色，默认 3 行截断，hover 在**气泡内**展开全文且滚动只发生在气泡内。typecheck 🔧 通过（App.tsx/ChatView.tsx/index.ts 零报错）。

**缓存前缀影响**：无（纯 UI/窗口形态，未触碰消息拼接）。

**关键技术约束**：Electron `transparent` 只能创建时设定、运行期不可切。方案 A（同窗变形）要实现桌面透明小窗，**主窗口必须从创建起即 `transparent`**。

1. **主窗口透明** [index.ts](src/main/index.ts)：`new BrowserWindow` 增加 `transparent:true` + `backgroundColor:"#00000000"` + `hasShadow:false`。正常模式靠渲染层根节点铺满不透明 `bg-background` 维持现状外观不变。
2. **mini 背景透明** [globals.css](src/renderer/src/styles/globals.css)：新增 `html.mini-mode` → body/#root 背景 `transparent !important` + `overflow:hidden`（整窗不滚动）；新增 `.cw-mini-md` 让白底气泡内 Markdown 文字强制深色、紧凑。
3. **切换类** [App.tsx](src/renderer/src/App.tsx)：useEffect 据 miniMode 在 `<html>` 加/去 `.mini-mode`；mini 容器去掉 `bg-background` 改 `bg-transparent`。
4. **气泡重做** [ChatView.tsx](src/renderer/src/components/chat/ChatView.tsx)：去掉带边框标题栏（多余界面）；整块 mini 区作 `WebkitAppRegion:drag` 拖动区，展开按钮改为仅 hover 浮现（`opacity-0 group-hover/mini:opacity-100`）；两气泡底部对齐堆在输入框上方。`MiniBubble` 重写：user 右对齐 `bg-neutral-900` 白字、ai 左对齐 `bg-white` 深字，默认 `-webkit-line-clamp:3` 截断，hover 切换为 `max-h-52 overflow-y-auto`（**滚动只在气泡内**），气泡整体 `WebkitAppRegion:no-drag`。

**风险点**：
- N1 透明窗口对**正常模式**的副作用：Windows 上 transparent 窗口的圆角/阴影/resize 边缘表现、最大化是否正常（这是不可逆的全局窗口属性变更，需重点实测正常大窗一切如常）。
- N2 拖动区与 composer：mini 空白处可拖动窗口，但气泡/按钮/输入框必须 no-drag 可正常点击/选中文字——需实测气泡 hover 展开后能否选中复制、输入框能否聚焦打字。
- N3 透明窗口下 composer 的浮层面板（斜杠/@/审批）背景是否仍不透明可读。
- N4 桌面透出后气泡可读性（白/黑气泡在任意壁纸上对比是否足够）。

**待测**：
- ⏳ Ctrl+Q 进小窗：背景透出桌面，无森林图/无标题栏/无其它界面，只有两气泡+输入框。
- ⏳ 气泡默认 3 行截断；hover 气泡内展开全文，长内容只在气泡内滚动（不出现整窗滚动）。
- ⏳ 空白处可拖动窗口；气泡可 hover、可选中文字；输入框可聚焦发消息。
- ⏳ 展开按钮 hover 小窗时浮现，点击回大窗，大窗外观与改动前一致（重点验 N1）。

### 追加修复（同日）：输入框可打字 + 气泡拖拽 + 平滑动画 + 主窗口入口按钮

> 上一版三个问题：① 小窗输入框无法打字；② 拖拽方式不对；③ 气泡动画/显示突兀。typecheck 🔧 通过（TitleBar/ChatView/App 零报错）。

1. **修输入框打字** [ChatView.tsx](src/renderer/src/components/chat/ChatView.tsx)：根因 mini 容器整块 `WebkitAppRegion:drag`，拖动层在事件层盖住下方绝对定位 composer，键盘焦点进不去。**去掉容器 drag**，输入框恢复可聚焦打字。
2. **改为按住气泡拖拽** [ChatView.tsx](src/renderer/src/components/chat/ChatView.tsx)：拖动移到 `MiniBubble` 气泡本体（`WebkitAppRegion:drag` + `cursor-grab`）；气泡内展开全文区单独 `no-drag` + `select-text` + `cursor-text`，保证可选中复制。
3. **平滑动画** [globals.css](src/renderer/src/styles/globals.css)：折叠/展开由 `hidden↔block` 硬切换改为 `.cw-mini-collapsed`/`.cw-mini-expanded` 的 `max-height`+`opacity` 缓动（0.28s cubic-bezier，参考 antigravity-float）。
4. **主窗口入口** [TitleBar.tsx](src/renderer/src/components/layout/TitleBar.tsx)：夜间模式按钮左侧新增 `PanelTopDashed` 图标按钮，点击 `setActiveView("chat")`+`setMiniMode(true)` 进小窗。

**追加待测**：
- ⏳ 小窗输入框能聚焦打字并发消息（重点，原 bug）。
- ⏳ 按住气泡可拖动窗口；气泡 hover 展开后文字可选中复制。
- ⏳ 气泡展开/折叠动画顺滑，无突兀跳变。
- ⏳ 标题栏新「小窗」按钮可进入小窗模式。

## 2026-06-28 — 修复亮色模式下文件侧边栏行 hover 无背景效果

> 根因：亮色调色板里 `--sidebar-bg` 与 `--accent` 同为 `240 5% 96%`（[globals.css:19](src/renderer/src/styles/globals.css#L19) / [globals.css:27](src/renderer/src/styles/globals.css#L27)），文件行用 `hover:bg-accent`，hover 色与底色完全相同 → 亮色下看不到加深；暗色下两者明度差大故正常，问题只在亮色暴露。
>
> 不影响 LLM 缓存前缀（纯样式改动）。

1. **新增 `--sidebar-hover` token** [globals.css](src/renderer/src/styles/globals.css)：亮色取 `240 5% 90%`（比 sidebar-bg 96% 更深、可见）；暗色取 `220 13% 27%`（沿用原 accent 值，行为不变）。
2. **文件行/搜索结果行改用该 token** [FileExplorer.tsx](src/renderer/src/components/explorer/FileExplorer.tsx)：树节点按钮与搜索结果按钮的 `hover:bg-accent` → `hover:bg-[hsl(var(--sidebar-hover))]`。

**待测**：
- ⏳ 亮色模式：鼠标悬停文件/文件夹行有可见的背景加深。
- ⏳ 暗色模式：hover 效果与之前一致、无回归。
- ⏳ 搜索结果列表行 hover 同样生效。


## 2026-06-27 — MCP 工具名唯一化 + list_changed 动态刷新

> 修两件事：① 修复 400 "Tool names must be unique"（长工具名被 `slice(0,64)` 截断撞名）；② 接入 `notifications/tools/list_changed`，让渐进式披露服务器（如 unreal-mcp 运行期 `load_toolset` 后）新工具能被客户端感知。typecheck 🔧 通过（`tsc -p tsconfig.node.json` 中 mcp-manager.ts 零报错；其余 relay/skills 报错为用户未提交的在写代码，与本改动无关，未触碰）。
>
> **明确不做 #7（Tool Search 懒加载）**：经与用户确认，既然采用「加载后会话内常驻、不为省 token 频繁卸载」策略，懒加载会在每次 `load_toolset` 往 tools 数组追加工具时**击穿 prompt 缓存前缀**（DeepSeek 等通用中转站无法像 Anthropic 服务端那样保断点），净负收益。工具膨胀改由「连接时按启用的 server 一次性定下工作集」控制。

**缓存前缀影响**：tools 块仅在 ① 连接时、② 真收到 list_changed 通知时变动。稳态会话内工具名固定不变 → 不破坏稳定前缀。`listOpenAITools()` 每轮实时读 `rt.tools`（[ipc-handlers.ts:921](src/main/ipc-handlers.ts#L921)），刷新后下一轮自动生效，无需推送 UI。list_changed 触发的刷新会让那一轮 tools 块变化（缓存击穿一次），但属真·能力变更、罕见，可接受。

1. **工具名唯一化** [mcp-manager.ts](src/main/mcp-manager.ts)：新增 `assignQualifiedNames(serverId, names)` 批量命名器——总长 ≤64、字符集合规、**同批保证唯一**。超长时**保留工具名尾部**（材质类工具差异多在尾段，利于模型分辨）；撞名兜底用原始名 4 位 FNV 哈希（`hash4`）替换尾部 5 字符，循环加哈希直到唯一。替换原 `slice(0,64)` 的破坏性截断。
2. **拉取抽方法** [mcp-manager.ts](src/main/mcp-manager.ts)：`connectServer` 里内联的 listTools 逻辑抽成 `refreshTools(id, client?)`，连接时与 list_changed 时复用。刷新失败保留旧快照（避免抖动抹掉工具），仅初次连接无工具时为空。
3. **list_changed 监听** [mcp-manager.ts](src/main/mcp-manager.ts)：connect 成功后 `client.setNotificationHandler(ToolListChangedNotificationSchema, …)` → 调 `refreshTools` 重建该服务器工具。

**风险点**：
- M1 工具改名后模型能否仍准确选工具：尾部语义保留 + 描述里带 server 名，理论上影响小；需实测 unreal-mcp 长名工具调用是否正常。
- M2 撞名哈希兜底：极端长 serverId 下命名是否仍唯一（已加 1000 次循环防护，理论必收敛）。
- M3 list_changed 刷新：unreal-mcp 运行期加载新 toolset 后，下一轮 agent 是否真能看到并调用新工具（此 server 之前实测较不稳，需在仅 weaver 连接时验证）。
- M4 原 400 是否消除：unreal-mcp 启用后发消息不再报 "Tool names must be unique"。

**待测**：
- ⏳ unreal-mcp 启用 → 发消息不再 400，工具可正常列出与调用。
- ⏳ 运行期触发 `load_toolset`（让 AI 做材质等）后，新工具能在后续轮被识别调用（验证 list_changed 生效）。
- ⏳ 已有 playwright 等其它 MCP 工具调用不受改名影响、仍正常。

## 2026-06-27 — 小窗模式（Mini Float 视图）

> typecheck 🔧 通过（`npx tsc --noEmit` 无报错）。**不是独立程序**：主窗口「变形」成无边框置顶小窗，渲染层 ChatView 切到 mini 分支——同组件、同 store、同 `runTurn`/`handleSend`，**消息路线与主窗口完全一致**。参考软件 antigravity-float 的 WebSocket 注入 + DOM 抓消息 hack 全部弃用（那只因它进不了宿主内部）。

**缓存前缀影响**：无。本改动不触碰发往 LLM 的消息历史拼接（`buildReplayMessages`/`runTurn` 拼史逻辑一字未改），仅新增 UI 形态与窗口控制。

1. **状态** [app-store.ts](src/renderer/src/stores/app-store.ts)：新增 `miniMode`（不持久化，启动回大窗）+ `setMiniMode`（通知主进程切形态）；`miniShortcut`（持久化 localStorage，默认 `CommandOrControl+Q`）+ `setMiniShortcut`（落盘并通知主进程重注册，返回是否成功）。
2. **主进程** [index.ts](src/main/index.ts)：`enterMiniMode/exitMiniMode`（进前存大窗 bounds、放宽最小尺寸到 320×200、缩到 420×360、置顶 screen-saver、跨工作区、移右下角；退出还原 bounds + 最小尺寸 900×600）；`registerMiniShortcut` 用 `globalShortcut` 注册，回调只发 `window:toggle-mini-request` 事件（语义=仅呼出小窗）；`before-quit` 注销全部全局快捷键。新增 IPC `window:setMini`/`window:setMiniShortcut`，启动注册默认键。
3. **preload** [index.ts](src/preload/index.ts)/[index.d.ts](src/preload/index.d.ts)：`setMini`/`setMiniShortcut`/`onToggleMiniRequest`。
4. **ChatView** [ChatView.tsx](src/renderer/src/components/chat/ChatView.tsx)：mini 时把消息流换成「拖动标题条 + 展开按钮 + 两个气泡」（`MiniBubble`：折叠摘要 + hover 浮出全文，AI 气泡 streaming/busy 转圈），**输入区（composer/队列/审批/提问）原样保留**——同一闭包同一发送链路；大窗消息容器用 `display:none` 隐藏不卸载。`miniBubbles` 用 `useMemo` 从 activeSession 派生最后一条 user/assistant。
5. **App** [App.tsx](src/renderer/src/App.tsx)：mini 时只渲染 ChatView（去标题栏/侧栏/标签栏/状态栏）；监听 `onToggleMiniRequest` → 切 chat 视图并进小窗；启动用持久化 `miniShortcut` 重注册。
6. **设置** [ConfigPanel.tsx](src/renderer/src/components/config/ConfigPanel.tsx)：外观分区加「小窗呼出快捷键」卡片——点击录制框按组合键设置（`eventToAccelerator` 转 Electron accelerator，必须含修饰键），注册失败提示「被占用」；附「进入小窗」按钮。

**风险点**：
- R1 全局快捷键被系统/其它程序占用 → 注册失败，UI 已有占用提示，但需用户实测确认 Ctrl+Q 在本机可用。
- R2 无边框小窗拖动依赖 `WebkitAppRegion:drag`，标题条区域是否能正常拖动待实测。
- R3 退出小窗 bounds 还原：多显示器/分辨率变化下右下角定位与还原是否正确。
- R4 mini 下 composer 的浮层面板（斜杠/@/审批卡片）在小尺寸窗口里是否溢出/可用。

**待测**：
- ⏳ 大窗发消息 → Ctrl+Q → 变小窗置顶右下角，两气泡显示对应 user/AI，hover 出全文。
- ⏳ 小窗输入框发消息 → AI 气泡实时流式更新；展开回大窗看到同一会话同样几条（链路一致）。
- ⏳ 小窗输入框：粘贴图片 / @文件 / 斜杠命令 / busy 时回车进队列。
- ⏳ 设置里改快捷键（普通组合 + 被占用组合分别验证）；重启回到大窗（miniMode 不持久化）。
- ⏳ 拖动小窗标题条移动位置。

---

## 2026-06-27 — 安装 unreal-engine-skills（60 个 UE5 领域技能）

> 从 [kevinpbuckley/unreal-engine-skills](https://github.com/kevinpbuckley/unreal-engine-skills) 克隆并安装全部 60 个技能到 `.claude/skills/`，按分类组织（core 45 + ultra-dynamic-sky 10 + ultra-dynamic-weather 5）。每个技能包含 `SKILL.md`（YAML frontmatter + Markdown 指令）及可选 `references/` 深度文档。

**安装内容**：44 个 Core 技能 + 10 个 Ultra Dynamic Sky + 5 个 Ultra Dynamic Weather，共 60 个 SKILL.md + 150+ 个 references/*.md 文件。

**缓存前缀影响**：技能由既有 skillsManager 按启用集合注入 system 提示稳定前缀；对同一启用集合字节恒定，跨轮不漂移。本次仅安装文件，未改任何代码逻辑。

**待测**：⏳ 在设置→Skills 面板确认能看到这些技能并启用/禁用；启用后 agent 在相关 UE 任务中是否优先参考技能指导。

---

## 2026-06-27 — 微信接入（第二版：图片/文件互传）

> typecheck + build 🔧 通过（`relay-gateway.js` 80.00→96.45 kB，含媒体收发）。**只做图片+文件，不做语音/视频**（避开 silk-wasm 与 ffmpeg 重依赖）。媒体收发全是纯 Node 内置（crypto/fs/全局 fetch），零外部依赖。**图片不压缩**：出站图片/文件都以原图/原文件 CDN 上传发送（图片走图片消息内联显示，文件走文件附件）。

1. **移植媒体协议层** [src/main/relay/weixin/media/](src/main/relay/weixin/media/)：`aes_ecb.ts`（AES-128-ECB 加解密）、`cdn_url.ts`（CDN 上传/下载 URL）、`cdn_upload.ts`（加密上传，全局 fetch）、`pic_decrypt.ts`（下载+解密）、`mime.ts`（mime↔扩展名）、`upload.ts`（裁掉视频缩略图/ffmpeg probe，图片+文件 `no_need_thumb` 原图上传）、`send.ts`（`sendImageMessageWeixin`/`sendFileMessageWeixin`）、`media_download.ts`（裁掉 voice silk/video，只 IMAGE/FILE 下载解密落 temp）。
2. **api.ts 补 `getUploadUrl`**、**types.ts 补媒体类型**（CDNMedia/ImageItem/FileItem/UploadMediaType/MessageType/State + GetUploadUrl 请求响应 + MessageItem 加 image_item/file_item）。[api.ts](src/main/relay/weixin/api.ts)/[types.ts](src/main/relay/weixin/types.ts)。
3. **WeixinAdapter 入站媒体** [weixin-adapter.ts](src/main/relay/weixin-adapter.ts)：`handleInbound` 改 async，文本→ask（含 prompt 答复快路径）；无文本时图片→下载解密到 temp 作为 `command.images`（vision），文件→下载后把路径拼进 prompt 让 AI 读；语音/视频回「暂不支持」提示。
4. **WeixinAdapter 出站媒体**：`emit` 的 `kind:"image"`/`"document"` 改为真正发送 —— 新增 `sendMediaFile`：体积闸（>50MB 回提示不发）；图片用 `uploadImageToWeixin`+`sendImageMessageWeixin`（内联、原图不压缩），非图片用 `uploadFileAttachmentToWeixin`+`sendFileMessageWeixin`。CDN 基址 `https://novac2c.cdn.weixin.qq.com/c2c`。
5. **UI 文案** [WeixinSettings.tsx](src/renderer/src/components/config/WeixinSettings.tsx)：改为「支持文本与图片/文件互传（图片保留原画质；暂不支持语音/视频）」。

**风险与待测重点**：
- R1：入站图片 —— 手机发图给机器人，AI 能「看到」图并回复（vision）。⏳（注：入站图统一按 `.jpg`/`image/jpeg` 落盘，AI 看图靠内容不靠扩展名，不影响识别）。
- R2：入站文件 —— 手机发文件（.txt/.pdf 等），AI 能 read_file 读取处理。⏳
- R3：出站图片 —— AI 生成一张图，微信收到原图（内联显示、无压缩）。⏳（**重点：原图较大时微信图片消息是否接受**，若失败需考虑回退当文件发）。
- R4：出站文件 —— AI 产出/导出文件，微信收到附件；超 50MB 回提示不发。⏳
- R5：context_token —— 发媒体同样依赖入站缓存的 context_token，收不到媒体多半是它没带上。⏳
- R6：语音/视频 —— 发来时收「暂不支持」提示，不崩溃。⏳


## 2026-06-27 — 全局统一 tooltip（notetip 样式）+ 修 todo 详情框偏移

> 不影响 LLM 消息拼接 / 缓存前缀（纯渲染层 UI）。

1. **修 todo hover 详情框偏移** [ChatView.tsx](src/renderer/src/components/chat/ChatView.tsx)（TodoRoadmap 浮层）：(a) 动画从 `animate-fade-in` 改为 `animate-fade-opacity`（关键帧 transform 覆盖了居中用的 translateX）；(b) **真正根因**——浮层虽用 position:fixed 但内联渲染在组件树里，被带 transform 的祖先（悬浮面板层）锚住，导致 fixed 相对该祖先而非视口定位，偏到界面中央。改为 `createPortal` 到 `document.body`（与 GlobalTooltip 同路径）即贴回圆点旁。补 `react-dom` 的 createPortal 导入。🔧 静态。
2. **全局 tooltip 控制器** [GlobalTooltip.tsx](src/renderer/src/components/ui/GlobalTooltip.tsx)（新）：挂在 [App.tsx](src/renderer/src/App.tsx) 根部（欢迎页 + 主界面两分支都挂）。捕获阶段监听 mouseover，找最近的带 `title` 元素，把 title 暂存到 `data-cw-tip` 并移除以屏蔽系统默认气泡；hover 320ms 后用 position:fixed 浮层渲染（notetip 样式：`bg-popover border shadow-lg`），下方居中定位，超出视口底部翻到上方、左右夹住不越界；mouseout/mousedown/scroll/blur 收起并还原 title。无需改动任何现有 `title=`（全项目 115 处自动统一）。🔧 typecheck 我新增的两文件无报错。

**风险与待测重点**：
- R1：所有原有 `title` 提示是否都变成新样式、文案正确、不再弹系统默认气泡。⏳
- R2：定位是否贴在目标元素旁（不再偏移）；靠近视口底部/左右边缘时是否正确翻转/夹取不溢出。⏳
- R3：滚动/点击/切窗时浮层是否及时消失，不残留。⏳
- R4：title 被临时移除——可访问性/语义在 hover 结束后是否正确还原（移出元素、卸载后均还原）。⏳
- R5：性能——全局捕获 mouseover 是否对密集 UI 有可感卡顿。⏳
- 备注：[ConfigPanel.tsx](src/renderer/src/components/config/ConfigPanel.tsx) 第 300 行的 typecheck 报错为用户工作区既有改动，非本次引入。

## 2026-06-27 — 微信接入（官方 iLink clawbot，第一版：扫码登录 + 文本收发）

> typecheck + build 🔧 通过（`relay-gateway.js` 27.68→79.91 kB，含微信代码）。复用现有平台无关 relay 架构（adapter + utilityProcess 网关），新增微信 = 新写一个 `WeixinAdapter implements RelayAdapter`，RelayCore 业务零改动。微信收发层移植自 codex-bridge 的 iLink 协议，仅依赖 Node 内置模块（https/crypto/dns）。

1. **移植微信协议层** [src/main/relay/weixin/](src/main/relay/weixin/)：`types.ts`（裁剪到文本路径）、`api.ts`（getUpdates/sendMessage/sendTyping/getConfig/getBotQr/getQrStatus + DNS 多地址轮换 HTTPS，剥 i18n/fetchImpl）、`transport.ts`（收敛为绑定 baseUrl/token 的对象）、`login.ts`（扫码登录状态机，回调二维码/状态）。
2. **协议扩展** [protocol.ts](src/main/relay/protocol.ts)：`RelaySource` 加 `"weixin"`；新增扫码登录控制消息 `weixin-login-start`/`weixin-login-cancel`（主→网关）与 `weixin-qr`/`weixin-logged-in`（网关→主）。微信登录语义不同于「给 token 即连」。
3. **WeixinAdapter** [weixin-adapter.ts](src/main/relay/weixin-adapter.ts)：长轮询 getupdates（35s/轮，sync cursor 续传）→ 文本归一化为 `ask` command；emit 的 result/progress/error → sendMessage（markdown 退化为纯文本、超长按字数切分）；typing → getConfig 取 typing_ticket → sendTyping；prompt 降级为「回复编号」纯文本交互；自带 startLogin/cancelLogin（扫码）；错误退避重连。
4. **网关注册** [gateway.ts](src/main/relay/gateway.ts)：makeAdapter 加 weixin 分支；handle 转发 weixin-login-start/cancel 给 WeixinAdapter。
5. **凭据/配置存储** [relay-core.ts](src/main/relay/relay-core.ts)：token 入 SecretsManager（key `__weixin_bot_token__`），accountId/baseUrl/userId 入 relay config；connect 对微信特殊处理（无 applicationId 要求，缺凭据走扫码）；处理 weixin-qr（转发渲染层）/weixin-logged-in（持久化）；新增 startWeixinLogin/cancelWeixinLogin；硬编码平台列表统一为 ALL_SOURCES。
6. **IPC/preload** [ipc-handlers.ts](src/main/ipc-handlers.ts)/[preload/index.ts](src/preload/index.ts)/[preload/index.d.ts](src/preload/index.d.ts)：新增 `relay:weixinLogin`/`relay:weixinCancelLogin` invoke + `relay:weixinQr` 推送；relay 配置类型加微信字段。
7. **登录 UI** [WeixinSettings.tsx](src/renderer/src/components/config/WeixinSettings.tsx)（新）+ [ConfigPanel.tsx](src/renderer/src/components/config/ConfigPanel.tsx)：链接分区 tab 加「微信」；扫码登录（用 `qrcode` 包把登录串渲染成二维码 `<img>`，或直接用服务端 data:image）；状态机文案（wait/scaned/confirmed/expired/error）；已登录显示账号 + 退出登录；上线/断开。
8. **新增依赖**：`qrcode@1.5.4` + `@types/qrcode`（仅渲染层用，网关不依赖）。

**风险与待测重点**：
- R0：**[已修]** 二维码/收发请求超时 —— 根因是固定走「解析 IP → 连 IP」在部分网络/SNI 下握手卡死至 20s 超时。改为先主机名直连（系统 DNS+SNI），失败再回退 IP 轮换。[api.ts](src/main/relay/weixin/api.ts)。🔧 已实测请求成功（~0.8s 拿到二维码）；登录后 getupdates 走同一函数同步受益。
- R1：扫码登录 —— 点「开始扫码登录」应弹二维码，微信扫码→手机确认→状态转「在线」。⏳（**重点：二维码能否正常渲染、确认后能否自动上线**）。
- R2：文本收发 —— 微信给机器人发文本，桌面 RelayCore 走当前会话出 AI 回复，回到微信收到答复（超长分多条）。⏳
- R3：context_token —— 发回消息依赖入站缓存的 context_token；若机器人收不到回复，多半是 context_token 未带上。⏳
- R4：断线重连 —— 长轮询出错应退避重试并反映 error→online。⏳
- R5：提问交互 —— 触发需选择的提问，���信收到「回复编号」文本，回数字能正确作答。⏳
- R6：iLink 协议为非公开 wire format（随机 X-WECHAT-UIN、固定客户端版本号），微信侧接口变更可能导致失效，非本项目可控。⏳


## 2026-06-27 — 生图为远程 URL 时桌面裂开/手机显示链接

> typecheck + build 🔧 通过。根因：模型有时不走 generate_image 工具落地本地文件，而把图以 **远程 URL / Markdown 图 / data URI 写进正文**（"点链接能看到图"即证）。桌面 `<img src=远程URL>` 被 CSP 挡成裂开；relay 没拿到 `GENERATED_IMAGE_PATHS` → 没走 sendPhoto → 正文 URL 被渲染成链接。

1. **桌面 markdown 图片可显示**：`chats:readImage` 扩展支持 **data URI（原样）+ 远程 http(s)（主进程下载→dataUrl，绕 CSP）**；导出 `downloadImageBytes` 复用。Markdown 新增 `img` 渲染器 `MdImage`：经 `readChatImage` 取成 dataUrl 显示，加载中占位、失败回落可点链接。[ipc-handlers.ts](src/main/ipc-handlers.ts)/[tools.ts](src/main/tools.ts)/[Markdown.tsx](src/renderer/src/components/chat/Markdown.tsx)。状态 ⏳。
2. **手机内联显示而非链接**：relay 从最终正文抽出 Markdown 图/裸图片 URL/data URI，作为内联图片回传，并把它们从发给手机的文本里**剥掉**（去重复链接）。[DiscordRelay.tsx](src/renderer/src/components/discord/DiscordRelay.tsx)。
3. **Telegram sendPhoto 支持三形态**：本地路径(InputFile)、远程 URL(直接传字符串、服务端抓取)、data:base64(解码 Buffer)。[telegram-adapter.ts](src/main/relay/telegram-adapter.ts)。状态 ⏳（**重点：手机发"画一张猫"，确认手机内联出图、桌面不再裂开**）。

### 缓存前缀影响
无（响应展示/图片下载层；不碰 LLM 消息拼接）。

## 2026-06-27 — 系统提示词优化（任务启动盘点 / 交叉验证 / 工具名核对 / 持久化 checklist 完成必登记）

> typecheck 🔧 通过（`npx tsc --noEmit` 无输出）。运行时项 ⏳ 待实测。

主模式系统提示 `buildSystemPrompt`（[agent-loop.ts](src/main/agent-loop.ts) 1403 起）增改 4 条，均为提示文本，不改逻辑：
1. **How to work 段首新增「启动盘点」**：任务开始先盘点已有资源——优先检查是否有可用 SKILL（下方注入的 skills 名单）、扫描项目既有文件/配置/约定，复用成熟既有代码/库而非凭想象自造；先搜索后构建。
2. **持久化 checklist 条强化「完成必登记」**：完成任意离散任务（尤其需用户运行时验证的改动）必须调 `checklist_submit` 登记，否则不算收尾；针对「改了东西却结束回合不登记待验证项」这一常见失误显式约束。
3. **Grounding 段新增「交叉验证」**：当自身知识/假设与用户陈述或工具/代码所示冲突时，不得静默二选一，须交叉核对（重读文件/搜索/web_search）后再行动；以工具所得为准、高于训练知识。
4. **Tools 段新增「工具名以本环境为准」**：本环境工具名/签名是权威，可能与记忆中其它环境不同；调用前确认工具确实以该精确名称/参数存在。
   - 风险：低。纯系统提示文本调整，不动调度、工具门、返回管线。

### 缓存前缀影响
有影响但属一次性。这些文本进入主 system 提示（稳定缓存前缀的一部分）；本次改动后，提示字节变化会使旧缓存失效一次（首轮全价重算），此后对同一会话字节恒定、正常命中。未引入任何逐轮易变内容（无时间戳/动态字段），不会持续击穿前缀。

### 待测重点
① 有匹配 skill 时模型是否优先调用 skill 而非自造；② 用户陈述与代码冲突时是否主动交叉验证而非硬选一边；③ 改完是否会主动调 checklist_submit 登记待验证项；④ 是否仍会调用不存在的工具名。

## 2026-06-27 — 子 agent 结构化收尾报告（参照官方 Dynamic Workflows 的成果回收）

> typecheck 🔧 通过（`npx tsc --noEmit` 无输出）。运行时项 ⏳ 待实测。

1. **子 agent 结构化收尾**：`runSubAgentLoop` 的系统提示 `sysLines` 末尾追加固定收尾约定，要求子 agent 的最终报告（无工具调用的那条消息）按 `Conclusion / Files / Evidence / Confidence` 四段结构化输出，替代原先的自由散文，便于父 agent 机械地比对与归并。只读 agent 的 Files 段要求 `path:line` 证据位置，可写 agent 要求列出实际改动的文件。[agent-loop.ts](src/main/agent-loop.ts) `runSubAgentLoop`（1069 起）。
   - 风险：低。仅改子 agent 的系统提示文本；不动 fan-out 调度、返回管线（`finalText`→`report`）、权限门、缓存前缀。

### 缓存前缀影响
无。子 agent 拥有独立的 `messages`（独立 system + user），与主对话历史的稳定前缀完全隔离；本次仅改子 agent system 文本，不触碰主 agent 的 system/工具定义/历史前缀。

### 待测重点
① 派发一个只读子 agent（如 code-explorer），看回传报告是否按四段结构；② 派发一个可写子 agent，看 Files 段是否列出实际改动文件、Confidence 是否给出；③ 多子 agent 并发 fan-out 后，主 agent 是否能基于结构化片段更好地归并（而非堆散文）。

## 2026-06-27 — Telegram 体验/视觉优化 6 项（折叠进度/返回导航/上传动作/表情状态/审批按钮态/置顶面板）

> typecheck + build 🔧 通过（relay-gateway.js 55.73 kB）。运行时项 ⏳ 待实测。

1. **可折叠进度**：进度消息的工具调用行放进 `<blockquote expandable>`（HTML），默认折叠只露几行、点开看全部，不再一长串刷屏。`progressBody` 改输出 HTML + 新增 `editProgress`（HTML 编辑，失败回落去标签纯文本）。[telegram-adapter.ts](src/main/relay/telegram-adapter.ts)。
2. **菜单返回导航**：provider 模型菜单底部加「⬅️ 返回供应商」按钮（value `provback`）→ 重新列供应商；项目目录菜单本就自带「上级」。[DiscordRelay.tsx](src/renderer/src/components/discord/DiscordRelay.tsx)/[telegram-adapter.ts]。
3. **上传动作细分**：发图前 `sendChatAction("upload_photo")`、发文件前 `upload_document`，手机显示"正在上传图片/文件…"。[telegram-adapter.ts]。
4. **表情状态**：给触发本轮的用户消息打表情作轻量状态：👀 收到 → ✍️ 首条进度 → 👍 完成 / 💔 失败（不占新消息、不刷屏）。`activeProgress` 增 `userMsgId/working`。[telegram-adapter.ts]。
5. **审批卡按钮态**：提问/审批卡作答后不再覆盖问题正文，改用 `editMessageReplyMarkup` 把按钮换成一枚「✅ 已选择：X / ⏱️ 超时 / ↩️ 已处理」状态按钮（保留问题），新增 `markPromptDecided` + `noop` 回调。文本卡（forceReply 无按钮）仍编辑正文短句。[telegram-adapter.ts]。
6. **置顶状态面板**：新增 emit `board`（协议 + relay-core 每条命令后推送）。Telegram 维护一条 pin 消息显示「📂 项目 ｜ 🤖 模型 ｜ 🔐 模式·行为」，变更时编辑（内容不变跳过）。新增 bridge `statusLine` 往返（`discord:status-line`，读桌面活动会话，只读快速、失败静默）。[protocol.ts](src/main/relay/protocol.ts)/[relay-core.ts](src/main/relay/relay-core.ts)/[ipc-handlers.ts](src/main/ipc-handlers.ts)/[preload](src/preload/index.ts)/[DiscordRelay.tsx]/[telegram-adapter.ts]。

### 缓存前缀影响
无（全部为 Telegram 渲染层/relay 推送；statusLine 为只读读取桌面状态，不碰 LLM 消息拼接）。

### 待测重点
① 跑一轮看进度是否折叠可展开；② provider 进模型菜单点「返回供应商」；③ 发图/收图时手机的"上传中"提示；④ 用户消息上的 👀→✍️→👍/💔 表情变化（注意 Telegram 私聊需允许 bot 加表情）；⑤ 审批/选项卡点按钮后问题正文是否保留、按钮变状态；⑥ 置顶面板是否出现并随切项目/模型/模式更新（首次会 pin 一条，注意是否需要给 bot pin 权限——私聊默认可 pin）。

## 2026-06-27 — 出图协议正交化 + 配置导出补全 Telegram

> renderer typecheck 🔧（config-transfer.ts / ProviderSettings.tsx 无报错；ConfigPanel.tsx:299 的 TS 报错为用户未提交工作，与本次改动无关，未触碰）。
> 缓存前缀：不涉及 LLM 消息历史拼接，无缓存前缀影响。

### 改动
1. **出图后缀与协议正交化**（[ProviderSettings.tsx](src/renderer/src/components/config/ProviderSettings.tsx)）：
   - 根因：出图核心 `generateImages`（[tools.ts:1682](src/main/tools.ts#L1682)）只读 `imageEndpoint`，永远发 OpenAI 兼容请求体，**完全不读 `protocol`**。原 UI 却按协议过滤后缀（anthropic/responses 下隐藏 chat），造成"协议会影响出图"的错觉。
   - 改为三个后缀（images / chat / raw）对任何协议恒定可选，移除按协议过滤与"切协议自动回落 images"的副作用；加一行说明"出图固定 OpenAI 兼容格式，与协议无关"。
2. **配置导出/导入补全 Telegram、改读统一 RelayCore**（[config-transfer.ts](src/renderer/src/lib/config-transfer.ts)）：
   - 根因：原 `collectDiscord` 走已废弃的 `discord:getConfig`（旧独立系统），**完全没有 Telegram**，且 Discord 读的是过时数据。
   - 新增 `relay` 分区（id=`links`，与 UI 对齐），从 `relayGetConfig('discord'|'telegram')` 收集两平台配置 + 各自 token（`__discord_bot_token__` / `__telegram_bot_token__`），导入走 `relaySaveConfig`。
   - 向后兼容：`parseBundle` 把旧 `discord` 分区迁移为 `links`；`applyRelay` 对无 discord/telegram 子键的扁平旧结构当 Discord 处理。

### 风险
- R1：导出文件结构变化（`sections.discord` → `sections.links`，内部嵌套 discord/telegram）。旧文件导入已做兼容迁移，需实测：旧版导出文件能否正确导入 Discord 配置。
- R2：新导出文件含 Telegram token 明文（与 Discord 一致，UI 导出前已有警告）。
- R3：出图 UI 移除了"切协议把 chat 回落 images"逻辑——已选 chat 的供应商即便协议非 openai 也会保留 chat（功能上 chat 发的是 OpenAI chat 请求体，与协议无关，预期正常）。

### 待测项
- ⏳ 导出配置：勾选「链接」分区，导出 JSON 应同时包含 Discord 与 Telegram（含 token）。
- ⏳ 导入配置：新格式导入后 Discord/Telegram 配置与 token 正确落地、可连接。
- ⏳ 导入旧版导出文件（仅含 `discord` 分区）：Discord 配置仍能正确导入。
- ⏳ 出图设置：anthropic / responses 协议下三个后缀均可见可选；用 images 后缀出图正常。

## 2026-06-27 — 修复"发消息无任何显示无报错"（200 空流静默失败）

> typecheck + build 🔧 通过。根据用户日志 `hi-2026-06-27.jsonl` 定位。

### 根因
日志显示：请求正常（stream=true，内容"hi"，49 工具，58KB），服务器（vilao.ai 中转 `occ/claude-opus-4-8`）返回 **HTTP 200，但整段流没有任何文本/工具调用/usage**。原代码在 `res.on("end")` 把空流 resolve 成 `content:null` 的空消息——**既不报错也不显示**，用户就看到"发了没反应"。同时传输日志在 200 成功时不记响应体，正好成了这种"200 空流"的盲区。

### 修复
1. **空响应检测**：`end` 时若 `!content && toolCalls.length===0` → 向渲染层发 `agent:error` 明确提示（多为中转/供应商问题：模型名不被端点支持、上游静默拒绝、非标准流；建议换模型/供应商，或开调试日志看响应原文）。[agent-loop.ts](src/main/agent-loop.ts)。
2. **日志增强**：`logResponse` 新增 `raw`/`note` 字段；开启传输日志时累积整段原始流（≤16KB），空响应时把原文（≤8KB）+ `note:"empty stream"` 写进日志，便于看清中转站到底吐了什么。[transport-logger.ts](src/main/transport-logger.ts)/[agent-loop.ts]。
状态 ⏳（**重点：复现后应能看到红色报错提示而非静默；开调试日志可在 .jsonl 里看到 raw 响应原文**）。

### 缓存前缀影响
无（仅响应侧检测与日志，不碰请求拼接）。

## 2026-06-27 — 移除手机游戏模式 + 传输调试日志一键开关

> typecheck + build 🔧 通过（relay-gateway 51.69 kB / preload 27.01 kB）。

### 1. 移除手机端游戏模式
1. 删除 Telegram `/game` 命令与 BOT_COMMANDS 项；移除 `onDiscordUiOp` 的 `game` 分支（保留 chat/agent/compact）。[telegram-adapter.ts](src/main/relay/telegram-adapter.ts)/[DiscordRelay.tsx](src/renderer/src/components/discord/DiscordRelay.tsx)。
2. relay 跑一轮**强制 `gameMode: false`**（即便桌面活动会话开着游戏模式，手机这轮也不走游戏模式，避免手机端游戏模式出问题）。[DiscordRelay.tsx]。状态 ⏳。

### 2. 传输调试日志（一键开关，无需重启）
3. 复用已有 `transport-logger`（本就完整记录：发往 LLM 的请求体 + headers〔脱敏〕+ 响应状态码 + usage + **报错正文 4000 字**，按会话落 JSONL）。原仅 env 变量 `CW_TRANSPORT_LOG=1` 开、需重启。新增运行期开关 `setTransportLogEnabled()`（优先级高于 env），IPC `transport-log:setEnabled`。[transport-logger.ts](src/main/transport-logger.ts)/[ipc-handlers.ts](src/main/ipc-handlers.ts)。
4. preload 暴露 `transportLogOpen` / `transportLogSetEnabled`。[index.ts](src/preload/index.ts)/[index.d.ts](src/preload/index.d.ts)。
5. UI：设置 → 「传输调试日志」卡片（开关 + 打开日志文件夹 + 显示目录）。[ConfigPanel.tsx](src/renderer/src/components/config/ConfigPanel.tsx)。状态 ⏳（**用法：打开开关 → 复现 provider 报错 → 点"打开日志文件夹" → 把对应会话的 .jsonl 发我**）。

### 缓存前缀影响
无（日志仅旁路记录，gameMode 改动不碰消息历史拼接）。

## 2026-06-27 — Relay 修复批次4（网关崩溃自愈 + 长输出分段不甩 txt + 全局异常兜底）

> typecheck + build 🔧 通过（relay-gateway.js 51.93 kB）。针对"输出显示不出来→突然来个 txt→彻底中断只能回桌面重连"。

### 1. ⚠️ 彻底中断、发什么都没反应、只能回桌面重新点链接
1. **根因**：bot 网关跑在 utilityProcess（gateway.ts），任何漏网的未捕获异常/Promise 拒绝（发图、网络抖动、grammy 内部）会让**整个子进程崩溃**；而 relay-core 只 fork 一次，进程 exit 后仅把平台标离线，**不自动重启、不重连** → 用户只能回桌面重新点链接。
2. **修复A**：gateway.ts 加 `process.on("uncaughtException"/"unhandledRejection")` 全局兜底——只记日志，不让进程死，交给 adapter 自己的心跳/重连自愈。[gateway.ts](src/main/relay/gateway.ts)。
3. **修复B**：relay-core 子进程意外 exit（非主动 shutdown）时，记下退出前 online/connecting 的平台，**2s 后自动重启网关并重连**。新增 `shuttingDown` 标志区分应用退出（应用退出不自愈）。[relay-core.ts](src/main/relay/relay-core.ts)。状态 ⏳（**重点：连接后让它跑久一点/触发一次异常，看是否自动恢复而非死等**）。

### 2. ⚠️ 实时输出看不到、最后突然甩一个 txt
4. **根因**：最终答案 >4096 字符时，原逻辑直接 `sendDocument` 当 `output.txt` 甩出——既看不到正文、又像"突然来个文件然后就断了"。
5. **修复**：超长结果改为 `sendLong()` **按换行边界分段发多条普通消息**（每段 <4096，逐条富文本，各自失败回落纯文本，350ms 间隔规避连发限速）。不再产生 txt 文档。[telegram-adapter.ts](src/main/relay/telegram-adapter.ts)。状态 ⏳（**重点：让 AI 产出一段很长的回答，确认是分多条消息而不是 txt**）。

### 说明
- 进度（工具/todo）仍是**编辑同一条占位消息 + 1.5s 去抖**（Telegram editMessageText 限速，不可能逐字流式）。最终答仍作为新消息发在进度之后。relay 本就不做正文流式——这是设计取舍，非 bug。
- 长答案分段不影响图片回传（image emit 独立路径）。

### 缓存前缀影响
无（纯网关进程生命周期 + 平台消息发送方式，不碰 LLM 消息拼接）。

## 2026-06-27 — Relay 修复批次3（同步统一：手机操作落在桌面活动会话 + 生图上下文 + 按钮态清理）

> typecheck + build 🔧 通过。运行时项 ⏳ 待实测。本批核心：**手机远程操作改为"跟随桌面当前活动会话"**，根治 mode/模型/游戏/压缩在桌面看不到变化的问题。

### 1. ⚠️ 统一根因：远程操作作用在隐藏会话上（导致 compact/模型/游戏 桌面不同步）
1. **根因**：`ensureTarget` 每个来源新建独立的 "Telegram/Discord" 会话，手机操作落在那上面，而用户看的是桌面别的会话 → 一切都"不同步"。修复：`ensureTarget` 改为**默认跟随桌面 `activeSessionId`**（不锁 `targetRefs`，持续跟随桌面后续切换）；仅当用户在该来源做过 `/session new` 或 `/session switch` 才锁定专属会话。[DiscordRelay.tsx](src/renderer/src/components/discord/DiscordRelay.tsx)。状态 ⏳。

### 2. 切换模型桌面顶栏不变
2. **根因**：桌面顶栏读的是**会话绑定的 provider/model**（`setSessionModel`），relay 只改了全局 `useProviderStore`。修复：`onDiscordProviderOp` 切换后追加 `bindSessionModel(pid,name,model)` → `setSessionModel(activeSessionId,…)`，桌面顶栏实时更新（无模型/有模型/数字回退三处都绑）。[DiscordRelay.tsx]。状态 ⏳。

### 3. 压缩上下文后桌面无"已压缩" UI
3. **根因**：compact 压在隐藏会话 + 未 setActive。修复（叠加第 1 项）：`doRelayCompact` 补 `setActiveSession(sid)`，并带 `compactInfo{before,after}`（用 `estimateTokens`）→ 桌面分隔线显示"上下文已压缩 · 省下 X tokens"。[DiscordRelay.tsx]。状态 ⏳。

### 4. 进游戏/聊天模式上下文不同步 + 本轮不尊重该模式
4. 第 1 项使 game/chat 模式落在桌面活动会话上（桌面立即跟随）。另：relay 跑一轮原**只传 permissionMode**，不传 chat/game/effort → 手机切了游戏模式再提问仍走普通模式。修复：run-turn 从会话读 `permissionMode/chatMode/gameMode/effort` 一并传 `agentSend`（permMode 优先读会话，桌面改的也生效）。[DiscordRelay.tsx]。状态 ⏳。

### 5. ⚠️ 手机生图工具调用报错（缺图片供应商上下文）
5. **根因**：桌面 runTurn 给 `agentSend` 传了 `imageGen: buildImageGenConfig(...)`（generate_image 工具所需），relay 路径漏传 → agent loop 调 generate_image 时无图片供应商上下文 → 工具调用提示词报错。修复：relay 内复制精简版 `buildRelayImageGen()`（列出所有图片供应商 + providers 池），run-turn 传 `imageGen`。[DiscordRelay.tsx]。状态 ⏳（**重点：让 AI 生成一张图，确认不再报错且回传**）。

### 6. 数字选择改按钮后，按完按钮下一条消息仍被当数字选择
6. **根因**：`/provider`、`/mode` 先登记 `pendingInput`（数字回退），点按钮走 callback 路径未清除它 → 下一条普通消息被误当数字选择。修复：`callback_query:data` 处理器在 `runPending` 前 `pendingInput.delete(chatId)`（需后续参数的会自行重新登记）。[telegram-adapter.ts](src/main/relay/telegram-adapter.ts)。状态 ⏳。

### 缓存前缀影响
无（均为 relay 命令路由 / 渲染层 store 操作 / 会话绑定；imageGen 与 compact 的 chatSend 均为独立调用，不改主对话历史拼接前缀）。

### 待测重点（本批 6 项）
① 手机切模型 → **桌面顶栏跟着变**；② /compact → **桌面出现"上下文已压缩"分隔线**；③ /game /chat → **桌面模式跟随且本轮真的按该模式跑**；④ /mode 仍同步角标；⑤ **让 AI 生成一张图**（不报工具错 + 回传手机）；⑥ /provider 点完按钮后**再发普通消息不被当数字**。注意：手机默认操作现在落在**桌面当前打开的会话**上（需要独立会话用 /session new）。

## 2026-06-27 — Relay 修复批次2（compact真触发/项目切换/UI同步/图片回传/命令补全/按钮菜单）

> typecheck + build 🔧 通过；relay-gateway.js 51.02 kB。运行时项 ⏳ 待实测。

### 1. /compact 真实触发（原来是假的）
1. 新增 relay 命令类 `ui`（chat/game/agent/compact）；`/compact` 走 `bridge.uiOp` → 渲染层 `doRelayCompact`：拼对话轨迹 → `api.chatSend` 生成摘要 → `compactSession(sid, summary)` 真正用摘要替换历史（与桌面 doCompact 同源，精简版无 PreCompact hook）。读 `res.text`。[DiscordRelay.tsx](src/renderer/src/components/discord/DiscordRelay.tsx)。状态 ⏳。

### 2. ⚠️ 项目切换/新建点了无效（两个根因）
2. **根因A**：`relay:openProject` 监听原在 `DiscordRelay`，但它**只在已打开项目时挂载**，冷启动/欢迎页收不到事件。改为装在 **App.tsx 顶层**（始终挂载）。
3. **根因B**：`requestProject` 对未信任项目只挂起等桌面确认框（手机看不到）。新增 `openProjectTrusted`（直接信任并打开，手机端已授权）。[app-store.ts](src/renderer/src/stores/app-store.ts)/[App.tsx](src/renderer/src/App.tsx)。
4. **菜单回调路由 bug**：项目菜单 value（recent/new/drive/here/open:）原走 `proj:` 分支不命中 → 改为正则识别直接 `handleProjectPick`。[telegram-adapter.ts](src/main/relay/telegram-adapter.ts)。状态 ⏳（**重点：最近项目切换、新建逐级选目录、冷启动从欢迎页切项目**）。

### 3. 计划模式（权限模式）切换后桌面 UI 不同步
5. **根因**：`/mode` 只改组件内 `permModeRefs`，从不写 store；桌面 UI 只读 `activeSession.permissionMode`。修复：`onDiscordModeOp` 改后调 `ensureTarget` + `setSessionPermissionMode` + `setActiveSession`，桌面下拉/盾牌/plan 角标实时跟随。[DiscordRelay.tsx]。状态 ⏳。

### 4. /chat /game /agent 补全
6. 新增三命令经 `ui` 路由 → 渲染层调 `setSessionChatMode`/`setSessionGameMode` 作用于目标会话并 setActive，桌面同步。[telegram-adapter.ts]/[DiscordRelay.tsx]。状态 ⏳。

### 5. provider/mode 做成按钮 + 分页
7. `providerOp`/`modeOp` 返回 `menu`（按钮）而非纯文本。provider 列表**每页 8 个、上一页/下一页按钮**；点供应商→弹该供应商**模型按钮菜单**→点模型切换。mode 4 个按钮。仍保留数字回复 fallback。[DiscordRelay.tsx]/[relay-core.ts]。
8. **callback_data 64 字节上限**：长路径/值用短 id `#n` 间接（`shortVal`/`resolveVal` + `menuValues` 映射），否则深目录按钮静默失败。菜单 emit 带 replyTo → 编辑占位消息为按钮（不留"处理中"残留）。[telegram-adapter.ts]。状态 ⏳。

### 6. ⚠️ AI 生成图片没回传手机
9. **根因**：收集图片读错字段——生图路径埋在 **tool 消息 `toolCall.output` 的 `GENERATED_IMAGE_PATHS:[...]` 标记**里（非 `toolCall.images`，那个字段实际从不填充）。修复：用同款正则 `parsePaths(tc.output)` 解析 + 兼容 `tc.images`。
10. **时机**：agentSend 返回后立刻读 store 有竞态（done 快照异步落库）→ 收集前 `await 250ms`。[DiscordRelay.tsx]。状态 ⏳（**重点：让 AI 生成一张图，看是否回传手机**）。

### 缓存前缀影响
无（均为 relay 命令路由/渲染层 store 操作；compact 的 chatSend 是独立一次性调用，不影响主对话历史拼接）。

### Discord 侧
ui/按钮菜单/分页/项目切换为 Telegram 专属；Discord 仍享权限同步修复（如果走 relay 一轮）。

**待测重点**：① /compact 真压缩（token 降）；② 项目切换/新建/冷启动切项目；③ /mode plan 后桌面角标同步；④ /chat /game /agent；⑤ provider 按钮+分页+选模型；⑥ AI 生图回传手机。

---

## 2026-06-27 — Relay 大重构（bug 修复 + 命令菜单化 + 项目切换 + 图片互传）

> typecheck + build 🔧 通过；relay-gateway.js 48.70 kB。运行时项 ⏳ 待实测。

### A. 三个确定 bug 修复
1. **审批卡手机批准后桌面不消失**：`requestApproval.finish` 新增广播 `agent:tool-approval-resolved`；preload `onAgentToolApprovalResolved` + ChatView 监听按 callId 撤桌面审批卡（照 followup-resolved 样板）。[ipc-handlers.ts](src/main/ipc-handlers.ts)/[ChatView.tsx](src/renderer/src/components/chat/ChatView.tsx)。状态 ⏳。
2. **工具调用/todo 实时更新看不到**：根因是 Telegram `editMessageText` 限速（~1次/秒/消息），快速工具调用的连续编辑被 429 吞掉。改为 **去抖合并 flush**（累积内容、最多每 1.5s 编辑一次、去重防 "not modified"），工具行与 todo 块分别累积。最终答到达时 `endProgress` 定格。[telegram-adapter.ts](src/main/relay/telegram-adapter.ts)。状态 ⏳（**重点：工具/todo 能持续可见**）。
3. **无 Telegram 推送通知**：根因是上版最终答用 editMessageText 编辑占位（编辑不触发通知）。本版最终答改为**新发消息**（sendMessage 默认通知），通知恢复。状态 ⏳。

### B. 去掉 /ask
4. 删除 `/ask` 命令（直接发消息即提问）。[telegram-adapter.ts]。状态 ⏳。

### C. 所有命令菜单化（不再接内容）
5. 命令一律不接参数：需要选择的弹 **inline keyboard 菜单**（点按钮），需要文本的**提示回复**（force_reply 后发一条），需要数字的（provider/mode）列出后**直接回数字**。新增统一 `showMenu`/`askParam`/`runPending` + `pendingInput` 状态机 + `cmd:` 回调路由。涉及 /session /file /git /run /search /provider /mode。状态 ⏳（**重点：每个命令裸发都能走完交互**）。

### D. 补全映射命令
6. 已映射：/mode /plan /provider /project /session /clear /compact /file /git /run /search /status /stop /init /explain /fix /test /review /commit。`setMyCommands` 同步。状态 ⏳。

### E. /project 切换项目（最近 + 新建逐级选目录）
7. 协议加 `project` 命令类；RelayCore.bridge.projectOp（主进程 `handleRelayProjectOp`）：list=最近项目+新建菜单；listDrives=枚举盘符(existsSync C..Z)+home；listDir=`readdir` 子文件夹+上级+「在此新建/直接打开」；open/create→`mkdir`+广播 `relay:openProject`→渲染层 `requestProject` 切项目并同步主进程 cwd。新增 `menu` emit 类型（网关渲染按钮）。[ipc-handlers.ts]/[relay-core.ts]/[protocol.ts]/[DiscordRelay.tsx]。状态 ⏳（**重点：逐级选目录、新建、最近项目切换、切换后桌面同步**）。

### F. 图片/文件互传
8. **手机→AI**：`message:photo`/`message:document` → `downloadFile`(https 下载到 tmp) → 作为带 `images` 的 ask（vision）/文件路径引用。命令/协议/runTurn/agentSend 串 `images` 字段；agent-loop 既有 `m.images` vision 链路直接复用。状态 ⏳。
9. **AI→手机**：runTurn 返回本轮 `toolCall.images`（generate_image 等产物）→ RelayCore 发 `image` emit → 网关 `sendPhoto`。新增 `image`/`document` emit 类型。状态 ⏳。

### G. 配置「链接」改标签页
10. `LinksSettings` 改为顶部 tab 切换 Telegram/Discord（仿 MCP 页下划线 tab），一次只显示一个，Telegram tab 带「推荐」徽章。[ConfigPanel.tsx](src/renderer/src/components/config/ConfigPanel.tsx)。状态 ⏳。

### H. 引导文本修正
11. 改为「在浏览器搜索 telegram botfather / telegram userinfobot」（进入后操作）；命令速览同步菜单化说明 + 图片互传提示。[TelegramSettings.tsx](src/renderer/src/components/config/TelegramSettings.tsx)。状态 ⏳。

### 缓存前缀影响
无（relay 命令路由/出站；图片走 messages[*].images 既有 vision 路径，apiMessages 拼接逻辑未变；审批 resolved 仅旁路事件）。

### Discord 侧
菜单化/项目切换/图片互传为 Telegram 专属；Discord 仅享审批 resolved 修复（桌面卡撤销）与既有命令。

**待测重点**：① 审批手机批准→桌面卡消失；② 工具/todo 持续可见；③ 通知到达；④ 命令裸发走菜单/回复；⑤ /project 逐级选目录+新建+最近+桌面同步；⑥ 手机发图 AI 能看、AI 生图回传手机；⑦ 链接标签页；⑧ 引导文本。

---

## 2026-06-27 — Relay 大批便利性 + 审批回归 + 计划卡修复（11 项）

> typecheck + build 🔧 通过；relay-gateway.js 39.62 kB。下列运行时项均 ⏳ 待实测。

### 1. 工具消息合并 + 顺序修复 [telegram-adapter.ts](src/main/relay/telegram-adapter.ts)
1. ask 一轮的"🤖 思考中"占位升级为**进度消息**：工具调用累积编辑进这一条（保留最近 12 行，不刷屏）；**最终答作为新消息发在其后**（顺序变为进度在前、答案在后，修复原先答案替换占位、工具消息反在后的问题）。`activeProgress` per chatId 跟踪。状态 ⏳。

### 2. /provider /mode 列出后直接回数字切换 [telegram-adapter.ts] + [DiscordRelay.tsx](src/renderer/src/components/discord/DiscordRelay.tsx)
2. `pendingChoice` per chat：`/provider` 或 `/mode` 无参列出后，下一条直接回数字（provider 支持 `2`/`2.3`，mode 支持 `1-4` 或名称）即切换，免再打斜杠。状态 ⏳。

### 3. 断线心跳 + 自动重连 [telegram-adapter.ts]
3. 保存 token/config；30s 心跳 `getMe` 探活，失败标 error 并 5s 去抖重连；`bot.catch`/start 失败也触发重连。电脑端经 `relay:statusChange` 实时反映断线/重连。`wantConnected` 防 disconnect 后误重连。状态 ⏳（**重点实测：手机断网后电脑端能自动转 error→重连→online**）。

### 4. 映射更多桌面命令到 Telegram [telegram-adapter.ts]
4. 新增 `/mode /plan /clear /compact` + prompt 类 `/init /explain /fix /test /review /commit`（模板与桌面 slash-commands 对齐）。`setMyCommands` 同步全量命令 → 输入框 `/` 自动补全。状态 ⏳。

### 5. 去掉 /help /commands [telegram-adapter.ts]
5. 既然能自动补全，删除 `/help`、`/commands` 及其静态文本。状态 ⏳。

### 6. ⚠️ 审批卡回归（不再全放行）[ipc-handlers.ts](src/main/ipc-handlers.ts) + [DiscordRelay.tsx]
6. **`requestApproval` 改为双通道**（照搬 followup 样板）：远程一轮的审批也转成「✅批准/❌拒绝」按钮卡发到手机，与桌面双通道、任一先答即采用，finish 时 `cancelPrompt` 撤远程卡。新增 `approvalSummary()` 一行式摘要（工具+文件/命令）。状态 ⏳。
7. **手机那轮不再写死 bypassPermissions**：改用 `permModeRefs[source]`（默认 default → 审批卡转手机）。状态 ⏳。
8. **手机 /mode 切权限**：协议加 `mode` 命令类；RelayCore.bridge.modeOp → `discord:mode-op` → 渲染层改 `permModeRefs[source]`（default/acceptEdits/bypassPermissions/plan，接受别名 ask/auto/yolo）。状态 ⏳（**重点实测：default 下手机收到审批卡可批准/拒绝；/mode yolo 后全放行**）。

### 7. 计划卡 Telegram markdown 修复 [telegram-adapter.ts]
9. `runPrompt` 发计划卡原用裸 `sendMessage`（无 parse_mode）→ markdown 丢失。改为 `mdToHtml` 渲染 + HTML parse_mode（失败回落纯文本）。状态 ⏳。

### 8. 计划卡桌面输入框卡顿优化（保效果）[ChatView.tsx](src/renderer/src/components/chat/ChatView.tsx)
10. **根因**：计划卡 `<Markdown>{plan}</Markdown>` 与 FollowupCard 同级无 memo 边界，followup 输入框每敲一字 → ChatView 顶层 state（followupAnswers）变 → 整段计划 markdown 全量解析+Prism 高亮重渲染。**新增 `PlanMarkdown` memo 组件**（仅 plan 文本变化才重渲染），切断重渲染链。**完整保留 markdown 效果，未砍内容**。状态 ⏳（**重点实测：长计划卡下输入框打字流畅；计划渲染效果不变**）。

### 9. 配置菜单合并 [ConfigPanel.tsx](src/renderer/src/components/config/ConfigPanel.tsx)
11. Discord + Telegram 两分区合并为单一「链接」分区（Send 图标）；新增 `LinksSettings`：Telegram 在前 + "推荐"标签 + 体验说明，Discord 在后（分隔线）。`config-transfer.ts` 的独立 discord id 不受影响。状态 ⏳。

### 10. Telegram 引导文本优化 [TelegramSettings.tsx](src/renderer/src/components/config/TelegramSettings.tsx)
12. 步骤改为"在 Telegram 里搜索 botfather / userinfobot"（不再开浏览器）；**新增一步**：搜索你创建的 bot username、点开并开启聊天。命令速览同步更新（含 /mode /provider 回数字、prompt 命令）。状态 ⏳。

### 11. 工具调用提示（上一批已加，本批合并进进度条）
13. agent-loop `agent:tool-call` 事件（name+target）经 relay:push 推送，现累积进 Telegram 进度消息。状态 ⏳。

### 缓存前缀影响
无（agent-loop 仅新增 `agent:tool-call` 旁路事件；relay 命令路由/出站格式化不进消息历史；权限模式只改 agentReq.permissionMode 字段，不动消息拼接）。

### Discord 侧说明
- Discord adapter 也加了 `/provider`，但"回数字切换"和"工具进度合并"是 Telegram 专属（Discord 交互模型不同）；Discord 的 progress 推送仍静默丢弃（pre-existing，不退化）。审批双通道 Discord 同样生效。

**待测重点**：① 工具进度合并+答案在后；② /provider /mode 回数字切换；③ 手机断网→电脑自动重连；④ 全部新命令+补全；⑤ **审批卡回到手机、default 下可批/拒，/mode 切权限生效**；⑥ 计划卡手机 markdown 正常；⑦ **长计划卡桌面输入框不卡**；⑧ 「链接」菜单 Telegram 在前；⑨ 引导文本。

---

## 2026-06-27 — Relay 便利性改动（自动连接 + 工具调用提示 + /provider /help + 命令补全 + 提问卡输入修复）

> 6 项便利性改进，覆盖启动自动连接、远程工具调用可见、新命令、Telegram 命令补全、修复提问卡误判 BUSY。

### 1. 启动自动连接 [relay-core.ts](src/main/relay/relay-core.ts)
1. `autoConnectAll` 改为：凡配置了 token 的平台都自动尝试连接（去掉 autoConnect 开关依赖，Discord 仍需 applicationId）。失败不抛、不提示。状态 ⏳。

### 2. 远程工具调用提示 [agent-loop.ts](src/main/agent-loop.ts) + [DiscordRelay.tsx](src/renderer/src/components/discord/DiscordRelay.tsx)
2. agent-loop 主循环 `addTool` 处新增轻量 `agent:tool-call` 事件（name + `toolCallTarget()` 提取的相关文件/命令）。**桌面 UI 走 agent:turn 快照，不依赖此事件**；仅供远程一行式提示。状态 ⏳。
3. 渲染层 relay 订阅 `onAgentToolCall`，活跃 relay 一轮命中时经 `relay:push` 推「🔧 工具名 · 相关文件」到平台。状态 ⏳（注意：工具密集轮会刷屏，先观察体验）。

### 3. 新命令 /provider（列出+切换供应商与模型）
4. 协议 `RelayCommand.kind` 加 `"provider"`；RelayCore.bridge 加 `providerOp`，经 `discord:provider-op` 往返渲染层。[protocol.ts](src/main/relay/protocol.ts)/[relay-core.ts](src/main/relay/relay-core.ts)/[ipc-handlers.ts](src/main/ipc-handlers.ts)。状态 ⏳。
5. 渲染层 [DiscordRelay.tsx](src/renderer/src/components/discord/DiscordRelay.tsx) 实现：`list` 列出供应商+模型（▶=当前 ✅=当前模型 含「无 Key」标记）；`switch` 接受 `2`（供应商）或 `2.3`（供应商.模型），调 `setSelectedProviderId/setSelectedModel`。状态 ⏳。
6. Telegram `/provider`（无参列出/有参切换）+ Discord `/provider [target]`。状态 ⏳。

### 4. /help + Telegram 命令补全 [telegram-adapter.ts](src/main/relay/telegram-adapter.ts)
7. `/help`、`/commands` 本地静态列出全部命令（HTML，失败回落纯文本），无需回主进程。状态 ⏳。
8. 连接时 `setMyCommands(BOT_COMMANDS)` → Telegram 输入框打 `/` 自动补全提示。状态 ⏳。

### 5. ⚠️ 提问卡自由输入修复（重点）[telegram-adapter.ts](src/main/relay/telegram-adapter.ts) + 协议
9. **根因**：带选项的提问卡（choice 模式）只发了 inline keyboard、没登记 `awaitingText`，用户打字被当成**新 /ask** → 但会话仍在等 followup（runningLoops 占用）→ 主进程返回 **BUSY**。
10. 协议 `RelayPrompt` 加 `allowText`：问题卡=true（可打字），计划/审批卡（带 plan）=false。ipc-handlers `askPrompt` 传 `allowText:!fReq.plan`。状态 ⏳。
11. Telegram choice 模式：`allowText` 时也登记 `awaitingText`（打字即作答复，不触发 BUSY）+ 提示「点按钮或直接回复文字」；受限卡仅按钮、打字不作答（符合桌面端「计划/dashboard 卡不接受自由输入」语义）。状态 ⏳（**重点实测：带选项的提问卡在 Telegram 打字应被采纳、不再 BUSY；计划卡打字应不作答**）。

### 6. 🔧 验证
12. typecheck + build 通过；`out/main/relay-gateway.js` 32.56 kB 正常产出。

### 缓存前缀影响
无（均为 relay 出站/命令路由层，唯一碰主流程的是 agent-loop 新增 `agent:tool-call` 事件——纯额外 `webContents.send`，不进消息历史、不改 apiMessages 拼接）。

---

## 2026-06-27 — Telegram 实测修复（斜杠命令 + 富文本排版）

> 首次实测反馈：直接发消息提问已通；斜杠命令无效；排版混乱（Markdown 符号裸露）。

### Telegram adapter [telegram-adapter.ts](src/main/relay/telegram-adapter.ts)
1. **斜杠命令失效修复**（确定 bug）：`message:text` 处理器注册在 `command` 之前，对 `/` 开头消息裸 `return`，导致 grammy 中间件链断裂、下游 command 处理器永远收不到。改为 `await next()` 放行。状态 ⏳（实测 /file /git /run /session /status /stop）。
2. **富文本排版**：发送/编辑结果消息原先无 `parse_mode`，AI 回复里的 `**粗体**`/`` `代码` ``/`# 标题`/列表全裸露。新增 `mdToHtml()` 轻量 Markdown→HTML（粗体/斜体/删除线/行内码/代码块/链接/标题/`-•`列表），用 **HTML parse_mode**（只需转义 `< > &`，比 MarkdownV2 对 AI 自由文本稳妥）。`sendRich`/`editRich` **HTML 失败自动回落纯文本**，保证消息一定发出，不再卡"思考中"。状态 ⏳。
3. `InputFile` 改为顶部 import（原 `require("grammy")` 内联）；新增 `editPlain` 用于"已选择/已回答"等固定短句。
4. 🔧 typecheck + build 通过；`out/main/relay-gateway.js` 29.66 kB 正常产出。

### 已知未做（待确认需求）
- **图片**：你→AI 发图（message:photo→vision）与 AI→你发图（sendPhoto）均未实现，需扩 relay 协议 emit 支持图片，建议作为独立任务。
- **日志可见性**：网关在 utilityProcess，`stdio:"pipe"` 转发到主进程 console；打包后无可见终端。可加"relay 日志落文件"开关（待定）。

### 缓存前缀影响
无（仅 Telegram 出站消息格式化，不涉及发往 LLM 的消息拼接）。

---

## 2026-06-27 — 界面 i18n（中英可切换）+ 3 个交互 bug 修复

> 仅界面语言切换，不影响发给模型的内容。i18n 工具 [i18n.ts](src/renderer/src/lib/i18n.ts)：`useT()`→`t(zh,en)`（组件内，响应式）/`tr(zh,en)`（组件外/事件回调，非响应式）/`useLangStore`。设置面板新增「界面语言」中/英切换卡片。语言存 localStorage。

### i18n 基建与切换
1. **新建** [i18n.ts](src/renderer/src/lib/i18n.ts)，ConfigPanel「设置」页加语言切换卡片。状态 🔧（typecheck 通过）。

### 关键修复：模块级 `tr()` 冻结导致切语言不更新
> 根因：模块级常量数组里调用 `tr()` 只在 import 时求值一次，切语言后不刷新。改为存 zh/en 双字段、在渲染时用 `t()` 取值。涉及：
2. **PERM_MODES**（输入框权限下拉）[ChatView.tsx](src/renderer/src/components/chat/ChatView.tsx)、**MODES**（权限设置介绍）[PermissionsSettings.tsx](src/renderer/src/components/config/PermissionsSettings.tsx)、**HOOK_EVENTS**（Hooks 介绍）/**FONT_CHOICES**（字体名）[ConfigPanel.tsx](src/renderer/src/components/config/ConfigPanel.tsx)、**SEARCH_BACKENDS**（网络搜索供应商介绍）[search-store.ts](src/renderer/src/stores/search-store.ts)、**TRANSFER_SECTIONS** [config-transfer.ts](src/renderer/src/lib/config-transfer.ts)、**CATALOG**（MCP 目录）[McpMarketplace.tsx](src/renderer/src/components/config/McpMarketplace.tsx)、**TYPE_META**（记忆类型）[MemorySettings.tsx](src/renderer/src/components/config/MemorySettings.tsx)、**EFFORT_OPTIONS**（推理强度）[SlashPalette.tsx](src/renderer/src/components/chat/SlashPalette.tsx)。状态 ⏳（需实测切语言后这些文案即时更新）。

### 硬编码英文导航标签补中文
3. **TabBar**（对话/终端/分析/设置）[TabBar.tsx](src/renderer/src/components/layout/TabBar.tsx)、**Sidebar**（文件/Git）[Sidebar.tsx](src/renderer/src/components/layout/Sidebar.tsx)、**configSections**（API 供应商/MCP 服务器/权限）[ConfigPanel.tsx](src/renderer/src/components/config/ConfigPanel.tsx)。状态 ⏳。

### 交互 bug 修复（与 i18n 无关）
4. **预览窗口拖到顶部冲突**：面板加 `titlebar-no-drag`，不再被主窗口标题栏拖拽区抢占 [ArtifactPanel.tsx](src/renderer/src/components/chat/ArtifactPanel.tsx)。状态 ⏳。
5. **预览窗口 resize**：补齐右边/四角手柄；重写几何为统一 left/top 锚点，修正左右方向相反 [ArtifactPanel.tsx](src/renderer/src/components/chat/ArtifactPanel.tsx)。状态 ⏳。
6. **终止按钮**：不再清空排队消息，改为停掉当前轮后把队列消息发给 AI（延迟 120ms drain，避开正在关闭的 loop）[ChatView.tsx](src/renderer/src/components/chat/ChatView.tsx)。状态 ⏳。缓存影响：不涉及发往模型的稳定前缀。

> 缓存说明：以上均为界面层改动，未触碰发往 LLM 的 system 提示 / 工具定义 / 历史消息拼接，**不影响 prompt 缓存前缀**。
> 已知遗留（非本次翻译引入）：ConfigPanel.tsx:278 你恢复的 `SkillMarket` 处 `projectPath: string|null` 与 prop `string|undefined` 类型不匹配，typecheck 报错，未经你同意未改。

## 2026-06-27 — 统一远程控制框架（Discord 重构 + 新增 Telegram，网关进程隔离）

> 目标：根治 Discord「应用未响应」（3 秒 ACK 超时），统一两平台卡片投递，并接入 Telegram。
> 方案二：bot 网关移出主进程到 utilityProcess；统一 relay 协议替代散点 IPC。全放行（沿用 bypassPermissions，手机端不审批工具）。

### 新增：统一 Relay 协议与网关 [src/main/relay/](src/main/relay/)
1. **协议契约** [protocol.ts](src/main/relay/protocol.ts)：进程无关的三类消息 command/prompt+answer/emit + 控制类 connect/disconnect/status/ready。Discord/Telegram 都翻译到这套中立结构。状态 🔧（typecheck+build 通过）。
2. **网关子进程** [gateway.ts](src/main/relay/gateway.ts)：跑在 **utilityProcess**，只做「平台事件↔协议」翻译，不持有任何业务（provider/tool/git）。经 `process.parentPort` 与主进程收发。状态 ⏳（需实测 fork 连通）。
3. **adapter 契约** [adapter.ts](src/main/relay/adapter.ts)：connect/disconnect/prompt/cancelPrompt/emit。
4. **构建多入口** [electron.vite.config.ts](electron.vite.config.ts)：main 改为 `{ index, relay-gateway }` 双入口，`entryFileNames:[name].js`。🔧 验证：`out/main/relay-gateway.js`（27.68 kB）独立产出，grammy/discord.js 作 require external 未打进包；index.js 正确引用 relay-gateway.js。

### 新增：主进程 RelayCore [relay-core.ts](src/main/relay/relay-core.ts)
5. fork/监管网关子进程；管配置（`codeweaver-relay.json`）与 token（SecretsManager，**Discord 沿用旧 key `__discord_bot_token__` 平滑复用**，Telegram 用 `__telegram_bot_token__`）。状态 ⏳。
6. 状态广播 `relay:statusChange`；命令路由到 bridge；prompt 往返（promptId 关联）；子进程退出兜底（标离线 + 清挂起 prompt）。状态 ⏳。

### 新增：两平台 adapter
7. **Discord** [discord-adapter.ts](src/main/relay/discord-adapter.ts)：迁入旧 discord-bot-manager 的斜杠命令 + followup 双通道（按钮/Modal），行为对齐现状。仅 Guilds intent。状态 ⏳（需实测不退化）。
8. **Telegram** [telegram-adapter.ts](src/main/relay/telegram-adapter.ts)：grammy long polling。**私聊直接发消息=提问**（无需 /ask）；选项→inline keyboard，自由文本→forceReply（省掉 Discord 的按钮→Modal 两段式）；超长→sendDocument。状态 ⏳。
9. **工具执行** [relay-tools.ts](src/main/relay/relay-tools.ts)：file/git/run/search/status 从旧 manager 抽出，输出格式保持一致。状态 ⏳。

### ⚠️ 触及桌面/relay 共享路径 [ipc-handlers.ts](src/main/ipc-handlers.ts)
10. **followup 桥泛化**（**风险项**）：`requestFollowup` 内新增 relay 双通道分支（relaySource+relayChannelId），`finish` 时撤回远程卡。**桌面端的 `webContents.send("agent:followup-request"/"agent:followup-resolved")` 两行字节未动**；无 relay 时行为与原状完全一致。验收基线：桌面端提问卡弹出/撤销正常。状态 ⏳（**需重点实测桌面提问卡未退化**）。
11. 新增 `relay:*` IPC（getConfig/saveConfig/connect/disconnect/status/push）+ relayBridge（runTurn/sessionOp 经渲染层往返带 relaySource；runTool 走 relay-tools）。旧 `discord:*` 路径与 discord-bot-manager **保留未删**。状态 ⏳。

### 渲染层 [DiscordRelay.tsx](src/renderer/src/components/discord/DiscordRelay.tsx)
12. **每来源独立目标会话**：`targetRef` → `targetRefs[source]`，Discord/Telegram 互不串台。状态 ⏳。
13. **todos/error 只读推送**：`activeRunRef` 跟踪活跃 relay 一轮，onAgentTodos/onAgentError 命中时经 `relay:push` 同步到对应平台频道；桌面端自有会话不受影响。状态 ⏳。

### 配置 UI
14. 新增 [TelegramSettings.tsx](src/renderer/src/components/config/TelegramSettings.tsx)（仅 Token + 可选 User ID）+ 挂进 [ConfigPanel.tsx](src/renderer/src/components/config/ConfigPanel.tsx)（新 `telegram` 分区，Send 图标）。DiscordSettings **未改**（先新增不重构）。状态 ⏳。

### 生命周期 [index.ts](src/main/index.ts)
15. `before-quit` 新增 `__relayCore.shutdown()` 杀网关子进程。状态 ⏳。

### 缓存前缀影响
**无破坏**：runTurn 内 apiMessages 构建逻辑未改（仍 user/assistant 文本），relaySource/relayChannelId 仅作路由标记不进消息历史。followup 改动不触碰发往 LLM 的消息拼接。

### 依赖
- 新增 `grammy`（npm，8 个包）。

**待测重点**：① Discord 连接/`/ask`/followup 按钮+文字/`/file /git /run`/`/stop` 全链路不退化；② **桌面端提问卡弹出与撤销正常（共享 followup 桥未退化）**；③ Telegram 连接、直接发消息提问、inline keyboard 选项、forceReply 文字答复、斜杠命令；④ 两平台并存不串台；⑤ utilityProcess 隔离后 Discord 不再「应用未响应」；⑥ 退出时网关子进程被清理（任务管理器无残留）。

---

## 2026-06-26 — 关闭按钮退后台（系统托盘常驻）

### 主进程窗口/托盘 [index.ts](src/main/index.ts)
1. **关闭按钮改为退到后台**：新增 `isQuitting` 标志；`mainWindow.on("close")` 拦截，非退出时 `e.preventDefault()` + `mainWindow.hide()`，保留所有会话/PTY/MCP 进程继续后台运行。状态 ⏳。
2. **新增系统托盘**：`createTray()` 用 `resources/icon.png` 创建 `Tray`，菜单「显示主窗口 / 退出」，左键单击恢复窗口。`showMainWindow()` 处理 restore+show+focus，窗口已销毁则重建。状态 ⏳。
3. **真正退出路径**：托盘「退出」与 `before-quit` 置 `isQuitting=true` 放行 close；`window-all-closed` 改为仅在 `isQuitting` 时才 `app.quit()`（否则托盘常驻、应用不退出）。状态 ⏳。
4. 🔧 typecheck：`tsconfig.node.json` 通过（仅遗留无关报错 skills-market.ts，非本次改动）。
5. **关闭渲染进程后台节流** `backgroundThrottling:false`：窗口 hide 后 Chromium 默认把渲染进程定时器降到 1Hz；agent 循环在主进程不受影响，但渲染层流式 UI/计时不应被拖慢。状态 ⏳。

**后台运行能力（已确认架构）**：AI 对话循环 [agent-loop.ts](src/main/agent-loop.ts) 跑在**主进程**，由 IPC `agent:send` 触发，网络/流式/工具调用/子 agent/MCP 全在主进程；`hide()` 不销毁 webContents，故退后台后对话继续跑、Discord 照常、结果暂存恢复后显示。**限制**：default 权限模式下工具审批卡片在隐藏窗口时看不到，该轮会卡在等待审批（bypassPermissions/acceptEdits 与 Discord 不受影响）。

**待测**：① 点关闭按钮窗口消失、托盘图标在、应用未退出（任务管理器仍有进程）；② 托盘左键/「显示主窗口」能恢复；③ 托盘「退出」能真正退出、子进程清理；④ 退后台期间 Agent/MCP/Discord 仍在后台工作。

### 缓存前缀影响
无（仅主进程窗口生命周期，不涉及发往 LLM 的消息拼接）。

---

## 2026-06-26 — 任务清单细节优化（4 项）+ 斜杠清空修复 + MCP「广告」真相

### 任务清单 [ChatView.tsx](src/renderer/src/components/chat/ChatView.tsx) + [globals.css](src/renderer/src/styles/globals.css) + [checklist-manager.ts](src/main/checklist-manager.ts)
1. **去掉下拉顶部「任务清单 · 项目级」标题栏**（整行删除，更简洁）。
2. **完成动画加快**：CSS `cw-checklist-done` 0.9s→0.5s，落库延时 900ms→520ms 同步。
3. **状态变化位移动画（FLIP）**：done 沉底导致条目重排，原来直接跳变、整列表瞬间打乱。新增 `useLayoutEffect` FLIP：记录每条上一次 `offsetTop`，重排后用 transform 从旧位置反向位移再清零，滑动到位（0.32s ease-out）。
4. **done 保留期 3 天→1 天**：`DONE_TTL_MS` 改 1 天（注释/撤回提示同步）。

### 斜杠命令「浏览模式」不再清空输入 [ChatView.tsx](src/renderer/src/components/chat/ChatView.tsx)
- 上次加的「输入框有字 → 浏览模式列全部命令」有副作用：选中命令仍走 `runSlashCommand` → `updateInput("")` 把用户文字清掉。
- 新增 `slashBrowse` 标志：浏览模式下选命令**保留已输入文字**——有参命令把 `/cmd ` 前置到原文字前供用户继续编辑；动作类命令经新 `runSlashCommandKeepInput` 执行但不动输入框。任何文本变更（`updateInput`）自动退出浏览模式。

### MCP「四个固定广告」真相 [McpMarketplace.tsx](src/renderer/src/components/config/McpMarketplace.tsx)
- 排查：用 curl 直查官方注册表，`?search=postgres` **只返回 postgres 服务器、无广告**；但**空查询**返回的是**按字母序的前 30 条**——`ac.inference.sh` / `ai.adadvisor` / `ai.agentic-news` / `ai.agenticshelf` 恰好排最前，被误认为「固定广告」。它们不是广告，是字母序靠前 + 之前「切到 tab 就空查询自动加载」造成的。
- 修复：**移除空查询自动加载**；`runRegistrySearch` 空查询直接清空不请求；新增 `regSearched` 区分「未搜索」（提示"输入关键词搜索"）与「搜了无结果」。有查询时仍做客户端关键词相关性过滤兜底。

### Provider responses 协议图片后缀（用户疑问的确认）
- responses 协议**确实应有** `/v1/images/generations` 选项——图片生成走标准 images 端点，与聊天协议(responses/anthropic/openai)正交。当前逻辑：images + raw 对全部协议可选，chat 仅 OpenAI 兼容。无需改动，符合预期。

### 缓存前缀影响
无（纯渲染层 UI/交互 + checklist TTL 常量；不涉及发往 LLM 的消息拼接）。

### 状态
- 🔧 typecheck（web+node）通过；已 `electron-vite build` 重建 `out/`，新产物 `index-BZAkS6vS.js` 验证含：无「项目级」、MCP 空态提示、slashBrowse 逻辑。
- ⏳ 等待实测（重开软件）：
  1. 任务清单下拉无顶部标题栏；完成动画更快；点完成/撤回时条目滑动重排（不跳变）。
  2. done 项 1 天后消失。
  3. 输入框打字后点斜杠按钮 → 选命令**不清空**已输入文字（有参命令前置 `/cmd `，模式命令只切模式）。
  4. MCP 在线市场：刚进 tab 不再自动列出 inference.sh 等 4 项，显示"输入关键词搜索"；搜索后才出结果。

## 2026-06-26 — 自定义余额脚本支持 {{apiKey}} 占位符

- **模块**：[ipc-handlers.ts](src/main/ipc-handlers.ts)（`executeCustomBalanceScript` 的占位符替换）+ [ProviderSettings.tsx](src/renderer/src/components/config/ProviderSettings.tsx)（脚本说明文案）。
- **改了什么**：以前自定义余额脚本只替换 url 里的 `{{baseUrl}}`，headers/body 里的 `{{apiKey}}` 从不替换，导致用户写 `Authorization: Bearer {{apiKey}}` 时实际发出字面量 → 接口 401 → 状态码非 2xx → 余额不显示。现在新增 `subst()`，对 url / headers(string 值) / body(string) 统一替换 `{{baseUrl}}` 和 `{{apiKey}}`（apiKey 取 renderer 传入的 `balanceKey`，即独立余额令牌或回退模型 apiKey）。UI 说明同步补充 `{{apiKey}}` 用法。
- **风险/影响**：仅作用于自定义余额脚本路径（`provider:balance` 且配了 `balanceScript`），不影响内置探测 `fetchProviderBalance`，不影响 LLM 消息拼接 / 缓存前缀。注意 `provider-store.ts:208` 仍有 -100~999 区间过滤，余额过大会被判脏数据丢弃。
- **状态**：🔧 typecheck 通过（`tsc --noEmit` 无报错）；运行时「配 {{apiKey}} 脚本→余额正常显示」需用户实测 → ⏳

## 2026-06-26 — Sub-agents「打开项目 agents 目录」按钮不再弹「找不到文件夹」

- **模块**：[ipc-handlers.ts](src/main/ipc-handlers.ts)（新增 `shell:ensureDirAndOpen` IPC：目录不存在先 `mkdir -p` 再 `shell.openPath`）+ [preload/index.ts](src/preload/index.ts) / [preload/index.d.ts](src/preload/index.d.ts)（暴露 `ensureDirAndOpen`）+ [ConfigPanel.tsx](src/renderer/src/components/config/ConfigPanel.tsx)（AgentsSettings 的 `openDir` 改用新 IPC）。
- **改了什么**：`.claude/agents/` 目录按需创建——以前目录不存在时点按钮，系统直接弹「找不到文件夹」。现在点了先确保目录存在再打开。
- **风险/影响**：未碰通用 `openPath`，故 skills / memory 等其它「打开目录」按钮语义不变，仅 agents 这一处改用新 IPC。不影响 LLM 消息拼接 / 缓存前缀。
- **状态**：🔧 typecheck 通过（`tsc --noEmit` 无报错）；运行时「点按钮→自动建目录并打开」需用户实测 → ⏳


## 2026-06-26 — 任务清单 UI 调整（9 项）+ Provider/MCP/斜杠 4 处界面修复

### 关键背景：先修复了一处事故残留
任务清单按钮此前在软件里看不到 = 之前 git stash 事故恢复时，ChatSecondary 内的按钮接线（状态/effect/按钮/面板挂载）丢失，只剩孤立的 `ChecklistPanel` 函数定义，且 `out/` 渲染产物是加 UI 前构建的。本次已补回接线并重建 `out/`。

### 任务清单 [ChatView.tsx](src/renderer/src/components/chat/ChatView.tsx) + [globals.css](src/renderer/src/styles/globals.css)
1. 按钮移到次级栏**最右**（`ml-auto`），下拉改为 `right-0` 右锚定。
2. 移除每项的删除按钮；完成圆圈按钮移到每项**最右**。
3. 已完成文字更灰：`text-muted-foreground/50`，完成动画末态同步改为 `muted-foreground/0.5`（避免颜色跳变）。
4. 移除按钮上的紫色未处理计数角标。
5. 每项**单行**显示（`truncate`），hover 经 `title` 看全文。
6. 已完成项可在 3 天内**再次点击按钮撤回**为 todo（`setStatus` 清掉 completedAt = 重新计时；过期项加载时已被过滤，故能点到的都在 3 天内）。
7. 每项第二行显示**最近更新时间**（新增 `relTime()` 助手：刚刚/分钟前/小时前/月日时分）。

### Provider [ProviderSettings.tsx](src/renderer/src/components/config/ProviderSettings.tsx) + [provider-store.ts](src/renderer/src/stores/provider-store.ts)
8. 图片端点后缀**随协议动态调整**：`/v1/chat/completions` 选项只在 OpenAI 兼容协议下出现；切到 Anthropic/Responses 时隐藏它，并把已存的非法选择自动回落到 `images`。
9. 自定义余额查询新增**独立令牌 / 接口地址**两字段（`balanceToken`/`balanceBaseUrl`）：留空则沿用模型的 apiKey / baseUrl；`refreshBalance` 据此选 key 和 base，`{{baseUrl}}` 替换为余额接口地址。

### MCP 在线市场 [McpMarketplace.tsx](src/renderer/src/components/config/McpMarketplace.tsx)
10. 去掉「前两个固定/广告」：注册表对任意查询都会置顶若干无关热门项，现在**有查询词时做客户端相关性过滤**（名称/标题/描述/作者须命中全部关键词）。布局错乱修复：结果网格加 `auto-rows-fr items-stretch` + 卡片 `h-full`，等高稳定。

### 斜杠命令按钮 [ChatView.tsx](src/renderer/src/components/chat/ChatView.tsx)
11. 修复「输入框已有文字时点斜杠按钮，`/` 粘到文字前变成 `/已有文字` 当命令名匹配 → 搜不到 → 面板出不来」：输入框已有普通文字时改为**浏览模式**直接展示全部命令（`SLASH_COMMANDS`），不改输入文本；空输入仍走原插入 `/` 逻辑。

### 缓存前缀影响
无（纯渲染层 UI + provider 配置字段，不涉及发往 LLM 的消息拼接）。

### 状态
- 🔧 typecheck（web+node）：本次改动文件无新增类型错误；已 `electron-vite build` 重建 `out/`，新产物 `index-BXS7Uj6Y.js` 含任务清单/余额字段/撤回完成。残留 `ConfigPanel.tsx:274`、`skills-market.ts` 为用户既有 WIP、与本次无关。
- ⏳ 等待实测（重开软件加载新 out/）：
  1. 任务清单按钮在最右；下拉项单行、完成按钮在最右、无删除按钮、第二行有时间。
  2. 点完成→绿→灰划掉；已完成项再点圆圈→撤回为待办且时间刷新。
  3. Provider 切 Anthropic 协议→图片后缀不再出现 chat completions；之前选了 chat 会自动回落 images。
  4. 余额查询填独立令牌/地址生效；留空沿用模型 key/base。
  5. MCP 在线市场搜索→无关置顶项消失、卡片等高不再错乱。
  6. 输入框有字时点斜杠按钮→命令面板正常弹出。


## 2026-06-26 — search_files 补齐 grep 完整能力 + 修复斜杠按钮闪烁

### 改动
- **工具定义** [tools.ts](src/main/tools.ts) `search_files`：新增参数 `output_mode`（content/files_with_matches/count）、`case_insensitive`、`multiline`、`context`/`context_before`/`context_after`、`max_results`，并完善 description。
- **工具实现** [tools.ts](src/main/tools.ts) `searchFilesTool`：ripgrep 分支按选项拼 `--files-with-matches`/`--count`/`--before-context`/`--after-context`/`--ignore-case`/`--multiline(-dotall)`/`--glob`；max_results 取代写死的 100；Node 回落分支同步支持三种输出模式、上下文行、大小写、多行整文件匹配（含零宽匹配防死循环）。参数仍全部走数组，不拼 shell。
- **UI** [ChatView.tsx](src/renderer/src/components/chat/ChatView.tsx) 斜杠命令按钮：加 `onMouseDown` + `preventDefault` 阻止 textarea 失焦——原先点按钮会触发 textarea `onBlur` 的 120ms 定时器把刚弹出的面板关掉，造成「一闪而过」；切换关闭分支补 `el.focus()`。

### 风险
- search_files 行为变化面较广（默认行为应与旧版一致：content 模式、cap=100），需实测各模式与上下文行；尤其 Node 回落分支（无 ripgrep 环境）。
- 斜杠按钮交互改动可能影响「再次点击关闭面板」与移动端/触屏的事件顺序。

### 缓存前缀影响
无。仅工具 schema 与实现变化；agent-loop 系统提示未改（仍那句静态工具说明），不影响 prompt 缓存前缀。

### 状态
- 🔧 typecheck 通过（`npx tsc --noEmit` 无报错）。
- ⏳ search_files 各输出模式 / 上下文行 / 大小写 / 多行 / max_results，待用户实测。
- ⏳ 斜杠按钮点击弹出/关闭不再闪烁，待用户实测（尤其输入框已有文字时）。

## 2026-06-26 — 新增「持久任务清单」(checklist)：项目级、跨会话、用户与 AI 共维护

### 背景
需要在「新建对话」次级栏（ChatSecondary）加一个跨会话的项目待办：用户能加条目/点完成，AI 完成一件事后能把它改为「待验证」或新增为「待验证」，初始化/完成任务时读取。刻意命名 **checklist**，与对话内临时路线图 `update_todos`/`TodoItem`（跟 session 走、每轮整列表替换）彻底分开，降低模型混淆。**未并入记忆系统**——清单状态每轮在变，进系统提示稳定前缀会击穿 prompt 缓存（违反 CLAUDE.md 红线），且语义不符。

### 状态机（对齐「AI 不得自标通过」规则）
`todo(待办)` ──AI做完──► `needs_verification(待验证)` ──用户点完成──► `done`；`todo` 也可用户直接点完成。AI 工具**只能**推到 needs_verification，永远不能置 done；done 仅用户在 UI 点击，记 `completedAt`，**3 天后自动消失**。

### 改动
- **主进程** 新建 [checklist-manager.ts](src/main/checklist-manager.ts)：读写 `<项目>/.claude/checklist.json`；`submit` 按文本模糊匹配（互为子串）命中改待验证、否则新增待验证（**不用 id**——用户随时可能加新条目，AI 无从得知 id）；`list` 顺带清理完成超 3 天的项。
- **工具** [tools.ts](src/main/tools.ts) 加 `checklist_read`（开工/完成时读）、`checklist_submit`（做完一件事提交，只能到待验证）。
- **agent-loop** [agent-loop.ts](src/main/agent-loop.ts)：两工具内联处理（同 update_todos，绕过 executeTool）；加进 `EXCLUDE` 集；系统提示加**一句静态协议**（不放清单内容，零缓存风险）；submit 时推 `agent:checklist` 事件让 UI 下拉自动弹开+高亮。
- **IPC/preload** [ipc-handlers.ts](src/main/ipc-handlers.ts) 加 `checklist:list/add/setStatus/edit/remove` + `checklist:changed` 广播；[index.ts](src/preload/index.ts)/[index.d.ts](src/preload/index.d.ts) 暴露 api + `onAgentChecklist`/`onChecklistChanged` + 类型。
- **渲染层** 新建 [checklist-store.ts](src/renderer/src/stores/checklist-store.ts)；[ChatView.tsx](src/renderer/src/components/chat/ChatView.tsx) 在 ChatSecondary 新建按钮右侧加「任务清单」按钮（带未处理计数角标）+ `ChecklistPanel` 下拉小窗（仿历史对话弹层）；监听 `agent:checklist` 高亮+自动弹开。
- **CSS** [globals.css](src/renderer/src/styles/globals.css) 加 `cw-checklist-done`（普通/黄 → 短暂绿 → 灰+划掉+略缩小）与 `cw-checklist-flash`（AI 改动背景轻闪）。

### 缓存前缀影响
无。系统提示只加一句**静态、永不变**的协议说明（进缓存前缀安全）；清单内容**不进前缀**，由 `checklist_read` 工具按需召回。submit 工具结果是普通 tool 消息，只追加到尾部。

### ⚠️ 事故与恢复（需用户留意）
开发中误用 `git stash` 处理 typecheck，连带把用户**未提交的 WIP**（flavor-text/chat-store/chat-store-manager 等多文件）一起 stash，且 pop 因 `out/` 脏文件静默失败。已从悬空 stash commit `df2bc335` 完整恢复全部 `src/` 跟踪文件（含用户 WIP + 本次改动），并校验关键导出（buildFailureNotice/setGenerating/searchAcrossSessions 等）均在。**请用户确认自己之前的未提交改动是否完好。**

### 状态
- 🔧 typecheck：本次新增的 checklist 相关代码**零类型错误**（web/node 均验证）。残留 `skills-market.ts:115`、`ConfigPanel.tsx:266` 为用户 WIP 既有、与本次无关。
- ⏳ 等待实测：
  1. 点「任务清单」按钮 → 下拉打开；空项目提示文案正确。
  2. 用户加条目（回车）→ 出现为普通色；点圆圈 → 播放绿→灰划掉动画后变 done 沉底；双击编辑；hover 出删除。
  3. 让 AI 完成一件已在清单的事 → 该条变黄「待验证」且下拉自动弹开+轻闪；完成一件不在清单的 → 新增黄色待验证条。
  4. done 项 3 天后消失（可改文件 completedAt 验证）。
  5. 关项目/重开、切会话后清单仍在（落 `.claude/checklist.json`）。


## 2026-06-26 — 接通剩余两个 hooks 触发点：Notification + PreCompact

### 背景
hooks 已实现 6 个触发点（PreToolUse/PostToolUse/SessionStart/UserPromptSubmit/Stop/SubagentStop），但 Notification、PreCompact 在 UI 可配却运行时不触发（标「触发点开发中」）。本次补齐这两个。

### 改动
- **Notification**（agent 等待用户输入时触发，纯副作用桌面提醒）[agent-loop.ts](src/main/agent-loop.ts)
  - `runAgentLoop` 顶部加 `fireNotification()`（fire-and-forget，不阻塞审批弹窗），并用 `requestApprovalH`/`requestFollowupH` 包装注入桥，一处接通全部等待点：权限审批、ask_followup_question、exit_plan_mode 计划审批、task 派发审批。
  - 子 agent 循环的 requestApproval 处也单独 fire 一次 Notification。
- **PreCompact**（上下文压缩前触发，可阻止）— 压缩在渲染层，需经 IPC 让主进程跑 hook
  - 新增通用 IPC `hooks:run(event, payload, projectPath)` [ipc-handlers.ts](src/main/ipc-handlers.ts) + preload `hooksRun` [index.ts](src/preload/index.ts) / [index.d.ts](src/preload/index.d.ts)，返回归一化 outcome 供调用方判断 block。
  - [ChatView.tsx](src/renderer/src/components/chat/ChatView.tsx) `doCompact` 开头触发 PreCompact，退出码 2 / deny 则中止压缩并提示；新增 `trigger: "manual"|"auto"` 参数，两处自动压缩调用点（达阈值、溢出重试）传 `"auto"`，`doCompactRef` 类型同步。
- UI：[ConfigPanel.tsx](src/renderer/src/components/config/ConfigPanel.tsx) 两事件 `wired: true` 并更新中英文说明。

### 缓存前缀影响
无。Notification 为旁路副作用不进消息历史；PreCompact 仅在压缩动作前同步执行，不改消息拼接顺序。

### 状态
- 🔧 typecheck：本次改动文件无新增类型错误（残留 `preload/index.d` 导入路径、ConfigPanel:266 等为改前既有，已对比 HEAD 确认）。
- ⏳ 等待实测：
  1. 配 Notification hook（如 `powershell -c "[console]::beep(800,300)"`）→ 触发权限审批/提问/计划卡时应响。
  2. 配 PreCompact hook 返回 exit 2 → 手动 `/compact` 应被阻止并提示；exit 0 → 正常压缩。
  3. 自动压缩（达阈值/溢出重试）也应先经 PreCompact。

## 2026-06-26 — Skill 安装原子化(防半成品)+ 删除本地文件按钮

### 1. 原子安装(根治「下到一半但 SKILL.md 已写入」)
上轮的 try/catch 只能处理「下载抛错」,但**App 在下载中途被强杀/崩溃/断电时 catch 不执行**,正式目录会留下「有 SKILL.md 但缺其他文件」的半成品 —— 之后安装看到 SKILL.md 就报「已存在」,你以为装好了其实残缺。
改 [skills-market.ts](src/main/skills-market.ts) `install`:
- **先全部下载到临时目录** `<name>.<rand>.tmp`,SKILL.md 校验通过后**再 `rename` 到正式目录**(原子提交)。正式目录从此「要么完整、要么不存在」,杜绝半成品残骸。
- 下载前**前置校验**文件清单里确有 SKILL.md(不合法 skill 早退)。
- 任一步失败 → 清理 tmp;已存在同名(真装了)→ 清理 tmp 并报「已存在」。

### 2. 删除 skill 本地文件
- [skills-manager.ts](src/main/skills-manager.ts) 新增 `remove(id, projectPath)`:只删 `list()` 扫出来的、且**路径确在 `.claude/skills` 根下**的目录(`relative` 越界校验,防误删);删后清掉其禁用态记录。
- IPC `skills:remove` + preload `skillsRemove`。
- [ConfigPanel.tsx](src/renderer/src/components/config/ConfigPanel.tsx) `SkillRow` 加垃圾桶按钮 → 点击变「删除/取消」二次确认 → 调 `skillsRemove`,成功即从列表移除。

### 状态
- 🔧 typecheck 通过
- ⏳ 等待实测:正常安装仍成功(走 tmp→rename);删除按钮二次确认后真删本地目录且列表消失;删除越界路径被拒;装到一半关 App 不再留半成品(正式目录不出现)。

## 2026-06-26 — 修复 Skill 安装失败留空壳目录、扫描不到

### 现象
市场安装某 skill 后 `.claude/skills/<name>/` 里只有空目录、无 SKILL.md,「重新扫描」扫不到(扫描器要求 `<dir>/SKILL.md` 存在),且空壳目录还以「已存在同名」挡住重装。

### 根因
`skills-market.ts` 的 `install`:先 `mkdir` 建目录再逐个下载文件,**中途任一文件下载抛错时不清理**,留下半成品/空目录;同时只判断 `existsSync(destDir)` 就报「已存在」,空壳也算数。

### 改动 [skills-market.ts](src/main/skills-market.ts)
- 已存在但**无 SKILL.md** 的目录视为失败残骸,自动清掉重装;有 SKILL.md 才算真已安装。
- 下载循环 try/catch:**任一步失败 → `rm` 清掉半成品目录**再返回错误。
- 收尾**校验 SKILL.md 真落地**,否则清理并报错(避免「装了等于没装」)。
- `rawFile` 补 User-Agent + `encodeURI(path)`(含空格/特殊字符的路径)+ 错误信息带文件名;GitHub 树 403 时提示匿名限流。
- 另:手动清理了 D:\pro1\.claude\skills\find-skills 旧空壳目录。

### 状态
- 🔧 typecheck 通过
- ⏳ 等待实测:重装之前失败的 skill 应成功并出现 SKILL.md;故意断网/限流时不留空壳且有错误提示;装好后「重新扫描」能扫到。

## 2026-06-26 — 补齐 Skill / MCP 市场前端 UI（后端早已就绪但从未接入）

### 背景
排查发现:Skill 市场后端（`skills-market.ts` → IPC `skillsMarketSearch`/`skillsMarketInstall` → preload）与 MCP 官方注册表搜索后端（`mcp-manager.ts` `registrySearch` → IPC `mcp:registrySearch` → preload）**全部写好了,但 renderer 里零调用** —— 前端 UI 从未建。本次补齐两处前端。

### 改动
- **MCP 市场** [McpMarketplace.tsx](src/renderer/src/components/config/McpMarketplace.tsx):新增「在线市场」tab,调 `api.mcpRegistrySearch` 实时搜 registry.modelcontextprotocol.io;卡片展示标题/介绍/作者/transport/版本 + 仓库外链;「添加」直接用注册表预置的 `it.install` 草稿,`requiresInput` 时不自动启用并提示补密钥。原「目录」tab 改名「常用」(静态 CATALOG 保留)。
- **Skill 市场** [ConfigPanel.tsx](src/renderer/src/components/config/ConfigPanel.tsx) `SkillsSettings`:新增「市场」tab,内嵌新组件 `SkillMarket`,调 `skillsMarketSearch`/`skillsMarketInstall`;卡片展示名称/介绍/仓库/stars/installs + 外链;支持选择装到项目/全局;装完回调 `load()` 刷新「已安装」列表。**简介为空或等于名字时弱化显示为「(无介绍)」**(对应上游数据缺失,实测 ~2400 条占位)。

### 风险 / 注意
- 在线搜索均为网络请求,失败有 error 态 + 重试;首次进 tab 自动加载热门。
- MCP「添加」只写配置不自动连(除非无需密钥);Skill「安装」直接下载文件到 `.claude/skills/`,装完需在「已安装」启用才注入。
- **缓存前缀影响:无**。纯 UI + 市场 IPC,不触碰发往 LLM 的消息历史 / system 提示 / 工具定义。

### 状态
- 🔧 typecheck 通过(`npm run typecheck`,tsc --noEmit 无错)
- ⏳ 等待实测:MCP「在线市场」搜索/添加;Skill「市场」搜索/安装到项目与全局/装后出现在已安装;占位简介弱化显示;网络失败重试。

## 2026-06-25 — Skill 市场升级:接入公开 JSON API 数据源(claudemarketplaces / skillsllm)

### 背景
此前 Skill 市场仅扫描内置精选 GitHub 仓库。本次重写 `skills-market.ts`,聚合两个免费、无需 key 的公开目录 API,数据量与丰富度大幅提升;内置仓库降级为「全部 API 失败时的离线兜底」。

- **源 1 claudemarketplaces** `GET /api/skills`:海量(实测 ~21699 条),每条带 `repo`(owner/repo)、`path`、`stars`、`installs`、`installCommand`。**坑:其 `q`/`page`/`limit` 参数被服务端忽略,一次性返回全量(~11MB)** → 主进程整体拉取并缓存 10 分钟,搜索/排序/截断全部在本地做。
- **源 2 skillsllm** `GET /api/skills`:精选(数十条),带 `repoOwner`/`repoName`/`topics`/`language`。
- 聚合按 `repo|name` 去重并合并字段(stars/installs 取大),结果按热度(stars→installs)排序,默认返回前 80。
- **安装路径修正**:API 给的 `path` 不一定等于仓库内真实路径(如 `anthropics/skills` 的 `frontend-design` 实际在 `skills/frontend-design`),故安装时改为用 GitHub git/trees 在目标仓库内**实时定位** `<...>/<name>/SKILL.md`,再把该目录全部文件经 raw.githubusercontent 下载到 `.claude/skills/<name>/`;分支未知时先查仓库 `default_branch`。

### 缓存前缀影响
**无影响**。仅市场搜索/下载与 UI,不触碰发往 LLM 的消息历史 / system 提示 / 工具定义拼接。

### 改动项
| 模块 | 改了什么 | 风险 | 状态 |
| --- | --- | --- | --- |
| src/main/skills-market.ts | 重写:`fromClaudeMarketplaces`/`fromSkillsLLM`/`fromFallbackRepos` 三源聚合 + 10 分钟缓存;`search()` 本地过滤排序;`install()` 实时定位真实路径 + 探测默认分支后逐文件下载 | 全量 11MB 首拉较慢(已超时 25s + 缓存);GitHub 匿名限流 60/时;同名 skill 已存在则拒绝覆盖 | 🔧 typecheck+build 通过 |
| src/preload/index.d.ts | `SkillMarketItem` 改:去掉 `dirPath`,`branch` 改可选,新增 `stars?`/`installs?` | — | 🔧 通过 |
| ConfigPanel.tsx（SkillsMarketTab） | 卡片新增 stars/installs(k/M 缩写)展示;说明文案改为「聚合 claudemarketplaces/skillsllm」 | 注:本文件市场 tab 曾被回退,本次重新加回(tab 状态/tab 栏/SkillsMarketTab 组件/图标 Loader2·Github·User·AlertTriangle·Star) | 🔧 通过 |

### 待用户实测
1. Skills「市场」tab 打开后是否出现大量 skill(空搜索按 stars 排序),输入关键词(如 `pdf`/`react`/`design`)能否过滤。
2. 卡片的作者、星数、安装量、仓库链接是否正确;点「安装」是否下载到 `~/.claude/skills/<name>/` 且「已安装」能扫到(尤其 `anthropics/skills` 这类 `path` 与真实路径不符的)。
3. 断网时是否优雅提示;首次加载 11MB 是否在可接受时间内返回。

## 2026-06-25 — 系统提示词新增 git 工作流约定（初始化/暂存/提交均需问用户）

### 背景
针对大项目（如 UE 工程）含大量图片/二进制/引擎生成文件的场景：避免 agent 自行 `git init` / `git add -A` 把大文件全量纳入。改为在系统提示词层面约束 agent，把 git 决策交回用户。

### 改动
- **`src/main/agent-loop.ts`** `buildSystemPrompt`（普通模式分支，`## Safety` 与 `## Tools` 之间）新增 `## Version control (git)` 段：要求 agent 在初始化新项目时用 `ask_followup_question` 问用户是否 init/暂存、追踪哪类文件、大文件是否 ignore，不自行 `git init`/`add`；每轮改动后问是否提交。具体取舍交由 agent 自行判断。
  - 仅作用于普通编码模式；chatMode / gameMode / plan 分支不受影响。

### 风险
- **缓存前缀**：该段文本写在系统提示词稳定前缀内、位置固定（Safety 与 Tools 之间），对所有普通模式请求一致，**不破坏 prompt 缓存前缀**（属稳定前缀的一次性内容变更，首次请求后即可继续命中）。
- 行为变化：agent 在涉及 git 的场景会更频繁发问，可能增加交互轮次——符合预期意图。
- 依赖现有 `ask_followup_question` 工具，无新增工具/IPC。

### 状态
- 🔧 仅字符串数组追加，无类型变化；待 `npx tsc --noEmit` 确认无新错误。
- ⏳ 运行时实测：在一个非 git 项目里让 agent 做改动，确认它会先问「是否初始化/暂存哪类文件/是否提交」而非自行执行。

## 2026-06-25 — 风味文案国际化（思考中 / 就绪短语中英可切换）

### 背景
界面国际化：让「正在思考」轮换短语与空会话「就绪」后缀短语随 `useLangStore` 当前语言（zh/en）显示。

### 改动
- **`src/renderer/src/lib/flavor-text.ts`**
  - 顶部新增 `import { useLangStore } from "./i18n";`。
  - 中文 `THINKING_PHRASES` / `READY_PHRASES` 数组**完全未动**。
  - 新增 `THINKING_PHRASES_EN`（103 条，游戏/奇幻/游戏开发主题，进行态 `…ing…` 结尾，省略号用 `…`）。
  - 新增 `READY_PHRASES_EN`（29 条，语义等价「已就绪/准备好了」的后缀，与中文 `READY_PHRASES` 29 条数量对齐）。
  - 新增辅助函数 `thinkingPhrases()` / `readyPhrases()`：在调用那一刻按 `useLangStore.getState().lang` 返回对应语言数组。
  - `pickReadyPhrase` / `randomThinkingPhrase` 内部数据源由直接引用数组改为「函数入口处调用 `readyPhrases()` / `thinkingPhrases()` 取一次」；**索引算法（确定性哈希、避重随机）完全不变**，仅换数据源。
- **消费方 `src/renderer/src/components/chat/ChatView.tsx`**：未改。它只调用 `pickReadyPhrase()` / `randomThinkingPhrase()` 两个函数（非直接引用数组），数据源改在函数内部，故切语言即生效，无需改 ChatView。

### 风险
- 切语言后取短语：因在「取值那一刻」读 lang，已能拿到当前语言数组。`pickReadyPhrase` 按会话 id 哈希仍稳定（同会话同语言稳定；切语言后因数组不同会变，符合预期）。
- 缓存前缀：本改动仅前端 UI 文案，不涉及发往 LLM 的消息历史拼接，**不影响 prompt 缓存前缀**。

### 状态
- 🔧 `npx tsc --noEmit -p tsconfig.web.json`：本次改动文件（flavor-text.ts / ChatView.tsx）**无新类型错误**；仅余既有无关错误 `ConfigPanel.tsx:267`（改动前 stash 验证即存在）。
- ⏳ 运行时实测：切换中/英语言，确认「正在思考」轮换短语与空会话「就绪」后缀文案随之切换。

## 2026-06-25 — 内置 Skill 与 MCP 市场（搜索 + 一键安装）

### 背景
在设置面板内置可搜索、可一键安装的 MCP 与 Skill 市场。每个条目至少展示名称 + 介绍，并尽量带作者名与仓库链接。

- **MCP**：升级 `McpMarketplace`「目录」tab。空搜索仍显示原有精选静态模板（离线可用）；一旦输入关键词，改为实时查询官方注册表 `registry.modelcontextprotocol.io/v0/servers?search=`，把每条映射为「展示信息（名/介绍/作者/版本/仓库链接）+ 一键安装草稿（stdio: npx/uvx command+args+env；remote: url+headers）」。需密钥/参数的条目显示「需配置」提示且默认不自动启用。
- **Skill**：新增 `skills-market.ts` + Skills 面板新增「市场」tab。无官方注册表，故从精选 GitHub 仓库（首批 `anthropics/skills`）用 git/trees API（匿名 60 次/时）递归列出 `<base>/<name>/SKILL.md`，读 frontmatter 取 description；安装时把该 skill 目录全部文件下载到 `.claude/skills/<name>/`（有项目则装项目级，否则全局）。装完触发已安装列表重扫。

### 缓存前缀影响
**无影响**。本次改动只涉及市场搜索/安装与 UI，未触碰发往 LLM 的消息历史、system 提示或工具定义拼接。skill 安装只是把文件落到 `.claude/skills/`，是否注入仍由既有 `skillsManager.systemPromptBlock` 决定（用户手动启用后），不改变拼接逻辑与字节。

### 改动项
| 模块 | 改了什么 | 风险 | 状态 |
| --- | --- | --- | --- |
| src/main/mcp-manager.ts | 新增 `McpRegistryItem` 类型、`registrySearch()`，及 `mapRegistryServer`/`argValue`/`deriveAuthor` 等映射辅助；用全局 `fetch` 访问官方注册表 | 注册表条目结构多样，映射可能漏字段；不可一键装的条目（无 packages/remotes）已跳过；网络失败返回空 | 🔧 typecheck+build 通过 |
| src/main/skills-market.ts（新增） | 精选仓库清单 + GitHub trees/raw API 列出/下载 skill；`search()`/`install()`；5 分钟列表缓存防限流 | 匿名 GitHub 限流 60 次/时；同名 skill 已存在则拒绝覆盖；下载逐文件，部分失败会中断 | 🔧 typecheck+build 通过 |
| src/main/ipc-handlers.ts | 新增 `mcp:registrySearch`、`skillsMarket:search`、`skillsMarket:install` | — | 🔧 通过 |
| src/preload/index.ts + index.d.ts | 暴露 `mcpRegistrySearch`/`skillsMarketSearch`/`skillsMarketInstall`，补 `McpRegistryItem`/`SkillMarketItem` 类型 | — | 🔧 通过 |
| McpMarketplace.tsx | 目录 tab 改为防抖实时搜索注册表，结果卡片展示名/介绍/作者/版本/仓库链接，含「需配置」提示与一键添加；空搜索保留精选 | 防抖 350ms；轮询状态不变 | 🔧 通过，待实测搜索/安装 |
| ConfigPanel.tsx（SkillsSettings） | 新增「市场」tab 子组件 `SkillsMarketTab`：搜索、卡片展示名/介绍/作者/仓库链接、一键安装、装完重扫 | 安装走主进程下载；项目级 vs 全局按当前项目自动选 | 🔧 通过，待实测搜索/安装 |

### 待用户实测
1. MCP「目录」tab 输入关键词（如 `github`/`filesystem`），是否出现注册表结果、作者与仓库链接是否正确，点「添加」后到「已安装」能否连接。
2. Skills「市场」tab 是否列出 `anthropics/skills` 的 skill，点「安装」是否下载到 `~/.claude/skills/<name>/` 且「已安装」tab 能扫描到。
3. 断网时两个市场是否优雅提示而非卡死。

## 2026-06-25 — ChatView 界面国际化（i18n）

### 背景
为 `src/renderer/src/components/chat/ChatView.tsx` 接入 `lib/i18n` 的 `useT()`/`tr()`，把用户可见文案做中英双语。组件内（11 个函数组件）用响应式 `useT()`（命名为 `tt` 以避开已有局部变量 `t`），组件外辅助函数 / 模块级常量（`PERM_MODES`、`sessionLastTime`、`summarizeToolGroup` 等）用非响应式 `tr()`。

### 缓存前缀影响
**无影响**。本次只翻译界面文案，**未触碰任何发往 LLM 的内容**：标题生成器 system prompt（247 行）、压缩摘要 system/user prompt（1483-1502 行）、apiMessages 摘要前缀（1275 行）、压缩喂给模型的角色前缀 `用户/助手` 与 `[工具 …]` 轨迹（1458/1464 行）、`[附加文件]` 拼接（1710 行）、直接出图写回 `content` 的「已生成图片并保存到」（1396 行，会被回放给模型）、`=== "批准并执行"` 逻辑比较字面量（1200 行）全部保持中文原样。故不移动缓存断点、不击穿前缀。

### 改动项
| 模块 | 改了什么 | 风险 | 状态 |
| --- | --- | --- | --- |
| ChatView.tsx | 新增 `import { useT, tr }`；11 个组件加 `var tt = useT()` | 取名 `tt` 避免与局部 `t` 冲突 | 🔧 typecheck 通过 |
| ChatView.tsx | 翻译 JSX 文本 / title / placeholder / 右键菜单 label / systemNotify 通知 / 相对时间 / 状态短语 / PERM_MODES / 各类占位文案 | 误翻发给模型的 prompt 会破坏模型行为 | ⏳ 等待测试 |
| ChatView.tsx | 给 `messageList`(useMemo)、`ContextPanel`(useEffect) 依赖数组追加 `tt`，保证切语言即时刷新 | 依赖遗漏会导致切语言后文案不更新 | ⏳ 等待测试 |

### 验证
- `npx tsc --noEmit -p tsconfig.web.json` 无新类型错误（🔧）。
- 待用户实测：切换 UI 语言后聊天界面文案随之更新、发给模型的请求行为不变。

## 2026-06-25 — 跨会话记忆：agent 可检索/读取历史会话

### 背景
对齐 Claude Code / Codex 的「跨会话记忆」机制：会话本就以 JSONL 落盘（`chat-store-manager`），缺的是让 agent 能按需检索这些 JSONL。新增两个工具，复刻 memory 系统 Tier1 `recall_memory` 的「按需检索 + 工具结果落历史尾部」模式——**不进 system 前缀，不击穿缓存**。范围跨项目（用户明确要求），检索用大小写不敏感字面匹配（ripgrep 思路，零依赖），未来可接 embedding 做混合检索。

### 改动项
| 模块 | 改了什么 | 风险 | 状态 |
|---|---|---|---|
| chat-store-manager.ts | 新增 `searchAcrossSessions(query,{excludeSessionId,limit,perSession})` 跨项目扫所有会话 JSONL 做字面匹配返回片段；`readSessionById(sessionId)` 跨项目按 id 读全文；导出单例 `chatStoreManager`（与 ipc-handlers 各自实例无状态幂等，不冲突） | 大量历史会话时全量读盘有 IO 开销（已限 limit=10/perSession=5）；仅读不写，无数据风险 | ⏳ 待用户实测 |
| tools.ts | 注册 `search_sessions`/`read_session` 两个工具定义；executeTool 加分支；实现 `searchSessionsTool`（含命中片段格式化）/`readSessionTool`（默认截最近 40 条、单条正文上限 4000 字符，full=true 取全段）；import 单例；ToolContext 加 `currentSessionId` 字段 | read_session 对超长会话已双重截断防 token 爆；search 结果作为 tool result 落历史断点之后，不污染前缀 | ⏳ 待用户实测 |
| agent-loop.ts | toolCtx 注入 `currentSessionId: req.sessionId`，使 search_sessions 排除正在进行的会话自身 | 仅追加一个 ctx 字段，不动消息拼接 | ⏳ 待用户实测 |

### 缓存前缀影响
**无影响**。新工具的检索结果只作为 tool result 落在对话历史尾部（断点之后），system 前缀、工具定义稳定前缀不变。工具定义本身是稳定前缀的一部分、各轮字节一致。currentSessionId 仅经 ctx 传递，不进消息文本。

### 验证
- 🔧 `tsc --noEmit` 全量通过，无报错。
- ⏳ 运行时待实测：①新会话里让 agent `search_sessions` 关键词，看能否列出历史会话+片段；②`read_session` 读全文/截断是否正常；③确认不会把当前会话搜回来；④跨项目能否搜到别的项目会话。

## 2026-06-25 — MemorySettings 界面 i18n

### 背景
把 `MemorySettings.tsx` 中所有用户可见中文文案改为 `t()`（组件内）/`tr()`（模块级 TYPE_META 的 label/hint）双语。

### 改动项
| 模块 | 改了什么 | 风险 | 状态 |
|---|---|---|---|
| MemorySettings.tsx | TYPE_META label/hint 用 tr；MemorySettings/MemoryRow/MemoryEditor 三个组件用 t() 包裹 JSX 文本、title、placeholder、按钮文案、"· 常驻"等拼接片段；MemoryEditor 中 `TYPE_ORDER.map((t)=>)` 局部参数与 i18n 的 t 冲突，已重命名为 ty | 仅文案双语化，不影响逻辑；需确认中英切换显示正常、编辑/删除/新增交互无误 | 🔧 已过 `tsc --noEmit -p tsconfig.web.json` 无新错误，运行时 ⏳ 待用户实测 |

## 2026-06-25 — 配置类界面 i18n（4 组件 + 1 lib）

### 背景
把权限/上下文/配置导入导出/Discord 四个设置界面的用户可见中文文案，改为 `t()`（组件内）/`tr()`（组件外、模块级常量）双语，配合既有 i18n 工具模块支持中英切换。仅翻译界面文案；中文代码注释、发给模型的提示词/工具协议、变量名、对象 key、console、路径命令一律不动。

### 改动项
| 模块 | 改了什么 | 风险 | 状态 |
|---|---|---|---|
| PermissionsSettings.tsx | 模块级 `MODES` label/desc 用 `tr`；组件加 `useT`，标题/模式标签/工具权限/自动批准/提示等约 11 处用 `t`；map 回调参数 `t`→`tp` 以避免与 `useT` 返回值 `t` 命名冲突 | 命名遮蔽（已修，typecheck 过）；模块级 `tr` 仅加载时求值，切语言不刷新 MODES 文案 | 🔧 typecheck 通过 |
| ContextManager.tsx | 加 `useT`；CLAUDE.md 描述、保存失败提示、注入说明等约 3 处用 `t`（其余原本就是英文，未动） | 无 | 🔧 typecheck 通过 |
| ConfigTransfer.tsx | 加 `useT`；标题/警告/导入说明/分区提示/按钮/导出导入结果与错误约 14 处用 `t` | 事件回调内 `t` 为闭包捕获渲染时值，正常 | 🔧 typecheck 通过 |
| DiscordSettings.tsx | 加 `useT`；状态文案/连接拦截原因(`useMemo` 依赖加 `t`)/保存反馈/表单 label·placeholder·badge/配置步骤/命令列表等约 40 处用 `t`，emoji 保留 | `connectBlockers` `useMemo` 已把 `t` 入依赖，切语言会重算 | 🔧 typecheck 通过 |
| lib/config-transfer.ts | 加 `import { tr }`；`TRANSFER_SECTIONS` 中会渲染到界面的中文 label（网络搜索/外观与通知/记忆/Skills启用状态）用 `tr`；`parseBundle` 两条会 setError 显示的错误文案用 `tr`。英文 label 与写入文件的合并标记未动 | 模块级常量 `tr` 仅模块加载时求值一次，运行中切语言不会更新 section label（如需响应式须改组件侧取值） | 🔧 typecheck 通过 |

### 验证
`npx tsc --noEmit -p tsconfig.web.json` 无新错误。运行时中英切换效果需用户实测（⏳）。

## 2026-06-25 — 子 agent 提示词去诱导 + 补全真实适用场景

### 背景（用户反馈）
明明后端「只读才并行、含写串行」，模型却老在串行场景下张口说「并行」。根因：task 工具 description / roster 系统块 / 内置 agent description 三处都带诱导词（`Prefer read-only…`、`often several in parallel`、`Use this to fan out…`），模型会无脑往被诱导的选项靠。且提示词没说清「子 agent 到底什么时候该用」。用户要求：提示词只给信息、不诱导单一选项；写清真实适用场景——尤其是「只在主 agent 拿一个总结就能推进下一步时才用；若后续还需要完整精确代码/细节，别委派（回传只是摘要，主 agent 还得自己补读，更慢）」。

### 改动项
| 模块 | 改了什么 | 风险 | 状态 |
|---|---|---|---|
| tools.ts（task 工具 description） | 去掉 `Use this to fan out…`（诱导并行）。改为中性陈述：子 agent 独立上下文、只回传总结；**适用**=子任务会往主对话灌大量中间内容（读很多文件/整模块只为得结论）时；**不适用**=活小、或后续还需要精确代码/细节（摘要逼你重读、更慢）。并行只作事实陈述：「同轮多个只读 task 并行；含写的批次一次一个」 | task 进工具定义缓存前缀——但本次只改 description 文本，schema 结构/字段不变；改完后字节恒定，不随启停 agent 变 | 🔧 node typecheck 0 |
| agents-manager.ts（roster 系统块 systemPromptBlock） | 同口径重写：去 `Prefer…`，明确「何时委派/何时自己做/只回传 summary」+ 并行作事实陈述。该块按启用 agent 集合生成，对同集合字节恒定 | 进系统提示稳定前缀；对同一启用 agent 集合字节恒定，不破坏跨轮缓存 | 🔧 node typecheck 0 |
| agents-manager.ts（内置 general-purpose / code-explorer 的 description） | 去 `often several in parallel`；description 改为说明「独立上下文、只回传总结、何时用何时跳过」。各自 prompt（子 agent 自身 persona）基本保留，仅补一句「主 agent 只收到这份 report，不见你的原始工具输出，请自足」 | 仅文本；description 进 roster 块（同上缓存口径） | 🔧 node typecheck 0 |

### 缓存前缀影响
- task 工具 description 改了文本但 schema 字节在一次会话内仍恒定（不随启停 agent 变），符合「静态 task schema」铁律，不会逐轮击穿工具定义缓存断点。
- roster 块与内置 description 进系统提示稳定前缀：对「同一启用 agent 集合」字节恒定，跨轮不漂移。仅当用户在设置里启停 agent 时该块字节变化（与 skillsBlock 同款，属预期）。
- 未改任何消息历史拼接顺序。

### 待用户实测
- 串行写场景下，模型不应再无端口称「并行」；并行只在「同轮多个只读调查」时才发生。
- 模型对「该不该用子 agent」的判断更贴合：大调查/会撑爆上下文 → 委派；多文件直接改、或后续要精确代码 → 直接做，不绕子 agent。

### 静态验证
- `npx tsc --noEmit -p tsconfig.node.json` EXIT 0
- 残留诱导词检索（Prefer read-only / often several in parallel / fan out independent / parallel fan-out）：0 处

---

## 2026-06-25 — 界面 i18n：explorer/git/discord/chat 文案接入 useT/tr

### 改动项
- `explorer/FileExplorer.tsx`：约 22 处（右键菜单 label、头部新建/刷新 title、搜索 placeholder/清除 title、搜索中/无匹配/匹配计数空态、行 title「双击预览」、行内编辑 placeholder「文件名/文件夹名」）。`FileExplorer`、`TreeNodeItem`、`InlineEditRow` 各自取 `t`；引入 `useT`。
- `git/GitPanel.tsx`：约 60 处（操作 fail/flash 通知拼接、三套右键菜单 label、分支下拉/新建分支、提交框 placeholder 与按钮、同步/刷新 title、文件分组标题与行内操作 title、浏览项目文件区、提交历史区空态、PRDialog 全量、FileHistoryDialog 全量、FileGroup 行 title）。`GitPanel`、`PRDialog`、`FileHistoryDialog`、`FileGroup` 各自取 `t`；引入 `useT`。`afterCommitOp` 的 revert/cherry-pick/reset 等命令名保持英文，仅「成功/失败」后缀本地化。
- `discord/DiscordRelay.tsx`：约 14 处（回送 Discord 的错误/会话操作回执文案）。组件返回 null、文案在一次性注册的 IPC 回调中，故全部用 `tr`（非响应式）；引入 `tr`。会话默认名 "Discord" 作为专有名保留。
- `chat/SlashPalette.tsx`：约 9 处（`EFFORT_OPTIONS` 档位 label/desc 用模块级 `tr`；面板标题「推理强度/斜杠命令」与底部按键提示用 `t`）。引入 `useT, tr`。注：`EFFORT_OPTIONS` 模块加载时一次性求值，运行中切换语言不重算（静态选项，可接受）。
- `chat/Markdown.tsx`：约 9 处（路径 chip 的 title 预览/打开、Details 兜底标题「详情」、CALLOUT 标题说明/提示/重要/警告/危险、CodeBlock 复制/已复制）。`CALLOUT_KINDS.label` 改为大写英文键，`Callout` 内按 `t` 映射显示标题。`Markdown`/`Details`/`Callout`/`CodeBlock` 各自取 `t`；引入 `useT`。
- `chat/Mermaid.tsx`：约 8 处（「正在绘制图表…」、内联图表 title 缩放提示/复位/全屏查看/复位百分比、lightbox 复位/缩放提示/关闭）。`Mermaid`/`InlineDiagram`/`MermaidLightbox` 各自取 `t`；引入 `useT`。

### 风险
- 严格未改：中文注释、发往模型的提示词与工具协议字符串、变量名/对象 key、console.log、路径/命令、已是英文的文案。
- 缓存前缀：本批均为渲染层 UI 文案，不参与发往 LLM 的消息历史拼接，**不影响 prompt 缓存前缀**。
- `SlashPalette` 的 `EFFORT_OPTIONS` 与 `Markdown` 的 `CALLOUT_KINDS` 为模块级常量；前者 label/desc 不随运行时语言切换刷新（已用 `tr` 一次性求值），后者 label 已下沉到组件内用 `t` 渲染、可随切换刷新。

### 状态
- 🔧 `npx tsc --noEmit -p tsconfig.web.json` 全量通过，无新增类型错误（验证方式：命令零输出退出）。
- ⏳ 等待用户实测：六个面板/组件在中英切换下文案正确、布局无溢出、Discord 回执语言符合预期。

## 2026-06-25 — 界面 i18n：layout/dashboard/terminal/ui/editor 文案接入 useT/tr

### 改动项
- `layout/Sidebar.tsx`：1 处（侧边栏收起 title）。引入 `useT`。
- `layout/StatusBar.tsx`：7 处（余额 title/今日小标、迷你终端名/两个按钮 title/两个空态提示）。引入 `useT`，StatusBar 与 MiniTerminal 各自取 `t`。
- `layout/TabBar.tsx`：0 处（标签均为英文，无中文）。
- `dashboard/AnalyticsDashboard.tsx`：约 30 处（标题/概览卡/缓存命中/模型表/余额区/趋势图图例与标题/空态）。`RANGES` 加 `labelEn` 字段；纯函数 `makeBuckets` 的桶标题用 `tr`；`aggregate` 的 `model` 兜底由「未知」改空串、显示层用 `t("未知",...)`。
- `dashboard/TrustDialog.tsx`：4 处（标题/警告/取消/信任并打开）。引入 `useT`。
- `dashboard/WelcomeScreen.tsx`：1 处（未信任项目 title）。其余本就英文。引入 `useT`。
- `terminal/TerminalPane.tsx`：0 处（本就英文）。
- `terminal/XtermInstance.tsx`：0 处（无可见文案）。
- `ui/ContextMenu.tsx`：0 处（label 由调用方传入，无硬编码中文）。
- `editor/CodeEditor.tsx` / `editor/CodeView.tsx`：0 处（本就英文）。
- `layout/SecondaryBar.tsx`（允许范围内）：`AnalyticsSecondary` 改为按 `useLangStore` 的 lang 选 `labelEn/label`，配合 RANGES 结构变更。

### 风险
- RANGES 结构新增 `labelEn`（仅追加字段，未改 `value/label`），SecondaryBar 已同步；其它引用方若按旧类型解构无影响。
- 缓存前缀：本次仅改渲染层 UI 文案，**不影响**发往 LLM 的消息历史/系统提示/工具协议字符串，无缓存前缀风险。
- `t()` 为响应式 hook，已确保只在组件函数体顶层调用；纯函数/事件处用 `tr()`。

### 状态
- 🔧 `npx tsc --noEmit -p tsconfig.web.json` 通过（无新增类型错误）。
- ⏳ 等待用户实测：切换中/英语言后各界面文案正确切换、布局无溢出。

## 2026-06-25 — 修「子 agent 工作时主轮被心跳误杀」+「继续时模型以为子 agent 还在跑」

### 背景（用户报告）
①agent 完成工作后没下文、主 agent 不主动继续；②用户说「继续」后模型还判断子 agent 在工作，但页面上已完成。
根因定位：task 派发期间主 agent 阻塞在 `await pending`，这段时间只发 `agent:subagent`、**不发 `agent:turn`**。而渲染层心跳看门狗只靠 `agent:turn` 刷新进度时间戳——子 agent 跑超过 90s（构建 HTML 很容易超）就被误判「静默卡死」→ `agentStop` 掐断整轮 → task 半途被杀、主 agent 拿不到结果（症状①）。被杀时 task 工具气泡是 partial（无 output）落库；用户「继续」时回放给模型 `(task completed with no output)`，模型据此以为子 agent 还在跑/状态不明（症状②）。

### 改动项
| 模块 | 改了什么 | 风险 | 状态 |
|---|---|---|---|
| ChatView.tsx（onAgentSubagent） | 子 agent 任何生命周期事件都视为「主 loop 仍活着」：刷新该会话心跳 `setGenerating(sid, Date.now())` + 撤错误看门狗。根治 task 跑超 90s 被心跳误杀。子 agent 按 token/工具持续发事件，故只要子 agent 在动，整轮就不会被判死 | 中：核心修复；仅在 busy 时刷新，不影响已结束会话 | 🔧 web typecheck 0 |
| ChatView.tsx（normalizeToolOutput） | task 空结果特判：回放时不再给 `(task completed with no output)`，改为明确「该委派被中断/未收尾，子 agent **已不在运行**，需要则重新派发，否则继续」。根治「继续后模型干等子 agent」 | 低：仅 task 且 output 为空时改文案，其余工具不变 | 🔧 web typecheck 0 |

### 缓存前缀影响
无。心跳刷新是渲染层本地状态；normalizeToolOutput 只改被中断 task 的回放占位文本（历史尾部），不动 system/工具定义稳定前缀。

### 待用户实测
- 重跑「子 agent 协同构建 HTML」：子 agent 跑很久（>90s）也不应再被自动停止/标红，主 agent 应能等到子 agent 结果后继续收尾。
- 若某轮确实被中断后「继续」：模型应不再以为子 agent 还在跑，而是直接继续或重新派发。
- 普通（无子 agent）长任务的 90s 看门狗行为不变（仍能兜底真正的静默卡死）。

### 静态验证
- `npx tsc --noEmit -p tsconfig.web.json` EXIT 0
- `npx tsc --noEmit -p tsconfig.node.json` EXIT 0

---

## 2026-06-25 — 切换标签页后 chat 不卸载（根治消息/转圈丢失）

### 背景（接上一条修复的深挖）
用户进一步追问：切回 chat 后是否可能「忘记继续接收 AI 返回，必须发消息/点停止才出字」。核查确认**确实存在且更严重**：每条 `agent:turn` 是**全量快照流**（[agent-loop.ts:174](src/main/agent-loop.ts#L174) 发 `this.msgs.map(...)`），监听器装在 ChatView 内（[ChatView.tsx](src/renderer/src/components/chat/ChatView.tsx#L1133) `unsubTurn`）。App.tsx 用 `activeView === "chat" && <ChatView />` 条件渲染，切走即卸载、监听器拆除，**期间主进程发的快照全被丢弃**。
- 情况 A（切回时该轮还在跑）：下一条全量快照会补齐并继续，文字自愈。
- 情况 B（在别处时该轮正好 `done`）：收尾快照是**一次性事件**（[agent-loop.ts:188](src/main/agent-loop.ts#L188)），丢了就没；且只在 `done` 落盘（[chat-store.ts:612](src/renderer/src/stores/chat-store.ts#L612)）→ 消息停在半截、`streaming` 卡 true、未持久化，**切回也不自愈**——正是用户担心的现象。

### 改动项
| 模块 | 改了什么 | 风险 | 状态 |
|---|---|---|---|
| App.tsx | **ChatView 改为始终挂载、仅 `display:none` 隐藏**，不再随切标签页卸载。监听器永远在线，任何 `agent:turn`（含一次性 done 收尾快照）都不丢；心跳看门狗 / 转圈状态保持连续 | 中：ChatView 常驻内存（本就是单例，无额外会话级开销）；其它视图仍条件渲染不受影响。隐藏时 `display:none` 不触发其内部布局测量副作用，切回 React 不重挂故 effect 不重跑 | 🔧 web typecheck 0 |

### 与上一条的关系
- 上一条的 `agent:running-sessions` 恢复**保留**：作为独立第二层兜底，覆盖「窗口 reload / 应用重启后主进程 loop 仍在跑」的真·全新挂载场景。两层不冲突。

### 缓存前缀影响
- 无。纯渲染层挂载策略调整，不碰消息拼接。

### 待用户实测
- **核心（情况 B）**：发一轮长对话 → 在 AI 还在出字时切到 config → **停留到这轮应已结束** → 切回 chat：消息应完整收尾、无半截卡 `streaming`、转圈正常熄灭。
- **情况 A**：出字中途切走立刻切回，文字应连续接上不丢段。
- 其它视图（terminal/editor/config 等）切换显示正常，无残留 chat 内容透出。

## 2026-06-25 — 切换标签页后回到 chat：恢复正在运行会话的转圈/busy 提示

### 背景
切到其它标签页（如 config）再切回 chat 时，「正在思考/正在工作」转圈提示消失，用户无法判断后台对话是否还在跑。根因：App.tsx 用 `activeView === "chat" && <ChatView />` 条件渲染，切走时 ChatView **整体卸载**，其局部 state（`busySessions`/`agentStatus`/`isProcessing`）随之清空；重挂时无任何机制回拉运行状态。实际上主进程 `runningLoops` 的 agent loop 经 `ipcMain.handle` 独立运行，**不随渲染层卸载而中断**——对话仍在跑，只是 UI 丢了进度反馈。

### 改动项
| 模块 | 改了什么 | 风险 | 状态 |
|---|---|---|---|
| ipc-handlers.ts | 新增 `agent:running-sessions` handler：返回 `runningLoops` 当前在跑的 sessionId 列表（真相源） | 低：纯只读查询，不改任何运行状态 | 🔧 web typecheck 0 |
| preload（index.ts / index.d.ts） | 暴露 `agentRunningSessions(): Promise<string[]>` | 低：仅新增 API | 🔧 typecheck 0 |
| ChatView.tsx | 监听器 setup effect（挂载时）调用 `agentRunningSessions()`，对仍在跑的会话 `setSessionBusy(true)` + 补 `setGenerating`（无时间戳则以现在起算）+ 若是 active 会话则 `setIsProcessing(true)`、agentStatus idle→responding，恢复转圈与提示 | 中：依赖真相源对齐；若主进程已结束则列表为空，不会误点亮。心跳看门狗仍兜底超时收口 | 🔧 web typecheck 0 |

### 缓存前缀影响
- 无。纯渲染层 UI 状态恢复 + 一个只读 IPC 查询，不触碰发往 LLM 的消息拼接。

### 待用户实测
- **核心**：发起一轮较长对话 → 转圈出现后切到 config 标签 → 再切回 chat → 转圈/「正在回复…」应重新出现，且对话继续到正常完成。
- 边界：切走再切回若该轮已完成，不应误显示转圈（列表为空）。
- 多会话：A 会话在跑时切走切回，A 列表里仍显示转圈角标。

## 2026-06-25 — 计划模式批准即执行 + 子 Agent/主循环执行保证（传输重试 / 权限熔断 / 子 agent 重试）

### 背景
传输日志「子Agent协同构建HTML」分析：24 条请求里前 23 个 200，最后一条发出后无响应（socket hang）。倒数两条工具结果是 `Permission denied: run_command/write_file ... not allowed in current mode`——会话在 plan 模式，agent 反复换不同文件/命令尝试写、全被拒，参数每次不同故「签名重复」检测抓不到，空转到撞网络错误，且**零重试**整轮死。两个根因叠加：①计划批准后要等下一轮才执行；②无传输重试 + 无权限空转熔断。

### 改动项
| 模块 | 改了什么 | 风险 | 状态 |
|---|---|---|---|
| agent-loop.ts（exit_plan_mode） | **批准计划后当轮立即切出 plan 模式**：新增 `modeBeforePlan`（进 plan 前记录原模式），exit_plan_mode 批准时 `currentMode = modeBeforePlan`，使本轮后续写工具立刻可执行，不必等下一轮。与 enter_plan_mode 当轮即改 currentMode 对称 | 中：改了批准后的模式时机；渲染层仍持久化 session 模式（互补不冲突） | 🔧 node typecheck 0 |
| agent-loop.ts（plan 提示） | 强化 plan 模式系统提示 + enter/exit 工具结果文案：明确「交计划=必须调用 exit_plan_mode 工具，当轮完成；绝不把计划当普通文本输出后结束本轮」，根治「模型把计划当文本吐出 → 无审批卡 → 卡住等下一条消息」 | 低：纯提示词；位于稳定前缀，对同配置字节恒定 | 🔧 node typecheck 0 |
| agent-loop.ts（传输重试） | 新增 `streamCompletionWithRetry` 包装器：对「连接级失败/5xx/429 且**尚未流出任何文本**」的瞬时错误做指数退避重试（默认 3 次，0.8/1.6/3.2s+抖动）。streamCompletion 在 req/res error 与非 200 路径标记 `err.retryable`（仅未流出文本时为 true，绝不重复已显示内容）+ 中间尝试 `suppressRetryableToast` 不弹错。主循环 + 子 agent 循环都改用包装器。abort 立即停止重试 | 中：核心传输路径加重试；已流出文本/上下文溢出/4xx 非429 不重试（行为同旧） | 🔧 node typecheck 0 + build 通过 |
| agent-loop.ts（权限熔断） | 主循环 + 子 agent 循环各加 `denyStreak` 计数：连续被**模式拒绝(deny)** 达 5 次即熔断停下（用户主动拒绝 ask→false 不计；任何放行清零）。主循环弹明确提示「当前 plan 模式/权限禁止写，请批准计划或切换模式」；子 agent 把原因并入报告回传父 agent。根治日志里的空转 | 中：新增提前终止条件；正常任务每次有工具放行故 denyStreak 清零，不误伤 | 🔧 node typecheck 0 |
| ipc-handlers.ts（子 agent 重试） | runSubAgent 闭包：**只读**子 agent 返回含 `[sub-agent error]` 标记时自动重跑一次（只读重跑不会重复写文件，绝对安全）；**可写**子 agent 不自动重跑（可能已部分落盘），失败原因原样回传父 agent。用户中止不重试 | 低：仅只读路径重试；可写路径行为不变 | 🔧 node typecheck 0 |
| ChatView.tsx | onAgentError 早退：`transient: true` 的重试进度提示（"连接中断,正在重试 n/3…"）只作灰字留痕，不停转圈/不亮红叹号（重试由后端透明处理） | 低：仅对新增 transient 标记分流，原 error 路径不变 | 🔧 web typecheck 0 + build 通过 |

### 缓存前缀影响
- plan 提示词强化等均在系统提示稳定前缀内，对同一配置字节恒定，不破坏缓存。
- 传输重试不改任何发送内容，只是同一请求体重发；权限熔断只提前结束循环，不改消息拼接。
- 子 agent 重试是重跑独立 messages 的子循环，完全不碰主对话历史。

### 待用户实测
- **计划批准即执行**：让 agent 进计划模式产出计划 → 点「批准并执行」→ 应在**同一轮**立刻开始写文件，不再要你再发一条消息。
- **计划卡必现**：复杂任务时计划应总能弹出审批卡（模型用 exit_plan_mode 工具交计划），不再「计划以文本吐出后卡住」。
- **传输重试**：中转站不稳时 socket hang 应自动重连（灰字「正在重试」），不再整轮直接红叹号死；重试耗尽才报错。
- **权限熔断**：故意在 plan 模式下让 agent 写文件，连续被拒约 5 次后应**主动停下并提示切换模式**，不再空转到超时。
- **子 agent 协同构建 HTML**：重跑日志里那个场景应能走完（批准计划→并行只读调查→串行写），中途断流自动重试。

### 静态验证
- `npx tsc --noEmit -p tsconfig.node.json` EXIT 0
- `npx tsc --noEmit -p tsconfig.web.json` EXIT 0
- `npm run build` 通过（built in ~13s）

---

## 2026-06-25 — tools.ts 审查修复一批（编辑唯一性 / HTTP 重定向 / 进程树 / 大文件流式读 等）

### 背景
对 [tools.ts](src/main/tools.ts) 一批审查发现项逐条核实后，仅修「确认为真且修法完全无害正向」的项；按成熟方案实现（不简化）。核实为**假**或**设计如此**的不动：
- 符号链接无限递归（#6）：**假**。两处 walk 仅对 `e.isDirectory()` 递归；实测 Node `Dirent` 对符号链接/junction 返回 `isDirectory()===false`（`isSymbolicLink()===true`），不会进入 → 无递归风险，不改。
- multi_edit 顺序干扰（#12）：**设计如此**（对标 Claude Code MultiEdit 顺序语义）；修 #1 后 fuzzy 已不会静默改非预期处，缓解。
- apply_diff 空行/纯增 hunk：部分属实但符合 unified-diff 规范，贸然改有正确性风险，**暂不动**，仅记录。
- ReDoS（#5）：属实，但成熟修法需引 RE2 原生依赖（非"完全无害"），**不擅改**，留待评估。

### 改动项
| 模块 | 改了什么 | 风险 | 状态 |
|---|---|---|---|
| tools.ts (applyStringEdit) | **正确性 bug**：去空白 fuzzy 匹配循环命中首处即 `break`，`matchCount` 恒为 1，`matchCount===1` 必过 → 多处 trim 后相同候选时静默改第一处，违反「old_string 必须 UNIQUE」契约。改为：非 replace_all 时全量判定唯一性（找到第二处即停并报 `not unique (N matches ignoring whitespace)` 拒写），与精确匹配路径同款契约 | 收紧：原先能"歪打正着"改到的歧义输入现会被拒（更安全，符合契约） | 🔧 node typecheck 0 |
| tools.ts (httpRequest 重定向) | ①`loc.indexOf("http")===0` 改为 `new URL(loc, urlObj)` 标准解析：修 protocol-relative `//host/...` 被误拼成 `origin+loc`（`https://host//host/...`）；②递归调用原 `httpRequest(next, n-1)` 丢失 `opts.headers`/method/body，改为：301/302/303 POST→GET 丢 body、307/308 保留 method+body，两种都透传自定义 headers | 重定向语义更正确；遵循浏览器/RFC 行为 | 🔧 node typecheck 0 |
| tools.ts (runCommandTool) | ①`maxBuffer` 1MB→10MB；②溢出（`ERR_CHILD_PROCESS_STDIO_MAXBUFFER`）不再当纯失败，保留已捕获 stdout 标注 truncated；③超时改自管：到点 Windows 用 `taskkill /pid /t /f` 杀**整棵进程树**（原 exec timeout 只杀父 shell，孙进程残留），非 Windows 用 SIGKILL | 行为变化：大输出命令不再丢 stdout；超时杀树更彻底 | 🔧 node typecheck 0 |
| tools.ts (readFileTool 文本分支) | 原先 `readFile` 整文件 + `split` 全量行数组（GB 级文件/超大单行会 OOM）。改为 `readline` 流式逐行：只保留窗口 `[start, start+capped)` 内的行，其余仅计数 → 内存受窗口大小约束，`total` 仍精确。已验证 CRLF + 无尾换行 total/slice 正确。图片分支不变 | 大文件读取内存大幅下降；行为对正常文件不变 | 🔧 node typecheck 0 + readline 单测通过 |
| tools.ts (glob/search SKIP) | 两处递归遍历 SKIP 集合不一致（glob 缺 `.next`/`build`）。提取共享常量 `WALK_SKIP_DIRS`，两处共用 → 行为对称 | 纯一致性，glob 现也跳过 build/.next | 🔧 node typecheck 0 |
| tools.ts (webFetchTool / httpRequest) | 死代码 `ct=""` 改为真正跟踪：`httpRequest` 结果新增 `contentType`（读响应头 `content-type`）；webFetch 优先按 header 判 JSON，缺失/不可信时再回退正文首字符启发式，修非 `{`/`[` 开头 JSON 被误当 HTML 剥标签 | JSON 判定更准；非 JSON 路径不变 | 🔧 node typecheck 0 |

说明：均为 main 进程工具实现，不涉及发往 LLM 的消息历史拼接，**无缓存前缀风险**。`npx tsc --noEmit -p tsconfig.node.json` EXIT 0。

---

## 2026-06-25 — 修「工具返图被中转站吞掉」：tool_result 内嵌图 → user 顶层 image block

### 背景
传输日志逐字节确认：read_file / capture_window 读到的图，base64 确实正确发出，结构也合规
（`tool_result.content` 内 text + image block）。但三次带图请求的 `prompt_tokens` 相对无图
请求**零增量**（如今天 14116/14116/14116，含 0/1/2 张图），证明图片的像素 token 从未计入
——中转站（api.lmuai.com）把 **tool_result 内嵌的 image block 剥离/忽略**了，模型收不到像素，
故「读不了」。对照实验：聊天框直接拖图（image block 在 **user 消息顶层**，与 tool_result 无关）
能完整读到。两条路唯一差异就是 image block 的位置。

### 改动项
| 模块 | 改了什么 | 风险 | 状态 |
|---|---|---|---|
| agent-loop.ts (toAnthropicRequest, tool 分支) | 工具结果带图时，不再把 image 嵌进 `tool_result.content`；改为 `tool_result`（只放文字）+ 同一条 user 消息里**紧跟其后的同级 image block**（与聊天框拖图同构）。无图仍走纯字符串 content（不变） | 改了带图工具结果的 Anthropic 序列化结构；官方端点对此等价合法，且修中转站吞图。OpenAI/Responses 路径未动 | ⏳ |
| agent-loop.ts (merged 后归一化) | 新增：每条 user 消息内所有 `tool_result` 块稳定前移、其余块（image/text）按原相对序排其后。防多个返图工具合并到一条 user 时产生 `[tr,img,tr,img]` 交错（Anthropic 要求 tool_result 在最前），重排为 `[tr,tr,img,img]` | 仅重排块顺序，不增删内容；单工具返图（最常见）结构 `[tr,img]` 不受影响 | 🔧 typecheck 通过 |

### 缓存前缀影响
图片仍只在工具结果消息（历史尾部）出现，不进 system/工具定义稳定前缀。本改动只调整该尾部
消息内部的 block 结构，不影响其之前的历史缓存断点。

### 待用户实测
- 用工具（read_file 读图 / capture_window 截图）后，看传输日志：带图请求的 `prompt_tokens`
  应明显高于无图请求；模型应能描述图片内容（不再「读不了」）。
- 多工具同轮各返一张图：请求不报 400（验证归一化把 tool_result 全部前移）。

### 静态验证
- `tsconfig.node.json` EXIT 0

---


                                    ## 2026-06-25 — 完整 Multi-Agent / 子 Agent 系统（task 工具派发 + 可视化）

                                    ### 设计依据
                                    对标 Claude Code subagents（定义层）+ Swarm/AutoGen 编排（执行层）+ 黑板共享（注入层），全部复用本项目现有成熟设施：定义层仿 skills-manager；执行层复用 streamCompletion + 权限门 + checkpoint + hooks；注入层仿 search/imageGen/mcp 的 toolCtx 解析。三条铁律：①子 agent 每个工具调用照走 decideToolAction + 批准桥；②子 agent 永远用父供应商（同 key/baseUrl/protocol），.md 的 model 只能在父供应商 models[] 内选，否则回落父模型，绝不跨供应商；③并行子 agent 全只读，含可写批次强制串行。

                                    ### 改动项
                                    | 模块 | 改了什么 | 风险 | 状态 |
                                    |---|---|---|---|
                                    | agents-manager.ts（新） | 仿 skills-manager：扫描 `.claude/agents/*.md`（项目+全局）+ frontmatter 解析（description 必填，可选 tools/model/mode）+ 启用态存 `userData/codeweaver-agents.json`。自带内置兜底 agent（general-purpose 可写、code-explorer 只读，无 .md 时也能用）。`systemPromptBlock` 产出可派发 agent 名单（roster）块 | 新文件，独立；解析失败的 agent 带 error 不可派发 | 🔧 node typecheck 0 |
                                    | tools.ts | 新增**静态** `task` 工具定义（subagent_type + prompt + 可选 description）。**关键缓存规避**：subagent_type 不进 schema enum，可派发名单只在 roster system 块枚举 → task 工具体字节恒定，启停 agent 绝不改变工具定义、不击穿 Anthropic 工具缓存断点。ToolContext 新增 `subagents`（defs/resolveModel/runSubAgent） | task schema 进入工具定义前缀，但保持字节静态；运行期校验 subagent_type 合法性 | 🔧 node typecheck 0 |
                                    | permissions-manager.ts | 新增 `task→Task` 映射 + `Task` 进 DEFAULT_CONFIG（task 非 mutating，派发本身只读；真正的写由子 agent 内部工具各自过门） | 低，纯新增映射 | 🔧 node typecheck 0 |
                                    | agent-loop.ts | ①新增自包含 `runSubAgentLoop`（独立 messages/独立系统提示=.md 正文/工具子集**永不含 task**防递归/独立 token 账；复用 streamCompletion+权限门+Pre/PostToolUse hook+checkpoint+artifact；read-only agent 跑 plan 语义只读门；发 `agent:subagent` 生命周期事件，不发 agent:turn 不污染主对话；结束触发 SubagentStop hook）。②主循环加 task 批量分发：全只读→Promise.all 并发 fan-out，含可写→promise 链串行；按原 tc 顺序 await 回填，保证 assistant.tool_calls↔tool 配对不乱。③AgentRequest 加 agentsBlock，注入到 skills 块之后、历史之前（稳定前缀） | 中：新增子循环 + 主循环加批量分发分支（未改既有工具分支）；递归靠 EXCLUDE 剥 task 强制限一层 | 🔧 node typecheck 0 + build 通过 |
                                    | ipc-handlers.ts | 新增 agents:list/setEnabled IPC；agent:send 里构建 agentsBlock + toolCtx.subagents（resolveModel 校验父 models[]，findDef 回落 general-purpose，透传 permissions/批准桥/signal/父 toolCtx） | 低：仿 skills/mcp 同款注入 | 🔧 node typecheck 0 |
                                    | preload index.ts/index.d.ts | 新增 agentsList/agentsSetEnabled/onAgentSubagent + AgentInfo 类型 | 纯新增 | 🔧 typecheck 0 |
                                    | subagent-store.ts（新） | 渲染层子 agent 活动镜像（按 parentCallId 累积 spawned/streaming-text/tool-call/tool-result/done），clearSession 销毁 | 新文件，纯 UI 状态，不参与 LLM 拼接 | 🔧 web typecheck 0 |
                                    | ConfigPanel.tsx | Agents 分区 stub 换成真正 AgentsSettings（仿 SkillsSettings：内置/项目/全局分组、启停、mode 徽标、model 在当前供应商列表内才生效否则标 ⚠ 回落提示、工具白名单展示）；SubagentStop 标 wired:true | 中：新组件 + 读 provider-store models | 🔧 web typecheck 0 |
                                    | ChatView.tsx | task 图标(Bot/violet)+色；onAgentSubagent 监听灌入 subagent-store；ToolBubble 对 task 显示实时状态 pill + 内联 SubAgentCard（名称+模型徽标+mode+实时阶段+可折叠子 agent 工具时间线+流式文本/最终报告+改动文件）；ToolGroup 与普通渲染共用 ToolBubble 故两处都生效 | 中：新增渲染分支，未改 agent:turn 逐字快照契约 | 🔧 web typecheck 0 + build 通过 |

                                    ### 缓存前缀影响（重点）
                                    - **task 工具定义**进入 Anthropic 工具缓存断点（[agent-loop.ts] 打在最后一个工具定义上）。已用「静态 schema」规避：subagent_type 不进 enum、可派发名单移到独立 roster system 块，故启停 agent / 改 model 列表都**不改 task 工具体字节**，不击穿工具定义断点。
                                    - **agentsBlock(roster)** 注入位置与 skillsBlock 同款：系统提示之后、对话历史之前（稳定前缀）。内容只随「启用了哪些 agent」变化，对同一启用集合字节恒定 → 跨轮不漂移、不击穿其后历史断点。同一会话内不动启停则恒定命中。
                                    - 子 agent 自身的消息历史是独立 messages，不并入主对话，**完全不影响主对话的缓存前缀**。

                                    ### 待用户实测
                                    - 建 `.claude/agents/explore.md`（mode: read-only）+ `code-writer.md`（含写工具）各一个，重启后在 设置→Agents 应能看到（内置 general-purpose/code-explorer 也在）。
                                    - 让主 agent 自发派发：复杂任务应能并行 fan-out 多个只读子 agent（多张卡并列、实时状态），含写子 agent 串行执行。
                                    - 子 agent 工具调用应照弹权限审批卡（铁律①）；写操作应建 checkpoint（可回滚）。
                                    - 子 agent 用的模型：父供应商内的 → 用该 model；不在列表 → 回落父模型（Agents 面板 ⚠ 提示）。绝不跨供应商。
                                    - 三协议（anthropic/responses/openai）各跑一轮含 task 的对话，子 agent 应正常运行不报 400。
                                    - 子 agent 卡：运行中转圈+流式进度，完成显示报告+改动文件清单。

                                    ### 静态验证
                                    - `npx tsc --noEmit -p tsconfig.node.json` EXIT 0
                                    - `npx tsc --noEmit -p tsconfig.web.json` EXIT 0
                                    - `npm run build` 通过（built in ~13s）

                                    ---

                                    ## 2026-06-25 — Analytics 缓存命中进度条补齐「创建/新增输入」分段

                                    ### 改动项
                                    | 模块 | 改了什么 | 风险 | 状态 |
                                    |---|---|---|---|
                                    | AnalyticsDashboard.tsx | 缓存命中进度条原先只画了紫色「命中」一段（占 87.5% 等），剩余空槽是底色，导致下方图例里 amber「创建」、blue「新增输入」在条上无对应色块。现新增两个 `<div>`：amber=`cacheCreate/totalPromptTokens`、blue=`(totalPrompt-cacheRead-cacheCreate)/totalPrompt`，三段铺满 100%，与图例颜色对齐。`totalPromptTokens` 本就是总输入（agent-loop 合成=非缓存+创建+命中），故三段分母一致、和为 100% | 纯展示，仅多渲染两个进度条色段，不改数据/统计逻辑 | ⏳ |

                                    说明：纯 UI，不涉及 LLM 消息拼接，无缓存前缀风险。


                                    ## 2026-06-25 — 修复 glob_files：`**/*.x` 漏掉根目录直属文件

                                    ### 改动项
                                    | 模块 | 改了什么 | 风险 | 状态 |
                                    |---|---|---|---|
                                    | tools.ts (globFilesTool) | glob→正则转换：`**/` 原先转成 `.*` 后接 `/`（`.*/` 强制至少一个 `/`），导致 `**/*.html` 只匹配子目录文件、漏掉 baseDir 直属文件（如 `D:\pro1\foo.html`）。改为先把 `**/` 单独转为 `(?:.*/)?`（0 或多个目录层，含根）；`?` 由 `.` 收紧为 `[^/]`（不跨分隔符）。已用独立脚本验证：`**/*.html` 同时匹配 `foo.html`/`login-app/index.html`/`a/b/c.html`，排除 `.css`/`.htmlx` | 改了匹配语义（更符合标准 glob）；`?` 收紧理论上更严格，常见用法不受影响 | 🔧 node typecheck 0 + 正则单测通过 |

                                    ---

                                    ## 2026-06-25 — read_file 读图体积兜底：双闸防超大 base64 进上下文

                                    ### 改动项
                                    | 模块 | 改了什么 | 风险 | 状态 |
                                    |---|---|---|---|
                                    | tools.ts | ①`READ_IMAGE_MAX_BYTES` 20MB → **10MB**（第一道闸，挡超大文件进内存）。②`downscaleImageIfNeeded` 返回类型 `AgentImage` → **`AgentImage \| null`**：新增第二道闸 `SEND_MAX_B64_BYTES=5MB`，覆盖原先「nativeImage 解码失败/无需缩放时原样返回」的危险回退——这些分支若原图 base64 仍超 5MB 则返回 `null`（丢弃），缩放成功的输出经重编码体积已远低于阈值正常返回 | 缩放成功路径行为不变；仅「解不了的异常大图」从「原样塞进请求体」改为「丢弃」，更安全 | ⏳ |
                                    | agent-loop.ts | 调用点把 `.map(downscale)` 改为 `.map(...).filter(im != null)`，过滤被丢弃的图；过滤后为空则不挂 `toolMsg.images` | 仅多一步 filter，正常图不受影响 | 🔧 typecheck 通过 |

                                    说明：背景——视觉模型按像素计 token，图片发送前长边已缩到 1568（约 2~3k tokens），与原始字节无关；10MB/5MB 两闸防的是「解码失败原样发原图」这类边缘情形撑爆请求体，不影响正常图的上下文占用。不改稳定前缀，图片仍只进工具结果消息（历史尾部）。`tsconfig.node.json` EXIT 0。

                                    ---

                                    ## 2026-06-25 — 一批 UI/统计修正（通知跳转 / 默认字体字号 / 状态栏 / 终端 / 缓存命中率 / 斜杠命令）

                                    ### 改动项
                                    | 模块 | 改了什么 | 风险 | 状态 |
                                    |---|---|---|---|
                                    | notify.ts + ipc-handlers.ts + preload | systemNotify 新增第 4 参 `onClick`，点击通知先执行动作再 `focusWindow` 拉回窗口。新增主进程 `window:focus`（最小化则 restore + show + focus）与 preload `focusWindow()` | 通知点击行为变化；focusWindow 为新 IPC | ⏳ |
                                    | ChatView.tsx | 新增 `jumpToSession(sid)`（切 chat 视图 + 激活会话），4 处 systemNotify（完成/等待授权/等待审批/等待回答/进入计划）都传入它作 onClick → 点通知跳到对应会话 | 仅新增点击回调，不改原有提醒触发条件 | ⏳ |
                                    | tailwind.config.ts + app-store.ts + globals.css | 默认字体改为 Inter 优先：tailwind `font-sans` 与 app-store `DEFAULT_SANS` 都把 "Inter" 提到首位；默认聊天字号 14→13（loadChatFontSize 兜底值 + globals.css `--chat-font-size` 兜底） | 影响所有未自定义字体/字号用户的默认观感；已存 localStorage 的用户不受影响 | ⏳ |
                                    | StatusBar.tsx | 删除右下角项目路径显示（多处已有），移除未用的 projectPath 解构 | 纯删除展示 | ⏳ |
                                    | TerminalPane.tsx + StatusBar(MiniTerminal) + SecondaryBar | 修复「打开就有两个终端」：TerminalPane.startSession 加 `startingRef` 单飞锁（原先 StrictMode 双调用各建一个）。终端默认名 "Claude"→"Shell"（实际只是普通 shell），去掉无意义的 `model: "sonnet"` 入参 | 单飞锁极端时序下可能延迟首个终端创建（finally 复位）；命名纯展示 | ⏳ |
                                    | chat-store-manager.ts + AnalyticsDashboard.tsx | 修正缓存命中率：promptTokens 已含 cache_read（OpenAI 规范 + Anthropic 合成均如此），原公式分母 `cacheRead+prompt` 双重计数致命中率最高只到 50%。改为分母=prompt。命中条形图与「新增输入」明细同步：新增输入=prompt−cacheRead−cacheCreate | 统计口径变化：历史数据命中率显示会变高（更正确） | ⏳ |
                                    | AnalyticsDashboard.tsx | 模型统计表新增 `<tfoot>` 总计行（对话/轮次/输入/输出/缓存命中/Tokens 汇总） | 纯展示新增 | ⏳ |
                                    | slash-commands.ts | 删除 `/mcp` 与 `/settings`(`/config`) 两个斜杠命令。SlashContext.openSettings 保留（无害未用） | 用户不能再用这两个斜杠命令打开设置（仍可从侧栏进） | ⏳ |

                                    说明：以上不涉及 LLM 消息拼接，无缓存前缀风险。`tsc --noEmit` web 与 node 均 EXIT 0。

                                    ---

                                    ## 2026-06-25 — read_file 支持读取图片并回灌给视觉模型

                                    ### 改动项
                                    | 模块 | 改了什么 | 风险 | 状态 |
                                    |---|---|---|---|
                                    | tools.ts | `read_file` 按扩展名识别图片（png/jpg/jpeg/gif/webp/bmp）。命中则不按文本逐行加行号，改走新 helper `readImageFileTool`：读字节 → 经 `ctx.collectImages` 把 `{mime,base64}` 交给 agent-loop 回灌通道（与 capture_window 同路），并打 `GENERATED_IMAGE_PATHS` 标记复用 UI 缩略图。新增 20MB 字节上限（超限拒绝并提示缩放），缩放仍由 agent-loop 侧 `downscaleImageIfNeeded` 统一做。无回灌通道/vision 关闭时返回文字说明而非像素。`executeTool` 把 `ctx` 透传给 `readFileTool`；新增 `extname` import；更新工具 description 说明可读图 | 文本读取路径完全不变（仅在扩展名命中图片白名单时分流）；图片走既有成熟通道，无新协议 | ⏳ |
                                    | ChatView.tsx | 3 处按工具名 gate 的图片处理（`countToolImages` 计数、`groupImages` 聚合、Output 文本剥离 `GENERATED_IMAGE_PATHS`）追加 `read_file`，使读图能显示缩略图并剥离机器标记行。文本读取无该标记，`parseGeneratedImagePaths` 返回空、剥离正则不匹配，故纯文本读不受影响 | 仅 UI 展示分支扩容，文本读取行为不变 | 🔧 typecheck 通过 |

                                    说明：图片字节经 collectImages → `_imgBuf` → tool 消息的 `images` 回灌，属工具结果消息（历史尾部追加），不改 system/工具定义等稳定前缀，不破坏缓存前缀。`tsconfig.node.json` 与 `tsconfig.web.json` 均 EXIT 0。

                                    ---

                                    ---

                                    ## 2026-06-25 — 修「直接出图跨轮失忆」(模型重复生成已出过的图)

                                    ### 背景
                                    据第二份传输日志分析（问候会话第二次跑）：deepseek 在已经请求过「生成一张草地」后，下一轮又调了一次 generate_image。日志全量搜索证实——历史里**只有 `user: 生成一张草地` 这条请求，没有任何「图已生成 / 保存路径」记录**，模型视角里那张图从未存在过。

                                    根因：直接出图路径（非 agent loop，[ChatView.tsx] runDirectImage）成功时把占位 assistant 的 `content` 置为**空字符串**，图片路径只进 `images` 字段。而 buildReplayMessages / 后端 buildApiMessage 都**不读 assistant 的 images** → 模型跨轮看不到出图事实，于是重复调用、也无法引用刚生成的图。（与上一条的「空 assistant 去噪」无因果：即便不去噪，那条空字符串消息对模型同样无信息。）

                                    ### 改动项

                                    | 模块 | 改动 | 缓存前缀影响 | 状态 |
                                    |---|---|---|---|
                                    | ChatView.tsx (runDirectImage 成功分支) | 成功 okText 从 `""` 改为「已生成图片并保存到：\n- 路径...」的模型可读文本；图片仍挂 images 字段在气泡显示 | 无（历史尾部新增内容，按时间序追加） | 🔧 tsc+build 通过 |

                                    ### 连带效果
                                    - 模型跨轮知道图已生成 + 路径 → 不再重复出图、可引用刚生成的图做后续操作。
                                    - 该 content 非空 → 不会被回放阶段 C「空 assistant 去噪」误丢（双重保险）。
                                    - UI：气泡顶部多一行「已生成图片并保存到 …路径」，下方仍正常显示图片缩略图。

                                    ### 待用户实测
                                    - 重跑：先「生成一张草地」（直接出图成功），下一轮问「刚才的图存哪了 / 再改一下」——模型应能答出路径、不再重复生成。
                                    - 出图失败时仍显示原失败文案（未改失败分支）。

                                    ### 静态验证
                                    - `npx tsc --noEmit` 通过（无错误）
                                    - `npm run build` 通过（built in ~14s）

                                    ---

                                    ## 2026-06-25 — 设置页：配置导入/导出（全分区，增量合并）

                                    ### 改动项
                                    | 模块 | 改了什么 | 风险 | 状态 |
                                    |---|---|---|---|
                                    | ConfigPanel.tsx | ①把分区「外观」标签改名为「设置」（id 仍 `appearance` 不变，深链/次级栏不受影响）；②AppearanceSettings 头部新增「导出配置 / 导入配置」两个按钮，标题由「外观」改「设置」，挂载 `ConfigTransfer` 对话框 | 纯 UI；改了 configSections 标签文本（SecondaryBar 复用），id 未变故路由稳定 | ⏳ |
                                    | ConfigTransfer.tsx（新） | 导入/导出模态框：导出按分区勾选（空分区灰显「无内容」）、提示含明文密钥风险，经 `saveFile` 落盘；导入选文件→`parseBundle` 校验→勾选分区→`importConfig` 合并 | 新组件，独立挂载；失败有 error 文案兜底 | ⏳ |
                                    | config-transfer.ts（新） | 各分区 collect/apply 逻辑：providers(按**全字段签名**去重：name/url/模型列表/协议/headers 等完全一致才视为同项不重复，仅模型不同的副本各自保留；含明文 key)、search(key+启用 OR 合并)、appearance(主题/字体/通知)、CLAUDE.md(三级，已含则跳过否则追加分隔块)、memory(memorySave 按 name+source 天然去重)、mcp(按 id 合并后 reconnectAll)、skills(启用态)、hooks(按 JSON 签名去重追加)、permissions(逐工具覆盖)、discord(配置+token)。导入一律**增量合并**不整体覆盖 | 导出含明文 API key / Discord token（设计如此，UI 已警告）；CLAUDE.md 追加用固定分隔标记 `# --- 导入合并 ---` | ⏳ |
                                    | ipc-handlers.ts | 新增 `dialog:saveFile`（showSaveDialog + writeFile，配置导出用）；与既有 `chats:saveImageAs` 同模式 | 仅新增 handler，不改现有 | 🔧 typecheck 通过 |
                                    | preload/index.ts、index.d.ts | 新增 `saveFile(opts)` 桥接与类型 | 纯新增 | 🔧 typecheck 通过 |

                                    说明：不涉及 LLM 消息拼接，无缓存前缀风险。`tsc --noEmit -p tsconfig.web.json` 与 `tsconfig.node.json` 均 EXIT 0。
                                    注意：导入后部分设置（字体/主题即时生效；MCP 会自动 reconnect；权限/discord 即时落盘）个别可能需重开面板刷新显示。

                                    ---

                                    ## 2026-06-25 — 会话列表 hover 增加最后消息时间显示

                                    ### 改动项
                                    | 模块 | 改了什么 | 风险 | 状态 |
                                    |---|---|---|---|
                                    | ChatView.tsx | 新增 `sessionLastTime(session)` 取会话最后一条带 timestamp 的消息：10 分钟内显示「刚刚 / xx分钟前」，否则格式化为 `HH:MM`（如 21:20）。会话列表项在已有「hover 显示 token」旁，新增 hover 显示该时间（同样 `group-hover:inline`、灰色等宽小字），放在 token 角标左侧 | 纯展示，仅新增一个 helper + 一段 hover 文本，不改数据/逻辑 | ⏳ |

                                    说明：纯 UI，不涉及 LLM 消息拼接。typecheck `tsconfig.web.json` EXIT 0。

                                    ---

                                    ## 2026-06-25 — 修复首开软件用生图模型必报「未配置 provider」

                                    ### 改动项
                                    | 模块 | 改了什么 | 风险 | 状态 |
                                    |---|---|---|---|
                                    | provider-store.ts | 模块末尾新增启动期 `setTimeout(() => refreshKeyFlags(), 0)`，开机即填充各 provider 的 `hasKey`。根因：`hasKey` 不持久化、默认 undefined，原先仅在打开供应商设置面板时才刷新；`listImageProviders()` 用 `p.hasKey` 过滤，故首开直接发图必返回空 → `buildImageGenConfig` 返回 undefined → 报「未配置 provider」，点一下设置再回来才正常。与 search-store 已有的同款启动刷新逻辑对齐 | 仅新增一次启动期异步刷新，不改现有调用；与 search-store 模式一致 | ⏳ |

                                    说明：不涉及 LLM 消息拼接，无缓存前缀风险。typecheck 本文件无新增报错。
                                    补充：本修复同时让生图「系统提示词」首开即注入——该提示词由 agent-loop 据 `toolCtx.imageGen.providers` 池生成，与工具走同一条 `buildImageGenConfig` 链，原先首开 `hasKey` 全 falsy 时连同提示词一起缺失。该提示词位于历史前缀、对同一配置字节恒定，本改动只影响其首开是否存在，不改内容/位置，不破坏缓存前缀。

                                    ---

                                    ## 2026-06-25 — 修复 web typecheck 既存报错（与生图无关）

                                    ### 改动项
                                    | 模块 | 改了什么 | 风险 | 状态 |
                                    |---|---|---|---|
                                    | ArtifactPanel.tsx | 拖拽 onMove 闭包内引用 `rect.width/height` 报 `'rect' possibly undefined`（TS 控制流收窄不跨闭包）。改为在闭包外把宽高取成局部 `rectWidth/rectHeight` 再引用 | 仅类型/取值时机，运行时行为不变 | 🔧 typecheck 通过 |
                                    | MemorySettings.tsx | ①import 路径 `../../../preload/index.d` 少一层 `../`（该文件在 components/config/ 下），改为 `../../../../preload/index.d`，与同目录 McpMarketplace/PermissionsSettings 一致；②`useAppStore.projectPath` 为 `string\|null`，传给 `load(string\|undefined)` 不兼容，新增归一化 `projectDir = projectPath \|\| undefined`，3 处 load 调用改用之 | 仅类型修正，逻辑不变（null→undefined 对 load 等价） | 🔧 typecheck 通过 |

                                    说明：均为本次之前就存在的报错，非本次生图改动引入；不涉及 LLM 消息拼接。`npx tsc --noEmit -p tsconfig.web.json` 已 EXIT 0。

                                    ---

                                    ## 2026-06-25 — 修复拖入非图片文件无法获取路径

                                    ### 改动项
                                    | 模块 | 改了什么 | 风险 | 状态 |
                                    |---|---|---|---|
                                    | preload/index.ts | 引入 `webUtils`，新增 `api.getPathForFile(file)`（包 `webUtils.getPathForFile`，异常返回 ""）。根因：Electron 33 已移除 `File.path`，旧代码读 `(file as any).path` 恒为 undefined，故所有非图片文件都落到「无法获取该文件的路径」 | preload 暴露新 API；不破坏现有调用 | 🔧 typecheck 通过 |
                                    | preload/index.d.ts | `CodeweaverAPI` 增加 `getPathForFile` 类型 | 仅类型 | 🔧 typecheck 通过 |
                                    | ChatView.tsx | `addPathFile` 优先用 `api.getPathForFile(file)` 取真实绝对路径，失败回退旧 `(file as any).path`，再失败才提示 | 路径来源变更；需实测拖入 .txt/.pdf 等非图片文件能成功加为「文件」附件并把绝对路径发给 AI | ⏳ |

                                    说明：拖入图片仍走 `addImageFile`（不受影响）；本改动不涉及 LLM 消息拼接，无缓存前缀风险。

                                    ---

                                    ## 2026-06-24 — 生成超时上限 60s → 90s

                                    ### 改动项
                                    | 模块 | 改了什么 | 风险 | 状态 |
                                    |---|---|---|---|
                                    | ChatView.tsx | agent 轮次的 `setGenerating(..., 60000)` 4 处全改 90000（runTurn 主路径 + 审批/followup/alwaysAllow 续跑）；心跳看门狗兜底默认 `|| 60000`→`90000`；颜色插值兜底同改；相关注释 60s→90s | 直接出图路径仍 120000（不变）；超时由 genTimeout 按会话存储，颜色按 elapsed/limit 计算，自动跟随到 90s | ⏳ |
                                    | chat-store.ts | setGenerating 缺省上限 `60000`→`90000`；注释「轮次 60s」→「90s」 | 仅影响未显式传 timeoutMs 的兜底（实际调用都显式传），低 | 🔧 typecheck 通过 |

                                    说明：每个 turn 回传都会刷新进度起点，故只有真静默 90s 才触发自动终止+红叹号；颜色 0s 紫 → 90s 红 随之拉长。

                                    ---

                                    ### 背景
                                    开传输日志跑「问候」会话后离线分析发现三处问题（详见日志 cache_read 回退 + 逐请求最长公共前缀分析）：
                                    1. **生图提示位置漂移击穿缓存**：出图能力 system 提示在 [agent-loop.ts] 历史循环**之后**注入，同一轮内位置固定，但跨轮历史变长后它从 `[7]` 漂到 `[11]`，其后整段历史缓存断点全失效（cache_read 从 11904 掉回 11520）。该提示内容对同一图片供应商配置字节恒定（6 次请求 hash 全为 4609afd1），本应进稳定前缀。
                                    2. **孤儿工具组被整组丢弃**：模型某轮只吐 tool_calls、无文字时，TurnEmitter 不建 assistant 气泡，落库只剩平铺 tool 消息。buildReplayMessages 阶段 A 对孤儿 tool 直接跳过 → 整组工具历史（glob/glob/list）丢失、跨轮失忆、且与上一轮前缀错位。
                                    3. **空 assistant 占位噪音**：直接出图路径（非 agent loop）留下空文本 assistant 占位，回放时无条件保留，纯噪音。

                                    ### 改动项

                                    | 模块 | 改动 | 缓存前缀影响 | 状态 |
                                    |---|---|---|---|
                                    | agent-loop.ts | 出图能力 system 提示从「历史循环之后」移到「memoryBlock 之后、历史循环之前」，进稳定缓存前缀；删除原尾部注入点 | **修复**：消除跨轮位置漂移，其后历史重新稳定命中缓存 | 🔧 tsc+build 通过 |
                                    | ChatView.tsx (buildReplayMessages 阶段A) | 新增孤儿 tool 组处理：无前置 assistant 的连续 tool 消息，合成一个 content="" 的 assistant 承载这批 tool_calls 再补结果，使协议配对合法、历史完整可见 | 无害：补回的是稳定历史，按时间序追加 | 🔧 tsc+build 通过 |
                                    | ChatView.tsx (阶段C) | 丢弃空文本、无 tool_calls 的 assistant 占位（直接出图残留空壳） | 无：本就不该进前缀 | 🔧 tsc+build 通过 |

                                    ### 三协议「连续 user 消息」安全性核查
                                    丢空 assistant 后可能出现连续两条 user。已核：Anthropic 有相邻同角色合并逻辑 [agent-loop.ts:1120]；OpenAI /chat 与 Responses 均接受平铺多条 user item。**不会引入 400**。

                                    ### 离线验证（对真实落库 session 复刻回放）
                                    - 修复后回放：孤儿组 glob/glob/list 完整保留并合法配对（assistant.tool_calls=3 + 3 条 tool 结果）；空占位已清除；read_file 历史完整。共 15 条，结构正确。
                                    - system[0] 与生图提示跨 6 次请求 hash 恒定，确认内容侧无变动、问题纯属位置。

                                    ### 待用户实测
                                    - 重跑类似会话（含「只调工具不说话」的轮次 + 中途出图 + 换模型），看传输日志：跨轮 cache_read 不再回退、公共前缀比例回升。
                                    - 三协议各跑一轮多工具对话不报 400（验证孤儿组配对 + 连续 user 合并）。
                                    - 出图会话跨轮后模型仍知道图片路径、不丢工具历史。

                                    ### 静态验证
                                    - `npx tsc --noEmit` 通过（无错误）
                                    - `npm run build` 通过（built in ~12s）

                                    ---

                                    ## 2026-06-25 — 修「中断后头像名字消失」(盖章兜底，防尾随快照抹掉)

                                    ### 背景
                                    上一条「历史消息盖章模型」上线后出现回归：agent 报错/中断（如出图后 connect ETIMEDOUT）
                                    后，消息头像与名称消失。根因：runStampRef 在收到 done 时被删除，若同 runId 之后还有一次
                                    尾随的 applyTurn（收尾/中断快照，此时 stamp 已为 undefined），会把消息的 modelName/
                                    providerName 重建成空。

                                    > 另：用户报告一条 React 警告「Cannot update a component (ChatView) while rendering a
                                    > different component (ChatSecondary)」。通读 ChatSecondary/TodoRoadmap 渲染体未发现渲染期
                                    > setState/store setter 的坏调用，且无法复现，**暂不改动**，避免乱改引新问题。

                                    ### 改动项

                                    | 模块 | 改动 | 风险 | 状态 |
                                    |---|---|---|---|
                                    | chat-store.ts | applyTurn 重建块时，若本次未带 stamp，则从同 runId 旧消息已盖的 modelName/providerName 兜底（同既有按 toolCall.id 保留 images 的机制）。无论 stamp 何时被删/事件乱序，都不会把已盖的章抹掉 | 低：纯兜底，self-heal | 🔧 typecheck+build 通过 |

                                    ### 缓存前缀影响
                                    无。纯渲染/持久化字段，不参与发往 LLM 的消息拼接。

                                    ### 待用户实测
                                    - 出图/普通轮次中断或报错后，消息头像与名称应仍在（不再消失）。

                                    ---

                                    ## 2026-06-24 — 历史消息锁定「当时实际使用的模型」头像/名称

                                    ### 背景
                                    历史 assistant/工具消息的头像与名称用的是 `selectedModel/selectedProvider`（当前选择），
                                    所以在一个会话里换了模型后，**之前的消息头像/名称全部跟着变**，与消息内容不再匹配。
                                    应该记录消息产生**当时实际使用**的模型，历史不随之后切换而变。

                                    ### 改动项

                                    | 模块 | 改动 | 风险 | 状态 |
                                    |---|---|---|---|
                                    | chat-store.ts | ChatMessage 增 `modelName?`/`providerName?`（产生时定格）；toRecordSession 落盘 | 类型扩展 + 落盘字段 | 🔧 typecheck+build 通过 |
                                    | chat-store.ts | applyTurn 增第 5 参 `stamp{modelName,providerName}`，给本轮重建的每条消息盖章 | 低 | 🔧 |
                                    | ChatView.tsx | 新增 runStampRef(runId→{model,provider})：runTurn 发起时按该轮实际 model/sessProvider 定格；agent:turn 回传时传给 applyTurn；done 后清理。即使流式中途切模型也锁发起时的 | 中：关键修复点 | ⏳ |
                                    | ChatView.tsx | runDirectImage 占位 assistant 消息盖上本次出图供应商/模型名 | 低 | ⏳ |
                                    | ChatView.tsx | AgentMessage / ToolGroup 渲染改用 `msg.modelName/providerName`（ToolGroup 用组首消息），旧消息无字段时回退当前选择 | 低 | ⏳ |

                                    ### 缓存前缀影响
                                    无。纯渲染/持久化字段，不参与发往 LLM 的消息拼接。

                                    ### 待用户实测
                                    - 会话内换模型后，**之前**的消息头像/名称应保持当时的模型不变，只有新消息用新模型；
                                    - 重启后（已落盘）历史仍显示各自当时的模型；
                                    - 旧会话（无 modelName 字段）仍能正常显示（回退当前选择，不报错）。

                                    ---

                                    ## 2026-06-24 — 模型选择改为「按会话」(修跨会话模型串台 + 图片模型被当文字 agent 报 400)

                                    ### 背景
                                    模型/供应商选择原本是全局单值（useProviderStore.selectedProviderId/selectedModel + localStorage），与会话无关：
                                    1) 切到任何会话，底部都显示「上次手选」的模型，而非该会话原本在用的（你说的 gemini 会话显示成 deepseek）；
                                    2) 更严重——`runTurn` 实际发送也取全局值，会真的用错模型发请求；
                                    3) 图片供应商路由 `selectedProvider.imageGen` 也走全局：若全局没指向被标 imageGen 的供应商，会让一个出图模型走 agent-loop（永远带 tools），Vertex 返回 "Only google search tool ... supported for image response." 400。

                                    ### 改动项

                                    | 模块 | 改动 | 风险 | 状态 |
                                    |---|---|---|---|
                                    | chat-store.ts | ChatSession 增 `providerId?` 字段；createSession 第三参 providerId 并存储；toRecordSession/loadFromDisk 落盘与回读；新增 setSessionModel(id,providerId,name,model) | 类型扩展 + 落盘字段 | 🔧 typecheck 通过 |
                                    | ChatView.tsx | selectedProviderId/selectedProvider/models/selectedModel 改为**从当前会话派生**（providerId 命中→用；否则按 provider 名兜底匹配旧会话；再否则用全局默认）。全局 selectedProviderId/Model 降级为「新会话默认」(defaultProviderId/Model) | 中：核心派生逻辑重写 | 🔧 typecheck 通过 |
                                    | ChatView.tsx | setSelectedProviderId/setSelectedModel 改为写**当前会话**(setSessionModel) + 顺带更新全局默认；只影响当前会话，不动其他会话 | 中 | ⏳ |
                                    | ChatView.tsx | 新增 resolveSessionProvider(sessionId)：从 live store 解析任意会话(含后台/队列)的 provider+model；runTurn 改用它(不再读闭包活动会话)，imageGen 配置按该会话 provider 构建 | 关键：修队列/后台会话用错模型 | ⏳ |
                                    | ChatView.tsx | runDirectImage 默认供应商改为 resolveSessionProvider(sessionId).providerId（原取全局 selectedProviderId） | 中 | ⏳ |
                                    | ChatView.tsx | createSession 全部调用点传入 selectedProviderId（含 onNewSession 用全局默认） | 低 | 🔧 |
                                    | StatusBar.tsx | 底部余额显示改为按「活动会话的 provider」(providerId 命中/名字兜底/全局默认)，与 ChatView 一致 | 低 | 🔧 typecheck 通过 |

                                    ### 缓存前缀影响
                                    无。本改动只切换「发给哪个 provider/model」，不改消息历史拼接顺序、不动 system/工具定义/历史前缀。图片直发路径仍只发 prompt、不带历史与 tools（未改）。

                                    ### 待用户实测
                                    - 多个会话分别用不同模型（如 A=gemini, B=deepseek），来回切换：底部显示应各自正确，不再串台；
                                    - 在 B 选 deepseek 后回到 A 发消息，应仍发给 gemini（看传输日志/回复风格）；
                                    - 图片供应商会话发描述应走直发出图、不再 400；
                                    - 队列：A 忙时排队的消息，drain 时应用 A 自己的模型，不受当前在看会话影响。

                                    ---

                                    ## 2026-06-24 — 角标四项修正（紫点/颜色/生图超时/等待不被杀）

                                    ### 背景
                                    1) 转圈生成中残留的旧完成灰勾/失败叹号会和转圈同现，被误当成「转圈产生紫点」；
                                    2) 转圈颜色用 hsl 色相 265→0，途中经过蓝/绿/黄（应只紫→红）；
                                    3) 直接出图比 agent 慢，60s 超时太短；
                                    4) AI 等待用户审批/回答时，loop 阻塞无 turn 回传，被心跳 60s 误判卡死而终止。

                                    ### 改动项

                                    | 模块 | 改动 | 风险 | 状态 |
                                    |---|---|---|---|
                                    | ChatView.tsx | 新一轮开始（runTurn / run-state=true / runDirectImage）一并清掉上一轮残留的 completed 灰勾 + failed 叹号，避免与转圈同现被误当「转圈产生角标」。紫点只由完成/失败/问题/审批触发，generating 永不触发 | 低 | ⏳ |
                                    | ChatView.tsx | genColor 改 RGB 直接插值 紫#a855f7→红#ef4444（不走 hsl 色相，杜绝蓝绿黄过渡）；按该会话 genTimeout 算进度 | 低 | ⏳ |
| chat-store.ts | generating 伴生 genTimeout(每会话超时上限);setGenerating 第三参 timeoutMs(刷新进度保留原上限) | 类型扩展 | 🔧 |
| ChatView.tsx | runTurn 60s / runDirectImage 120s 写入 genTimeout;心跳与颜色都按各自上限 | 低 | ⏳ |
| ChatView.tsx | 心跳跳过 pendingApproval/pendingFollowup 会话(等你≠卡死);收到审批/followup 时清 generating(改问号角标),答复后(respondApproval/submitFollowup/respondAlwaysAllow)重新点亮转圈 | 关键:修「等待回答被超时终止」 | ⏳ |
| ChatView.tsx | runDirectImage 成功收尾补 setSessionCompleted(true) 灰勾(此前只在失败设角标,成功漏挂),与 agent 轮次一致 | 低 | ⏳ |
| chat-store.ts | 紫点只提示「非当前活动会话」的更新:setPendingApproval/Followup/SessionFailed 的 badgeUnread 条件加 activeSessionId!==sessionId;当前在看的会话状态更新不再点亮紫点 | 低 | ⏳ |

### 等待态状态机补充
- 收到 approval/followup → 清 generating（转圈灭）+ pending 点亮问号角标 + 紫点
- 心跳遇 pending 会话 continue（绝不 stop）
- 用户答复 → 清 pending（问号灭）+ 若仍 busy 重新点亮转圈（紫）
- 下一个 turn 回传继续刷新进度

---

## 2026-06-24 — 转圈/失败角标状态机重构（修「已终止仍转圈」「圈不变红」「失败不立即变」）

### 背景
上一版转圈角标依赖主进程单一 run-state/done 事件清除，事件丢失/延迟时转圈永不停（终止后好几分钟还在转）；颜色用 CSS 动画 + key 重挂，streaming 每条快照都重挂→永远紫；失败路径清 generating 不全，不满 60s 失败仍转圈。

### 改动项

| 模块 | 改动 | 风险 | 状态 |
|---|---|---|---|
| ChatView.tsx | setSessionBusy(false) 连带清 generating：转圈生命周期严格绑定 busy，任何不忙路径都立刻停转圈 | 根本保证，不会再「已终止仍转圈」 | ⏳ |
| ChatView.tsx | 新增全局心跳看门狗(每秒一跳,不依赖任何 IPC):扫描 generating 会话,now-lastProgress≥60s 强制 agentStop+清 busy+标红失败;并驱动颜色每秒重算 | 兜底一切静默卡死;空闲不空转 | ⏳ |
| chat-store.ts | generating 语义由「tick」改为「最近进展时间戳」;颜色按 now-该值在 0→60s 内插值 | 类型不变(number) | 🔧 |
| ChatView.tsx (ChatSecondary) | 转圈颜色改 React 内联 hsl 插值(265°紫→0°红)+有 generating 时每秒本地 tick 重渲染;去掉 CSS key 重挂 | 修「永远紫」 | ⏳ |
| globals.css | animate-gen-spin 改回纯旋转;删除 cw-gen-color 颜色动画 | 低 | 🔧 |
| ChatView.tsx | agent:error 分支:除 context_overflow「正在自动重试」中间态外,任何 error 立即清 generating+标红叹号(不等 60s);二次溢出停手同样立即标红 | 修「失败不立即变」;若 error 后 loop 恢复 done 会清 failed 显示成功 | ⏳ |
| ChatView.tsx | done 分支成功完成时 setSessionFailed(false)(成功覆盖失败);runTurn 发出即设 generating+清 failed(不等 run-state) | 成功>失败优先级 | ⏳ |
| ChatView.tsx | 移除旧的 per-error setTimeout 看门狗(被全局心跳取代);clearErrorWatchdog 保留为空操作 | 低 | 🔧 |

### 状态机（最终）
- 发送/runTurn → generating=now(紫) + failed=false；每个 turn 快照刷新 generating=now(回紫)
- done → 清 generating + failed=false + completed(灰勾)
- 任意 error(非重试中间态) → 立即清 generating + failed=true(红叹号)
- run-state=false 且本轮未 done → failed=true（兜底）
- 心跳:generating 且 60s 无进展 → stop + failed=true
- 手动 stop → turnDone=true(不算失败) + 清 generating

---

## 2026-06-24 — generate_image 工具支持 AI 按指令切换供应商/模型/保存目录

### 背景
此前 agent 调 generate_image 工具时，供应商/模型/保存位置全写死（saveDir 固定 documents，只注入单一供应商），AI 听不懂「换个模型出图」「存到 assets/img」。

### 改动项

| 模块 | 改动 | 风险 | 状态 |
|---|---|---|---|
| tools.ts | generate_image 工具新增可选参数 provider / model / save_dir（描述里注明仅用户明确要求时才传） | 低，向后兼容(全可选) | 🔧 build 通过 |
| tools.ts | ToolContext.imageGen 扩展 projectRoot + providers[](各带 name/baseUrl/apiKey/model/models/endpoint) | 含解密 key，仅主进程内存 | 🔧 |
| tools.ts | generateImageTool：按 provider 名(大小写不敏感/包含匹配)切换、model 直用、save_dir 相对路径按项目根解析(绝对原样)；找不到供应商回退默认并在结果里注明 | 中，匹配/路径解析逻辑 | ⏳ |
| ipc-handlers.ts | agent:send 注入 imageGen 时一并解密所有图片供应商 key 组成 providers[]，并带上 projectRoot | key 不离开主进程 | 🔧 |
| agent-loop.ts | 配了图片供应商时，尾部注入一条 system 提示，列出可用供应商及其 models，告知可用 provider/model/save_dir 参数(仅用户明确要求时) | 放尾部不破缓存前缀 | 🔧 |
| ChatView.tsx | buildImageGenConfig 返回值增加 providers[]（含每个供应商 id/name/models），随 agentSend.imageGen 发往后端 | 低 | 🔧 |
| tools.ts | 顺手修 runCommandTool 既有 tsc 报错：resolveShell() 返回 string\|boolean，exec 的 shell 只接受 string，仅字符串时传入；stdout/stderr 用 String() 归一。node typecheck 现 exit 0 | 低 | 🔧 tsc 通过 |

### 缓存前缀（已逐路径核实，非泛泛而谈）
图片能力 system 提示在 runAgentLoop 里于 `req.messages`（对话历史）**之后**push。两条转换路径都靠 `seenConv` 门控：system 消息只有出现在任何对话内容之前才进缓存前缀（Anthropic top-level system / Responses instructions），对话开始后出现的 system 一律内联成 user 落尾部。本注入在历史 push 之后 → seenConv 已 true → 落尾部增量，不进 system/tools/历史前缀。OpenAI 路径无显式断点、自动前缀缓存按首部字节，本注入在末尾同样不扰动。**唯一理论边界**：req.messages 为空时 seenConv 仍 false、注入会落入前缀——但每轮必带当前用户消息，实际不会发生。安全等级与既有 to-do 路线图注入完全相同。

---

## 2026-06-24 — 发送/终止按钮可靠化 + 会话角标（完成勾 + 未读紫点）

### 背景
1. 模型意外中断时发送按钮仍显示终止；模型只是卡住时终止按钮却变回发送。根因：busy 由渲染层多事件推断，`agent:error` 在非致命提示（如 max_tokens 截断）时也清 busy（卡了变发送），异常退出路径又可能漏发对应事件（中断了仍显示终止）。
2. session 列表已有问号角标（需用户行动才消，正确保留）；需新增「任务完成」灰勾角标（已阅即消），并在折叠（按钮态）下用紫点提示有新角标。

### 改动项

| 模块 | 改动 | 风险/缓存 | 状态 |
|---|---|---|---|
| ipc-handlers.ts | agent:send 启动发 `agent:run-state {running:true}`，finally 发 `{running:false}`（正常/报错/abort 全覆盖）。runningLoops 是唯一权威 | 不影响发往 LLM 的消息前缀（纯 IPC 事件） | 🔧 typecheck 通过 |
| preload index.ts/.d.ts | 暴露 `onAgentRunState` 监听器 | 低，纯新增 | 🔧 |
| ChatView.tsx | 新增 run-state 监听：busy 以它为权威真相源切换发送/终止按钮 | 与 done 分支同向清 busy，不冲突 | ⏳ |
| ChatView.tsx | agent:error 分支不再清 busy（交给权威 run-state）。叠加错误看门狗兜底：error 时若会话仍 busy 启动 **60s** 超时，期间无 run-state=false / 无新 turn 进展则自动 agentStop + 清 busy + 标红失败 + 提示，绝不卡在终止态 | 看门狗被 run-state/turn 进展/手动 stop/卸载清除，不会误杀正常长任务（有进展即续命） | ⏳ |
| chat-store.ts | 新增 `generating`(会话正在生成,value=tick) + `sessionFailed`(失败/超时红叹号,读会话即清,新一轮清);setActiveSession 读即清失败叹号 | 瞬态不落盘 | 🔧 |
| ChatView.tsx | run-state=true 点亮转圈(紫,清上轮失败);run-state=false 若本轮未收到 done(turnDoneRef)则标红失败;onAgentTurn 每次回传 bump generating tick(刷新回紫);done 标 turnDone+清转圈;handleStop 视作正常收尾(不标红) | 直接出图(runDirectImage)不经 loop 无 run-state,不显示转圈(可接受) | ⏳ |
| globals.css | 新增 cw-spin(持续旋转) + cw-gen-color(60s 紫→橙→红 forwards);.animate-gen-spin/.animate-gen-color | 低,纯新增 | 🔧 |
| ChatView.tsx (ChatSecondary) | 列表项角标优先级:生成中转圈(外层旋转+内层按 tick 重挂渐变) > 失败红叹号(AlertCircle text-red-500) > 问号 > 完成灰勾 | 低 | ⏳ |
| flavor-text.ts | 新增 30 句游戏梗失败语(FAILURE_PHRASES,{name}占位)+ERROR_HINTS(image/insufficient/tls/timeout/429/401/context 等13条匹配→可能原因)+prettyModelName(品牌归一)+randomFailurePhrase+matchErrorHint+buildFailureNotice | 低,纯新增;失败语每次随机固定一句写入对话流不再变 | 🔧 |
| ChatView.tsx | 所有失败/终止统一游戏梗提示:普通 agent:error、二次溢出停手、看门狗超时(60s)均用 buildFailureNotice/randomFailurePhrase(模型名取自会话 model/provider 归一) | 报错原文仍完整保留在提示末尾(供排查) | ⏳ |
| ChatView.tsx | 覆盖直接出图(runDirectImage):手动驱动 generating(转圈)+成功清+失败设 sessionFailed(红叹号),失败文案改用 buildFailureNotice 游戏梗;deps 补 selectedProvider | 出图路径不经 loop,角标/提示现与 agent 轮次一致 | ⏳ |
| ChatView.tsx | onAgentTurn done 分支新增 `setSessionCompleted(sid,true)` 挂完成灰勾 | 低 | ⏳ |
| chat-store.ts | 新增 `sessionCompleted`(灰勾,读会话即清)、`badgeUnread`(紫点)；setPendingApproval/Followup/setSessionCompleted 出现新角标时置 badgeUnread；setActiveSession 读即清该会话灰勾 | 瞬态不落盘，不影响缓存前缀 | 🔧 |
| ChatView.tsx (ChatSecondary) | 历史按钮加紫点(badgeUnread)，点开列表 clearBadgeUnread；列表项问号角标旁新增完成灰勾(CircleCheck, animate-bounce-soft) | 低 | ⏳ |

### 说明
- 问号角标（pendingApproval/pendingFollowup）维持「必须行动才消」原状，不改。
- 灰勾、紫点均「已阅即消」：切到该会话清灰勾；点开历史列表清紫点（不论角标是否还在）。
- 当前活动会话回合完成不点亮灰勾（用户正在看，store 内 setSessionCompleted 对 activeSessionId 跳过）。

---

### 背景
选中图片供应商直接出图时总弹「保存位置/供应商」设置卡，多一步确认；且生成结果（含 agent 调用 generate_image/capture_window）图片塞在工具气泡内部，不够直观。

### 改动项

| 模块 | 改动 | 风险 | 状态 |
|---|---|---|---|
| chat-store.ts | 新增 updateMessage(按 id 局部更新消息并落盘)，供直接出图回填占位 assistant 消息 | 低，纯新增 action | 🔧 typecheck 通过 |
| ChatView.tsx | runDirectImage：不再建 tool 占位消息，改建 assistant 消息，出图后把图片挂到 message.images，直接在聊天气泡显示；默认存项目目录(project) | 出图失败时改写为错误文案 | ⏳ |
| ChatView.tsx | maybeRunDirectImage：去掉弹设置卡，直接 runDirectImage(saveLocation: project) | 用户不再能在出图前改保存位置(可后续从设置加) | ⏳ |
| ChatView.tsx | 删除 imageChoice 状态、ImageGenChoiceCard 组件、IMG_SAVE_LOCATIONS 常量及其 JSX 分支(死代码) | 低 | 🔧 |
| ChatView.tsx | assistant 气泡新增 message.images 渲染(ChatImage) | 低 | ⏳ |
| ChatView.tsx | ToolBubble 移除内部生图/截图内联图片块；ToolGroup 改为收集组内所有工具图片，统一显示在聊天区(收拢/展开都可见) | agent 出图图片位置变化 | ⏳ |

### 说明
- 「直接用图片模型不走工具」本就如此：选中 imageGen 供应商经 runDirectImage(不经 agent loop)，工具仅在非图片模型的 agent 轮次中可用。本次只是把直接出图的结果从「工具气泡」改成「assistant 气泡」。

---

## 2026-06-24 — 跨轮智能工具历史回放

### 背景
此前跨轮历史只发 user/assistant 文本，`role:"tool"` 消息被跳过（除 generate_image/capture_window 备注路径），assistant 也不带 tool_calls。导致模型跨轮看不到上一轮工具调用与结果 → 重复读文件、跨轮失忆。当轮内不受影响。

### 改动项

| 模块 | 改动 | 状态 |
|---|---|---|
| agent-loop.ts | AgentRequest.messages 类型放宽，新增 tool_calls(assistant)/tool_call_id(tool) | 🔧 typecheck 通过 |
| agent-loop.ts | buildApiMessage 支持透传 assistant.tool_calls 与 tool 结果(tool_call_id) | 🔧 |
| ChatView.tsx | 新增 buildReplayMessages：阶段A 重建 assistant↔tool 配对、回放完整工具历史 | ⏳ |
| ChatView.tsx | normalizeToolOutput：剥离 GENERATED_IMAGE_PATHS 标记、空结果占位、单条非read_file大输出截断(18万字符) | ⏳ |
| ChatView.tsx | 阶段C 配对安全校验：assistant.tool_calls 与 tool 结果按 id 双向校验，残缺成对移除 | ⏳ |
| ChatView.tsx | 删除原 generate_image/capture_window 末尾追加备注循环(路径已含在回放的工具结果里，避免重复+顺序错乱) | ⏳ |
| 全局 CLAUDE.md | 新增「Prompt 缓存友好」通用规则 | 🔧 |

### 关键设计决策（防缓存击穿）
**不做动态年龄淘汰**。Claude Code 能淘汰旧工具结果又不破缓存，靠的是 Anthropic 专有的服务端 cache_edits（删服务端缓存、本地消息一字不改）。本项目经中转站 + 多协议(OpenAI/Anthropic/Responses)无此能力，若在本地把旧结果改占位会随轮次移动缓存断点、击穿 prompt 前缀按全价重算。故本地历史完整回放，总量控制交给已有 /compact 自动压缩(85万 token 触发)。仅保留「单条大输出截断」——它对同一条结果字节级稳定，不随轮次变化，缓存友好。

### 风险核对

| # | 风险 | 解决 | 状态 |
|---|---|---|---|
| H1 | 重建 tool_calls 配对错误 → 协议 400 | 阶段C 双向校验，残缺成对移除 | ⏳ **重点实测** |
| H2 | 回放破坏 prompt 缓存前缀、浪费 token | 不做会变动的淘汰；只保留字节稳定的截断 | 🔧 设计规避(见上) |
| H3 | 旧会话(改动前历史)缺完整 toolCall.id | 缺 id 的工具调用连同结果跳过，降级纯文本 | ⏳ 旧会话测 |
| H4 | 完整回放使单轮 token 暴涨、更快溢出 | /compact 85万兜底；大输出截断削峰 | ⏳ 长会话测 |
| H5 | generate_image/capture_window 图片路径丢失 | 路径已在工具结果可读文本(saved/Saved to)内，随回放带回 | ⏳ |
| H6 | 落单 tool 消息(摘要切断 assistant)无配对 | 阶段A 跳过落单 tool；阶段C 再兜底 | 🔧 |

### 待用户实测项（重点）

1. 干净实验：第1轮"读 tools.ts 100-120 行，先别动"，第2轮"那段有几个 if"——模型不重读即答对 → 验证回放生效。
2. 多文件读取后跨轮引用，确认不重复 read_file。
3. 三协议(OpenAI/chat、Anthropic、Responses)各跑一轮含工具调用的多轮对话，均不报配对错(400) → 验证 H1。
4. 旧会话(改动前创建的)继续对话不报错 → 验证 H3。
5. 长会话观察是否如期触发 /compact、不溢出 → 验证 H4。
6. 空输出工具(如静默命令)跨轮显示 `(name completed with no output)`。
7. 截图工具跨轮后模型仍知道图片本地路径 → 验证 H5。

### 静态验证
- `npx tsc --noEmit` 通过（无错误）
- `npm run build` 通过（built in ~14s）

---

## 2026-06-24 — 传输层日志工具（离线验证提示词拼接 / 缓存命中）

### 背景
跨轮智能回放上线后，需要看到「真正发往 LLM 的字节」来验证：system/工具/历史前缀是否稳定、prompt 缓存是否命中（cache_read_input_tokens）、是否有重复读取/拼接错乱。新增可开关的传输日志，把请求体+headers+usage 配对落盘成 JSONL。

### 改动项

| 模块 | 改动 | 状态 |
|---|---|---|
| transport-logger.ts (新) | 可开关传输日志：CW_TRANSPORT_LOG=1 或 FORCE_ON 开启；落盘 `<userData>/transport-logs/<会话标题>-<日期>.jsonl`；headers 脱敏(authorization/api-key/token/secret/cookie 只留首尾4)；请求体 data:image base64 折叠为 `[image <mime> <N> bytes b64]`；logRequest/logResponse 按 ts 配对 | 🔧 typecheck 通过 |
| agent-loop.ts | 发请求前 logRequest(protocol/model/url/headers/body)；成功末帧 logResponse(status200, usage)；HTTP≠200 logResponse(status, error)；**新增** stream/request 网络层错误也 logResponse(error) | 🔧 typecheck 通过 |
| ipc-handlers.ts | agent:send 收到 sessionTitle 时 setSessionLabel(用于命名日志文件)；新增 `transport-log:open` IPC 打开日志目录 | 🔧 typecheck 通过 |
| ChatView.tsx | agentSend 传 sessionTitle（会话名）用于日志命名 | 🔧 typecheck 通过 |
| index.ts | 启动 banner：console.log 打印日志是否开启及目录，方便确认 CW_TRANSPORT_LOG 是否生效 | 🔧 typecheck 通过 |

### 缓存前缀影响
无。纯旁路只读日志，不参与发往 LLM 的消息构建，不改任何拼接。

### 待用户实测
- 设 `CW_TRANSPORT_LOG=1` 启动，dev 控制台应打印 `[transport-log] ENABLED -> ...路径`；发一条消息后该目录出现 `<标题>-<日期>.jsonl`。
- 日志中 headers 的 key 已脱敏、图片已折叠、usage 含 cache_read/creation。
- 故意触发一次错误（断网/错 key）→ 日志有对应 error 记录。

### 静态验证
- `npx tsc --noEmit` 通过（无错误）

---

## 2026-06-24 — 工具图片回灌 + playwright file:// + Responses 协议

### 改动项

| 模块 | 改动 | 状态 |
|---|---|---|
| McpMarketplace.tsx / codeweaver-mcp.json | playwright 默认 args 加 `--allow-unrestricted-file-access` | ⏳ |
| tools.ts | NUL 哨兵替换为 `__GLOBSTAR__`（消除 null 字节） | 🔧 typecheck 通过 |
| tools.ts | 新增 AgentImage 类型 + downscaleImageIfNeeded(1568px) + ToolContext.collectImages | 🔧 |
| tools.ts | capture_window 推送截图 base64；MCP 工具透传图片收集器 | ⏳ |
| mcp-manager.ts | flattenContent 保留 image 块 base64，经 onImages 回传 | ⏳ |
| ipc-handlers.ts | mcpCall 接线图片收集器 | ⏳ |
| agent-loop.ts | ChatMessage.images 字段 + per-call 收集 + 3 张上限 + vision gate | ⏳ |
| agent-loop.ts | 三协议序列化：Anthropic 内嵌 image block / Responses 新增 / OpenAI 文字占位 | ⏳ |
| agent-loop.ts | Responses 协议新 SSE 解析分支 | ⏳ |
| agent-loop.ts | estimateMessagesTokens 计入图片(~1300/图) | 🔧 |
| provider-store.ts | ProviderProtocol 加 "responses"；Provider.vision 标志 | 🔧 |
| ProviderSettings.tsx | protocol 加 Responses 按钮 + vision 开关 | ⏳ |
| agent-loop.ts | buildSystemPrompt 加 vision 分支（关闭时引导用 snapshot） | ⏳ |

### 风险核对（R1–R11）

| # | 风险 | 解决 | 状态 |
|---|---|---|---|
| R1 | file:// 全放开，浏览器可读任意本地文件 | argHint 写安全说明 | ⏳ 用户知情确认 |
| R2 | OpenAI tool→图消息顺序约束(400) | 不传图，文字占位 | 🔧 已规避 |
| R3 | 多工具同轮图片串台 | per-callId 缓冲，每次清空 | 🔧 |
| R4 | base64 体积爆 / 413 | 缩放 1568 + 3 张上限 | ⏳ 实测请求体大小 |
| R5 | Anthropic 多图 2000px 硬限制 | 缩到 1568 | ⏳ 连截 2-3 张测 |
| R6 | vision 标志迁移误判存量 provider | `vision !== false` 默认开 | 🔧 |
| R7 | --allow-unrestricted-file-access 仍打不开 | 实测，必要时绝对 file:// | ⏳ **重点实测** |
| R8 | compact 摘要混入 base64 | 渲染层只处理文字，不碰 images | 🔧 |
| R9 | Responses 端点中转站不支持 | 可选协议，错误可读 | ⏳ 需支持端点实测 |
| R10 | token 统计漏算图片 | 计入 ~1300/图 | 🔧 |
| R11 | tools.ts null 字节致读不了 | 哨兵替换 | ✅ null 清零，tsc/build 通过 |

### 待用户实测项（重点）

1. 重启应用，让 agent 用 playwright 打开项目内一个本地 HTML，确认 `browser_snapshot` 返回真实内容（非空白）→ 验证 R7。
2. Anthropic provider：让 agent 截图，确认模型能描述图片内容 → 验证 R5。
3. Responses provider（需端点支持 /v1/responses）：截图，模型能描述 → 验证 R9。
4. OpenAI /chat/completions provider：截图，不报错且收到文字占位 → 验证 R2。
5. 关闭某 provider 的 vision：模型改用 snapshot、不调截图。
6. 同轮连截 4 张：最早一张降级为文字占位 → 验证 R4。
7. 回归：generate_image / capture_window 的 UI 内联显示未坏。

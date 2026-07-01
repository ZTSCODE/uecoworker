---
id: discord-bot-integration
desc: Discord Bot 远程控制集成 — 手机通过 Discord 斜杠命令控制桌面端 UE Coworker
status: yellow
hash: 1bdb597
---

# Discord Bot 远程控制集成

## 概述

| 项目 | 说明 |
|------|------|
| 目标 | 手机 Discord → 斜杠命令 → 桌面 UE Coworker Agent → 结果回发 Discord |
| 架构 | 嵌入 Electron 主进程，Bot 与 Agent Loop 同生命周期 |
| 库 | `discord.js` v14 |
| 通信 | WebSocket Gateway（discord.js 默认） |

## 架构流程

```
手机 Discord ──→ Discord API ──→ Bot(主进程内) ──→ Agent Loop / Tools
                                      ↑                    │
                                      └────── 结果回发 ─────┘
```

## 模块文件

| 文件 | 职责 |
|------|------|
| `src/main/discord-bot-manager.ts` | Bot 核心：生命周期、命令注册、interaction 分发、Agent 桥接 |
| `src/main/ipc-handlers.ts` | 新增 discord:* IPC 通道（getConfig/saveConfig/connect/disconnect/status） |
| `src/main/index.ts` | before-quit 添加 Bot 清理 |
| `src/preload/index.ts` + `.d.ts` | 暴露 Discord API 给渲染层 |
| `src/renderer/.../DiscordSettings.tsx` | 设置面板 UI 组件 |
| `src/renderer/.../ConfigPanel.tsx` | 集成 Discord 导航入口 |

## 斜杠命令

| 命令 | 参数 | 说明 | 实现方式 |
|------|------|------|----------|
| `/ask` | `prompt:string` | Agent 对话 | runAgentLoop (bypassPermissions) |
| `/file read` | `path:string` `offset?` `limit?` | 读文件 | executeTool("read_file") |
| `/file list` | `path?:string` | 列目录 | executeTool("list_files") |
| `/git status` | — | Git 状态 | gitManager.status() |
| `/git log` | `count?:int` | 提交历史 | gitManager.log() |
| `/git commit` | `message:string` | 提交 | gitManager.commit() |
| `/git push` | — | 推送 | gitManager.push() |
| `/git pull` | — | 拉取 | gitManager.pull() |
| `/git branches` | — | 列出分支 | gitManager.branches() |
| `/git checkout` | `branch:string` | 切换分支 | gitManager.checkout() |
| `/run` | `command:string` `timeout?` | 执行命令 | executeTool("run_command") |
| `/search` | `query:string` `path?` `pattern?` | 搜索 | executeTool("search_files") |
| `/status` | — | 软件状态 | Embed + 状态聚合 |
| `/stop` | — | 中止 Agent | AbortController.abort() |

## 消息长度处理

| 场景 | 策略 |
|------|------|
| ≤2000 字符 | 直接 `interaction.editReply()` |
| 2001–4096 字符 | 使用 Embed description |
| >4096 字符 | 上传为文件附件（AttachmentBuilder） |

## 安全设计

| 项目 | 方案 |
|------|------|
| Token | `SecretsManager` 加密存储（id: `__discord_bot_token__`） |
| 用户白名单 | 仅响应配置的 Discord User ID |
| 权限模式 | Discord 来源默认 `bypassPermissions`（手机无法交互确认框） |

## 复用清单

| 现有模块 | 复用点 |
|----------|--------|
| `agent-loop.ts` | runAgentLoop — Agent 核心执行 |
| `tools.ts` | executeTool + TOOL_DEFINITIONS — 所有工具 |
| `git-manager.ts` | Git 操作 |
| `mcp-manager.ts` | MCP 工具 + 状态查询 |
| `secrets-manager.ts` | Token 加密存储 |
| `permissions-manager.ts` | 权限策略 |

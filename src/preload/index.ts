import { contextBridge, ipcRenderer, webUtils } from "electron";
import { electronAPI } from "@electron-toolkit/preload";

const api = {
  minimize: () => ipcRenderer.invoke("window:minimize"),
  maximize: () => ipcRenderer.invoke("window:maximize"),
  close: () => ipcRenderer.invoke("window:close"),
  isMaximized: () => ipcRenderer.invoke("window:isMaximized"),
  focusWindow: () => ipcRenderer.invoke("window:focus"),
  // 小窗模式：切换窗口形态 / 重注册全局呼出快捷键 / 监听快捷键触发的「呼出小窗」。
  setMini: (v: boolean) => ipcRenderer.invoke("window:setMini", v),
  setMiniShortcut: (accelerator: string) => ipcRenderer.invoke("window:setMiniShortcut", accelerator),
  getWindowPosition: (): Promise<[number, number]> => ipcRenderer.invoke("window:getPosition"),
  setWindowPosition: (x: number, y: number) => ipcRenderer.invoke("window:setPosition", x, y),
  setMiniHeight: (h: number) => ipcRenderer.invoke("window:setMiniHeight", h),
  resetMiniHeight: () => ipcRenderer.invoke("window:resetMiniHeight"),
  onToggleMiniRequest: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on("window:toggle-mini-request", handler);
    return () => ipcRenderer.removeListener("window:toggle-mini-request", handler);
  },
  // 主进程请求渲染层退出小窗（托盘「还原窗口」等）：渲染层据此把 store 切回大窗，
  // store 再回调 setMini→exitMiniMode，保证窗口形态与 UI 同步。
  onRestoreRequest: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on("window:restore-request", handler);
    return () => ipcRenderer.removeListener("window:restore-request", handler);
  },
  resetWindowPosition: () => ipcRenderer.invoke("window:resetPosition"),
  openDirectory: () => ipcRenderer.invoke("dialog:openDirectory"),
  openFile: (options?: any) => ipcRenderer.invoke("dialog:openFile", options),
  saveFile: (opts: { defaultPath?: string; content: string; filters?: { name: string; extensions: string[] }[] }) =>
    ipcRenderer.invoke("dialog:saveFile", opts),
  openPath: (path: string) => ipcRenderer.invoke("shell:openPath", path),
  ensureDirAndOpen: (dir: string) => ipcRenderer.invoke("shell:ensureDirAndOpen", dir),
  openExternal: (url: string) => ipcRenderer.invoke("shell:openExternal", url),
  showInFolder: (path: string) => ipcRenderer.invoke("shell:showInFolder", path),
  ptyCreate: (opts: { cwd: string; model?: string; name?: string; shell?: string }) =>
    ipcRenderer.invoke("pty:create", opts),
  ptyWrite: (id: string, data: string) => ipcRenderer.send("pty:write", { id, data }),
  ptyResize: (id: string, cols: number, rows: number) =>
    ipcRenderer.send("pty:resize", { id, cols, rows }),
  ptyKill: (id: string) => ipcRenderer.invoke("pty:kill", id),
  ptyGetAll: () => ipcRenderer.invoke("pty:getAll"),
  ptyOnData: (id: string, callback: (data: string) => void) => {
    const handler = (_event: any, data: string) => callback(data);
    ipcRenderer.on(`pty:data:${id}`, handler);
    return () => ipcRenderer.removeListener(`pty:data:${id}`, handler);
  },
  ptyOnExit: (id: string, callback: (code: number) => void) => {
    const handler = (_event: any, code: number) => callback(code);
    ipcRenderer.on(`pty:exit:${id}`, handler);
    return () => ipcRenderer.removeListener(`pty:exit:${id}`, handler);
  },
  readDir: (dirPath: string) => ipcRenderer.invoke("fs:readDir", dirPath),
  readFile: (filePath: string) => ipcRenderer.invoke("fs:readFile", filePath),
  writeFile: (filePath: string, content: string) => ipcRenderer.invoke("fs:writeFile", filePath, content),
  renamePath: (oldPath: string, newPath: string) => ipcRenderer.invoke("fs:rename", oldPath, newPath),
  deletePath: (path: string) => ipcRenderer.invoke("fs:delete", path),
  mkdirPath: (path: string) => ipcRenderer.invoke("fs:mkdir", path),
  createFile: (path: string) => ipcRenderer.invoke("fs:createFile", path),
  getStat: (filePath: string) => ipcRenderer.invoke("fs:stat", filePath),
  listProjectFiles: (root: string, limit?: number) => ipcRenderer.invoke("fs:listProjectFiles", root, limit),
  getHomeDir: () => ipcRenderer.invoke("app:getHomeDir"),
  watchDir: (dirPath: string) => ipcRenderer.invoke("fs:watchDir", dirPath),
  unwatchDir: (dirPath: string) => ipcRenderer.invoke("fs:unwatchDir", dirPath),
  onFileChanged: (callback: (event: { type: string; path: string }) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on("fs:fileChanged", handler);
    return () => ipcRenderer.removeListener("fs:fileChanged", handler);
  },
  listSessions: (projectPath?: string) => ipcRenderer.invoke("session:list", projectPath),
  // Stream / JSONL
  startStreamWatch: (projectPath: string) => ipcRenderer.invoke("stream:start", projectPath),
  stopStreamWatch: (projectPath: string) => ipcRenderer.invoke("stream:stop", projectPath),
  onStreamEvent: (callback: (event: any) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on("stream:event", handler);
    return () => ipcRenderer.removeListener("stream:event", handler);
  },

  // Providers
  listProviders: () => ipcRenderer.invoke("provider:list"),
  getProvider: (id: string) => ipcRenderer.invoke("provider:get", id),
  addProvider: (config: any) => ipcRenderer.invoke("provider:add", config),
  removeProvider: (id: string) => ipcRenderer.invoke("provider:remove", id),
  // Agent
  agentSend: (req: any) => ipcRenderer.invoke("agent:send", req),
  agentStop: (sessionId: string) => ipcRenderer.invoke("agent:stop", sessionId),
  // 当前正在运行的会话 id 列表（主进程 runningLoops 真相源），供重挂时恢复 busy。
  agentRunningSessions: () => ipcRenderer.invoke("agent:running-sessions"),
  // 直接出图（对话里选中「图片生成」供应商直发，不经 agent loop）。
  generateImage: (req: any) => ipcRenderer.invoke("image:generate", req),
  agentContextStats: (workingDir: string) => ipcRenderer.invoke("agent:contextStats", workingDir),
  // Authoritative per-turn message snapshot (Cline-style). Replaces the
  // token/tool-call/tool-result trio for rendering.
  onAgentTurn: (callback: (data: any) => void) => {
    var handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on("agent:turn", handler);
    return function() { ipcRenderer.removeListener("agent:turn", handler); };
  },
  onAgentToken: (callback: (data: any) => void) => {
    var handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on("agent:stream-token", handler);
    return function() { ipcRenderer.removeListener("agent:stream-token", handler); };
  },
  onAgentToolCall: (callback: (data: any) => void) => {
    var handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on("agent:tool-call", handler);
    return function() { ipcRenderer.removeListener("agent:tool-call", handler); };
  },
  onAgentToolResult: (callback: (data: any) => void) => {
    var handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on("agent:tool-result", handler);
    return function() { ipcRenderer.removeListener("agent:tool-result", handler); };
  },

  onAgentArtifact: (callback: (data: any) => void) => {
    var handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on("agent:artifact", handler);
    return function() { ipcRenderer.removeListener("agent:artifact", handler); };
  },

  onAgentTodos: (callback: (data: any) => void) => {
    var handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on("agent:todos", handler);
    return function() { ipcRenderer.removeListener("agent:todos", handler); };
  },

  // AI 通过 checklist_submit 改动持久清单：让 UI 下拉自动弹开并高亮该条。
  onAgentChecklist: (callback: (data: any) => void) => {
    var handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on("agent:checklist", handler);
    return function() { ipcRenderer.removeListener("agent:checklist", handler); };
  },

  // 模型自主进入计划模式（enter_plan_mode）：渲染层据此把 session 切到 plan 模式。
  onAgentEnterPlan: (callback: (data: any) => void) => {
    var handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on("agent:enter-plan", handler);
    return function() { ipcRenderer.removeListener("agent:enter-plan", handler); };
  },

  // 生图工具：generate_image 出图后带本地图片路径，渲染层据此在工具气泡内联显示。
  onAgentGeneratedImages: (callback: (data: any) => void) => {
    var handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on("agent:generated-images", handler);
    return function() { ipcRenderer.removeListener("agent:generated-images", handler); };
  },

  // configure_hooks 工具改了项目 hooks 配置，Hooks 面板据此自动重载。
  onHooksChanged: (callback: (data: any) => void) => {
    var handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on("hooks:changed", handler);
    return function() { ipcRenderer.removeListener("hooks:changed", handler); };
  },

  onAgentError: (callback: (data: any) => void) => {
    var handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on("agent:error", handler);
    return function() { ipcRenderer.removeListener("agent:error", handler); };
  },

  // 权威运行状态（主进程 runningLoops 的真相源）：running=true 开跑、false 已停。
  // 渲染层据此可靠地切换发送/终止按钮，不再依赖会被非致命错误污染的推断。
  onAgentRunState: (callback: (data: { sessionId: string; running: boolean }) => void) => {
    var handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on("agent:run-state", handler);
    return function() { ipcRenderer.removeListener("agent:run-state", handler); };
  },

  // Tool approval bridge
  onAgentToolApproval: (callback: (data: any) => void) => {
    var handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on("agent:tool-approval-request", handler);
    return function() { ipcRenderer.removeListener("agent:tool-approval-request", handler); };
  },
  respondToolApproval: (callId: string, approved: boolean) =>
    ipcRenderer.send("agent:tool-approval-response:" + callId, approved),

  // Chat API
  chatSend: (req: any) => ipcRenderer.invoke("chat:send", req),
  onStreamToken: (callback: (data: any) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on("chat:stream-token", handler);
    return () => ipcRenderer.removeListener("chat:stream-token", handler);
  },
  onChatError: (callback: (data: any) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on("chat:error", handler);
    return () => ipcRenderer.removeListener("chat:error", handler);
  },

  testProvider: (cfg: { baseUrl: string; apiKey: string; model: string; headers?: Record<string, string>; protocol?: string }) =>
    ipcRenderer.invoke("provider:test", cfg),
  getProviderBalance: (cfg: { baseUrl: string; apiKey: string; headers?: Record<string, string>; balanceScript?: string }) =>
    ipcRenderer.invoke("provider:balance", cfg),
  recordBalance: (snap: { providerId: string; remaining: number; unit: string; ts: number }) =>
    ipcRenderer.invoke("balance:record", snap),
  balanceHistory: () => ipcRenderer.invoke("balance:history"),

  // Chat persistence (one JSONL per session, grouped by project)
  listChats: (projectPath: string) => ipcRenderer.invoke("chats:list", projectPath),
  chatsAnalytics: (projectPath: string) => ipcRenderer.invoke("chats:analytics", projectPath),
  appendChatMessage: (projectPath: string, meta: any, message: any) =>
    ipcRenderer.invoke("chats:append", projectPath, meta, message),
  writeChatSession: (projectPath: string, session: any) =>
    ipcRenderer.invoke("chats:writeSession", projectPath, session),
  deleteChat: (projectPath: string, sessionId: string) =>
    ipcRenderer.invoke("chats:delete", projectPath, sessionId),
  saveChatImage: (dataUrl: string, ext: string) =>
    ipcRenderer.invoke("chats:saveImage", dataUrl, ext),
  readChatImage: (path: string) => ipcRenderer.invoke("chats:readImage", path),
  // 图片另存为 / 复制到剪贴板（聊天图片右键菜单）。
  saveImageAs: (path: string) => ipcRenderer.invoke("chats:saveImageAs", path),
  copyImageToClipboard: (path: string) => ipcRenderer.invoke("chats:copyImage", path),

  // Followup bridge (agent asks the user a question)
  onAgentFollowup: (callback: (data: any) => void) => {
    var handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on("agent:followup-request", handler);
    return function() { ipcRenderer.removeListener("agent:followup-request", handler); };
  },
  respondFollowup: (callId: string, answer: string) =>
    ipcRenderer.send("agent:followup-response:" + callId, answer),
  // followup 被外部解决（Discord 端答了 / 超时 / abort）时，主进程广播此事件，
  // 渲染层据此撤掉对应的 followup 卡片。
  onAgentFollowupResolved: (callback: (data: { sessionId?: string; callId: string }) => void) => {
    var handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on("agent:followup-resolved", handler);
    return function() { ipcRenderer.removeListener("agent:followup-resolved", handler); };
  },
  // 审批卡被外部解决（手机端批准/拒绝 / 超时 / abort）时撤掉桌面审批卡。
  onAgentToolApprovalResolved: (callback: (data: { sessionId?: string; callId: string }) => void) => {
    var handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on("agent:tool-approval-resolved", handler);
    return function() { ipcRenderer.removeListener("agent:tool-approval-resolved", handler); };
  },

  // Git version control
  gitStatus: (cwd: string) => ipcRenderer.invoke("git:status", cwd),
  gitDiff: (cwd: string, file: string, staged: boolean) => ipcRenderer.invoke("git:diff", cwd, file, staged),
  gitStage: (cwd: string, paths: string[]) => ipcRenderer.invoke("git:stage", cwd, paths),
  gitStageAll: (cwd: string) => ipcRenderer.invoke("git:stageAll", cwd),
  gitUnstage: (cwd: string, paths: string[]) => ipcRenderer.invoke("git:unstage", cwd, paths),
  gitDiscard: (cwd: string, paths: string[]) => ipcRenderer.invoke("git:discard", cwd, paths),
  gitCommit: (cwd: string, message: string) => ipcRenderer.invoke("git:commit", cwd, message),
  gitLog: (cwd: string, limit?: number) => ipcRenderer.invoke("git:log", cwd, limit),
  gitBranches: (cwd: string) => ipcRenderer.invoke("git:branches", cwd),
  gitCheckout: (cwd: string, branch: string) => ipcRenderer.invoke("git:checkout", cwd, branch),
  gitCreateBranch: (cwd: string, name: string) => ipcRenderer.invoke("git:createBranch", cwd, name),
  gitPush: (cwd: string) => ipcRenderer.invoke("git:push", cwd),
  gitPull: (cwd: string) => ipcRenderer.invoke("git:pull", cwd),
  gitInit: (cwd: string) => ipcRenderer.invoke("git:init", cwd),
  gitRevert: (cwd: string, commit: string) => ipcRenderer.invoke("git:revert", cwd, commit),
  gitCherryPick: (cwd: string, commit: string) => ipcRenderer.invoke("git:cherryPick", cwd, commit),
  gitReset: (cwd: string, commit: string, mode: string) => ipcRenderer.invoke("git:reset", cwd, commit, mode),
  gitCreateBranchAt: (cwd: string, name: string, commit: string) => ipcRenderer.invoke("git:createBranchAt", cwd, name, commit),
  gitCheckoutCommit: (cwd: string, commit: string) => ipcRenderer.invoke("git:checkoutCommit", cwd, commit),
  gitCommitDiff: (cwd: string, commit: string) => ipcRenderer.invoke("git:commitDiff", cwd, commit),
  gitRemoteInfo: (cwd: string) => ipcRenderer.invoke("git:remoteInfo", cwd),
  gitSetRemote: (cwd: string, url: string) => ipcRenderer.invoke("git:setRemote", cwd, url),
  gitGhStatus: (cwd: string) => ipcRenderer.invoke("git:ghStatus", cwd),
  gitCreatePR: (cwd: string, opts: any) => ipcRenderer.invoke("git:createPR", cwd, opts),
  gitOpenPR: (cwd: string) => ipcRenderer.invoke("git:openPR", cwd),
  gitRestoreFile: (cwd: string, commit: string, file: string) => ipcRenderer.invoke("git:restoreFile", cwd, commit, file),
  gitFileHistory: (cwd: string, file: string, limit?: number) => ipcRenderer.invoke("git:fileHistory", cwd, file, limit),

  // GitHub OAuth（Device Flow）登录。
  githubStatus: () => ipcRenderer.invoke("github:status"),
  githubStartLogin: () => ipcRenderer.invoke("github:startLogin"),
  githubCancelLogin: () => ipcRenderer.invoke("github:cancelLogin"),
  githubLogout: () => ipcRenderer.invoke("github:logout"),
  onGithubLoginResult: (cb: (res: { ok: boolean; login?: string; error?: string }) => void) => {
    const fn = (_e: any, res: any) => cb(res);
    ipcRenderer.on("github:loginResult", fn);
    return () => ipcRenderer.removeListener("github:loginResult", fn);
  },

  // Checkpoints (shadow-git "undo the agent")
  checkpointList: (cwd: string) => ipcRenderer.invoke("checkpoint:list", cwd),
  checkpointRestore: (cwd: string, commit: string) => ipcRenderer.invoke("checkpoint:restore", cwd, commit),
  checkpointDiff: (cwd: string, commit: string) => ipcRenderer.invoke("checkpoint:diff", cwd, commit),
  onAgentCheckpoint: (callback: (data: any) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on("agent:checkpoint", handler);
    return () => ipcRenderer.removeListener("agent:checkpoint", handler);
  },

  // Skills (scan .claude/skills, progressive disclosure)
  skillsList: (projectPath?: string) => ipcRenderer.invoke("skills:list", projectPath),
  skillsSetEnabled: (id: string, enabled: boolean) => ipcRenderer.invoke("skills:setEnabled", id, enabled),
  skillsRemove: (id: string, projectPath?: string) => ipcRenderer.invoke("skills:remove", id, projectPath),
  skillsMarketSearch: (query?: string) => ipcRenderer.invoke("skillsMarket:search", query),
  skillsMarketInstall: (id: string, scope: "project" | "global", projectPath?: string) => ipcRenderer.invoke("skillsMarket:install", id, scope, projectPath),

  // UE 插件市场(打了约定 topic 的仓库;一键装到当前工程 Plugins/)
  pluginsMarketSearch: (query?: string) => ipcRenderer.invoke("pluginsMarket:search", query),
  pluginsMarketInstall: (id: string, projectPath?: string) => ipcRenderer.invoke("pluginsMarket:install", id, projectPath),
  pluginsMarketListInstalled: (projectPath?: string) => ipcRenderer.invoke("pluginsMarket:listInstalled", projectPath),
  pluginsMarketUninstall: (name: string, projectPath?: string) => ipcRenderer.invoke("pluginsMarket:uninstall", name, projectPath),

  // Sub-agents (scan .claude/agents, dispatched via the task tool)
  agentsList: (projectPath?: string) => ipcRenderer.invoke("agents:list", projectPath),
  agentsSetEnabled: (id: string, enabled: boolean) => ipcRenderer.invoke("agents:setEnabled", id, enabled),
  onAgentSubagent: (callback: (data: any) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on("agent:subagent", handler);
    return function() { ipcRenderer.removeListener("agent:subagent", handler); };
  },

  // Memory (long-term memory: .claude/memory, one-fact-per-file + frontmatter)
  memoryList: (projectPath?: string) => ipcRenderer.invoke("memory:list", projectPath),
  memorySave: (projectPath: string | undefined, input: any) => ipcRenderer.invoke("memory:save", projectPath, input),
  memoryDelete: (projectPath: string | undefined, id: string) => ipcRenderer.invoke("memory:delete", projectPath, id),
  memorySetEnabled: (id: string, enabled: boolean) => ipcRenderer.invoke("memory:setEnabled", id, enabled),
  memorySearch: (projectPath: string | undefined, query: string) => ipcRenderer.invoke("memory:search", projectPath, query),
  onMemoryChanged: (callback: (data: any) => void) => {
    var handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on("memory:changed", handler);
    return function() { ipcRenderer.removeListener("memory:changed", handler); };
  },

  // Checklist (persistent project task list in .claude/checklist.json)
  checklistList: (projectPath?: string) => ipcRenderer.invoke("checklist:list", projectPath),
  checklistAdd: (projectPath: string, content: string) => ipcRenderer.invoke("checklist:add", projectPath, content),
  checklistSetStatus: (projectPath: string, id: string, status: string) => ipcRenderer.invoke("checklist:setStatus", projectPath, id, status),
  checklistEdit: (projectPath: string, id: string, content: string) => ipcRenderer.invoke("checklist:edit", projectPath, id, content),
  checklistRemove: (projectPath: string, id: string) => ipcRenderer.invoke("checklist:remove", projectPath, id),
  onChecklistChanged: (callback: (data: any) => void) => {
    var handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on("checklist:changed", handler);
    return function() { ipcRenderer.removeListener("checklist:changed", handler); };
  },

  // Hooks (event-driven automation in .claude/settings.json)
  hooksGet: (projectPath: string) => ipcRenderer.invoke("hooks:get", projectPath),
  hooksSave: (projectPath: string, hooks: any) => ipcRenderer.invoke("hooks:save", projectPath, hooks),
  hooksOpenFile: (projectPath: string) => ipcRenderer.invoke("hooks:openFile", projectPath),
  hooksRun: (event: string, payload: any, projectPath: string) => ipcRenderer.invoke("hooks:run", event, payload, projectPath),

  // MCP servers (real client)
  mcpList: () => ipcRenderer.invoke("mcp:list"),
  mcpConfigPath: () => ipcRenderer.invoke("mcp:configPath"),
  mcpSave: (servers: any[]) => ipcRenderer.invoke("mcp:save", servers),
  mcpReconnectAll: () => ipcRenderer.invoke("mcp:reconnectAll"),
  mcpConnect: (cfg: any) => ipcRenderer.invoke("mcp:connect", cfg),
  mcpDisconnect: (id: string) => ipcRenderer.invoke("mcp:disconnect", id),
  mcpStatus: () => ipcRenderer.invoke("mcp:status"),
  mcpRegistrySearch: (query?: string, cursor?: string) => ipcRenderer.invoke("mcp:registrySearch", query, cursor),

  // Permissions (tool approval policy)
  getPermissions: () => ipcRenderer.invoke("permissions:get"),
  setPermissionMode: (mode: string) => ipcRenderer.invoke("permissions:setMode", mode),
  setToolPermission: (tool: string, allowed: boolean) => ipcRenderer.invoke("permissions:setTool", tool, allowed),
  setToolAuto: (tool: string, auto: boolean) => ipcRenderer.invoke("permissions:setToolAuto", tool, auto),

  // Secrets (encrypted API key storage)
  setSecret: (id: string, value: string) => ipcRenderer.invoke("secrets:set", id, value),
  getSecret: (id: string) => ipcRenderer.invoke("secrets:get", id),
  hasSecret: (id: string) => ipcRenderer.invoke("secrets:has", id),
  deleteSecret: (id: string) => ipcRenderer.invoke("secrets:delete", id),

  getRecentProjects: () => ipcRenderer.invoke("session:getRecent"),
  addRecentProject: (path: string) => ipcRenderer.invoke("session:addRecent", path),
  getProjectStats: (path: string) => ipcRenderer.invoke("analytics:getProjectStats", path),
  onWindowMaximized: (callback: (maximized: boolean) => void) => {
    const handler = () => callback(true);
    const unhandler = () => callback(false);
    ipcRenderer.on("window:maximized", handler);
    ipcRenderer.on("window:unmaximized", unhandler);
    return () => {
      ipcRenderer.removeListener("window:maximized", handler);
      ipcRenderer.removeListener("window:unmaximized", unhandler);
    };
  },

  // Discord Bot 远程控制
  discordGetConfig: () => ipcRenderer.invoke("discord:getConfig"),
  discordSaveConfig: (cfg: any) => ipcRenderer.invoke("discord:saveConfig", cfg),
  discordConnect: () => ipcRenderer.invoke("discord:connect"),
  discordDisconnect: () => ipcRenderer.invoke("discord:disconnect"),
  discordStatus: () => ipcRenderer.invoke("discord:status"),
  discordSetWorkingDir: (cwd: string) => ipcRenderer.invoke("discord:setWorkingDir", cwd),
  onDiscordStatusChange: (callback: (data: { status: string; error?: string }) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on("discord:statusChange", handler);
    return () => ipcRenderer.removeListener("discord:statusChange", handler);
  },
  // 转发桥：主进程把 Discord 的 /ask、/session 经此发给渲染层，渲染层用桌面已选
  // Provider 执行后用 *Response 回送（带主进程发来的 reqId，主进程据此匹配往返）。
  onDiscordRunTurn: (callback: (data: { reqId: string; prompt: string; channelId: string }) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on("discord:run-turn", handler);
    return () => ipcRenderer.removeListener("discord:run-turn", handler);
  },
  discordRunTurnResponse: (reqId: string, result: { ok: boolean; text?: string; error?: string }) =>
    ipcRenderer.send("discord:run-turn:response:" + reqId, result),
  onDiscordSessionOp: (callback: (data: { reqId: string; op: "new" | "list" | "switch"; arg?: string }) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on("discord:session-op", handler);
    return () => ipcRenderer.removeListener("discord:session-op", handler);
  },
  discordSessionOpResponse: (reqId: string, result: { ok: boolean; text?: string; error?: string }) =>
    ipcRenderer.send("discord:session-op:response:" + reqId, result),
  onDiscordProviderOp: (callback: (data: { reqId: string; op: "list" | "switch"; arg?: string }) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on("discord:provider-op", handler);
    return () => ipcRenderer.removeListener("discord:provider-op", handler);
  },
  discordProviderOpResponse: (reqId: string, result: { ok: boolean; text?: string; error?: string }) =>
    ipcRenderer.send("discord:provider-op:response:" + reqId, result),
  onDiscordModeOp: (callback: (data: { reqId: string; mode?: string; relaySource?: string }) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on("discord:mode-op", handler);
    return () => ipcRenderer.removeListener("discord:mode-op", handler);
  },
  discordModeOpResponse: (reqId: string, result: { ok: boolean; text?: string; error?: string }) =>
    ipcRenderer.send("discord:mode-op:response:" + reqId, result),
  onDiscordUiOp: (callback: (data: { reqId: string; op: string; relaySource?: string }) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on("discord:ui-op", handler);
    return () => ipcRenderer.removeListener("discord:ui-op", handler);
  },
  discordUiOpResponse: (reqId: string, result: { ok: boolean; text?: string; error?: string }) =>
    ipcRenderer.send("discord:ui-op:response:" + reqId, result),
  onDiscordStatusLine: (callback: (data: { reqId: string; relaySource?: string }) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on("discord:status-line", handler);
    return () => ipcRenderer.removeListener("discord:status-line", handler);
  },
  discordStatusLineResponse: (reqId: string, result: { project?: string; model?: string; mode?: string }) =>
    ipcRenderer.send("discord:status-line:response:" + reqId, result),

  // 统一 Relay 远程控制（Discord + Telegram，网关跑在 utilityProcess）。source 区分平台。
  relayGetConfig: (source: string) => ipcRenderer.invoke("relay:getConfig", source),
  relaySaveConfig: (source: string, cfg: any) => ipcRenderer.invoke("relay:saveConfig", source, cfg),
  relayConnect: (source: string) => ipcRenderer.invoke("relay:connect", source),
  relayDisconnect: (source: string) => ipcRenderer.invoke("relay:disconnect", source),
  relayStatus: (source: string) => ipcRenderer.invoke("relay:status", source),
  // 微信扫码登录：拉起/取消；二维码与状态经 onRelayWeixinQr 推送。
  relayWeixinLogin: () => ipcRenderer.invoke("relay:weixinLogin"),
  relayWeixinCancelLogin: () => ipcRenderer.invoke("relay:weixinCancelLogin"),
  onRelayWeixinQr: (callback: (data: { qrcode: string; qrcodeImageContent?: string; status: string; error?: string }) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on("relay:weixinQr", handler);
    return () => ipcRenderer.removeListener("relay:weixinQr", handler);
  },
  relayPush: (p: { source: string; channelId: string; kind: "progress" | "error"; text: string }) => ipcRenderer.invoke("relay:push", p),
  // 传输调试日志：打开日志文件夹 / 运行期开关（无需重启，完整记录发往 LLM 的请求体、
  // headers、响应状态与报错正文）。
  transportLogOpen: () => ipcRenderer.invoke("transport-log:open"),
  transportLogSetEnabled: (on?: boolean) => ipcRenderer.invoke("transport-log:setEnabled", on),
  // 手机端切换/新建项目后，主进程经此让渲染层切项目（requestProject）。
  onRelayOpenProject: (callback: (data: { path: string }) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on("relay:openProject", handler);
    return () => ipcRenderer.removeListener("relay:openProject", handler);
  },
  onRelayStatusChange: (callback: (data: { source: string; status: string; error?: string; botTag?: string }) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on("relay:statusChange", handler);
    return () => ipcRenderer.removeListener("relay:statusChange", handler);
  },
  // Electron 33 移除了 File.path：拖入/选择文件的真实绝对路径需经 webUtils 取得。
  // 渲染层无法直接 import webUtils（需 Node 能力），故由 preload 转一道。
  getPathForFile: (file: File): string => {
    try { return webUtils.getPathForFile(file); } catch { return ""; }
  },
};

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld("electron", electronAPI);
    contextBridge.exposeInMainWorld("api", api);
  } catch (error) {
    console.error("Failed to expose APIs:", error);
  }
} else {
  // @ts-ignore
  window.electron = electronAPI;
  // @ts-ignore
  window.api = api;
}

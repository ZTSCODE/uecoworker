import { ElectronAPI } from "@electron-toolkit/preload";

export interface FileEntry { name: string; isDirectory: boolean; isFile: boolean; isSymlink: boolean; }
export interface FileContent { content?: string; size?: number; modifiedAt?: number; error?: string; }
export interface FileStat { size: number; isDirectory: boolean; isFile: boolean; modifiedAt: number; createdAt: number; }
export interface SessionSummary { id: string; cwd: string; model: string; name: string; createdAt: number; }
export interface RecentProject { path: string; name: string; lastOpened: number; }

export interface GitFileChange {
  path: string;
  index: string;
  working: string;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
  display: string;
}
export interface GitStatus {
  isRepo: boolean;
  branch: string;
  ahead: number;
  behind: number;
  changes: GitFileChange[];
  error?: string;
}
export interface GitLogEntry { hash: string; author: string; date: string; subject: string; refs?: string; }
export interface Checkpoint { id: string; message: string; timestamp: number; sessionId?: string; }

export interface SkillInfo {
  id: string;
  name: string;
  description: string;
  source: "project" | "global";
  dir: string;
  skillMdPath: string;
  enabled: boolean;
  license?: string;
  allowedTools?: string[];
  error?: string;
}

export interface SkillMarketItem {
  id: string;
  name: string;
  description: string;
  author: string;
  repo: string;
  repoUrl: string;
  skillUrl: string;
  source: string;
  stars?: number;
  installs?: number;
  branch?: string;
}

export interface AgentInfo {
  id: string;
  name: string;
  description: string;
  source: "project" | "global" | "builtin";
  filePath: string;
  enabled: boolean;
  tools?: string[];
  model?: string;
  mode: "read-only" | "write";
  prompt: string;
  builtin?: boolean;
  error?: string;
}

export type MemoryType = "user" | "feedback" | "project" | "reference";
export interface MemoryEntry {
  id: string;
  name: string;
  description: string;
  type: MemoryType;
  source: "project" | "global";
  path: string;
  body: string;
  enabled: boolean;
  error?: string;
}
export interface MemorySaveInput {
  name?: string;
  description: string;
  type: MemoryType;
  body?: string;
  source?: "project" | "global";
}

export type ChecklistStatus = "todo" | "needs_verification" | "done";
export interface ChecklistItem {
  id: string;
  content: string;
  status: ChecklistStatus;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

export interface McpServerConfig {
  id: string;
  enabled: boolean;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  type?: "stdio" | "http" | "sse" | "streamable-http";
  headers?: Record<string, string>;
}
export interface McpStatusRow {
  id: string;
  status: "disconnected" | "connecting" | "connected" | "error";
  error?: string;
  tools: { name: string; description: string }[];
}
export interface McpRegistryItem {
  id: string;
  name: string;
  title: string;
  description: string;
  version?: string;
  author?: string;
  repoUrl?: string;
  transport: "stdio" | "http" | "sse" | "streamable-http";
  install: McpServerConfig;
  requiresInput: boolean;
  inputHints: string[];
}

export type PermissionMode = "default" | "acceptEdits" | "bypassPermissions" | "plan";
export interface ToolPermission { tool: string; allowed: boolean; scope?: string; auto?: boolean; }
export interface PermissionsConfig { mode: PermissionMode; tools: ToolPermission[]; }

export interface UeCoworkerAPI {
  // Window controls
  minimize: () => Promise<void>;
  maximize: () => Promise<void>;
  close: () => Promise<void>;
  isMaximized: () => Promise<boolean>;
  focusWindow: () => Promise<boolean>;
  onWindowMaximized: (callback: (maximized: boolean) => void) => () => void;
  // 小窗模式
  setMini: (v: boolean) => Promise<void>;
  setMiniShortcut: (accelerator: string) => Promise<boolean>;
  getWindowPosition: () => Promise<[number, number]>;
  setWindowPosition: (x: number, y: number) => Promise<void>;
  resetWindowPosition: () => Promise<void>;
  setMiniHeight: (h: number) => Promise<void>;
  resetMiniHeight: () => Promise<void>;
  onToggleMiniRequest: (callback: () => void) => () => void;
  onRestoreRequest: (callback: () => void) => () => void;

  // Dialogs / shell
  openDirectory: () => Promise<string | null>;
  openFile: (options?: any) => Promise<string | null>;
  saveFile: (opts: { defaultPath?: string; content: string; filters?: { name: string; extensions: string[] }[] }) => Promise<{ ok: boolean; path?: string; canceled?: boolean; error?: string }>;
  openPath: (path: string) => Promise<string>;
  ensureDirAndOpen: (dir: string) => Promise<string>;
  openExternal: (url: string) => Promise<void>;
  showInFolder: (path: string) => Promise<boolean>;

  // PTY
  ptyCreate: (opts: { cwd: string; model?: string; name?: string; shell?: string }) => Promise<SessionSummary & { error?: string }>;
  ptyWrite: (id: string, data: string) => void;
  ptyResize: (id: string, cols: number, rows: number) => void;
  ptyKill: (id: string) => Promise<boolean>;
  ptyGetAll: () => Promise<SessionSummary[]>;
  ptyOnData: (id: string, callback: (data: string) => void) => () => void;
  ptyOnExit: (id: string, callback: (code: number) => void) => () => void;

  // Filesystem
  readDir: (dirPath: string) => Promise<FileEntry[]>;
  readFile: (filePath: string) => Promise<FileContent>;
  writeFile: (filePath: string, content: string) => Promise<{ ok: boolean; error?: string }>;
  renamePath: (oldPath: string, newPath: string) => Promise<{ ok: boolean; error?: string }>;
  deletePath: (path: string) => Promise<{ ok: boolean; error?: string }>;
  mkdirPath: (path: string) => Promise<{ ok: boolean; error?: string }>;
  createFile: (path: string) => Promise<{ ok: boolean; error?: string }>;
  getStat: (filePath: string) => Promise<FileStat | null>;
  listProjectFiles: (root: string, limit?: number) => Promise<string[]>;
  getHomeDir: () => Promise<string>;
  watchDir: (dirPath: string) => Promise<boolean>;
  unwatchDir: (dirPath: string) => Promise<boolean>;
  onFileChanged: (callback: (event: { type: string; path: string }) => void) => () => void;

  // Sessions / analytics
  listSessions: (projectPath?: string) => Promise<any[]>;
  getRecentProjects: () => Promise<RecentProject[]>;
  addRecentProject: (path: string) => Promise<boolean>;
  getProjectStats: (path: string) => Promise<any>;

  // Stream / JSONL
  startStreamWatch: (projectPath: string) => Promise<boolean>;
  stopStreamWatch: (projectPath: string) => Promise<boolean>;
  onStreamEvent: (callback: (event: any) => void) => () => void;

  // Providers
  listProviders: () => Promise<any[]>;
  getProvider: (id: string) => Promise<any>;
  addProvider: (config: any) => Promise<boolean>;
  removeProvider: (id: string) => Promise<boolean>;
  testProvider: (cfg: { baseUrl: string; apiKey: string; model: string; headers?: Record<string, string>; protocol?: string }) => Promise<{ ok: boolean; status?: number; message: string }>;
  getProviderBalance: (cfg: { baseUrl: string; apiKey: string; headers?: Record<string, string>; balanceScript?: string }) => Promise<{ ok: boolean; remaining?: number; unit?: string; isValid?: boolean }>;
  recordBalance: (snap: { providerId: string; remaining: number; unit: string; ts: number }) => Promise<boolean>;
  balanceHistory: () => Promise<Record<string, { providerId: string; remaining: number; unit: string; ts: number }[]>>;

  // Chat persistence
  listChats: (projectPath: string) => Promise<any[]>;
  chatsAnalytics: (projectPath: string) => Promise<{
    totalSessions: number; totalPromptTokens: number; totalCompletionTokens: number;
    totalCacheCreate: number; totalCacheRead: number;
    totalTokens: number; totalTurns: number; cacheHitRate: number; hasEstimated: boolean;
    byModel: { model: string; provider: string; promptTokens: number; completionTokens: number; cacheCreate: number; cacheRead: number; tokens: number; sessions: number; turns: number }[];
    sessions: { id: string; name: string; model: string; provider: string; createdAt: number; promptTokens: number; completionTokens: number; cacheCreate: number; cacheRead: number; tokens: number; turns: number; messageCount: number; estimated: boolean }[];
  }>;
  appendChatMessage: (projectPath: string, meta: any, message: any) => Promise<boolean>;
  writeChatSession: (projectPath: string, session: any) => Promise<boolean>;
  deleteChat: (projectPath: string, sessionId: string) => Promise<boolean>;
  saveChatImage: (dataUrl: string, ext: string) => Promise<{ ok: boolean; path?: string; error?: string }>;
  getPathForFile: (file: File) => string;
  readChatImage: (path: string) => Promise<{ ok: boolean; dataUrl?: string; error?: string }>;
  saveImageAs: (path: string) => Promise<{ ok: boolean; path?: string; canceled?: boolean; error?: string }>;
  copyImageToClipboard: (path: string) => Promise<{ ok: boolean; error?: string }>;

  // Followup bridge (one or more questions answered in a single card)
  onAgentFollowup: (callback: (data: { callId: string; questions: { question: string; options?: string[] }[]; sessionId?: string }) => void) => () => void;
  respondFollowup: (callId: string, answers: string[]) => void;
  onAgentFollowupResolved: (callback: (data: { sessionId?: string; callId: string }) => void) => () => void;

  // Git version control
  gitStatus: (cwd: string) => Promise<GitStatus>;
  gitDiff: (cwd: string, file: string, staged: boolean) => Promise<string>;
  gitStage: (cwd: string, paths: string[]) => Promise<{ ok: boolean; error?: string }>;
  gitStageAll: (cwd: string) => Promise<{ ok: boolean; error?: string }>;
  gitUnstage: (cwd: string, paths: string[]) => Promise<{ ok: boolean; error?: string }>;
  gitDiscard: (cwd: string, paths: string[]) => Promise<{ ok: boolean; error?: string }>;
  gitCommit: (cwd: string, message: string) => Promise<{ ok: boolean; error?: string; hash?: string }>;
  gitLog: (cwd: string, limit?: number) => Promise<GitLogEntry[]>;
  gitBranches: (cwd: string) => Promise<{ current: string; all: string[] }>;
  gitCheckout: (cwd: string, branch: string) => Promise<{ ok: boolean; error?: string }>;
  gitCreateBranch: (cwd: string, name: string) => Promise<{ ok: boolean; error?: string }>;
  gitPush: (cwd: string) => Promise<{ ok: boolean; error?: string }>;
  gitPull: (cwd: string) => Promise<{ ok: boolean; error?: string }>;
  gitInit: (cwd: string) => Promise<{ ok: boolean; error?: string }>;
  gitRevert: (cwd: string, commit: string) => Promise<{ ok: boolean; error?: string }>;
  gitCherryPick: (cwd: string, commit: string) => Promise<{ ok: boolean; error?: string }>;
  gitReset: (cwd: string, commit: string, mode: "soft" | "mixed" | "hard") => Promise<{ ok: boolean; error?: string }>;
  gitCreateBranchAt: (cwd: string, name: string, commit: string) => Promise<{ ok: boolean; error?: string }>;
  gitCheckoutCommit: (cwd: string, commit: string) => Promise<{ ok: boolean; error?: string }>;
  gitCommitDiff: (cwd: string, commit: string) => Promise<string>;
  gitRemoteInfo: (cwd: string) => Promise<{ hasOrigin: boolean; url: string }>;
  gitSetRemote: (cwd: string, url: string) => Promise<{ ok: boolean; error?: string }>;
  gitGhStatus: (cwd: string) => Promise<{ installed: boolean; authed: boolean; message?: string }>;
  gitCreatePR: (cwd: string, opts: { title: string; body?: string; base?: string; draft?: boolean }) => Promise<{ ok: boolean; url?: string; error?: string }>;
  gitOpenPR: (cwd: string) => Promise<{ ok: boolean; error?: string }>;
  gitRestoreFile: (cwd: string, commit: string, file: string) => Promise<{ ok: boolean; error?: string }>;
  gitFileHistory: (cwd: string, file: string, limit?: number) => Promise<GitLogEntry[]>;

  // GitHub OAuth (Device Flow) login
  githubStatus: () => Promise<{ authed: boolean; login: string }>;
  githubStartLogin: () => Promise<{ ok: boolean; userCode?: string; verificationUri?: string; error?: string }>;
  githubCancelLogin: () => Promise<{ ok: boolean }>;
  githubLogout: () => Promise<{ ok: boolean }>;
  onGithubLoginResult: (cb: (res: { ok: boolean; login?: string; error?: string }) => void) => () => void;

  // Checkpoints (shadow-git "undo the agent")
  checkpointList: (cwd: string) => Promise<Checkpoint[]>;
  checkpointRestore: (cwd: string, commit: string) => Promise<{ ok: boolean; error?: string }>;
  checkpointDiff: (cwd: string, commit: string) => Promise<string>;
  onAgentCheckpoint: (callback: (data: { sessionId: string; runId: string; checkpoint: Checkpoint }) => void) => () => void;

  // Skills (scan .claude/skills, progressive disclosure)
  skillsList: (projectPath?: string) => Promise<SkillInfo[]>;
  skillsSetEnabled: (id: string, enabled: boolean) => Promise<boolean>;
  skillsRemove: (id: string, projectPath?: string) => Promise<{ ok: boolean; error?: string }>;
  skillsMarketSearch: (query?: string) => Promise<SkillMarketItem[]>;
  skillsMarketInstall: (id: string, scope: "project" | "global", projectPath?: string) => Promise<{ ok: boolean; dir?: string; error?: string }>;
  agentsList: (projectPath?: string) => Promise<AgentInfo[]>;
  agentsSetEnabled: (id: string, enabled: boolean) => Promise<boolean>;
  onAgentSubagent: (callback: (data: any) => void) => () => void;
  // Memory (long-term memory: .claude/memory, one-fact-per-file + frontmatter)
  memoryList: (projectPath?: string) => Promise<MemoryEntry[]>;
  memorySave: (projectPath: string | undefined, input: MemorySaveInput) => Promise<MemoryEntry>;
  memoryDelete: (projectPath: string | undefined, id: string) => Promise<{ ok: boolean; error?: string }>;
  memorySetEnabled: (id: string, enabled: boolean) => Promise<boolean>;
  memorySearch: (projectPath: string | undefined, query: string) => Promise<MemoryEntry[]>;
  onMemoryChanged: (callback: (data: { projectPath?: string }) => void) => () => void;
  // Checklist (persistent project task list: .claude/checklist.json)
  checklistList: (projectPath?: string) => Promise<ChecklistItem[]>;
  checklistAdd: (projectPath: string, content: string) => Promise<ChecklistItem>;
  checklistSetStatus: (projectPath: string, id: string, status: ChecklistStatus) => Promise<{ ok: boolean; item?: ChecklistItem }>;
  checklistEdit: (projectPath: string, id: string, content: string) => Promise<{ ok: boolean; item?: ChecklistItem }>;
  checklistRemove: (projectPath: string, id: string) => Promise<{ ok: boolean }>;
  onChecklistChanged: (callback: (data: { projectPath?: string }) => void) => () => void;
  onAgentChecklist: (callback: (data: { sessionId: string; action: "matched" | "added"; item: ChecklistItem }) => void) => () => void;
  hooksGet: (projectPath: string) => Promise<Record<string, any[]>>;
  hooksSave: (projectPath: string, hooks: Record<string, any[]>) => Promise<{ ok: boolean; error?: string }>;
  hooksOpenFile: (projectPath: string) => Promise<string>;
  hooksRun: (event: string, payload: any, projectPath: string) => Promise<{ block: boolean; reason: string; additionalContext: string }>;

  // MCP servers (real client)
  mcpList: () => Promise<McpServerConfig[]>;
  mcpConfigPath: () => Promise<string>;
  mcpSave: (servers: McpServerConfig[]) => Promise<boolean>;
  mcpReconnectAll: () => Promise<McpStatusRow[]>;
  mcpConnect: (cfg: McpServerConfig) => Promise<McpStatusRow | null>;
  mcpDisconnect: (id: string) => Promise<boolean>;
  mcpStatus: () => Promise<McpStatusRow[]>;
  mcpRegistrySearch: (query?: string, cursor?: string) => Promise<{ items: McpRegistryItem[]; nextCursor?: string }>;

  // Permissions (tool approval policy)
  getPermissions: () => Promise<PermissionsConfig>;
  setPermissionMode: (mode: PermissionMode) => Promise<boolean>;
  setToolPermission: (tool: string, allowed: boolean) => Promise<boolean>;
  setToolAuto: (tool: string, auto: boolean) => Promise<boolean>;

  // Secrets (encrypted API key storage)
  setSecret: (id: string, value: string) => Promise<boolean>;
  getSecret: (id: string) => Promise<string>;
  hasSecret: (id: string) => Promise<boolean>;
  deleteSecret: (id: string) => Promise<boolean>;

  // Agent loop
  agentSend: (req: any) => Promise<any>;
  agentStop: (sessionId: string) => Promise<{ ok: boolean }>;
  agentRunningSessions: () => Promise<string[]>;
  generateImage: (req: { providerId: string; baseUrl: string; model: string; endpoint?: "images" | "chat" | "raw"; headers?: Record<string, string>; prompts?: string[]; prompt?: string; size?: string; saveLocation?: string; customDir?: string; projectPath?: string }) => Promise<{ ok: boolean; error?: string; results?: { prompt: string; path?: string; error?: string }[] }>;
  agentContextStats: (workingDir: string) => Promise<{ systemPrompt: string; toolsJson: string; toolCount: number }>;
  onAgentTurn: (callback: (data: { runId: string; sessionId: string; messages?: any[]; delta?: { id: string; append: string }; done: boolean }) => void) => () => void;
  onAgentToken: (callback: (data: any) => void) => () => void;
  onAgentToolCall: (callback: (data: any) => void) => () => void;
  onAgentToolResult: (callback: (data: any) => void) => () => void;
  onAgentArtifact: (callback: (data: any) => void) => () => void;
  onAgentTodos: (callback: (data: { runId: string; sessionId: string; todos: any[] }) => void) => () => void;
  onAgentEnterPlan: (callback: (data: { sessionId: string; runId: string; reason: string }) => void) => () => void;
  onAgentGeneratedImages: (callback: (data: { id: string; sessionId: string; runId: string; paths: string[] }) => void) => () => void;
  onHooksChanged: (callback: (data: { cwd: string }) => void) => () => void;
  onAgentError: (callback: (data: any) => void) => () => void;
  onAgentRunState: (callback: (data: { sessionId: string; running: boolean }) => void) => () => void;
  onAgentToolApproval: (callback: (data: { callId: string; tool: string; permTool: string; input: any }) => void) => () => void;
  respondToolApproval: (callId: string, approved: boolean) => void;

  // Chat
  chatSend: (req: any) => Promise<any>;
  onStreamToken: (callback: (data: any) => void) => () => void;
  onChatError: (callback: (data: any) => void) => () => void;

  // Discord Bot 远程控制
  discordGetConfig: () => Promise<{ applicationId: string; allowedUserId: string; guildId?: string; autoConnect?: boolean; hasToken: boolean; status: string; error?: string }>;
  discordSaveConfig: (cfg: { applicationId?: string; allowedUserId?: string; guildId?: string; autoConnect?: boolean; token?: string }) => Promise<boolean>;
  discordConnect: () => Promise<{ ok: boolean; error?: string }>;
  discordDisconnect: () => Promise<boolean>;
  discordStatus: () => Promise<{ status: string; error?: string; botTag?: string }>;
  discordSetWorkingDir: (cwd: string) => Promise<boolean>;
  onDiscordStatusChange: (callback: (data: { status: string; error?: string }) => void) => () => void;
  onDiscordRunTurn: (callback: (data: { reqId: string; prompt: string; channelId: string }) => void) => () => void;
  discordRunTurnResponse: (reqId: string, result: { ok: boolean; text?: string; error?: string }) => void;
  onDiscordSessionOp: (callback: (data: { reqId: string; op: "new" | "list" | "switch"; arg?: string }) => void) => () => void;
  discordSessionOpResponse: (reqId: string, result: { ok: boolean; text?: string; error?: string }) => void;
  onDiscordProviderOp: (callback: (data: { reqId: string; op: "list" | "switch"; arg?: string }) => void) => () => void;
  discordProviderOpResponse: (reqId: string, result: { ok: boolean; text?: string; error?: string }) => void;
  onDiscordModeOp: (callback: (data: { reqId: string; mode?: string; relaySource?: string }) => void) => () => void;
  discordModeOpResponse: (reqId: string, result: { ok: boolean; text?: string; error?: string }) => void;
  onDiscordUiOp: (callback: (data: { reqId: string; op: string; relaySource?: string }) => void) => () => void;
  discordUiOpResponse: (reqId: string, result: { ok: boolean; text?: string; error?: string }) => void;
  onDiscordStatusLine: (callback: (data: { reqId: string; relaySource?: string }) => void) => () => void;
  discordStatusLineResponse: (reqId: string, result: { project?: string; model?: string; mode?: string }) => void;

  // 统一 Relay 远程控制（Discord + Telegram + 微信）。
  relayGetConfig: (source: string) => Promise<{ allowedUserId: string; autoConnect?: boolean; applicationId?: string; guildId?: string; accountId?: string; baseUrl?: string; userId?: string; hasToken: boolean; status: string; error?: string; botTag?: string }>;
  relaySaveConfig: (source: string, cfg: { allowedUserId?: string; autoConnect?: boolean; applicationId?: string; guildId?: string; accountId?: string; baseUrl?: string; userId?: string; token?: string }) => Promise<boolean>;
  relayConnect: (source: string) => Promise<{ ok: boolean; error?: string }>;
  relayDisconnect: (source: string) => Promise<boolean>;
  relayStatus: (source: string) => Promise<{ status: string; error?: string; botTag?: string }>;
  relayWeixinLogin: () => Promise<boolean>;
  relayWeixinCancelLogin: () => Promise<boolean>;
  onRelayWeixinQr: (callback: (data: { qrcode: string; qrcodeImageContent?: string; status: string; error?: string }) => void) => () => void;
  relayPush: (p: { source: string; channelId: string; kind: "progress" | "error"; text: string }) => Promise<boolean>;
  transportLogOpen: () => Promise<{ dir: string; enabled: boolean }>;
  transportLogSetEnabled: (on?: boolean) => Promise<{ enabled: boolean; dir: string }>;
  onRelayOpenProject: (callback: (data: { path: string }) => void) => () => void;
  onRelayStatusChange: (callback: (data: { source: string; status: string; error?: string; botTag?: string }) => void) => () => void;
}

declare global {
  interface Window {
    electron: ElectronAPI;
    api: UeCoworkerAPI;
  }
}

import { ipcMain, dialog, BrowserWindow, shell, app, clipboard, nativeImage } from "electron";
import { PtyManager } from "./pty-manager";
import { readdir, readFile, stat, writeFile, mkdir, rename, rm } from "fs/promises";
import { join, dirname } from "path";
import { existsSync } from "fs";
import { FileWatcher } from "./file-watcher";
import { SessionManager } from "./session-manager";
import { JsonlWatcher } from "./jsonl-watcher";
import { ProviderManager } from "./provider-manager";
import { PermissionsManager } from "./permissions-manager";
import { SecretsManager } from "./secrets-manager";
import { GitHubAuth } from "./github-auth";
import { runAgentLoop, runSubAgentLoop, buildSystemPrompt, type SubAgentDef, type SubAgentRunContext } from "./agent-loop";
import { TOOL_DEFINITIONS, generateImages, downloadImageBytes } from "./tools";
import { ChatStoreManager } from "./chat-store-manager";
import { mcpManager, type McpServerConfig } from "./mcp-manager";
import { gitManager, setGithubTokenProvider } from "./git-manager";
import { checkpointManager } from "./checkpoint-manager";
import { balanceHistoryManager } from "./balance-history-manager";
import { skillsManager } from "./skills-manager";
import { skillsMarket } from "./skills-market";
import { pluginsMarket } from "./plugins-market";
import { agentsManager } from "./agents-manager";
import { hooksManager } from "./hooks-manager";
import { transportLogDir, transportLogEnabled, setTransportLogEnabled, setSessionLabel } from "./transport-logger";
import { memoryManager, type MemoryType } from "./memory-manager";
import { checklistManager, type ChecklistStatus } from "./checklist-manager";
import { initDiscordBotManager, type DiscordBotManager } from "./discord-bot-manager";
import { initRelayCore, type RelayCore } from "./relay/relay-core";
import { runRelayTool } from "./relay/relay-tools";
import type { RelaySource } from "./relay/protocol";


const fileWatcher = new FileWatcher();
const sessionManager = new SessionManager();
const jsonlWatcher = new JsonlWatcher();
const providerManager = new ProviderManager();
const permissionsManager = new PermissionsManager();
const secretsManager = new SecretsManager();
const chatStoreManager = new ChatStoreManager();
// GitHub OAuth（Device Flow）登录管理。token 经 secretsManager 加密存本地。
const githubAuth = new GitHubAuth(secretsManager);
// 给 git-manager 注入取 token 的回调，使 push/PR 自动用登录态鉴权（不依赖 gh CLI）。
setGithubTokenProvider(() => githubAuth.getToken());

export { permissionsManager };

export function registerIpcHandlers(
  ptyManager: PtyManager,
  getWindow: () => BrowserWindow | null
): void {
  // 把保存位置枚举解析成绝对目录。pictures=系统图片库；documents=文档(AI 默认)；
  // project=当前项目下 generated-images；app=应用数据 chat-images；custom=用户选定路径。
  const resolveImageSaveDir = (loc?: string, projectPath?: string, customPath?: string): string => {
    switch (loc) {
      case "pictures": return join(app.getPath("pictures"), "ue-coworker-images");
      case "documents": return join(app.getPath("documents"), "ue-coworker-images");
      case "project": return projectPath ? join(projectPath, "generated-images") : join(app.getPath("documents"), "ue-coworker-images");
      case "custom": return customPath && customPath.trim() ? customPath : join(app.getPath("userData"), "chat-images");
      case "app":
      default: return join(app.getPath("userData"), "chat-images");
    }
  };

  // Window controls
  ipcMain.handle("window:minimize", () => {
    getWindow()?.minimize();
  });
  ipcMain.handle("window:maximize", () => {
    const win = getWindow();
    if (win?.isMaximized()) win.unmaximize();
    else win?.maximize();
  });
  ipcMain.handle("window:close", () => {
    getWindow()?.close();
  });
  ipcMain.handle("window:isMaximized", () => {
    return getWindow()?.isMaximized() ?? false;
  });
  // 系统通知点击后把窗口拉回前台（最小化则恢复，失焦则置顶聚焦）。
  ipcMain.handle("window:focus", () => {
    const win = getWindow();
    if (!win) return false;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    return true;
  });

  // Dialog
  ipcMain.handle("dialog:openDirectory", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory"],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle("dialog:openFile", async (_event, options) => {
    const result = await dialog.showOpenDialog({
      properties: ["openFile"],
      ...options,
    });
    return result.canceled ? null : result.filePaths[0];
  });

  // 通用保存文本到用户选择的文件（配置导出用）。
  ipcMain.handle("dialog:saveFile", async (_event, opts: { defaultPath?: string; content: string; filters?: { name: string; extensions: string[] }[] }) => {
    try {
      const win = getWindow();
      const result = await dialog.showSaveDialog(win!, {
        defaultPath: opts?.defaultPath,
        filters: opts?.filters || [{ name: "JSON", extensions: ["json"] }, { name: "All Files", extensions: ["*"] }],
      });
      if (result.canceled || !result.filePath) return { ok: false, canceled: true };
      await writeFile(result.filePath, opts?.content ?? "", "utf-8");
      return { ok: true, path: result.filePath };
    } catch (e: any) {
      return { ok: false, error: e.message };
    }
  });

  // Shell
  ipcMain.handle("shell:openPath", async (_event, path: string) => {
    return shell.openPath(path);
  });

  ipcMain.handle("shell:openExternal", async (_event, url: string) => {
    return shell.openExternal(url);
  });

  // 确保目录存在后再用文件管理器打开（目录不存在则先创建，避免系统弹「找不到文件夹」）。
  // 用于 .claude/agents 等「按需才出现」的目录按钮。
  ipcMain.handle("shell:ensureDirAndOpen", async (_event, dir: string) => {
    if (!dir) return "no path";
    try {
      if (!existsSync(dir)) await mkdir(dir, { recursive: true });
    } catch (e: any) {
      return e?.message || String(e);
    }
    return shell.openPath(dir);
  });

  // 在系统文件管理器中定位并选中该项（右键「在资源管理器中查看」）。
  ipcMain.handle("shell:showInFolder", async (_event, path: string) => {
    shell.showItemInFolder(path);
    return true;
  });

  // 传输日志：返回日志目录 + 是否开启，并在文件管理器中打开该目录。用于离线验证
  // 提示词拼接 / prompt 缓存命中（设 CW_TRANSPORT_LOG=1 后重启采集）。
  ipcMain.handle("transport-log:open", async () => {
    const dir = transportLogDir();
    await shell.openPath(dir);
    return { dir, enabled: transportLogEnabled() };
  });

  // 运行期开/关传输日志（无需重启）。on 省略则仅返回当前状态。
  ipcMain.handle("transport-log:setEnabled", async (_event, on?: boolean) => {
    if (typeof on === "boolean") setTransportLogEnabled(on);
    return { enabled: transportLogEnabled(), dir: transportLogDir() };
  });

  // PTY Sessions
  ipcMain.handle(
    "pty:create",
    async (_event, { cwd, model, name, shell }) => {
      try {
        const session = ptyManager.createSession(cwd, model, name, shell);
        // 按会话 id 订阅并转发数据/退出到渲染层。PtyManager 用 `data:${id}` /
        // `exit:${id}` 这类带 id 的事件名发射，必须逐会话监听——之前用通配
        // `data:*` 监听是失效的（Node EventEmitter 不支持通配符），导致 shell
        // 输出永远到不了渲染层、终端黑屏。退出时清理监听避免泄漏。
        const id = session.id;
        const onData = (data: string) => {
          getWindow()?.webContents.send(`pty:data:${id}`, data);
        };
        const onExit = (code: number) => {
          getWindow()?.webContents.send(`pty:exit:${id}`, code);
          ptyManager.removeListener(`data:${id}`, onData);
          ptyManager.removeListener(`exit:${id}`, onExit);
        };
        ptyManager.on(`data:${id}`, onData);
        ptyManager.on(`exit:${id}`, onExit);
        return {
          id: session.id,
          cwd: session.cwd,
          model: session.model,
          name: session.name,
          createdAt: session.createdAt,
        };
      } catch (err: any) {
        return { error: err?.message || "Failed to create terminal session" };
      }
    }
  );

  ipcMain.on("pty:write", (_event, { id, data }) => {
    ptyManager.writeToSession(id, data);
  });

  ipcMain.on("pty:resize", (_event, { id, cols, rows }) => {
    ptyManager.resizeSession(id, cols, rows);
  });

  ipcMain.handle("pty:kill", async (_event, id: string) => {
    ptyManager.killSession(id);
    return true;
  });

  ipcMain.handle("pty:getAll", async () => {
    return ptyManager.getAllSessions().map((s) => ({
      id: s.id,
      cwd: s.cwd,
      model: s.model,
      name: s.name,
      createdAt: s.createdAt,
    }));
  });

  // File System
  ipcMain.handle(
    "fs:readDir",
    async (_event, dirPath: string) => {
      try {
        const entries = await readdir(dirPath, { withFileTypes: true });
        return entries.map((e) => ({
          name: e.name,
          isDirectory: e.isDirectory(),
          isFile: e.isFile(),
          isSymlink: e.isSymbolicLink(),
        }));
      } catch {
        return [];
      }
    }
  );

  ipcMain.handle(
    "fs:readFile",
    async (_event, filePath: string) => {
      try {
        const content = await readFile(filePath, "utf-8");
        const stats = await stat(filePath);
        return {
          content,
          size: stats.size,
          modifiedAt: stats.mtimeMs,
        };
      } catch (e: any) {
        return { error: e.message };
      }
    }
  );

  ipcMain.handle(
    "fs:stat",
    async (_event, filePath: string) => {
      try {
        const stats = await stat(filePath);
        return {
          size: stats.size,
          isDirectory: stats.isDirectory(),
          isFile: stats.isFile(),
          modifiedAt: stats.mtimeMs,
          createdAt: stats.birthtimeMs,
        };
      } catch {
        return null;
      }
    }
  );

  ipcMain.handle(
    "fs:writeFile",
    async (_event, filePath: string, content: string) => {
      try {
        await mkdir(dirname(filePath), { recursive: true });
        await writeFile(filePath, content, "utf-8");
        return { ok: true };
      } catch (e: any) {
        return { ok: false, error: e.message };
      }
    }
  );

  // 重命名 / 移动（右键重命名）。
  ipcMain.handle("fs:rename", async (_event, oldPath: string, newPath: string) => {
    try {
      if (existsSync(newPath)) return { ok: false, error: "目标已存在" };
      await rename(oldPath, newPath);
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e.message };
    }
  });

  // 删除文件或文件夹（递归，右键删除）。
  ipcMain.handle("fs:delete", async (_event, path: string) => {
    try {
      await rm(path, { recursive: true, force: true });
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e.message };
    }
  });

  // 新建文件夹（右键新建文件夹）。
  ipcMain.handle("fs:mkdir", async (_event, path: string) => {
    try {
      if (existsSync(path)) return { ok: false, error: "目标已存在" };
      await mkdir(path, { recursive: true });
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e.message };
    }
  });

  // 新建空文件（右键新建文件）。已存在则报错，避免覆盖。
  ipcMain.handle("fs:createFile", async (_event, path: string) => {
    try {
      if (existsSync(path)) return { ok: false, error: "目标已存在" };
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, "", "utf-8");
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle("app:getHomeDir", async () => {
    return app.getPath("home");
  });

  // 列出项目内文件相对路径（用于聊天框 @ 文件提及）。跳过常见忽略目录，限量。
  ipcMain.handle("fs:listProjectFiles", async (_event, root: string, limit?: number) => {
    if (!root || !existsSync(root)) return [];
    const SKIP = new Set(["node_modules", ".git", "dist", "out", ".cache", ".next", "build", "coverage", ".turbo"]);
    const cap = Math.min(Number(limit) || 4000, 8000);
    const results: string[] = [];
    const { sep } = require("path");
    async function walk(dir: string): Promise<void> {
      if (results.length >= cap) return;
      let entries;
      try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (results.length >= cap) return;
        if (e.name.startsWith(".") && e.name !== ".env") continue;
        const full = join(dir, e.name);
        if (e.isDirectory()) { if (!SKIP.has(e.name)) await walk(full); }
        else { results.push(full.slice(root.length).replace(/^[\\/]/, "").split(sep).join("/")); }
      }
    }
    await walk(root);
    return results;
  });

  // File Watcher
  ipcMain.handle(
    "fs:watchDir",
    async (_event, dirPath: string) => {
      const win = getWindow();
      if (!win) return false;
      fileWatcher.watch(dirPath, (type, filePath) => {
        win.webContents.send("fs:fileChanged", { type, path: filePath });
      });
      return true;
    }
  );

  ipcMain.handle("fs:unwatchDir", async (_event, dirPath: string) => {
    fileWatcher.unwatch(dirPath);
    return true;
  });

  // Session Manager
  ipcMain.handle("session:list", async () => {
    return sessionManager.listSessions();
  });

  ipcMain.handle("session:getRecent", async () => {
    return sessionManager.getRecentProjects();
  });

  ipcMain.handle(
    "session:addRecent",
    async (_event, projectPath: string) => {
      sessionManager.addRecentProject(projectPath);
      return true;
    }
  );

  // Analytics
  ipcMain.handle(
    "analytics:getProjectStats",
    async (_event, projectPath: string) => {
      return sessionManager.getProjectStats(projectPath);
    }
  );

  // Chat persistence (one JSONL file per session, grouped by project)
  ipcMain.handle("chats:list", async (_event, projectPath: string) => {
    return chatStoreManager.listChats(projectPath);
  });
  ipcMain.handle("chats:append", async (_event, projectPath: string, meta: any, message: any) => {
    await chatStoreManager.appendMessage(projectPath, meta, message);
    return true;
  });
  ipcMain.handle("chats:writeSession", async (_event, projectPath: string, session: any) => {
    await chatStoreManager.writeSession(projectPath, session);
    return true;
  });
  // Analytics：聚合本应用自己对话的真实 usage（取代读 Claude CLI 日志的旧实现）。
  ipcMain.handle("chats:analytics", async (_event, projectPath: string) => {
    return chatStoreManager.analytics(projectPath);
  });
  ipcMain.handle("chats:delete", async (_event, projectPath: string, sessionId: string) => {
    await chatStoreManager.deleteChat(projectPath, sessionId);
    return true;
  });

  // 把本地图片读成 data URL 供渲染端 <img> 显示（CSP 允许 data:，但不允许 file:）。
  ipcMain.handle("chats:readImage", async (_event, path: string) => {
    try {
      const p = String(path || "");
      // data URI：原样返回（渲染层可直接当 src）。
      if (p.indexOf("data:image/") === 0) return { ok: true, dataUrl: p };
      // 远程 http(s) 图片：主进程下载（绕过渲染层 CSP）→ dataUrl。模型有时把生成图以
      // 远程 URL 写进正文，渲染层直接 <img src> 会被 CSP 挡成"裂开"，故在此下载内联。
      if (/^https?:\/\//i.test(p)) {
        const buf = await downloadImageBytes(p, 5, 30000);
        if (!buf) return { ok: false, error: "download failed" };
        const um = /\.([a-zA-Z0-9]{3,4})(?:[?#]|$)/.exec(p);
        const ext = (um ? um[1] : "png").toLowerCase();
        const mime = ext === "jpg" ? "jpeg" : ext;
        return { ok: true, dataUrl: "data:image/" + mime + ";base64," + buf.toString("base64") };
      }
      const buf = await readFile(p);
      const ext = (p.split(".").pop() || "png").toLowerCase();
      const mime = ext === "jpg" ? "jpeg" : ext;
      return { ok: true, dataUrl: "data:image/" + mime + ";base64," + buf.toString("base64") };
    } catch (e: any) {
      return { ok: false, error: e.message };
    }
  });

  // 把本地图片另存为：弹保存对话框，复制到用户选定路径。
  ipcMain.handle("chats:saveImageAs", async (_event, srcPath: string) => {
    try {
      if (!existsSync(srcPath)) return { ok: false, error: "源文件不存在" };
      const base = srcPath.split(/[\\/]/).pop() || "image.png";
      const ext = (base.split(".").pop() || "png").toLowerCase();
      const win = getWindow();
      const result = await dialog.showSaveDialog(win!, {
        defaultPath: base,
        filters: [{ name: "Images", extensions: [ext] }, { name: "All Files", extensions: ["*"] }],
      });
      if (result.canceled || !result.filePath) return { ok: false, canceled: true };
      const buf = await readFile(srcPath);
      await writeFile(result.filePath, buf);
      return { ok: true, path: result.filePath };
    } catch (e: any) {
      return { ok: false, error: e.message };
    }
  });

  // 复制本地图片到系统剪贴板（作为图像，可粘贴到其它应用）。
  ipcMain.handle("chats:copyImage", async (_event, srcPath: string) => {
    try {
      if (!existsSync(srcPath)) return { ok: false, error: "源文件不存在" };
      const img = nativeImage.createFromPath(srcPath);
      if (img.isEmpty()) return { ok: false, error: "无法读取图片" };
      clipboard.writeImage(img);
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e.message };
    }
  });

  // 保存聊天附带的图片到本地（userData/chat-images），返回绝对路径。渲染端把
  // 路径存进消息并随对话落盘；发送给 vision 模型时由 agent-loop 从路径读回编码。
  ipcMain.handle("chats:saveImage", async (_event, dataUrl: string, ext: string) => {
    try {
      const m = /^data:([^;]+);base64,(.*)$/.exec(dataUrl || "");
      if (!m) return { ok: false, error: "Invalid data URL" };
      const dir = join(app.getPath("userData"), "chat-images");
      if (!existsSync(dir)) await mkdir(dir, { recursive: true });
      const safeExt = (ext || "png").replace(/[^a-z0-9]/gi, "").slice(0, 5) || "png";
      const name = "img-" + Date.now() + "-" + Math.floor(process.hrtime()[1] % 1e6) + "." + safeExt;
      const file = join(dir, name);
      await writeFile(file, Buffer.from(m[2], "base64"));
      return { ok: true, path: file };
    } catch (e: any) {
      return { ok: false, error: e.message };
    }
  });


  // Permissions
  ipcMain.handle("permissions:get", async () => {
    return permissionsManager.getConfig();
  });
  ipcMain.handle("permissions:setMode", async (_event, mode: string) => {
    await permissionsManager.setMode(mode as any);
    return true;
  });
  ipcMain.handle("permissions:setTool", async (_event, tool: string, allowed: boolean) => {
    await permissionsManager.setToolPermission(tool, allowed);
    return true;
  });
  ipcMain.handle("permissions:setToolAuto", async (_event, tool: string, auto: boolean) => {
    await permissionsManager.setToolAuto(tool, auto);
    return true;
  });


  // MCP servers — real client (connect stdio/http/sse, list+call tools).
  // ---- Skills(扫描 .claude/skills,渐进式披露注入)----
  ipcMain.handle("skills:list", async (_event, projectPath?: string) => {
    return skillsManager.list(projectPath);
  });
  ipcMain.handle("skills:setEnabled", async (_event, id: string, enabled: boolean) => {
    await skillsManager.setEnabled(id, enabled);
    return true;
  });
  ipcMain.handle("skills:remove", async (_event, id: string, projectPath?: string) => {
    return skillsManager.remove(id, projectPath);
  });
  // Skill marketplace: discover skills from curated GitHub repos and install them.
  ipcMain.handle("skillsMarket:search", async (_event, query?: string) => {
    return skillsMarket.search(query);
  });
  ipcMain.handle("skillsMarket:install", async (_event, id: string, scope: "project" | "global", projectPath?: string) => {
    return skillsMarket.install(id, scope, projectPath);
  });

  // UE 插件市场:发现打了约定 topic 的插件仓库,一键安装到当前工程的 Plugins/。
  ipcMain.handle("pluginsMarket:search", async (_event, query?: string) => {
    return pluginsMarket.search(query);
  });
  ipcMain.handle("pluginsMarket:install", async (_event, id: string, projectPath?: string) => {
    return pluginsMarket.install(id, projectPath);
  });
  // 我的插件:列出/卸载当前工程 Plugins/ 下已安装的插件。
  ipcMain.handle("pluginsMarket:listInstalled", async (_event, projectPath?: string) => {
    return pluginsMarket.listInstalled(projectPath);
  });
  ipcMain.handle("pluginsMarket:uninstall", async (_event, name: string, projectPath?: string) => {
    return pluginsMarket.uninstall(name, projectPath);
  });

  // ---- Sub-agents(扫描 .claude/agents,经 task 工具派发的子 agent 定义)----
  ipcMain.handle("agents:list", async (_event, projectPath?: string) => {
    return agentsManager.list(projectPath);
  });
  ipcMain.handle("agents:setEnabled", async (_event, id: string, enabled: boolean) => {
    await agentsManager.setEnabled(id, enabled);
    return true;
  });

  // ---- Memory(长期记忆:扫描 .claude/memory,一事实一文件 + frontmatter)----
  ipcMain.handle("memory:list", async (_event, projectPath?: string) => {
    return memoryManager.list(projectPath);
  });
  ipcMain.handle("memory:save", async (_event, projectPath: string | undefined, input: { name?: string; description: string; type: MemoryType; body?: string; source?: "project" | "global" }) => {
    const entry = await memoryManager.save(projectPath, input);
    getWindow()?.webContents.send("memory:changed", { projectPath });
    return entry;
  });
  ipcMain.handle("memory:delete", async (_event, projectPath: string | undefined, id: string) => {
    const res = await memoryManager.remove(projectPath, id);
    if (res.ok) getWindow()?.webContents.send("memory:changed", { projectPath });
    return res;
  });
  ipcMain.handle("memory:setEnabled", async (_event, id: string, enabled: boolean) => {
    await memoryManager.setEnabled(id, enabled);
    getWindow()?.webContents.send("memory:changed", {});
    return true;
  });
  ipcMain.handle("memory:search", async (_event, projectPath: string | undefined, query: string) => {
    return memoryManager.search(projectPath, query, 12);
  });

  // ---- Checklist(持久任务清单:项目 .claude/checklist.json,用户+AI 共同维护)----
  ipcMain.handle("checklist:list", async (_event, projectPath?: string) => {
    return checklistManager.list(projectPath);
  });
  ipcMain.handle("checklist:add", async (_event, projectPath: string, content: string) => {
    const item = await checklistManager.add(projectPath, content, "todo");
    getWindow()?.webContents.send("checklist:changed", { projectPath });
    return item;
  });
  ipcMain.handle("checklist:setStatus", async (_event, projectPath: string, id: string, status: ChecklistStatus) => {
    const res = await checklistManager.setStatus(projectPath, id, status);
    if (res.ok) getWindow()?.webContents.send("checklist:changed", { projectPath });
    return res;
  });
  ipcMain.handle("checklist:edit", async (_event, projectPath: string, id: string, content: string) => {
    const res = await checklistManager.edit(projectPath, id, content);
    if (res.ok) getWindow()?.webContents.send("checklist:changed", { projectPath });
    return res;
  });
  ipcMain.handle("checklist:remove", async (_event, projectPath: string, id: string) => {
    const res = await checklistManager.remove(projectPath, id);
    if (res.ok) getWindow()?.webContents.send("checklist:changed", { projectPath });
    return res;
  });

  // ---- Hooks (event-driven automation; project .claude/settings.json) ----
  ipcMain.handle("hooks:get", async (_event, projectPath: string) => {
    return hooksManager.loadConfig(projectPath);
  });
  ipcMain.handle("hooks:save", async (_event, projectPath: string, hooks: any) => {
    return hooksManager.writeConfig(projectPath, hooks || {});
  });
  ipcMain.handle("hooks:openFile", async (_event, projectPath: string) => {
    const p = hooksManager.settingsFile(projectPath);
    // Ensure the file exists so the editor opens something (writes {} hooks if new).
    if (!existsSync(p)) await hooksManager.writeConfig(projectPath, {});
    return shell.openPath(p);
  });
  // Generic event runner for hooks the renderer owns the lifecycle of (currently
  // PreCompact, fired from the renderer's /compact path). Returns the normalized
  // outcome so the caller can honor a block decision.
  ipcMain.handle("hooks:run", async (_event, event: string, payload: any, projectPath: string) => {
    return hooksManager.runHooks(String(event || ""), payload && typeof payload === "object" ? payload : {}, projectPath);
  });

  ipcMain.handle("mcp:list", async () => {
    return mcpManager.loadConfig();
  });
  ipcMain.handle("mcp:configPath", async () => {
    return mcpManager.getConfigPath();
  });
  ipcMain.handle("mcp:save", async (_event, servers: McpServerConfig[]) => {
    await mcpManager.saveConfig(Array.isArray(servers) ? servers : []);
    return true;
  });
  // Reconnect everything from the saved config; returns status summary.
  ipcMain.handle("mcp:reconnectAll", async () => {
    await mcpManager.disconnectAll();
    await mcpManager.connectAll();
    return mcpManager.statusSummary();
  });
  // Connect/refresh a single server (after add/edit); returns its status row.
  ipcMain.handle("mcp:connect", async (_event, cfg: McpServerConfig) => {
    await mcpManager.connectServer(cfg);
    return mcpManager.statusSummary().find((s) => s.id === cfg.id) || null;
  });
  ipcMain.handle("mcp:disconnect", async (_event, id: string) => {
    await mcpManager.disconnectServer(id);
    return true;
  });
  ipcMain.handle("mcp:status", async () => {
    return mcpManager.statusSummary();
  });
  // Search the official MCP registry (marketplace); returns install-ready drafts.
  ipcMain.handle("mcp:registrySearch", async (_event, query?: string, cursor?: string) => {
    return mcpManager.registrySearch(query, cursor);
  });

  // Git version control (system git CLI).
  ipcMain.handle("git:status", async (_event, cwd: string) => gitManager.status(cwd));
  ipcMain.handle("git:diff", async (_event, cwd: string, file: string, staged: boolean) => gitManager.diff(cwd, file, !!staged));
  ipcMain.handle("git:stage", async (_event, cwd: string, paths: string[]) => gitManager.stage(cwd, paths || []));
  ipcMain.handle("git:stageAll", async (_event, cwd: string) => gitManager.stageAll(cwd));
  ipcMain.handle("git:unstage", async (_event, cwd: string, paths: string[]) => gitManager.unstage(cwd, paths || []));
  ipcMain.handle("git:discard", async (_event, cwd: string, paths: string[]) => gitManager.discard(cwd, paths || []));
  ipcMain.handle("git:commit", async (_event, cwd: string, message: string) => gitManager.commit(cwd, message));
  ipcMain.handle("git:log", async (_event, cwd: string, limit: number) => gitManager.log(cwd, limit || 50));
  ipcMain.handle("git:branches", async (_event, cwd: string) => gitManager.branches(cwd));
  ipcMain.handle("git:checkout", async (_event, cwd: string, branch: string) => gitManager.checkout(cwd, branch));
  ipcMain.handle("git:createBranch", async (_event, cwd: string, name: string) => gitManager.createBranch(cwd, name));
  ipcMain.handle("git:push", async (_event, cwd: string) => gitManager.push(cwd));
  ipcMain.handle("git:pull", async (_event, cwd: string) => gitManager.pull(cwd));
  ipcMain.handle("git:init", async (_event, cwd: string) => gitManager.init(cwd));
  // Commit-level operations (history context menu).
  ipcMain.handle("git:revert", async (_event, cwd: string, commit: string) => gitManager.revert(cwd, commit));
  ipcMain.handle("git:cherryPick", async (_event, cwd: string, commit: string) => gitManager.cherryPick(cwd, commit));
  ipcMain.handle("git:reset", async (_event, cwd: string, commit: string, mode: "soft" | "mixed" | "hard") => gitManager.reset(cwd, commit, mode));
  ipcMain.handle("git:createBranchAt", async (_event, cwd: string, name: string, commit: string) => gitManager.createBranchAt(cwd, name, commit));
  ipcMain.handle("git:checkoutCommit", async (_event, cwd: string, commit: string) => gitManager.checkoutCommit(cwd, commit));
  ipcMain.handle("git:commitDiff", async (_event, cwd: string, commit: string) => gitManager.commitDiff(cwd, commit));
  ipcMain.handle("git:remoteInfo", async (_event, cwd: string) => gitManager.remoteInfo(cwd));
  ipcMain.handle("git:setRemote", async (_event, cwd: string, url: string) => gitManager.setRemote(cwd, url));
  // Pull Request (GitHub CLI).
  ipcMain.handle("git:ghStatus", async (_event, cwd: string) => gitManager.ghStatus(cwd));
  ipcMain.handle("git:createPR", async (_event, cwd: string, opts: any) => gitManager.createPullRequest(cwd, opts || {}));
  ipcMain.handle("git:openPR", async (_event, cwd: string) => gitManager.openPullRequest(cwd));

  // ---- GitHub OAuth（Device Flow）一键登录 ----
  // 登录状态：是否已登录 + 当前用户名。
  ipcMain.handle("github:status", async () => {
    const authed = await githubAuth.isAuthed();
    let login = "";
    if (authed) { try { login = await githubAuth.currentLogin(); } catch { /* 网络/失效忽略 */ } }
    return { authed, login };
  });
  // 退出登录（删本地 token）。
  ipcMain.handle("github:logout", async () => { await githubAuth.logout(); return { ok: true }; });
  // 启动 Device Flow：立即返回 userCode/verificationUri 给渲染层展示并自动开浏览器；
  // 后台轮询，完成后经 "github:loginResult" 事件回推结果。abort 用一次性标志。
  let githubAbort: { aborted: boolean } | null = null;
  ipcMain.handle("github:startLogin", async () => {
    try {
      githubAbort = { aborted: false };
      const handle = await githubAuth.startDeviceFlow(githubAbort);
      // 后台等结果，回推渲染层。
      handle.done.then((res) => {
        try {
          const w = getWindow();
          if (w && !w.isDestroyed()) w.webContents.send("github:loginResult", res);
        } catch { /* 窗口已销毁忽略 */ }
      });
      return { ok: true, userCode: handle.userCode, verificationUri: handle.verificationUri };
    } catch (e: any) {
      return { ok: false, error: String(e && e.message || e) };
    }
  });
  // 取消正在进行的登录轮询。
  ipcMain.handle("github:cancelLogin", async () => { if (githubAbort) githubAbort.aborted = true; return { ok: true }; });

  ipcMain.handle("git:restoreFile", async (_event, cwd: string, commit: string, file: string) => gitManager.restoreFile(cwd, commit, file));
  ipcMain.handle("git:fileHistory", async (_event, cwd: string, file: string, limit: number) => gitManager.fileHistory(cwd, file, limit || 50));

  // Checkpoints (shadow-git snapshots — "undo the agent").
  ipcMain.handle("checkpoint:list", async (_event, cwd: string) => checkpointManager.list(cwd));
  ipcMain.handle("checkpoint:restore", async (_event, cwd: string, commit: string) => checkpointManager.restore(cwd, commit));
  ipcMain.handle("checkpoint:diff", async (_event, cwd: string, commit: string) => checkpointManager.diff(cwd, commit));

  // Agent loop
  // Single-flight lock: one running loop per session. Tracks the AbortController
  // so the renderer can stop an in-flight turn via "agent:stop".
  const runningLoops = new Map<string, AbortController>();
  // Discord Bot 的前向引用（实例在本函数后段创建）。Discord 发起的一轮里，agent 的
  // 提问/计划卡经此转回 Discord 频道，而非只弹桌面卡片。
  let discordBotRef: DiscordBotManager | null = null;
  // 统一 Relay 中枢的前向引用。Discord/Telegram 发起的一轮里，agent 的提问/计划卡经
  // 它转回对应平台频道（与桌面卡片双通道，任一先答即采用）。
  let relayCoreRef: RelayCore | null = null;


  ipcMain.handle("agent:send", async (_event, agentReq: any) => {
    const win = getWindow();
    if (!win) throw new Error("No window");

    const sessionId: string = agentReq.sessionId || "default";
    // 传输日志按会话标题命名文件（仅 CW_TRANSPORT_LOG 开启时生效）。
    if (agentReq.sessionTitle) setSessionLabel(sessionId, String(agentReq.sessionTitle));
    if (runningLoops.has(sessionId)) {
      // Caller (renderer) is expected to queue and retry when this turn finishes.
      return { error: "BUSY" };
    }
    const controller = new AbortController();
    runningLoops.set(sessionId, controller);
    // 权威运行状态：唯一真相源。渲染层据此决定发送/终止按钮，避免被中途的
    // 非致命错误（如 max_tokens 提示）误清 busy，或异常退出后 busy 卡死。
    try { if (!win.isDestroyed()) win.webContents.send("agent:run-state", { sessionId, running: true }); } catch { /* window 可能已销毁 */ }

    // Skills:把已启用 skill 的 name+description+SKILL.md 绝对路径拼成注入块,
    // 经 agentReq 传入 loop(渐进式披露第一层)。失败不影响主流程。
    try {
      agentReq.skillsBlock = await skillsManager.systemPromptBlock(agentReq.workingDir);
    } catch { agentReq.skillsBlock = ""; }

    // 子 agent 名单(roster):可派发的 agent 名 + mode + description,作为独立 system
    // 块注入(与 skillsBlock 同款,进稳定前缀)。task 工具 schema 保持静态字节恒定,
    // 名单只在这里枚举——启停 agent 只改这个块,不触碰工具定义缓存断点。
    try {
      agentReq.agentsBlock = await agentsManager.systemPromptBlock(agentReq.workingDir);
    } catch { agentReq.agentsBlock = ""; }

    // 记忆/CLAUDE.md:CLAUDE.md(global/project/local)+ 常驻长期记忆索引(Tier 0),
    // 经 agentReq 传入 loop,注入系统提示稳定前缀。失败不影响主流程。
    try {
      agentReq.memoryBlock = await memoryManager.systemPromptBlock(agentReq.workingDir);
    } catch { agentReq.memoryBlock = ""; }

    // 远程通道标识（approval/followup 双通道共用）：relaySource(discord/telegram) +
    // relayChannelId，任一存在即把审批/提问卡转到对应平台（与桌面卡片双通道）。
    const discordChannelId: string = typeof agentReq.discordChannelId === "string" ? agentReq.discordChannelId : "";
    const relaySource: RelaySource | "" = (agentReq.relaySource === "discord" || agentReq.relaySource === "telegram") ? agentReq.relaySource : "";
    const relayChannelId: string = typeof agentReq.relayChannelId === "string" ? agentReq.relayChannelId : "";

    // Approval bridge: main asks the renderer, renderer replies once per callId.
    // 中止信号也会解锁等待（resolve(false)=拒绝），否则一轮卡在等待时 abort 不生效。
    // 远程一轮（relaySource 非空）：审批卡也转到对应平台，手机按钮批准/拒绝；与桌面双通道。
    const requestApproval = (apprReq: { callId: string; tool: string; permTool: string; input: any }): Promise<boolean> => {
      return new Promise((resolve) => {
        const channel = "agent:tool-approval-response:" + apprReq.callId;
        let done = false;
        let relayPromptId = "";
        const finish = (v: boolean) => {
          if (done) return;
          done = true;
          clearTimeout(timeout);
          ipcMain.removeAllListeners(channel);
          controller.signal.removeEventListener("abort", onAbort);
          if (relayPromptId && relayCoreRef) { try { relayCoreRef.cancelPrompt(relayPromptId); } catch { /* ignore */ } }
          // 通知渲染层撤掉桌面审批卡：无论答复来自手机、超时还是 abort，桌面卡都该消失
          // （否则手机批准后桌面残留一张点了也无效的审批卡）。
          try {
            if (!win.isDestroyed()) {
              win.webContents.send("agent:tool-approval-resolved", { sessionId, callId: apprReq.callId });
            }
          } catch { /* 窗口不可用忽略 */ }
          resolve(v);
        };
        const onAbort = () => finish(false);
        const timeout = setTimeout(() => finish(false), 5 * 60 * 1000); // no response → declined
        ipcMain.once(channel, (_e, approved: boolean) => finish(!!approved));
        controller.signal.addEventListener("abort", onAbort, { once: true });
        win.webContents.send("agent:tool-approval-request", { ...apprReq, sessionId });

        // 远程审批通道：把审批转成一张「批准/拒绝」按钮卡（不接受自由文本）。
        if (relaySource && relayChannelId && relayCoreRef) {
          const summary = approvalSummary(apprReq.tool, apprReq.permTool, apprReq.input);
          const { promptId, answer } = relayCoreRef.askPrompt({
            source: relaySource, channelId: relayChannelId,
            question: "🔐 工具审批：" + summary,
            options: ["✅ 批准", "❌ 拒绝"],
            plan: "",            // 非计划卡
            allowText: false,    // 审批只按钮
          });
          relayPromptId = promptId;
          answer.then((ans) => {
            if (ans) finish(ans.indexOf("批准") >= 0 || ans.indexOf("✅") >= 0);
          }).catch(() => {});
        }
      });
    };

    // Followup bridge: agent asks the user a question (ask_followup_question),
    // renderer replies with the chosen/typed answer. Same callId round-trip as
    // the approval bridge.
    // - Discord 发起的一轮（agentReq.discordChannelId 非空）：问题转到 Discord 频道，
    //   你在手机上答（按钮或文字），答案回传给 agent；同时桌面卡片也照常弹（双通道，
    //   任一先答即采用）。
    // - 中止信号会解锁等待（返回空答复），让 /stop / 断开能真正终止卡住的一轮。
    const requestFollowup = (fReq: { callId: string; questions: { question: string; options?: string[] }[]; plan?: string }): Promise<string[]> => {
      return new Promise((resolve) => {
        const channel = "agent:followup-response:" + fReq.callId;
        const count = fReq.questions.length;
        let done = false;
        // relay 提问 id（走新 RelayCore 通道时记录，finish 时撤回远程卡）。
        let relayPromptId = "";
        const finish = (answers: string[]) => {
          if (done) return;
          done = true;
          clearTimeout(timeout);
          ipcMain.removeAllListeners(channel);
          controller.signal.removeEventListener("abort", onAbort);
          // 通知渲染层撤掉这张 followup 卡：无论答复来自 Discord、超时还是 abort，
          // 桌面卡片都该消失（否则会残留一张点了也无效的卡）。
          try {
            if (!win.isDestroyed()) {
              win.webContents.send("agent:followup-resolved", { sessionId, callId: fReq.callId });
            }
          } catch { /* 窗口不可用忽略 */ }
          // 撤回 relay 远程提问卡（其它通道已答/超时/abort）。
          if (relayPromptId && relayCoreRef) { try { relayCoreRef.cancelPrompt(relayPromptId); } catch { /* ignore */ } }
          resolve(answers);
        };
        const onAbort = () => finish(new Array(count).fill(""));
        const timeout = setTimeout(() => finish(new Array(count).fill("")), 10 * 60 * 1000);
        ipcMain.once(channel, (_e, answers: string[] | string) => {
          if (Array.isArray(answers)) finish(answers.map((a) => (typeof a === "string" ? a : "")));
          else finish([typeof answers === "string" ? answers : ""]);
        });
        controller.signal.addEventListener("abort", onAbort, { once: true });
        win.webContents.send("agent:followup-request", { ...fReq, sessionId });

        // Discord 通道：只处理第一个问题（Discord 交互一次一问），答到则采用。
        if (discordChannelId && discordBotRef) {
          const q = fReq.questions[0];
          if (q) {
            discordBotRef
              .askFollowup({ channelId: discordChannelId, question: q.question, options: q.options, plan: fReq.plan })
              .then((ans) => {
                if (ans && ans.trim()) {
                  const arr = new Array(count).fill("");
                  arr[0] = ans;
                  finish(arr);
                }
              })
              .catch(() => {});
          }
        }

        // 新统一 Relay 通道（Discord/Telegram）：经 RelayCore 把第一个问题转到对应平台
        // 频道，答到则采用。与桌面卡片双通道，任一先答即采用；finish 时撤回远程卡。
        if (relaySource && relayChannelId && relayCoreRef) {
          const q = fReq.questions[0];
          if (q) {
            const { promptId, answer } = relayCoreRef.askPrompt({
              source: relaySource, channelId: relayChannelId,
              question: q.question, options: q.options, plan: fReq.plan,
              // 计划/审批卡（带 plan）仅按钮，不接受自由文本；普通问题允许打字作答。
              allowText: !fReq.plan,
            });
            relayPromptId = promptId;
            answer.then((ans) => {
              if (ans && ans.trim()) {
                const arr = new Array(count).fill("");
                arr[0] = ans;
                finish(arr);
              }
            }).catch(() => {});
          }
        }
      });
    };

    // Build the tool context: resolve each enabled search backend's API key
    // (encrypted in SecretsManager, id "__websearch_<kind>__"). The renderer
    // sends only the enabled backend kinds in agentReq.search.kinds; keys never
    // leave the main process. web_search tries them in order, then falls back to
    // the keyless SearXNG/DDG.
    let toolCtx: any = undefined;
    try {
      const kinds: string[] = Array.isArray(agentReq.search && agentReq.search.kinds)
        ? agentReq.search.kinds
        : [];
      const backends: Array<{ kind: string; apiKey: string }> = [];
      for (const kind of kinds) {
        if (!kind || kind === "none") continue;
        const key = (await secretsManager.getSecret("__websearch_" + kind + "__")) || "";
        if (key) backends.push({ kind, apiKey: key });
      }
      if (backends.length) toolCtx = { search: { backends } };
    } catch {}

    // 图片生成（generate_image 工具）：渲染层传来被标记为「图片生成」的供应商配置
    // （baseUrl/model/endpoint/providerId/headers）；主进程按 providerId 解密其 key
    // 注入 toolCtx.imageGen（key 不离开主进程）。缺字段/无 key 则不注入，工具会回提示。
    // 另把所有已配置的图片供应商（含各自解密 key）一并注入，供模型按 `provider` 参数切换；
    // projectRoot 供工具解析 `save_dir` 相对路径。
    try {
      const ig = agentReq.imageGen;
      if (ig && ig.baseUrl && ig.model && ig.providerId) {
        const apiKey = (await secretsManager.getSecret(String(ig.providerId))) || "";
        if (apiKey) {
          // 解析所有候选图片供应商的 key（含默认那个），供 `provider` 参数切换。
          const poolIn: any[] = Array.isArray(ig.providers) ? ig.providers : [];
          const pool: Array<{ name: string; baseUrl: string; apiKey: string; model: string; models?: string[]; endpoint: "images" | "chat" | "raw"; headers?: Record<string, string> }> = [];
          for (const p of poolIn) {
            if (!p || !p.providerId || !p.baseUrl || !p.model) continue;
            const k = (await secretsManager.getSecret(String(p.providerId))) || "";
            if (!k) continue;
            pool.push({
              name: String(p.name || ""),
              baseUrl: String(p.baseUrl),
              apiKey: k,
              model: String(p.model),
              models: Array.isArray(p.models) ? p.models.map(String) : undefined,
              endpoint: p.endpoint === "chat" ? "chat" : p.endpoint === "raw" ? "raw" : "images",
              headers: p.headers && typeof p.headers === "object" ? p.headers : undefined,
            });
          }
          toolCtx = Object.assign({}, toolCtx, {
            imageGen: {
              baseUrl: String(ig.baseUrl),
              apiKey,
              model: String(ig.model),
              endpoint: ig.endpoint === "chat" ? "chat" : ig.endpoint === "raw" ? "raw" : "images",
              headers: ig.headers && typeof ig.headers === "object" ? ig.headers : undefined,
              // AI 主动调用工具默认存系统文档文件夹（除非渲染层显式给了 saveLocation）。
              saveDir: resolveImageSaveDir(ig.saveLocation || "documents", agentReq.workingDir, ig.customDir),
              projectRoot: agentReq.workingDir,
              providers: pool.length ? pool : undefined,
            },
          });
        }
      }
    } catch {}

    // 注入 MCP 工具：把已连接 MCP 服务器的工具合并进本轮 tools，并提供调用路由。
    try {
      const mcpTools = mcpManager.listOpenAITools();
      if (mcpTools.length) {
        toolCtx = Object.assign({}, toolCtx, {
          mcpTools,
          mcpHasTool: (name: string) => mcpManager.hasTool(name),
          mcpCall: (name: string, args: any, onImages?: (imgs: any[]) => void) => mcpManager.callTool(name, args, onImages),
        });
      }
    } catch {}

    // 注入子 agent(task 工具)上下文:可派发的 agent 定义 + 模型解析器 + runSubAgent
    // 闭包。子 agent 永远用父供应商(铁律②):resolveModel 把 .md 的 model 校验到父
    // 供应商 models[] 内,不在列表则回落父模型,绝不跨供应商。runSubAgent 透传权限/
    // 批准桥/signal + 当前(可能已注入 mcp/imageGen 的)toolCtx(其中 subagents 会在
    // runSubAgentLoop 内被剥掉,限一层防递归)。
    try {
      const usable = await agentsManager.usableAgents(agentReq.workingDir);
      if (usable.length > 0) {
        const parentModels: string[] = Array.isArray(agentReq.provider?.models) ? agentReq.provider.models.map(String) : [];
        const parentModel: string = String(agentReq.model || "");
        const resolveModel = (m?: string) => (m && parentModels.indexOf(m) !== -1 ? m : parentModel);
        const defs: SubAgentDef[] = usable.map((a) => ({
          name: a.name, mode: a.mode, tools: a.tools, model: a.model, prompt: a.prompt, builtin: a.builtin,
        }));
        const findDef = (name: string): SubAgentDef =>
          defs.find((d) => d.name === name)
          || defs.find((d) => d.name === "general-purpose")
          || defs[0];
        // 捕获本轮已构建好的 toolCtx(含 search/imageGen/mcp)给子 agent 复用。
        const parentToolCtx = toolCtx;
        const subCtxBase: Omit<SubAgentRunContext, "toolCtx"> = {
          provider: agentReq.provider,
          resolveModel,
          workingDir: agentReq.workingDir,
          sessionId,
          parentRunId: String(agentReq.runId || ""),
          permissions: permissionsManager,
          requestApproval,
          permissionMode: agentReq.permissionMode,
          signal: controller.signal,
          vision: !(agentReq.provider && agentReq.provider.vision === false),
        };
        toolCtx = Object.assign({}, toolCtx, {
          subagents: {
            defs: defs.map((d) => ({ name: d.name, mode: d.mode, tools: d.tools, model: d.model, prompt: d.prompt, builtin: d.builtin })),
            resolveModel,
            runSubAgent: async (spec: { subagentType: string; prompt: string; description?: string; parentCallId: string }) => {
              const def = findDef(spec.subagentType);
              const runOnce = () => runSubAgentLoop(
                def, spec.prompt, spec.description, spec.parentCallId,
                Object.assign({}, subCtxBase, { toolCtx: parentToolCtx }),
                win
              );
              const result = await runOnce();
              // 失败自动重试一次——仅对只读子 agent(重跑不会重复写文件,绝对安全);
              // 可写子 agent 不自动重跑(可能已部分落盘),失败原因原样回传父 agent 决定。
              // runSubAgentLoop 自身的 catch 会把抛错转成含 "[sub-agent error]" 的文本,
              // 故据此标记判定是否需要重试;用户中止则不重试。
              if (def.mode === "read-only"
                  && typeof result === "string"
                  && result.indexOf("[sub-agent error]") !== -1
                  && !controller.signal.aborted) {
                try { return await runOnce(); } catch { return result; }
              }
              return result;
            },
          },
        });
      }
    } catch {}

    try {
      const result = await runAgentLoop(agentReq, win, permissionsManager, requestApproval, controller.signal, requestFollowup, toolCtx);
      return { ok: true, result };
    } catch (e: any) {
      return { error: e?.message || String(e) };
    } finally {
      runningLoops.delete(sessionId);
      // 无论正常结束、报错还是被 abort，运行都已彻底停止：发权威「已停止」。
      // 这是发送/终止按钮恢复为「发送」的唯一可靠触发点。
      try { if (!win.isDestroyed()) win.webContents.send("agent:run-state", { sessionId, running: false }); } catch { /* window 可能已销毁 */ }
    }
  });

  ipcMain.handle("agent:stop", async (_event, sessionId: string) => {
    const controller = runningLoops.get(sessionId || "default");
    if (controller) { controller.abort(); return { ok: true }; }
    return { ok: false };
  });

  // 查询当前正在运行的会话 id 列表（runningLoops 真相源）。ChatView 重新挂载时
  // （如从其它标签页切回），据此恢复转圈/busy 状态——主进程 loop 不随渲染层卸载而停，
  // 但局部 busy/agentStatus 会丢，重挂时需主动拉回真相源对齐。
  ipcMain.handle("agent:running-sessions", async () => {
    return Array.from(runningLoops.keys());
  });

  // 直接出图：在对话里直接选中「图片生成」供应商发消息时走这里（不经 agent loop）。
  // 渲染层传 { providerId, baseUrl, model, endpoint, headers, prompts, size }；按
  // providerId 解密 key，调 generateImages，返回落地的本地图片路径列表。
  ipcMain.handle("image:generate", async (_event, reqArg: any) => {
    try {
      const r = reqArg || {};
      if (!r.providerId || !r.baseUrl || !r.model) return { ok: false, error: "missing provider config" };
      const apiKey = (await secretsManager.getSecret(String(r.providerId))) || "";
      if (!apiKey) return { ok: false, error: "no API key for this provider" };
      let prompts: string[] = [];
      if (Array.isArray(r.prompts)) prompts = r.prompts.filter((p: any) => typeof p === "string" && p.trim()).map(String);
      else if (typeof r.prompt === "string" && r.prompt.trim()) prompts = [r.prompt];
      if (prompts.length === 0) return { ok: false, error: "no prompt" };
      if (prompts.length > 8) prompts = prompts.slice(0, 8);
      const saveDir = resolveImageSaveDir(r.saveLocation, r.projectPath, r.customDir);
      const results = await generateImages(
        { baseUrl: String(r.baseUrl), apiKey, model: String(r.model), endpoint: r.endpoint === "chat" ? "chat" : r.endpoint === "raw" ? "raw" : "images", headers: r.headers && typeof r.headers === "object" ? r.headers : undefined },
        prompts,
        typeof r.size === "string" ? r.size : "",
        undefined,
        saveDir
      );
      // 没有任何一张成功 → 报失败，并把各 prompt 的真实错误带回去（不再静默成功）。
      const anyOk = results.some((x) => x.path);
      if (!anyOk) {
        const reason = results.map((x) => x.error).filter(Boolean).join("; ") || "未知错误";
        return { ok: false, error: reason, results };
      }
      return { ok: true, results };
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) };
    }
  });

  // /context 用：返回真实发往 AI 的「固定上下文」原始文本，供渲染层统一估算 token。
  // 系统提示与内置工具定义只有主进程持有原文（渲染层拿不到），故在此提供原文，
  // token 计数交给渲染层的 token-count（与其它面板同一套算法，不重复实现）。
  ipcMain.handle("agent:contextStats", async (_event, workingDir: string) => {
    const systemPrompt = buildSystemPrompt(workingDir || "");
    const toolsJson = JSON.stringify(TOOL_DEFINITIONS);
    // 记忆/CLAUDE.md 常驻块也属于「固定上下文」,计入 token 统计。
    let memoryBlock = "";
    try { memoryBlock = await memoryManager.systemPromptBlock(workingDir || undefined); } catch { memoryBlock = ""; }
    return {
      systemPrompt,
      toolsJson,
      toolCount: TOOL_DEFINITIONS.length,
      memoryBlock,
    };
  });

  // Stream / JSONL
  ipcMain.handle("stream:start", async (_event, projectPath: string) => {
    const win = getWindow();
    if (!win) return false;
    await jsonlWatcher.startWatching(projectPath, win);
    return true;
  });

  ipcMain.handle("stream:stop", async (_event, projectPath: string) => {
    jsonlWatcher.stopWatching(projectPath);
    return true;
  });

  // Provider management
  ipcMain.handle("provider:list", async () => {
    return providerManager.getProviders();
  });

  ipcMain.handle("provider:get", async (_event, id: string) => {
    return providerManager.getProvider(id);
  });

  ipcMain.handle("provider:add", async (_event, config: any) => {
    providerManager.addCustomProvider(config);
    return true;
  });

  ipcMain.handle("provider:remove", async (_event, id: string) => {
    providerManager.removeCustomProvider(id);
    return true;
  });

  // Chat API backend
  ipcMain.handle("chat:send", async (_event, chatReq: any) => {
    const win = getWindow();
    if (!win) throw new Error("No window");
    const https = require("https");
    const provider = chatReq.provider;
    let baseUrl = provider.baseUrl.replace(/\/+$/, "");
    if (baseUrl.indexOf("/v1") === -1) baseUrl += "/v1";
    const url = baseUrl + "/chat/completions";
    const urlObj = new URL(url);
    const body = JSON.stringify({ model: chatReq.model, messages: chatReq.messages, stream: true });
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + provider.apiKey,
    };
    if (provider.headers) {
      for (const k in provider.headers) headers[k] = provider.headers[k];
    }
    return new Promise((resolve, reject) => {
      const req = https.request({
        hostname: urlObj.hostname, port: urlObj.port || 443,
        path: urlObj.pathname + urlObj.search,
        method: "POST", headers,
      }, (res: any) => {
        if (res.statusCode !== 200) {
          let eb = "";
          res.on("data", (c: Buffer) => { eb += c.toString(); });
          res.on("end", () => {
            win.webContents.send("chat:error", { message: "HTTP " + res.statusCode + ": " + eb.slice(0, 300) });
            reject(new Error("HTTP " + res.statusCode));
          });
          return;
        }
        let fullText = "";
        let buf = "";
        const LF = String.fromCharCode(10);
        res.on("data", (chunk: Buffer) => {
          buf += chunk.toString();
          const lines = buf.split(LF);
          buf = lines.pop() || "";
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line || line.indexOf("data: ") !== 0) continue;
            const jsonStr = line.slice(6);
            if (jsonStr === "[DONE]") continue;
            try {
              const parsed = JSON.parse(jsonStr);
              const delta = parsed.choices?.[0]?.delta;
              if (delta && delta.content) {
                fullText += delta.content;
                win.webContents.send("chat:stream-token", { text: delta.content, fullText });
              }
            } catch(e) {}
          }
        });
        res.on("end", () => {
          resolve({ text: fullText });
        });
        res.on("error", (err: Error) => {
          win.webContents.send("chat:error", { message: "Stream: " + err.message });
          reject(err);
        });
      });
      req.on("error", (err: Error) => {
        win.webContents.send("chat:error", { message: "Request: " + err.message });
        reject(err);
      });
      req.write(body);
      req.end();
    });
  });

  // Secrets (encrypted API key storage)
  ipcMain.handle("secrets:set", async (_event, id: string, value: string) => {
    await secretsManager.setSecret(id, value);
    return true;
  });
  ipcMain.handle("secrets:get", async (_event, id: string) => {
    return secretsManager.getSecret(id);
  });
  ipcMain.handle("secrets:has", async (_event, id: string) => {
    return secretsManager.hasSecret(id);
  });
  ipcMain.handle("secrets:delete", async (_event, id: string) => {
    await secretsManager.deleteSecret(id);
    return true;
  });

  // Provider connection test — sends a minimal request to validate config.
  ipcMain.handle("provider:test", async (_event, cfg: { baseUrl: string; apiKey: string; model: string; headers?: Record<string, string>; protocol?: string }) => {
    return testProviderConnection(cfg);
  });

  // Provider balance — best-effort probe of common balance endpoints. Provider-
  // agnostic: tries several known paths and parses several known response shapes.
  // Returns { ok:false } silently if nothing resolves (UI just hides the badge).
  ipcMain.handle("provider:balance", async (_event, cfg: { baseUrl: string; apiKey: string; headers?: Record<string, string>; balanceScript?: string }) => {
    // 有自定义余额脚本时，走用户脚本；否则走通用探测。
    if (cfg.balanceScript) {
      return executeCustomBalanceScript(cfg);
    }
    return fetchProviderBalance(cfg);
  });

  // 余额历史：渲染层每次查到余额时记一条快照（带去抖）；Analytics 读历史画曲线。
  ipcMain.handle("balance:record", async (_event, snap: { providerId: string; remaining: number; unit: string; ts: number }) => {
    return balanceHistoryManager.record(snap);
  });
  ipcMain.handle("balance:history", async () => {
    return balanceHistoryManager.history();
  });

  // ---- Discord Bot 远程控制 ----
  // 追踪渲染层最后通知的项目路径，供 Discord Bot 使用。
  let currentProjectPath = "";
  ipcMain.handle("discord:setWorkingDir", async (_event, cwd: string) => {
    currentProjectPath = cwd || "";
    return true;
  });

  // 主→渲染往返桥：Bot 不自己跑 Agent，而是把 /ask、/session 经此交给渲染进程，
  // 渲染层用桌面已选 Provider 在「Discord 专用会话」里执行后回传结果（仿照 approval 桥）。
  let discordReqSeq = 0;
  const discordRoundTrip = <T>(channel: string, payload: any, timeoutMs: number): Promise<T> => {
    return new Promise((resolve) => {
      const win = getWindow();
      const reqId = "dc-" + Date.now() + "-" + (++discordReqSeq);
      const respChannel = channel + ":response:" + reqId;
      if (!win || win.isDestroyed()) {
        resolve({ ok: false, error: "UE Coworker 窗口未就绪" } as any);
        return;
      }
      const timer = setTimeout(() => {
        ipcMain.removeAllListeners(respChannel);
        resolve({ ok: false, error: "桌面端未在限定时间内响应" } as any);
      }, timeoutMs);
      ipcMain.once(respChannel, (_e, result: any) => {
        clearTimeout(timer);
        resolve((result || { ok: false, error: "空响应" }) as T);
      });
      win.webContents.send(channel, { reqId, ...payload });
    });
  };

  const discordBridge = {
    // /ask 一轮可能跑很久（多轮工具调用），给 15 分钟。channelId 透传给渲染层 →
    // agentReq.discordChannelId → requestFollowup 据此把提问/计划卡转回该频道。
    runTurn: (prompt: string, channelId: string) =>
      discordRoundTrip<{ ok: boolean; text?: string; error?: string }>(
        "discord:run-turn", { prompt, channelId }, 15 * 60 * 1000),
    sessionOp: (op: "new" | "list" | "switch", arg?: string) =>
      discordRoundTrip<{ ok: boolean; text?: string; error?: string }>(
        "discord:session-op", { op, arg }, 30 * 1000),
  };

  const discordBot = initDiscordBotManager(
    secretsManager,
    discordBridge,
    getWindow,
    () => currentProjectPath
  );
  // 供 requestFollowup 把 Discord 发起的一轮里的提问转回 Discord 频道。
  discordBotRef = discordBot;

  ipcMain.handle("discord:getConfig", async () => {
    return discordBot.loadConfig();
  });
  ipcMain.handle("discord:saveConfig", async (_event, cfg: any) => {
    await discordBot.saveConfig(cfg || {});
    return true;
  });
  ipcMain.handle("discord:connect", async () => {
    return discordBot.connect();
  });
  ipcMain.handle("discord:disconnect", async () => {
    await discordBot.disconnect();
    return true;
  });
  ipcMain.handle("discord:status", async () => {
    return discordBot.getStatus();
  });

  // 导出 discordBot 实例供 index.ts 清理使用。
  (registerIpcHandlers as any).__discordBot = discordBot;

  // ---- 统一 Relay 中枢（Discord + Telegram，网关跑在 utilityProcess）----
  // 业务桥：把网关上报的命令交给渲染层（agent/session 复用现有 relay 往返）或主进程
  // 工具（file/git/run/search/status）执行。runTurn/sessionOp 经渲染层往返时带上
  // relaySource + relayChannelId，使 requestFollowup 能把提问转回对应平台频道。
  const relayBridge = {
    runTurn: (prompt: string, ctx: { source: RelaySource; channelId: string; images?: string[] }) =>
      discordRoundTrip<{ ok: boolean; text?: string; error?: string; images?: string[] }>(
        "discord:run-turn", { prompt, channelId: ctx.channelId, relaySource: ctx.source, relayChannelId: ctx.channelId, images: ctx.images }, 15 * 60 * 1000),
    sessionOp: (op: "new" | "list" | "switch", ctx: { source: RelaySource; channelId: string }, arg?: string) =>
      discordRoundTrip<{ ok: boolean; text?: string; error?: string }>(
        "discord:session-op", { op, arg, relaySource: ctx.source, relayChannelId: ctx.channelId }, 30 * 1000),
    runTool: async (tool: string, args: Record<string, any>, _ctx: { source: RelaySource; channelId: string }) => {
      const askBusy = runningLoops.size > 0;
      return runRelayTool(tool, args, currentProjectPath, askBusy);
    },
    providerOp: (op: "list" | "switch", _ctx: { source: RelaySource; channelId: string }, arg?: string) =>
      discordRoundTrip<{ ok: boolean; text?: string; error?: string }>(
        "discord:provider-op", { op, arg }, 30 * 1000),
    modeOp: (mode: string | undefined, ctx: { source: RelaySource; channelId: string }) =>
      discordRoundTrip<{ ok: boolean; text?: string; error?: string }>(
        "discord:mode-op", { mode, relaySource: ctx.source }, 30 * 1000),
    projectOp: async (op: string, arg: string | undefined, _ctx: { source: RelaySource; channelId: string }) => {
      return handleRelayProjectOp(op, arg, sessionManager, getWindow, (p: string) => { currentProjectPath = p; });
    },
    uiOp: (op: string, ctx: { source: RelaySource; channelId: string }) =>
      discordRoundTrip<{ ok: boolean; text?: string; error?: string }>(
        "discord:ui-op", { op, relaySource: ctx.source }, 5 * 60 * 1000),
    statusLine: (ctx: { source: RelaySource; channelId: string }) =>
      discordRoundTrip<{ project?: string; model?: string; mode?: string }>(
        "discord:status-line", { relaySource: ctx.source }, 10 * 1000).catch(() => ({})),
  };

  const relayCore = initRelayCore(secretsManager, relayBridge, getWindow);
  relayCoreRef = relayCore;

  ipcMain.handle("relay:getConfig", async (_event, source: RelaySource) => relayCore.loadConfig(source));
  ipcMain.handle("relay:saveConfig", async (_event, source: RelaySource, cfg: any) => {
    await relayCore.saveConfig(source, cfg || {});
    return true;
  });
  ipcMain.handle("relay:connect", async (_event, source: RelaySource) => relayCore.connect(source));
  ipcMain.handle("relay:disconnect", async (_event, source: RelaySource) => {
    await relayCore.disconnect(source);
    return true;
  });
  ipcMain.handle("relay:status", async (_event, source: RelaySource) => relayCore.getStatus(source));

  // 微信扫码登录：拉起/取消登录状态机。二维码与状态经 relay:weixinQr 事件推给渲染层。
  ipcMain.handle("relay:weixinLogin", async () => {
    relayCore.startWeixinLogin();
    return true;
  });
  ipcMain.handle("relay:weixinCancelLogin", async () => {
    relayCore.cancelWeixinLogin();
    return true;
  });

  // 渲染层把某 relay 目标会话的只读事件（todos/error 等）推送到对应平台频道。
  ipcMain.handle("relay:push", async (_event, p: { source: RelaySource; channelId: string; kind: "progress" | "error"; text: string }) => {
    try { relayCore.pushEmit(p.source, p.channelId, p.kind, p.text); } catch { /* ignore */ }
    return true;
  });

  // 启动时按各平台 autoConnect 自动上线（失败不阻塞）。
  relayCore.autoConnectAll().catch(() => {});

  // 导出 relayCore 实例供 index.ts 退出清理。
  (registerIpcHandlers as any).__relayCore = relayCore;
}

// 远程审批卡的一行式摘要：工具 + 最关键参数（文件名/命令），让手机端看清要批准什么。
function approvalSummary(tool: string, permTool: string, input: any): string {  const s = (v: any) => (typeof v === "string" ? v : "");
  let detail = "";
  switch (tool) {
    case "write_file": case "edit_file": case "multi_edit": case "apply_diff":
      detail = s(input?.file_path); break;
    case "run_command": case "monitor":
      detail = s(input?.command); break;
    case "task":
      detail = s(input?.subagent_type); break;
    default:
      detail = s(input?.file_path) || s(input?.path) || s(input?.command) || "";
  }
  detail = detail.replace(/[\r\n]+/g, " ").trim();
  if (detail.length > 100) detail = detail.slice(0, 97) + "…";
  return (permTool || tool) + (detail ? " · " + detail : "");
}

// 远程项目操作：切换（最近）/ 新建（逐级选目录）。返回菜单或文本结果。
// open/create 完成后经 relay:openProject 事件让渲染层 requestProject 切项目，并更新主进程 cwd。
async function handleRelayProjectOp(
  op: string,
  arg: string | undefined,
  sm: SessionManager,
  getWindow: () => BrowserWindow | null,
  setCwd: (p: string) => void,
): Promise<{ ok: boolean; text?: string; error?: string; menu?: { title: string; items: { label: string; value: string }[] } }> {
  const PARENT = "⬆️ 上级目录";
  try {
    if (op === "list") {
      // 最近项目 + 新建。
      const recent = await sm.getRecentProjects();
      const items: { label: string; value: string }[] = recent.slice(0, 8).map((r) => ({
        label: "📂 " + r.name, value: "recent:" + r.path,
      }));
      items.push({ label: "➕ 新建项目", value: "new:" });
      return { ok: true, menu: { title: "📁 选择项目（最近）或新建：", items } };
    }

    if (op === "listDrives") {
      const items: { label: string; value: string }[] = [];
      if (process.platform === "win32") {
        for (let c = 67; c <= 90; c++) { // C..Z
          const root = String.fromCharCode(c) + ":\\";
          if (existsSync(root)) items.push({ label: "💽 " + String.fromCharCode(c) + ":", value: "drive:" + root });
        }
      } else {
        items.push({ label: "💽 /", value: "drive:/" });
      }
      // 也提供 home 目录入口。
      const home = app.getPath("home");
      items.push({ label: "🏠 主目录", value: "drive:" + home });
      return { ok: true, menu: { title: "💽 选择盘符/起点：", items } };
    }

    if (op === "listDir") {
      const dir = arg || app.getPath("home");
      let entries: string[] = [];
      try {
        const list = await readdir(dir, { withFileTypes: true });
        entries = list.filter((e) => e.isDirectory() && !e.name.startsWith(".")).map((e) => e.name).sort().slice(0, 80);
      } catch { /* 无权限等 */ }
      const items: { label: string; value: string }[] = [];
      // 上级目录
      const parent = dirname(dir.replace(/[\\/]+$/, ""));
      if (parent && parent !== dir) items.push({ label: PARENT, value: "drive:" + parent });
      // 在此目录新建 / 直接打开此目录
      items.push({ label: "✅ 在此新建项目", value: "here:" + dir });
      items.push({ label: "📂 直接打开此目录", value: "open:" + dir });
      for (const name of entries) {
        items.push({ label: "📁 " + name, value: "drive:" + join(dir, name) });
      }
      return { ok: true, menu: { title: "📂 " + dir, items } };
    }

    if (op === "open") {
      const path = arg || "";
      if (!path || !existsSync(path)) return { ok: false, error: "目录不存在：" + path };
      setCwd(path);
      const win = getWindow();
      if (win && !win.isDestroyed()) win.webContents.send("relay:openProject", { path });
      return { ok: true, text: "✅ 已切换项目：" + path };
    }

    if (op === "create") {
      // arg 形如 "<父目录>\n<新文件夹名>"。
      const [base, name] = (arg || "").split("\n");
      const folder = (name || "").trim();
      if (!base || !folder) return { ok: false, error: "缺少目录或名称。" };
      const full = join(base, folder);
      if (existsSync(full)) { setCwd(full); /* 已存在直接打开 */ }
      else await mkdir(full, { recursive: true });
      setCwd(full);
      const win = getWindow();
      if (win && !win.isDestroyed()) win.webContents.send("relay:openProject", { path: full });
      return { ok: true, text: "✅ 已新建并切换项目：" + full };
    }

    return { ok: false, error: "未知项目操作：" + op };
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  }
}

interface TestResult { ok: boolean; status?: number; message: string; }

function testProviderConnection(cfg: { baseUrl: string; apiKey: string; model: string; headers?: Record<string, string>; protocol?: string }): Promise<TestResult> {
  return new Promise((resolve) => {
    try {
      let baseUrl = (cfg.baseUrl || "").replace(/\/+$/, "");
      if (!baseUrl) return resolve({ ok: false, message: "Base URL is empty" });
      const isAnthropic = cfg.protocol === "anthropic";
      let urlObj: URL;
      let body: string;
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (isAnthropic) {
        const root = baseUrl.replace(/\/v1$/, "");
        urlObj = new URL(root + "/v1/messages");
        body = JSON.stringify({
          model: cfg.model,
          max_tokens: 1,
          messages: [{ role: "user", content: "ping" }],
        });
        headers["x-api-key"] = cfg.apiKey || "";
        headers["anthropic-version"] = "2023-06-01";
      } else {
        if (baseUrl.indexOf("/v1") === -1) baseUrl += "/v1";
        urlObj = new URL(baseUrl + "/chat/completions");
        body = JSON.stringify({
          model: cfg.model,
          messages: [{ role: "user", content: "ping" }],
          max_tokens: 1,
          stream: false,
        });
        headers["Authorization"] = "Bearer " + (cfg.apiKey || "");
      }
      const isHttps = urlObj.protocol === "https:";
      const transport = isHttps ? require("https") : require("http");
      if (cfg.headers) for (const k in cfg.headers) headers[k] = cfg.headers[k];

      const req = transport.request({
        hostname: urlObj.hostname,
        port: urlObj.port || (isHttps ? 443 : 80),
        path: urlObj.pathname + urlObj.search,
        method: "POST",
        headers,
        timeout: 15000,
      }, (res: any) => {
        let data = "";
        res.on("data", (c: Buffer) => { data += c.toString(); });
        res.on("end", () => {
          const status = res.statusCode || 0;
          if (status >= 200 && status < 300) {
            resolve({ ok: true, status, message: "Connection OK" });
          } else {
            resolve({ ok: false, status, message: "HTTP " + status + ": " + data.slice(0, 200) });
          }
        });
      });
      req.on("timeout", () => { req.destroy(); resolve({ ok: false, message: "Request timed out (15s)" }); });
      req.on("error", (err: Error) => resolve({ ok: false, message: err.message }));
      req.write(body);
      req.end();
    } catch (e: any) {
      resolve({ ok: false, message: e.message || "Invalid configuration" });
    }
  });
}

interface BalanceResult { ok: boolean; remaining?: number; unit?: string; isValid?: boolean; }

// A single GET to one candidate URL; resolves the raw JSON or null.
function getJson(rawUrl: string, apiKey: string, extraHeaders?: Record<string, string>): Promise<any | null> {
  return new Promise((resolve) => {
    try {
      const urlObj = new URL(rawUrl);
      const isHttps = urlObj.protocol === "https:";
      const transport = isHttps ? require("https") : require("http");
      const headers: Record<string, string> = {
        "Accept": "application/json",
        "Authorization": "Bearer " + (apiKey || ""),
      };
      if (extraHeaders) for (const k in extraHeaders) headers[k] = extraHeaders[k];
      const req = transport.request({
        hostname: urlObj.hostname,
        port: urlObj.port || (isHttps ? 443 : 80),
        path: urlObj.pathname + urlObj.search,
        method: "GET",
        headers,
        timeout: 12000,
      }, (res: any) => {
        let data = "";
        res.on("data", (c: Buffer) => { data += c.toString(); });
        res.on("end", () => {
          if ((res.statusCode || 0) < 200 || (res.statusCode || 0) >= 300) return resolve(null);
          try { resolve(JSON.parse(data)); } catch { resolve(null); }
        });
      });
      req.on("timeout", () => { req.destroy(); resolve(null); });
      req.on("error", () => resolve(null));
      req.end();
    } catch { resolve(null); }
  });
}

// Parse a balance value out of several known response shapes (generic relays,
// the user-provided /v1/usage template, DeepSeek's /user/balance, OpenAI-style
// billing). Returns null if no numeric balance can be extracted.
function extractBalance(r: any): BalanceResult | null {
  if (!r || typeof r !== "object") return null;
  let remaining: number | undefined;
  let unit: string | undefined;

  if (typeof r.remaining === "number") remaining = r.remaining;
  else if (r.quota && typeof r.quota.remaining === "number") remaining = r.quota.remaining;
  else if (typeof r.balance === "number") remaining = r.balance;
  else if (Array.isArray(r.balance_infos) && r.balance_infos[0]) {
    const n = Number(r.balance_infos[0].total_balance);
    if (!isNaN(n)) { remaining = n; unit = r.balance_infos[0].currency; }
  } else if (typeof r.hard_limit_usd === "number") {
    remaining = r.hard_limit_usd - (typeof r.total_usage === "number" ? r.total_usage / 100 : 0);
  } else if (typeof r.total_available === "number") {
    remaining = r.total_available;
  }

  if (typeof remaining !== "number" || isNaN(remaining)) return null;
  unit = unit || r.unit || (r.quota && r.quota.unit) || "USD";
  const isValid = r.is_active ?? r.isValid ?? r.is_available ?? true;
  return { ok: true, remaining, unit, isValid: !!isValid };
}

async function fetchProviderBalance(cfg: { baseUrl: string; apiKey: string; headers?: Record<string, string> }): Promise<BalanceResult> {
  let base = (cfg.baseUrl || "").replace(/\/+$/, "");
  if (!base || !cfg.apiKey) return { ok: false };
  // Strip a trailing /v1 so we can compose both /v1/* and root paths.
  const root = base.replace(/\/v1$/, "");
  const candidates = [
    root + "/v1/usage",
    root + "/user/balance",            // DeepSeek-style
    root + "/dashboard/billing/subscription", // OpenAI-style relays
    root + "/v1/dashboard/billing/subscription",
  ];
  for (const url of candidates) {
    const json = await getJson(url, cfg.apiKey, cfg.headers);
    if (json) {
      const parsed = extractBalance(json);
      if (parsed) return parsed;
    }
  }
  return { ok: false };
}

// 自定义余额脚本执行（vm 沙盒）。
// 脚本格式: ({ request: { url, method, headers }, extractor: fn(response) => { isValid, remaining, unit } })
// url 中 {{baseUrl}} 替换为 provider.baseUrl。
async function executeCustomBalanceScript(cfg: { baseUrl: string; apiKey: string; headers?: Record<string, string>; balanceScript?: string }): Promise<BalanceResult> {
  if (!cfg.balanceScript) return { ok: false };
  const vm = require("vm");
  try {
    // 在沙盒中执行脚本，获取 { request, extractor }
    const sandbox = { Number, Math, JSON, String, Array, Object, Date, parseInt, parseFloat, isNaN, isFinite };
    const ctx = vm.createContext(sandbox);
    const scriptObj = vm.runInContext(cfg.balanceScript, ctx, { timeout: 3000 });
    if (!scriptObj || !scriptObj.request || typeof scriptObj.extractor !== "function") {
      return { ok: false };
    }

    // 替换 {{baseUrl}} / {{apiKey}} 占位符（url、headers、body 均生效）
    const baseUrl = (cfg.baseUrl || "").replace(/\/+$/, "");
    const apiKey = cfg.apiKey || "";
    const subst = (s: string) => s.replace(/\{\{baseUrl\}\}/g, baseUrl).replace(/\{\{apiKey\}\}/g, apiKey);
    let url = subst(scriptObj.request.url || "");
    const method = (scriptObj.request.method || "GET").toUpperCase();
    const reqHeaders: Record<string, string> = {};
    for (const [k, v] of Object.entries(scriptObj.request.headers || {})) {
      reqHeaders[k] = typeof v === "string" ? subst(v) : (v as any);
    }

    // 发起 HTTP 请求
    const urlObj = new URL(url);
    const isHttps = urlObj.protocol === "https:";
    const transport = isHttps ? require("https") : require("http");
    const responseJson: any = await new Promise((resolve) => {
      const options: any = {
        hostname: urlObj.hostname,
        port: urlObj.port || (isHttps ? 443 : 80),
        path: urlObj.pathname + urlObj.search,
        method,
        headers: reqHeaders,
        timeout: 15000,
      };
      let body = "";
      if (scriptObj.request.body) {
        body = typeof scriptObj.request.body === "string" ? subst(scriptObj.request.body) : JSON.stringify(scriptObj.request.body);
        options.headers["Content-Length"] = Buffer.byteLength(body);
      }
      const req = transport.request(options, (res: any) => {
        let data = "";
        res.on("data", (c: Buffer) => { data += c.toString(); });
        res.on("end", () => {
          if ((res.statusCode || 0) < 200 || (res.statusCode || 0) >= 300) return resolve(null);
          try { resolve(JSON.parse(data)); } catch { resolve(null); }
        });
      });
      req.on("timeout", () => { req.destroy(); resolve(null); });
      req.on("error", () => resolve(null));
      if (body) req.write(body);
      req.end();
    });

    if (!responseJson) return { ok: false };

    // 用 extractor 解析响应
    const result = scriptObj.extractor(responseJson);
    if (!result || typeof result.remaining !== "number" || isNaN(result.remaining)) return { ok: false };
    return {
      ok: result.isValid !== false,
      remaining: result.remaining,
      unit: result.unit || "USD",
      isValid: result.isValid !== false,
    };
  } catch (e: any) {
    console.error("[balance-script]", e?.message || e);
    return { ok: false };
  }
}
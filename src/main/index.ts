import { app, BrowserWindow, ipcMain, dialog, shell, session, Tray, Menu, nativeImage, globalShortcut, screen } from "electron";
import { join } from "path";
import { electronApp, optimizer } from "@electron-toolkit/utils";
import { autoUpdater } from "electron-updater";
import { PtyManager } from "./pty-manager";
import { registerIpcHandlers } from "./ipc-handlers";
import { mcpManager } from "./mcp-manager";
import { transportLogEnabled, transportLogDir } from "./transport-logger";

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
// 区分「关闭按钮退后台」与「真正退出」：托盘菜单退出 / before-quit 时置 true。
let isQuitting = false;
const ptyManager = new PtyManager();

// ── 小窗模式（Mini Float）窗口形态 ──
// 进入小窗前记住大窗的 bounds 与最小尺寸，退出时还原。小窗：无边框小尺寸、置顶、
// 跨工作区可见、移到主屏右下角。当前是否处于小窗形态。
let savedBounds: Electron.Rectangle | null = null;
let isMiniMode = false;
const MINI_W = 420;
const MINI_H = 360;
const NORMAL_MIN_W = 900;
const NORMAL_MIN_H = 600;

function enterMiniMode(): void {
  const win = mainWindow;
  if (!win || isMiniMode) return;
  isMiniMode = true;
  savedBounds = win.getBounds();
  // 现有最小尺寸是 900×600，必须先放宽，否则 setSize 被夹住缩不下去。
  win.setMinimumSize(320, 200);
  win.setSize(MINI_W, MINI_H);
  // 移到主屏工作区右上角，留 24px 边距。
  try {
    const wa = screen.getPrimaryDisplay().workArea;
    const x = wa.x + wa.width - MINI_W - 24;
    const y = wa.y + 24;
    win.setPosition(Math.max(wa.x, x), Math.max(wa.y, y));
  } catch { /* 屏幕信息不可用时保持当前位置 */ }
  win.setAlwaysOnTop(true, "screen-saver");
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.show();
  win.focus();
  updateTrayMenu();
}

function exitMiniMode(): void {
  const win = mainWindow;
  if (!win || !isMiniMode) return;
  isMiniMode = false;
  win.setAlwaysOnTop(false);
  win.setVisibleOnAllWorkspaces(false);
  win.setMinimumSize(NORMAL_MIN_W, NORMAL_MIN_H);
  if (savedBounds) win.setBounds(savedBounds);
  else win.setSize(1400, 900);
  win.show();
  win.focus();
  updateTrayMenu();
}

// 全局快捷键「呼出小窗」：注册成功返回 true。回调只发事件给渲染层，由渲染层走
// 统一的 setMiniMode 流程（保证 store 与窗口形态同步），语义=仅呼出小窗。
function registerMiniShortcut(accelerator: string): boolean {
  try {
    globalShortcut.unregisterAll();
  } catch { /* ignore */ }
  if (!accelerator) return false;
  try {
    return globalShortcut.register(accelerator, () => {
      const win = mainWindow;
      if (!win) return;
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
      win.webContents.send("window:toggle-mini-request");
    });
  } catch {
    return false;
  }
}

// 应用图标的运行时绝对路径。dev：源码 resources/icon.png；打包：经 extraResources
// 复制到 process.resourcesPath/icon.png（asar 内的相对路径不可达，会导致托盘/窗口
// 图标空白）。窗口 icon 与托盘共用此函数。
function appIconPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, "icon.png")
    : join(__dirname, "../../resources/icon.png");
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
    frame: false,
    titleBarStyle: "hidden",
    // 任务栏/窗口图标。dev 用源码 resources/；打包后 resources/icon.png 经
    // extraResources 复制到 process.resourcesPath，asar 内的 ../../resources 不可达。
    icon: appIconPath(),
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      // 退后台(hide)后窗口对渲染进程的 Chromium 节流关掉:agent 循环在主进程不受
      // 影响,但渲染层的计时/流式 UI 更新不应被降到 1Hz,保证恢复窗口时状态完整。
      backgroundThrottling: false,
    },
  });

  mainWindow.on("ready-to-show", () => {
    mainWindow?.show();
  });

  // Keep the app shell from ever navigating away (e.g. user clicks a
  // localhost/login URL the agent produced). Internal app URLs are allowed;
  // everything else opens in the OS browser.
  const devUrl = process.env["ELECTRON_RENDERER_URL"];
  const isInternal = (url: string) =>
    (devUrl && url.startsWith(devUrl)) || url.startsWith("file://");
  mainWindow.webContents.on("will-navigate", (e, url) => {
    if (!isInternal(url)) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://") || url.startsWith("https://")) {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });

  // 点击关闭按钮时不真正退出：隐藏窗口退到后台（系统托盘），保留所有会话/进程。
  // 仅当 isQuitting 为 true（托盘「退出」或 app.quit）时才放行真正关闭。
  mainWindow.on("close", (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
    ptyManager.destroyAll();
  });

  if (process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

// 系统托盘：关闭按钮退后台后，用托盘图标恢复窗口 / 真正退出。
// 双击托盘 / 「还原窗口」：总是以大窗口打开（若在小窗形态先退出小窗）。
function showMainWindow(): void {
  if (!mainWindow) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  // 走渲染层统一路径退出小窗：发事件 → store 切大窗 → 回调 setMini→exitMiniMode，
  // 保证窗口形态与 UI（renderer 的 miniMode）同步；否则只改窗口尺寸而 UI 仍是小窗视图。
  if (isMiniMode) mainWindow.webContents.send("window:restore-request");
}

// 进入小窗显示（托盘菜单用）：确保窗口可见，再走渲染层统一路径切到小窗形态
// （renderer 的 toggle-mini-request 处理器会 setActiveView("chat")+setMiniMode(true)，
// 后者再回调 setMini→enterMiniMode，保证 store 与窗口形态同步）。
function showMiniWindow(): void {
  if (!mainWindow) { createWindow(); return; }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  mainWindow.webContents.send("window:toggle-mini-request");
}

// 据当前形态重建托盘菜单：小窗时显示「还原窗口」，大窗时显示「小窗口模式」（二选一，
// 避免三个窗口切换按钮让用户迷惑）。另含「重置位置」把拖到屏幕外的窗口拉回默认位置。
function updateTrayMenu(): void {
  if (!tray) return;
  const items: Electron.MenuItemConstructorOptions[] = isMiniMode
    ? [{ label: "还原窗口", click: () => showMainWindow() }]
    : [{ label: "小窗口模式", click: () => showMiniWindow() }];
  const contextMenu = Menu.buildFromTemplate([
    ...items,
    { label: "重置位置", click: () => resetWindowPosition() },
    { type: "separator" },
    {
      label: "退出",
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(contextMenu);
}

function createTray(): void {
  if (tray) return;
  const icon = nativeImage.createFromPath(appIconPath());
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip("UE Coworker");
  updateTrayMenu();
  // 单击托盘图标恢复窗口（Windows 习惯）；双击始终以大窗口打开。
  tray.on("click", () => showMainWindow());
  tray.on("double-click", () => showMainWindow());
}

// 重置窗口位置：把窗口拉回默认位置（小窗→右上角；大窗→屏幕居中），修复拖到屏幕外。
function resetWindowPosition(): void {
  const win = mainWindow;
  if (!win) return;
  try {
    const wa = screen.getPrimaryDisplay().workArea;
    if (isMiniMode) {
      const x = wa.x + wa.width - MINI_W - 24;
      const y = wa.y + 24;
      win.setBounds({ x: Math.max(wa.x, x), y: Math.max(wa.y, y), width: MINI_W, height: MINI_H });
    } else {
      const [w, h] = win.getSize();
      const x = wa.x + Math.round((wa.width - w) / 2);
      const y = wa.y + Math.round((wa.height - h) / 2);
      win.setPosition(Math.max(wa.x, x), Math.max(wa.y, y));
    }
    win.show();
    win.focus();
  } catch { /* 屏幕信息不可用时忽略 */ }
}

// 单实例锁：禁止多开。拿不到锁说明已有实例在跑——直接退出，并让已运行实例把窗口
// 拉到前台（second-instance）。放在 Squirrel 安装事件之后，避免安装期的临时进程误判。
// 否则多开的新实例各自空跑、且无配置上下文，用户会困惑。
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    showMainWindow();
  });
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId("com.uecoworker.app");

  // Startup banner: confirm whether transport logging is on and where it writes,
  // so it's obvious in the dev console whether CW_TRANSPORT_LOG took effect.
  if (transportLogEnabled()) {
    console.log("[transport-log] ENABLED -> " + transportLogDir());
  } else {
    console.log("[transport-log] disabled (set CW_TRANSPORT_LOG=1 to enable)");
  }

  // Content-Security-Policy 按 dev/prod 分治下发(取代 index.html 的静态 meta)。
  // dev 必须放行 'unsafe-eval'(Vite HMR 依赖 eval),故 Electron 安全警告会出现
  // ——这是 dev 专属、打包后不会有。prod 用严格 CSP(无 unsafe-eval),真正安全。
  const isDev = !!process.env["ELECTRON_RENDERER_URL"];
  const csp = isDev
    ? "default-src 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob:; connect-src 'self' http://localhost:* ws://localhost:* https: http:;"
    : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob:; connect-src 'self' https: http: ws://localhost:*;";
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [csp],
      },
    });
  });

  app.on("browser-window-created", (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  registerIpcHandlers(ptyManager, () => mainWindow);
  createWindow();
  createTray();

  // 小窗模式 IPC（窗口形态归 index.ts 管，它持有 mainWindow）。
  ipcMain.handle("window:setMini", (_e, v: boolean) => {
    if (v) enterMiniMode();
    else exitMiniMode();
  });
  ipcMain.handle("window:setMiniShortcut", (_e, accelerator: string) => {
    return registerMiniShortcut(accelerator);
  });
  // 小窗 JS 自定义拖动：app-region:drag 会吞掉 hover/click/dblclick，故气泡拖动改由
  // 渲染层 mousedown→mousemove 计算偏移，调用这两个 IPC 移动窗口。
  ipcMain.handle("window:getPosition", () => {
    const win = mainWindow;
    return win ? win.getPosition() : [0, 0];
  });
  // 拖动期间移动窗口，保持当前宽高不变（用当前 bounds 的 width/height，不硬编码——
  // 否则会把用户手动调整过的尺寸、以及收拢态的矮高度吸回默认）。
  ipcMain.handle("window:setPosition", (_e, x: number, y: number) => {
    const win = mainWindow;
    if (!win) return;
    if (isMiniMode) {
      const b = win.getBounds();
      win.setBounds({ x: Math.round(x), y: Math.round(y), width: b.width, height: b.height });
    } else {
      win.setPosition(Math.round(x), Math.round(y));
    }
  });
  ipcMain.handle("window:resetPosition", () => {
    resetWindowPosition();
  });
  // 小窗闲置收缩：把窗口高度缩到只剩输入框（保持左上角不动，输入框随之上移到顶部），
  // hover 恢复时再设回展开高度。仅小窗形态生效。注意：① 先放宽最小高度，否则被
  // enterMiniMode 设的最小尺寸(320×200)夹住缩不下去；② 宽度沿用当前值 b.width，
  // 不要硬编码 MINI_W——否则会把用户手动调整过的宽度吸回默认。
  ipcMain.handle("window:setMiniHeight", (_e, h: number) => {
    const win = mainWindow;
    if (!win || !isMiniMode) return;
    const target = Math.max(48, Math.round(h));
    win.setMinimumSize(320, Math.min(200, target));
    const b = win.getBounds();
    win.setBounds({ x: b.x, y: b.y, width: b.width, height: target });
  });
  // 恢复小窗到标准高度（保持左上角与宽度不动）。
  ipcMain.handle("window:resetMiniHeight", () => {
    const win = mainWindow;
    if (!win || !isMiniMode) return;
    win.setMinimumSize(320, 200);
    const b = win.getBounds();
    win.setBounds({ x: b.x, y: b.y, width: b.width, height: MINI_H });
  });
  // 启动注册默认快捷键（渲染层稍后会用持久化的值再次调用 setMiniShortcut 覆盖）。
  registerMiniShortcut("CommandOrControl+Q");

  // 启动时连接已配置且启用的 MCP 服务器（失败不阻塞应用，UI 可重连）。
  mcpManager.connectAll().catch(() => {});

  // 自动更新（仅打包后生效；dev 无 update 元数据会报错，故跳过）。electron-updater
  // 从 GitHub Releases 读 latest.yml → 后台静默下载差异 → 下次重启自动应用，无需重装。
  // 失败（无网络/无 Release）静默忽略，不打扰用户。
  if (app.isPackaged) {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true; // 用户退出/重启时应用已下载好的更新
    // 下载完成通知渲染层（可选提示「重启生效」）；不强制立即重启，尊重用户当前工作。
    autoUpdater.on("update-downloaded", (info) => {
      try {
        mainWindow?.webContents.send("update:downloaded", { version: info.version });
      } catch { /* 窗口不可用忽略 */ }
    });
    autoUpdater.on("error", () => { /* 静默：无网络/无 Release 不打扰 */ });
    autoUpdater.checkForUpdates().catch(() => {});
    // 每 6 小时轮询一次（长时间开着的会话也能拿到新版）。
    setInterval(() => { autoUpdater.checkForUpdates().catch(() => {}); }, 6 * 60 * 60 * 1000);
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  // 有托盘常驻：关闭按钮只隐藏窗口，应用继续在后台运行，不退出。
  // 仅当用户从托盘选择「退出」(isQuitting=true) 时才真正退出。
  if (isQuitting && process.platform !== "darwin") {
    app.quit();
  }
});

// 退出前清理 MCP 子进程/传输，避免泄漏 npx/node 子进程（fire-and-forget）。
// 同时断开 Discord Bot 的 WebSocket 连接。
app.on("before-quit", () => {
  // 标记真正退出，放行 mainWindow 的 close 事件（否则会被拦截改为隐藏）。
  isQuitting = true;
  // 注销全局快捷键，避免退出后仍占用系统热键。
  try { globalShortcut.unregisterAll(); } catch { /* ignore */ }
  mcpManager.disconnectAll().catch(() => {});
  // Discord Bot 清理（实例挂在 registerIpcHandlers 上）。
  const bot = (registerIpcHandlers as any).__discordBot;
  if (bot && typeof bot.disconnect === "function") {
    bot.disconnect().catch(() => {});
  }
  // Relay 网关 utilityProcess 清理。
  const relay = (registerIpcHandlers as any).__relayCore;
  if (relay && typeof relay.shutdown === "function") {
    relay.shutdown().catch(() => {});
  }
});

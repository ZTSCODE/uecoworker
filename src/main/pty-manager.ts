import { EventEmitter } from "events";
import { augmentPath } from "./node-runtime";

// node-pty is a native module that may not be compiled in the current
// environment (requires a C++ toolchain). Load it lazily so a missing/broken
// native binding degrades the terminal feature instead of crashing the whole
// main process. Everything else (AI chat, tool calls, file ops) is unaffected.
type IPty = any;
let ptyModule: { spawn: (...args: any[]) => IPty } | null = null;
let ptyLoadError: string | null = null;

function loadPty(): { spawn: (...args: any[]) => IPty } {
  if (ptyModule) return ptyModule;
  if (ptyLoadError) throw new Error(ptyLoadError);
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    ptyModule = require("node-pty");
    return ptyModule!;
  } catch (err: any) {
    ptyLoadError =
      "Terminal unavailable: node-pty native module is not built. " +
      "Install a C++ build toolchain and run `npx electron-rebuild -f -w node-pty`. " +
      `(原始错误: ${err?.message || String(err)})`;
    throw new Error(ptyLoadError);
  }
}

export function isPtyAvailable(): boolean {
  if (ptyModule) return true;
  if (ptyLoadError) return false;
  try {
    loadPty();
    return true;
  } catch {
    return false;
  }
}

export interface SessionInfo {
  id: string;
  pty: IPty;
  cwd: string;
  model: string;
  name: string;
  createdAt: number;
}

export class PtyManager extends EventEmitter {
  private sessions: Map<string, SessionInfo> = new Map();
  private sessionCounter = 0;

  createSession(
    cwd: string,
    model = "sonnet",
    name?: string,
    shell?: string
  ): SessionInfo {
    const { spawn } = loadPty();
    const id = `session-${++this.sessionCounter}`;
    const shellPath = shell || (process.platform === "win32" ? "powershell.exe" : process.env.SHELL || "/bin/bash");

    const pty = spawn(shellPath, [], {
      name: "xterm-256color",
      cols: 120,
      rows: 40,
      cwd,
      // 注入内置 node 的 PATH：用户在终端里敲 node/npm/npx，以及 npm 包形态的 CLI
      // provider（claude/codex/gemini）都能用打包的 node，无需自装 Node.js。
      env: augmentPath({
        ...(process.env as Record<string, string>),
        TERM: "xterm-256color",
        CLAUDE_CODE_MODEL: model,
      }),
    });

    const session: SessionInfo = {
      id,
      pty,
      cwd,
      model,
      name: name || `Session ${this.sessionCounter}`,
      createdAt: Date.now(),
    };

    pty.onData((data: string) => {
      this.emit(`data:${id}`, data);
    });

    pty.onExit(({ exitCode }: { exitCode: number }) => {
      this.emit(`exit:${id}`, exitCode);
      this.sessions.delete(id);
    });

    this.sessions.set(id, session);
    return session;
  }

  writeToSession(id: string, data: string): void {
    const session = this.sessions.get(id);
    if (session) {
      session.pty.write(data);
    }
  }

  resizeSession(id: string, cols: number, rows: number): void {
    const session = this.sessions.get(id);
    if (session) {
      session.pty.resize(cols, rows);
    }
  }

  killSession(id: string): void {
    const session = this.sessions.get(id);
    if (session) {
      session.pty.kill();
      this.sessions.delete(id);
    }
  }

  destroyAll(): void {
    for (const [id, session] of this.sessions) {
      session.pty.kill();
    }
    this.sessions.clear();
  }

  getSession(id: string): SessionInfo | undefined {
    return this.sessions.get(id);
  }

  getAllSessions(): SessionInfo[] {
    return Array.from(this.sessions.values());
  }
}

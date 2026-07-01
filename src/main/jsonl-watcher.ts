import { watch } from "fs";
import { readFile, stat, readdir } from "fs/promises";
import { join, basename } from "path";
import { homedir } from "os";
import { EventEmitter } from "events";
import { BrowserWindow } from "electron";

export interface ParsedEvent {
  id: string;
  type: "user" | "assistant" | "tool_use" | "tool_result" | "system";
  timestamp: string;
  data: any;
  sessionId: string;
}

/** Watches Claude Code JSONL session files in real time. */
export class JsonlWatcher extends EventEmitter {
  private watchers: Map<string, any> = new Map();
  private offsets: Map<string, number> = new Map();
  private polling: Map<string, NodeJS.Timeout> = new Map();

  private getProjectKey(projectPath: string): string {
    return projectPath.replace(/[\\\\\\/]/g, "-").replace(/^[A-Z]:/, "");
  }

  private getSessionsDir(projectPath: string): string {
    const key = this.getProjectKey(projectPath);
    return join(homedir(), ".claude", "projects", key);
  }

  private generateEventId(): string {
    return "evt-" + Date.now() + "-" + Math.random().toString(36).slice(2, 9);
  }

  async startWatching(projectPath: string, window: BrowserWindow): Promise<void> {
    const sessionsDir = this.getSessionsDir(projectPath);
    try { await stat(sessionsDir); } catch { return; }

    const watcher = watch(sessionsDir, (eventType, filename) => {
      if (!filename || !filename.endsWith(".jsonl")) return;
      const filePath = join(sessionsDir, filename);
      if (eventType === "rename") this.tailFile(filePath, window);
    });
    this.watchers.set(projectPath, watcher);

    try {
      const files = await readdir(sessionsDir);
      for (const file of files) {
        if (file.endsWith(".jsonl")) this.tailFile(join(sessionsDir, file), window);
      }
    } catch {}
  }

  private async tailFile(filePath: string, window: BrowserWindow): Promise<void> {
    const sessionId = basename(filePath, ".jsonl");
    const key = "tail:" + sessionId;
    if (this.polling.has(key)) return;

    let offset = this.offsets.get(filePath) || 0;
    try {
      const stats = await stat(filePath);
      if (stats.size < offset) offset = 0;
      this.offsets.set(filePath, offset);
    } catch { return; }

    const poll = async () => {
      try {
        const stats = await stat(filePath);
        const currentSize = stats.size;
        const currentOffset = this.offsets.get(filePath) || 0;
        if (currentSize <= currentOffset) return;

        const fd = await readFile(filePath);
        const newContent = fd.toString("utf-8", currentOffset);
        const lines = newContent.split(/\r?\n/).filter(function(l) { return l.trim().length > 0; });
        for (const line of lines) {
          try {
            const raw = JSON.parse(line);
            const event = this.parseEvent(raw, sessionId);
            if (event) {
              this.emit("event", event);
              window.webContents.send("stream:event", event);
            }
          } catch {}
        }
        this.offsets.set(filePath, currentSize);
      } catch {
        this.stopTailing(filePath);
      }
    };

    await poll();
    const timer = setInterval(poll, 500);
    this.polling.set(key, timer);
  }

  private parseEvent(raw: any, sessionId: string): ParsedEvent | null {
    const type = raw.type;
    if (type === "user") {
      const text = raw.message?.content?.filter(function(c: any) { return c.type === "text"; }).map(function(c: any) { return c.text; }).join("\n") || "";
      return { id: this.generateEventId(), type: "user", timestamp: raw.timestamp || new Date().toISOString(), data: { text: text, role: "user" }, sessionId };
    }
    if (type === "assistant") {
      const content = raw.message?.content || [];
      const textParts = content.filter(function(c: any) { return c.type === "text"; }).map(function(c: any) { return c.text; });
      const toolUses = content.filter(function(c: any) { return c.type === "tool_use"; }).map(function(c: any) { return { tool: c.name, input: c.input, toolId: c.id }; });
      if (textParts.length > 0) {
        return { id: this.generateEventId(), type: "assistant", timestamp: raw.timestamp || new Date().toISOString(), data: { text: textParts.join("\n"), cost: raw.usage ? "$" + ((raw.usage.input_tokens * 3 / 1e6 + raw.usage.output_tokens * 15 / 1e6).toFixed(4)) : null, tokens: raw.usage ? raw.usage.input_tokens + raw.usage.output_tokens : null }, sessionId };
      }
      if (toolUses.length > 0) {
        const last = toolUses[toolUses.length - 1];
        return { id: this.generateEventId(), type: "tool_use", timestamp: raw.timestamp || new Date().toISOString(), data: last, sessionId };
      }
      return null;
    }
    if (type === "queue-operation" || type === "mode" || type === "permission-mode") {
      return { id: this.generateEventId(), type: "system", timestamp: raw.timestamp || new Date().toISOString(), data: { type: raw.type }, sessionId };
    }
    return null;
  }

  stopTailing(filePath: string): void {
    const sessionId = basename(filePath, ".jsonl");
    const key = "tail:" + sessionId;
    const timer = this.polling.get(key);
    if (timer) { clearInterval(timer); this.polling.delete(key); }
  }

  stopWatching(projectPath: string): void {
    const watcher = this.watchers.get(projectPath);
    if (watcher) { watcher.close(); this.watchers.delete(projectPath); }
    for (const [, timer] of this.polling) clearInterval(timer);
    this.polling.clear();
    this.offsets.clear();
  }
}

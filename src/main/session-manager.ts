import { readFile, writeFile, mkdir, readdir, stat } from "fs/promises";
import { join, basename } from "path";
import { app } from "electron";
import { existsSync } from "fs";
import { homedir } from "os";

interface RecentProject {
  path: string;
  name: string;
  lastOpened: number;
}

interface SessionData {
  recentProjects: RecentProject[];
}

interface AnalyticsSummary {
  totalSessions: number;
  totalTokens: number;
  totalCost: number;
  sessionsByModel: Record<string, number>;
}

export class SessionManager {
  private dataPath: string;
  private data: SessionData = { recentProjects: [] };

  constructor() {
    this.dataPath = join(app.getPath("userData"), "ue-coworker-sessions.json");
  }

  private async load(): Promise<void> {
    try {
      if (existsSync(this.dataPath)) {
        const raw = await readFile(this.dataPath, "utf-8");
        this.data = JSON.parse(raw);
      }
    } catch {
      this.data = { recentProjects: [] };
    }
  }

  private async save(): Promise<void> {
    const dir = join(this.dataPath, "..");
    if (!existsSync(dir)) await mkdir(dir, { recursive: true });
    await writeFile(this.dataPath, JSON.stringify(this.data, null, 2));
  }

  async getRecentProjects(): Promise<RecentProject[]> {
    await this.load();
    return this.data.recentProjects
      .filter(function(p) { return existsSync(p.path); })
      .sort(function(a, b) { return b.lastOpened - a.lastOpened; })
      .slice(0, 10);
  }

  async addRecentProject(projectPath: string): Promise<void> {
    await this.load();
    const existing = this.data.recentProjects.find(function(p) { return p.path === projectPath; });
    if (existing) {
      existing.lastOpened = Date.now();
    } else {
      this.data.recentProjects.push({
        path: projectPath, name: basename(projectPath), lastOpened: Date.now()
      });
    }
    await this.save();
  }

  async listSessions(projectPath?: string): Promise<any[]> {
    const sessions: any[] = [];
    const claudeDir = join(homedir(), ".claude", "projects");
    try {
      const entries = await readdir(claudeDir);
      for (const entry of entries) {
        if (entry.endsWith(".jsonl") && entry !== "history.jsonl") {
          const filePath = join(claudeDir, entry);
          try {
            const stats = await stat(filePath);
            const content = await readFile(filePath, "utf-8");
            const lines = content.split(/\r?\n/).filter(function(l) { return l.trim().length > 0; });
            const firstLine = lines[0] ? JSON.parse(lines[0]) : null;
            let tokenCount = 0;
            let costEstimate = 0;
            for (const line of lines) {
              try {
                const evt = JSON.parse(line);
                if (evt.type === "assistant" && evt.message?.usage) {
                  tokenCount += evt.message.usage.input_tokens + evt.message.usage.output_tokens;
                  costEstimate += evt.message.usage.input_tokens * 3 / 1e6 + evt.message.usage.output_tokens * 15 / 1e6;
                }
              } catch {}
            }
            sessions.push({
              id: basename(entry, ".jsonl"),
              project: firstLine?.project || firstLine?.cwd || "unknown",
              started: firstLine?.timestamp || stats.birthtime.toISOString(),
              ended: new Date().toISOString(),
              eventCount: lines.length,
              tokenCount, costEstimate: Math.round(costEstimate * 100) / 100,
              size: stats.size,
            });
          } catch {}
        }
      }
    } catch {}
    return sessions.sort(function(a, b) { return new Date(b.started).getTime() - new Date(a.started).getTime(); });
  }

  async getProjectStats(projectPath: string): Promise<AnalyticsSummary> {
    const sessions = await this.listSessions();
    const projectSessions = sessions.filter(function(s) { return s.project.includes(basename(projectPath)); });
    const models: Record<string, number> = {};
    let totalTokens = 0;
    let totalCost = 0;
    for (const s of projectSessions) {
      totalTokens += s.tokenCount;
      totalCost += s.costEstimate;
    }
    return { totalSessions: projectSessions.length, totalTokens, totalCost: Math.round(totalCost * 100) / 100, sessionsByModel: models };
  }
}

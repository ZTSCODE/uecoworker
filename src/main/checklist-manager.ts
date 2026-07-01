// 持久任务清单管理器：项目作用域、跨会话保留、用户与 AI 共同维护，落在
// <项目>/.claude/checklist.json。刻意命名 "checklist" 与对话内临时路线图
// update_todos / TodoItem 词法分开,降低模型混淆(那套跟 session 走、每轮整列表
// 替换、对话结束即弃;本套是长期的项目待办)。
//
// 状态机(对齐用户「AI 不得自标通过」的工作流):
//   todo (待办) ──AI 做完──► needs_verification (待验证) ──用户点完成──► done
//   todo ──用户点完成──► done
// AI 工具只能把条目推到 needs_verification,永远不能直接置 done;done 仅用户在
// UI 点击。done 项记 completedAt,加载时过滤掉超过 1 天的(自动消失)。
//
// 注入策略(缓存友好,见 CLAUDE.md):清单内容每轮在变,绝不进系统提示稳定前缀。
// 前缀只放一句永不变的静态协议(在 agent-loop 系统提示里),内容靠 checklist_read
// 工具按需取(Tier 1 召回式)。

import { join } from "path";
import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";

export type ChecklistStatus = "todo" | "needs_verification" | "done";

export interface ChecklistItem {
  id: string;
  content: string;
  status: ChecklistStatus;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;        // done 的时间戳;用于 1 天后自动清理
}

// done 项保留时长:完成 1 天后从清单消失。
const DONE_TTL_MS = 1 * 24 * 60 * 60 * 1000;

function genId(): string {
  return "ck_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/** 归一化文本用于模糊匹配:去空白、小写。 */
function norm(s: string): string {
  return (s || "").toLowerCase().replace(/\s+/g, " ").trim();
}

export class ChecklistManager {
  private filePath(projectPath: string): string {
    return join(projectPath, ".claude", "checklist.json");
  }

  /** 读原始条目(不过滤、不清理)。文件不存在或损坏返回空数组。 */
  private async readRaw(projectPath: string): Promise<ChecklistItem[]> {
    const path = this.filePath(projectPath);
    if (!existsSync(path)) return [];
    try {
      const parsed = JSON.parse(await readFile(path, "utf-8"));
      const items = Array.isArray(parsed?.items) ? parsed.items : [];
      return items.filter((it: any) => it && typeof it.content === "string");
    } catch {
      return [];
    }
  }

  private async writeRaw(projectPath: string, items: ChecklistItem[]): Promise<void> {
    const dir = join(projectPath, ".claude");
    if (!existsSync(dir)) await mkdir(dir, { recursive: true });
    await writeFile(this.filePath(projectPath), JSON.stringify({ items }, null, 2), "utf-8");
  }

  /** 列出有效条目:剔除完成超过 1 天的 done 项(顺带把过期项落盘清除)。
   *  顺序即数组顺序(用户/AI 添加顺序),不重排。 */
  async list(projectPath?: string): Promise<ChecklistItem[]> {
    if (!projectPath) return [];
    const raw = await this.readRaw(projectPath);
    const now = Date.now();
    const kept = raw.filter((it) =>
      !(it.status === "done" && it.completedAt && now - it.completedAt > DONE_TTL_MS)
    );
    if (kept.length !== raw.length) {
      try { await this.writeRaw(projectPath, kept); } catch { /* 清理失败不致命 */ }
    }
    return kept;
  }

  /** 用户/AI 新增一条。AI 新增时 status 固定 needs_verification;用户新增为 todo。 */
  async add(projectPath: string, content: string, status: ChecklistStatus = "todo"): Promise<ChecklistItem> {
    const items = await this.list(projectPath);
    const now = Date.now();
    const item: ChecklistItem = {
      id: genId(),
      content: content.trim(),
      status: status === "done" ? "todo" : status,   // add 不直接产生 done
      createdAt: now,
      updatedAt: now,
    };
    items.push(item);
    await this.writeRaw(projectPath, items);
    return item;
  }

  /** 按 id 改状态(供 UI:用户点完成→done、撤销等)。done 自动盖 completedAt。 */
  async setStatus(projectPath: string, id: string, status: ChecklistStatus): Promise<{ ok: boolean; item?: ChecklistItem }> {
    const items = await this.list(projectPath);
    const it = items.find((x) => x.id === id);
    if (!it) return { ok: false };
    it.status = status;
    it.updatedAt = Date.now();
    if (status === "done") it.completedAt = Date.now();
    else delete it.completedAt;
    await this.writeRaw(projectPath, items);
    return { ok: true, item: it };
  }

  /** 按 id 删除(供 UI)。 */
  async remove(projectPath: string, id: string): Promise<{ ok: boolean }> {
    const items = await this.list(projectPath);
    const next = items.filter((x) => x.id !== id);
    if (next.length === items.length) return { ok: false };
    await this.writeRaw(projectPath, next);
    return { ok: true };
  }

  /** 编辑条目文本(供 UI)。 */
  async edit(projectPath: string, id: string, content: string): Promise<{ ok: boolean; item?: ChecklistItem }> {
    const items = await this.list(projectPath);
    const it = items.find((x) => x.id === id);
    if (!it) return { ok: false };
    it.content = content.trim();
    it.updatedAt = Date.now();
    await this.writeRaw(projectPath, items);
    return { ok: true, item: it };
  }

  /** AI「做完一件事」:在未完成条目里按文本模糊匹配。命中则改 needs_verification,
   *  未命中则新增为 needs_verification。返回动作描述(给模型的工具结果用)。
   *  不依赖 id —— 用户随时可能加新条目,AI 无从得知 id,只能靠语义匹配。 */
  async submit(projectPath: string, content: string): Promise<{ action: "matched" | "added"; item: ChecklistItem }> {
    const items = await this.list(projectPath);
    const target = norm(content);
    // 只在「未完成」条目里找(done 的不复活)。匹配:互为子串即算同一件事。
    const hit = items.find((it) => {
      if (it.status === "done") return false;
      const n = norm(it.content);
      return n === target || n.indexOf(target) >= 0 || target.indexOf(n) >= 0;
    });
    const now = Date.now();
    if (hit) {
      hit.status = "needs_verification";
      hit.updatedAt = now;
      delete hit.completedAt;
      await this.writeRaw(projectPath, items);
      return { action: "matched", item: hit };
    }
    const item: ChecklistItem = {
      id: genId(),
      content: content.trim(),
      status: "needs_verification",
      createdAt: now,
      updatedAt: now,
    };
    items.push(item);
    await this.writeRaw(projectPath, items);
    return { action: "added", item };
  }
}

export const checklistManager = new ChecklistManager();

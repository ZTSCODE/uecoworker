import { create } from "zustand";
import type { ChecklistItem, ChecklistStatus } from "../../../preload/index.d";

/**
 * 持久任务清单 store(项目作用域)。数据落在 .claude/checklist.json,经
 * window.api.checklist* 由主进程持久化(渲染层不直接碰文件)。与对话内临时
 * 路线图(chat-store 的 todos / update_todos)完全独立。
 *
 * AI 经 checklist_submit 改动时,主进程推 agent:checklist 事件 → 这里记录
 * lastChanged(高亮+自动弹开下拉),并 reload。用户在 UI 的增删改状态走
 * window.api.checklist* 后由 checklist:changed 广播触发 reload。
 */
interface ChecklistState {
  items: ChecklistItem[];
  projectPath?: string;
  /** 最近一次 AI 改动的条目 id + 时机戳(UI 据此高亮并自动弹开下拉)。 */
  lastChanged?: { id: string; ts: number };
  load: (projectPath?: string) => Promise<void>;
  add: (content: string) => Promise<void>;
  setStatus: (id: string, status: ChecklistStatus) => Promise<void>;
  edit: (id: string, content: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  /** 由 agent:checklist 事件调用:记录高亮目标并刷新列表。 */
  noteAgentChange: (item: ChecklistItem) => Promise<void>;
}

export const useChecklistStore = create<ChecklistState>((set, get) => ({
  items: [],
  projectPath: undefined,
  lastChanged: undefined,

  load: async (projectPath) => {
    var pp = projectPath !== undefined ? projectPath : get().projectPath;
    try {
      var items = (await window.api.checklistList?.(pp)) || [];
      set({ items: items, projectPath: pp });
    } catch {
      set({ projectPath: pp });
    }
  },

  add: async (content) => {
    var pp = get().projectPath;
    if (!pp || !content.trim()) return;
    try { await window.api.checklistAdd?.(pp, content.trim()); await get().load(pp); } catch {}
  },

  setStatus: async (id, status) => {
    var pp = get().projectPath;
    if (!pp) return;
    try { await window.api.checklistSetStatus?.(pp, id, status); await get().load(pp); } catch {}
  },

  edit: async (id, content) => {
    var pp = get().projectPath;
    if (!pp || !content.trim()) return;
    try { await window.api.checklistEdit?.(pp, id, content.trim()); await get().load(pp); } catch {}
  },

  remove: async (id) => {
    var pp = get().projectPath;
    if (!pp) return;
    try { await window.api.checklistRemove?.(pp, id); await get().load(pp); } catch {}
  },

  noteAgentChange: async (item) => {
    set({ lastChanged: { id: item.id, ts: Date.now() } });
    await get().load(get().projectPath);
  },
}));

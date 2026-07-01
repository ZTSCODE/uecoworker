import { create } from "zustand";
import type { MemoryEntry, MemoryType, MemorySaveInput } from "../../../preload/index.d";

/**
 * 长期记忆 store(项目作用域)。数据落在 .claude/memory/,经 window.api.memory*
 * 由主进程持久化(渲染层不直接碰文件)。沿用 provider-store 的扁平 Zustand 形态。
 *
 * 记忆系统三层:Tier 0 常驻索引(主进程注入系统提示)、Tier 1 recall_memory 召回、
 * Tier 2 read_file 读全文。此 store 只服务设置面板的人工查看/编辑/删除。
 */
interface MemoryState {
  entries: MemoryEntry[];
  loading: boolean;
  projectPath?: string;
  /** 拉取某项目(+全局)的全部记忆。 */
  load: (projectPath?: string) => Promise<void>;
  /** 新建或更新一条记忆,成功后刷新列表。 */
  save: (input: MemorySaveInput) => Promise<MemoryEntry | null>;
  /** 删除一条记忆。 */
  remove: (id: string) => Promise<boolean>;
}

export const useMemoryStore = create<MemoryState>((set, get) => ({
  entries: [],
  loading: false,
  projectPath: undefined,

  load: async (projectPath) => {
    set({ loading: true, projectPath });
    try {
      const entries = (await window.api.memoryList?.(projectPath)) || [];
      set({ entries, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  save: async (input) => {
    const projectPath = get().projectPath;
    try {
      const entry = await window.api.memorySave?.(projectPath, input);
      await get().load(projectPath);
      return entry || null;
    } catch {
      return null;
    }
  },

  remove: async (id) => {
    const projectPath = get().projectPath;
    try {
      const res = await window.api.memoryDelete?.(projectPath, id);
      if (res && res.ok) await get().load(projectPath);
      return !!(res && res.ok);
    } catch {
      return false;
    }
  },
}));

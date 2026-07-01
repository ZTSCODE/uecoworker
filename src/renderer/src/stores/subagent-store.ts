import { create } from "zustand";

// 子 agent(task 工具)运行时活动状态:由 agent:subagent 生命周期事件驱动,供
// ChatView 在父 task 工具气泡内内联展示「子 agent 活动卡」(名称 + 模型 + 实时
// 状态 + token 流 + 可折叠的子 agent 工具调用流)。关会话即销毁(clearSession)。
//
// 一个父 task 调用(parentCallId)对应一个子 agent 运行(subId)。同一轮里多个并行
// task → 多张卡,按 parentCallId 各自独立。这是纯渲染镜像,不参与发往 LLM 的拼接。

export interface SubAgentToolCall {
  callId: string;
  name: string;
  input: any;
  output?: string;
  approved?: boolean;
}

export interface SubAgentRun {
  subId: string;
  sessionId: string;
  parentCallId: string;       // 父 agent 的 task 工具调用 id(用于把卡挂到对应气泡)
  agentName: string;
  model: string;
  mode: "read-only" | "write";
  builtin?: boolean;
  description?: string;
  phase: "spawned" | "streaming-text" | "tool-call" | "tool-result" | "done";
  text: string;               // 累积的流式文本(实时进度)
  toolCalls: SubAgentToolCall[];
  report?: string;            // done 时的最终报告
  files?: string[];           // done 时写入的文件清单
  startedAt: number;
  doneAt?: number;
}

interface SubAgentState {
  // parentCallId -> 运行(一个 task 调用一个子 agent)
  runs: Record<string, SubAgentRun>;
  ingest: (data: any) => void;
  clearSession: (sessionId: string) => void;
}

export const useSubAgentStore = create<SubAgentState>((set) => ({
  runs: {},

  // 消费一条 agent:subagent 事件,按 parentCallId 累积更新对应卡片状态。
  ingest: (data: any) => {
    if (!data || !data.parentCallId) return;
    const key = String(data.parentCallId);
    set((state) => {
      const prev = state.runs[key];
      const base: SubAgentRun = prev || {
        subId: String(data.subId || key),
        sessionId: String(data.sessionId || ""),
        parentCallId: key,
        agentName: String(data.agentName || "sub-agent"),
        model: String(data.model || ""),
        mode: data.mode === "read-only" ? "read-only" : "write",
        builtin: !!data.builtin,
        description: data.description || "",
        phase: "spawned",
        text: "",
        toolCalls: [],
        startedAt: Date.now(),
      };
      const next: SubAgentRun = { ...base };
      // 元信息每次刷新(spawned 之后的事件也带这些字段)。
      if (data.agentName) next.agentName = String(data.agentName);
      if (data.model) next.model = String(data.model);
      if (data.mode) next.mode = data.mode === "read-only" ? "read-only" : "write";
      if (data.description) next.description = String(data.description);

      switch (data.phase) {
        case "streaming-text":
          next.phase = "streaming-text";
          if (typeof data.delta === "string") next.text = base.text + data.delta;
          break;
        case "tool-call": {
          next.phase = "tool-call";
          const tc: SubAgentToolCall = { callId: String(data.callId || ""), name: String(data.name || ""), input: data.input };
          next.toolCalls = base.toolCalls.concat([tc]);
          break;
        }
        case "tool-result": {
          next.phase = "tool-result";
          next.toolCalls = base.toolCalls.map((t) =>
            t.callId === String(data.callId)
              ? { ...t, output: typeof data.output === "string" ? data.output : t.output, approved: data.approved }
              : t);
          break;
        }
        case "done":
          next.phase = "done";
          next.report = typeof data.report === "string" ? data.report : next.text;
          next.files = Array.isArray(data.files) ? data.files.map(String) : [];
          next.doneAt = Date.now();
          break;
        case "spawned":
        default:
          next.phase = base.phase === "done" ? "done" : (data.phase || "spawned");
          break;
      }
      return { runs: { ...state.runs, [key]: next } };
    });
  },

  clearSession: (sessionId: string) => {
    set((state) => {
      const runs: Record<string, SubAgentRun> = {};
      for (const k in state.runs) {
        if (state.runs[k].sessionId !== sessionId) runs[k] = state.runs[k];
      }
      return { runs };
    });
  },
}));

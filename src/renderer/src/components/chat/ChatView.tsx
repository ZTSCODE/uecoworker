import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo, memo } from "react";
import { createPortal } from "react-dom";
import { useAppStore } from "../../stores/app-store";
import { useChatStore, type ChatMessage, type TodoItem } from "../../stores/chat-store";
import { useProviderStore, type Provider } from "../../stores/provider-store";
import { cn } from "../../lib/utils";
import { ArtifactPanel } from "./ArtifactPanel";
import { useArtifactStore, detectLang, openFileInPreview } from "../../stores/artifact-store";
import { useSubAgentStore } from "../../stores/subagent-store";
import { useChecklistStore } from "../../stores/checklist-store";
import type { ChecklistItem, ChecklistStatus } from "../../../../preload/index.d";
import {
  Send, Wrench, Plus, Trash2, Copy, Check, Crosshair,
  Loader2, Sparkles, MessageSquare, Paperclip, Image,
  FileCode, Terminal, Globe, Search, FileEdit, FolderOpen,
  ChevronDown, ChevronRight, ChevronLeft, AlertTriangle, ExternalLink, Clock, Square, HelpCircle,
  Pencil, CornerDownLeft, Shield, ListChecks, History, Circle, CircleCheck, Command, X, Gamepad2, Undo2, Webhook, Monitor, Bot, Maximize2, Brain
} from "lucide-react";
import { Markdown, CodeBlock, DiffBlock } from "./Markdown";
import { RefreshCw, Scissors, ClipboardPaste, TextSelect, Image as ImageIcon, Save, AlertCircle } from "lucide-react";
import { ProviderIcon, displayModelName } from "../../lib/provider-icon";
import { useSearchStore } from "../../stores/search-store";
import { useContextMenu, type ContextMenuItem } from "../ui/ContextMenu";
import { SlashPalette, EFFORT_OPTIONS } from "./SlashPalette";
import { fileIconUrl } from "../../lib/file-icons";
import { estimateTokens, estimateTokensMany, fmtTokens } from "../../lib/token-count";
import { systemNotify } from "../../lib/notify";
import { pickReadyPhrase, randomThinkingPhrase, buildFailureNotice, prettyModelName, randomFailurePhrase } from "../../lib/flavor-text";
import {
  filterSlash, parseSlash, findSlash, SLASH_COMMANDS,
  type SlashCommand, type SlashContext,
} from "../../lib/slash-commands";
import { useT, tr } from "../../lib/i18n";

// textarea 原生剪贴板动作（Electron 渲染层经典做法：execCommand 走系统剪贴板）。
function textareaAction(el: HTMLTextAreaElement | null, action: "cut" | "copy" | "selectAll") {
  if (!el) return;
  el.focus();
  if (action === "selectAll") { el.select(); return; }
  try { document.execCommand(action); } catch (e) {}
}
async function textareaPaste(el: HTMLTextAreaElement | null, setInput: (v: string) => void) {
  if (!el) return;
  el.focus();
  try {
    if (document.execCommand("paste")) return; // 多数环境直接生效
  } catch (e) {}
  // 回退：读剪贴板文本并插入到光标处。
  try {
    var text = await navigator.clipboard.readText();
    var start = el.selectionStart || 0;
    var end = el.selectionEnd || 0;
    var next = el.value.slice(0, start) + text + el.value.slice(end);
    setInput(next);
  } catch (e) {}
}

// 子序列匹配：q 的字符按序出现在 s 中（模糊文件搜索用）。
function subseq(s: string, q: string): boolean {
  var i = 0;
  for (var j = 0; j < s.length && i < q.length; j++) if (s[j] === q[i]) i++;
  return i === q.length;
}

// 上下文用量阈值（基于「最近一次 LLM 往返的输入占用」contextTokens）。集中一处，
// 日后要改成「按当前模型窗口的百分比」或做成设置项，只改这里即可。
//   - SOFT：达到后在 AI 消息底部灰色小字提醒「接近自动压缩」，纯提示不打扰。
//   - AUTO：本回合结束后自动触发 /compact，避免下一轮溢出。
var CONTEXT_SOFT_THRESHOLD = 600000;
var CONTEXT_AUTO_THRESHOLD = 850000;
// 小窗标准高度（须与主进程 index.ts 的 MINI_H 一致）——收拢动画的展开目标高度。
var MINI_H_RENDER = 360;

// 判断小窗里某个鼠标事件是否落在「空白处」（非内容）——拖动/双击/右键据此判定。
// 规则：落点是 data-mini-dragzone 容器自身=纯空白；否则用 elementFromPoint 取落点元素，
// 若命中交互/媒体/代码元素（button/a/input/textarea/img/svg/pre/code/table）或该元素含
// 非空直接文字（=点在文字上），则视为内容（不拖、不切换），其余皆为空白。
function isMiniBlankTarget(e: { target: EventTarget | null; clientX: number; clientY: number }): boolean {
  var tgt = e.target as HTMLElement | null;
  if (tgt && tgt.hasAttribute && tgt.hasAttribute("data-mini-dragzone")) return true;
  var hit = (typeof document !== "undefined" && document.elementFromPoint
    ? document.elementFromPoint(e.clientX, e.clientY) : tgt) as HTMLElement | null;
  var node: HTMLElement | null = hit || tgt;
  if (!node) return true;
  if (node.closest("button") || node.closest("a") || node.closest("input") ||
      node.closest("textarea") || node.closest("img") || node.closest("svg") ||
      node.closest("pre") || node.closest("code") || node.closest("table")) return false;
  for (var ci = 0; ci < node.childNodes.length; ci++) {
    var cn = node.childNodes[ci];
    if (cn.nodeType === 3 && (cn.textContent || "").trim().length > 0) return false; // 点在文字上
  }
  return true;
}

// 跨轮工具历史回放（让模型记得自己做过的工具操作，避免重复读取与失忆）。机制对齐
// Claude Code，但**不做动态年龄淘汰**：Claude 靠 Anthropic 专有的服务端 cache_edits
// 删旧结果而本地消息一字不改，本项目经中转站 + 多协议无此能力，若在本地把旧结果改成
// 占位会随轮次移动缓存断点、击穿 prompt 前缀。故本地历史完整回放，总量交给已有的
// /compact 自动压缩兜底。仅保留「单条大输出截断」——它字节级稳定，不随轮次变化。
//   - TOOL_RESULT_TRUNCATE：单条非 read_file 工具结果的字符截断阈值（read_file 靠
//     自身分页控制大小，豁免）。约 5 万 token（按 ~3.5 字符/token 估）。
//   - EMPTY_TOOL_RESULT：空结果占位，给模型明确锚点（防被当对话边界提前停）。
var TOOL_RESULT_TRUNCATE = 180000; // chars (~50k tokens)
var EMPTY_TOOL_RESULT = function (name: string) { return "(" + name + " completed with no output)"; };

// JSON.stringify 容错（工具参数对象转 OpenAI tool_calls 需要的字符串形式）。
function safeStringify(o: any): string { try { return JSON.stringify(o || {}); } catch { return "{}"; } }

// 规范化单条工具结果文本：剥离机器标记、空结果占位、大输出截断（read_file 豁免）。
function normalizeToolOutput(tc: any): string {
  var text = typeof tc.output === "string" ? tc.output : "";
  // 剥离 generate_image/capture_window 的机器标记行（GENERATED_IMAGE_PATHS:[...]）。
  text = text.replace(/\n?GENERATED_IMAGE_PATHS:\[[\s\S]*\]\s*$/, "").trimEnd();
  if (!text) {
    // task(子 agent 派发)空结果 = 上一轮被中断/未收尾,子 agent 结果丢失。给模型
    // 明确信号:该委派已结束(不是仍在进行),需要时自行重新派发,绝不要原地等待——
    // 否则跨轮回放时模型会以为子 agent「还在工作」而干等。
    if (tc.name === "task") return "(the previous sub-agent delegation did not return a result — it was interrupted or ended without a summary. The sub-agent is NOT still running. If its output is needed, dispatch a new task; otherwise proceed.)";
    return EMPTY_TOOL_RESULT(tc.name || "tool");
  }
  // 大输出截断：非 read_file 单条超阈值时保留首尾、省略中段（read_file 靠自身分页）。
  if (tc.name !== "read_file" && text.length > TOOL_RESULT_TRUNCATE) {
    var headLen = Math.floor(TOOL_RESULT_TRUNCATE * 0.6);
    var tailLen = Math.floor(TOOL_RESULT_TRUNCATE * 0.2);
    var head = text.slice(0, headLen);
    var tail = text.slice(text.length - tailLen);
    text = head + "\n\n...[" + (text.length - headLen - tailLen) + " chars truncated]...\n\n" + tail;
  }
  return text;
}

// 跨轮工具历史回放：把 store 里平铺的 assistant/tool 消息重建成带 tool_calls 配对的
// API 历史。机制对齐 Claude Code 但不做动态淘汰（见下方常量注释的缓存原因）：阶段 A
// 重建 assistant↔tool 配对 + 单条大输出截断，阶段 C 配对安全校验。返回发往后端的
// 消息数组（不含摘要前缀）。
function buildReplayMessages(msgsForApi: any[]): any[] {
  // ---- 阶段 A：重建结构（assistant.tool_calls + tool 结果按 id 配对） ----
  var out: any[] = [];
  var i = 0;
  while (i < msgsForApi.length) {
    var mm = msgsForApi[i];
    if (!mm || mm.divider || mm.errorNotice) { i++; continue; }
    if (mm.role === "user") {
      out.push({ role: "user", content: mm.content, images: mm.images });
      i++; continue;
    }
    if (mm.role === "assistant") {
      // 收集紧随其后的同组 tool 消息（平铺兄弟），重建 tool_calls（仅取有 id 的，
      // 缺 id 的旧会话工具调用无法配对，连同其结果一并跳过，降级为纯文本回放）。
      var tools: any[] = [];
      var j = i + 1;
      while (j < msgsForApi.length && msgsForApi[j] && msgsForApi[j].role === "tool") {
        if (msgsForApi[j].toolCall && msgsForApi[j].toolCall.id) tools.push(msgsForApi[j]);
        j++;
      }
      var amsg: any = { role: "assistant", content: mm.content || "" };
      if (tools.length) {
        amsg.tool_calls = tools.map(function (t) {
          return { id: t.toolCall.id, type: "function", function: { name: t.toolCall.name || "", arguments: safeStringify(t.toolCall.input) } };
        });
      }
      // 思考原始数据跨轮回传(回传必需:Anthropic thinking 块缺 signature 配 tool_use 会 400;
      // DeepSeek 推理系工具轮缺 reasoning_content 会 400)。从落库的 assistant 消息原样带回,
      // main 侧序列化(toAnthropicRequest / cleanMessages)据此回灌。无则不加,保持纯净。
      if (mm.thinking && mm.thinking.length) amsg.thinking = mm.thinking;
      if (mm.reasoning_content != null) amsg.reasoning_content = mm.reasoning_content;
      out.push(amsg);
      for (var k = 0; k < tools.length; k++) {
        var tc = tools[k].toolCall;
        // 工具图片(截图/生图/读图等落地的本地路径)随结果一并回放:缺了会让「首次发送
        // 带图、跨轮重建无图」结构发散,从该消息起击穿缓存。main 侧 buildApiMessage 读盘
        // 转图并走与首次相同的 downscale,保证字节一致、稳定命中。无图则不加该字段。
        var toolMsg: any = { role: "tool", tool_call_id: tc.id, content: normalizeToolOutput(tc) };
        if (tc.images && tc.images.length) toolMsg.images = tc.images;
        out.push(toolMsg);
      }
      i = j; continue;
    }
    // 孤儿 tool 组（无前置 assistant 文本气泡）：模型该轮只吐了 tool_calls、没有文字，
    // TurnEmitter 仅在有文字 delta 时才建 assistant 气泡，故落库后只剩平铺的 tool 消息。
    // 此前这里直接 i++ 跳过，导致整组工具历史（如先 glob/list 再 read）丢失、跨轮失忆，
    // 且与上一轮前缀错位击穿缓存。改为：合成一个 content 为空的 assistant 承载这批
    // tool_calls，再补齐结果，使协议配对合法、历史完整可见。
    if (mm.role === "tool") {
      var orphan: any[] = [];
      var oj = i;
      while (oj < msgsForApi.length && msgsForApi[oj] && msgsForApi[oj].role === "tool") {
        if (msgsForApi[oj].toolCall && msgsForApi[oj].toolCall.id) orphan.push(msgsForApi[oj]);
        oj++;
      }
      if (orphan.length) {
        out.push({
          role: "assistant",
          content: "",
          tool_calls: orphan.map(function (t) {
            return { id: t.toolCall.id, type: "function", function: { name: t.toolCall.name || "", arguments: safeStringify(t.toolCall.input) } };
          }),
        });
        for (var ok = 0; ok < orphan.length; ok++) {
          var otc = orphan[ok].toolCall;
          // 同主分支:孤儿工具组的图片也随结果回放,避免带图回合跨轮重建丢图击穿缓存。
          var otoolMsg: any = { role: "tool", tool_call_id: otc.id, content: normalizeToolOutput(otc) };
          if (otc.images && otc.images.length) otoolMsg.images = otc.images;
          out.push(otoolMsg);
        }
      }
      i = oj; continue;
    }
    // 其它（无 id 的旧会话落单 tool 等）：跳过，避免无配对的 tool 结果。
    i++;
  }
  // ---- 阶段 B（已移除）：动态年龄淘汰会随轮次改变历史中部消息文本（原文→占位），
  // 击穿 prompt 缓存前缀、按全价重算整段历史。Claude Code 能淘汰又不破缓存，靠的是
  // Anthropic 专有的服务端 cache_edits（删服务端缓存、本地消息一字不改），本项目经
  // 中转站 + 多协议无此能力，无法照搬。故不做会变动的淘汰：本地历史完整回放，总量
  // 控制交给已有的 /compact 自动压缩（85 万 token 触发，整段重写一次属预期低频）。
  // 仍生效的是 normalizeToolOutput 里的「单条大输出截断」——它对同一条结果每次产出
  // 字节级一致的文本，不随轮次变化，缓存友好。

  // ---- 阶段 C：配对安全校验（防任何结构漏洞导致协议 400） ----
  // 规则：每个 assistant.tool_calls.id 必须有紧随的 tool 结果；每个 tool 结果必须有
  // 前置 assistant.tool_calls 里对应的 id。不满足的成对移除。
  var safe: any[] = [];
  for (var s = 0; s < out.length; s++) {
    var cur = out[s];
    if (cur.role === "assistant" && Array.isArray(cur.tool_calls) && cur.tool_calls.length) {
      // 收集其后连续的 tool 结果，按 id 建索引。
      var following: any[] = [];
      var t = s + 1;
      while (t < out.length && out[t].role === "tool") { following.push(out[t]); t++; }
      var haveIds: Record<string, boolean> = {};
      for (var f = 0; f < following.length; f++) haveIds[following[f].tool_call_id] = true;
      // 只保留「结果存在」的 tool_calls；若全部缺失则降级为纯 assistant 文本。
      var keptCalls = cur.tool_calls.filter(function (c: any) { return haveIds[c.id]; });
      var keptIds: Record<string, boolean> = {};
      for (var kc = 0; kc < keptCalls.length; kc++) keptIds[keptCalls[kc].id] = true;
      // 重建保留 thinking/reasoning_content(关键:配对校验阶段重构 assistant 对象时若不带,
      // 阶段 A 刚带回的思考原始数据会在此被丢弃 → 回传缺失 → 400)。
      if (keptCalls.length) {
        var keptMsg: any = { role: "assistant", content: cur.content || "", tool_calls: keptCalls };
        if (cur.thinking && cur.thinking.length) keptMsg.thinking = cur.thinking;
        if (cur.reasoning_content != null) keptMsg.reasoning_content = cur.reasoning_content;
        safe.push(keptMsg);
      }
      else if (cur.content && String(cur.content).trim()) {
        var textMsg: any = { role: "assistant", content: cur.content };
        if (cur.thinking && cur.thinking.length) textMsg.thinking = cur.thinking;
        if (cur.reasoning_content != null) textMsg.reasoning_content = cur.reasoning_content;
        safe.push(textMsg);
      }
      // 仅追加有对应保留 tool_call 的结果。
      for (var ff = 0; ff < following.length; ff++) {
        if (keptIds[following[ff].tool_call_id]) safe.push(following[ff]);
      }
      s = t - 1; // 跳过已处理的 tool 结果
    } else if (cur.role === "tool") {
      // 无前置 tool_calls 的落单结果：丢弃（理论上阶段 A 已避免，双保险）。
      continue;
    } else if (cur.role === "assistant" && !(cur.content && String(cur.content).trim())) {
      // 空文本、无 tool_calls 的 assistant 占位（如直接出图路径留下的 "正在生成图片…"
      // 被清空后的空壳）：纯噪音，丢弃。既不携带信息又占一条消息，去掉更干净，也不影响
      // 缓存（它本就不该进稳定前缀）。
      continue;
    } else {
      safe.push(cur);
    }
  }
  return safe;
}

var toolIcons: Record<string, any> = {
  Read: FileCode, Write: FileEdit, Edit: FileEdit,
  Bash: Terminal, WebSearch: Search, WebFetch: Globe,
  TodoWrite: FileCode, AskUserQuestion: HelpCircle,
  // Backend (snake_case) tool ids:
  read_file: FileCode, write_file: FileEdit, edit_file: FileEdit,
  multi_edit: FileEdit, apply_diff: FileEdit, MultiEdit: FileEdit,
  run_command: Terminal, monitor: Terminal, search_files: Search, glob_files: Search,
  list_files: FolderOpen, web_search: Search, web_fetch: Globe,
  ask_followup_question: HelpCircle, update_todos: ListChecks,
  generate_image: Image,
  capture_window: Monitor,
  configure_hooks: Webhook, Hooks: Webhook,
  task: Bot, Task: Bot,
};

function getToolIcon(name: string) {
  return toolIcons[name] || Wrench;
}

// Ask the model for a short session title from the first user message.
// Best-effort & silent: falls back to the truncated title already set.
async function generateSessionTitle(sessionId: string, firstMessage: string, provider: any, model: string) {
  try {
    var res = await (window as any).api?.chatSend?.({
      provider: provider,
      model: model,
      messages: [
        { role: "system", content: "你是一个会话标题生成器。根据用户的第一条消息，生成一个不超过12个字、概括主题的简短中文标题。只输出标题本身，不要引号、标点或解释。" },
        { role: "user", content: firstMessage.slice(0, 500) },
      ],
    });
    var title = (res && res.text ? String(res.text) : "").trim().replace(/^["'「『]|["'」』]$/g, "").slice(0, 20);
    if (title) useChatStore.getState().renameSession(sessionId, title);
  } catch (e) {}
}

function getToolColor(name: string) {
  var colors: Record<string, string> = {
    Read: "text-blue-400", Write: "text-yellow-400", Edit: "text-yellow-400",
    Bash: "text-green-400", WebSearch: "text-purple-400", WebFetch: "text-indigo-400",
    TodoWrite: "text-orange-400", AskUserQuestion: "text-red-400",
    // Backend (snake_case) tool ids — same color family as their PascalCase peers.
    read_file: "text-blue-400", list_files: "text-blue-400", glob_files: "text-sky-400",
    write_file: "text-yellow-400", edit_file: "text-amber-400",
    multi_edit: "text-amber-400", apply_diff: "text-amber-400", MultiEdit: "text-amber-400",
    run_command: "text-green-400", monitor: "text-green-400", search_files: "text-cyan-400",
    web_search: "text-purple-400", web_fetch: "text-indigo-400",
    ask_followup_question: "text-red-400", update_todos: "text-orange-400",
    generate_image: "text-pink-400",
    capture_window: "text-teal-400",
    configure_hooks: "text-teal-400", Hooks: "text-teal-400",
    task: "text-violet-400", Task: "text-violet-400",
  };
  return colors[name] || "text-muted-foreground";
}

// 会话「最近活动」时间：取最后一条消息的时间戳，没有消息则退回创建时间。
// 用于历史列表按最近聊过的排序。
function sessionLastActivity(session: any): number {
  var msgs = (session && Array.isArray(session.messages)) ? session.messages : [];
  for (var i = msgs.length - 1; i >= 0; i--) {
    if (typeof msgs[i].timestamp === "number") return msgs[i].timestamp;
  }
  return session && typeof session.createdAt === "number" ? session.createdAt : 0;
}

// 一个会话的总 token：优先用每条消息记录的真实 usage，缺失的用内容估算补上。
function sessionTokenTotal(session: any): number {
  var msgs = (session && Array.isArray(session.messages)) ? session.messages : [];
  var total = 0;
  for (var i = 0; i < msgs.length; i++) {
    var m = msgs[i];
    if (typeof m.tokens === "number" && m.tokens > 0) total += m.tokens;
    else if (m.content) total += estimateTokens(String(m.content));
  }
  return total;
}

// 会话最后一条消息的时间：10 分钟内显示「刚刚 / xx分钟前」，否则简化为 HH:MM（如 21:20）。
// 无消息/无时间戳则返回 ""。
function sessionLastTime(session: any): string {
  var msgs = (session && Array.isArray(session.messages)) ? session.messages : [];
  for (var i = msgs.length - 1; i >= 0; i--) {
    var ts = msgs[i] && msgs[i].timestamp;
    if (typeof ts === "number" && ts > 0) {
      var diffMin = Math.floor((Date.now() - ts) / 60000);
      if (diffMin < 1) return tr("刚刚", "just now");
      if (diffMin < 10) return tr(diffMin + "分钟前", diffMin + "m ago");
      var d = new Date(ts);
      var hh = String(d.getHours()).padStart(2, "0");
      var mm = String(d.getMinutes()).padStart(2, "0");
      return hh + ":" + mm;
    }
  }
  return "";
}

// 相对时间（任务清单「最近更新」用）：<1m 刚刚；<60m xx分钟前；<24h xx小时前；
// 否则 月/日 HH:MM。
function relTime(ts?: number): string {
  if (typeof ts !== "number" || ts <= 0) return "";
  var diff = Date.now() - ts;
  var min = Math.floor(diff / 60000);
  if (min < 1) return tr("刚刚", "just now");
  if (min < 60) return tr(min + "分钟前", min + "m ago");
  var hr = Math.floor(min / 60);
  if (hr < 24) return tr(hr + "小时前", hr + "h ago");
  var d = new Date(ts);
  var mo = d.getMonth() + 1, day = d.getDate();
  var hh = String(d.getHours()).padStart(2, "0");
  var mm = String(d.getMinutes()).padStart(2, "0");
  return mo + "/" + day + " " + hh + ":" + mm;
}

// 工具气泡统一浅灰底（无边框）。仅图标 / diff 加减号 / 数字带颜色。
var TOOL_TINT = "bg-muted/60";

// 把一对 old/new 字符串合成统一 diff 的行（旧行前缀 -，新行前缀 +）。
// 供 edit_file / multi_edit 在没有现成 diff 时构造，再交给 DiffBlock 上色。
function editToDiffLines(oldStr: any, newStr: any): string {
  var out: string[] = [];
  var o = String(oldStr ?? "");
  var n = String(newStr ?? "");
  if (o.length) out = out.concat(o.split("\n").map(function(l) { return "-" + l; }));
  if (n.length) out = out.concat(n.split("\n").map(function(l) { return "+" + l; }));
  return out.join("\n");
}

// 上次成功的图片供应商 id（持久化，供 AI 主动调用工具时作默认）。
var LAST_IMG_PROVIDER_KEY = "ue-coworker-last-image-provider";
function getLastImageProviderId(): string { try { return localStorage.getItem(LAST_IMG_PROVIDER_KEY) || ""; } catch { return ""; } }
function setLastImageProviderId(id: string): void { try { localStorage.setItem(LAST_IMG_PROVIDER_KEY, id); } catch {} }

// 列出所有可用的「图片生成」供应商（勾选 imageGen + 有 key + 有 baseUrl/model）。
function listImageProviders(): any[] {
  var provs = useProviderStore.getState().providers;
  return provs.filter(function(p: any) { return p.imageGen && p.hasKey && p.baseUrl && (p.models[0] || ""); });
}

// 从供应商列表里挑出「图片生成」供应商，构建发给后端的 imageGen 配置（含 providerId，
// 主进程据此解密 key）。优先级：指定 id > 上次成功 > 当前选中 > 第一个。
// providers 字段带上所有已配置的图片供应商（含 models），供 AI 用 `provider`/`model`
// 参数切换；主进程按各自 providerId 解密 key。没有则返回 undefined（工具会回提示）。
function buildImageGenConfig(selectedId?: string): {
  providerId: string; baseUrl: string; model: string; endpoint: "images" | "chat" | "raw"; headers?: Record<string, string>;
  providers?: Array<{ providerId: string; name: string; baseUrl: string; model: string; models: string[]; endpoint: "images" | "chat" | "raw"; headers?: Record<string, string> }>;
} | undefined {
  var imgs = listImageProviders();
  if (imgs.length === 0) return undefined;
  var lastId = getLastImageProviderId();
  var p = imgs.find(function(x: any) { return x.id === selectedId; })
    || imgs.find(function(x: any) { return x.id === lastId; })
    || imgs[0];
  var pool = imgs.map(function(x: any) {
    return {
      providerId: x.id,
      name: x.name,
      baseUrl: x.baseUrl,
      model: x.models[0] || "",
      models: Array.isArray(x.models) ? x.models : [],
      endpoint: (x.imageEndpoint === "chat" ? "chat" : x.imageEndpoint === "raw" ? "raw" : "images") as "images" | "chat" | "raw",
      headers: x.headers && Object.keys(x.headers).length ? x.headers : undefined,
    };
  });
  return {
    providerId: p.id,
    baseUrl: p.baseUrl,
    model: p.models[0] || "",
    endpoint: p.imageEndpoint === "chat" ? "chat" : p.imageEndpoint === "raw" ? "raw" : "images",
    headers: p.headers && Object.keys(p.headers).length ? p.headers : undefined,
    providers: pool,
  };
}

// 从 generate_image 的工具输出里解析出落地图片路径。工具结果末行形如
// GENERATED_IMAGE_PATHS:["...","..."]。比依赖异步事件更可靠（输出本身在快照里）。
function parseGeneratedImagePaths(output?: string): string[] {
  if (!output) return [];
  var m = /GENERATED_IMAGE_PATHS:(\[[\s\S]*\])\s*$/.exec(output);
  if (!m) return [];
  try {
    var arr = JSON.parse(m[1]);
    return Array.isArray(arr) ? arr.filter(function(x) { return typeof x === "string"; }) : [];
  } catch { return []; }
}

// 统计一条工具消息「内部折叠的图片」张数。覆盖：
//   - generate_image / capture_window：落地图片路径（事件写入的 toolCall.images 或从输出解析）；
//   - Playwright / 其它 MCP 工具：截图以 base64 块返回，flattenContent 把它拍平成
//     形如「[image image/png, 12345 bytes base64]」的标记，按标记数计数；
//   - 其它工具若带了 toolCall.images 也一并计入。
function countToolImages(message: any): number {
  var tc = message && message.toolCall;
  if (!tc) return 0;
  if (tc.name === "generate_image" || tc.name === "capture_window" || tc.name === "read_file") {
    var imgs = (tc.images && tc.images.length) ? tc.images : parseGeneratedImagePaths(tc.output);
    return imgs ? imgs.length : 0;
  }
  if (tc.output) {
    var m = String(tc.output).match(/\[image\b[^\]]*\bbytes base64\]/g);
    if (m && m.length) return m.length;
  }
  return (tc.images && tc.images.length) ? tc.images.length : 0;
}

// 把一组连续的工具消息浓缩成收拢态摘要：按首次出现顺序列出工具名（重复的标 ×次数），
// 并累计内部折叠的图片总张数。
function summarizeToolGroup(msgs: any[]): { names: string[]; imageCount: number } {
  var order: string[] = [];
  var counts: Record<string, number> = {};
  var imageCount = 0;
  for (var i = 0; i < msgs.length; i++) {
    var tc = msgs[i] && msgs[i].toolCall;
    if (!tc) continue;
    var name = tc.name === "__thinking__" ? tr("思考过程", "Thinking") : (tc.name || tr("工具", "tool"));
    if (!(name in counts)) { counts[name] = 0; order.push(name); }
    counts[name]++;
    imageCount += countToolImages(msgs[i]);
  }
  var names = order.map(function(n) { return counts[n] > 1 ? n + " ×" + counts[n] : n; });
  return { names: names, imageCount: imageCount };
}

// 会话级权限模式（仅对当前 session 生效，优先级高于全局 config）。
// 「默认」按用户要求改名为「询问」。
// 注意：label 必须在渲染时按当前语言取值（用 tt(m.zh,m.en)），不能在模块级用 tr() 预先固化，
// 否则切换语言后下拉项文案不会更新（tr 只在模块加载那一刻求值一次）。
var PERM_MODES: { value: string; zh: string; en: string; zhMini: string; enMini: string; danger?: boolean }[] = [
  { value: "default", zh: "询问", en: "Ask", zhMini: "询问", enMini: "Ask" },
  { value: "acceptEdits", zh: "自动批准编辑", en: "Auto-accept edits", zhMini: "自动", enMini: "Auto" },
  { value: "plan", zh: "计划（只读）", en: "Plan (read-only)", zhMini: "计划", enMini: "Plan" },
  { value: "bypassPermissions", zh: "完全放行", en: "Bypass all", zhMini: "放行", enMini: "Bypass", danger: true },
];

export function ChatView() {
  var tt = useT();
  var { projectPath } = useAppStore();
  var chatInputRequest = useAppStore(function(s) { return s.chatInputRequest; });
  var {
    sessions, activeSessionId, isProcessing,
    createSession, deleteSession, setActiveSession,
    addMessage, setIsProcessing,
    enqueue, removeQueued,
    deleteMessage, truncateAfter, loadFromDisk,
    setSessionPermissionMode, setSessionChatMode, setSessionGameMode, setSessionEffort, setSessionThinking, compactSession,
    setInputDraft
  } = useChatStore();
  var queues = useChatStore(function(s) { return s.queues; });
  var sessionUsage = useChatStore(function(s) { return s.sessionUsage; });
  var sessionCheckpoints = useChatStore(function(s) { return s.sessionCheckpoints; });
  var providers = useProviderStore(function(s) { return s.providers; });
  // Global selection = default for *new* sessions. The actual provider/model in
  // use is per-session (see selectedProvider below); switching a model only
  // affects the active session, not the others.
  var defaultProviderId = useProviderStore(function(s) { return s.selectedProviderId; });
  var defaultModel = useProviderStore(function(s) { return s.selectedModel; });
  var setDefaultProviderId = useProviderStore(function(s) { return s.setSelectedProviderId; });
  var setDefaultModel = useProviderStore(function(s) { return s.setSelectedModel; });
  var setSessionModel = useChatStore(function(s) { return s.setSessionModel; });
  var resolveProvider = useProviderStore(function(s) { return s.resolve; });
  var refreshAllBalances = useProviderStore(function(s) { return s.refreshAllBalances; });

  var inputDrafts = useChatStore(function(s) { return s.inputDrafts; });
  // 无活动会话时(刚开软件、空项目)用一个固定兜底 key 存草稿,保证输入框能打字/粘贴。
  // 发送时 handleSend 读的是 input 文本本身,会随新建会话一起带走,无需迁移草稿。
  var draftKey = activeSessionId || "__no_session__";
  var input = inputDrafts[draftKey] || "";
  var setInput = useCallback(function(v: string) {
    setInputDraft(draftKey, v);
  }, [draftKey, setInputDraft]);
  var [agentStatus, setAgentStatus] = useState<"idle" | "thinking" | "executing" | "responding">("idle");
  // 游戏化“正在思考”短语：思考态时持续轮换；非思考态清空。
  var [thinkingPhrase, setThinkingPhrase] = useState<string>("");
  var [errorMsg, setErrorMsg] = useState<string | null>(null);
  // 待发送的附件：图片(kind=image，dataUrl 缩略图 + 落盘 path) 与其它文件
  // (kind=file，显示文件图标 + 文件名，发送时把路径作为文本引用给 AI)。
  var [attachments, setAttachments] = useState<{ id: string; kind: "image" | "file"; dataUrl?: string; path: string; name?: string }[]>([]);
  // 拖拽悬停态：高亮 composer 提示「松手添加」。
  var [dragging, setDragging] = useState(false);

  // 统一提示：优先以灰色内联小字写进当前会话的对话流（addNotice，不打扰、可留存）。
  // 仅在无活动会话时退化为顶部中性提示条（灰色，非红框）。
  var notifyError = useCallback(function(msg: string) {
    var sid = useChatStore.getState().activeSessionId;
    if (sid) { useChatStore.getState().addNotice(sid, msg); return; }
    setErrorMsg(msg);
    setTimeout(function() { setErrorMsg(null); }, 5000);
  }, []);

  // 读一个图片 File → dataURL → 落盘（userData/chat-images）→ 加入 attachments。
  var addImageFile = useCallback(function(file: File) {
    if (!file || file.type.indexOf("image/") !== 0) return;
    var reader = new FileReader();
    reader.onload = async function() {
      var dataUrl = String(reader.result || "");
      if (!dataUrl) return;
      var ext = (file.name && file.name.indexOf(".") !== -1) ? file.name.split(".").pop()! : (file.type.split("/")[1] || "png");
      var res = await (window as any).api?.saveChatImage?.(dataUrl, ext);
      if (!res || !res.ok || !res.path) { notifyError(tr("图片保存失败", "Failed to save image") + (res && res.error ? ": " + res.error : "")); return; }
      setAttachments(function(prev) { return prev.concat([{ id: "img-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7), kind: "image", dataUrl: dataUrl, path: res.path }]); });
    };
    reader.readAsDataURL(file);
  }, [notifyError]);

  // 非图片文件：取其真实路径，加为「文件」附件——输入框上显示图标+文件名，
  // 发送时把绝对路径作为文本引用给 AI（可 read_file）。
  // 注意：Electron 33 起 File.path 已被移除，必须经 preload 暴露的 webUtils.getPathForFile 取得。
  var addPathFile = useCallback(function(file: File) {
    var p = (window as any).api?.getPathForFile?.(file);
    if (!p || typeof p !== "string") p = (file as any).path; // 旧版本/降级回退
    if (!p || typeof p !== "string") { notifyError(tr("无法获取该文件的路径（仅支持拖入本地文件）。", "Could not get the file path (only local files can be dropped in).")); return; }
    var name = file.name || p.split(/[\\/]/).pop() || p;
    setAttachments(function(prev) {
      if (prev.some(function(a) { return a.kind === "file" && a.path === p; })) return prev; // 去重
      return prev.concat([{ id: "file-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7), kind: "file", path: p, name: name }]);
    });
  }, [notifyError]);

  // 统一入口：按类型分流到图片/文件处理。
  var addFile = useCallback(function(file: File) {
    if (!file) return;
    if (file.type && file.type.indexOf("image/") === 0) addImageFile(file);
    else addPathFile(file);
  }, [addImageFile, addPathFile]);

  var removeAttachment = useCallback(function(id: string) {
    setAttachments(function(prev) { return prev.filter(function(a) { return a.id !== id; }); });
  }, []);

  // Ensure a default provider/model exists once providers are available (used
  // as the starting point for new sessions).
  useEffect(function() {
    if (!defaultProviderId && providers.length > 0) {
      setDefaultProviderId(providers[0].id);
    }
  }, [providers, defaultProviderId]);

  // Per-session selection: resolve the active session's provider/model. Falls
  // back to the global default for brand-new sessions, or to name-matching for
  // sessions saved before `providerId` existed.
  var activeSessionForSel = sessions.find(function(s: any) { return s.id === activeSessionId; });
  var selectedProviderId = (function() {
    if (activeSessionForSel) {
      if (activeSessionForSel.providerId && providers.some(function(p) { return p.id === activeSessionForSel!.providerId; })) {
        return activeSessionForSel.providerId;
      }
      // Legacy fallback: match by provider name.
      var byName = providers.find(function(p) { return p.name === activeSessionForSel!.provider; });
      if (byName) return byName.id;
    }
    return defaultProviderId;
  })();
  var selectedProvider = providers.find(function(p) { return p.id === selectedProviderId; });
  var models = selectedProvider?.models || [];
  var selectedModel = (function() {
    // Prefer the session's stored model when it's valid for the resolved provider.
    if (activeSessionForSel && activeSessionForSel.model && models.indexOf(activeSessionForSel.model) !== -1) {
      return activeSessionForSel.model;
    }
    if (defaultModel && models.indexOf(defaultModel) !== -1) return defaultModel;
    return models[0] || "";
  })();

  // Change the provider for the active session (or the global default if none).
  var setSelectedProviderId = useCallback(function(id: string) {
    var prov = useProviderStore.getState().providers.find(function(p) { return p.id === id; });
    var firstModel = prov?.models[0] || "";
    var sid = useChatStore.getState().activeSessionId;
    if (sid) setSessionModel(sid, id, prov?.name || "", firstModel);
    // Also update the global default so the next new session starts here.
    setDefaultProviderId(id);
  }, [setSessionModel, setDefaultProviderId]);

  // Change the model for the active session (or the global default if none).
  var setSelectedModel = useCallback(function(model: string) {
    var sid = useChatStore.getState().activeSessionId;
    if (sid) {
      var cur = useProviderStore.getState().providers.find(function(p) { return p.id === selectedProviderId; });
      setSessionModel(sid, selectedProviderId, cur?.name || "", model);
    }
    setDefaultModel(model);
  }, [setSessionModel, setDefaultModel, selectedProviderId]);

  // Resolve a session's effective provider + model from the live store (works
  // for any session, including non-active/background ones during queue drain).
  // Falls back to global default for new sessions, name-matching for legacy ones.
  var resolveSessionProvider = useCallback(function(sessionId: string): { provider: Provider | undefined; providerId: string; model: string } {
    var ps = useProviderStore.getState();
    var provs = ps.providers;
    var sess = useChatStore.getState().sessions.find(function(s: any) { return s.id === sessionId; });
    var pid = "";
    if (sess) {
      var sProvId = sess.providerId;
      var sProvName = sess.provider;
      if (sProvId && provs.some(function(p) { return p.id === sProvId; })) {
        pid = sProvId;
      } else {
        var byName = provs.find(function(p) { return p.name === sProvName; });
        if (byName) pid = byName.id;
      }
    }
    if (!pid) pid = ps.selectedProviderId;
    var prov = provs.find(function(p) { return p.id === pid; });
    var ms = prov?.models || [];
    var model = "";
    if (sess && sess.model && ms.indexOf(sess.model) !== -1) model = sess.model;
    else if (ps.selectedModel && ms.indexOf(ps.selectedModel) !== -1) model = ps.selectedModel;
    else model = ms[0] || "";
    return { provider: prov, providerId: pid, model: model };
  }, []);

  var messagesEndRef = useRef<HTMLDivElement>(null);
  var scrollContainerRef = useRef<HTMLDivElement>(null);
  // 用户是否「贴近底部」：贴底才自动跟随新内容，向上翻看时不抢滚动。
  var stickToBottomRef = useRef<boolean>(true);
  var inputRef = useRef<HTMLTextAreaElement>(null);
  var imageInputRef = useRef<HTMLInputElement>(null);
  var inputMenu = useContextMenu();
  // 斜杠命令面板状态：candidates 跟随输入实时过滤；slashIndex 为键盘高亮项。
  var openConfig = useAppStore(function (s) { return s.openConfig; });
  var [slashItems, setSlashItems] = useState<SlashCommand[]>([]);
  var [slashIndex, setSlashIndex] = useState(0);
  // 浏览模式：输入框已有普通文字时点斜杠按钮打开的命令列表（非 "/" 输入驱动）。
  // 此模式下选命令必须保留用户已输入的文本，不能像普通命令那样清空输入框。
  var [slashBrowse, setSlashBrowse] = useState(false);
  // 推理强度二级面板：null=未打开；打开时记录键盘高亮项。覆盖在斜杠面板之上。
  var [effortMenuOpen, setEffortMenuOpen] = useState(false);
  var [effortMenuIndex, setEffortMenuIndex] = useState(0);
  var slashOpen = slashItems.length > 0 || effortMenuOpen;
  // @ 文件提及：项目文件索引（懒加载）+ 候选 + 高亮项。
  var fileIndexRef = useRef<string[]>([]);
  var [atItems, setAtItems] = useState<string[]>([]);
  var [atIndex, setAtIndex] = useState(0);
  var atOpen = atItems.length > 0;
  var [expandedTools, setExpandedTools] = useState<Set<string>>(new Set());
  // 工具组的手动折叠覆盖：key=该组首条工具消息 id，value=true 收拢 / false 展开。
  // 不在表里=跟随默认规则：组后还没有文字/用户消息时默认展开，一旦产生后续消息
  // （文字回复等）即自动收拢。用户手动点箭头则写入覆盖，之后尊重用户选择。
  var [toolGroupOverride, setToolGroupOverride] = useState<Record<string, boolean>>({});
  // Pending interactive requests live in the store (survive tab switches).
  var pendingApproval = useChatStore(function(s) { return s.pendingApproval; });
  var pendingFollowup = useChatStore(function(s) { return s.pendingFollowup; });
  var setPendingApproval = useChatStore(function(s) { return s.setPendingApproval; });
  var setPendingFollowup = useChatStore(function(s) { return s.setPendingFollowup; });
  // Per-question draft answers for the followup card (index → text).
  var [followupAnswers, setFollowupAnswers] = useState<Record<number, string>>({});
  var scrollToMessageId = useChatStore(function(s) { return s.scrollToMessageId; });
  var setScrollToMessageId = useChatStore(function(s) { return s.setScrollToMessageId; });
  // The request to show for the ACTIVE session (or null).
  var approval = activeSessionId ? pendingApproval[activeSessionId] : null;
  var followup = activeSessionId ? pendingFollowup[activeSessionId] : null;

  var activeSession = sessions.find(function(s: any) { return s.id === activeSessionId; });

  // 小窗模式（Mini Float）：主窗口缩成置顶小窗时，ChatView 把消息区换成「两个气泡」
  // （最后一条 user / 最后一条 assistant），输入区原样保留（同一 composer，链路一致）。
  var miniMode = useAppStore(function(s) { return s.miniMode; });
  var setMiniMode = useAppStore(function(s) { return s.setMiniMode; });

  // 小窗 idle 自动隐藏：15 秒无鼠标活动/无新消息则隐藏消息流只剩输入框；任何鼠标/键盘活动
  // （全局监听）或会话消息变化都会重置计时并重新显示。退出小窗时清理。
  var [miniBubblesHidden, setMiniBubblesHidden] = useState(false);
  var miniIdleTimer = useRef<any>(null);
  var miniPing = useCallback(function() {
    setMiniBubblesHidden(false);
    if (miniIdleTimer.current) clearTimeout(miniIdleTimer.current);
    miniIdleTimer.current = setTimeout(function() { setMiniBubblesHidden(true); }, 15000);
  }, []);
  var miniMsgCount = (activeSession && activeSession.messages && activeSession.messages.length) || 0;
  useEffect(function() {
    if (!miniMode) {
      if (miniIdleTimer.current) clearTimeout(miniIdleTimer.current);
      setMiniBubblesHidden(false);
      return;
    }
    miniPing(); // 进入小窗 / 新消息 → 重置计时并显示。
    // 全局监听鼠标活动与键盘输入：窗口任意位置操作都重置计时。
    window.addEventListener("mousemove", miniPing);
    window.addEventListener("mousedown", miniPing);
    window.addEventListener("keydown", miniPing);
    return function() {
      if (miniIdleTimer.current) clearTimeout(miniIdleTimer.current);
      window.removeEventListener("mousemove", miniPing);
      window.removeEventListener("mousedown", miniPing);
      window.removeEventListener("keydown", miniPing);
    };
  }, [miniMode, miniMsgCount, miniPing]);

  // 快捷键呼出小窗后自动聚焦输入框，免去点击即可直接打字。两条触发路径：
  //  - miniMode 变 true（首次进小窗）；
  //  - App 每次快捷键触发派发 cw:focus-mini-input（覆盖「已在小窗但未聚焦」的情况）。
  useEffect(function() {
    function focusInput() { try { inputRef.current?.focus(); } catch (e) {} }
    var t: any = null;
    if (miniMode) t = setTimeout(focusInput, 80);
    window.addEventListener("cw:focus-mini-input", focusInput);
    return function() { if (t) clearTimeout(t); window.removeEventListener("cw:focus-mini-input", focusInput); };
  }, [miniMode]);

  // 小窗：按住空白处拖动窗口（JS 实现）。空白判定与双击一致——没按在文字/按钮/图片等
  // 内容上即视为空白，可拖动；按在内容上不拖（保证可选中/可点击）。
  var onMiniBgMouseDown = useCallback(function(e: React.MouseEvent) {
    if (!miniMode || e.button !== 0) return;
    if (!isMiniBlankTarget(e)) return;
    e.preventDefault();
    var start = { sx: e.screenX, sy: e.screenY, wx: 0, wy: 0, ready: false };
    (async function() {
      try { var pos = await (window.api as any).getWindowPosition(); start.wx = pos[0]; start.wy = pos[1]; start.ready = true; } catch (er) {}
    })();
    function onMove(ev: MouseEvent) {
      if (!start.ready) return;
      var dx = ev.screenX - start.sx;
      var dy = ev.screenY - start.sy;
      try { (window.api as any).setWindowPosition(start.wx + dx, start.wy + dy); } catch (er) {}
    }
    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [miniMode]);

  // 跟随滚动：仅当用户「贴近底部」时把视图钉到底部。
  // 历史教训：不能用 scrollIntoView({behavior:"smooth"})——流式时每 ~60ms 触发一次，
  // 连续 smooth 动画互相打断、且会连带滚动祖先造成整窗弹跳。
  // 方案：单条 rAF 缓动循环，把 scrollTop 朝「当前底部」逐帧逼近（目标随流式内容增长
  // 而移动，但始终只有一个循环在跑，不会动画打架）。比直接跳更顺滑，又无 churn。
  //   - autoScrollRef：标记正处于程序化平滑滚动，避免被 onScroll 误判成用户操作。
  //   - instantNextRef：切换会话/首次进入时直接跳到底（不要缓动穿过整段历史）。
  var scrollRafRef = useRef<number>(0);
  var autoScrollRef = useRef<boolean>(false);
  var instantNextRef = useRef<boolean>(true);
  // 「跳到底部」按钮：仅当用户向上离开底部一段距离时显示。
  var [showJumpBottom, setShowJumpBottom] = useState(false);
  // 输入区悬浮（绝对定位）覆盖在消息底部，四周留白透明、让聊天内容滚动时从其背后透出，
  // 输入框本体仍不透明。消息滚动容器据此留出底部内距，保证「贴底」时最后一条消息停在
  // 输入框之上而非被遮住。inputAreaRef 量实际高度（含附件/队列/命令面板等动态内容）。
  var inputAreaRef = useRef<HTMLDivElement>(null);
  var [inputAreaHeight, setInputAreaHeight] = useState(0);
  useEffect(function() {
    if (!stickToBottomRef.current) return;
    var c = scrollContainerRef.current;
    if (!c) return;
    cancelAnimationFrame(scrollRafRef.current);
    // 切换会话/首次：瞬时定位到底，不做缓动。
    if (instantNextRef.current) {
      instantNextRef.current = false;
      var raf0 = requestAnimationFrame(function() {
        var el0 = scrollContainerRef.current;
        if (el0) el0.scrollTop = el0.scrollHeight;
      });
      scrollRafRef.current = raf0;
      return function() { cancelAnimationFrame(scrollRafRef.current); };
    }
    function step() {
      var el = scrollContainerRef.current;
      if (!el || !stickToBottomRef.current) { autoScrollRef.current = false; return; }
      var target = el.scrollHeight - el.clientHeight;
      var diff = target - el.scrollTop;
      if (Math.abs(diff) <= 1) { el.scrollTop = target; autoScrollRef.current = false; return; }
      autoScrollRef.current = true;
      el.scrollTop += diff * 0.22; // 缓动系数：越大越快，0.22 ≈ 平滑跟手
      scrollRafRef.current = requestAnimationFrame(step);
    }
    scrollRafRef.current = requestAnimationFrame(step);
    return function() { cancelAnimationFrame(scrollRafRef.current); };
  }, [activeSession?.messages, agentStatus]);

  // 监听用户滚动，记录是否贴近底部（阈值 80px）。贴底才在新内容到来时自动跟随。
  // 程序化平滑滚动期间（autoScrollRef）不更新「贴底」判定，避免把自己的滚动当成用户
  // 翻看而误停；但「跳到底部」按钮的显隐始终跟随实际位置更新。
  var onMessagesScroll = useCallback(function() {
    var el = scrollContainerRef.current;
    if (!el) return;
    var distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setShowJumpBottom(distanceFromBottom > 240);
    if (autoScrollRef.current) return;
    stickToBottomRef.current = distanceFromBottom < 80;
  }, []);

  // 用户向上滚（看历史）→ 立即停掉自动跟随与缓动动画，把控制权交还用户；
  // 之后用户再滚回底部（onScroll 阈值内）会重新贴底。
  var onMessagesWheel = useCallback(function(e: React.WheelEvent) {
    if (e.deltaY < 0 && stickToBottomRef.current) {
      stickToBottomRef.current = false;
      autoScrollRef.current = false;
      cancelAnimationFrame(scrollRafRef.current);
    }
  }, []);

  // 点「跳到底部」：重新贴底并定位到最新（同时隐藏按钮）。先同步置底，再用 rAF 复位
  // 一次——流式/图片未完成布局时 scrollHeight 还会变，单次同步赋值可能落空（表现为
  // 「点了没反应」），两段式 + 重新贴底确保稳定到底。
  var jumpToBottom = useCallback(function() {
    stickToBottomRef.current = true;
    autoScrollRef.current = false;
    cancelAnimationFrame(scrollRafRef.current);
    var el = scrollContainerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    requestAnimationFrame(function() {
      var c = scrollContainerRef.current;
      if (c && stickToBottomRef.current) c.scrollTop = c.scrollHeight;
    });
    setShowJumpBottom(false);
  }, []);

  // 量取悬浮输入区的实际高度，写进消息容器的底部内距，保证最后一条消息恰好停在
  // 输入框上方（不被遮）。输入框因附件/队列/命令面板/多行而变高时实时跟随；高度变化
  // 后若处于贴底状态，补一次置底，避免新留白把最后一条顶到输入框背后。
  useEffect(function() {
    var el = inputAreaRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    var ro = new ResizeObserver(function() {
      var node = inputAreaRef.current;
      if (!node) return;
      setInputAreaHeight(node.offsetHeight);
      if (stickToBottomRef.current) {
        var c = scrollContainerRef.current;
        if (c) c.scrollTop = c.scrollHeight;
      }
    });
    ro.observe(el);
    return function() { ro.disconnect(); };
  }, [activeSessionId]);

  // 小窗闲置收缩/展开：用 rAF 逐帧缓动窗口高度做「收拢/展开」动画（Windows 原生 resize 无动画）。
  // 收起目标=输入框实测高；展开目标=「进入收拢前用户实际的窗口高度」（尊重用户手动调整，不再
  // 硬编码 360）。关键：effect **不依赖 inputAreaHeight**——否则 hover 提问卡片等导致输入框高度
  // 变化时会重跑、把手动调整过的窗口强制设回默认高度（即之前的跳动 bug）。
  var miniAnimRef = useRef<number>(0);
  var miniHeightRef = useRef<number>(MINI_H_RENDER);     // 当前（动画中）高度
  var expandedHeightRef = useRef<number>(MINI_H_RENDER); // 展开态目标高度（含用户手动调整）
  useEffect(function() {
    if (!miniMode) { miniHeightRef.current = MINI_H_RENDER; expandedHeightRef.current = MINI_H_RENDER; return; }
    var target: number;
    if (miniBubblesHidden) {
      if (typeof window !== "undefined" && window.innerHeight > 80) expandedHeightRef.current = window.innerHeight;
      var el = inputAreaRef.current;
      var collapsed = el ? Math.ceil(el.getBoundingClientRect().height) + 2 : 58;
      target = Math.max(56, collapsed);
    } else {
      target = expandedHeightRef.current || MINI_H_RENDER;
    }
    var from = miniHeightRef.current || MINI_H_RENDER;
    if (Math.abs(from - target) < 2) {
      miniHeightRef.current = target;
      try { (window.api as any).setMiniHeight(target); } catch (e) {}
      return;
    }
    var dur = 260;
    var t0 = 0;
    if (miniAnimRef.current) cancelAnimationFrame(miniAnimRef.current);
    function ease(p: number) { return 1 - Math.pow(1 - p, 3); } // easeOutCubic
    function step(ts: number) {
      if (!t0) t0 = ts;
      var p = Math.min(1, (ts - t0) / dur);
      var h = Math.round(from + (target - from) * ease(p));
      miniHeightRef.current = h;
      try { (window.api as any).setMiniHeight(h); } catch (e) {}
      if (p < 1) miniAnimRef.current = requestAnimationFrame(step);
      else miniAnimRef.current = 0;
    }
    miniAnimRef.current = requestAnimationFrame(step);
    return function() { if (miniAnimRef.current) { cancelAnimationFrame(miniAnimRef.current); miniAnimRef.current = 0; } };
  }, [miniMode, miniBubblesHidden]);

  // 切换会话时重置为贴底（新会话应停在最新一条），并标记下次为瞬时定位。
  useEffect(function() {
    stickToBottomRef.current = true;
    instantNextRef.current = true;
  }, [activeSessionId]);

  // 游戏化短语轮换：thinking 与 responding 态都运行（实际大部分时间是 responding，
  // 只有开头一小段是 thinking），每 ~2.6s 换一条；切出这两态时清空，避免残留。
  var rotatePhrase = agentStatus === "thinking" || agentStatus === "responding";
  useEffect(function() {
    if (!rotatePhrase) {
      setThinkingPhrase("");
      return;
    }
    setThinkingPhrase(function(prev) { return randomThinkingPhrase(prev); });
    var timer = setInterval(function() {
      setThinkingPhrase(function(prev) { return randomThinkingPhrase(prev); });
    }, 2600);
    return function() { clearInterval(timer); };
  }, [rotatePhrase]);

  // 阻止把文件拖到窗口任意非投放区时浏览器默认「打开文件」导致整窗导航。
  // composer 自己的 onDrop 会 stopPropagation 之外正常处理；这里只兜底其它区域。
  useEffect(function() {
    function prevent(e: DragEvent) { e.preventDefault(); }
    window.addEventListener("dragover", prevent);
    window.addEventListener("drop", prevent);
    return function() {
      window.removeEventListener("dragover", prevent);
      window.removeEventListener("drop", prevent);
    };
  }, []);

  // Search → jump: scroll to the target message and flash a highlight.
  useEffect(function() {
    if (!scrollToMessageId) return;
    var t = setTimeout(function() {
      var el = document.getElementById("msg-" + scrollToMessageId);
      if (el) {
        var node = el;
        node.scrollIntoView({ behavior: "smooth", block: "center" });
        node.classList.add("cw-flash");
        setTimeout(function() { node.classList.remove("cw-flash"); }, 1600);
      }
      setScrollToMessageId(null);
    }, 80);
    return function() { clearTimeout(t); };
  }, [scrollToMessageId, activeSessionId]);

  // 「发送给 agent」注入：其它组件调用 requestChatInput(text) 后，把文本追加进
  // 输入框（已有内容则空格分隔）并聚焦。靠 nonce 去重，避免重复触发。
  var lastInjectNonce = useRef<number>(0);
  useEffect(function() {
    if (!chatInputRequest) return;
    var reqText = chatInputRequest.text;
    if (chatInputRequest.nonce === lastInjectNonce.current) return;
    lastInjectNonce.current = chatInputRequest.nonce;
    setInput(input && input.trim() ? input.replace(/\s*$/, "") + " " + reqText + " " : reqText + " ");
    setTimeout(function() {
      var el = inputRef.current;
      if (el) { el.focus(); el.style.height = "auto"; el.style.height = Math.min(el.scrollHeight, 96) + "px"; }
    }, 0);
  }, [chatInputRequest]);

  // Agent is ready when project is open
  useEffect(function() {
    if (projectPath) {
      setAgentStatus("idle");
      window.api.startStreamWatch?.(projectPath);
      // Restore persisted conversations for this project (JSONL on disk).
      loadFromDisk(projectPath);
      // 预载项目文件索引，供聊天框 @ 文件提及。
      (window.api as any).listProjectFiles?.(projectPath).then(function(list: string[]) {
        fileIndexRef.current = Array.isArray(list) ? list : [];
      });
    }
    return function() {
      if (projectPath) window.api.stopStreamWatch?.(projectPath);
    };
  }, [projectPath]);

  // Balance polling: probe on mount + whenever providers change, then every 5 min.
  useEffect(function() {
    if (providers.length === 0) return;
    refreshAllBalances();
    var timer = setInterval(function() { refreshAllBalances(); }, 5 * 60 * 1000);
    return function() { clearInterval(timer); };
  }, [providers.length, refreshAllBalances]);

  // Busy state is PER-SESSION: a turn running in one session must not block or
  // mark other sessions as busy. busyMapRef holds the live per-session flag
  // (read inside long-lived listeners); busySessions drives re-render.
  var busyMapRef = useRef<Record<string, boolean>>({});
  var [busySessions, setBusySessions] = useState<Record<string, boolean>>({});
  var runSeqRef = useRef<number>(0);
  // 长生命周期监听器（agent:turn/agent:error）里要调用 doCompact/runTurn，但它们定义
  // 在后面、且每次渲染重建。用 ref 持有最新引用，监听器经 ref 调用，避免闭包过期。
  var doCompactRef = useRef<null | ((forSessionId?: string, trigger?: "manual" | "auto") => Promise<void>)>(null);
  var runTurnRef = useRef<null | ((sessionId: string, text: string, images?: string[]) => Promise<boolean>)>(null);
  // 上下文溢出自动重试：记录「最近一次为某会话因溢出自动重试过」，每条用户消息只重试
  // 一次，压缩后仍溢出则停手报错，绝不无限循环。key=sessionId，value=最后重试的文本。
  var overflowRetryRef = useRef<Record<string, string>>({});
  // 错误看门狗：收到「终止类」agent:error 后启动超时；若超时内没等到权威收尾
  // （run-state=false / 该会话新 turn 进展），认为 loop 卡死不响应，主动 agentStop
  // 并把 busy 清掉让按钮恢复成发送（兜底极端的「中断了仍显示终止」）。
  var errorWatchdogRef = useRef<Record<string, any>>({});
  // 本轮是否正常完成（收到 agent:turn done）。run-state=false 收尾时据此判定：
  // 未正常完成的终止（HTTP 报错、流中断、看门狗）→ 红色失败感叹号角标。
  var turnDoneRef = useRef<Record<string, boolean>>({});
  // runId → 该轮实际使用的模型/供应商名。在 runTurn 发起时定格，applyTurn 用它给
  // 历史消息盖章，使头像/名称锁定当时模型，不随之后切换而变。
  var runStampRef = useRef<Record<string, { modelName?: string; providerName?: string }>>({});

  // Whether THIS (active) session is busy — what the input/stop UI reacts to.
  var busy = activeSessionId ? !!busySessions[activeSessionId] : false;

  var setSessionBusy = useCallback(function(sessionId: string, v: boolean) {
    busyMapRef.current[sessionId] = v;
    setBusySessions(function(prev) {
      var next = Object.assign({}, prev);
      if (v) next[sessionId] = true; else delete next[sessionId];
      return next;
    });
    // 根本保证：转圈角标的生命周期严格绑定 busy。一旦不忙（正常完成 / 报错 / 停止 /
    // 看门狗），无论是哪条路径触发，都立刻清掉转圈——杜绝「已终止仍转圈」。
    if (!v) useChatStore.getState().setGenerating(sessionId, null);
  }, []);

  // 收到权威收尾或新进展时撤掉该会话的错误看门狗（loop 还活着，无需兜底）。
  var clearErrorWatchdog = useCallback(function(sessionId: string) {
    var t = errorWatchdogRef.current[sessionId];
    if (t) { clearTimeout(t); delete errorWatchdogRef.current[sessionId]; }
  }, []);

  // 全局心跳看门狗（每秒一跳，不依赖任何 IPC 事件）：扫描所有「正在生成」的会话，
  // 若距最近一次进展已超过该会话的超时上限（agent 轮次 90s、直接出图 120s，无任何
  // 进展回传），判定为静默卡死/已终止却没收到收尾事件——强制 agentStop + 清 busy +
  // 标红失败。这是「已终止仍转圈好几分钟」的根治兜底：哪怕 run-state / error 全部
  // 丢失，这里也一定会收口。同时它驱动转圈颜色的重渲染（每秒重算红度）。
  var [, setHeartbeat] = useState(0);
  useEffect(function() {
    var timer = setInterval(function() {
      var st = useChatStore.getState();
      var gen = st.generating;
      var now = Date.now();
      var anyGenerating = false;
      for (var sid in gen) {
        anyGenerating = true;
        // 正在等待用户审批/回答的会话绝不超时终止：loop 此刻是「等你」而非「卡死」，
        // 进度时间戳停更是正常的。这类会话改由问号角标提示，这里直接跳过。
        if (st.pendingApproval[sid] || st.pendingFollowup[sid]) continue;
        var limit = st.genTimeout[sid] || 90000;
        if (now - gen[sid] >= limit) {
          // 超时收口：停后端、清 busy（setSessionBusy 会连带清 generating）、标红。
          try { window.api.agentStop?.(sid); } catch (e) {}
          clearErrorWatchdog(sid);
          setSessionBusy(sid, false);
          st.setSessionFailed(sid, true);
          if (st.activeSessionId === sid) setIsProcessing(false);
          var hbSess = st.sessions.find(function(s) { return s.id === sid; });
          var hbName = prettyModelName(hbSess && hbSess.model, hbSess && hbSess.provider);
          st.addNotice(sid, randomFailurePhrase(hbName) + tr(" 等了约 " + Math.round(limit / 1000) + " 秒都没有新动静，已自动停止本轮。", " waited about " + Math.round(limit / 1000) + "s with no activity, so this turn was stopped automatically."));
        }
      }
      // 仅在确有会话生成中时触发重渲染（驱动颜色随时间变红）；空闲时不空转。
      if (anyGenerating) setHeartbeat(now);
    }, 1000);
    return function() { clearInterval(timer); };
  }, [setSessionBusy, clearErrorWatchdog]);

  // Listen for agent events. The backend owns the message list; we only apply
  // its authoritative per-turn snapshots (Cline model) — no bubble guessing.
  useEffect(function() {
    if (!projectPath) return;
    var store = useChatStore.getState;
    // 重挂恢复：主进程 loop 不随本组件卸载而停（切到其它标签页时 ChatView 被卸载，
    // 局部 busy/agentStatus/转圈全丢，但后台对话仍在跑）。挂载时主动拉取 runningLoops
    // 真相源，把仍在运行的会话重新点亮 busy + 转圈角标，让进度提示重新显现。
    (window.api as any).agentRunningSessions?.().then(function(ids: string[]) {
      if (!Array.isArray(ids)) return;
      var st = useChatStore.getState();
      ids.forEach(function(sid: string) {
        setSessionBusy(sid, true);
        // 没有最近进度时间戳就以「现在」起算，心跳看门狗据此计时（有新 turn 回传会刷新）。
        if (st.generating[sid] == null) st.setGenerating(sid, Date.now());
        if (sid === store().activeSessionId) {
          setIsProcessing(true);
          setAgentStatus(function(prev) { return prev === "idle" ? "responding" : prev; });
        }
      });
    }).catch(function() {});
    // 通知点击跳转：切到聊天视图并激活对应会话（窗口聚焦由 systemNotify 负责）。
    var jumpToSession = function(sid: string) {
      if (!sid) return;
      useChatStore.getState().setActiveSession(sid);
      useAppStore.getState().setActiveView("chat");
    };
    var unsubTurn = window.api.onAgentTurn?.(function(data: any) {
      if (!data || !data.sessionId) return;
      // 有新 turn 进展 = loop 还活着，撤掉错误看门狗。
      clearErrorWatchdog(data.sessionId);
      // 每次有消息回传：把转圈角标刷新回紫色（bump tick 重挂，重置「紫→红」渐变）。
      if (!data.done && busyMapRef.current[data.sessionId]) store().setGenerating(data.sessionId, Date.now());
      // 增量帧（性能优化）：只把追加文本拼到对应消息，不带 usage/done。其余全量快照
      // 走原 applyTurn 全量覆盖（兜底真相源）。增量找不到 id 时 store 内部自动忽略。
      if (data.delta && data.delta.id) {
        store().appendTurnDelta(data.sessionId, data.runId, data.delta.id, data.delta.append || "");
        setAgentStatus("responding");
        return;
      }
      store().applyTurn(data.sessionId, data.runId, data.messages || [], !!data.done, runStampRef.current[data.runId]);
      if (data.usage) store().setSessionUsage(data.sessionId, { promptTokens: data.usage.promptTokens || 0, completionTokens: data.usage.completionTokens || 0, contextTokens: data.usage.contextTokens || 0, estimated: !!data.usage.estimated, cacheCreate: data.usage.cacheCreate || 0, cacheRead: data.usage.cacheRead || 0, turnCacheRead: data.usage.turnCacheRead || 0, breakdown: data.usage.breakdown });
      if (data.done) {
        // 本轮正常完成：标记 done，让随后的 run-state=false 不会误判为失败。
        turnDoneRef.current[data.sessionId] = true;
        store().setGenerating(data.sessionId, null);
        // 本轮成功完成：清掉该会话的溢出重试标记，未来同样文本若再溢出可再次自动重试。
        if (overflowRetryRef.current[data.sessionId]) delete overflowRetryRef.current[data.sessionId];
        // 本轮已落定，清掉盖章缓存（消息已带上 modelName/providerName）。
        if (data.runId) delete runStampRef.current[data.runId];
        // 把本轮用量累加进会话累计并落盘（供 Analytics 聚合真实数据）。
        if (data.usage && (data.usage.promptTokens || data.usage.completionTokens)) {
          store().addTurnUsage(data.sessionId, {
            promptTokens: data.usage.promptTokens || 0, completionTokens: data.usage.completionTokens || 0,
            estimated: !!data.usage.estimated,
            cacheCreate: data.usage.cacheCreate || 0, cacheRead: data.usage.cacheRead || 0,
          });
        }
        setSessionBusy(data.sessionId, false);
        setIsProcessing(false);
        setAgentStatus("idle");
        // 任务完成标志：在历史列表给该会话挂灰色勾角标（store 内对当前活动会话
        // 不点亮；用户读了该会话即清）。busy 仍由本分支与权威 run-state 双向收尾，
        // 二者同向（都清 busy），不冲突。成功完成 → 清掉之前可能标过的失败红叹号。
        store().setSessionFailed(data.sessionId, false);
        store().setSessionCompleted(data.sessionId, true);
        // 上下文将满 → 自动压缩（回合结束后触发，不打断进行中的工具链）。达到 AUTO
        // 阈值即压一次；压缩本身是一次独立的 LLM 调用，完成后会插入「上下文已压缩」标记。
        var ctxTok = (data.usage && data.usage.contextTokens) || 0;
        if (ctxTok >= CONTEXT_AUTO_THRESHOLD && doCompactRef.current && !busyMapRef.current[data.sessionId]) {
          store().addNotice(data.sessionId, tr("上下文约 " + Math.round(ctxTok / 1000) + "k，已达到 " +
            Math.round(CONTEXT_AUTO_THRESHOLD / 1000) + "k 自动压缩阈值，正在压缩…",
            "Context is about " + Math.round(ctxTok / 1000) + "k, reaching the " +
            Math.round(CONTEXT_AUTO_THRESHOLD / 1000) + "k auto-compaction threshold; compacting…"));
          doCompactRef.current(data.sessionId, "auto");
        }
        // 窗口失焦时提醒「本轮已完成」。
        var doneSession = store().sessions.find(function(s) { return s.id === data.sessionId; });
        systemNotify(tr("回答完成", "Answer complete"), (doneSession ? doneSession.name + " · " : "") + tr("Agent 已完成本轮回答", "The agent has finished this turn"), "agent-done-" + data.sessionId, function() { jumpToSession(data.sessionId); });
        // FIFO: kick the next queued message for THIS session, if any.
        drainQueue(data.sessionId);
      } else {
        setAgentStatus("responding");
      }
    });
    // Listen for artifacts
    var unsubArtifact = window.api.onAgentArtifact?.(function(data: any) {
      var artifactStore = useArtifactStore.getState();
      artifactStore.addArtifact({
        id: data.id || "art-" + Date.now(),
        fileName: data.fileName, filePath: data.filePath,
        content: data.content, language: data.language,
        action: data.action, timestamp: data.timestamp || Date.now(),
      });
    });
    // Listen for errors
    var unsubErr = window.api.onAgentError?.(function(data: any) {
      // busy（发送/终止按钮）不在此清：有些 agent:error 是「非致命提示」（如 max_tokens
      // 截断、单次流报错后仍要继续的回合），过早清 busy 会把终止按钮误变成发送。按钮
      // 状态以权威 agent:run-state 收尾、全局心跳兜底为准。
      // 但「转圈→失败」是用户可见的进度反馈：除上下文溢出「正在自动重试」这一中间态外，
      // 任何 error 都意味着本轮（至少这次尝试）失败了——立即停转圈、亮红叹号，不等 60s。
      var sid = (data && data.sessionId) || store().activeSessionId || null;
      if (!data || !data.message) return;

      // 瞬时提示（传输层重试中：连接中断正在重连）不是失败，仅作轻量通知留痕，
      // 保持转圈/不亮红叹号——重试由后端 streamCompletionWithRetry 透明处理。
      if (data.transient) {
        if (sid) store().addNotice(sid, data.message);
        return;
      }

      // 上下文溢出（后端按宽泛关键词判定 kind=context_overflow）：自动压缩 + 重发最后
      // 一条用户消息。每条消息只自动重试一次（overflowRetryRef 去重），压缩后仍溢出则
      // 停手、把完整报错以灰色小字留在对话流，绝不无限循环。
      if (data.kind === "context_overflow" && sid && doCompactRef.current && runTurnRef.current) {
        var sess = store().sessions.find(function(s) { return s.id === sid; });
        var msgs = (sess && sess.messages) || [];
        var lastUser = null as any;
        for (var i = msgs.length - 1; i >= 0; i--) { if (msgs[i].role === "user" && msgs[i].content) { lastUser = msgs[i]; break; } }
        var lastText = lastUser ? String(lastUser.content) : "";
        if (lastText && overflowRetryRef.current[sid] !== lastText) {
          overflowRetryRef.current[sid] = lastText; // 标记：本条消息已自动重试，不再二次触发
          // 这是「正在自动压缩重试」的中间态，不算失败：刷新转圈（回紫），保持生成中。
          store().setGenerating(sid, Date.now());
          store().addNotice(sid, tr("上下文超出模型上限，正在自动压缩后重试…", "Context exceeds the model limit; auto-compacting and retrying…"));
          doCompactRef.current(sid, "auto").then(function() {
            if (runTurnRef.current) runTurnRef.current(sid as string, lastText, lastUser.images);
          }).catch(function() {
            store().addNotice(sid as string, tr("自动压缩失败：", "Auto-compaction failed: ") + data.message);
          });
          return;
        }
        // 已经重试过仍溢出：停手 = 本轮失败。立即停转圈、亮红叹号（不等 60s）。
        store().setGenerating(sid, null);
        store().setSessionFailed(sid, true);
        var ofSess = store().sessions.find(function(s) { return s.id === sid; });
        var ofName = prettyModelName(ofSess && ofSess.model, ofSess && ofSess.provider);
        store().addNotice(sid, randomFailurePhrase(ofName) +
          tr(" 上下文仍超出模型上限（已尝试自动压缩）。请手动 /compact、删除部分历史或换用更大上下文的模型。\n\n",
            " context still exceeds the model limit (auto-compaction was attempted). Try /compact manually, delete some history, or switch to a model with a larger context window.\n\n") + data.message);
        return;
      }

      // 普通错误 = 本轮（这次尝试）失败：立即停转圈、亮红叹号（不等 60s 看门狗）。
      // 用游戏梗失败语 + 匹配到的可能原因 + 报错原文，灰色小字内联展示。模型/供应商
      // 名取自该会话，归一成友好简称填进失败语的 {name}。
      if (sid) {
        store().setGenerating(sid, null);
        store().setSessionFailed(sid, true);
      }
      var eSess = sid ? store().sessions.find(function(s) { return s.id === sid; }) : undefined;
      var eName = prettyModelName(eSess && eSess.model, eSess && eSess.provider);
      var notice = buildFailureNotice(data.message, eName);
      if (sid) store().addNotice(sid, notice);
      else notifyError(notice);
    });
    // Listen for tool approval requests — store keyed by sessionId.
    var unsubApproval = window.api.onAgentToolApproval?.(function(data: any) {
      var sid = data.sessionId || store().activeSessionId || "default";
      store().setPendingApproval(sid, data);
      // 进入「等待用户审批」：停掉转圈（改由问号角标提示），否则 loop 阻塞期间无 turn
      // 回传，心跳会把它误判为静默卡死而超时终止。用户答复后 loop 续跑会重新点亮转圈。
      store().setGenerating(sid, null);
      // 窗口失焦时提醒「等待授权」。
      systemNotify(tr("等待授权", "Awaiting approval"), tr("Agent 想执行工具「" + (data.tool || "未知") + "」,需要你批准", "The agent wants to run the tool \"" + (data.tool || "unknown") + "\" and needs your approval"), "agent-approval-" + sid, function() { jumpToSession(sid); });
    });
    // Listen for agent followup questions (ask_followup_question)
    var unsubFollowup = window.api.onAgentFollowup?.(function(data: any) {
      var sid = data.sessionId || store().activeSessionId || "default";
      store().setPendingFollowup(sid, data);
      // 同审批：等待用户回答期间停转圈，避免被心跳超时误杀。
      store().setGenerating(sid, null);
      // 窗口失焦时提醒。计划审批卡(带 plan)用「等待审批」,普通问题用「等待回答」。
      if (data.plan) {
        systemNotify(tr("等待审批", "Awaiting approval"), tr("Agent 已产出实施计划,等你批准", "The agent has produced an implementation plan and is waiting for your approval"), "agent-plan-" + sid, function() { jumpToSession(sid); });
      } else {
        var q = (data.questions && data.questions[0] && data.questions[0].question) || tr("Agent 有问题等你回答", "The agent has a question for you");
        systemNotify(tr("等待回答", "Awaiting your answer"), q, "agent-followup-" + sid, function() { jumpToSession(sid); });
      }
    });
    // followup 被外部解决（Discord 端答了 / 超时 / abort）→ 撤掉对应卡片。
    // 仅当当前挂起的 followup 正是这个 callId 时才清，避免误清一张更新的卡。
    var unsubFollowupResolved = (window.api as any).onAgentFollowupResolved?.(function(data: any) {
      var sid = data.sessionId || store().activeSessionId || "default";
      var pending = store().pendingFollowup[sid];
      if (pending && pending.callId === data.callId) {
        store().setPendingFollowup(sid, null);
      }
    });
    // 手机端批准/拒绝审批后，主进程广播此事件 → 撤掉桌面残留审批卡。
    var unsubApprovalResolved = (window.api as any).onAgentToolApprovalResolved?.(function(data: any) {
      var sid = data.sessionId || store().activeSessionId || "default";
      var pending = store().pendingApproval[sid];
      if (pending && pending.callId === data.callId) {
        store().setPendingApproval(sid, null);
      }
    });
    // 权威运行状态（主进程 runningLoops 真相源）：这是 busy 的唯一可信来源。
    // running=false 必由 agent:send 的 finally 发出（正常/报错/abort 都覆盖），
    // 故终止按钮一定会恢复成发送；running=true 时也绝不会被非致命提示误清。
    var unsubRunState = (window.api as any).onAgentRunState?.(function(data: any) {
      if (!data || !data.sessionId) return;
      var rsSid = data.sessionId;
      setSessionBusy(rsSid, !!data.running);
      if (data.running) {
        // 新一轮开始：点亮转圈角标（紫，tick=now 作渐变起点），清掉上一轮残留的
        // 失败叹号 / 完成灰勾（避免与转圈同时出现被误当成「转圈产生角标」）。
        turnDoneRef.current[rsSid] = false;
        store().setSessionFailed(rsSid, false);
        store().setSessionCompleted(rsSid, false);
        store().setGenerating(rsSid, Date.now());
      } else {
        clearErrorWatchdog(rsSid);
        store().setGenerating(rsSid, null);
        // 未收到本轮 done 即终止（HTTP 报错/流中断/看门狗）→ 红色失败叹号角标。
        if (!turnDoneRef.current[rsSid]) store().setSessionFailed(rsSid, true);
        delete turnDoneRef.current[rsSid];
        if (store().activeSessionId === rsSid) setIsProcessing(false);
        setAgentStatus("idle");
      }
    });
    // Listen for to-do roadmap updates (update_todos) — keyed by sessionId.
    var unsubTodos = window.api.onAgentTodos?.(function(data: any) {
      var sid = data.sessionId || store().activeSessionId || "default";
      store().setSessionTodos(sid, Array.isArray(data.todos) ? data.todos : []);
    });
    // 模型自主进入计划模式(enter_plan_mode):切到 plan 模式,UI 显示计划角标,
    // 后续工具调用被只读门拦截。
    var unsubEnterPlan = (window.api as any).onAgentEnterPlan?.(function(data: any) {
      var sid = data.sessionId || store().activeSessionId || "default";
      store().setSessionPermissionMode(sid, "plan");
      systemNotify(tr("已进入计划模式", "Entered plan mode"), data.reason || tr("Agent 判断该任务需要先规划再执行", "The agent decided this task needs planning before execution"), "agent-enter-plan-" + sid, function() { jumpToSession(sid); });
    });
    // 检查点（影子 git 快照）：每次文件改动后建一个，供回滚。
    var unsubCheckpoint = (window.api as any).onAgentCheckpoint?.(function(data: any) {
      var sid = data.sessionId || store().activeSessionId || "default";
      if (data.checkpoint) store().addCheckpoint(sid, data.checkpoint);
    });
    // 生图工具出图：把本地图片路径写进对应工具消息，气泡内联显示。
    var unsubGenImages = (window.api as any).onAgentGeneratedImages?.(function(data: any) {
      var sid = data.sessionId || store().activeSessionId || "default";
      if (data.id && Array.isArray(data.paths) && data.paths.length) {
        store().setToolImages(sid, data.id, data.paths);
      }
    });
    // 子 agent(task 工具)生命周期:spawned/streaming-text/tool-call/tool-result/done,
    // 镜像进 subagent-store,供父 task 气泡内联展示子 agent 活动卡。
    var unsubSubagent = (window.api as any).onAgentSubagent?.(function(data: any) {      useSubAgentStore.getState().ingest(data);
      // 关键:子 agent 有任何生命周期事件 = 主 loop 仍在工作(只是阻塞在 await task,
      // 期间不发 agent:turn)。必须据此刷新该会话的心跳进度时间戳 + 撤错误看门狗,
      // 否则子 agent 跑超过 90s 时全局心跳会把整轮误判为「静默卡死」而 agentStop 掐断,
      // 导致 task 半途被杀、主 agent 拿不到结果 → 「完成工作后没下文」。
      var sid = data && data.sessionId;
      if (sid) {
        clearErrorWatchdog(sid);
        if (busyMapRef.current[sid]) store().setGenerating(sid, Date.now());
      }
    });
    // 持久任务清单:AI 经 checklist_submit 改动 → 记录高亮目标并刷新(UI 据此弹开下拉)。
    var unsubChecklist = (window.api as any).onAgentChecklist?.(function(data: any) {
      if (data && data.item) useChecklistStore.getState().noteAgentChange(data.item);
    });
    // 用户/其他来源改清单文件 → 刷新列表。
    var unsubChecklistChanged = (window.api as any).onChecklistChanged?.(function() {
      useChecklistStore.getState().load();
    });
    return function() {
      if (unsubTurn) unsubTurn();
      if (unsubArtifact) unsubArtifact();
      if (unsubErr) unsubErr();
      if (unsubApproval) unsubApproval();
      if (unsubFollowup) unsubFollowup();
      if (unsubFollowupResolved) unsubFollowupResolved();
      if (unsubApprovalResolved) unsubApprovalResolved();
      if (unsubRunState) unsubRunState();
      if (unsubTodos) unsubTodos();
      if (unsubEnterPlan) unsubEnterPlan();
      if (unsubCheckpoint) unsubCheckpoint();
      if (unsubGenImages) unsubGenImages();
      if (unsubSubagent) unsubSubagent();
      if (unsubChecklist) unsubChecklist();
      if (unsubChecklistChanged) unsubChecklistChanged();
      // 卸载时清掉所有错误看门狗定时器，避免泄漏/在已卸载组件上触发。
      for (var k in errorWatchdogRef.current) { clearTimeout(errorWatchdogRef.current[k]); }
      errorWatchdogRef.current = {};
    };
  }, [projectPath]);

  var respondApproval = useCallback(function(approved: boolean) {
    if (!approval || !activeSessionId) return;
    window.api.respondToolApproval?.(approval.callId, approved);
    setPendingApproval(activeSessionId, null);
    // 答复后 loop 续跑：重新点亮转圈并刷新进度起点（紫），等待下一个 turn 回传。
    if (busyMapRef.current[activeSessionId]) useChatStore.getState().setGenerating(activeSessionId, Date.now(), 90000);
  }, [approval, activeSessionId, setPendingApproval]);

  // Submit all answers for the active followup (one string per question, in order).
  var submitFollowup = useCallback(function(answers: string[]) {
    if (!followup || !activeSessionId) return;
    // 计划审批卡(带 plan 字段):用户选「批准并执行」→ 切出 plan 模式,
    // 模型下一轮即可写。其余选择维持当前(只读)模式。
    if ((followup as any).plan && (answers[0] || "").trim() === "批准并执行") {
      setSessionPermissionMode(activeSessionId, "default");
    }
    window.api.respondFollowup?.(followup.callId, answers);
    setPendingFollowup(activeSessionId, null);
    setFollowupAnswers({});
    if (busyMapRef.current[activeSessionId]) useChatStore.getState().setGenerating(activeSessionId, Date.now(), 90000);
  }, [followup, activeSessionId, setPendingFollowup, setSessionPermissionMode]);

  // "Always allow this tool": persist auto-approval, then approve the call.
  var respondAlwaysAllow = useCallback(async function() {
    if (!approval || !activeSessionId) return;
    var permTool = approval.permTool;
    var callId = approval.callId;
    setPendingApproval(activeSessionId, null);
    if (busyMapRef.current[activeSessionId]) useChatStore.getState().setGenerating(activeSessionId, Date.now(), 90000);
    try { await window.api.setToolAuto?.(permTool, true); } catch (e) {}
    window.api.respondToolApproval?.(callId, true);
  }, [approval, activeSessionId, setPendingApproval]);

  // Core: run one agent turn for `text`. Resolves provider, appends the user
  // message, fires agent:send. Returns false if it couldn't start (caller queues).
  var runTurn = useCallback(async function(sessionId: string, text: string, images?: string[]): Promise<boolean> {
    // Resolve provider/model from the *target session* (not the active one) — a
    // queued/background turn must use that session's own model, not whatever is
    // currently selected in the UI.
    var sel = resolveSessionProvider(sessionId);
    var sessProvider = sel.provider;
    if (!sessProvider) {
      notifyError(tr("请先在「设置 → Providers」中配置并选择一个 AI 服务。", "Please configure and select an AI provider in Settings → Providers first."));
      return false;
    }
    var model = sel.model;
    if (!model) {
      notifyError(tr("当前 Provider 没有可用模型，请在设置中填写模型名。", "The current provider has no available model. Please add a model name in settings."));
      return false;
    }
    var resolved = await resolveProvider(sessProvider.id);
    if (!resolved || !resolved.apiKey) {
      notifyError(tr("当前 Provider 未配置 API Key，请在设置中填写。", "The current provider has no API key configured. Please add one in settings."));
      return false;
    }

    // Detect first message in this session (for auto-titling).
    // 「首条」以「有没有用户消息」为准，而非 messages.length===0——切换类命令
    //（/think、/auto 等）会经 addNotice 往会话里塞一条 role:"assistant" 的只读提示，
    // 若按总长度判断，这条提示会让真正的首条用户消息被误判为「非首条」，导致标题
    // 卡在 "New Chat" 不自动命名。只数用户消息即可绕过所有此类非用户注入。
    var sessBefore = useChatStore.getState().sessions.find(function(s: any) { return s.id === sessionId; });
    var isFirstMessage = !sessBefore || !sessBefore.messages.some(function(m: any) { return m.role === "user"; });

    addMessage(sessionId, {
      id: "msg-" + Date.now(), role: "user", content: text, timestamp: Date.now(),
      images: images && images.length ? images : undefined,
    });

    // Auto-title: instant fallback (truncated first message) + background AI title.
    if (isFirstMessage) {
      var fallback = text.replace(/\s+/g, " ").trim().slice(0, 24) || tr("新对话", "New chat");
      useChatStore.getState().renameSession(sessionId, fallback);
      generateSessionTitle(sessionId, text, resolved, model);
    }

    var sessForApi = useChatStore.getState().sessions.find(function(s: any) { return s.id === sessionId; });
    var allMsgs = (sessForApi && sessForApi.messages) || [];
    // 上下文压缩：若存在发送侧摘要，只发「摘要 + 摘要边界之后的消息」给 AI
    // （UI 完整对话不动）。边界消息 summaryUpTo 之前的历史用一条摘要代替。
    var summaryText = sessForApi && sessForApi.contextSummary;
    var msgsForApi = allMsgs;
    if (summaryText && sessForApi!.summaryUpTo) {
      var cut = allMsgs.findIndex(function(m: any) { return m.id === sessForApi!.summaryUpTo; });
      if (cut !== -1) msgsForApi = allMsgs.slice(cut + 1);
    }
    // 构建发往 API 的历史：跨轮回放工具调用与结果（buildReplayMessages），让模型
    // 记得自己做过的工具操作，避免重复读取与失忆。机制照搬 Claude Code（年龄淘汰 +
    // 清除占位 + 配对校验，不去重）。generate_image/capture_window 的本地图片路径已
    // 包含在各自工具结果的可读文本里（saved/Saved to），随回放自然带回，无需额外备注。
    var apiMessages: any[] = buildReplayMessages(msgsForApi);
    if (summaryText) {
      apiMessages = ([{ role: "system", content: "以下是先前对话的压缩摘要，作为上下文继续：\n\n" + summaryText }] as any[]).concat(apiMessages);
    }

    var runId = "run-" + Date.now() + "-" + (++runSeqRef.current);
    // 定格本轮实际模型/供应商，供 applyTurn 给消息盖章（历史不随之后切换变）。
    runStampRef.current[runId] = { modelName: model, providerName: sessProvider.name };
    setSessionBusy(sessionId, true);
    // 发出即转圈（紫），不等主进程 run-state：清掉上一轮的失败红叹号 / 完成灰勾
    // （新一轮开始旧角标不该残留，否则会和转圈同时出现、被误当成「转圈产生角标」）。
    // agent 轮次超时上限 90s（每个 turn 回传会刷新进度，故只有真静默才会到点）。
    useChatStore.getState().setSessionFailed(sessionId, false);
    useChatStore.getState().setSessionCompleted(sessionId, false);
    useChatStore.getState().setGenerating(sessionId, Date.now(), 90000);
    turnDoneRef.current[sessionId] = false;
    setIsProcessing(true);
    setAgentStatus("thinking");

    // Per-session permission mode (overrides global config in the backend).
    var sessState = useChatStore.getState().sessions.find(function(s: any) { return s.id === sessionId; });
    var sessMode = sessState?.permissionMode;
    // 纯聊天模式：透传给后端，禁用主动调查项目的系统提示引导。
    var sessChatMode = !!sessState?.chatMode;
    // 文字游戏模式（/game）：透传给后端启用 AI RPG 系统提示。
    var sessGameMode = !!sessState?.gameMode;
    // 推理强度（/effort）：透传给后端写入 reasoning_effort，端点不支持则忽略。
    var sessEffort = sessState?.effort;
    // 扩展思考（/think）：透传给后端在 Anthropic 请求体注入 thinking，端点不支持则忽略。
    var sessThinking = !!sessState?.thinkingMode;
    // Carry the current to-do roadmap so a resumed/continued turn knows where it
    // left off (tool history isn't replayed; without this the model forgets the
    // todos it set and stops updating them after an interruption).
    var sessTodos = sessState?.todos;
    window.api.agentSend({
      sessionId: sessionId,
      // 会话标题：仅用于传输日志按对话命名文件（CW_TRANSPORT_LOG 开启时），不影响请求。
      sessionTitle: (useChatStore.getState().sessions.find(function(s: any) { return s.id === sessionId; }) || {}).name || "",
      runId: runId,
      provider: resolved,
      model: model,
      messages: apiMessages,
      workingDir: projectPath,
      permissionMode: sessMode,
      chatMode: sessChatMode,
      gameMode: sessGameMode,
      effort: sessEffort,
      thinkingMode: sessThinking,
      todos: sessTodos,
      // Optional search backends (enabled kinds); keys resolved in main from secrets.
      search: { kinds: useSearchStore.getState().enabledKinds() },
      // 图片生成（generate_image）：从被标记为「图片生成」的供应商构建配置；
      // key 在主进程按 providerId 解密注入。没有图片供应商则为 undefined。
      imageGen: buildImageGenConfig(sessProvider.id),
    }).then(function(res: any) {
      // BUSY shouldn't happen here (we gate per-session), but stay safe.
      if (res && res.error && res.error !== "BUSY") {
        notifyError(tr("请求失败: ", "Request failed: ") + res.error);
        setSessionBusy(sessionId, false);
        setIsProcessing(false);
        setAgentStatus("idle");
      }
    }).catch(function(err: any) {
      setSessionBusy(sessionId, false);
      setIsProcessing(false);
      setAgentStatus("idle");
      notifyError(tr("请求失败: ", "Request failed: ") + (err?.message || String(err)));
    });
    return true;
  }, [resolveSessionProvider, projectPath, resolveProvider, notifyError, setSessionBusy]);

  // 直接出图：把输入当 prompt 出图（不经 agent loop）。追加用户消息 + 一条 assistant
  // 消息（图片直接显示在聊天气泡里，不再包成工具）。opts 指定供应商/模型/保存位置，
  // 缺省时用 buildImageGenConfig（上次成功优先）+ 项目目录。
  var runDirectImage = useCallback(async function(sessionId: string, text: string, opts?: { providerId?: string; model?: string; saveLocation?: string; customDir?: string }): Promise<boolean> {
    // Default to the target session's provider (per-session selection), not the
    // globally-selected one — matters when a background session triggers出图.
    var ig = buildImageGenConfig(opts?.providerId || resolveSessionProvider(sessionId).providerId);
    if (!ig) { notifyError(tr("当前图片供应商缺少 API Key 或模型，请在设置里补全。", "The current image provider is missing an API key or model. Please complete it in settings.")); return false; }
    if (opts?.model) ig.model = opts.model;
    var saveLocation = opts?.saveLocation || "project";
    var customDir = opts?.customDir || "";

    // 首条消息自动命名（同 runTurn：只数用户消息，不被 notice 干扰）。
    var sessBefore = useChatStore.getState().sessions.find(function(s: any) { return s.id === sessionId; });
    var isFirstMessage = !sessBefore || !sessBefore.messages.some(function(m: any) { return m.role === "user"; });
    addMessage(sessionId, { id: "msg-" + Date.now(), role: "user", content: text, timestamp: Date.now() });
    if (isFirstMessage) {
      var fallback = text.replace(/\s+/g, " ").trim().slice(0, 24) || tr("生成图片", "Generate image");
      useChatStore.getState().renameSession(sessionId, fallback);
    }

    // 一条 assistant 占位消息：出图后把图片直接挂到这条消息上，在聊天气泡里显示。
    // 盖上本次出图的供应商/模型名，历史显示锁定，不随之后切换变。
    var igProviderId = ig.providerId;
    var imgProvName = (useProviderStore.getState().providers.find(function(p) { return p.id === igProviderId; }) || {}).name;
    var aiMsgId = "imgmsg-" + Date.now() + "-" + (++runSeqRef.current);
    addMessage(sessionId, {
      id: aiMsgId, role: "assistant", content: tr("正在生成图片…", "Generating image…"), timestamp: Date.now(),
      modelName: ig.model, providerName: imgProvName,
    });

    setSessionBusy(sessionId, true);
    setIsProcessing(true);
    setAgentStatus("executing");
    // 转圈/失败角标也覆盖直接出图（此路径不经 agent loop、无 run-state 事件，
    // 故在这里手动驱动 generating / sessionFailed，与 agent 轮次表现一致）。
    useChatStore.getState().setSessionFailed(sessionId, false);
    useChatStore.getState().setSessionCompleted(sessionId, false);
    // 直接出图比 agent 轮次慢，超时上限放宽到 120s（颜色也按 120s 走完紫→红）。
    useChatStore.getState().setGenerating(sessionId, Date.now(), 120000);
    var igName = prettyModelName(ig.model, (selectedProvider as any)?.name);
    var imgFailed = false;
    try {
      var res = await (window.api as any).generateImage?.({ ...ig, prompts: [text], saveLocation: saveLocation, customDir: customDir, projectPath: projectPath });
      var paths = (res && res.ok && Array.isArray(res.results))
        ? res.results.filter(function(r: any) { return r.path; }).map(function(r: any) { return r.path; })
        : [];
      // 成功 → 记住本次图片供应商，作为 AI/下次默认。
      if (res && res.ok && paths.length) setLastImageProviderId(ig.providerId);
      // 成功文案：写成「模型可读的事实」（含保存路径），而非空字符串。原先成功时
      // content 置空、图片只挂在 images 字段，但回放/buildApiMessage 都不读 assistant
      // 的 images → 模型在历史里看不到「图已生成」，跨轮会重复调 generate_image、也
      // 无法引用刚出的图。这里留一条简短文字记录，既在气泡里正常显示（图片仍在下方），
      // 又让模型跨轮知道已出图及其路径；非空也不会被回放阶段 C 的「空 assistant 去噪」丢弃。
      var okText = res && res.ok && paths.length
        ? "已生成图片并保存到：\n" + paths.map(function(p: string) { return "- " + p; }).join("\n")
        : buildFailureNotice((res && res.error) || "未知错误", igName, { rawTail: false });
      if (!(res && res.ok && paths.length)) imgFailed = true;
      // 写回占位消息：成功则清空文字、挂上图片；失败则展示游戏梗失败文案。
      useChatStore.getState().updateMessage(sessionId, aiMsgId, {
        content: okText,
        images: paths.length ? paths : undefined,
      });
      if (!res || !res.ok) notifyError(tr("生成失败：", "Generation failed: ") + ((res && res.error) || tr("未知错误", "unknown error")));
    } catch (e: any) {
      imgFailed = true;
      useChatStore.getState().updateMessage(sessionId, aiMsgId, { content: buildFailureNotice(e?.message || String(e), igName, { rawTail: false }) });
      notifyError(tr("生成失败：", "Generation failed: ") + (e?.message || String(e)));
    } finally {
      setSessionBusy(sessionId, false);
      setIsProcessing(false);
      setAgentStatus("idle");
      useChatStore.getState().setGenerating(sessionId, null);
      if (imgFailed) useChatStore.getState().setSessionFailed(sessionId, true);
      // 成功出图 → 挂完成灰勾（与 agent 轮次一致；store 内对当前活动会话不点亮）。
      else useChatStore.getState().setSessionCompleted(sessionId, true);
    }
    return true;
  }, [selectedProviderId, selectedProvider, projectPath, addMessage, notifyError, setSessionBusy]);

  // 用户主动出图（选中图片供应商直接发消息）：不再弹设置卡，直接出图，默认存项目目录。
  // 用户没特别指定保存位置时就落在项目下，省去多一步确认。
  var maybeRunDirectImage = useCallback(function(sessionId: string, text: string) {
    runDirectImage(sessionId, text, { saveLocation: "project" });
  }, [runDirectImage]);

  // Pop the next queued message for THIS session (if it's idle) and run it.
  var drainQueue = useCallback(function(sessionId: string) {
    if (busyMapRef.current[sessionId]) return;
    var next = useChatStore.getState().dequeue(sessionId);
    if (next != null) {
      // 图片供应商 → 直接出图（沿用记忆/弹卡逻辑）；否则正常 agent 轮次（带排队的图片附件）。
      if (selectedProvider && (selectedProvider as any).imageGen) maybeRunDirectImage(sessionId, next.text);
      else runTurn(sessionId, next.text, next.images);
    }
  }, [runTurn, maybeRunDirectImage, selectedProvider]);

  // 压缩当前会话上下文：把整段对话交给模型生成结构化摘要，再用这条摘要替换
  // 历史消息（chat-store.compactSession）。后续 runTurn 拼历史时只带摘要+新消息，
  // 真正降低 token——对标 Claude Code 的 /compact，而非简单发一句"总结"提示词。
  var [compacting, setCompacting] = useState(false);
  var [showContext, setShowContext] = useState(false);
  var doCompact = useCallback(async function (forSessionId?: string, trigger?: "manual" | "auto") {
    var sessionId = forSessionId || activeSessionId;
    if (!sessionId) { notifyError(tr("没有可压缩的对话。", "No conversation to compact.")); return; }
    if (busyMapRef.current[sessionId]) { notifyError(tr("Agent 正在运行，请先停止再压缩。", "The agent is running. Please stop it before compacting.")); return; }
    // PreCompact hook：压缩前触发。命令退出码 2 / 返回 deny 可阻止本次压缩（纯渲染层
    // 生命周期，主进程经 hooks:run 执行）。projectPath 为空（未开项目）则跳过。
    if (projectPath) {
      try {
        var pc = await (window.api as any).hooksRun?.("PreCompact", {
          hook_event_name: "PreCompact",
          trigger: trigger || "manual",
          session_id: sessionId,
          cwd: projectPath,
        }, projectPath);
        if (pc && pc.block) {
          notifyError(tr("压缩被 PreCompact hook 阻止：", "Compaction blocked by a PreCompact hook: ") + (pc.reason || ""));
          return;
        }
      } catch { /* hook 不可用不影响压缩 */ }
    }
    var sess = useChatStore.getState().sessions.find(function (s: any) { return s.id === sessionId; });
    var msgs = (sess && sess.messages) || [];
    // 摘要输入要覆盖整段「工作记忆」，而不只是对话：
    //   - 用户/助手的文字对话；
    //   - 工具调用——读过/改过哪些文件、跑了什么命令、关键输出要点。
    // 这样压缩后保留的是「项目当前状态 + 已做改动 + 进展」，而非只剩闲聊。
    var convo: string[] = [];
    var userMsgs: string[] = []; // 单独收集所有用户原话，确保 #6 不被主轨迹截断影响。
    for (var mi = 0; mi < msgs.length; mi++) {
      var m: any = msgs[mi];
      if ((m.role === "user" || m.role === "assistant") && m.content && m.content.trim()) {
        convo.push((m.role === "user" ? "用户" : "助手") + ": " + m.content);
        if (m.role === "user") userMsgs.push("- " + m.content.replace(/\s+/g, " ").trim());
      } else if (m.role === "tool" && m.toolCall) {
        var tc = m.toolCall;
        var arg = tc.input ? (tc.input.file_path || tc.input.command || tc.input.pattern || tc.input.query || "") : "";
        var out = tc.output ? String(tc.output).slice(0, 1500) : "";
        convo.push("[工具 " + tc.name + (arg ? " " + arg : "") + "]" + (out ? " 结果: " + out : ""));
      }
    }
    if (convo.length < 2) { notifyError(tr("对话太短，无需压缩。", "The conversation is too short to compact.")); return; }
    // 主轨迹截断到 6 万字符；用户消息全集单独附在后面（同样设上限防极端长）。
    var traceText = convo.join("\n\n").slice(0, 60000);
    var userListText = userMsgs.join("\n").slice(0, 20000);
    if (!selectedProvider) { notifyError(tr("请先配置并选择一个 AI 服务。", "Please configure and select an AI provider first.")); return; }
    var model = selectedModel || selectedProvider.models[0];
    var resolved = await resolveProvider(selectedProvider.id);
    if (!resolved || !resolved.apiKey) { notifyError(tr("当前 Provider 未配置 API Key。", "The current provider has no API key configured.")); return; }

    setCompacting(true);
    try {
      var res = await (window as any).api?.chatSend?.({
        provider: resolved,
        model: model,
        messages: [
          { role: "system", content:
            "你的任务是把下面（在用户消息中给出）的编码助手工作轨迹——用户/助手对话，以及工具调用（读写文件、运行命令、搜索）的输入与结果——浓缩成一份详尽的结构化摘要，供后续对话无缝接续，不丢失关键上下文。\n\n" +
            "【贯穿全程的两条要求】\n" +
            "- 具体（specificity）：保留具体的文件名、函数名、命令、报错原文、代码片段，不要笼统概括。\n" +
            "- 忠实：只依据轨迹里实际出现过的内容来写。绝不推断、补全或编造未出现的信息（不要凭空写出没读过的文件内容、没确认过的技术栈或目录结构）。轨迹里没有的，就省略，不要猜。\n\n" +
            "请严格按以下编号小节输出（某节确无内容则写「无」，不要硬凑）：\n" +
            "1. 主要请求与意图（Primary Request and Intent）：完整捕捉用户的所有明确请求与意图。\n" +
            "2. 关键技术概念（Key Technical Concepts）：涉及的技术、框架、库、方法。\n" +
            "3. 相关文件与代码（Files and Code）：读过或改过的每个文件——为什么重要、做了什么改动，必要时附关键代码片段。\n" +
            "4. 报错与修复（Errors and Fixes）：出现过的错误、如何修复的，以及用户对此的反馈。\n" +
            "5. 问题解决（Problem Solving）：已解决的问题与正在进行的排查。\n" +
            "6. 所有用户消息（All User Messages）：**逐条列出用户发过的每一条非工具消息**（保留原话要点）。这对追踪用户的真实意图至关重要，不得概括省略。\n" +
            "7. 待办任务（Pending Tasks）：用户明确要求、尚未完成的任务。\n" +
            "8. 当前工作（Current Work）：在本次压缩这一刻，正在进行的具体工作——精确到文件与代码。\n" +
            "9. 下一步（Next Step，可选）：若有，说明下一步要做什么，且必须与「当前工作」直接衔接，不得引入偏离用户意图的新方向。\n\n" +
            "丢弃寒暄、冗长的原始命令输出、重复内容。用中文。\n" +
            "【输出格式】这份摘要只作为机器读取的上下文，不展示给人看。务必紧凑省 token：" +
            "不要用 markdown 修饰（不加 #、**、表格、代码围栏），不要空行，每个小节用「序号. 内容」单行或紧凑短句，能省则省。优先信息密度，不要排版美观。" },
          { role: "user", content:
            "=== 工作轨迹（对话 + 工具调用）===\n" + traceText +
            "\n\n=== 用户消息全集（用于第 6 小节，请逐条保留）===\n" + userListText },
        ],
      });
      var summary = (res && res.text ? String(res.text) : "").trim();
      if (!summary) { notifyError(tr("压缩失败：模型未返回摘要。", "Compaction failed: the model returned no summary.")); setCompacting(false); return; }
      // 估算压缩前/后 token：前=被压缩的整段工作轨迹（含工具调用轨迹，与喂给
      // 摘要器的 traceText 同源，避免漏算工具 token 导致「省下」偏低）；后=摘要。
      var beforeTok = estimateTokens(traceText);
      var afterTok = estimateTokens(summary);
      compactSession(sessionId, summary, { before: beforeTok, after: afterTok });
    } catch (e: any) {
      notifyError(tr("压缩失败：", "Compaction failed: ") + (e?.message || String(e)));
    }
    setCompacting(false);
  }, [activeSessionId, selectedProvider, selectedModel, resolveProvider, compactSession, notifyError, projectPath]);

  // 让长生命周期监听器始终拿到最新的 doCompact/runTurn（每次渲染同步 ref）。
  doCompactRef.current = doCompact;
  runTurnRef.current = runTurn;

  // 取光标前最近的 @token（用于文件提及）。返回 token 文本与起始下标，或 null。
  var activeAtToken = function (text: string, caret: number): { query: string; start: number } | null {
    var upto = text.slice(0, caret);
    var m = /(^|\s)@([^\s@]*)$/.exec(upto);
    if (!m) return null;
    var start = caret - m[2].length - 1; // @ 的位置
    return { query: m[2], start: start };
  };

  // 模糊匹配项目文件（子序列匹配 + 文件名优先），返回前 N 条相对路径。
  var matchFiles = function (query: string): string[] {
    var files = fileIndexRef.current;
    if (!files.length) return [];
    var q = query.toLowerCase();
    if (!q) return files.slice(0, 12);
    var scored: { p: string; s: number }[] = [];
    for (var i = 0; i < files.length && scored.length < 400; i++) {
      var p = files[i];
      var lp = p.toLowerCase();
      var base = lp.split("/").pop() || lp;
      var score = -1;
      if (base.indexOf(q) === 0) score = 100;            // 文件名前缀
      else if (base.indexOf(q) !== -1) score = 70;        // 文件名包含
      else if (lp.indexOf(q) !== -1) score = 40;          // 路径包含
      else if (subseq(lp, q)) score = 15;                 // 子序列
      if (score >= 0) scored.push({ p: p, s: score - p.length * 0.01 });
    }
    scored.sort(function (a, b) { return b.s - a.s; });
    return scored.slice(0, 12).map(function (x) { return x.p; });
  };

  // 输入变更统一入口：同时更新文本、斜杠候选、@ 文件候选。
  var updateInput = useCallback(function (next: string, caret?: number) {
    setInput(next);
    setSlashBrowse(false);   // 任何文本变更都退出「浏览模式」，交回输入驱动的过滤
    var items = filterSlash(next);
    // 按端点过滤互斥命令：Anthropic 原生协议支持 /think（扩展思考）、不支持 /effort
    // （推理强度）；其它端点反之。避免给用户看到当前端点用不了的命令。
    if (selectedProvider?.protocol === "anthropic") {
      items = items.filter(function (c) { return c.name !== "effort"; });
    } else {
      items = items.filter(function (c) { return c.name !== "think"; });
    }
    // /think 描述附加当前开关状态(已开启/关闭),让用户直观看到是开还是关再决定要不要切换。
    // 切换后不往对话流塞消息(否则空会话第一条消息变成"已开启扩展思考"导致命名异常)。
    items = items.map(function (c) {
      if (c.name === "think") {
        var isOn = activeSession?.thinkingMode;
        var stateZh = isOn ? "已开启" : "关闭";
        var stateEn = isOn ? "ON" : "OFF";
        return { ...c, description: c.description + " (当前: " + stateZh + ")", descriptionEn: (c.descriptionEn || c.description) + " (current: " + stateEn + ")" };
      }
      return c;
    });
    setSlashItems(items);
    setSlashIndex(0);
    // 用户开始打字 → 关闭推理强度二级面板（回到普通输入/命令过滤）。
    if (effortMenuOpen) setEffortMenuOpen(false);
    // @ 文件提及：仅在斜杠面板未开时检测。
    if (items.length === 0) {
      var c = typeof caret === "number" ? caret : next.length;
      var at = activeAtToken(next, c);
      if (at) { setAtItems(matchFiles(at.query)); setAtIndex(0); }
      else setAtItems([]);
    } else {
      setAtItems([]);
    }
    // setInput 依赖 activeSessionId（写当前会话的草稿）。必须列入依赖，否则切换
    // 会话后 updateInput 仍握着旧的 setInput，把输入写进上一个会话的草稿——表现
    // 为「只有某一个会话能打字，其他打不进去」。
  }, [selectedProvider, effortMenuOpen, setInput, activeSession?.thinkingMode]);

  // 选中一个 @ 文件：把光标处的 @token 替换为 @相对路径（后跟空格）。
  var pickAtFile = useCallback(function (relPath: string) {
    var el = inputRef.current;
    var caret = el ? (el.selectionStart || input.length) : input.length;
    var at = activeAtToken(input, caret);
    if (!at) { setAtItems([]); return; }
    var before = input.slice(0, at.start);
    var after = input.slice(caret);
    var inserted = "@" + relPath + " ";
    var nextText = before + inserted + after;
    setInput(nextText);
    setAtItems([]);
    setTimeout(function () {
      var e = inputRef.current;
      if (e) { var pos = (before + inserted).length; e.focus(); e.setSelectionRange(pos, pos); }
    }, 0);
  }, [input]);

  // 斜杠动作的上下文：复用 ChatView 已持有的 store 句柄。
  var slashCtx = useRef<SlashContext>({
    newSession: function () { handleNewSession(); },
    setPermissionMode: function (mode) { if (activeSessionId) setSessionPermissionMode(activeSessionId, mode as any); },
    setChatMode: function (on) {
      var sid = activeSessionId || createSession(selectedProvider?.name || "Agent", selectedModel || "", selectedProviderId);
      if (!activeSessionId) setActiveSession(sid);
      setSessionChatMode(sid, on);
    },
    setGameMode: function (on) {
      var sid = activeSessionId || createSession(selectedProvider?.name || "Agent", selectedModel || "", selectedProviderId);
      if (!activeSessionId) setActiveSession(sid);
      setSessionGameMode(sid, on);
    },
    openSettings: function (tab) { openConfig(tab); },
    notify: function (msg) { notifyError(msg); },
    compact: function () { return Promise.resolve(); },
    showContext: function () {},
    openEffortMenu: function () { return false; },
    toggleThinking: function () { return null; },
  });
  // 让 ctx 始终指向最新的闭包变量（activeSessionId 等会变）。
  slashCtx.current.setPermissionMode = function (mode) { if (activeSessionId) setSessionPermissionMode(activeSessionId, mode as any); };
  slashCtx.current.setChatMode = function (on) {
    var sid = activeSessionId || createSession(selectedProvider?.name || "Agent", selectedModel || "", selectedProviderId);
    if (!activeSessionId) setActiveSession(sid);
    setSessionChatMode(sid, on);
  };
  slashCtx.current.setGameMode = function (on) {
    var sid = activeSessionId || createSession(selectedProvider?.name || "Agent", selectedModel || "", selectedProviderId);
    if (!activeSessionId) setActiveSession(sid);
    setSessionGameMode(sid, on);
  };
  slashCtx.current.compact = function () { return doCompact(); };
  slashCtx.current.showContext = function () { setShowContext(true); };
  slashCtx.current.openEffortMenu = function () {
    // Anthropic 端点暂不适配推理强度 → 返回 false，由命令回退到提示。
    if (selectedProvider?.protocol === "anthropic") return false;
    var cur = activeSession?.effort || "";
    var idx = EFFORT_OPTIONS.findIndex(function (o) { return o.value === cur; });
    setEffortMenuIndex(idx < 0 ? 0 : idx);
    setSlashItems([]);       // 关掉一级命令列表
    setEffortMenuOpen(true); // 展开二级面板（覆盖其上）
    return true;
  };
  slashCtx.current.toggleThinking = function () {
    // 扩展思考仅 Anthropic 原生协议支持 → 其它端点返回 null，由命令回退到提示。
    if (selectedProvider?.protocol !== "anthropic") return null;
    var sid = activeSessionId || createSession(selectedProvider?.name || "Agent", selectedModel || "", selectedProviderId);
    if (!activeSessionId) setActiveSession(sid);
    var cur = useChatStore.getState().sessions.find(function (s: any) { return s.id === sid; });
    var next = !cur?.thinkingMode;
    setSessionThinking(sid, next);
    return next;
  };

  // 执行一个斜杠命令。action：跑客户端动作并清空/回填输入；prompt：展开为提示词发送。
  var runSlashCommand = useCallback(async function (cmd: SlashCommand, arg: string) {
    setSlashItems([]);
    if (cmd.kind === "action" && cmd.run) {
      var back = await cmd.run(slashCtx.current, arg);
      // 动作可返回要回填输入框的文本；否则清空。
      updateInput(typeof back === "string" ? back : "");
      if (inputRef.current) inputRef.current.style.height = "auto";
      return;
    }
    if (cmd.kind === "prompt" && cmd.buildPrompt) {
      var prompt = cmd.buildPrompt(arg);
      updateInput("");
      if (inputRef.current) inputRef.current.style.height = "auto";
      var sessionId = activeSessionId || createSession(selectedProvider?.name || "Agent", selectedModel || "", selectedProviderId);
      if (!activeSessionId) setActiveSession(sessionId);
      if (busyMapRef.current[sessionId]) { enqueue(sessionId, prompt); }
      else { runTurn(sessionId, prompt); }
    }
  }, [activeSessionId, selectedProvider, selectedModel, createSession, setActiveSession, enqueue, runTurn, updateInput]);

  // 浏览模式下执行动作类命令：跑动作但**不动**输入框（保留用户已输入文字）。
  var runSlashCommandKeepInput = useCallback(async function (cmd: SlashCommand) {
    setSlashItems([]);
    if (cmd.kind === "action" && cmd.run) {
      try { await cmd.run(slashCtx.current, ""); } catch (e) {}
    }
  }, []);

  // 二级面板选中一个推理强度档位：写入会话、关面板、清空输入。
  var pickEffort = useCallback(function (value: string) {
    var sid = activeSessionId || createSession(selectedProvider?.name || "Agent", selectedModel || "", selectedProviderId);
    if (!activeSessionId) setActiveSession(sid);
    setSessionEffort(sid, (value || undefined) as any);
    setEffortMenuOpen(false);
    updateInput("");
    if (inputRef.current) inputRef.current.style.height = "auto";
  }, [activeSessionId, selectedProvider, selectedModel, createSession, setActiveSession, setSessionEffort, updateInput]);

  // 从输入框选中候选项（点击或回车）：把命令补全到输入框；无参命令直接执行。
  var pickSlash = useCallback(function (cmd: SlashCommand) {
    // 浏览模式（输入框原本有用户文字）：选命令时绝不清空已有输入。
    //  - 有参命令(hint)：把 "/命令 " 前置到已有文字之前，让用户继续编辑。
    //  - 动作类命令：直接执行动作（如 /clear、/chat），但执行后保留用户输入。
    //  - prompt 类命令：在浏览模式下没有「带参展开」的语义，统一前置 "/命令 " 由用户决定。
    if (slashBrowse) {
      setSlashItems([]);
      setSlashBrowse(false);
      if (cmd.kind === "action" && cmd.run) {
        runSlashCommandKeepInput(cmd);
      } else {
        var draft = input || "";
        updateInput("/" + cmd.name + " " + draft);
        setTimeout(function () { var e = inputRef.current; if (e) { e.focus(); var pos = ("/" + cmd.name + " ").length; e.setSelectionRange(pos, pos); } }, 0);
      }
      return;
    }
    // 需要参数的命令（有 hint）→ 补全为 "/name " 等用户继续输入；否则直接执行。
    if (cmd.hint) {
      updateInput("/" + cmd.name + " ");
      setSlashItems([]); // 已带空格，关面板
      setTimeout(function () { inputRef.current?.focus(); }, 0);
    } else {
      runSlashCommand(cmd, "");
    }
  }, [updateInput, runSlashCommand, runSlashCommandKeepInput, slashBrowse, input]);

  var handleSend = useCallback(async function() {
    // 斜杠命令：输入以 "/" 开头且匹配到命令 → 走命令执行，不当普通消息发送。
    var slash = parseSlash(input.trim());
    if (slash) {
      var cmd = findSlash(slash.name);
      if (cmd) { runSlashCommand(cmd, slash.arg); return; }
    }
    var text = input.trim();
    // 图片附件 → vision images；其它文件 → 把绝对路径作为文本引用拼进消息（AI 可 read_file）。
    var imgs = attachments.filter(function(a) { return a.kind === "image"; }).map(function(a) { return a.path; });
    var fileRefs = attachments.filter(function(a) { return a.kind === "file"; }).map(function(a) { return a.path; });
    // 允许「只发附件」：有任意附件时即使无文字也可发送。
    if (!text && imgs.length === 0 && fileRefs.length === 0) return;
    if (!selectedProvider) {
      notifyError(tr("请先在「设置 → Providers」中配置并选择一个 AI 服务。", "Please configure and select an AI provider in Settings → Providers first."));
      return;
    }
    var sessionId = activeSessionId || createSession(selectedProvider?.name || "Agent", selectedModel || "", selectedProviderId);
    if (!activeSessionId) setActiveSession(sessionId);
    setInput("");
    if (inputRef.current) inputRef.current.style.height = "auto"; // 发送后复位高度

    // 文件路径拼到消息文本末尾（AI 看到绝对路径，可用 read_file 读取）。
    var sendText = text;
    if (fileRefs.length > 0) {
      sendText = (text ? text + "\n\n" : "") + "[附加文件]\n" + fileRefs.join("\n");
    }

    // 选中的供应商是「图片生成」供应商 → 直接出图（把输入当 prompt），不经 agent loop。
    if ((selectedProvider as any).imageGen) {
      if (!text) { notifyError(tr("请输入图片描述。", "Please enter an image description.")); setInput(text); return; }
      if (busyMapRef.current[sessionId]) { enqueue(sessionId, text); }
      else { maybeRunDirectImage(sessionId, text); }
      return;
    }

    // busy 时入队（FIFO，当前任务结束后自动跑）。带图片附件的消息也能排队：把图片
    // 路径一并存进队列项，附件随该条排队消息一起发出，不再因 busy 被拒绝。
    if (busyMapRef.current[sessionId]) {
      enqueue(sessionId, sendText, imgs);
      setAttachments([]); // 附件已进队列，清空托盘
    } else {
      setAttachments([]); // 清空托盘（附件随本条消息发出）
      runTurn(sessionId, sendText, imgs);
    }
  }, [input, attachments, activeSessionId, selectedProvider, selectedModel, runTurn, maybeRunDirectImage, enqueue, notifyError]);

  var handleStop = useCallback(function() {
    if (!activeSessionId) return;
    var sid = activeSessionId;
    clearErrorWatchdog(sid);
    // 用户主动停止视为正常收尾，不标红失败：置 turnDone，清转圈角标。
    turnDoneRef.current[sid] = true;
    useChatStore.getState().setGenerating(sid, null);
    window.api.agentStop?.(sid);
    // Optimistically clear busy; the backend will also send a terminal turn.
    setSessionBusy(sid, false);
    setAgentStatus("idle");
    // 终止后不清空排队消息——把它们当作「下一轮要发给 AI 的内容」继续派发。
    // 等后端 loop 真正收尾（run-state=false）后再 drain，避免与正在关闭的 loop 抢跑；
    // 这里用一次性延迟兜底（若 run-state 已先到则 drainQueue 自身的 busy 守卫会防重入）。
    var hasQueued = (useChatStore.getState().queues[sid] || []).length > 0;
    if (hasQueued) {
      setTimeout(function() { drainQueue(sid); }, 120);
    }
  }, [activeSessionId, setSessionBusy, clearErrorWatchdog, drainQueue]);

  // Resend a user message: drop it and everything after, then run it again.
  var handleResend = useCallback(function(sessionId: string, msg: ChatMessage) {
    if (busyMapRef.current[sessionId]) { notifyError(tr("Agent 正在运行，请先停止当前任务。", "The agent is running. Please stop the current task first.")); return; }
    var text = msg.content;
    // truncateAfter drops this message and everything after it (slice(0, idx));
    // runTurn then re-appends the user message and runs a fresh turn.
    truncateAfter(sessionId, msg.id);
    runTurn(sessionId, text);
  }, [truncateAfter, runTurn, notifyError]);

  var handleDeleteMessage = useCallback(function(sessionId: string, msgId: string) {
    deleteMessage(sessionId, msgId);
  }, [deleteMessage]);

  var handleKeyDown = function(e: React.KeyboardEvent) {
    // @ 文件提及面板打开时，方向键/Enter/Tab/Esc 由其优先处理。
    if (atOpen) {
      if (e.key === "ArrowDown") { e.preventDefault(); setAtIndex(function (i) { return (i + 1) % atItems.length; }); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setAtIndex(function (i) { return (i - 1 + atItems.length) % atItems.length; }); return; }
      if (e.key === "Escape") { e.preventDefault(); setAtItems([]); return; }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        var f = atItems[Math.min(atIndex, atItems.length - 1)];
        if (f) pickAtFile(f);
        return;
      }
    }
    // 推理强度二级面板打开时，优先于一切：上下选档、Enter 确认、Esc 返回命令列表。
    if (effortMenuOpen) {
      if (e.key === "ArrowDown") { e.preventDefault(); setEffortMenuIndex(function (i) { return (i + 1) % EFFORT_OPTIONS.length; }); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setEffortMenuIndex(function (i) { return (i - 1 + EFFORT_OPTIONS.length) % EFFORT_OPTIONS.length; }); return; }
      if (e.key === "Escape") { e.preventDefault(); setEffortMenuOpen(false); updateInput("/"); return; }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        var opt = EFFORT_OPTIONS[Math.min(effortMenuIndex, EFFORT_OPTIONS.length - 1)];
        if (opt) pickEffort(opt.value);
        return;
      }
      // 吞掉其余可见字符键，避免在二级面板打开时往输入框打字（放行复制等组合键）。
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) { e.preventDefault(); }
      return;
    }
    // 斜杠面板打开时，方向键/Enter/Tab/Esc 由面板优先处理。
    if (slashItems.length > 0) {
      if (e.key === "ArrowDown") { e.preventDefault(); setSlashIndex(function (i) { return (i + 1) % slashItems.length; }); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setSlashIndex(function (i) { return (i - 1 + slashItems.length) % slashItems.length; }); return; }
      if (e.key === "Escape") { e.preventDefault(); setSlashItems([]); return; }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        var cmd = slashItems[Math.min(slashIndex, slashItems.length - 1)];
        if (cmd) pickSlash(cmd);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // 输入框随内容增高，最多 4 行（约 96px），超出则内部滚动。
  var autoGrow = function(el: HTMLTextAreaElement) {
    el.style.height = "auto";
    var cap = useAppStore.getState().miniMode ? 200 : 96;
    el.style.height = Math.min(el.scrollHeight, cap) + "px";
  };

  // useCallback + 函数式 setState：引用恒定，不随每次输入重渲染而变，配合下面
  // useMemo 的消息列表与 React.memo 的 AgentMessage 一起，让打字不再重渲染整列表。
  var toggleTool = useCallback(function(id: string) {
    setExpandedTools(function(prev) {
      var next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  // 工具组展开/收拢：写入手动覆盖（按当前生效态取反）。groupId=该组首条工具消息 id。
  var toggleToolGroup = useCallback(function(groupId: string, currentlyCollapsed: boolean) {
    setToolGroupOverride(function(prev) {
      var next = Object.assign({}, prev);
      next[groupId] = !currentlyCollapsed;
      return next;
    });
  }, []);

  var handleNewSession = function() {
    // Use the currently selected provider/model — never hardcode a vendor.
    createSession(selectedProvider?.name || "Agent", selectedModel || "", selectedProviderId);
  };

  // 消息列表 useMemo：性能关键。此前每次按键 setInput 都会让 ChatView 整体重渲染，
  // 连带把整段 activeSession.messages.map(...) 重新执行、所有 AgentMessage 重新
  // reconcile——对话越长越卡。这里把列表渲染结果缓存起来，依赖里**不含 input**，
  // 所以打字时返回的元素数组引用不变，React 直接跳过整列表子树。仅在消息、展开态、
  // 用量、模型/服务商真正变化时才重算。AgentMessage 另用 React.memo 双保险。
  //
  // 连续的工具调用聚合成一个可收拢的 ToolGroup：默认展开，直到本轮产生文字消息后
  // 自动收拢（收拢态显示「已调用 X、Y，包含图片 N 张」）。用户点箭头可手动展开/收拢。
  var messageList = useMemo(function() {
    if (!activeSession) return null;
    var msgs = activeSession.messages;

    // 渲染单条「非工具」消息（user/assistant/divider/notice）。用函数参数承接 msg/idx，
    // 闭包捕获的是参数而非外层 while 的循环变量，避免「回调都指向最后一条」的经典 bug。
    function renderSingle(msg: any, idx: number) {
      // 头部只在「一轮」AI 输出的第一条显示：上次用户发言之后的首条非 user 消息。
      var showHeader = false;
      if (msg.role !== "user") {
        showHeader = (idx === 0) || (msgs[idx - 1].role === "user");
      }
      // 时间戳只在本轮最后一条 AI/工具消息显示：下一条是 user，或没有下一条。
      var nextMsg = msgs[idx + 1];
      var showFooter = msg.role !== "user" && (!nextMsg || nextMsg.role === "user");
      var topGap: string;
      if (idx === 0) topGap = "";
      else if (msg.role === "user" || showHeader) topGap = "mt-6";
      else topGap = "mt-4";
      // 该轮最后一条 AI 消息底部显示上一轮 token 用量（hover 才显示）。
      var usageText = "";
      if (showFooter && msg.role !== "user" && activeSessionId && sessionUsage[activeSessionId]) {
        var u = sessionUsage[activeSessionId];
        var tilde = u.estimated ? "~" : "";
        usageText = tilde + (u.promptTokens + u.completionTokens).toLocaleString() + tt(" tokens（输入 ", " tokens (in ") +
          u.promptTokens.toLocaleString() + tt(" · 输出 ", " · out ") + u.completionTokens.toLocaleString() + (u.estimated ? tt(" · 估算", " · est.") : "") + tt("）", ")");
        var ctx = u.contextTokens || 0;
        if (ctx >= CONTEXT_SOFT_THRESHOLD && ctx < CONTEXT_AUTO_THRESHOLD) {
          usageText += tt(" · 上下文 ", " · context ") + tilde + Math.round(ctx / 1000) + tt("k，接近 ", "k, near ") +
            Math.round(CONTEXT_AUTO_THRESHOLD / 1000) + tt("k 将自动压缩，可手动 /compact", "k auto-compaction, you can run /compact manually");
        }
      }
      return <AgentMessage key={msg.id} message={msg}
        modelName={msg.modelName || selectedModel || activeSession!.model}
        providerName={msg.providerName || selectedProvider?.name}
        showHeader={showHeader}
        showFooter={showFooter}
        usageText={usageText}
        topGap={topGap}
        expanded={expandedTools.has(msg.id)}
        onToggle={function() { toggleTool(msg.id); }}
        onResend={function() { handleResend(activeSession!.id, msg); }}
        onDelete={function() { handleDeleteMessage(activeSession!.id, msg.id); }} />;
    }

    var out: any[] = [];
    var i = 0;
    // 「纯数据载体 / 工具轮锚点」assistant:为承载本轮思考原始数据(thinking/reasoning_content)
    // 或为锚定本轮工具气泡而合成的空消息(content 空、无 tool_calls、无 images)。它只为跨轮
    // 回传保真 / 防止连续纯工具轮被贪婪合并而存在,不应在 UI 出现。渲染分组时直接跳过(不渲染)。
    // 注:它只影响 UI 渲染,buildReplayMessages 读的是 store 原始 messages,回传数据不受影响。
    // 放宽点:此前仅跳过「带思考的空 assistant」,但工具轮锚点可能无思考(模型只回工具、无文字
    // 无思考),那种空壳同样是载体——故只要「空 content + 无 toolCall + 无 images」即视为载体跳过,
    // 与 buildReplayMessages 阶段 C「空文本无 tool_calls 的 assistant 当噪音丢弃」口径一致。
    function isMetaCarrier(m: any): boolean {
      return m && m.role === "assistant" && !m.toolCall
        && !(m.content && String(m.content).trim())
        && !(m.images && m.images.length);
    }
    // 思考气泡(__thinking__):提为正文样式独立渲染,不进 ToolGroup。它天然把工具组按
    // 思考/正文边界分块(思考 → 工具组 → 思考 → 工具组 → 回答),符合阅读直觉。
    function isThinking(m: any): boolean {
      return m && m.role === "tool" && m.toolCall && m.toolCall.name === "__thinking__";
    }
    while (i < msgs.length) {
      var msg = msgs[i];
      // 纯数据载体:直接跳过,不渲染。
      if (isMetaCarrier(msg)) { i++; continue; }
      // 思考气泡:正文样式独立渲染(淡色、始终展开),不参与工具聚合。
      if (isThinking(msg)) {
        out.push(renderSingle(msg, i));
        i++;
        continue;
      }
      // 连续工具消息 → 聚合成一个 ToolGroup。思考气泡/载体/正文都会自然中断聚合,
      // 工具组因此按思考/正文边界自然分块(不再强行穿透合并)。
      if (msg.role === "tool" && msg.toolCall) {
        var start = i;
        var group: any[] = [];
        while (i < msgs.length && msgs[i].role === "tool" && msgs[i].toolCall && !isThinking(msgs[i])) {
          group.push(msgs[i]);
          i++;
        }
        var groupId = group[0].id;
        var gShowHeader = (start === 0) || (msgs[start - 1].role === "user");
        var gTopGap = (start === 0) ? "" : (gShowHeader ? "mt-6" : "mt-4");
        // 默认折叠态：组后已有后续消息（文字回复/用户消息/思考）→ 已结束 → 默认收拢；
        // 组在队尾（工具仍在执行）→ 默认展开。用户手动覆盖优先。
        var hasFollowing = i < msgs.length;
        var override = toolGroupOverride[groupId];
        var collapsed = (override !== undefined) ? override : hasFollowing;
        out.push(
          <ToolGroup key={"tg-" + groupId}
            groupId={groupId}
            messages={group}
            modelName={group[0].modelName || selectedModel || activeSession!.model}
            providerName={group[0].providerName || selectedProvider?.name}
            showHeader={gShowHeader}
            topGap={gTopGap}
            collapsed={collapsed}
            onToggleCollapse={toggleToolGroup}
            expandedToolIds={expandedTools}
            onToggleTool={toggleTool}
            sessionId={activeSession!.id}
            onResend={handleResend}
            onDelete={handleDeleteMessage}
          />
        );
        continue;
      }
      out.push(renderSingle(msg, i));
      i++;
    }
    return out;
  }, [activeSession, activeSessionId, expandedTools, toolGroupOverride, sessionUsage, selectedModel, selectedProvider, toggleTool, toggleToolGroup, handleResend, handleDeleteMessage, tt]);

  if (!projectPath) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
        <p>Open a project to start the agent</p>
      </div>
    );
  }

  return (
    <div className="h-full flex relative">
      {/* Agent chat area + Artifact panel */}
      <div className="flex-1 flex min-w-0">
        <div className="flex-1 flex flex-col min-w-0 relative">
        {/* 次级栏（历史/新建/回滚 + todo 路线图）已上移到全局 SecondaryBar。 */}

        {/* 顶部提示条（仅无活动会话时的兜底；中性灰，不再用红框）。有会话时提示走对话流内联灰字。 */}
        {errorMsg && (
          <div className="mt-[104px] flex items-center gap-2 px-4 py-2 bg-muted/60 border-b border-border text-muted-foreground text-xs">
            <AlertCircle size={13} />
            <span className="flex-1">{errorMsg}</span>
            <button onClick={function() { setErrorMsg(null); }} className="text-muted-foreground/70 hover:text-foreground">×</button>
          </div>
        )}

        {/* 小窗模式：右上角浮一个「还原大窗」按钮（hover 加深）。右键菜单挂在下方空白区。 */}
        {miniMode && (
          <div className="absolute top-0 right-0 z-40 p-1.5">
            <button
              onClick={function() { setMiniMode(false); }}
              title={tt("展开为主窗口", "Expand to main window")}
              className="p-1 rounded-md bg-card/85 backdrop-blur border border-border text-muted-foreground hover:text-foreground shadow-md shadow-black/10 opacity-40 hover:opacity-100 transition-opacity">
              <Maximize2 size={12} />
            </button>
          </div>
        )}

        {/* Messages — 顶部留白清开悬浮的统一面板；底部留白等于悬浮输入区高度，让最后一条
            消息停在输入框上方，同时滚动内容可从输入区四周透明留白处穿过透出。
            小窗模式：用原版消息流（图片等都正常显示），仅去掉顶部留白（小窗无悬浮面板），
            15s 闲置时整块淡出隐藏只剩输入框。 */}
        <div ref={scrollContainerRef} onScroll={onMessagesScroll} onWheel={onMessagesWheel}
          {...{ "data-mini-dragzone": "" }}
          onMouseDown={miniMode ? onMiniBgMouseDown : undefined}
          onContextMenu={miniMode ? function(e: any) {
            // 小窗空白处右键：还原 / 重置位置 / 关闭。落在内容上不弹（走原生）。
            if (!isMiniBlankTarget(e)) return;
            inputMenu.openMenu(e, [
              { label: tt("还原窗口", "Restore window"), icon: <Maximize2 size={13} />, onClick: function() { setMiniMode(false); } },
              { label: tt("重置位置", "Reset position"), icon: <Crosshair size={13} />, onClick: function() { try { (window.api as any).resetWindowPosition(); } catch (er) {} } },
              { label: tt("关闭窗口", "Close window"), icon: <X size={13} />, danger: true, separatorBefore: true, onClick: function() { try { (window.api as any).close(); } catch (er) {} } },
            ]);
          } : undefined}
          onDoubleClick={function(e: any) {
            // 空白处双击切换大/小窗（空白判定与拖动一致）。点在文字/按钮/图片等内容上不切换。
            if (!isMiniBlankTarget(e)) return;
            try { var s = window.getSelection(); if (s) s.removeAllRanges(); } catch (er) {}
            if (miniMode) setMiniMode(false);
            else { useAppStore.getState().setActiveView("chat"); setMiniMode(true); }
          }}
          style={{ paddingBottom: inputAreaHeight }}
          className={cn("flex-1 overflow-y-auto overflow-x-hidden",
            miniMode ? "pt-3" : "pt-[104px]")}>
          {(!activeSession || activeSession.messages.length === 0) ? (
            <div className="h-full flex items-center justify-center">
              <div className="text-center space-y-4 max-w-md px-4">
                <div className="flex justify-center">
                  <ProviderIcon model={selectedModel} name={selectedProvider?.name} size={48} />
                </div>
                <h2 className="text-lg font-semibold text-foreground">
                  {displayModelName(selectedModel, selectedProvider?.name)} {pickReadyPhrase(activeSession?.id)}
                </h2>
                <p className="text-sm text-muted-foreground">
                  I can read and write files, run commands, search the web, and more.
                  What would you like me to do?
                </p>
                <div className="grid grid-cols-2 gap-2 mt-2">
                  {[
                    "Make an Unreal Engine plugin",
                    "Explain this project's structure",
                    "Help me set up an MCP server",
                    "How does this app's prompt cache work?",
                  ].map(function(suggestion) {
                    return (
                      <button key={suggestion} onClick={function() { setInput(suggestion); inputRef.current?.focus(); }}
                        className="text-xs px-3 py-2 rounded-lg border border-border hover:bg-accent text-left text-muted-foreground hover:text-foreground transition-colors">
                        {suggestion}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : (
            <div {...{ "data-mini-dragzone": "" }} className="max-w-3xl mx-auto px-4 py-6" style={{ fontSize: "var(--chat-font-size)", fontFamily: "var(--chat-font-family)" }}>
              {messageList}
              {busy && !followup && (
                <div className="flex items-center gap-2 text-muted-foreground text-xs px-2 py-1">
                  <Loader2 size={12} className="animate-spin" />
                  <span>
                    {displayModelName(selectedModel || activeSession?.model, selectedProvider?.name) +
                      (agentStatus === "thinking" || agentStatus === "responding"
                        ? " " + (thinkingPhrase || (agentStatus === "thinking" ? tt("正在思考…", "Thinking…") : tt("正在回复…", "Replying…")))
                        : " " + tt("正在工作…", "Working…"))}
                  </span>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* 跳到底部：用户向上离开底部时浮现，点击瞬时回到最新。悬浮在输入框上方居中。
            用 animate-fade-opacity（只淡透明度，不动 transform）避免覆盖 -translate-x-1/2
            导致出现瞬间左右跳。 */}
        {/* 跳到底部：用户向上离开底部时浮现，点击瞬时回到最新。
            居中改用「全宽 flex 容器居中」而非按钮自身 -translate-x-1/2——后者占用 transform
            属性，点击/聚焦的 active 态会把它重置成 0，导致按钮瞬间窜到左边。容器居中后
            按钮无需任何 transform，彻底避免左右跳。 */}
        {showJumpBottom && activeSession && activeSession.messages.length > 0 && (
          <div style={{ bottom: inputAreaHeight + 12 }}
            className="absolute left-0 right-0 z-20 flex justify-center pointer-events-none">
            <button onClick={jumpToBottom} title={tt("跳到底部", "Jump to bottom")}
              className="pointer-events-auto flex items-center justify-center w-9 h-9 rounded-full cw-mica border border-border shadow-lg shadow-black/10 text-muted-foreground hover:text-foreground transition-colors animate-fade-opacity">
              <ChevronDown size={18} />
            </button>
          </div>
        )}

        {/* Input area. When the agent needs the user (followup / approval), the
            interactive card REPLACES the composer so the user can't type and
            answer at the same time (avoids confusion).
            悬浮在消息区底部（绝对定位）：四周留白透明，聊天内容可滚到其背后透出；
            composer 本体保持不透明。消息容器已按 inputAreaHeight 预留底部内距。
            小窗闲置时只淡出消息流，输入框留在底部不动。 */}
        <div ref={inputAreaRef} className="absolute bottom-0 left-0 right-0 z-10 px-3 pb-3 pt-1 bg-transparent pointer-events-none">
          <div className="max-w-3xl mx-auto pointer-events-auto">
            {followup ? (
              <div className="space-y-2">
                {(followup as any).plan && (
                  <div className="rounded-2xl border border-border bg-card px-5 py-4 shadow-lg shadow-black/5 animate-slide-up relative overflow-hidden">
                    <span className="absolute left-0 top-0 bottom-0 w-0.5 bg-accent-brand" />
                    <div className="flex items-center gap-2 mb-2">
                      <Command size={13} className="text-accent-brand" />
                      <span className="text-[11px] text-muted-foreground font-medium">{tt("实施计划 · 待批准", "Implementation plan · pending approval")}</span>
                    </div>
                    <div className="max-h-[40vh] overflow-y-auto text-sm">
                      <PlanMarkdown plan={(followup as any).plan} />
                    </div>
                  </div>
                )}
                <FollowupCard
                  questions={followup.questions}
                  answers={followupAnswers}
                  setAnswers={setFollowupAnswers}
                  onSubmit={function() {
                    var arr = followup!.questions.map(function(_q: any, i: number) { return (followupAnswers[i] || "").trim(); });
                    submitFollowup(arr);
                  }}
                  onSkip={function() { submitFollowup(followup!.questions.map(function() { return ""; })); }}
                />
              </div>
            ) : approval ? (
              <div className="rounded-2xl border border-border bg-card px-4 py-3 space-y-2 shadow-lg shadow-black/5 relative overflow-hidden animate-slide-up">
                <div className="flex items-center gap-2">
                  <AlertTriangle size={13} className="text-yellow-500" />
                  <span className="text-[10px] text-muted-foreground font-medium">{tt("需要授权", "Approval required")}</span>
                </div>
                <p className="text-sm text-foreground/90">
                  {tt("允许执行", "Allow")} <span className="font-mono text-foreground">{approval.tool}</span>
                  <span className="text-muted-foreground"> （{approval.permTool}）</span>？
                </p>
                {/* 参数用统一的 CodeBlock 渲染（与聊天/工具代码块同款）。 */}
                <div className="max-h-48 overflow-y-auto">
                  {(approval.tool === "run_command" || approval.tool === "Bash" || approval.tool === "monitor") ? (
                    <CodeBlock language="bash" value={String(approval.input?.command || "")} />
                  ) : (approval.tool === "write_file" || approval.tool === "Write") ? (
                    <CodeBlock
                      language={detectLang(approval.input?.file_path || "")}
                      value={(approval.input?.file_path || "") + "\n\n" + (approval.input?.content || "")}
                    />
                  ) : (approval.tool === "edit_file" || approval.tool === "Edit") ? (
                    <DiffBlock value={(approval.input?.file_path || "") + "\n" +
                      editToDiffLines(approval.input?.old_string, approval.input?.new_string)} />
                  ) : approval.tool === "apply_diff" ? (
                    <DiffBlock value={String(approval.input?.diff || "")} />
                  ) : (approval.tool === "multi_edit" || approval.tool === "MultiEdit") ? (
                    <DiffBlock value={(Array.isArray(approval.input?.edits) ? approval.input.edits : [])
                      .map(function(e: any, i: number) { return "@@ " + tt("编辑", "Edit") + " " + (i + 1) + " @@\n" + editToDiffLines(e?.old_string, e?.new_string); })
                      .join("\n")} />
                  ) : (
                    <CodeBlock language="json" value={JSON.stringify(approval.input, null, 2)} />
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2 pt-0.5">
                  <button onClick={function() { respondApproval(true); }}
                    className="px-3 py-1.5 text-xs rounded-lg bg-foreground text-background font-medium hover:opacity-90 transition-opacity">
                    {tt("批准执行", "Approve")}
                  </button>
                  <button onClick={function() { respondApproval(false); }}
                    className="px-3 py-1.5 text-xs rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-accent/40 transition-colors">
                    {tt("拒绝", "Reject")}
                  </button>
                  <button onClick={respondAlwaysAllow}
                    className="px-3 py-1.5 text-xs rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-accent/40 transition-colors"
                    title={tt("以后自动批准 ", "Auto-approve ") + approval.permTool + tt(" 类工具", " tools from now on")}>
                    {tt("总是允许 ", "Always allow ")}{approval.permTool}
                  </button>
                </div>
              </div>
            ) : (
              <>
                {/* Queued messages (Roo-Code style): typed while busy, run FIFO. */}
                {activeSessionId && (queues[activeSessionId]?.length ?? 0) > 0 && (
                  <div className="mb-2 space-y-1">
                    {queues[activeSessionId].map(function(q: { text: string; images?: string[] }, i: number) {
                      return (
                        <div key={i} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-muted/60 border border-border text-xs text-muted-foreground">
                          <Clock size={12} className="shrink-0" />
                          {q.images && q.images.length > 0 && (
                            <span className="shrink-0 flex items-center gap-0.5 text-[10px] text-muted-foreground/70">
                              <ImageIcon size={11} />{q.images.length}
                            </span>
                          )}
                          <span className="flex-1 truncate">{q.text || (q.images && q.images.length ? tt("（图片）", "(image)") : "")}</span>
                          <span className="text-[10px] text-muted-foreground/60">{tt("排队中", "Queued")}</span>
                          <button
                            onClick={function() { removeQueued(activeSessionId!, i); }}
                            className="shrink-0 w-4 h-4 flex items-center justify-center rounded hover:bg-destructive/20 hover:text-destructive"
                            title={tt("移除", "Remove")}
                          >×</button>
                        </div>
                      );
                    })}
                  </div>
                )}
                {/* 斜杠命令面板（输入 "/" 触发，悬浮在输入框上方）。 */}
                {slashOpen && (
                  <SlashPalette
                    items={slashItems}
                    activeIndex={slashIndex}
                    onHover={setSlashIndex}
                    onPick={pickSlash}
                    effortMenu={effortMenuOpen ? {
                      current: activeSession?.effort || "",
                      activeIndex: effortMenuIndex,
                      onHover: setEffortMenuIndex,
                      onPick: pickEffort,
                    } : null}
                  />
                )}
                {/* @ 文件提及面板（输入 "@" 触发）。选中插入 @相对路径，agent 用 read_file 读取。 */}
                {atOpen && (
                  <AtFilePalette items={atItems} activeIndex={atIndex} onHover={setAtIndex} onPick={pickAtFile} />
                )}
                {/* 压缩进行中的瞬时状态（仅压缩时显示，不常驻）。 */}
                {compacting && (
                  <div className="flex items-center gap-1.5 px-2 mb-1.5 text-[10px] text-muted-foreground">
                    <Loader2 size={11} className="animate-spin" /> {tt("正在压缩上下文…", "Compacting context…")}
                  </div>
                )}
                {/* Floating composer: input + controls in one elevated card. 支持拖拽文件。 */}
                <div
                  onDragOver={function(e: any) { e.preventDefault(); if (!dragging) setDragging(true); }}
                  onDragLeave={function(e: any) {
                    // 仅当离开 composer 整体（而非子元素间移动）才取消高亮。
                    if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget)) setDragging(false);
                  }}
                  onDrop={function(e: any) {
                    e.preventDefault();
                    setDragging(false);
                    var files = e.dataTransfer && e.dataTransfer.files;
                    if (files) for (var i = 0; i < files.length; i++) addFile(files[i]);
                  }}
                  className={cn(
                    "bg-card border rounded-2xl shadow-lg shadow-black/5 px-4 pt-3 pb-2 transition-all",
                    dragging ? "border-accent-brand border-dashed ring-2 ring-accent-brand/30" : "border-border focus-within:border-ring/60 focus-within:shadow-xl"
                  )}>
                  {dragging && (
                    <div className="flex items-center gap-1.5 mb-2 text-[11px] text-accent-brand">
                      <Paperclip size={12} /> {tt("松手添加文件（图片可预览，其它文件以路径发送给 AI）", "Drop to add files (images preview; other files are sent to the AI by path)")}
                    </div>
                  )}
                  {/* 附件条（待发送）：图片显示缩略图，其它文件显示图标+文件名。 */}
                  {attachments.length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-2">
                      {attachments.map(function(a) {
                        if (a.kind === "image") {
                          return (
                            <div key={a.id} className="relative group/att w-14 h-14 rounded-lg overflow-hidden border border-border">
                              <img src={a.dataUrl} alt="" className="w-full h-full object-cover" />
                              <button onClick={function() { removeAttachment(a.id); }}
                                title={tt("移除", "Remove")}
                                className="absolute top-0.5 right-0.5 w-4 h-4 flex items-center justify-center rounded-full bg-black/60 text-white text-[11px] leading-none opacity-0 group-hover/att:opacity-100 transition-opacity">×</button>
                            </div>
                          );
                        }
                        return (
                          <div key={a.id} className="relative group/att flex items-center gap-1.5 max-w-[180px] h-9 pl-1.5 pr-6 rounded-lg border border-border bg-muted/40"
                            title={a.path}>
                            <img src={fileIconUrl(a.name || a.path)} alt="" draggable={false} className="w-4 h-4 shrink-0" />
                            <span className="text-[11px] text-foreground truncate">{a.name}</span>
                            <button onClick={function() { removeAttachment(a.id); }}
                              title={tt("移除", "Remove")}
                              className="absolute top-1/2 -translate-y-1/2 right-1 w-4 h-4 flex items-center justify-center rounded-full bg-black/50 text-white text-[11px] leading-none opacity-0 group-hover/att:opacity-100 transition-opacity">×</button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <textarea ref={inputRef} value={input}
                    onChange={function(e: any) { updateInput(e.target.value, e.target.selectionStart); autoGrow(e.target); }}
                    onKeyDown={handleKeyDown}
                    onBlur={function() { setTimeout(function() { setSlashItems([]); setAtItems([]); setEffortMenuOpen(false); }, 120); }}
                    onPaste={function(e: any) {
                      // 粘贴板里有图片 → 截获并加为附件（阻止把二进制名贴进文本）。
                      var items = e.clipboardData && e.clipboardData.items;
                      if (!items) return;
                      var found = false;
                      for (var i = 0; i < items.length; i++) {
                        if (items[i].type && items[i].type.indexOf("image/") === 0) {
                          var f = items[i].getAsFile();
                          if (f) { addImageFile(f); found = true; }
                        }
                      }
                      if (found) e.preventDefault();
                    }}
                    onContextMenu={function(e: any) {
                      var el = inputRef.current;
                      var hasSel = !!el && el.selectionStart !== el.selectionEnd;
                      var items: ContextMenuItem[] = [
                        { label: tt("剪切", "Cut"), icon: <Scissors size={13} />, disabled: !hasSel, onClick: function() { textareaAction(inputRef.current, "cut"); } },
                        { label: tt("复制", "Copy"), icon: <Copy size={13} />, disabled: !hasSel, onClick: function() { textareaAction(inputRef.current, "copy"); } },
                        { label: tt("粘贴", "Paste"), icon: <ClipboardPaste size={13} />, onClick: function() { textareaPaste(inputRef.current, setInput); } },
                        { label: tt("全选", "Select all"), icon: <TextSelect size={13} />, disabled: !input, onClick: function() { textareaAction(inputRef.current, "selectAll"); } },
                        { label: tt("附加图片…", "Attach image…"), icon: <ImageIcon size={13} />, separatorBefore: true, onClick: function() { imageInputRef.current?.click(); } },
                      ];
                      inputMenu.openMenu(e, items);
                    }}
                    placeholder={busy ? tt("运行中… 可继续输入，回车加入队列", "Running… keep typing, press Enter to queue") : (activeSession?.gameMode ? tt("文字游戏模式 · 输入你的行动，或从选项中选择（/agent 退出）", "Text-game mode · type your action or pick an option (/agent to exit)") : activeSession?.chatMode ? tt("纯聊天模式 · 直接对话（/agent 退出）", "Chat-only mode · just talk (/agent to exit)") : tt("要求后续变更", "Request a follow-up change"))}
                    rows={1}
                    className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground resize-none outline-none overflow-y-auto"
                    style={{ minHeight: "24px", maxHeight: miniMode ? "200px" : "96px" }}
                  />
                  {/* 隐藏的图片选择器（右键「附加图片」/ 附件按钮触发）。 */}
                  <input ref={imageInputRef} type="file" accept="image/*" multiple className="hidden"
                    onChange={function(e: any) {
                      var files = e.target.files;
                      if (files) for (var i = 0; i < files.length; i++) addImageFile(files[i]);
                      e.target.value = ""; // 允许再次选同一文件
                    }} />
                  <div className="flex items-center gap-1.5 mt-1.5">
                    {/* 小窗模式隐藏「附加图片 / 斜杠命令」按钮（可直接拖入文件、输入 "/" 触发），
                        腾出空间给被挤没的核心按钮。 */}
                    {!miniMode && (
                      <button onClick={function() { imageInputRef.current?.click(); }}
                        className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-colors" title={tt("附加图片", "Attach image")}>
                        <Plus size={16} />
                      </button>
                    )}
                    {/* 斜杠命令触发：插入 "/" 并弹出命令面板（也可直接在输入框打 "/"）。
                        用 onMouseDown + preventDefault 阻止 textarea 失焦——否则 textarea 的
                        onBlur 会排一个 120ms 定时器把面板关掉，造成「面板刚弹出又被关」的闪烁。 */}
                    {!miniMode && (
                    <button
                      onMouseDown={function(e: any) { e.preventDefault(); }}
                      onClick={function() {
                        var el = inputRef.current;
                        // 已打开 → 关闭面板。
                        if (slashOpen) { setSlashItems([]); setSlashBrowse(false); setEffortMenuOpen(false); if (el) el.focus(); return; }
                        // 输入框为空（或已以 "/" 开头）→ 在开头插入 "/" 走正常输入驱动的过滤。
                        if (!input || input.charAt(0) === "/") {
                          setSlashBrowse(false);
                          var next = input && input.charAt(0) === "/" ? input : "/" + input;
                          updateInput(next);
                          setTimeout(function() { if (el) { el.focus(); el.setSelectionRange(1, 1); } }, 0);
                          return;
                        }
                        // 输入框已有普通文字：不能把 "/" 粘到文字前（那样 "/已有文字" 会被当成命令名
                        // 去匹配，必然搜不到、面板出不来）。改为「浏览模式」直接展示全部命令，不动输入文本。
                        setSlashBrowse(true);
                        setSlashItems(SLASH_COMMANDS.slice());
                        setSlashIndex(0);
                        setEffortMenuOpen(false);
                        if (el) el.focus();
                      }}
                      className={cn("p-1.5 rounded-lg transition-colors text-muted-foreground hover:text-foreground hover:bg-accent",
                        slashOpen && "bg-accent text-foreground")}
                      title={tt("斜杠命令", "Slash commands")}>
                      <Command size={15} />
                    </button>
                    )}
                    {/* Provider picker — refined pill with brand icon. 小窗只显示图标省空间。 */}
                    <ModelPicker
                      icon={selectedProvider ? <ProviderIcon name={selectedProvider.name} model={selectedModel} size={16} /> : null}
                      value={selectedProviderId}
                      options={providers.map(function(p: any) { return { value: p.id, label: p.name }; })}
                      placeholder="No providers"
                      onChange={setSelectedProviderId}
                      iconOnly={miniMode}
                    />
                    {models.length > 0 ? (
                      <ModelPicker
                        value={selectedModel}
                        options={models.map(function(m: string) { return { value: m, label: m }; })}
                        placeholder="No models"
                        onChange={setSelectedModel}
                        maxLabel={miniMode ? 5 : undefined}
                      />
                    ) : (
                      <span className="text-[10px] text-muted-foreground">No models</span>
                    )}
                    {/* 会话级权限模式（仅此会话生效，优先级高于全局 config）。
                        完全放行时盾牌变红警示。小窗用简化文案：询问/自动/计划/放行。 */}
                    <ModelPicker
                      icon={<Shield size={14} className={cn(
                        (activeSession?.permissionMode === "bypassPermissions") ? "text-destructive" : "text-muted-foreground")} />}
                      value={activeSession?.permissionMode || "default"}
                      options={PERM_MODES.map(function(m) { return { value: m.value, label: tt(m.zh, m.en), triggerLabel: miniMode ? tt(m.zhMini, m.enMini) : undefined, danger: m.danger }; })}
                      placeholder={tt("询问", "Ask")}
                      onChange={function(v: string) {
                        if (activeSessionId) setSessionPermissionMode(activeSessionId, v as any);
                      }}
                    />
                    {/* 模式图标：仅在 /chat 或 /plan 激活后出现于权限按钮右侧（纯图标，无字无叉）。
                        点击图标即退出该模式、图标随之消失。chat 与 plan 互斥，至多一个。 */}
                    {activeSession?.chatMode && (
                      <button onClick={function() { if (activeSessionId) setSessionChatMode(activeSessionId, false); }}
                        title={tt("纯聊天模式（点击退出）", "Chat-only mode (click to exit)")}
                        className="p-1.5 rounded-lg text-accent-brand bg-accent-brand/10 hover:bg-accent-brand/20 transition-colors">
                        <MessageSquare size={15} />
                      </button>
                    )}
                    {activeSession?.permissionMode === "plan" && (
                      <button onClick={function() { if (activeSessionId) setSessionPermissionMode(activeSessionId, "default"); }}
                        title={tt("计划模式（点击退出）", "Plan mode (click to exit)")}
                        className="p-1.5 rounded-lg text-accent-brand bg-accent-brand/10 hover:bg-accent-brand/20 transition-colors">
                        <ListChecks size={15} />
                      </button>
                    )}
                    {activeSession?.gameMode && (
                      <button onClick={function() { if (activeSessionId) setSessionGameMode(activeSessionId, false); }}
                        title={tt("文字游戏模式（点击退出）", "Text-game mode (click to exit)")}
                        className="p-1.5 rounded-lg text-accent-brand bg-accent-brand/10 hover:bg-accent-brand/20 transition-colors">
                        <Gamepad2 size={15} />
                      </button>
                    )}
                    <div className="flex-1" />
                    {busy ? (
                      <button onClick={handleStop} title={tt("停止当前任务", "Stop current task")}
                        className="w-8 h-8 flex items-center justify-center rounded-full bg-destructive text-destructive-foreground hover:opacity-90 transition-all">
                        <Square size={14} />
                      </button>
                    ) : (
                      <button onClick={handleSend} disabled={!input.trim() && attachments.length === 0}
                        className={cn("w-8 h-8 flex items-center justify-center rounded-full transition-all",
                          (input.trim() || attachments.length > 0) ? "bg-foreground text-background hover:opacity-90" : "bg-muted text-muted-foreground/40 cursor-not-allowed"
                        )}>
                        <Send size={14} />
                      </button>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
      {/* 小窗模式不显示预览窗口（Artifact 面板），只保留对话+输入。 */}
      {!miniMode && <ArtifactPanel />}
    </div>
    {inputMenu.ContextMenuEl}
    {showContext && (
      <ContextPanel
        session={activeSession}
        workingDir={projectPath}
        onClose={function() { setShowContext(false); }}
        mini={miniMode}
        measured={activeSessionId ? sessionUsage[activeSessionId] : undefined}
      />
    )}
    </div>
  );
}

// @ 文件提及面板：与斜杠面板同款样式，列出匹配的项目文件（带文件类型图标）。
function AtFilePalette({ items, activeIndex, onHover, onPick }: {
  items: string[]; activeIndex: number; onHover: (i: number) => void; onPick: (path: string) => void;
}) {
  var tt = useT();
  var listRef = useRef<HTMLDivElement>(null);
  useEffect(function () {
    var el = listRef.current; if (!el) return;
    var a = el.querySelector('[data-active="true"]') as HTMLElement | null;
    if (a) a.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);
  if (items.length === 0) return null;
  return (
    <div className="mb-2 rounded-2xl border border-border bg-card shadow-xl shadow-black/10 overflow-hidden animate-slide-up">
      <div className="px-3 py-1.5 border-b border-border/60 flex items-center gap-1.5">
        <FileCode size={11} className="text-accent-brand" />
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">{tt("引用文件", "Reference file")}</span>
        <span className="ml-auto text-[10px] text-muted-foreground/60">{tt("↑↓ 选择 · Enter 插入 · Esc 关闭", "↑↓ select · Enter insert · Esc close")}</span>
      </div>
      <div ref={listRef} className="max-h-64 overflow-y-auto py-1">
        {items.map(function (p, i) {
          var active = i === activeIndex;
          var name = p.split("/").pop() || p;
          var dir = p.indexOf("/") !== -1 ? p.slice(0, p.lastIndexOf("/")) : "";
          return (
            <button key={p} data-active={active}
              onMouseEnter={function () { onHover(i); }}
              onMouseDown={function (e) { e.preventDefault(); onPick(p); }}
              className={cn("w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors",
                active ? "bg-accent/60" : "hover:bg-accent/30")}>
              <img src={fileIconUrl(name)} alt="" draggable={false} className="w-3.5 h-3.5 shrink-0" />
              <span className="text-xs text-foreground shrink-0">{name}</span>
              {dir && <span className="text-[10px] text-muted-foreground/60 truncate flex-1 min-w-0 text-right">{dir}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Followup 卡片：替换输入框、覆盖输入区（用户回答时不能同时打字）。
// 样式参考 Codex：标题 + 分页器 + 序号选项（带推荐标记）+ 自定义输入 + 提交/忽略。
function FollowupCard({ questions, answers, setAnswers, onSubmit, onSkip }: {
  questions: { question: string; options?: string[] }[];
  answers: Record<number, string>;
  setAnswers: (fn: (prev: Record<number, string>) => Record<number, string>) => void;
  onSubmit: () => void; onSkip: () => void;
}) {
  var tt = useT();
  var [page, setPage] = useState(0);
  // 折叠态：默认只显示问题标题，hover 卡片才展开选项+输入，避免挡住对话正文。
  // 用户一旦交互（聚焦输入框 / 选过选项 / 点开），就「锁定展开」，移出鼠标也不收起，
  // 以免回答到一半被收走。点击聊天其他区域会解除锁定并重新收起（见下方 effect）。
  var [hovering, setHovering] = useState(false);
  var [locked, setLocked] = useState(false);
  var cardRef = useRef<HTMLDivElement | null>(null);
  var expanded = hovering || locked;

  // 点击卡片外部 → 解锁并收起（除非鼠标正悬停在卡片上）。
  useEffect(function() {
    function onDoc(e: MouseEvent) {
      if (cardRef.current && !cardRef.current.contains(e.target as Node)) setLocked(false);
    }
    document.addEventListener("mousedown", onDoc);
    return function() { document.removeEventListener("mousedown", onDoc); };
  }, []);

  var total = questions.length;
  var q = questions[Math.min(page, total - 1)];
  var draft = answers[page] || "";
  var setDraft = function(v: string) { setAnswers(function(p) { var n = Object.assign({}, p); n[page] = v; return n; }); };

  // 去掉选项里的 (Recommended)/（推荐）标记单独显示。
  function splitRecommended(opt: string): { text: string; recommended: boolean } {
    var m = /\s*[（(]\s*(recommended|推荐)\s*[）)]\s*$/i.exec(opt);
    if (m) return { text: opt.slice(0, m.index).trim(), recommended: true };
    return { text: opt, recommended: false };
  }

  var goPrev = function() { if (page > 0) setPage(page - 1); };
  var goNext = function() { if (page < total - 1) setPage(page + 1); };

  // 选定本题答案：非最后一题自动跳下一题；最后一题停留，等用户点「提交」。
  var pickAnswer = function(value: string) {
    setLocked(true); // 选过即锁定展开，移开鼠标也不收起
    setAnswers(function(p) { var n = Object.assign({}, p); n[page] = value; return n; });
    if (page < total - 1) setPage(page + 1);
  };

  return (
    <div ref={cardRef}
      onMouseEnter={function() { setHovering(true); }}
      onMouseLeave={function() { setHovering(false); }}
      className="rounded-2xl border border-border bg-card px-5 py-4 shadow-lg shadow-black/5 animate-slide-up focus-within:border-ring/60 focus-within:shadow-xl transition-all">
      <div className="flex items-start gap-3 cursor-pointer" onClick={function() { setLocked(true); }}>
        <h3 className="flex-1 text-[15px] font-semibold text-foreground leading-snug">{q.question}</h3>
        {/* 折叠时给个轻提示：hover 或点击展开。 */}
        {!expanded && (
          <span className="shrink-0 pt-0.5 text-[11px] text-muted-foreground/60 select-none whitespace-nowrap">
            {total > 1 ? tt(total + " 个问题 · ", total + " questions · ") : ""}{tt("悬停展开", "Hover to expand")}
          </span>
        )}
        {expanded && total > 1 && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground shrink-0 pt-0.5">
            <button onClick={function(e: any) { e.stopPropagation(); goPrev(); }} disabled={page === 0}
              className="p-0.5 rounded hover:bg-accent disabled:opacity-30 transition-colors"><ChevronLeft size={14} /></button>
            <span>{(page + 1)} of {total}</span>
            <button onClick={function(e: any) { e.stopPropagation(); goNext(); }} disabled={page === total - 1}
              className="p-0.5 rounded hover:bg-accent disabled:opacity-30 transition-colors"><ChevronRight size={14} /></button>
          </div>
        )}
      </div>

      {/* 折叠动画：grid-rows 0fr↔1fr 让高度随内容平滑过渡，配合透明度淡入。 */}
      <div className={cn("grid transition-all duration-300 ease-out",
        expanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0")}>
      <div className="overflow-hidden min-h-0">
      <div className="mt-3 space-y-0.5">
        {(q.options || []).map(function(opt: string, oi: number) {
          var info = splitRecommended(opt);
          var selected = draft === opt || draft === info.text;
          return (
            <button key={oi}
              onClick={function() { pickAnswer(opt); }}
              className={cn("w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-colors",
                selected ? "bg-foreground/[0.06]" : "hover:bg-accent/50")}>
              <span className={cn("w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-semibold shrink-0",
                selected ? "bg-foreground text-background" : "bg-muted text-muted-foreground")}>
                {oi + 1}
              </span>
              <span className="flex-1 text-sm text-foreground">
                {info.text}
                {info.recommended && <span className="ml-1.5 text-muted-foreground font-normal">(Recommended)</span>}
              </span>
            </button>
          );
        })}
      </div>

      {/* 自定义输入 + 操作。回车：非末题→下一题，末题→提交；Esc=忽略。 */}
      <div className="mt-2 flex items-center gap-2 border-t border-border/60 pt-2.5">
        <Pencil size={13} className="text-muted-foreground shrink-0" />
        <input value={draft}
          onFocus={function() { setLocked(true); }}
          onChange={function(e: any) { setDraft(e.target.value); }}
          onKeyDown={function(e: any) {
            if (e.key === "Enter") { e.preventDefault(); if (page < total - 1) goNext(); else onSubmit(); }
            if (e.key === "Escape") { e.preventDefault(); onSkip(); }
          }}
          placeholder={tt("或者，告诉我该怎么调整", "Or tell me how to adjust")}
          className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none" />
        <button onClick={onSkip}
          className="flex items-center text-xs text-muted-foreground hover:text-foreground transition-colors px-1">{tt("忽略", "Skip")}
          <kbd className="ml-1 px-1 py-0.5 rounded bg-muted text-[10px] font-sans">ESC</kbd>
        </button>
        {page < total - 1 ? (
          <button onClick={goNext}
            className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg bg-accent-brand text-white font-medium hover:opacity-90 transition-opacity">
            {tt("下一题", "Next")} <ChevronRight size={12} />
          </button>
        ) : (
          <button onClick={onSubmit}
            className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg bg-accent-brand text-white font-medium hover:opacity-90 transition-opacity">
            {tt("提交", "Submit")} <CornerDownLeft size={12} />
          </button>
        )}
      </div>
      </div>
      </div>
    </div>
  );
}

// chat 视图的次级栏内容：左「历史对话 / 新建对话 / 回滚」按钮，右实时 to-do 路线图。
// 由全局 SecondaryBar 渲染（外层云母容器统一提供），故本组件只产出内容行、数据全部自取 store。
export function ChatSecondary() {
  var tt = useT();
  // ── 数据全部从 store 直接取（脱离 ChatView 上下文） ──
  var sessions = useChatStore(function(s) { return s.sessions; });
  var activeSessionId = useChatStore(function(s) { return s.activeSessionId; });
  var pendingApproval = useChatStore(function(s) { return s.pendingApproval; });
  var pendingFollowup = useChatStore(function(s) { return s.pendingFollowup; });
  var sessionCompleted = useChatStore(function(s) { return s.sessionCompleted; });
  var generating = useChatStore(function(s) { return s.generating; });
  var genTimeout = useChatStore(function(s) { return s.genTimeout; });
  var sessionFailed = useChatStore(function(s) { return s.sessionFailed; });
  var badgeUnread = useChatStore(function(s) { return s.badgeUnread; });
  var clearBadgeUnread = useChatStore(function(s) { return s.clearBadgeUnread; });
  var setActiveSession = useChatStore(function(s) { return s.setActiveSession; });
  var deleteSession = useChatStore(function(s) { return s.deleteSession; });
  var createSession = useChatStore(function(s) { return s.createSession; });
  var sessionCheckpoints = useChatStore(function(s) { return s.sessionCheckpoints; });
  var projectPath = useChatStore(function(s) { return s.projectPath; });
  var setScrollToMessageId = useChatStore(function(s) { return s.setScrollToMessageId; });
  var selectedProviderId = useProviderStore(function(s) { return s.selectedProviderId; });
  var selectedModel = useProviderStore(function(s) { return s.selectedModel; });
  var providers = useProviderStore(function(s) { return s.providers; });

  var activeSession = sessions.find(function(s: any) { return s.id === activeSessionId; });
  var todos: TodoItem[] = activeSession?.todos || [];
  var checkpoints = activeSessionId ? (sessionCheckpoints[activeSessionId] || []) : [];
  var selectedProvider = providers.find(function(p: any) { return p.id === selectedProviderId; });

  // 有会话正在生成时，每秒重渲染一次，驱动转圈角标颜色按「已耗时」确定性地由紫
  // 渐变到红（0s 紫 → 90s 红）。空闲时不空转。颜色不再依赖 CSS 动画/key，避免
  // streaming 期间反复重挂导致「永远是紫色」。
  var hasGenerating = Object.keys(generating).length > 0;
  var [, setSecTick] = useState(0);
  useEffect(function() {
    if (!hasGenerating) return;
    var t = setInterval(function() { setSecTick(Date.now()); }, 1000);
    return function() { clearInterval(t); };
  }, [hasGenerating]);
  // 按「距最近一次进展占超时上限的比例」在紫→红之间做 RGB 直接插值（不走 hsl 色相，
  // 否则会经过蓝/绿/黄）。紫 #a855f7(168,85,247) → 红 #ef4444(239,68,68)。
  var genColor = function(startedTs: number, limitMs: number) {
    var p = Math.max(0, Math.min(1, (Date.now() - startedTs) / (limitMs || 90000)));
    var r = Math.round(168 + (239 - 168) * p);
    var g = Math.round(85 + (68 - 85) * p);
    var b = Math.round(247 + (68 - 247) * p);
    return "rgb(" + r + ", " + g + ", " + b + ")";
  };

  var onSelectSession = setActiveSession;
  var onDeleteSession = deleteSession;
  var onNewSession = function() { createSession(selectedProvider?.name || "Agent", selectedModel || "", selectedProviderId); };

  var [showHistory, setShowHistory] = useState(false);
  var [historyQuery, setHistoryQuery] = useState("");
  var [showCheckpoints, setShowCheckpoints] = useState(false);
  var [restoringId, setRestoringId] = useState<string | null>(null);
  var [restoreToast, setRestoreToast] = useState(false);
  var ref = useRef<HTMLDivElement | null>(null);
  var cpRef = useRef<HTMLDivElement | null>(null);
  var onRestored = function() { setRestoreToast(true); setTimeout(function() { setRestoreToast(false); }, 2500); };

  // 持久任务清单:随项目加载;AI 改动时(lastChanged 变化)自动弹开下拉。
  var checklistItems = useChecklistStore(function(s) { return s.items; });
  var checklistLastChanged = useChecklistStore(function(s) { return s.lastChanged; });
  var checklistLoad = useChecklistStore(function(s) { return s.load; });
  var [showChecklist, setShowChecklist] = useState(false);
  var clRef = useRef<HTMLDivElement | null>(null);
  useEffect(function() { checklistLoad(projectPath || undefined); }, [projectPath, checklistLoad]);
  useEffect(function() {
    if (checklistLastChanged) setShowChecklist(true);   // AI 动了清单 → 弹出来给用户看
  }, [checklistLastChanged]);
  var checklistOpenCount = checklistItems.filter(function(it) { return it.status !== "done"; }).length;

  // 点外部关闭检查点弹层。
  useEffect(function() {
    if (!showCheckpoints) return;
    function onDoc(e: MouseEvent) {
      if (cpRef.current && !cpRef.current.contains(e.target as Node)) setShowCheckpoints(false);
    }
    document.addEventListener("mousedown", onDoc);
    return function() { document.removeEventListener("mousedown", onDoc); };
  }, [showCheckpoints]);

  // 点外部关闭任务清单弹层。
  useEffect(function() {
    if (!showChecklist) return;
    function onDoc(e: MouseEvent) {
      if (clRef.current && !clRef.current.contains(e.target as Node)) setShowChecklist(false);
    }
    document.addEventListener("mousedown", onDoc);
    return function() { document.removeEventListener("mousedown", onDoc); };
  }, [showChecklist]);

  var doRestore = async function(commit: string) {
    if (!projectPath) return;
    setRestoringId(commit);
    try { await (window as any).api?.checkpointRestore?.(projectPath, commit); onRestored(); } catch (e) {}
    setRestoringId(null);
    setShowCheckpoints(false);  };

  // 点击弹层外部关闭历史对话列表。
  useEffect(function() {
    if (!showHistory) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setShowHistory(false);
    }
    document.addEventListener("mousedown", onDoc);
    return function() { document.removeEventListener("mousedown", onDoc); };
  }, [showHistory]);

  return (
    // 仅内容行；云母外壳由 SecondaryBar 统一提供。
    <div className="flex items-center gap-2 w-full">
        {/* 回滚成功提示 */}
        {restoreToast && (
          <div className="absolute left-1/2 -translate-x-1/2 top-full mt-1 z-40 px-3 py-1.5 rounded-lg bg-popover border border-border shadow-lg text-[11px] text-foreground animate-fade-in">
            {tt("已回滚到所选检查点", "Restored to the selected checkpoint")}
          </div>
        )}
        {/* 左侧按钮组（仅图标） */}
        <div className="relative shrink-0 flex items-center gap-1" ref={ref}>
          <button onClick={function() { setShowHistory(function(v) { var nv = !v; if (nv) clearBadgeUnread(); return nv; }); }}
            title={tt("历史对话", "Chat history")}
            className={cn("relative flex items-center justify-center w-8 h-8 rounded-lg border transition-colors",
              showHistory ? "border-ring bg-accent text-foreground" : "border-border text-muted-foreground hover:text-foreground hover:bg-accent/50")}>
            <History size={15} />
            {/* 未读紫点：折叠态下有任意新角标（完成勾/问号）时提示；点开列表即清。 */}
            {badgeUnread && (
              <span className="absolute -top-0.5 -left-0.5 w-2 h-2 rounded-full bg-[hsl(265,85%,62%)] ring-2 ring-background animate-fade-in" />
            )}
          </button>
          <button onClick={onNewSession}
            title={tt("新建对话", "New chat")}
            className="flex items-center justify-center w-8 h-8 rounded-lg bg-foreground text-background hover:opacity-90 transition-opacity">
            <Plus size={15} />
          </button>

          {/* 检查点（回滚 agent 改动）。仅当本会话有快照时显示。 */}
          {checkpoints.length > 0 && (
            <div className="relative" ref={cpRef}>
              <button onClick={function() { setShowCheckpoints(function(v) { return !v; }); }}
                title={tt("检查点（回滚改动）", "Checkpoints (revert changes)")}
                className={cn("flex items-center justify-center w-8 h-8 rounded-lg border transition-colors",
                  showCheckpoints ? "border-ring bg-accent text-foreground" : "border-border text-muted-foreground hover:text-foreground hover:bg-accent/50")}>
                <Undo2 size={15} />
              </button>
              {showCheckpoints && (
                <div className="absolute left-0 top-full mt-2 w-72 max-h-80 overflow-y-auto rounded-xl border border-border bg-popover shadow-lg z-30 py-1 animate-fade-in">
                  <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border/60">
                    {tt("检查点 · 回滚到改动前", "Checkpoints · revert to before changes")}
                  </div>
                  {checkpoints.map(function(cp) {
                    return (
                      <div key={cp.id} className="group/cp flex items-center gap-2 px-3 py-1.5 hover:bg-accent/40 transition-colors">
                        <div className="min-w-0 flex-1">
                          <div className="text-[11px] text-foreground truncate font-mono">{cp.message}</div>
                          <div className="text-[10px] text-muted-foreground/60">
                            {new Date(cp.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · {cp.id.slice(0, 7)}
                          </div>
                        </div>
                        <button onClick={function() { doRestore(cp.id); }} disabled={restoringId === cp.id}
                          title={tt("回滚到此检查点（之后的改动将被撤销）", "Revert to this checkpoint (later changes will be undone)")}
                          className="shrink-0 flex items-center gap-1 px-2 py-1 text-[10px] rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors opacity-0 group-hover/cp:opacity-100 disabled:opacity-50">
                          {restoringId === cp.id ? <Loader2 size={10} className="animate-spin" /> : <Undo2 size={10} />}
                          {tt("回滚", "Revert")}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* 历史对话弹层 */}
          {showHistory && (
            <div className="absolute left-0 top-full mt-2 w-72 rounded-xl ring-1 ring-border/60 bg-popover shadow-xl z-30 overflow-hidden animate-pop-in flex flex-col max-h-96">
              {/* 顶部搜索框：按对话标题过滤 */}
              <div className="p-2 border-b border-border shrink-0">
                <div className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-muted border border-border focus-within:ring-1 focus-within:ring-ring">
                  <Search size={12} className="text-muted-foreground shrink-0" />
                  <input
                    value={historyQuery}
                    onChange={function(e: any) { setHistoryQuery(e.target.value); }}
                    placeholder={tt("搜索标题与消息内容…", "Search titles and message content…")}
                    autoFocus
                    className="flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground outline-none min-w-0"
                  />
                  {historyQuery && (
                    <button onClick={function() { setHistoryQuery(""); }} className="shrink-0 text-muted-foreground hover:text-foreground">
                      <X size={12} />
                    </button>
                  )}
                </div>
              </div>
              <div className="flex-1 overflow-y-auto py-1">
                {(function() {
                  if (sessions.length === 0) return <div className="px-3 py-4 text-xs text-muted-foreground text-center">{tt("还没有对话", "No chats yet")}</div>;
                  var q = historyQuery.trim().toLowerCase();
                  // 按最近活动排序的会话副本。
                  var byRecent = sessions.slice().sort(function(a: any, b: any) { return sessionLastActivity(b) - sessionLastActivity(a); });
                  // 有查询：标题匹配，全量显示；无查询：默认只显示最近活动的前 10 条。
                  var titleHits = q
                    ? byRecent.filter(function(s: any) { return (s.name || "").toLowerCase().indexOf(q) !== -1; })
                    : byRecent.slice(0, 10);
                  // 全文：扫描各会话消息正文，命中即记录（带定位的会话/消息 id 与片段）。不截断，全量展示。
                  var msgHits: { sid: string; sname: string; mid: string; role: string; snippet: any }[] = [];
                  if (q) {
                    for (var si = 0; si < sessions.length; si++) {
                      var ss = sessions[si];
                      var msgs = Array.isArray(ss.messages) ? ss.messages : [];
                      for (var mi = 0; mi < msgs.length; mi++) {
                        var m = msgs[mi];
                        var content = (m.content || "");
                        var idx = content.toLowerCase().indexOf(q);
                        if (idx === -1) continue;
                        var start = Math.max(0, idx - 24);
                        var snippet = (
                          <>
                            {(start > 0 ? "…" : "") + content.slice(start, idx)}
                            <mark className="bg-accent-brand/30 text-foreground rounded px-0.5">{content.slice(idx, idx + q.length)}</mark>
                            {content.slice(idx + q.length, idx + q.length + 50) + "…"}
                          </>
                        );
                        msgHits.push({ sid: ss.id, sname: ss.name, mid: m.id, role: m.role, snippet: snippet });
                      }
                    }
                  }
                  var jumpToMsg = function(sid: string, mid: string) {
                    onSelectSession(sid);
                    setShowHistory(false);
                    setTimeout(function() { setScrollToMessageId(mid); }, 60);
                  };
                  if (q && titleHits.length === 0 && msgHits.length === 0) {
                    return <div className="px-3 py-4 text-xs text-muted-foreground text-center">{tt("没有匹配的对话或消息", "No matching chats or messages")}</div>;
                  }
                  return (
                    <>
                      {/* 标题匹配（或无查询时的完整列表） */}
                      {q && titleHits.length > 0 && <p className="px-3 py-1 text-[10px] text-muted-foreground/50 uppercase tracking-wider">{tt("对话", "Chats")}</p>}
                      {titleHits.map(function(session: any) {
                        var tok = sessionTokenTotal(session);
                        var lastTime = sessionLastTime(session);
                        return (
                          <div key={session.id} role="button" tabIndex={0}
                            onClick={function() { onSelectSession(session.id); setShowHistory(false); }}
                            className={cn(
                              "w-full flex items-center gap-2 px-3 py-2 text-xs text-left transition-colors group cursor-pointer select-none",
                              session.id === activeSessionId ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                            )}>
                            <MessageSquare size={13} className="shrink-0" />
                            <span className="flex-1 truncate">{session.name}</span>
                            {/* hover 时显示最后一条消息的时间。固定宽度右对齐，长度变化不挪位。 */}
                            {lastTime && (
                              <span title={tt("最后消息时间 ", "Last message ") + lastTime}
                                className="shrink-0 hidden group-hover:inline-block w-12 text-right text-[10px] font-mono text-muted-foreground/70 tabular-nums">
                                {lastTime}
                              </span>
                            )}
                            {/* hover 时显示该对话总 token（估算）。固定宽度右对齐，长度变化不挪位。 */}
                            {tok > 0 && (
                              <span title={tt("该对话累计约 ", "About ") + tok.toLocaleString() + tt(" tokens（估算）", " tokens total (estimated)")}
                                className="shrink-0 hidden group-hover:inline-block w-16 text-right text-[10px] font-mono text-muted-foreground/70 tabular-nums">
                                {fmtTokens(tok)} tok
                              </span>
                            )}
                            {/* 生成中转圈角标：持续旋转；颜色按「已耗时」确定性插值
                                由紫渐变到红（0→90s），由每秒心跳重渲染推动，不靠 CSS
                                key（避免 streaming 反复重挂卡在紫色）。优先级最高。 */}
                            {generating[session.id] != null && (
                              <span title={tt("正在生成…", "Generating…")} className="shrink-0 inline-flex" style={{ color: genColor(generating[session.id], genTimeout[session.id]) }}>
                                <Loader2 size={13} className="animate-gen-spin" />
                              </span>
                            )}
                            {/* 失败/超时红色感叹号：读该会话即清。仅在不在生成时显示。 */}
                            {generating[session.id] == null && sessionFailed[session.id] && (
                              <span title={tt("本轮异常终止（超时或出错）", "This turn ended abnormally (timeout or error)")} className="shrink-0">
                                <AlertCircle size={13} className="text-red-500 animate-bounce-soft" />
                              </span>
                            )}
                            {generating[session.id] == null && !sessionFailed[session.id] && (pendingApproval[session.id] || pendingFollowup[session.id]) && (
                              <span title={tt("此对话需要你的操作，快回来～", "This chat needs your input — come back!")} className="shrink-0">
                                <HelpCircle size={13} className="text-accent-brand animate-bounce-soft" />
                              </span>
                            )}
                            {/* 任务完成灰勾：已阅即消（切到该会话即清）。样式/动画同问号角标。 */}
                            {generating[session.id] == null && !sessionFailed[session.id] && sessionCompleted[session.id] && !pendingApproval[session.id] && !pendingFollowup[session.id] && (
                              <span title={tt("此对话本轮任务已完成", "This chat's turn is complete")} className="shrink-0">
                                <CircleCheck size={13} className="text-muted-foreground animate-bounce-soft" />
                              </span>
                            )}
                            <button onClick={function(e: any) { e.stopPropagation(); onDeleteSession(session.id); }}
                              className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-destructive/20 hover:text-destructive transition-all shrink-0">
                              <Trash2 size={11} />
                            </button>
                          </div>
                        );
                      })}
                      {/* 消息正文匹配，点击跳转并高亮 */}
                      {msgHits.length > 0 && (
                        <>
                          <p className="px-3 py-1 mt-1 text-[10px] text-muted-foreground/50 uppercase tracking-wider border-t border-border/50">{tt("消息内容 · ", "Message content · ")}{msgHits.length}</p>
                          {msgHits.map(function(h, i) {
                            return (
                              <button key={"mh" + i} onClick={function() { jumpToMsg(h.sid, h.mid); }}
                                className="w-full text-left px-3 py-1.5 hover:bg-accent/50 transition-colors border-l-2 border-transparent hover:border-accent-brand">
                                <div className="text-[10px] text-muted-foreground/60 mb-0.5 flex items-center gap-1">
                                  <span className="truncate">{h.sname}</span>
                                  <span className="opacity-50 shrink-0">· {h.role === "user" ? tt("我", "Me") : tt("AI", "AI")}</span>
                                </div>
                                <div className="text-xs text-foreground/80 line-clamp-2">{h.snippet}</div>
                              </button>
                            );
                          })}
                        </>
                      )}
                    </>
                  );
                })()}
              </div>
            </div>
          )}
        </div>

        {/* 分隔 + 右侧 to-do 路线图（横向滚动，空清单时不渲染） */}
        {todos.length > 0 && <div className="w-px h-5 bg-border shrink-0" />}
        <TodoRoadmap todos={todos} />

        {/* 持久任务清单按钮：靠右对齐（ml-auto 顶到最右）。下拉小窗仿历史对话弹层。 */}
        <div className="relative shrink-0 ml-auto" ref={clRef}>
          <button onClick={function() { setShowChecklist(function(v) { return !v; }); }}
            title={tt("任务清单", "Task checklist")}
            className={cn("relative flex items-center justify-center w-8 h-8 rounded-lg border transition-colors",
              showChecklist ? "border-ring bg-accent text-foreground" : "border-border text-muted-foreground hover:text-foreground hover:bg-accent/50")}>
            <ListChecks size={15} />
          </button>
          {showChecklist && (
            <ChecklistPanel items={checklistItems} lastChangedId={checklistLastChanged ? checklistLastChanged.id : undefined} disabled={!projectPath} />
          )}
        </div>
    </div>
  );
}

// 持久任务清单下拉小窗(挂在「任务清单」按钮下方,仿历史对话弹层)。
//   - 普通色 = 待办(todo);黄 = 待验证(needs_verification);完成后划掉+灰+略缩小。
//   - 用户可:新增条目、点圆圈把条目标「完成」(done,记 completedAt,1 天后消失)、
//     删除、双击编辑文本。AI 只能把条目推到「待验证」,不能直接完成。
//   - 用户点完成时先播放完成动画(普通/黄 → 短暂绿 → 灰划掉),动画结束再落库。
//   - lastChangedId:AI 刚改过的条目,背景轻闪高亮。
function ChecklistPanel({ items, lastChangedId, disabled }: {
  items: ChecklistItem[]; lastChangedId?: string; disabled?: boolean;
}) {
  var tt = useT();
  var add = useChecklistStore(function(s) { return s.add; });
  var setStatus = useChecklistStore(function(s) { return s.setStatus; });
  var editItem = useChecklistStore(function(s) { return s.edit; });
  var [draft, setDraft] = useState("");
  var [editingId, setEditingId] = useState<string | null>(null);
  var [editText, setEditText] = useState("");
  // 正在播放完成动画的条目 id(动画结束后才真正置 done,避免动画被列表刷新打断)。
  var [completingId, setCompletingId] = useState<string | null>(null);

  var onAdd = function() {
    var v = draft.trim();
    if (!v) return;
    add(v);
    setDraft("");
  };
  // 点完成按钮:未完成→边变色边位移(并行)置 done;已完成(1 天内,过期项已被过滤)→
  // 直接撤回为 todo(setStatus 会清掉 completedAt,等于「重新计时」)。
  var onToggleDone = function(it: ChecklistItem) {
    if (completingId) return;
    if (it.status === "done") { setStatus(it.id, "todo"); return; }
    // 立即落库(触发重排 + FLIP 位移)并同时打上 completingId(触发变色动画)——
    // 二者并行,不再「先变色 520ms 再位移」串行,动画整体更短。
    setCompletingId(it.id);
    setStatus(it.id, "done");
    setTimeout(function() { setCompletingId(null); }, 520);
  };
  var onSubmitEdit = function(id: string) {
    var v = editText.trim();
    if (v) editItem(id, v);
    setEditingId(null);
  };

  // done 沉到底部,其余保持原序。
  var ordered = items.slice().sort(function(a, b) {
    var ad = a.status === "done" ? 1 : 0;
    var bd = b.status === "done" ? 1 : 0;
    return ad - bd;
  });

  // FLIP 位移动画：状态变化会让条目重排（done 沉底），直接跳变会让整列表瞬间打乱。
  // 记录每条上一次的 top，重排后用 transform 从旧位置滑到新位置（先反向位移再清零）。
  var rowRefs = useRef<Record<string, HTMLDivElement | null>>({});
  var prevTops = useRef<Record<string, number>>({});
  useLayoutEffect(function() {
    var newTops: Record<string, number> = {};
    Object.keys(rowRefs.current).forEach(function(id) {
      var el = rowRefs.current[id];
      if (!el) return;
      var node: HTMLDivElement = el;
      var top = node.offsetTop;
      newTops[id] = top;
      var prev = prevTops.current[id];
      if (prev != null && prev !== top) {
        var dy = prev - top;
        node.style.transition = "none";
        node.style.transform = "translateY(" + dy + "px)";
        // 强制回流后下一帧清零，触发过渡滑动到位。
        void node.offsetHeight;
        requestAnimationFrame(function() {
          node.style.transition = "transform 0.32s cubic-bezier(0.22, 1, 0.36, 1)";
          node.style.transform = "";
        });
      }
    });
    prevTops.current = newTops;
  });

  return (
    <div className="absolute right-0 top-full mt-2 w-80 rounded-xl border border-border bg-popover shadow-lg z-30 overflow-hidden animate-fade-in flex flex-col max-h-[28rem]">

      {/* 新增条目 */}
      {!disabled && (
        <div className="p-2 border-b border-border/60 shrink-0">
          <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-muted border border-border focus-within:ring-1 focus-within:ring-ring">
            <Plus size={13} className="text-muted-foreground shrink-0" />
            <input
              value={draft}
              onChange={function(e) { setDraft(e.target.value); }}
              onKeyDown={function(e) { if (e.key === "Enter") onAdd(); }}
              placeholder={tt("添加任务，回车确认", "Add a task, press Enter")}
              className="flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground/50" />
          </div>
        </div>
      )}

      {/* 列表 */}
      <div className="flex-1 overflow-y-auto py-1">
        {disabled ? (
          <div className="px-3 py-6 text-xs text-muted-foreground text-center">{tt("打开一个项目后可使用任务清单", "Open a project to use the checklist")}</div>
        ) : ordered.length === 0 ? (
          <div className="px-3 py-6 text-xs text-muted-foreground text-center">{tt("还没有任务。在上方添加，或让 AI 完成工作后自动记录。", "No tasks yet. Add one above, or the AI will log them as it finishes work.")}</div>
        ) : ordered.map(function(it) {
          var isDone = it.status === "done";
          var isVerify = it.status === "needs_verification";
          var animating = completingId === it.id;
          var flash = lastChangedId === it.id && !isDone;
          // 文本颜色:动画中走 CSS keyframe;否则按状态——黄(待验证)/更灰划掉(已完成)/普通(待办)。
          var textCls = animating ? "cw-checklist-done"
            : isDone ? "text-muted-foreground/50 line-through text-[11px]"
            : isVerify ? "text-amber-500"
            : "text-foreground";
          return (
            <div key={it.id}
              ref={function(el) { rowRefs.current[it.id] = el; }}
              className={cn("group/ck flex items-center gap-2 px-3 py-1.5 hover:bg-accent/40 transition-colors", flash && "cw-checklist-flash")}>
              {/* 文本(单行,超出省略号,hover 看全文) + 第二行最近更新时间 */}
              <div className="flex-1 min-w-0">
                {editingId === it.id ? (
                  <input
                    autoFocus
                    value={editText}
                    onChange={function(e) { setEditText(e.target.value); }}
                    onKeyDown={function(e) { if (e.key === "Enter") onSubmitEdit(it.id); if (e.key === "Escape") setEditingId(null); }}
                    onBlur={function() { onSubmitEdit(it.id); }}
                    className="w-full bg-muted border border-border rounded px-1.5 py-0.5 text-xs outline-none focus:ring-1 focus:ring-ring" />
                ) : (
                  <div
                    title={it.content}
                    onDoubleClick={function() { if (!isDone) { setEditingId(it.id); setEditText(it.content); } }}
                    className={cn("truncate text-xs leading-snug cursor-default transition-all", textCls)}>
                    {isVerify && <span className="mr-1 text-[9px] uppercase tracking-wider text-amber-500/80 align-middle">{tt("待验证", "verify")}</span>}
                    {it.content}
                  </div>
                )}
                <div className="text-[9px] text-muted-foreground/50 tabular-nums leading-tight mt-0.5">
                  {relTime(it.updatedAt)}
                </div>
              </div>

              {/* 完成按钮(最右):未完成→点击完成;已完成→点击撤回为待办(重新计时)。 */}
              <button onClick={function() { onToggleDone(it); }} disabled={!!completingId}
                title={isDone ? tt("撤回完成（重新计时）", "Undo done (restart timer)") : tt("标记完成", "Mark done")}
                className="shrink-0 disabled:cursor-default">
                {isDone
                  ? <CircleCheck size={15} className="text-emerald-500/70 hover:text-muted-foreground transition-colors" />
                  : <Circle size={15} className={cn(isVerify ? "text-amber-500" : "text-muted-foreground/50", "hover:text-emerald-500 transition-colors")} />}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// to-do 路线图：每步只显示一个圆点（completed=绿、in_progress=高亮+spinner、
// pending=灰）。鼠标 hover 圆点才弹出该步详情。步骤过多时不显示滚动条，
// 用户按住鼠标左右拖动滚动。即时更新。
function TodoRoadmap({ todos }: { todos: TodoItem[] }) {
  var tt = useT();
  var scrollRef = useRef<HTMLDivElement | null>(null);
  var dragRef = useRef<{ down: boolean; startX: number; startScroll: number; moved: boolean }>({
    down: false, startX: 0, startScroll: 0, moved: false,
  });
  // hover 的步骤详情，用 fixed 定位到视口坐标——这样不会被滚动容器的
  // overflow 裁掉（overflow-x 非 visible 时 overflow-y 也会变 auto，普通
  // 绝对定位的 tooltip 会被裁剪，这正是之前显示不出来的原因）。
  var [tip, setTip] = useState<{ x: number; y: number; t: TodoItem } | null>(null);

  if (!todos || todos.length === 0) return null;
  var done = todos.filter(function(t) { return t.status === "completed"; }).length;

  // 按住左右拖动滚动（绑在 window 上，拖出容器也跟手）。拖动期间隐藏 tooltip。
  var onDown = function(e: React.MouseEvent) {
    var el = scrollRef.current;
    if (!el) return;
    dragRef.current = { down: true, startX: e.clientX, startScroll: el.scrollLeft, moved: false };
    var onMove = function(ev: MouseEvent) {
      if (!dragRef.current.down || !scrollRef.current) return;
      var dx = ev.clientX - dragRef.current.startX;
      if (Math.abs(dx) > 3) { dragRef.current.moved = true; setTip(null); }
      scrollRef.current.scrollLeft = dragRef.current.startScroll - dx;
    };
    var onUp = function() {
      dragRef.current.down = false;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  // 鼠标掠过某圆点 → 用其屏幕坐标定位 tooltip（拖动中不弹）。
  var showTip = function(e: React.MouseEvent, t: TodoItem) {
    if (dragRef.current.down) return;
    var r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setTip({ x: r.left + r.width / 2, y: r.bottom + 6, t: t });
  };

  return (
    <div className="flex-1 min-w-0 flex items-center gap-2">
      <span className="shrink-0 text-[10px] font-medium text-muted-foreground tabular-nums">
        {done}/{todos.length}
      </span>
      <div
        ref={scrollRef}
        onMouseDown={onDown}
        onMouseLeave={function() { setTip(null); }}
        className="flex-1 min-w-0 flex items-center overflow-x-auto cw-no-scrollbar py-1 cursor-grab active:cursor-grabbing select-none">
        {todos.map(function(t, i) {
          return (
            <div key={i} className="shrink-0 flex items-center px-1.5"
              onMouseEnter={function(e: any) { showTip(e, t); }}
              onMouseMove={function(e: any) { showTip(e, t); }}>
              {t.status === "completed" ? <CircleCheck size={15} className="text-emerald-500" />
                : t.status === "in_progress" ? <Loader2 size={15} className="animate-spin text-accent-brand" />
                : <Circle size={15} className="text-muted-foreground/50" />}
            </div>
          );
        })}
      </div>

      {/* fixed 定位的详情浮层：portal 到 body，避免任何祖先的 transform 把
          position:fixed 锚定到该祖先而非视口（那会让浮层偏到界面中央）。 */}
      {tip && createPortal(
        <div
          style={{ left: tip.x, top: tip.y, transform: "translateX(-50%)" }}
          className="fixed z-[200] px-2.5 py-1.5 rounded-lg bg-popover border border-border shadow-lg text-[11px] text-foreground whitespace-normal w-max max-w-[280px] pointer-events-none animate-fade-opacity">
          <span className="text-[9px] uppercase tracking-wider text-muted-foreground mr-1.5">
            {tip.t.status === "completed" ? tt("已完成", "Done") : tip.t.status === "in_progress" ? tt("进行中", "In progress") : tt("待办", "To do")}
          </span>
          {tip.t.status === "in_progress" && tip.t.activeForm ? tip.t.activeForm : tip.t.content}
        </div>,
        document.body
      )}
    </div>
  );
}

// 精致的下拉选择器（pill 样式 + 浮层菜单），用于服务商/模型/权限选择。
// 选项可标记 danger（如「完全放行」）→ 红色显示。
function ModelPicker({ icon, value, options, placeholder, onChange, iconOnly, maxLabel }: {
  icon?: React.ReactNode; value: string;
  options: { value: string; label: string; triggerLabel?: string; danger?: boolean }[];
  placeholder: string; onChange: (v: string) => void;
  iconOnly?: boolean; maxLabel?: number;
}) {
  var [open, setOpen] = useState(false);
  var ref = useRef<HTMLDivElement>(null);
  var current = options.find(function(o) { return o.value === value; });
  var label = current ? (current.triggerLabel || current.label) : placeholder;
  if (maxLabel && label.length > maxLabel) label = label.slice(0, maxLabel);

  useEffect(function() {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return function() { document.removeEventListener("mousedown", onDoc); };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button onClick={function() { setOpen(!open); }}
        className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px] text-foreground/80 hover:bg-accent/60 transition-colors max-w-[180px]">
        {icon}
        {!(iconOnly && icon) && (
          <span className={cn("truncate font-medium", current && current.danger && "text-destructive")}>{label}</span>
        )}
        <ChevronDown size={12} className={cn("text-muted-foreground transition-transform shrink-0", open && "rotate-180")} />
      </button>
      {open && options.length > 0 && (
        <div className="absolute bottom-full mb-1.5 left-0 min-w-[180px] max-h-64 overflow-y-auto rounded-xl border border-border bg-card shadow-xl shadow-black/10 py-1 z-20 animate-fade-in">
          {options.map(function(o) {
            var sel = o.value === value;
            return (
              <button key={o.value} onClick={function() { onChange(o.value); setOpen(false); }}
                className={cn("w-full flex items-center justify-between gap-2 px-3 py-1.5 text-[12px] text-left hover:bg-accent/60 transition-colors",
                  o.danger ? "text-destructive" : sel ? "text-foreground font-medium" : "text-foreground/70")}>
                <span className="truncate">{o.label}</span>
                {sel && <Check size={13} className={cn("shrink-0", o.danger ? "text-destructive" : "text-foreground")} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// /context 面板：显示「发往 AI 的固定上下文」各类别 token 占用明细。
// 优先用 measured（最近一次往返的 API 实测精确总数 + 按字符占比分摊的分项）——精确；
// 仅当本会话还没发过消息（无 measured）时，回退到本地估算并标「待首轮/估算」。
function ContextPanel({ session, workingDir, onClose, mini, measured }: {
  session: any; workingDir: string | null; onClose: () => void; mini?: boolean;
  measured?: { promptTokens: number; completionTokens: number; contextTokens?: number; estimated?: boolean; cacheCreate?: number; cacheRead?: number; turnCacheRead?: number; breakdown?: { systemTok: number; toolsTok: number; historyTok: number } };
}) {
  var tt = useT();
  var [rows, setRows] = useState<{ label: string; tokens: number; detail?: string; color: string }[] | null>(null);
  var [total, setTotal] = useState(0);
  // 是否为实测数据（有 contextTokens 且非 estimated）。
  var isMeasured = !!(measured && measured.contextTokens && !measured.estimated);

  useEffect(function() {
    var alive = true;
    (async function() {
      // 1. 系统提示 + 内置工具（主进程原文）。
      var stats: any = {};
      try { stats = await (window as any).api?.agentContextStats?.(workingDir || ""); } catch (e) {}
      var sysTok = estimateTokens(stats?.systemPrompt || "");
      var toolTok = estimateTokens(stats?.toolsJson || "");
      var toolCount = stats?.toolCount || 0;
      // 记忆 + CLAUDE.md 常驻注入块(主进程合成的稳定前缀)。
      var memTok = estimateTokens(stats?.memoryBlock || "");

      // 2. MCP 工具（真实工具列表 → 其 name+description 估算）。
      var mcpTok = 0, mcpToolCount = 0;
      try {
        var mcp = await (window as any).api?.mcpStatus?.();
        if (Array.isArray(mcp)) {
          for (var i = 0; i < mcp.length; i++) {
            var srv = mcp[i];
            if (srv && Array.isArray(srv.tools)) {
              for (var j = 0; j < srv.tools.length; j++) {
                mcpToolCount++;
                mcpTok += estimateTokens((srv.tools[j].name || "") + " " + (srv.tools[j].description || ""));
              }
            }
          }
        }
      } catch (e) {}

      // 3. 消息历史：当前会话「实际会发往 AI」的部分（含 /compact 后的摘要+边界）。
      var msgs = (session && session.messages) || [];
      var summary = session && session.contextSummary;
      var effective = msgs;
      if (summary && session.summaryUpTo) {
        var cut = msgs.findIndex(function(m: any) { return m.id === session.summaryUpTo; });
        if (cut !== -1) effective = msgs.slice(cut + 1);
      }
      var histParts = effective
        .filter(function(m: any) { return (m.role === "user" || m.role === "assistant") && !m.divider; })
        .map(function(m: any) { return m.content; });
      var histTok = estimateTokensMany(histParts);
      var summaryTok = summary ? estimateTokens(summary) : 0;

      var built = [
        { label: tt("系统提示", "System prompt"), tokens: sysTok, detail: tt("UE Coworker 固定指令", "UE Coworker fixed instructions"), color: "bg-blue-500" },
        { label: tt("记忆 / CLAUDE.md", "Memory / CLAUDE.md"), tokens: memTok, detail: tt("常驻记忆索引 + 项目指令", "Persistent memory index + project instructions"), color: "bg-pink-500" },
        { label: tt("工具定义", "Tool definitions"), tokens: toolTok, detail: toolCount + tt(" 个内置工具", " built-in tools"), color: "bg-amber-500" },
        { label: tt("MCP 工具", "MCP tools"), tokens: mcpTok, detail: mcpToolCount + tt(" 个 MCP 工具", " MCP tools"), color: "bg-purple-500" },
        { label: tt("压缩摘要", "Compacted summary"), tokens: summaryTok, detail: summary ? tt("已压缩的历史上下文", "Compacted history context") : tt("未压缩", "Not compacted"), color: "bg-teal-500" },
        { label: tt("消息历史", "Message history"), tokens: histTok, detail: histParts.length + tt(" 条消息", " messages"), color: "bg-emerald-500" },
      ].filter(function(r) { return r.tokens > 0; });

      // 有实测分摊时：用 API 精确总数 + 三大块（system/工具/历史）实测分摊覆盖估算。
      // system 内部再细分（系统提示/记忆）、工具内部再细分（内置/MCP），按各自估算占比
      // 在实测桶内二次分配——既精确（总数与三大块=实测）又保留细类构成。
      if (isMeasured && measured && measured.breakdown) {
        var bd = measured.breakdown;
        var sysGroup = sysTok + memTok;       // 估算的 system 组(系统提示+记忆)
        var toolGroup = toolTok + mcpTok;     // 估算的工具组(内置+MCP)
        var histGroup = histTok + summaryTok; // 估算的历史组(消息+压缩摘要)
        var part = function(estPart: number, estGroup: number, measuredBucket: number) {
          return estGroup > 0 ? Math.round(measuredBucket * (estPart / estGroup)) : measuredBucket;
        };
        built = [
          { label: tt("系统提示", "System prompt"), tokens: part(sysTok, sysGroup, bd.systemTok) - (memTok > 0 ? 0 : 0), detail: tt("UE Coworker 固定指令", "UE Coworker fixed instructions"), color: "bg-blue-500" },
          { label: tt("记忆 / CLAUDE.md", "Memory / CLAUDE.md"), tokens: memTok > 0 ? Math.max(0, bd.systemTok - part(sysTok, sysGroup, bd.systemTok)) : 0, detail: tt("常驻记忆索引 + 项目指令", "Persistent memory index + project instructions"), color: "bg-pink-500" },
          { label: tt("工具定义", "Tool definitions"), tokens: part(toolTok, toolGroup, bd.toolsTok), detail: toolCount + tt(" 个内置工具", " built-in tools"), color: "bg-amber-500" },
          { label: tt("MCP 工具", "MCP tools"), tokens: mcpTok > 0 ? Math.max(0, bd.toolsTok - part(toolTok, toolGroup, bd.toolsTok)) : 0, detail: mcpToolCount + tt(" 个 MCP 工具", " MCP tools"), color: "bg-purple-500" },
          { label: tt("压缩摘要", "Compacted summary"), tokens: summaryTok > 0 ? part(summaryTok, histGroup, bd.historyTok) : 0, detail: summary ? tt("已压缩的历史上下文", "Compacted history context") : tt("未压缩", "Not compacted"), color: "bg-teal-500" },
          { label: tt("消息历史", "Message history"), tokens: summaryTok > 0 ? Math.max(0, bd.historyTok - part(summaryTok, histGroup, bd.historyTok)) : bd.historyTok, detail: histParts.length + tt(" 条消息", " messages"), color: "bg-emerald-500" },
        ].filter(function(r) { return r.tokens > 0; });
      }

      var sum = isMeasured && measured && measured.contextTokens
        ? measured.contextTokens
        : built.reduce(function(a, r) { return a + r.tokens; }, 0);
      if (!alive) return;
      setRows(built);
      setTotal(sum);
    })();
    return function() { alive = false; };
  }, [session, workingDir, tt, isMeasured, measured]);

  return (
    <div className={cn("fixed inset-0 z-50 flex items-center justify-center animate-fade-in", mini ? "" : "bg-black/40")} onClick={onClose}>
      <div className={cn("w-[440px] max-h-[80vh] overflow-y-auto rounded-2xl border border-border bg-card p-5", mini ? "shadow-2xl shadow-black/40" : "shadow-2xl")}
        onClick={function(e: any) { e.stopPropagation(); }}>
        <div className="flex items-center gap-2 mb-1">
          <h3 className="flex-1 text-sm font-semibold text-foreground">{tt("上下文占用", "Context usage")}</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground">
            <X size={15} />
          </button>
        </div>
        <p className="text-[10px] text-muted-foreground/60 mb-3">
          {isMeasured
            ? tt("基于最近一次请求的 API 实测 token：总数精确，分项按真实字符占比分摊。", "Based on the API-measured tokens of the last request: total is exact, breakdown is apportioned by real character share.")
            : tt("本会话尚未发送消息，下方为本地估算；发送一条后将显示 API 实测精确值。", "No message sent in this session yet; values below are local estimates. After sending one, exact API-measured values will show.")}
        </p>
        {!rows ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground py-6 justify-center">
            <Loader2 size={13} className="animate-spin" /> {tt("正在统计…", "Calculating…")}
          </div>
        ) : (
          <>
            {/* 总览：单条堆叠占用条 */}
            <div className="flex items-baseline gap-1.5 mb-2">
              <span className="text-2xl font-semibold text-foreground tabular-nums">{fmtTokens(total)}</span>
              <span className="text-xs text-muted-foreground">{isMeasured ? tt("tokens（实测）", "tokens (measured)") : tt("tokens（估算）", "tokens (estimated)")}</span>
            </div>
            <div className="flex h-2.5 rounded-full overflow-hidden bg-muted mb-4">
              {rows.map(function(r, i) {
                var pct = total > 0 ? (r.tokens / total) * 100 : 0;
                return <div key={i} className={r.color} style={{ width: pct + "%" }} title={r.label + " " + fmtTokens(r.tokens)} />;
              })}
            </div>
            {/* 分类明细 */}
            <div className="space-y-1.5">
              {rows.map(function(r, i) {
                var pct = total > 0 ? (r.tokens / total) * 100 : 0;
                return (
                  <div key={i} className="flex items-center gap-2.5 py-1">
                    <span className={cn("w-2.5 h-2.5 rounded-sm shrink-0", r.color)} />
                    <span className="text-xs text-foreground shrink-0 w-16">{r.label}</span>
                    <span className="text-[10px] text-muted-foreground/60 flex-1 truncate">{r.detail}</span>
                    <span className="text-xs text-foreground tabular-nums shrink-0">{fmtTokens(r.tokens)}</span>
                    <span className="text-[10px] text-muted-foreground/50 tabular-nums shrink-0 w-10 text-right">{pct.toFixed(1)}%</span>
                  </div>
                );
              })}
            </div>
            {/* 缓存命中率：上一条 = turnCacheRead/contextTokens（同一次往返、同口径的瞬时值；
                绝不能用累加的 cacheRead 除瞬时 contextTokens，否则一个 turn 内工具往返越多、
                比值越离谱，会远超 100%）；会话平均 = Σ cacheRead / Σ promptTokens（皆累加，口径自洽）。
                缓存读取部分按 API 计费打 1 折，命中率越高越省钱。仅在有实测数据时显示。 */}
            {(function() {
              var lastCtx = measured && measured.contextTokens ? measured.contextTokens : 0;
              // 「上一条」用本次往返的瞬时缓存读取；旧数据无该字段时退回 cacheRead 并对 1 封顶兜底。
              var lastRead = measured && measured.turnCacheRead != null ? measured.turnCacheRead
                : (measured && measured.cacheRead ? measured.cacheRead : 0);
              var lastRate = lastCtx > 0 ? Math.min(1, lastRead / lastCtx) : null;
              var ut = session && session.usageTotals;
              var avgIn = ut && ut.promptTokens ? ut.promptTokens : 0;
              var avgRead = ut && ut.cacheRead ? ut.cacheRead : 0;
              var avgRate = avgIn > 0 ? (avgRead / avgIn) : null;
              if (lastRate === null && avgRate === null) return null;
              var pct = function(r: number) { return (r * 100).toFixed(1) + "%"; };
              return (
                <div className="mt-4 pt-3 border-t border-border/60 space-y-1.5">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-1">{tt("缓存命中率", "Cache hit rate")}</div>
                  {lastRate !== null && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">{tt("上一条消息", "Last message")}</span>
                      <span className="tabular-nums text-foreground">
                        {pct(lastRate)}
                        <span className="text-muted-foreground/60 ml-1.5">{fmtTokens(lastRead)} / {fmtTokens(lastCtx)}</span>
                      </span>
                    </div>
                  )}
                  {avgRate !== null && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">{tt("本会话平均", "Session average")}</span>
                      <span className="tabular-nums text-foreground">
                        {pct(avgRate)}
                        <span className="text-muted-foreground/60 ml-1.5">{fmtTokens(avgRead)} / {fmtTokens(avgIn)}</span>
                      </span>
                    </div>
                  )}
                </div>
              );
            })()}
            <div className="mt-4 pt-3 border-t border-border/60 text-[10px] text-muted-foreground/60 leading-relaxed">
              {tt("提示：消息历史随对话增长；用 ", "Tip: message history grows with the conversation; use ")}<span className="font-mono text-foreground/70">/compact</span>{tt(" 压缩历史可显著降低占用。MCP 工具偏多时可在设置中按需启用。", " to compact history and cut usage significantly. If there are many MCP tools, enable them selectively in settings.")}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// 聊天里渲染本地图片：从路径经 IPC 读成 data URL（CSP 不允许 file:）。点击放大（应用内灯箱）。
function ChatImage({ path }: { path: string }) {
  var tt = useT();
  var [url, setUrl] = useState<string>("");
  var [zoom, setZoom] = useState(false);
  var imgMenu = useContextMenu();
  useEffect(function() {
    var alive = true;
    (window as any).api?.readChatImage?.(path).then(function(res: any) {
      if (alive && res && res.ok && res.dataUrl) setUrl(res.dataUrl);
    });
    return function() { alive = false; };
  }, [path]);
  // Esc 关闭灯箱。
  useEffect(function() {
    if (!zoom) return;
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") setZoom(false); }
    document.addEventListener("keydown", onKey);
    return function() { document.removeEventListener("keydown", onKey); };
  }, [zoom]);

  var buildMenu = function(): ContextMenuItem[] {
    return [
      { label: tt("查看大图", "View full size"), icon: <ImageIcon size={13} />, onClick: function() { setZoom(true); } },
      { label: tt("另存为…", "Save as…"), icon: <Save size={13} />, separatorBefore: true, onClick: function() { (window as any).api?.saveImageAs?.(path); } },
      { label: tt("复制图片", "Copy image"), icon: <Copy size={13} />, onClick: function() { (window as any).api?.copyImageToClipboard?.(path); } },
      { label: tt("在文件夹中显示", "Show in folder"), icon: <FolderOpen size={13} />, onClick: function() { (window as any).api?.showInFolder?.(path); } },
    ];
  };

  if (!url) {
    return <div className="w-20 h-20 rounded-lg bg-background/20 animate-pulse" />;
  }
  return (
    <>
      {imgMenu.ContextMenuEl}
      <img src={url} alt="" onClick={function() { setZoom(true); }}
        onContextMenu={function(e: any) { imgMenu.openMenu(e, buildMenu()); }}
        title={tt("点击查看大图 · 右键更多操作", "Click to enlarge · right-click for more")}
        className="max-w-[200px] max-h-[200px] rounded-lg object-cover cursor-zoom-in border border-background/20 hover:opacity-90 transition-opacity" />
      {zoom && (
        <div onClick={function() { setZoom(false); }}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 animate-fade-in cursor-zoom-out p-6">
          <img src={url} alt="" onClick={function(e: any) { e.stopPropagation(); }}
            onContextMenu={function(e: any) { imgMenu.openMenu(e, buildMenu()); }}
            className="max-w-[92vw] max-h-[92vh] object-contain rounded-lg shadow-2xl" />
          <button onClick={function(e: any) { e.stopPropagation(); setZoom(false); }}
            title={tt("关闭 (Esc)", "Close (Esc)")}
            className="absolute top-4 right-4 w-9 h-9 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors">
            <X size={18} />
          </button>
        </div>
      )}
    </>
  );
}

// 自适应宽度的波浪分隔线。把一个正弦波单元做成 data-URI SVG，用 CSS background
// 横向平铺（repeat-x）——这样无论多宽，波形单元都不变形。用于 /compact 的分隔
// 标记，呼应 Claude Code 的波浪风格。颜色用 currentColor 经 stroke 内联，跟随主题。
var WAVE_SVG =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="6">' +
    '<path d="M0 3 Q 4 0 8 3 T 16 3" stroke="%23888" stroke-opacity="0.5" stroke-width="1" fill="none"/></svg>'
  );
function WavyLine() {
  return (
    <span
      className="flex-1 block h-2 min-w-[16px]"
      style={{ backgroundImage: "url(\"" + WAVE_SVG + "\")", backgroundRepeat: "repeat-x", backgroundPosition: "center", backgroundSize: "16px 6px" }}
      aria-hidden="true"
    />
  );
}

// ===== AGENT MESSAGE RENDERER =====

// 子 agent 活动卡:在父 task 工具气泡内内联展示一个子 agent 的实时状态——名称 +
// 模型徽标 + mode + 实时阶段 + 流式文本(运行中)/最终报告(完成)+ 可折叠的子 agent
// 工具调用时间线(复用同款工具气泡风格,不另造)。数据来自 subagent-store。
function SubAgentCard({ run }: { run: any }) {
  var tt = useT();
  var [showTools, setShowTools] = useState(true);
  var running = run.phase !== "done";
  var phaseLabel = run.phase === "done" ? tt("完成", "Done")
    : run.phase === "tool-call" || run.phase === "tool-result" ? (run.mode === "read-only" ? tt("调查中", "Investigating") : tt("执行中", "Executing"))
    : run.phase === "streaming-text" ? tt("撰写中", "Writing")
    : tt("启动中", "Starting");
  return (
    <div className="rounded-lg border border-violet-500/20 bg-violet-500/5 overflow-hidden">
      <div className="flex items-center gap-2 px-2.5 py-1.5 border-b border-violet-500/10">
        <Bot size={13} className="text-violet-400 shrink-0" />
        <span className="text-xs font-medium text-foreground/90 shrink-0">{run.agentName}</span>
        <span className={cn("text-[9px] px-1 rounded font-normal shrink-0",
          run.mode === "read-only" ? "bg-blue-500/15 text-blue-400" : "bg-amber-500/15 text-amber-400")}>
          {run.mode === "read-only" ? tt("只读", "Read-only") : tt("可写", "Writable")}
        </span>
        {run.model && <span className="text-[9px] px-1 rounded font-mono bg-muted text-muted-foreground shrink-0 truncate max-w-[140px]">{run.model}</span>}
        <span className="flex-1" />
        <span className={cn("text-[9px] px-1.5 py-0.5 rounded-full shrink-0 font-medium flex items-center gap-1",
          running ? "bg-violet-500/15 text-violet-400" : "bg-green-500/15 text-green-400")}>
          {running && <Loader2 size={9} className="animate-spin" />}
          {phaseLabel}
        </span>
      </div>

      {/* 子 agent 工具调用时间线(可折叠)。 */}
      {run.toolCalls && run.toolCalls.length > 0 && (
        <div className="px-2.5 py-1.5">
          <button onClick={function() { setShowTools(!showTools); }}
            className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors">
            {showTools ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
            <span>{tt("工具调用 ", "Tool calls ")}{run.toolCalls.length}</span>
          </button>
          {showTools && (
            <div className="mt-1.5 space-y-1">
              {run.toolCalls.map(function(tc: any, i: number) {
                var TIcon = getToolIcon(tc.name);
                var preview = tc.input && (tc.input.file_path || tc.input.command || tc.input.query || tc.input.pattern || "");
                return (
                  <div key={tc.callId || i} className="flex items-center gap-1.5 text-[10px] pl-1">
                    <TIcon size={11} className={cn("shrink-0", getToolColor(tc.name))} />
                    <span className="text-foreground/70 shrink-0">{tc.name}</span>
                    <span className="text-muted-foreground truncate flex-1 min-w-0">{String(preview).split(/[\\/]/).pop()}</span>
                    {tc.output != null
                      ? <Check size={10} className="text-green-400 shrink-0" />
                      : <Loader2 size={10} className="text-violet-400 animate-spin shrink-0" />}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 运行中:流式文本进度;完成:最终报告。 */}
      {(run.report || run.text) && (
        <div className="px-2.5 py-1.5 border-t border-violet-500/10 max-h-48 overflow-y-auto">
          <div className="text-[9px] text-muted-foreground uppercase tracking-wider mb-1">
            {run.phase === "done" ? tt("报告", "Report") : tt("进行中", "In progress")}
          </div>
          <div className="text-[11px] text-foreground/80 whitespace-pre-wrap break-words">
            {(run.report || run.text || "").slice(0, 4000)}
          </div>
          {run.files && run.files.length > 0 && (
            <div className="mt-1.5 text-[10px] text-muted-foreground">
              {tt("改动文件: ", "Changed files: ")}<span className="font-mono">{run.files.join(", ")}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// 单个工具调用气泡（不含轮次头部/外层间距）。从 AgentMessageBase 抽出，供普通渲染
// 与 ToolGroup（折叠组）共用，避免两处维护同一套 diff/图片/输出渲染逻辑。
// expanded=该工具气泡的「输入/输出/diff」明细是否展开（与「组折叠」是两层独立状态）。
function ToolBubbleBase({ message, expanded, onToggle, onResend, onDelete }: {
  message: ChatMessage; expanded: boolean; onToggle: () => void;
  onResend: () => void; onDelete: () => void;
}) {
  var tt = useT();
  var [copied, setCopied] = useState(false);
  var projectPath = useAppStore(function(s) { return s.projectPath; });
  var msgMenu = useContextMenu();

  var copyText = async function(text: string) {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(function() { setCopied(false); }, 2000); } catch(e) {}
  };
  var resolveFilePath = function(fp: string): string {
    if (!fp) return fp;
    var isAbs = /^([a-zA-Z]:[\\/]|[\\/])/.test(fp);
    if (isAbs || !projectPath) return fp;
    return projectPath.replace(/[\\/]+$/, "") + "/" + fp.replace(/^[\\/]+/, "");
  };
  var buildMsgMenu = function(sel?: string): ContextMenuItem[] {
    var items: ContextMenuItem[] = [];
    // 有选中文本：优先「复制选中」（复制真实选区，而非整段工具输出）。
    if (sel) {
      items.push({ label: tt("复制选中", "Copy selection"), icon: <Copy size={13} />, onClick: function() { copyText(sel); } });
    }
    var fp = message.toolCall!.input?.file_path;
    if (fp) items.push({ label: tt("预览文件", "Preview file"), icon: <FolderOpen size={13} />, onClick: function() { openFileInPreview(resolveFilePath(fp)); } });
    if (message.toolCall!.output) items.push({ label: tt("复制输出", "Copy output"), icon: <Copy size={13} />, onClick: function() { copyText(message.toolCall!.output || ""); } });
    items.push({ label: tt("复制输入 JSON", "Copy input JSON"), icon: <Copy size={13} />, onClick: function() { copyText(JSON.stringify(message.toolCall?.input, null, 2)); } });
    items.push({ label: tt("删除", "Delete"), icon: <Trash2 size={13} />, danger: true, separatorBefore: true, onClick: onDelete });
    return items;
  };

  var toolName = message.toolCall!.name;

  // 扩展思考气泡(/think):复用工具折叠卡片外壳,但内容是思考摘要(Markdown 渲染),
  // 不是工具 input/output。图标换脑、标题改「思考过程」。其余工具逻辑一概跳过。
  if (toolName === "__thinking__") {
    var thinkText = message.toolCall!.output || "";
    return (
      <div id={"msg-" + message.id} onContextMenu={function(e: any) { msgMenu.openMenu(e, [
        { label: tt("复制思考", "Copy thinking"), icon: <Copy size={13} />, onClick: function() { copyText(thinkText); } },
        { label: tt("删除", "Delete"), icon: <Trash2 size={13} />, danger: true, separatorBefore: true, onClick: onDelete },
      ]); }}>
        {msgMenu.ContextMenuEl}
        <div className={cn("w-full max-w-[560px] rounded-xl rounded-bl-md overflow-hidden group", TOOL_TINT)}>
          <button onClick={onToggle}
            className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-black/5 dark:hover:bg-white/5 transition-colors text-left">
            <Brain size={13} className="shrink-0 text-violet-400" />
            <span className="text-xs font-medium text-foreground/80 shrink-0">{tt("思考过程", "Thinking")}</span>
            <span className="text-[10px] text-muted-foreground truncate flex-1 min-w-0">
              {expanded ? "" : thinkText.replace(/\s+/g, " ").trim().slice(0, 60)}
            </span>
            {expanded ? <ChevronDown size={13} className="text-muted-foreground shrink-0" /> : <ChevronRight size={13} className="text-muted-foreground shrink-0" />}
          </button>
          {expanded && (
            <div className="px-3 pb-3 pt-2 border-t border-black/5 dark:border-white/5 max-h-80 overflow-y-auto">
              {thinkText
                ? <div className="text-xs text-muted-foreground/90 leading-relaxed"><Markdown>{thinkText}</Markdown></div>
                : <div className="text-[11px] text-muted-foreground/60 italic">{tt("（无思考摘要）", "(no thinking summary)")}</div>}
            </div>
          )}
        </div>
      </div>
    );
  }

  var Icon = getToolIcon(toolName);
  var colorClass = getToolColor(toolName);
  var isTaskTool = toolName === "task" || toolName === "Task";
  // 子 agent 活动:按本 task 调用的 callId 取实时运行状态(spawned→done)。
  var subRun = useSubAgentStore(function(s) {
    var cid = message.toolCall!.id;
    return cid ? s.runs[cid] : undefined;
  });
  var isEditTool = toolName === "Edit" || toolName === "edit_file";
  var isMultiEditTool = toolName === "MultiEdit" || toolName === "multi_edit";
  var isApplyDiffTool = toolName === "apply_diff";
  var isWriteTool = toolName === "Write" || toolName === "write_file";
  var isBashTool = toolName === "Bash" || toolName === "run_command" || toolName === "monitor";
  var isFileTool = isEditTool || isMultiEditTool || isApplyDiffTool || isWriteTool || toolName === "Read" || toolName === "read_file";
  var addedLines = 0, removedLines = 0;
  var tcInput = message.toolCall!.input || {};
  if (isEditTool) {
    removedLines = String(tcInput.old_string || "").split("\n").length;
    addedLines = String(tcInput.new_string || "").split("\n").length;
  } else if (isMultiEditTool && Array.isArray(tcInput.edits)) {
    for (var ei = 0; ei < tcInput.edits.length; ei++) {
      var ed = tcInput.edits[ei] || {};
      removedLines += String(ed.old_string || "").split("\n").length;
      addedLines += String(ed.new_string || "").split("\n").length;
    }
  } else if (isApplyDiffTool) {
    var dlines = String(tcInput.diff || "").split("\n");
    for (var di = 0; di < dlines.length; di++) {
      var dl = dlines[di];
      if (dl.indexOf("+++") === 0 || dl.indexOf("---") === 0) continue;
      if (dl.charAt(0) === "+") addedLines++;
      else if (dl.charAt(0) === "-") removedLines++;
    }
  } else if (isWriteTool) {
    addedLines = String(tcInput.content || "").split("\n").length;
  }
  var showDiffStat = addedLines > 0 || removedLines > 0;
  var diffText = "";
  if (isApplyDiffTool) {
    diffText = String(tcInput.diff || "");
  } else if (isEditTool) {
    diffText = editToDiffLines(tcInput.old_string, tcInput.new_string);
  } else if (isMultiEditTool && Array.isArray(tcInput.edits)) {
    var parts: string[] = [];
    for (var mi = 0; mi < tcInput.edits.length; mi++) {
      var me = tcInput.edits[mi] || {};
      parts.push("@@ " + tt("编辑", "Edit") + " " + (mi + 1) + " @@");
      parts.push(editToDiffLines(me.old_string, me.new_string));
    }
    diffText = parts.join("\n");
  }
  var hasDiff = diffText.trim().length > 0;

  return (
    <div id={"msg-" + message.id} onContextMenu={function(e: any) { var sel = (window.getSelection && window.getSelection()?.toString() || "").trim(); msgMenu.openMenu(e, buildMsgMenu(sel)); }}>
      {msgMenu.ContextMenuEl}
      <div className={cn("w-full max-w-[560px] rounded-xl rounded-bl-md overflow-hidden group", TOOL_TINT)}>
        <button onClick={onToggle}
          className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-black/5 dark:hover:bg-white/5 transition-colors text-left">
          <Icon size={13} className={cn("shrink-0", colorClass)} />
          <span className="text-xs font-medium text-foreground/80 shrink-0">{toolName}</span>
          <span className="text-[10px] text-muted-foreground truncate flex-1 min-w-0">
            {isTaskTool
              ? (message.toolCall!.input?.description || message.toolCall!.input?.subagent_type || "sub-agent")
              : isBashTool
              ? (message.toolCall!.input?.command || "").slice(0, 60)
              : isFileTool
                ? (message.toolCall!.input?.file_path || "").split("/").pop()?.split("\\").pop()
                : Object.values(message.toolCall!.input || {}).join(", ").slice(0, 60)}
          </span>
          {isTaskTool && subRun && (
            <span className={cn("text-[9px] px-1.5 py-0.5 rounded-full shrink-0 font-medium",
              subRun.phase === "done" ? "bg-green-500/15 text-green-400" : "bg-violet-500/15 text-violet-400 animate-pulse")}>
              {subRun.phase === "done" ? tt("完成", "Done")
                : subRun.phase === "tool-call" || subRun.phase === "tool-result" ? (subRun.mode === "read-only" ? tt("调查中", "Investigating") : tt("执行中", "Executing"))
                : tt("运行中", "Running")}
            </span>
          )}
          {showDiffStat && (
            <span className="flex items-center gap-1 text-[10px] font-mono shrink-0">
              {addedLines > 0 && <span className="text-green-500">+{addedLines}</span>}
              {removedLines > 0 && <span className="text-red-400">−{removedLines}</span>}
            </span>
          )}
          {expanded ? <ChevronDown size={13} className="text-muted-foreground shrink-0" /> : <ChevronRight size={13} className="text-muted-foreground shrink-0" />}
        </button>

        {expanded && (
          <div className="px-3 pb-3 border-t border-black/5 dark:border-white/5">
            {isTaskTool && subRun && (
              <div className="mt-2">
                <SubAgentCard run={subRun} />
              </div>
            )}
            <div className="mt-2">
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Input</div>
              {isBashTool ? (
                <CodeBlock language="bash" value={message.toolCall!.input?.command || "No command"} />
              ) : isWriteTool ? (
                <CodeBlock
                  language={detectLang(message.toolCall!.input?.file_path || "")}
                  value={(message.toolCall!.input?.file_path || "") + "\n\n" +
                    (message.toolCall!.input?.content || "")}
                />
              ) : (isEditTool || isMultiEditTool || isApplyDiffTool) ? (
                <CodeBlock language="text" value={message.toolCall!.input?.file_path || tt("(无文件路径)", "(no file path)")} />
              ) : (
                <CodeBlock language="json" value={JSON.stringify(message.toolCall!.input, null, 2)} />
              )}
            </div>
            {hasDiff && (
              <div className="mt-2">
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Diff</div>
                <div className="rounded-lg border border-border overflow-hidden">
                  <DiffBlock value={diffText} />
                </div>
              </div>
            )}
            {message.toolCall!.output && (function() {
              var outText = (toolName === "generate_image" || toolName === "capture_window" || toolName === "read_file")
                ? message.toolCall!.output!.replace(/\n?GENERATED_IMAGE_PATHS:\[[\s\S]*\]\s*$/, "").trimEnd()
                : message.toolCall!.output;
              if (!outText) return null;
              return (
              <div className="mt-2 max-h-64 overflow-y-auto">
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Output</div>
                <CodeBlock
                  language={isBashTool ? "bash" : "text"}
                  value={outText.length > 8000
                    ? outText.slice(0, 8000) + "\n… (truncated)"
                    : outText}
                />
              </div>
              );
            })()}
            <div className="flex gap-2 mt-2">
              {message.toolCall!.input?.file_path && (
                <button onClick={function() { openFileInPreview(resolveFilePath(message.toolCall!.input.file_path)); }}
                  className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors px-2 py-0.5 rounded hover:bg-accent">
                  <FolderOpen size={10} />
                  <span>{tt("预览文件", "Preview file")}</span>
                </button>
              )}
              <button onClick={function() { copyText(JSON.stringify(message.toolCall?.input, null, 2)); }}
                className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors px-2 py-0.5 rounded hover:bg-accent">
                <Copy size={10} />
                <span>Copy</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// memo 边界：工具气泡内含 CodeBlock(高亮)/DiffBlock(diff 解析)/图片，重渲染不便宜。
// 比较只看真实输入 message(身份) 与 expanded —— 回调(onToggle/onResend/onDelete)每次
// 渲染都是新闭包，刻意不比，与 AgentMessage 的 memo 策略一致。流式中正在产出的工具
// 消息每 chunk 由 applyTurn 重建为新对象(身份变) → 比较 false → 照常刷新；已定型的
// 历史工具消息身份稳定 → 跳过重渲染（不会出现「输出不刷新」）。
var ToolBubble = memo(ToolBubbleBase, function(prev, next) {
  return prev.message === next.message && prev.expanded === next.expanded;
});

// 连续工具调用的可收拢组。收拢态只显示一行「已调用 X、Y …，包含图片 N 张」+ 箭头；
// 展开态显示组内每个工具气泡（各自仍可独立展开明细）。组的折叠状态由父级控制。
function ToolGroupBase({ messages, modelName, providerName, showHeader, topGap, collapsed, groupId, onToggleCollapse, expandedToolIds, onToggleTool, sessionId, onResend, onDelete }: {
  messages: ChatMessage[]; modelName?: string; providerName?: string;
  showHeader?: boolean; topGap?: string; collapsed: boolean; groupId: string;
  onToggleCollapse: (groupId: string, currentlyCollapsed: boolean) => void;
  expandedToolIds: Set<string>; onToggleTool: (id: string) => void;
  sessionId: string;
  onResend: (sessionId: string, msg: ChatMessage) => void;
  onDelete: (sessionId: string, msgId: string) => void;
}) {
  var tt = useT();
  var summary = useMemo(function() { return summarizeToolGroup(messages); }, [messages]);
  // 收集本组所有工具产出的图片路径（生图/截图），在聊天区统一展示。
  var groupImages = useMemo(function() {
    var out: string[] = [];
    for (var i = 0; i < messages.length; i++) {
      var tc = messages[i] && messages[i].toolCall;
      if (!tc) continue;
      if (tc.name === "generate_image" || tc.name === "capture_window" || tc.name === "read_file") {
        var imgs = (tc.images && tc.images.length) ? tc.images : parseGeneratedImagePaths(tc.output);
        if (imgs && imgs.length) out = out.concat(imgs);
      } else if (tc.images && tc.images.length) {
        out = out.concat(tc.images);
      }
    }
    return out;
  }, [messages]);

  return (
    <div className={cn("animate-fade-in", topGap)}>
      {showHeader && (
        <div className="flex items-center gap-2 mb-1.5">
          <ProviderIcon model={modelName} name={providerName} size={24} />
          <span className="text-xs text-foreground font-semibold">{displayModelName(modelName, providerName)}</span>
        </div>
      )}
      <div className="ml-8 space-y-2">
        {/* 组折叠条：点击展开/收拢整组。收拢态展示工具清单 + 图片张数。 */}
        <button onClick={function() { onToggleCollapse(groupId, collapsed); }}
          className="w-full max-w-[560px] flex items-center gap-2 px-3 py-1.5 rounded-xl bg-muted/40 hover:bg-muted/70 transition-colors text-left">
          {collapsed ? <ChevronRight size={13} className="text-muted-foreground shrink-0" /> : <ChevronDown size={13} className="text-muted-foreground shrink-0" />}
          <Wrench size={12} className="text-muted-foreground shrink-0" />
          <span className="text-[11px] text-muted-foreground truncate flex-1 min-w-0">
            {collapsed
              ? tt("已调用 ", "Called ") + (summary.names.join(tt("、", ", ")) || tt("工具", "tools")) +
                (summary.imageCount > 0 ? tt("，包含图片 " + summary.imageCount + " 张", ", including " + summary.imageCount + " image(s)") : "")
              : tt("调用了 " + messages.length + " 个工具", "Called " + messages.length + " tools")}
          </span>
        </button>
        {/* 展开态：逐个工具气泡。 */}
        {!collapsed && messages.map(function(m: ChatMessage) {
          return <ToolBubble key={m.id} message={m}
            expanded={expandedToolIds.has(m.id)}
            onToggle={function() { onToggleTool(m.id); }}
            onResend={function() { onResend(sessionId, m); }}
            onDelete={function() { onDelete(sessionId, m.id); }} />;
        })}
        {/* 工具产出的图片（生图/截图等）统一显示在聊天区，不塞进工具气泡内部。
            无论组是否收拢都可见，点击放大。 */}
        {groupImages.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {groupImages.map(function(p: string, i: number) {
              return <ChatImage key={i} path={p} />;
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// memo 边界：messages 是父级每次新建的切片数组，故按「逐项身份」比较而非引用比较 ——
// 流式中正在产出的工具消息每 chunk 被 applyTurn 重建(身份变) → 命中差异 → 整组刷新；
// 一旦该组全部定型，其成员身份稳定，后续别处的流式 chunk 不再触发本组重渲染。
// expandedToolIds(Set) 仅在展开/折叠时换身份，按引用比即可正确响应交互；回调不比。
var ToolGroup = memo(ToolGroupBase, function(prev, next) {
  if (prev.collapsed !== next.collapsed) return false;
  if (prev.showHeader !== next.showHeader) return false;
  if (prev.topGap !== next.topGap) return false;
  if (prev.groupId !== next.groupId) return false;
  if (prev.modelName !== next.modelName || prev.providerName !== next.providerName) return false;
  if (prev.expandedToolIds !== next.expandedToolIds) return false;
  if (prev.sessionId !== next.sessionId) return false;
  // 逐项身份比较 messages（长度 + 每条对象引用）。
  if (prev.messages.length !== next.messages.length) return false;
  for (var i = 0; i < prev.messages.length; i++) {
    if (prev.messages[i] !== next.messages[i]) return false;
  }
  return true;
});

function AgentMessageBase({ message, modelName, providerName, showHeader = true, showFooter = true, usageText = "", topGap = "", expanded, onToggle, onResend, onDelete }: {
  message: ChatMessage; modelName?: string; providerName?: string; showHeader?: boolean; showFooter?: boolean; usageText?: string; topGap?: string;
  expanded: boolean; onToggle: () => void;
  onResend: () => void; onDelete: () => void;
}) {
  var tt = useT();
  var [copied, setCopied] = useState(false);
  var projectPath = useAppStore(function(s) { return s.projectPath; });
  var msgMenu = useContextMenu();

  var copyText = async function(text: string) {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(function() { setCopied(false); }, 2000); } catch(e) {}
  };

  // 按消息角色构造右键菜单项。sel = 右键时快照的选区文本（有则「复制选中」优先）。
  var buildMsgMenu = function(sel?: string): ContextMenuItem[] {
    var items: ContextMenuItem[] = [];
    // 有选中文本：第一项永远是「复制选中」（复制真实选区，而非整条消息全文）。
    if (sel) {
      items.push({ label: tt("复制选中", "Copy selection"), icon: <Copy size={13} />, onClick: function() { copyText(sel); } });
    }
    if (message.role === "tool" && message.toolCall) {
      var fp = message.toolCall.input?.file_path;
      if (fp) items.push({ label: tt("预览文件", "Preview file"), icon: <FolderOpen size={13} />, onClick: function() { openFileInPreview(resolveFilePath(fp)); } });
      if (message.toolCall.output) items.push({ label: tt("复制输出", "Copy output"), icon: <Copy size={13} />, onClick: function() { copyText(message.toolCall!.output || ""); } });
      items.push({ label: tt("复制输入 JSON", "Copy input JSON"), icon: <Copy size={13} />, onClick: function() { copyText(JSON.stringify(message.toolCall?.input, null, 2)); } });
    } else {
      items.push({ label: sel ? tt("复制全文", "Copy all") : tt("复制", "Copy"), icon: <Copy size={13} />, onClick: function() { copyText(message.content); } });
    }
    if (message.role === "user") {
      items.push({ label: tt("重新发送", "Resend"), icon: <RefreshCw size={13} />, onClick: onResend });
    }
    items.push({ label: tt("删除", "Delete"), icon: <Trash2 size={13} />, danger: true, separatorBefore: true, onClick: onDelete });
    return items;
  };

  // Resolve a tool's (possibly relative) file_path against the project root.
  var resolveFilePath = function(fp: string): string {
    if (!fp) return fp;
    var isAbs = /^([a-zA-Z]:[\\/]|[\\/])/.test(fp);
    if (isAbs || !projectPath) return fp;
    return projectPath.replace(/[\\/]+$/, "") + "/" + fp.replace(/^[\\/]+/, "");
  };

  // 压缩分隔标记：对话流里一条波浪线 + 「上下文已压缩 · 省下 X」标签。只读、纯 UI——
  // 摘要本身不在界面展示（仅作发送侧上下文），不进入发往 AI 的历史。
  if (message.divider) {
    var ci = message.compactInfo;
    var savedLabel = "";
    if (ci && ci.before > 0) {
      var saved = Math.max(0, ci.before - ci.after);
      savedLabel = tt("约 ", "~") + fmtTokens(ci.before) + " → " + fmtTokens(ci.after) + tt(" tokens（省下 ", " tokens (saved ") + fmtTokens(saved) + tt("）", ")");
    }
    return (
      <div id={"msg-" + message.id} className={cn("animate-fade-in flex items-center gap-2 py-1.5", topGap)}>
        <WavyLine />
        <span className="shrink-0 flex items-center gap-1 text-[10px] text-muted-foreground/60">
          <Scissors size={10} /> {tt("上下文已压缩", "Context compacted")}{savedLabel && <span className="text-muted-foreground/40">· {savedLabel}</span>}
        </span>
        <WavyLine />
      </div>
    );
  }

  // 内联灰色提示（API 报错 / 自动压缩通知等）：只读、可整段选中复制，完整展示报错原文。
  if (message.errorNotice) {
    return (
      <div id={"msg-" + message.id} className={cn("animate-fade-in flex items-start gap-1.5 py-1 px-1", topGap)}>
        <AlertCircle size={11} className="shrink-0 mt-[3px] text-muted-foreground/50" />
        <span className="text-[11px] leading-relaxed text-muted-foreground/70 whitespace-pre-wrap break-words select-text">
          {message.errorNotice}
        </span>
      </div>
    );
  }

  // User message
  if (message.role === "user") {
    return (
      <div id={"msg-" + message.id} onContextMenu={function(e: any) { var sel = (window.getSelection && window.getSelection()?.toString() || "").trim(); msgMenu.openMenu(e, buildMsgMenu(sel)); }}
        className={cn("flex justify-end group items-end gap-1 animate-fade-in rounded-2xl", topGap)}>
        {msgMenu.ContextMenuEl}
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity self-center">
          <button onClick={onResend} title={tt("重新发送", "Resend")}
            className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground">
            <RefreshCw size={12} />
          </button>
          <button onClick={onDelete} title={tt("删除", "Delete")}
            className="p-1 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive">
            <Trash2 size={12} />
          </button>
        </div>
        <div className="max-w-[80%] rounded-2xl rounded-br-md bg-foreground text-background px-4 py-2.5">
          {message.images && message.images.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-1.5">
              {message.images.map(function(p: string, i: number) {
                return <ChatImage key={i} path={p} />;
              })}
            </div>
          )}
          {message.content && (
            <p className="whitespace-pre-wrap" style={{ fontSize: "var(--chat-font-size)" }}>{message.content}</p>
          )}
          <span className="text-[10px] opacity-50 mt-1 block text-right">
            {new Date(message.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
        </div>
      </div>
    );
  }

  // TOOL CALL — 委托给 ToolBubble 渲染（与折叠组 ToolGroup 共用同一套气泡逻辑）。
  // 思考过程(__thinking__):提为正文样式独立渲染——与正文同字号/缩进/Markdown,仅颜色
  // 淡一点点(text-foreground/70)以区分「思考」与「回答」;始终展开、不折叠(用户要求)。
  // 思考文本流式累积在 toolCall.output,逐字实时更新。不再走 ToolBubble 折叠卡。
  if (message.role === "tool" && message.toolCall && message.toolCall.name === "__thinking__") {
    var thinkBody = message.toolCall.output || "";
    return (
      <div id={"msg-" + message.id} onContextMenu={function(e: any) { msgMenu.openMenu(e, [
        { label: tt("复制思考", "Copy thinking"), icon: <Copy size={13} />, onClick: function() { copyText(thinkBody); } },
        { label: tt("删除", "Delete"), icon: <Trash2 size={13} />, danger: true, separatorBefore: true, onClick: onDelete },
      ]); }}
        className={cn("flex justify-start group animate-fade-in rounded-2xl", topGap)}>
        {msgMenu.ContextMenuEl}
        <div className="max-w-[85%] w-full space-y-1.5">
          {showHeader && (
            <div className="flex items-center gap-2">
              <ProviderIcon model={modelName} name={providerName} size={24} />
              <span className="text-xs text-foreground font-semibold">{displayModelName(modelName, providerName)}</span>
            </div>
          )}
          <div className="pl-8">
            {/* 思考用更淡的灰色 + 比正文小一号。
                - 颜色:Markdown 内部 prose 会给 p/li/标题/加粗等设自身色,盖过父级 text-*,
                  故用 prose 修饰类直接改各元素为 muted 灰。
                - 字号:Markdown 根用内联 style 读 var(--chat-font-size),内部元素用 text-[1em]
                  相对它。在外层把 --chat-font-size 重定义为 0.9em(相对正文),思考整体即缩小
                  一号,且随聊天字号设置同步缩放。 */}
            <div style={{ ["--chat-font-size" as any]: "0.9em" }}>
              <Markdown className="prose-p:text-muted-foreground prose-li:text-muted-foreground prose-headings:text-muted-foreground prose-strong:text-muted-foreground prose-code:text-muted-foreground prose-a:text-muted-foreground">
                {thinkBody || (message.streaming ? "..." : "")}
              </Markdown>
            </div>
            {message.streaming && (
              <span className="inline-block w-1.5 h-4 bg-muted-foreground/40 animate-pulse ml-0.5 align-text-bottom" />
            )}
          </div>
        </div>
      </div>
    );
  }

  // 这里保留轮次头部 + 顶部间距 + 左缩进的外层包装。正常情况下连续工具会走 ToolGroup，
  // 这条分支兜底单独出现的工具消息。
  if (message.role === "tool" && message.toolCall) {
    return (
      <div className={cn("animate-fade-in", topGap)}>
        {showHeader && (
          <div className="flex items-center gap-2 mb-1.5">
            <ProviderIcon model={modelName} name={providerName} size={24} />
            <span className="text-xs text-foreground font-semibold">{displayModelName(modelName, providerName)}</span>
          </div>
        )}
        <div className="ml-8">
          <ToolBubble message={message} expanded={expanded} onToggle={onToggle} onResend={onResend} onDelete={onDelete} />
        </div>
      </div>
    );
  }

  // Assistant message
  return (
    <div id={"msg-" + message.id} onContextMenu={function(e: any) { var sel = (window.getSelection && window.getSelection()?.toString() || "").trim(); msgMenu.openMenu(e, buildMsgMenu(sel)); }}
      className={cn("flex justify-start group animate-fade-in rounded-2xl", topGap)}>
      {msgMenu.ContextMenuEl}
      <div className="max-w-[85%] w-full space-y-1.5">
        {showHeader && (
          <div className="flex items-center gap-2">
            <ProviderIcon model={modelName} name={providerName} size={24} />
            <span className="text-xs text-foreground font-semibold">{displayModelName(modelName, providerName)}</span>
            {message.tokens && (
              <span className="text-[9px] text-muted-foreground/50">{message.tokens.toLocaleString()} tokens</span>
            )}
            {message.cost && (
              <span className="text-[9px] text-muted-foreground/50">{message.cost}</span>
            )}
          </div>
        )}
        {/* Body indented past the avatar so it reads as a child of the header. */}
        <div className="pl-8">
          <div className="text-foreground/90" style={{ fontSize: "var(--chat-font-size)" }}>
            <Markdown>{message.content || (message.streaming ? "..." : "")}</Markdown>
          </div>
          {/* 直接出图：图片直接显示在 assistant 气泡里（不再包成工具）。点击放大。 */}
          {message.images && message.images.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-2">
              {message.images.map(function(p: string, i: number) {
                return <ChatImage key={i} path={p} />;
              })}
            </div>
          )}
          {message.streaming && (
            <span className="inline-block w-1.5 h-4 bg-foreground/50 animate-pulse ml-0.5 align-text-bottom" />
          )}
          <div className="flex items-center justify-between mt-2 h-4">
            <span className="text-[10px] text-muted-foreground/40">
              {showFooter ? new Date(message.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}
            </span>
            <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-all">
              {usageText && (
                <span className="text-[10px] text-muted-foreground/50 tabular-nums mr-0.5">{usageText}</span>
              )}
              <button onClick={function() { copyText(message.content); }}
                className="p-1 rounded hover:bg-accent" title={tt("复制", "Copy")}>
                {copied ? <Check size={12} className="text-green-500" /> : <Copy size={12} className="text-muted-foreground" />}
              </button>
              <button onClick={onDelete} className="p-1 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive" title={tt("删除", "Delete")}>
                <Trash2 size={12} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// React.memo 包装：配合上面 messageList 的 useMemo，让打字（仅改 input）不再重渲染
// 每一条消息。比较只看真正影响渲染的「数据」props，忽略每次重算列表都会新建的
// onToggle/onResend/onDelete 闭包标识——这些闭包行为对同一条消息恒等，纳入比较只会
// 让 memo 永远失效。消息对象在流式时是新引用（applyTurn 重建），故内容变化能正常更新。
var AgentMessage = memo(AgentMessageBase, function(prev, next) {
  return prev.message === next.message &&
    prev.modelName === next.modelName &&
    prev.providerName === next.providerName &&
    prev.showHeader === next.showHeader &&
    prev.showFooter === next.showFooter &&
    prev.usageText === next.usageText &&
    prev.topGap === next.topGap &&
    prev.expanded === next.expanded;
});

// 计划卡的 Markdown 单独 memo：计划全文（可能很长、含多代码块/Mermaid）只在 plan 文本
// 真正变化时才重渲染。否则 FollowupCard 输入框每敲一字 → ChatView 顶层 state 变 →
// 整段计划 markdown 全量解析+高亮重渲染，导致输入卡顿。memo 边界切断这条重渲染链，
// 完整保留 markdown 渲染效果（不砍内容、不降级）。
var PlanMarkdown = memo(function(props: { plan: string }) {
  return <Markdown>{props.plan}</Markdown>;
}, function(prev, next) { return prev.plan === next.plan; });


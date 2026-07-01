import { useEffect, useRef } from "react";
import { useAppStore } from "../../stores/app-store";
import { useChatStore } from "../../stores/chat-store";
import { useProviderStore } from "../../stores/provider-store";
import { useSearchStore } from "../../stores/search-store";
import { tr } from "../../lib/i18n";
import { estimateTokens } from "../../lib/token-count";

/**
 * DiscordRelay — 常驻（不随视图卸载）的转发中枢。
 *
 * Bot 只是管道：主进程把 Discord 的 /ask、/session 经 IPC 发到这里，这里用桌面
 * 已经选好的 Provider 在「Discord 专用会话」里正常跑一轮（消息也出现在桌面聊天里），
 * 拿到最终回复后经 *Response 回送给主进程 → 转发回 Discord。
 *
 * 设计要点：
 * - 复用桌面已选 Provider/Key（resolveProvider），Bot 自己不持有任何凭证。
 * - 跑一轮用 bypassPermissions：手机端无法弹授权框，故工具自动放行；followup 仍会
 *   落到桌面让你回答（agentSend 会等待，最长 15 分钟）。
 * - 去重：agentSend 内部经 agent:turn 把 assistant/tool 块写进 store（ChatView 挂载
 *   时）。本组件按 runId 检查——若该轮块已存在则不重复追加，否则（ChatView 未挂载时）
 *   手动补一条 assistant 终答，保证桌面始终留有记录。
 */
export function DiscordRelay() {
  const projectPath = useAppStore((s) => s.projectPath);
  // 每个平台来源各自的目标会话 id（discord / telegram 互不串台）。可被该来源的
  // /session new、/session switch 改变。键为 relaySource，旧 Discord 路径默认 "discord"。
  const targetRefs = useRef<Record<string, string | null>>({});
  // 活跃一轮的 sessionId → { source, channelId }：供把 todos/error 只读推送到对应平台。
  // 一轮结束（runTurn 返回）即清掉，避免桌面端自己的会话误推。
  const activeRunRef = useRef<Record<string, { source: string; channelId: string }>>({});
  // 每个来源的权限模式（手机端远程一轮用它，取代旧的写死 bypassPermissions）。
  // 默认 default（询问 → 审批卡转手机）；可由 /mode 命令切换。
  const permModeRefs = useRef<Record<string, string>>({});
  // projectPath 放进 ref，供事件回调读取最新值（回调注册一次）。
  const projectPathRef = useRef(projectPath);
  projectPathRef.current = projectPath;

  // 同步项目路径到主进程（/file /git /run /search 需要 cwd；/ask 也用作 workingDir）。
  useEffect(() => {
    if (projectPath) {
      try { (window.api as any).discordSetWorkingDir?.(projectPath); } catch {}
    }
  }, [projectPath]);

  useEffect(() => {
    const api: any = window.api;
    if (!api) return;

    // 找到（或新建）某来源的目标会话，返回其 id。source 区分 discord/telegram。
    // 默认「跟随桌面」：未显式锁定目标时，作用在桌面当前活动会话上，使手机与桌面
    // 同一上下文——远程切模型/模式/游戏/压缩都落在用户正看着的会话里。只有用户在该
    // 来源做过 /session new 或 /session switch 才锁定专属会话（targetRefs）。
    const ensureTarget = (source: string, preferName?: string): string => {
      const store = useChatStore.getState();
      const prov = useProviderStore.getState();
      const cur = targetRefs.current[source];
      // 已有「显式锁定」的有效目标 → 复用（用户在该来源 new/switch 过）。
      const existing = cur && store.sessions.find((s) => s.id === cur);
      if (existing && !preferName) return existing.id;
      // 否则跟随桌面活动会话（不锁 targetRefs，持续跟随桌面后续切换）。
      if (!preferName) {
        const active = store.activeSessionId;
        if (active && store.sessions.find((s) => s.id === active)) return active;
      }
      // 桌面无任何会话（或显式新建）→ 建新会话并锁定为该来源专属目标。
      const selProv = prov.providers.find((p) => p.id === prov.selectedProviderId);
      const id = store.createSession(selProv?.name || "Agent", prov.selectedModel || "");
      const label = preferName || (source === "telegram" ? "Telegram" : "Discord");
      store.renameSession(id, label);
      targetRefs.current[source] = id;
      return id;
    };

    // 复制桌面 buildImageGenConfig 的精简版：列出所有「图片生成」供应商，构建 agent
    // loop 的 generate_image 工具所需配置（含 providers 池，AI 可用 provider/model 参数
    // 切换；主进程按 providerId 解密 key）。无图片供应商则 undefined（工具自会回提示）。
    // 没有这个，手机端让 AI 生图时 agent loop 缺图片供应商上下文 → 工具调用报错。
    const buildRelayImageGen = (preferId?: string): any => {
      const provs = useProviderStore.getState().providers as any[];
      const imgs = provs.filter((p) => p.imageGen && p.hasKey && p.baseUrl && (p.models?.[0] || ""));
      if (imgs.length === 0) return undefined;
      const pick = imgs.find((x) => x.id === preferId) || imgs[0];
      const ep = (x: any) => (x.imageEndpoint === "chat" ? "chat" : x.imageEndpoint === "raw" ? "raw" : "images");
      const hdr = (x: any) => (x.headers && Object.keys(x.headers).length ? x.headers : undefined);
      const pool = imgs.map((x) => ({
        providerId: x.id, name: x.name, baseUrl: x.baseUrl, model: x.models[0] || "",
        models: Array.isArray(x.models) ? x.models : [], endpoint: ep(x), headers: hdr(x),
      }));
      return {
        providerId: pick.id, baseUrl: pick.baseUrl, model: pick.models[0] || "",
        endpoint: ep(pick), headers: hdr(pick), providers: pool,
      };
    };

    // ---- /ask：用桌面已选 Provider 在目标会话里跑一轮 ----
    const offRun = api.onDiscordRunTurn?.(async (data: { reqId: string; prompt: string; channelId: string; relaySource?: string; relayChannelId?: string; images?: string[] }) => {
      const respond = (r: { ok: boolean; text?: string; error?: string; images?: string[] }) => {
        try { api.discordRunTurnResponse?.(data.reqId, r); } catch {}
      };
      try {
        const cwd = projectPathRef.current;
        if (!cwd) { respond({ ok: false, error: tr("桌面端尚未打开任何项目，请先在桌面打开一个项目。", "No project is open on the desktop yet. Please open a project there first.") }); return; }

        const provStore = useProviderStore.getState();
        const selProv = provStore.providers.find((p) => p.id === provStore.selectedProviderId);
        if (!selProv) { respond({ ok: false, error: tr("桌面端未选择 Provider，请先在「设置 → Providers」中配置并选择一个。", "No Provider selected on the desktop. Configure and select one under Settings → Providers first.") }); return; }
        const model = provStore.selectedModel || selProv.models[0];
        if (!model) { respond({ ok: false, error: tr("当前 Provider 没有可用模型，请在设置中填写模型名。", "The current Provider has no available model. Set a model name in settings.") }); return; }
        const resolved = await provStore.resolve(selProv.id);
        if (!resolved || !resolved.apiKey) { respond({ ok: false, error: tr("当前 Provider 未配置 API Key，请在设置中填写。", "The current Provider has no API Key configured. Set one in settings.") }); return; }

        const source = data.relaySource || "discord";
        const sessionId = ensureTarget(source);
        const store = useChatStore.getState();

        // 追加用户消息（立即可见 + 落盘）。手机发来的图片路径挂到 images（vision）。
        const userImages = Array.isArray(data.images) && data.images.length ? data.images : undefined;
        store.addMessage(sessionId, {
          id: "msg-" + Date.now(), role: "user", content: data.prompt, timestamp: Date.now(), images: userImages,
        });

        // 构建发往 API 的历史：user/assistant 文本（工具消息不回放，简洁可靠）。
        // 末条 user 带上本轮图片（后端从路径读出转 base64）。
        const sess = useChatStore.getState().sessions.find((s) => s.id === sessionId);
        const apiMessages = (sess?.messages || [])
          .filter((m) => m.role === "user" || m.role === "assistant")
          .map((m: any) => ({ role: m.role, content: m.content, images: m.images }));

        const runId = "discord-run-" + Date.now();
        // 记录活跃一轮：仅新 relay 路径（带 relaySource）才推送 todos/error 到平台。
        if (data.relaySource && data.relayChannelId) {
          activeRunRef.current[sessionId] = { source: data.relaySource, channelId: data.relayChannelId };
        }
        let res: any;
        try {
          // 权限/行为模式：优先取目标会话自身的设置（手机或桌面任一改了都生效），
          // 回退到该来源的 permModeRefs，再回退 default。chat/game/effort 仅在会话上，
          // 必须读会话才能让手机切的「游戏模式」等真正作用到本轮（与桌面 runTurn 对齐）。
          const permMode = (sess as any)?.permissionMode || permModeRefs.current[source] || "default";
          res = await api.agentSend({
            sessionId,
            runId,
            provider: resolved,
            model,
            messages: apiMessages,
            workingDir: cwd,
            // 手机端按当前权限模式：default 会把审批卡转到手机（双通道），
            // bypassPermissions 则全放行。由 /mode 命令切换。
            permissionMode: permMode,
            chatMode: (sess as any)?.chatMode,
            // 游戏模式在手机端会出问题，relay 一轮强制关闭（即便桌面活动会话开着游戏模式）。
            gameMode: false,
            effort: (sess as any)?.effort,
            thinkingMode: (sess as any)?.thinkingMode,
            search: { kinds: useSearchStore.getState().enabledKinds() },
            // 图片生成：把「图片生成」供应商配置带上，generate_image 工具才能在 agent
            // loop 里出图（与桌面 runTurn 同源）。没有此项时手机端生图会报工具调用错误。
            imageGen: buildRelayImageGen(selProv.id),
            // 标记本轮来自 Discord：主进程据此把 agent 的提问/计划卡转回该频道
            // （桌面卡片仍照常弹，双通道任一先答即采用）。
            discordChannelId: data.channelId,
            // 新统一 Relay 通道：透传平台来源，使 followup 经 RelayCore 转回对应平台
            // （Discord/Telegram）。旧 discordChannelId 仍保留以兼容旧路径。
            relaySource: data.relaySource,
            relayChannelId: data.relayChannelId,
          });
        } finally {
          delete activeRunRef.current[sessionId];
        }

        if (res && res.error) { respond({ ok: false, error: tr("桌面端执行失败：", "Desktop execution failed: ") + res.error }); return; }
        const finalText: string = (res && res.result) || "";

        // 等一拍让 agent:turn 的 done 快照落库（图片路径经快照异步写入 store，agentSend
        // 返回与 done 快照之间有竞态；不等会读不到本轮 tool 消息/图片）。
        await new Promise((r) => setTimeout(r, 250));

        // 去重：若 ChatView 已经把该轮（同 runId）写进 store，就不重复追加；否则补一条。
        const after = useChatStore.getState().sessions.find((s) => s.id === sessionId);
        const hasTurnBlock = !!after?.messages.some((m) => m.runId === runId);
        if (!hasTurnBlock && finalText) {
          useChatStore.getState().addMessage(sessionId, {
            id: "msg-" + Date.now() + "-dc", role: "assistant", content: finalText, timestamp: Date.now(), runId,
          });
        }

        // 收集本轮 AI 产出的图片回传手机。生图路径埋在 tool 消息 output 的
        // GENERATED_IMAGE_PATHS:[...] 标记里（与桌面 ChatView 取图同源），也兼容 toolCall.images。
        const turnMsgs = (after?.messages || []).filter((m: any) => m.runId === runId);
        const genImages: string[] = [];
        const parsePaths = (output?: string): string[] => {
          if (!output) return [];
          const mm = /GENERATED_IMAGE_PATHS:(\[[\s\S]*\])\s*$/.exec(output);
          if (!mm) return [];
          try { const a = JSON.parse(mm[1]); return Array.isArray(a) ? a.filter((x: any) => typeof x === "string") : []; }
          catch { return []; }
        };
        for (const m of turnMsgs as any[]) {
          const tc = m?.toolCall;
          if (tc) {
            if (Array.isArray(tc.images)) for (const p of tc.images) if (typeof p === "string") genImages.push(p);
            for (const p of parsePaths(tc.output)) genImages.push(p);
          }
        }
        // 模型有时不走 generate_image 工具，而把图片以 Markdown 图 / 裸图片 URL / data URI
        // 直接写进正文。这些不在 GENERATED_IMAGE_PATHS 里，手机端只会看到一个链接。
        // 这里从正文抽出来，作为内联图片一并回传，并把它们从发给手机的文本里剥掉（去链接）。
        let phoneText = finalText;
        const fromText: string[] = [];
        const pushUniq = (u: string) => { if (u && fromText.indexOf(u) === -1) fromText.push(u); };
        // Markdown 图 ![alt](url|dataURI)
        phoneText = phoneText.replace(/!\[[^\]]*\]\((data:image\/[^)]+|https?:\/\/[^\s)]+)\)/g, (_m, u) => { pushUniq(u); return ""; });
        // 裸图片 URL（按扩展名判断）
        phoneText = phoneText.replace(/(https?:\/\/[^\s)]+\.(?:png|jpe?g|webp|gif)(?:\?[^\s)]*)?)/gi, (u) => { pushUniq(u); return ""; });
        phoneText = phoneText.replace(/\n{3,}/g, "\n\n").trim();
        for (const u of fromText) genImages.push(u);
        const uniqImages = Array.from(new Set(genImages));

        respond({ ok: true, text: phoneText || tr("(已生成图片)", "(Image generated)"), images: uniqImages.length ? uniqImages : undefined });
      } catch (err: any) {
        respond({ ok: false, error: err?.message || String(err) });
      }
    });

    // ---- /session：new / list / switch（含 /stop 的 __stop__ 特例）----
    const offSession = api.onDiscordSessionOp?.(async (data: { reqId: string; op: "new" | "list" | "switch"; arg?: string; relaySource?: string }) => {
      const respond = (r: { ok: boolean; text?: string; error?: string }) => {
        try { api.discordSessionOpResponse?.(data.reqId, r); } catch {}
      };
      try {
        const source = data.relaySource || "discord";
        const label = source === "telegram" ? "Telegram" : "Discord";
        const store = useChatStore.getState();

        if (data.op === "new") {
          const id = ensureTarget(source, data.arg && data.arg.trim() ? data.arg.trim() : label);
          store.setActiveSession(id);
          const name = useChatStore.getState().sessions.find((s) => s.id === id)?.name || label;
          respond({ ok: true, text: tr("🆕 已新建并切换到会话：**", "🆕 Created and switched to session: **") + name + "**" });
          return;
        }

        if (data.op === "list") {
          const sessions = useChatStore.getState().sessions;
          if (sessions.length === 0) { respond({ ok: true, text: tr("暂无会话。用 `/session new` 新建一个。", "No sessions yet. Use `/session new` to create one.") }); return; }
          const activeId = useChatStore.getState().activeSessionId;
          const myTarget = targetRefs.current[source];
          const lines = sessions.map((s, i) => {
            const marks = [
              s.id === myTarget ? "📨" : "",            // 当前来源的路由目标
              s.id === activeId ? "👁️" : "",            // 桌面当前活动会话
            ].filter(Boolean).join("");
            return (i + 1) + ". " + (marks ? marks + " " : "") + (s.name || tr("未命名", "Untitled")) + tr("（", " (") + s.messages.length + tr(" 条）", " msgs)");
          });
          respond({ ok: true, text: tr("🗂️ **会话列表**（📨=当前目标 👁️=桌面活动）\n", "🗂️ **Sessions** (📨=current target 👁️=desktop active)\n") + lines.join("\n") });
          return;
        }

        // switch
        const target = (data.arg || "").trim();
        if (target === "__stop__") {
          // /stop：中止当前来源目标会话正在跑的一轮。
          const id = targetRefs.current[source];
          if (!id) { respond({ ok: false, error: tr("当前没有会话。", "There is no session.") }); return; }
          try { await api.agentStop?.(id); } catch {}
          respond({ ok: true });
          return;
        }

        const sessions = useChatStore.getState().sessions;
        let found = null as null | { id: string; name: string };
        const asIndex = parseInt(target, 10);
        if (!isNaN(asIndex) && String(asIndex) === target && asIndex >= 1 && asIndex <= sessions.length) {
          const s = sessions[asIndex - 1];
          found = { id: s.id, name: s.name };
        } else {
          const s = sessions.find((x) => (x.name || "").toLowerCase() === target.toLowerCase());
          if (s) found = { id: s.id, name: s.name };
        }
        if (!found) { respond({ ok: false, error: tr("找不到会话「", "Session not found: \"") + target + tr("」。用 `/session list` 查看可用会话。", "\". Use `/session list` to see available sessions.") }); return; }
        targetRefs.current[source] = found.id;
        store.setActiveSession(found.id);
        respond({ ok: true, text: tr("✅ 已切换到会话：**", "✅ Switched to session: **") + (found.name || tr("未命名", "Untitled")) + "**" });
      } catch (err: any) {
        respond({ ok: false, error: err?.message || String(err) });
      }
    });

    // ---- /provider：列出 / 切换供应商与模型 ----
    // list → 返回按钮菜单（每供应商一个按钮，>8 个分页）；switch arg="2" 或 "2.3"。
    const offProvider = api.onDiscordProviderOp?.(async (data: { reqId: string; op: "list" | "switch"; arg?: string }) => {
      const respond = (r: { ok: boolean; text?: string; error?: string; menu?: { title: string; items: { label: string; value: string }[] } }) => {
        try { api.discordProviderOpResponse?.(data.reqId, r); } catch {}
      };
      try {
        const prov = useProviderStore.getState();
        const list = prov.providers;
        if (list.length === 0) { respond({ ok: false, error: tr("尚未配置任何供应商。请在桌面「设置 → API 供应商」添加。", "No providers configured. Add one under Settings → API Providers on the desktop.") }); return; }
        // 把切换后的供应商/模型绑定到桌面活动会话——否则桌面顶栏读的是「会话绑定的
        // provider/model」，只改全局 useProviderStore 顶栏不会变（bug：切模型桌面没改）。
        const bindSessionModel = (pid: string, pname: string, model: string) => {
          const sid = useChatStore.getState().activeSessionId;
          if (sid) useChatStore.getState().setSessionModel(sid, pid, pname, model || "");
        };

        if (data.op === "list") {
          // 分页：每页 8 个供应商。arg 形如 "page:2"。
          const PER = 8;
          const pageMatch = /^page:(\d+)$/.exec(data.arg || "");
          const page = pageMatch ? Math.max(1, parseInt(pageMatch[1], 10)) : 1;
          const totalPages = Math.max(1, Math.ceil(list.length / PER));
          const start = (page - 1) * PER;
          const pageItems = list.slice(start, start + PER);
          const items = pageItems.map((p, k) => {
            const i = start + k;
            const cur = p.id === prov.selectedProviderId;
            return { label: (cur ? "▶ " : "") + (p.name || "未命名") + (p.hasKey ? "" : " (无Key)"), value: "provpick:" + (i + 1) };
          });
          if (totalPages > 1) {
            if (page > 1) items.push({ label: "⬅️ 上一页", value: "provpage:" + (page - 1) });
            if (page < totalPages) items.push({ label: "➡️ 下一页", value: "provpage:" + (page + 1) });
          }
          respond({ ok: true, menu: { title: "🧩 选择供应商（" + page + "/" + totalPages + "，▶=当前）", items } });
          return;
        }

        // switch
        const raw = (data.arg || "").trim();
        // provpick:N → 选中供应商后弹该供应商的模型按钮菜单。
        const pick = /^provpick:(\d+)$/.exec(raw);
        if (pick) {
          const pi = parseInt(pick[1], 10) - 1;
          if (pi < 0 || pi >= list.length) { respond({ ok: false, error: tr("供应商序号超出范围。", "Provider index out of range.") }); return; }
          const p = list[pi];
          const models = p.models || [];
          if (models.length === 0) {
            // 无模型列表 → 直接切供应商。
            prov.setSelectedProviderId(p.id);
            bindSessionModel(p.id, p.name || "", useProviderStore.getState().selectedModel || "");
            respond({ ok: true, text: tr("✅ 已切换到：**", "✅ Switched to: **") + (p.name || "") + "**" });
            return;
          }
          const items = models.slice(0, 40).map((mm, j) => ({ label: (p.id === prov.selectedProviderId && mm === prov.selectedModel ? "✅ " : "") + mm, value: "provsw:" + (pi + 1) + "." + (j + 1) }));
          // 返回上一级（供应商列表）。
          items.push({ label: "⬅️ 返回供应商", value: "provback" });
          respond({ ok: true, menu: { title: "🧩 " + (p.name || "") + " — 选择模型", items } });
          return;
        }
        const m = /^(?:provsw:)?(\d+)(?:\.(\d+))?$/.exec(raw);
        if (!m) { respond({ ok: false, error: tr("格式：2 或 2.3（供应商.模型）。", "Format: 2 or 2.3 (provider.model).") }); return; }
        const pi = parseInt(m[1], 10) - 1;
        if (pi < 0 || pi >= list.length) { respond({ ok: false, error: tr("供应商序号超出范围。", "Provider index out of range.") }); return; }
        const p = list[pi];
        prov.setSelectedProviderId(p.id);
        let model = "";
        if (m[2]) {
          const mi = parseInt(m[2], 10) - 1;
          if (mi < 0 || mi >= (p.models || []).length) { respond({ ok: false, error: tr("模型序号超出范围。", "Model index out of range.") }); return; }
          model = p.models[mi];
          prov.setSelectedModel(model);
        } else {
          model = useProviderStore.getState().selectedModel || (p.models || [])[0] || "";
        }
        bindSessionModel(p.id, p.name || "", model);
        respond({ ok: true, text: tr("✅ 已切换到：**", "✅ Switched to: **") + (p.name || "") + "** / " + (model || tr("（无模型）", "(no model)")) });
      } catch (err: any) {
        respond({ ok: false, error: err?.message || String(err) });
      }
    });

    // ---- /mode：查看 / 切换该来源的权限模式 ----
    const MODE_KEYS = ["default", "acceptEdits", "bypassPermissions", "plan"];
    const MODE_LABELS: Record<string, string> = {
      default: tr("询问（每个改动前审批）", "Ask (approve each change)"),
      acceptEdits: tr("自动批准编辑", "Auto-approve edits"),
      bypassPermissions: tr("完全放行（谨慎）", "Full bypass (caution)"),
      plan: tr("计划模式（只读）", "Plan mode (read-only)"),
    };
    const offMode = api.onDiscordModeOp?.(async (data: { reqId: string; mode?: string; relaySource?: string }) => {
      const respond = (r: { ok: boolean; text?: string; error?: string; menu?: { title: string; items: { label: string; value: string }[] } }) => {
        try { api.discordModeOpResponse?.(data.reqId, r); } catch {}
      };
      try {
        const src = data.relaySource || "discord";
        const cur = permModeRefs.current[src] || "default";
        if (!data.mode) {
          // 返回按钮菜单：每个模式一个按钮。
          const items = MODE_KEYS.map((m) => ({ label: (m === cur ? "▶ " : "") + m + " — " + MODE_LABELS[m], value: "modeset:" + m }));
          respond({ ok: true, menu: { title: tr("🔐 选择权限模式（▶=当前）", "🔐 Choose permission mode (▶=current)"), items } });
          return;
        }
        // 接受：数字序号、规范名、别名（ask→default, auto/acceptedits→acceptEdits, yolo/bypass→bypassPermissions）
        const raw = data.mode.trim().toLowerCase();
        const byNum = parseInt(raw, 10);
        let m = "";
        if (!isNaN(byNum) && String(byNum) === raw && byNum >= 1 && byNum <= MODE_KEYS.length) {
          m = MODE_KEYS[byNum - 1];
        } else {
          const map: Record<string, string> = {
            default: "default", ask: "default",
            acceptedits: "acceptEdits", auto: "acceptEdits", accept: "acceptEdits",
            bypasspermissions: "bypassPermissions", bypass: "bypassPermissions", yolo: "bypassPermissions",
            plan: "plan",
          };
          m = map[raw];
        }
        if (!m) { respond({ ok: false, error: tr("未知模式。可用：1-4 或 default / acceptEdits / bypassPermissions / plan。", "Unknown mode. Use 1-4 or default / acceptEdits / bypassPermissions / plan.") }); return; }
        permModeRefs.current[src] = m;
        // 同步到该来源目标会话的 store，使桌面 UI（权限下拉/盾牌/plan 角标）实时跟随。
        // 确保目标会话存在并设为活动，桌面才看得到角标变化。
        try {
          const sid = ensureTarget(src);
          useChatStore.getState().setSessionPermissionMode(sid, m as any);
          useChatStore.getState().setActiveSession(sid);
        } catch {}
        respond({ ok: true, text: tr("✅ 权限模式已切换为：", "✅ Permission mode set to: ") + m + " — " + MODE_LABELS[m] });
      } catch (err: any) {
        respond({ ok: false, error: err?.message || String(err) });
      }
    });

    // ---- /chat /agent /compact：UI 行为，作用于该来源目标会话并同步桌面 store ----
    // 注：游戏模式（game）在手机端会出问题，已移除——relay 一轮永不走游戏模式。
    const offUi = api.onDiscordUiOp?.(async (data: { reqId: string; op: string; relaySource?: string }) => {
      const respond = (r: { ok: boolean; text?: string; error?: string }) => {
        try { api.discordUiOpResponse?.(data.reqId, r); } catch {}
      };
      try {
        const src = data.relaySource || "discord";
        const sid = ensureTarget(src);
        const cs = useChatStore.getState();
        if (data.op === "chat") {
          cs.setSessionGameMode(sid, false); cs.setSessionChatMode(sid, true); cs.setActiveSession(sid);
          respond({ ok: true, text: tr("✅ 已切到纯聊天模式", "✅ Switched to chat-only mode") });
        } else if (data.op === "agent") {
          cs.setSessionChatMode(sid, false); cs.setSessionGameMode(sid, false); cs.setActiveSession(sid);
          respond({ ok: true, text: tr("✅ 已回到 Agent 模式", "✅ Back to Agent mode") });
        } else if (data.op === "compact") {
          await doRelayCompact(sid, respond);
        } else {
          respond({ ok: false, error: "unknown ui op" });
        }
      } catch (err: any) {
        respond({ ok: false, error: err?.message || String(err) });
      }
    });

    // 真实压缩上下文：拼对话轨迹 → chatSend 生成摘要 → compactSession 用摘要替换历史。
    // 与桌面 doCompact 同源（精简版，不含 PreCompact hook）。
    const doRelayCompact = async (sessionId: string, respond: (r: any) => void) => {
      const sess = useChatStore.getState().sessions.find((s) => s.id === sessionId);
      if (!sess || sess.messages.length === 0) { respond({ ok: false, error: tr("当前会话无可压缩内容。", "Nothing to compact in this session.") }); return; }
      const provStore = useProviderStore.getState();
      const selProv = provStore.providers.find((p) => p.id === provStore.selectedProviderId);
      if (!selProv) { respond({ ok: false, error: tr("未选择 Provider。", "No provider selected.") }); return; }
      const resolved = await provStore.resolve(selProv.id);
      const model = provStore.selectedModel || selProv.models[0];
      if (!resolved?.apiKey || !model) { respond({ ok: false, error: tr("Provider 未配置完整。", "Provider not fully configured.") }); return; }
      const transcript = sess.messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => (m.role === "user" ? "User: " : "Assistant: ") + (typeof m.content === "string" ? m.content : ""))
        .join("\n\n").slice(0, 60000);
      const sys = "你是上下文压缩器。请把以下对话压缩成结构化中文摘要，保留：目标/已做决策/关键文件与改动/未完成事项/重要约定。只输出摘要本身。";
      try {
        const r: any = await api.chatSend({ provider: resolved, model, messages: [
          { role: "system", content: sys }, { role: "user", content: transcript },
        ] });
        const summary = (r && (r.text || r.result || r.content) ? String(r.text || r.result || r.content) : "").trim();
        if (!summary) { respond({ ok: false, error: tr("压缩失败：未生成摘要。", "Compact failed: no summary.") }); return; }
        // 带上 token 估算（before/after），桌面分隔标记才显示「省下 X tokens」横幅；
        // 并把该会话设为活动，确保压缩分隔线出现在用户正看着的会话里（bug：桌面无压缩 UI）。
        useChatStore.getState().compactSession(sessionId, summary, { before: estimateTokens(transcript), after: estimateTokens(summary) });
        useChatStore.getState().setActiveSession(sessionId);
        respond({ ok: true, text: tr("✅ 已压缩上下文（已用摘要替换历史）。", "✅ Context compacted (history replaced with a summary).") });
      } catch (e: any) {
        respond({ ok: false, error: tr("压缩失败：", "Compact failed: ") + (e?.message || String(e)) });
      }
    };
    // ---- 置顶状态栏：返回该来源当前「项目 / 模型 / 模式」，供 Telegram 置顶面板展示 ----
    const offStatusLine = api.onDiscordStatusLine?.((data: { reqId: string; relaySource?: string }) => {
      const respond = (r: { project?: string; model?: string; mode?: string }) => {
        try { api.discordStatusLineResponse?.(data.reqId, r); } catch {}
      };
      try {
        const src = data.relaySource || "discord";
        const cs = useChatStore.getState();
        // 与 ensureTarget 同源：优先该来源锁定的会话，否则桌面活动会话。
        const pinned = targetRefs.current[src];
        const sid = (pinned && cs.sessions.find((s) => s.id === pinned)) ? pinned : cs.activeSessionId;
        const sess: any = sid ? cs.sessions.find((s) => s.id === sid) : null;
        const prov = useProviderStore.getState();
        const model = (sess && sess.model) || prov.selectedModel || "";
        const cwd = projectPathRef.current || "";
        const project = cwd ? (cwd.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || "") : "";
        const modeKey = (sess && sess.permissionMode) || permModeRefs.current[src] || "default";
        const modeMap: Record<string, string> = { default: "询问", acceptEdits: "自动批准", bypassPermissions: "完全放行", plan: "计划(只读)" };
        const behav = sess && sess.gameMode ? "🎮游戏" : sess && sess.chatMode ? "💬聊天" : "🤖Agent";
        respond({ project, model, mode: (modeMap[modeKey] || modeKey) + " · " + behav });
      } catch { respond({}); }
    });

    // 仅推送当前正跑着 relay 一轮的会话（activeRunRef 命中）；桌面端自己的会话不受影响。
    const pushRelay = (sessionId: string, kind: "progress" | "error", text: string) => {
      const run = activeRunRef.current[sessionId];
      if (!run || !text) return;
      try { api.relayPush?.({ source: run.source, channelId: run.channelId, kind, text }); } catch {}
    };
    const offTodos = api.onAgentTodos?.((data: any) => {
      const list = Array.isArray(data?.todos) ? data.todos : [];
      if (!data?.sessionId || list.length === 0) return;
      const lines = list.map((it: any) => {
        const mark = it.status === "completed" ? "✅" : it.status === "in_progress" ? "🔄" : "⬜";
        return mark + " " + (it.content || it.activeForm || "");
      });
      pushRelay(data.sessionId, "progress", "📋 进度更新\n" + lines.join("\n"));
    });
    const offErr = api.onAgentError?.((data: any) => {
      if (!data?.sessionId || !data?.message) return;
      pushRelay(data.sessionId, "error", "⚠️ " + data.message);
    });
    // 工具调用一行式提示：「🔧 工具名 · 相关文件」。只推活跃 relay 一轮的会话。
    const offTool = api.onAgentToolCall?.((data: any) => {
      if (!data?.sessionId || !data?.name) return;
      const target = data.target ? " · " + data.target : "";
      pushRelay(data.sessionId, "progress", "🔧 " + data.name + target);
    });

    return () => {
      if (typeof offRun === "function") offRun();
      if (typeof offSession === "function") offSession();
      if (typeof offProvider === "function") offProvider();
      if (typeof offMode === "function") offMode();
      if (typeof offUi === "function") offUi();
      if (typeof offStatusLine === "function") offStatusLine();
      if (typeof offTodos === "function") offTodos();
      if (typeof offErr === "function") offErr();
      if (typeof offTool === "function") offTool();
    };
  }, []);

  return null;
}

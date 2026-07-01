import { useState, useEffect } from "react";
import { Plus, Trash2, Check, ChevronDown, Loader2, X, Zap, Code2, Image as ImageIcon, Globe } from "lucide-react";
import { cn } from "../../lib/utils";
import { useProviderStore, PROVIDER_TEMPLATES, type Provider } from "../../stores/provider-store";
import { ProviderIcon, balanceColor } from "../../lib/provider-icon";
import { useT } from "../../lib/i18n";
import { PageHeader, SoftCard, PrimaryButton, GhostButton, Segmented, Hint, INPUT_CLS, INPUT_MONO_CLS } from "../ui/settings";

type TestState = { status: "idle" | "testing" | "ok" | "fail"; message?: string };

export function ProviderSettings() {
  const t = useT();
  const providers = useProviderStore((s) => s.providers);
  const addProvider = useProviderStore((s) => s.addProvider);
  const updateProvider = useProviderStore((s) => s.updateProvider);
  const removeProvider = useProviderStore((s) => s.removeProvider);
  const setKey = useProviderStore((s) => s.setKey);
  const refreshKeyFlags = useProviderStore((s) => s.refreshKeyFlags);
  const balances = useProviderStore((s) => s.balances);
  const refreshBalance = useProviderStore((s) => s.refreshBalance);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newProvider, setNewProvider] = useState<{ name?: string; baseUrl?: string }>({});
  // Local, unsaved key edits keyed by provider id (never rendered from storage).
  const [keyDrafts, setKeyDrafts] = useState<Record<string, string>>({});
  const [tests, setTests] = useState<Record<string, TestState>>({});
  // 余额脚本编辑面板展开状态
  const [balScriptOpen, setBalScriptOpen] = useState<Record<string, boolean>>({});

  useEffect(() => {
    refreshKeyFlags();
  }, []);

  const updateModels = (id: string, modelsStr: string) => {
    const models = modelsStr.split(",").map((m) => m.trim()).filter(Boolean);
    updateProvider(id, { models });
  };

  const saveKey = async (id: string) => {
    const draft = keyDrafts[id];
    if (draft === undefined) return;
    await setKey(id, draft);
    setKeyDrafts((d) => {
      const next = { ...d };
      delete next[id];
      return next;
    });
    // Probe balance right after a key is saved (best-effort).
    refreshBalance(id);
  };

  const addFromForm = () => {
    if (!newProvider.name || !newProvider.baseUrl) return;
    addProvider({ name: newProvider.name, baseUrl: newProvider.baseUrl, models: [], headers: {} });
    setNewProvider({});
    setShowAddForm(false);
  };

  const addFromTemplate = (tpl: Omit<Provider, "id">) => {
    addProvider({ name: tpl.name, baseUrl: tpl.baseUrl, models: [...tpl.models], headers: { ...tpl.headers }, protocol: tpl.protocol });
    setShowAddForm(false);
  };

  const testConnection = async (provider: Provider) => {
    setTests((t) => ({ ...t, [provider.id]: { status: "testing" } }));
    // Use the draft key if the user just typed one, else the stored key.
    const draft = keyDrafts[provider.id];
    const apiKey = draft !== undefined ? draft : ((await window.api.getSecret?.(provider.id)) || "");
    const model = provider.models[0] || "";
    if (!model) {
      setTests((t2) => ({ ...t2, [provider.id]: { status: "fail", message: t("请先填写至少一个模型名", "Please enter at least one model name first") } }));
      return;
    }
    const res = await window.api.testProvider?.({ baseUrl: provider.baseUrl, apiKey, model, headers: provider.headers, protocol: provider.protocol });
    setTests((t2) => ({
      ...t2,
      [provider.id]: res?.ok ? { status: "ok", message: res.message } : { status: "fail", message: res?.message || t("测试失败", "Test failed") },
    }));
  };

  const protocolLabel = (p?: string) =>
    p === "anthropic" ? t("Anthropic 原生", "Anthropic native") : p === "responses" ? "Responses" : t("OpenAI 兼容", "OpenAI-compatible");

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <PageHeader
        icon={Globe}
        title="API Providers"
        subtitle={
          <span className="inline-flex items-center gap-1.5">
            {t("任意 OpenAI 兼容服务，密钥本机加密", "Any OpenAI-compatible service · keys encrypted locally")}
            <Hint>{t("支持官方 API、中转站与本地模型。密钥用系统密钥库加密存储，从不写入明文配置。", "Supports official APIs, relays and local models. Keys are encrypted via the system keychain and never written to plaintext config.")}</Hint>
          </span>
        }
        actions={
          <PrimaryButton onClick={() => setShowAddForm(!showAddForm)}>
            <Plus size={13} /> {t("添加", "Add Provider")}
          </PrimaryButton>
        }
      />

      {/* Add form */}
      {showAddForm && (
        <SoftCard className="space-y-3.5 animate-fade-in">
          <div className="flex items-center justify-between">
            <h3 className="text-[13px] font-medium text-foreground">{t("新建供应商", "New Provider")}</h3>
            <button onClick={() => setShowAddForm(false)} className="text-muted-foreground/60 hover:text-foreground transition-colors">
              <X size={15} />
            </button>
          </div>

          {/* Quick-fill templates (optional, fully editable after add) */}
          <div className="flex flex-wrap gap-1.5">
            {PROVIDER_TEMPLATES.map((tpl) => (
              <button
                key={tpl.name}
                onClick={() => addFromTemplate(tpl)}
                className="px-2.5 py-1 text-[11px] rounded-lg bg-muted/60 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              >
                + {tpl.name}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Name</label>
              <input
                type="text"
                placeholder={t("e.g. DeepSeek, Groq, 中转站", "e.g. DeepSeek, Groq, relay")}
                value={newProvider.name || ""}
                onChange={(e) => setNewProvider({ ...newProvider, name: e.target.value })}
                className={INPUT_CLS}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Base URL</label>
              <input
                type="text"
                placeholder="https://api.example.com"
                value={newProvider.baseUrl || ""}
                onChange={(e) => setNewProvider({ ...newProvider, baseUrl: e.target.value })}
                className={INPUT_MONO_CLS}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <GhostButton onClick={() => setShowAddForm(false)}>{t("取消", "Cancel")}</GhostButton>
            <PrimaryButton onClick={addFromForm}>{t("添加", "Add")}</PrimaryButton>
          </div>
        </SoftCard>
      )}

      {providers.length === 0 && !showAddForm && (
        <div className="rounded-xl bg-muted/30 ring-1 ring-border/40 p-10 text-center text-xs text-muted-foreground">
          {t("还没有配置任何 Provider。点击右上角「添加」开始。", "No providers yet. Click “Add Provider” in the top right to get started.")}
        </div>
      )}

      {/* Provider list */}
      <div className="space-y-2.5">
        {providers.map((provider) => {
          const test = tests[provider.id] || { status: "idle" };
          const keyDraft = keyDrafts[provider.id];
          const expanded = expandedId === provider.id;
          return (
            <div key={provider.id} className={cn(
              "rounded-xl bg-muted/40 ring-1 transition-colors overflow-hidden",
              expanded ? "ring-border/70 bg-muted/60" : "ring-border/40 hover:ring-border/60"
            )}>
              <button
                onClick={() => setExpandedId(expanded ? null : provider.id)}
                className="w-full flex items-center gap-3 px-4 py-3 text-left"
              >
                <ProviderIcon name={provider.name} model={provider.models[0]} size={34} className="rounded-lg" />
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-medium text-foreground">{provider.name}</div>
                  <div className="text-[11px] text-muted-foreground/70 truncate font-mono">{provider.baseUrl}</div>
                </div>
                <div className="flex items-center gap-2">
                  {balances[provider.id] && (
                    <span
                      className="text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-muted"
                      style={{ color: balanceColor(balances[provider.id].remaining) }}
                      title={t("账户余额（每5分钟刷新）", "Account balance (refreshed every 5 min)")}
                    >
                      {(balances[provider.id].unit === "CNY" ? "¥" : "$") + balances[provider.id].remaining.toFixed(2)}
                    </span>
                  )}
                  {provider.hasKey ? (
                    <span className="text-[10px] text-emerald-500 flex items-center gap-1">
                      <Check size={10} /> {t("已配置", "Configured")}
                    </span>
                  ) : (
                    <span className="text-[10px] text-amber-500">{t("缺密钥", "No key")}</span>
                  )}
                  <ChevronDown size={14} className={cn(
                    "text-muted-foreground/60 transition-transform",
                    expanded && "rotate-180"
                  )} />
                </div>
              </button>

              {expanded && (
                <div className="px-4 pb-4 pt-1 space-y-3.5 animate-fade-in">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Name</label>
                      <input
                        type="text"
                        value={provider.name}
                        onChange={(e) => updateProvider(provider.id, { name: e.target.value })}
                        className={INPUT_CLS}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Base URL</label>
                      <input
                        type="text"
                        value={provider.baseUrl}
                        onChange={(e) => updateProvider(provider.id, { baseUrl: e.target.value })}
                        className={INPUT_MONO_CLS}
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                      {t("协议", "Protocol")}
                      <Hint>
                        {(provider.protocol || "openai") === "anthropic"
                          ? t("走 /v1/messages 原生接口（x-api-key 认证）。用于官方 api.anthropic.com 或支持原生协议的中转。", "Uses the native /v1/messages endpoint (x-api-key auth). For official api.anthropic.com or relays that support the native protocol.")
                          : (provider.protocol || "openai") === "responses"
                          ? t("走 /v1/responses 接口（OpenAI 较新端点，原生支持工具返回图片）。仅部分官方/中转端点实现，不确定时用 OpenAI 兼容。", "Uses the /v1/responses endpoint (a newer OpenAI endpoint with native support for tools returning images). Only some official/relay endpoints implement it — when unsure, use OpenAI-compatible.")
                          : t("走 /chat/completions（Bearer 认证）。适用于绝大多数 OpenAI 兼容服务与中转站。注意：此协议下工具产出的图片无法回传给模型，只发文字占位。", "Uses /chat/completions (Bearer auth). Works for most OpenAI-compatible services and relays. Note: under this protocol, images produced by tools can't be sent back to the model — only a text placeholder is sent.")}
                      </Hint>
                    </label>
                    <Segmented
                      value={(provider.protocol || "openai") as "openai" | "anthropic" | "responses"}
                      onChange={(proto) => updateProvider(provider.id, { protocol: proto === "openai" ? undefined : proto })}
                      options={[
                        { value: "openai", label: protocolLabel("openai") },
                        { value: "anthropic", label: protocolLabel("anthropic") },
                        { value: "responses", label: "Responses" },
                      ]}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                      {t("图片输入（Vision）", "Image input (Vision)")}
                      <Hint>
                        {provider.vision !== false
                          ? t("模型可接收图片。截图类工具的结果会以图片回传（需 Anthropic/Responses 协议）。", "The model can receive images. Results from screenshot tools are sent back as images (requires the Anthropic/Responses protocol).")
                          : t("纯文本模型：截图类工具的图片不会回传，且会提示 agent 改用 browser_snapshot 读网页文本。", "Text-only model: images from screenshot tools won't be sent back, and the agent is prompted to use browser_snapshot to read page text instead.")}
                      </Hint>
                    </label>
                    <Segmented
                      value={provider.vision === false ? "text" : "vision"}
                      onChange={(v) => updateProvider(provider.id, { vision: v === "text" ? false : undefined })}
                      options={[
                        { value: "vision", label: t("支持图片", "Supports images") },
                        { value: "text", label: t("纯文本", "Text-only") },
                      ]}
                    />
                  </div>

                  <div className="flex gap-2">
                    <input
                      type="password"
                      value={keyDraft !== undefined ? keyDraft : ""}
                      onChange={(e) => setKeyDrafts((d) => ({ ...d, [provider.id]: e.target.value }))}
                      placeholder={provider.hasKey ? t("•••••••• (已保存，输入以替换)", "•••••••• (saved, type to replace)") : "sk-..."}
                      className={INPUT_MONO_CLS}
                    />
                    <PrimaryButton onClick={() => saveKey(provider.id)} disabled={keyDraft === undefined}>
                      {t("保存密钥", "Save Key")}
                    </PrimaryButton>
                  </div>

                  {/* 图片生成：标记该供应商为出图端点。打开后它能被 agent 的 generate_image
                      工具调用，在对话里直接选中它发消息也会直接出图。 */}
                  <SoftCard padded={false} className="p-3 space-y-2.5">
                    <button
                      onClick={() => updateProvider(provider.id, {
                        imageGen: !provider.imageGen,
                        imageEndpoint: !provider.imageGen ? (provider.imageEndpoint || "images") : provider.imageEndpoint,
                      })}
                      className="flex items-center gap-2.5 text-left w-full">
                      <span className={cn("w-4 h-4 rounded-md border flex items-center justify-center shrink-0 transition-colors",
                        provider.imageGen ? "bg-foreground border-foreground text-background" : "border-muted-foreground/40")}>
                        {provider.imageGen && <Check size={11} strokeWidth={3} />}
                      </span>
                      <div className="min-w-0">
                        <div className="text-[13px] font-medium text-foreground flex items-center gap-1.5">
                          <ImageIcon size={13} /> {t("用作图片生成", "Use for image generation")}
                          <Hint>{t("勾选后此供应商的模型可被 generate_image 工具调用，也可在对话里直接选中出图。出图链路固定走 OpenAI 兼容格式，与上方「协议」无关。", "When checked, this provider's models can be called by the generate_image tool, and you can also select it directly in chat. Image generation always uses the OpenAI-compatible format, independent of the Protocol above.")}</Hint>
                        </div>
                      </div>
                    </button>
                    {provider.imageGen && (() => {
                      // 出图链路与「上方协议」正交：generateImages 永远发 OpenAI 兼容
                      // 请求体（images 接口或 chat 接口），不读 protocol。所以三个后缀对
                      // 任何协议都恒定可选——协议只影响对话/文本生成，不影响出图。
                      const opts = [
                        { v: "images" as const, label: "/v1/images/generations" },
                        { v: "chat" as const, label: "/v1/chat/completions" },
                        { v: "raw" as const, label: t("不加后缀", "No suffix") },
                      ];
                      const eff = provider.imageEndpoint || "images";
                      return (
                        <div className="pl-6 space-y-1.5">
                          <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                            {t("端点后缀", "Endpoint suffix")}
                            <Hint>
                              {eff === "chat"
                                ? t("聊天补全式出图：把 prompt 作为用户消息发到 /chat/completions，从返回里抽取图片（base64 或图片 URL / Markdown 图）。", "Chat-completion style: sends the prompt to /chat/completions and extracts the image from the response (base64, image URL, or Markdown image).")
                                : eff === "raw"
                                ? t("不加任何后缀：直接 POST 上方 Base URL 原样，用图片接口的请求体。适用于会自动补全路径的中转站。", "No suffix: POSTs to the Base URL above as-is with the image API request body. For relays that auto-complete the path.")
                                : t("标准图片接口：POST /v1/images/generations，返回 data[].b64_json 或 data[].url。", "Standard image API: POST /v1/images/generations, returns data[].b64_json or data[].url.")}
                            </Hint>
                          </label>
                          <Segmented value={eff} onChange={(v) => updateProvider(provider.id, { imageEndpoint: v })}
                            options={opts.map((o) => ({ value: o.v, label: <span className="font-mono text-[10px]">{o.label}</span> }))} />
                        </div>
                      );
                    })()}
                  </SoftCard>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">{t("模型（逗号分隔）", "Models (comma-separated)")}</label>
                    <input
                      type="text"
                      value={provider.models.join(", ")}
                      onChange={(e) => updateModels(provider.id, e.target.value)}
                      placeholder="gpt-4o, deepseek-chat, ..."
                      className={INPUT_MONO_CLS}
                    />
                  </div>

                  {/* 余额查询脚本（折叠式） */}
                  <div>
                    <button
                      onClick={() => setBalScriptOpen((o) => ({ ...o, [provider.id]: !o[provider.id] }))}
                      className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors"
                    >
                      <Code2 size={11} />
                      <span>{t("自定义余额查询", "Custom balance query")}</span>
                      {provider.balanceScript && <span className="text-emerald-500 text-[9px] normal-case">• {t("已配置", "Configured")}</span>}
                      <ChevronDown size={10} className={cn("transition-transform", balScriptOpen[provider.id] && "rotate-180")} />
                    </button>
                    {balScriptOpen[provider.id] && (
                      <div className="mt-2 space-y-2 animate-fade-in">
                        <p className="text-[10px] text-muted-foreground leading-relaxed">
                          {t("对于内置探测无法正确返回余额的供应商，可配置自定义 JS 脚本（括号包裹的对象字面量，含 ", "For providers where the built-in probe fails, configure a custom JS script (a parenthesized object literal with ")}<code className="text-[9px] bg-muted px-0.5 rounded">request</code>{t(" 与 ", " and ")}
                          <code className="text-[9px] bg-muted px-0.5 rounded">extractor</code>{t("）。", ").")}<code className="text-[9px] bg-muted px-0.5 rounded">{"{{baseUrl}}"}</code>{t(" / ", " / ")}<code className="text-[9px] bg-muted px-0.5 rounded">{"{{apiKey}}"}</code>{t(" 会替换为下方地址 / 令牌（留空则沿用上方）。", " are replaced by the URL / token below (or the values above if blank).")}
                        </p>
                        {/* 独立的余额接口令牌 / 地址：部分供应商余额接口与模型的 key/base 不同。
                            留空 = 沿用模型的 apiKey / Base URL。 */}
                        <div className="grid grid-cols-2 gap-2">
                          <div className="space-y-1">
                            <label className="text-[9px] text-muted-foreground/70">{t("余额令牌（留空沿用模型 Key）", "Balance token (blank = model key)")}</label>
                            <input
                              type="password"
                              value={provider.balanceToken || ""}
                              onChange={(e) => updateProvider(provider.id, { balanceToken: e.target.value || undefined })}
                              placeholder={t("沿用模型 API Key", "Use model API key")}
                              className={INPUT_MONO_CLS} />
                          </div>
                          <div className="space-y-1">
                            <label className="text-[9px] text-muted-foreground/70">{t("余额接口地址（留空沿用 Base URL）", "Balance API URL (blank = Base URL)")}</label>
                            <input
                              type="text"
                              value={provider.balanceBaseUrl || ""}
                              onChange={(e) => updateProvider(provider.id, { balanceBaseUrl: e.target.value || undefined })}
                              placeholder={provider.baseUrl}
                              className={INPUT_MONO_CLS} />
                          </div>
                        </div>
                        <textarea
                          value={provider.balanceScript || ""}
                          onChange={(e) => updateProvider(provider.id, { balanceScript: e.target.value || undefined })}
                          placeholder={`({\n  request: {\n    url: "{{baseUrl}}/api/user/self",\n    method: "GET",\n    headers: { "Authorization": "Bearer YOUR_KEY" }\n  },\n  extractor: function(response) {\n    const d = response.data || {};\n    return {\n      remaining: Number((d.quota / 500000).toFixed(2)),\n      unit: "USD"\n    };\n  }\n})`}
                          rows={8}
                          className={cn(INPUT_MONO_CLS, "leading-relaxed resize-y")}
                        />
                        <div className="flex gap-2 items-center">
                          <GhostButton
                            onClick={() => { refreshBalance(provider.id); }}
                            disabled={!provider.balanceScript}
                          >
                            {t("测试脚本", "Test script")}
                          </GhostButton>
                          {provider.balanceScript && (
                            <button
                              onClick={() => updateProvider(provider.id, { balanceScript: undefined })}
                              className="px-2 py-1 text-[10px] text-destructive hover:bg-destructive/10 rounded transition-colors"
                            >
                              {t("清除脚本", "Clear script")}
                            </button>
                          )}
                          {balances[provider.id] && (
                            <span className="text-[10px] text-muted-foreground">
                              {t("当前余额: ", "Current balance: ")}<span style={{ color: balanceColor(balances[provider.id].remaining) }}>
                                {(balances[provider.id].unit === "CNY" ? "¥" : "$") + balances[provider.id].remaining.toFixed(2)}
                              </span>
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="flex justify-between items-center pt-1">
                    <button
                      onClick={() => removeProvider(provider.id)}
                      className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-destructive transition-colors"
                    >
                      <Trash2 size={12} /> <span>{t("移除", "Remove")}</span>
                    </button>

                    <div className="flex items-center gap-2">
                      {test.status === "ok" && <span className="text-[10px] text-emerald-500">{test.message}</span>}
                      {test.status === "fail" && <span className="text-[10px] text-destructive max-w-[260px] truncate" title={test.message}>{test.message}</span>}
                      <GhostButton
                        onClick={() => testConnection(provider)}
                        disabled={test.status === "testing"}
                      >
                        {test.status === "testing" ? <Loader2 size={11} className="animate-spin" /> : <Zap size={11} />}
                        <span>{t("测试连接", "Test connection")}</span>
                      </GhostButton>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

import { useState, useEffect } from "react";
import { Shield, AlertTriangle, Loader2 } from "lucide-react";
import { cn } from "../../lib/utils";
import { useT } from "../../lib/i18n";
import { PageHeader } from "../ui/settings";
import type { PermissionsConfig, PermissionMode, ToolPermission } from "../../../../preload/index.d";

// Mirror of the backend's MUTATING_TOOLS set (permission tool names). These are
// the tools that warrant per-call approval and support "always allow" (auto).
var MUTATING_PERM_TOOLS = new Set(["Write", "Edit", "Bash"]);

// Mode metadata. Descriptions are worded to match decideToolAction() exactly —
// no exaggeration. label/desc 在渲染时按当前语言取值（见组件内 t(...)），不能在模块级用
// tr() 预先固化，否则切语言后这些文案不更新。
var MODES: { id: PermissionMode; zh: string; en: string; descZh: string; descEn: string; danger?: boolean }[] = [
  { id: "default", zh: "默认", en: "Default", descZh: "只读工具直接执行；写入 / 编辑 / 命令等变更类工具每次询问（除非该工具被设为「自动批准」）。", descEn: "Read-only tools run directly; mutating tools (write / edit / command) ask each time unless set to \"auto-approve\"." },
  { id: "acceptEdits", zh: "自动批准编辑", en: "Auto-Approve Edits", descZh: "变更类工具全部自动放行，不再逐次询问。适合信任当前任务时加速。", descEn: "All mutating tools run automatically without per-call prompts. Use to speed up trusted tasks." },
  { id: "plan", zh: "计划模式", en: "Plan Mode", descZh: "只读。禁止一切文件写入、编辑与命令执行——agent 只能阅读和分析。", descEn: "Read-only. No file writes, edits, or command execution — the agent can only read and analyze." },
  { id: "bypassPermissions", zh: "完全放行", en: "Bypass Permissions", descZh: "跳过所有权限检查，任何工具直接执行。风险高，仅在可控环境使用。", descEn: "Skips all permission checks; any tool runs directly. High risk — use only in controlled environments.", danger: true },
];

export function PermissionsSettings() {
  var t = useT();
  var [config, setConfig] = useState<PermissionsConfig | null>(null);
  var [loading, setLoading] = useState(true);

  useEffect(function() {
    var api = (window as any).api;
    api.getPermissions?.().then(function(c: PermissionsConfig) {
      setConfig(c);
      setLoading(false);
    }).catch(function() { setLoading(false); });
  }, []);

  var changeMode = async function(mode: PermissionMode) {
    if (!config) return;
    setConfig({ ...config, mode }); // optimistic
    await (window as any).api.setPermissionMode?.(mode);
  };

  var toggleTool = async function(tool: string, allowed: boolean) {
    if (!config) return;
    var tools = config.tools.map(function(t) {
      if (t.tool !== tool) return t;
      // Disabling a tool also clears its auto flag (can't auto-approve a disabled tool).
      return allowed ? { ...t, allowed } : { ...t, allowed, auto: false };
    });
    setConfig({ ...config, tools });
    await (window as any).api.setToolPermission?.(tool, allowed);
  };

  var toggleAuto = async function(tool: string, auto: boolean) {
    if (!config) return;
    var tools = config.tools.map(function(t) {
      if (t.tool !== tool) return t;
      return auto ? { ...t, auto, allowed: true } : { ...t, auto };
    });
    setConfig({ ...config, tools });
    await (window as any).api.setToolAuto?.(tool, auto);
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 size={14} className="animate-spin" /> {t("加载权限配置…", "Loading permission settings…")}
      </div>
    );
  }
  if (!config) {
    return <p className="text-xs text-destructive">{t("无法读取权限配置。", "Failed to read permission settings.")}</p>;
  }

  // Stable non-null reference so callbacks below don't trip the null-narrowing.
  var cfg: PermissionsConfig = config;
  var modeIsDefault = cfg.mode === "default";

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Shield}
        title={t("权限与安全", "Permissions & Security")}
        subtitle={t("控制 agent 调用工具时的审批策略。配置持久化于本机，重启后保留。", "Control the approval policy when the agent calls tools. Settings are stored locally and persist across restarts.")}
      />

      {/* 权限模式 */}
      <section className="space-y-2">
        <h3 className="text-[11px] font-medium text-muted-foreground/80 uppercase tracking-[0.08em]">{t("权限模式", "Permission Mode")}</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {MODES.map(function(m) {
            var active = cfg.mode === m.id;
            return (
              <button key={m.id} onClick={function() { changeMode(m.id); }}
                className={cn(
                  "text-left p-3 rounded-lg border transition-colors",
                  active
                    ? (m.danger ? "border-destructive bg-destructive/10" : "border-ring bg-accent")
                    : "border-border hover:bg-accent/50"
                )}>
                <div className="flex items-center gap-1.5">
                  {m.danger && <AlertTriangle size={13} className="text-destructive" />}
                  <span className={cn("text-xs font-medium", m.danger ? "text-destructive" : "text-foreground")}>
                    {t(m.zh, m.en)}
                  </span>
                  {active && <span className="ml-auto text-[10px] text-muted-foreground">{t("当前", "Active")}</span>}
                </div>
                <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">{t(m.descZh, m.descEn)}</p>
              </button>
            );
          })}
        </div>
      </section>

      {/* per-tool 开关 */}
      <section className="space-y-2">
        <h3 className="text-xs font-medium text-foreground/80 uppercase tracking-wider">{t("工具权限", "Tool Permissions")}</h3>
        <p className="text-[11px] text-muted-foreground">
          {t("关闭某工具后，default 模式下会询问、其他模式下会拒绝。变更类工具可勾选「自动批准」，免去 default 模式下每次确认。", "When a tool is disabled, it prompts in default mode and is denied in other modes. Mutating tools can be set to \"auto-approve\" to skip per-call confirmation in default mode.")}
        </p>
        <div className="space-y-1">
          {cfg.tools.map(function(tp: ToolPermission) {
            var mutating = MUTATING_PERM_TOOLS.has(tp.tool);
            return (
              <div key={tp.tool}
                className="flex items-center gap-3 px-3 py-2 rounded-lg border border-border bg-card/40">
                <span className="text-xs font-mono text-foreground flex-1">{tp.tool}</span>
                {mutating && (
                  <span className="flex items-center gap-1 text-[10px] text-yellow-500">
                    <AlertTriangle size={11} /> {t("变更类", "Mutating")}
                  </span>
                )}
                {/* 自动批准（仅变更类、且模式为 default 时有意义） */}
                {mutating && (
                  <label className={cn("flex items-center gap-1.5 text-[10px]",
                    (tp.allowed && modeIsDefault) ? "text-muted-foreground" : "text-muted-foreground/40")}>
                    <input type="checkbox" disabled={!tp.allowed || !modeIsDefault}
                      checked={!!tp.auto}
                      onChange={function(e) { toggleAuto(tp.tool, e.target.checked); }}
                      className="accent-foreground" />
                    {t("自动批准", "Auto-approve")}
                  </label>
                )}
                {/* 启用/禁用开关 */}
                <Switch checked={tp.allowed} onChange={function(v) { toggleTool(tp.tool, v); }} />
              </div>
            );
          })}
        </div>
        {!modeIsDefault && (
          <p className="text-[10px] text-muted-foreground/60">
            {t("「自动批准」仅在「默认」模式下生效；当前模式已统一处理变更类工具。", "\"Auto-approve\" only applies in Default mode; the current mode already handles mutating tools uniformly.")}
          </p>
        )}
      </section>
    </div>
  );
}

// Minimal Tailwind switch — no new dependency, matches the app's flat style.
function Switch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={function() { onChange(!checked); }} role="switch" aria-checked={checked}
      className={cn(
        "relative w-9 h-5 rounded-full transition-colors shrink-0",
        checked ? "bg-foreground" : "bg-muted-foreground/30"
      )}>
      <span className={cn(
        "absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-background transition-transform",
        checked ? "translate-x-4" : "translate-x-0"
      )} />
    </button>
  );
}

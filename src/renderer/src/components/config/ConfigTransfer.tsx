import { useState, useEffect } from "react";
import { useAppStore } from "../../stores/app-store";
import { Download, Upload, X, Check, Loader2, AlertTriangle } from "lucide-react";
import { cn } from "../../lib/utils";
import { useT } from "../../lib/i18n";
import {
  TRANSFER_SECTIONS, probeSections, exportConfig, parseBundle, importConfig,
  type ConfigBundle,
} from "../../lib/config-transfer";

type Mode = "export" | "import";

export function ConfigTransfer({ mode, onClose }: { mode: Mode; onClose: () => void }) {
  const t = useT();
  const projectPath = useAppStore((s) => s.projectPath) || undefined;
  const ctx = { projectPath };

  // 各分区可用性（导出时灰显空分区）。
  const [available, setAvailable] = useState<Record<string, boolean>>({});
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 导入态：解析出的 bundle 与其包含分区。
  const [bundle, setBundle] = useState<ConfigBundle | null>(null);
  const [bundleSections, setBundleSections] = useState<string[]>([]);

  useEffect(() => {
    if (mode !== "export") return;
    let cancelled = false;
    probeSections(ctx).then((avail) => {
      if (cancelled) return;
      setAvailable(avail);
      // 默认全选有内容的分区。
      const sel: Record<string, boolean> = {};
      for (const s of TRANSFER_SECTIONS) sel[s.id] = !!avail[s.id];
      setSelected(sel);
    });
    return () => { cancelled = true; };
  }, [mode, projectPath]);

  const toggle = (id: string) => setSelected((p) => ({ ...p, [id]: !p[id] }));
  const selectedIds = TRANSFER_SECTIONS.filter((s) => selected[s.id]).map((s) => s.id);

  // ---- 导出 ----
  const doExport = async () => {
    setBusy(true); setError(null); setResult(null);
    try {
      const json = await exportConfig(selectedIds, ctx);
      const stamp = new Date().toISOString().slice(0, 10);
      const res = await (window.api as any).saveFile?.({
        defaultPath: "ue-coworker-config-" + stamp + ".json",
        content: json,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (res && res.ok) setResult(t("已导出到：", "Exported to: ") + res.path);
      else if (res && res.canceled) { /* 用户取消 */ }
      else setError((res && res.error) || t("导出失败", "Export failed"));
    } catch (e: any) {
      setError(e?.message || t("导出失败", "Export failed"));
    } finally { setBusy(false); }
  };

  // ---- 选择导入文件并解析 ----
  const pickImport = async () => {
    setError(null); setResult(null);
    const path = await (window.api as any).openFile?.({ filters: [{ name: "JSON", extensions: ["json"] }] });
    if (!path) return;
    const r = await window.api.readFile(path);
    if (!r || !r.content) { setError(t("无法读取文件", "Failed to read file")); return; }
    const parsed = parseBundle(r.content);
    if ("error" in parsed) { setError(parsed.error); return; }
    setBundle(parsed.bundle);
    setBundleSections(parsed.sectionIds);
    const sel: Record<string, boolean> = {};
    for (const id of parsed.sectionIds) sel[id] = true;
    setSelected(sel);
  };

  // ---- 执行导入 ----
  const doImport = async () => {
    if (!bundle) return;
    setBusy(true); setError(null); setResult(null);
    try {
      await importConfig(bundle, selectedIds, ctx);
      setResult(t("导入完成（已增量合并）。部分设置可能需重启或重开面板生效。", "Import complete (merged incrementally). Some settings may require a restart or reopening the panel to take effect."));
    } catch (e: any) {
      setError(e?.message || t("导入失败", "Import failed"));
    } finally { setBusy(false); }
  };

  const rows = mode === "export"
    ? TRANSFER_SECTIONS
    : TRANSFER_SECTIONS.filter((s) => bundleSections.indexOf(s.id) !== -1);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="w-[440px] max-h-[80vh] flex flex-col rounded-xl border border-border bg-background shadow-2xl"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
            {mode === "export" ? <Upload size={14} /> : <Download size={14} />}
            {mode === "export" ? t("导出配置", "Export Config") : t("导入配置", "Import Config")}
          </h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors">
            <X size={15} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {mode === "export" && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2">
              <AlertTriangle size={13} className="text-amber-500 mt-0.5 shrink-0" />
              <p className="text-[11px] text-foreground/80 leading-relaxed">
                {t("导出文件含", "Export file contains ")}<strong className="text-foreground">{t("明文 API key / Discord token", "plaintext API keys / Discord token")}</strong>{t("，便于换机迁移。", " for easy migration to a new machine.")}
                {t("请妥善保管，勿分享给他人。", "Keep it safe and do not share it with others.")}
              </p>
            </div>
          )}

          {mode === "import" && !bundle && (
            <div className="text-center py-6 space-y-3">
              <p className="text-xs text-muted-foreground">{t("选择一个 UE Coworker 配置文件（.json）。导入采用", "Select a UE Coworker config file (.json). Import uses ")}<strong className="text-foreground">{t("增量合并", "incremental merge")}</strong>{t("：重复项更新、新项追加，不会清空你现有的配置。", ": duplicates are updated, new items appended — your existing config is never cleared.")}</p>
              <button onClick={pickImport}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-foreground text-background rounded-lg font-medium hover:opacity-90 transition-opacity">
                <Download size={13} /> {t("选择文件…", "Choose File…")}
              </button>
            </div>
          )}

          {(mode === "export" || bundle) && (
            <div className="space-y-1.5">
              <p className="text-[11px] text-muted-foreground">{mode === "export" ? t("选择要导出的分区：", "Select sections to export:") : t("选择要导入的分区：", "Select sections to import:")}</p>
              {rows.map((s) => {
                const disabled = mode === "export" && !available[s.id];
                return (
                  <button
                    key={s.id}
                    onClick={() => !disabled && toggle(s.id)}
                    disabled={disabled}
                    className={cn("w-full flex items-center gap-2.5 px-3 py-2 rounded-lg border text-left transition-colors",
                      selected[s.id] ? "border-ring bg-accent/30" : "border-border",
                      disabled && "opacity-40 cursor-not-allowed")}>
                    <span className={cn("w-4 h-4 rounded border flex items-center justify-center shrink-0",
                      selected[s.id] ? "bg-foreground border-foreground text-background" : "border-muted-foreground/40")}>
                      {selected[s.id] && <Check size={11} strokeWidth={3} />}
                    </span>
                    <span className="text-xs text-foreground flex-1">{t(s.labelZh, s.labelEn)}</span>
                    {disabled && <span className="text-[10px] text-muted-foreground">{t("无内容", "Empty")}</span>}
                  </button>
                );
              })}
            </div>
          )}

          {error && <p className="text-[11px] text-destructive">{error}</p>}
          {result && <p className="text-[11px] text-emerald-500">{result}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border">
          <button onClick={onClose}
            className="px-3 py-1.5 text-xs rounded-lg border border-border hover:bg-accent transition-colors">
            {t("关闭", "Close")}
          </button>
          {mode === "export" ? (
            <button onClick={doExport} disabled={busy || selectedIds.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-foreground text-background rounded-lg font-medium hover:opacity-90 transition-opacity disabled:opacity-40">
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />} {t("导出", "Export")}
            </button>
          ) : bundle ? (
            <button onClick={doImport} disabled={busy || selectedIds.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-foreground text-background rounded-lg font-medium hover:opacity-90 transition-opacity disabled:opacity-40">
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} {t("合并导入", "Merge Import")}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

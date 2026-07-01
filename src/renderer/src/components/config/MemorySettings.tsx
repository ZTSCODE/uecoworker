import { useEffect, useState } from "react";
import { useAppStore } from "../../stores/app-store";
import { useMemoryStore } from "../../stores/memory-store";
import type { MemoryEntry, MemoryType } from "../../../../preload/index.d";
import { Brain, FolderOpen, Plus, Trash2, Save, Search, X } from "lucide-react";
import { cn } from "../../lib/utils";
import { useT, tr } from "../../lib/i18n";
import { PageHeader, GhostButton, Hint } from "../ui/settings";

// 记忆类型 → 中文标签 + 是否常驻(进每次会话系统提示)。与 memory-manager 对齐:
// user/feedback/project 常驻;reference 仅 recall_memory 召回。
// label/hint 在渲染时按当前语言取值（见组件内 t(...)），不在模块级用 tr() 固化。
const TYPE_META: Record<MemoryType, { zh: string; en: string; resident: boolean; hintZh: string; hintEn: string }> = {
  user: { zh: "用户", en: "User", resident: true, hintZh: "用户身份、偏好(常驻)", hintEn: "User identity & preferences (resident)" },
  feedback: { zh: "反馈", en: "Feedback", resident: true, hintZh: "工作方式纠正/确认(常驻)", hintEn: "Corrections/confirmations on how to work (resident)" },
  project: { zh: "项目", en: "Project", resident: true, hintZh: "项目目标、约束(常驻)", hintEn: "Project goals & constraints (resident)" },
  reference: { zh: "参考", en: "Reference", resident: false, hintZh: "外部文档/链接(仅按需召回)", hintEn: "External docs/links (recalled on demand only)" },
};
const TYPE_ORDER: MemoryType[] = ["user", "feedback", "project", "reference"];

export function MemorySettings() {
  const t = useT();
  const { projectPath } = useAppStore();
  // useAppStore 的 projectPath 是 string | null，而 memory-store.load 形参是 string | undefined，归一化。
  const projectDir = projectPath || undefined;
  const { entries, loading, load, save, remove } = useMemoryStore();
  const [editing, setEditing] = useState<MemoryEntry | null>(null);
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState("");

  useEffect(() => { load(projectDir); }, [projectPath]);

  // 记忆被 remember 工具或别处改动时自动重载(订阅 memory:changed)。
  useEffect(() => {
    const off = window.api.onMemoryChanged?.(() => load(projectDir));
    return () => { if (off) off(); };
  }, [projectPath]);

  const memoryDir = projectPath ? projectPath + "/.claude/memory" : "";
  const openDir = () => { if (memoryDir) window.api.openPath?.(memoryDir); };

  const q = filter.trim().toLowerCase();
  const visible = q
    ? entries.filter((e) => (e.name + e.description + e.body).toLowerCase().indexOf(q) >= 0)
    : entries;
  const project = visible.filter((e) => e.source === "project");
  const global = visible.filter((e) => e.source === "global");
  const residentCount = entries.filter((e) => e.enabled && !e.error && TYPE_META[e.type].resident).length;

  return (
    <div className="space-y-5">
      <PageHeader
        icon={Brain}
        title={t("记忆", "Memory")}
        subtitle={
          <span className="inline-flex items-center gap-1.5">
            {t("长期记忆，与 Claude Code 生态互通", "Long-term memory, interoperable with Claude Code")}
            <Hint>
              {t("存放在 .claude/memory/（项目与全局 ~/.claude/memory/），一事实一文件 + frontmatter。用户 / 反馈 / 项目 类的一行摘要会注入每次会话（常驻，省 token）；参考 类与全文仅在 AI 需要时用 recall_memory 召回。AI 也会通过 remember 工具自行沉淀记忆。", "Stored in .claude/memory/ (project and global), one fact per file + frontmatter. User / Feedback / Project entries' one-line summaries are injected into every session (resident, saves tokens); Reference entries and full bodies are recalled via recall_memory only when needed. The AI also persists memory via the remember tool.")}
            </Hint>
          </span>
        }
        actions={
          <>
            {projectPath && (
              <GhostButton onClick={openDir} title={t("打开记忆目录", "Open memory folder")}>
                <FolderOpen size={12} /> {t("记忆目录", "Memory folder")}
              </GhostButton>
            )}
            <GhostButton onClick={() => load(projectDir)} title={t("重新扫描", "Rescan")}>
              {t("刷新", "Refresh")}
            </GhostButton>
          </>
        }
      />

      {/* 工具栏:统计 / 新增 / 打开目录 / 过滤 */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] text-muted-foreground">
          {t("共 ", "Total ")}{entries.length}{t(" 条 · 常驻 ", " · resident ")}{residentCount}{t(" 条", "")}
        </span>
        <div className="flex-1" />
        <div className="relative">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t("过滤记忆…", "Filter memories…")}
            className="pl-7 pr-2 py-1.5 text-[11px] bg-muted border border-border rounded focus:outline-none focus:ring-1 focus:ring-ring w-40"
          />
        </div>
        <button onClick={() => { setCreating(true); setEditing(null); }}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] rounded-lg bg-foreground text-background font-medium hover:opacity-90 transition-opacity">
          <Plus size={12} /> {t("新增记忆", "New memory")}
        </button>
      </div>

      {(creating || editing) && (
        <MemoryEditor
          entry={editing}
          onCancel={() => { setCreating(false); setEditing(null); }}
          onSave={async (input) => {
            await save(input);
            setCreating(false);
            setEditing(null);
          }}
        />
      )}

      {loading ? (
        <p className="text-xs text-muted-foreground">{t("扫描中…", "Scanning…")}</p>
      ) : entries.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-5 text-center space-y-1.5">
          <p className="text-xs text-foreground/80">{t("还没有任何记忆。", "No memories yet.")}</p>
          <p className="text-[11px] text-muted-foreground">
            {t("点「新增记忆」手动添加,或让 AI 在对话中用 ", "Click \"New memory\" to add one manually, or let the AI persist memories during chat via the ")}<code className="text-[10px] bg-muted px-1 rounded">remember</code>{t(" 工具自行沉淀。", " tool.")}
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {[{ label: t("项目", "Project"), rows: project }, { label: t("全局", "Global"), rows: global }].map((grp) =>
            grp.rows.length === 0 ? null : (
              <section key={grp.label} className="space-y-2">
                <h3 className="text-xs font-medium text-foreground/80 uppercase tracking-wider">{grp.label}（{grp.rows.length}）</h3>
                {grp.rows.map((e) => (
                  <MemoryRow key={e.id} entry={e} onEdit={() => { setEditing(e); setCreating(false); }} onDelete={() => remove(e.id)} />
                ))}
              </section>
            )
          )}
        </div>
      )}
    </div>
  );
}

function MemoryRow({ entry, onEdit, onDelete }: {
  entry: MemoryEntry; onEdit: () => void; onDelete: () => void;
}) {
  const t = useT();
  const [confirm, setConfirm] = useState(false);
  const meta = TYPE_META[entry.type];
  return (
    <div className={cn("rounded-lg border px-3 py-2.5 transition-colors",
      entry.error ? "border-destructive/50" : "border-border hover:border-ring")}>
      <div className="flex items-start gap-2.5">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={cn("text-[9px] px-1.5 py-0.5 rounded font-medium shrink-0",
              meta.resident ? "bg-accent-brand/15 text-accent-brand" : "bg-muted text-muted-foreground")}>
              {t(meta.zh, meta.en)}{meta.resident ? t(" · 常驻", " · resident") : ""}
            </span>
            <span className="text-xs font-medium text-foreground truncate">{entry.name}</span>
          </div>
          <p className="text-[11px] text-muted-foreground mt-1 line-clamp-2">{entry.description}</p>
          {entry.error && <p className="text-[10px] text-destructive mt-1">{entry.error}</p>}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={onEdit} title={t("编辑", "Edit")}
            className="px-2 py-1 text-[10px] rounded border border-border hover:bg-accent transition-colors">{t("编辑", "Edit")}</button>
          {confirm ? (
            <button onClick={onDelete} title={t("确认删除", "Confirm delete")}
              className="px-2 py-1 text-[10px] rounded bg-destructive text-background font-medium">{t("确认删除", "Confirm delete")}</button>
          ) : (
            <button onClick={() => { setConfirm(true); setTimeout(() => setConfirm(false), 3000); }} title={t("删除", "Delete")}
              className="p-1 rounded border border-border hover:bg-accent text-muted-foreground hover:text-destructive transition-colors">
              <Trash2 size={12} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function MemoryEditor({ entry, onCancel, onSave }: {
  entry: MemoryEntry | null;
  onCancel: () => void;
  onSave: (input: { name?: string; description: string; type: MemoryType; body?: string; source?: "project" | "global" }) => void;
}) {
  const t = useT();
  const [description, setDescription] = useState(entry?.description || "");
  const [type, setType] = useState<MemoryType>(entry?.type || "project");
  const [name, setName] = useState(entry?.name || "");
  const [body, setBody] = useState(entry?.body || "");
  const [source, setSource] = useState<"project" | "global">(entry?.source || "project");
  const isEdit = !!entry;

  const submit = () => {
    if (!description.trim()) return;
    // 编辑时沿用原 name(改名等于新建);新增时 name 可空,由后端按摘要 slug。
    onSave({
      name: isEdit ? entry!.name : (name.trim() || undefined),
      description: description.trim(),
      type,
      body: body.trim() || undefined,
      source,
    });
  };

  return (
    <div className="rounded-lg border border-ring bg-accent/20 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-foreground">{isEdit ? t("编辑记忆", "Edit memory") : t("新增记忆", "New memory")}</h3>
        <button onClick={onCancel} className="p-1 rounded hover:bg-accent text-muted-foreground"><X size={13} /></button>
      </div>

      <div>
        <label className="text-[10px] text-muted-foreground uppercase tracking-wider">{t("摘要(一行,会进常驻索引)", "Summary (one line, added to resident index)")}</label>
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t("例如:用户偏好 TypeScript 严格模式,所有新代码须通过 tsc --strict", "e.g. User prefers TypeScript strict mode; all new code must pass tsc --strict")}
          className="mt-1 w-full px-2.5 py-1.5 text-xs bg-muted border border-border rounded focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider">{t("类型", "Type")}</label>
          <div className="mt-1 flex flex-wrap gap-1">
            {TYPE_ORDER.map((ty) => (
              <button key={ty} onClick={() => setType(ty)} title={t(TYPE_META[ty].hintZh, TYPE_META[ty].hintEn)}
                className={cn("px-2 py-1 text-[10px] rounded border transition-colors",
                  type === ty ? "bg-foreground text-background border-foreground" : "border-border text-muted-foreground hover:text-foreground")}>
                {t(TYPE_META[ty].zh, TYPE_META[ty].en)}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider">{t("作用域", "Scope")}</label>
          <div className="mt-1 flex gap-1">
            {(["project", "global"] as const).map((s) => (
              <button key={s} onClick={() => setSource(s)} disabled={isEdit}
                className={cn("px-2 py-1 text-[10px] rounded border transition-colors disabled:opacity-50",
                  source === s ? "bg-foreground text-background border-foreground" : "border-border text-muted-foreground hover:text-foreground")}>
                {s === "project" ? t("项目", "Project") : t("全局", "Global")}
              </button>
            ))}
          </div>
        </div>
      </div>

      {!isEdit && (
        <div>
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider">{t("名称(可选,文件 slug)", "Name (optional, file slug)")}</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("留空则按摘要自动生成", "Leave blank to auto-generate from summary")}
            className="mt-1 w-full px-2.5 py-1.5 text-xs bg-muted border border-border rounded focus:outline-none focus:ring-1 focus:ring-ring font-mono"
          />
        </div>
      )}

      <div>
        <label className="text-[10px] text-muted-foreground uppercase tracking-wider">{t("正文(可选,完整内容,仅按需召回)", "Body (optional, full content, recalled on demand only)")}</label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={t("更详细的说明。反馈/项目类建议写明「为什么」与「如何应用」。", "More detailed notes. For feedback/project entries, explain the \"why\" and \"how to apply\".")}
          className="mt-1 w-full h-24 px-2.5 py-1.5 text-xs bg-muted border border-border rounded focus:outline-none focus:ring-1 focus:ring-ring resize-none font-mono leading-relaxed"
        />
      </div>

      <div className="flex items-center gap-2">
        <button onClick={submit} disabled={!description.trim()}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-foreground text-background rounded font-medium hover:opacity-90 transition-opacity disabled:opacity-50">
          <Save size={12} /> {isEdit ? t("保存", "Save") : t("创建", "Create")}
        </button>
        <button onClick={onCancel} className="px-3 py-1.5 text-xs rounded border border-border hover:bg-accent transition-colors">{t("取消", "Cancel")}</button>
      </div>
    </div>
  );
}



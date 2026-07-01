import { useState, useEffect } from "react";
import { useAppStore } from "../../stores/app-store";
import { useT } from "../../lib/i18n";
import { FileText, Save, FolderOpen } from "lucide-react";
import { PageHeader, Segmented, Hint, PrimaryButton, GhostButton } from "../ui/settings";

interface ClaudeMdFile {
  level: "global" | "project" | "local";
  path: string;
  content: string;
}

export function ContextManager() {
  var t = useT();
  var { projectPath } = useAppStore();
  var [files, setFiles] = useState<ClaudeMdFile[]>([]);
  var [activeFile, setActiveFile] = useState<string>("project");
  var [content, setContent] = useState("");
  var [saved, setSaved] = useState(false);
  var [saveError, setSaveError] = useState<string | null>(null);

  useEffect(function() {
    if (!projectPath) return;
    var cancelled = false;
    window.api.getHomeDir().then(function(homePath: string) {
      var entries: ClaudeMdFile[] = [
        { level: "global", path: homePath + "/.claude/CLAUDE.md", content: "" },
        { level: "project", path: projectPath + "/CLAUDE.md", content: "" },
        { level: "local", path: projectPath + "/.claude/CLAUDE.md", content: "" },
      ];
      return Promise.all(entries.map(function(e) {
        return window.api.readFile(e.path).then(function(result: any) {
          if (result && result.content) e.content = result.content;
        }).catch(function() {});
      })).then(function() { if (!cancelled) setFiles(entries); });
    });
    return function() { cancelled = true; };
  }, [projectPath]);

  var currentFile = files.find(function(f) { return f.level === activeFile; });

  // 打开当前 CLAUDE.md 所在目录（取文件路径的父目录）。目录不存在时 ensureDirAndOpen
  // 会先创建——local 级的 .claude/ 首次可能还没建。
  var openDir = function() {
    if (!currentFile) return;
    var p = currentFile.path;
    var dir = p.replace(/[/\\][^/\\]*$/, "");
    if (dir) window.api.ensureDirAndOpen?.(dir);
  };

  var handleSave = function() {
    if (!currentFile) return;
    window.api.writeFile(currentFile.path, content).then(function(res: any) {
      if (res && res.ok) {
        setFiles(function(prev) {
          return prev.map(function(f) {
            return f.level === currentFile!.level ? { ...f, content: content } : f;
          });
        });
        setSaved(true);
        setSaveError(null);
        setTimeout(function() { setSaved(false); }, 2000);
      } else {
        setSaveError((res && res.error) || "unknown error");
        setTimeout(function() { setSaveError(null); }, 5000);
      }
    });
  };

  useEffect(function() {
    if (currentFile) setContent(currentFile.content);
  }, [activeFile, currentFile?.content]);

  return (
    <div className="space-y-4">
      <PageHeader
        icon={FileText}
        title="CLAUDE.md"
        subtitle={
          <span className="inline-flex items-center gap-1.5">
            {t("项目指令文件，注入每次会话的稳定前缀", "Project instruction files, injected into each session's stable prefix")}
            <Hint>
              {t("每次会话开始时注入系统提示稳定前缀（进缓存，省 token）。任何 provider（GPT / DeepSeek / Claude / 本地模型）都会读到并遵守。兼容 Claude Code 的 CLAUDE.md 与 Codex 的 AGENTS.md。", "Injected into the stable prefix of the system prompt at the start of each session (cached, saving tokens). Every provider reads and follows them. Compatible with Claude Code's CLAUDE.md and Codex's AGENTS.md.")}
            </Hint>
          </span>
        }
        actions={
          <GhostButton onClick={openDir}>
            <FolderOpen size={12} />
            <span>{t("打开目录", "Open folder")}</span>
          </GhostButton>
        }
      />

      <Segmented
        value={activeFile}
        onChange={(level) => setActiveFile(level)}
        options={(["global", "project", "local"] as const).map((level) => ({ value: level, label: <span className="capitalize">{level}</span> }))}
      />

      <div className="rounded-xl ring-1 ring-border/40 bg-muted/30 overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-1.5 text-[10px] text-muted-foreground bg-muted/40">
          <FileText size={11} />
          <span className="font-mono">{currentFile?.path || ""}</span>
        </div>
        <textarea
          value={content}
          onChange={function(e) { setContent((e.target as HTMLTextAreaElement).value); }}
          placeholder={"Add custom instructions for Claude. These will be included in every session for " + activeFile + " scope."}
          className="w-full h-64 p-3 text-sm bg-transparent resize-none focus:outline-none text-foreground placeholder:text-muted-foreground font-mono leading-relaxed"
          spellCheck={false}
        />
      </div>

      <div className="flex items-center gap-3">
        <PrimaryButton onClick={handleSave}>
          <Save size={12} />
          <span>{saved ? t("已保存!", "Saved!") : t("保存 ", "Save ") + activeFile + ".md"}</span>
        </PrimaryButton>
        {saveError && (
          <span className="text-[10px] text-destructive">{t("保存失败: ", "Save failed: ")}{saveError}</span>
        )}
      </div>
    </div>
  );
}

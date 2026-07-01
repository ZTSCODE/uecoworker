import { useState, useEffect, useCallback } from "react";
import { useAppStore } from "../../stores/app-store";
import CodeMirror from "@uiw/react-codemirror";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { rust } from "@codemirror/lang-rust";
import { oneDark } from "@codemirror/theme-one-dark";
import { cn } from "../../lib/utils";

const langMap: Record<string, any> = {
  ts: javascript({ typescript: true }),
  tsx: javascript({ jsx: true, typescript: true }),
  js: javascript(),
  jsx: javascript({ jsx: true }),
  py: python(),
  json: json(),
  md: markdown(),
  css: css(),
  html: html(),
  htm: html(),
  rs: rust(),
};

export function CodeEditor() {
  const { openFiles, addOpenFile, removeOpenFile, projectPath } = useAppStore();
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [fileContents, setFileContents] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  const loadFile = useCallback(async (filePath: string) => {
    setLoading(true);
    try {
      const result = await window.api.readFile(filePath);
      if (result.content !== undefined) {
        setFileContents((prev) => ({ ...prev, [filePath]: result.content! }));
      }
    } catch (err) {
      console.error("Failed to load file:", err);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (activeFile && !fileContents[activeFile]) {
      loadFile(activeFile);
    }
  }, [activeFile]);

  const getExtension = (path: string) => path.split(".").pop()?.toLowerCase() || "";

  const handleChange = useCallback(async (value: string) => {
    if (!activeFile) return;
    setFileContents((prev) => ({ ...prev, [activeFile]: value }));
  }, [activeFile]);

  if (!projectPath) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
        <p>Open a project to edit files</p>
      </div>
    );
  }

  if (openFiles.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center space-y-3">
          <p className="text-sm text-muted-foreground">No files open</p>
          <p className="text-xs text-muted-foreground/50">Use the File Explorer to open files</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center border-b border-border bg-card overflow-x-auto">
        {openFiles.map((file) => (
          <button
            key={file}
            onClick={() => setActiveFile(file)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 text-xs border-r border-border transition-colors whitespace-nowrap",
              activeFile === file
                ? "bg-background text-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
            )}
          >
            <span className="font-mono text-[10px] text-foreground/40">
              [{getExtension(file).toUpperCase()}]
            </span>
            <span>{file.split(/[\\\/]/).pop()}</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                removeOpenFile(file);
                if (activeFile === file) setActiveFile(null);
              }}
              className="ml-1 w-4 h-4 flex items-center justify-center rounded hover:bg-destructive/20 hover:text-destructive"
            >
              ×
            </button>
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-hidden">
        {activeFile && fileContents[activeFile] !== undefined ? (
          <CodeMirror
            value={fileContents[activeFile]}
            onChange={handleChange}
            extensions={[langMap[getExtension(activeFile)] || javascript()]}
            theme={oneDark}
            height="100%"
            basicSetup={{
              lineNumbers: true,
              foldGutter: true,
              autocompletion: true,
              bracketMatching: true,
              closeBrackets: true,
              highlightActiveLine: true,
            }}
            style={{ height: "100%" }}
          />
        ) : activeFile ? (
          <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
            Loading...
          </div>
        ) : null}
      </div>
    </div>
  );
}

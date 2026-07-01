import { useState, useEffect, useRef } from "react";
import { useAppStore } from "../../stores/app-store";
import { useStreamStore } from "../../stores/stream-store";
import type { StreamEvent } from "../../stores/stream-store";
import { cn } from "../../lib/utils";
import {
  User, Bot, Wrench, FileCode, Terminal, Globe,
  ChevronDown, ChevronRight, Copy, Check, Clock, DollarSign,
  Play, Pause, Trash2, Loader2
} from "lucide-react";

export function StreamView() {
  const { projectPath } = useAppStore();
  const { events, watching, setWatching, clearEvents } = useStreamStore();
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const streamEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Start watching JSONL when project opens
  useEffect(() => {
    if (projectPath) {
      window.api.startStreamWatch?.(projectPath).then(() => setWatching(true));
      return () => {
        window.api.stopStreamWatch?.(projectPath);
        setWatching(false);
      };
    }
  }, [projectPath]);

  // Listen for stream events
  useEffect(() => {
    const unsub = window.api.onStreamEvent?.((event: StreamEvent) => {
      useStreamStore.getState().addEvent(event);
    });
    return unsub;
  }, []);

  // Auto-scroll
  useEffect(() => {
    if (autoScroll && streamEndRef.current) {
      streamEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [events, autoScroll]);

  // Detect manual scroll to disable auto-scroll
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      setAutoScroll(scrollHeight - scrollTop - clientHeight < 60);
    };
    container.addEventListener("scroll", handleScroll);
    return () => container.removeEventListener("scroll", handleScroll);
  }, []);

  const toggleCard = (id: string) => {
    setExpandedCards((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const copyToClipboard = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {}
  };

  const copyAll = () => {
    const text = events
      .filter((e) => e.type !== "system")
      .map((e) => {
        if (e.type === "assistant") return e.data.text || "";
        if (e.type === "user") return `> ${e.data.text || ""}`;
        if (e.type === "tool_use") return `[Tool: ${e.data.tool}] ${JSON.stringify(e.data.input || {})}`;
        return "";
      })
      .filter(Boolean)
      .join("\n\n");
    try {
      navigator.clipboard.writeText(text);
    } catch {}
  };

  if (!projectPath) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
        <p>Open a project to start streaming</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-card">
        <div className="flex items-center gap-3">
          <h3 className="text-xs font-semibold text-foreground/70">Live Stream</h3>
          {watching ? (
            <span className="flex items-center gap-1 text-[10px] text-green-500">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
              Live
            </span>
          ) : (
            <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <Loader2 size={10} className="animate-spin" />
              Waiting
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={clearEvents}
            className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
            title="Clear stream"
          >
            <Trash2 size={13} />
          </button>
          <button
            onClick={() => setAutoScroll(!autoScroll)}
            className={cn(
              "p-1 rounded hover:bg-accent transition-colors",
              autoScroll ? "text-green-500" : "text-muted-foreground hover:text-foreground"
            )}
            title={autoScroll ? "Auto-scroll on" : "Auto-scroll off"}
          >
            {autoScroll ? <Play size={13} /> : <Pause size={13} />}
          </button>
          <button
            onClick={copyAll}
            className="text-[11px] px-2 py-0.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
          >
            <Copy size={11} />
            <span>Copy All</span>
          </button>
        </div>
      </div>

      <div ref={containerRef} className="flex-1 overflow-y-auto">
        {events.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <div className="text-center space-y-3">
              <Bot size={32} className="mx-auto text-muted-foreground/20" />
              <p className="text-sm text-muted-foreground">
                {watching
                  ? "Waiting for Claude Code activity..."
                  : "Start a session in the Terminal tab"}
              </p>
              <p className="text-xs text-muted-foreground/50">
                Events will appear here as Claude works
              </p>
            </div>
          </div>
        ) : (
          <div className="p-4 space-y-2">
            {events.map((event) => (
              <StreamCard
                key={event.id}
                event={event}
                expanded={expandedCards.has(event.id)}
                onToggle={() => toggleCard(event.id)}
                copied={copiedId === event.id}
                onCopy={(text) => copyToClipboard(text, event.id)}
              />
            ))}
            <div ref={streamEndRef} />
          </div>
        )}
      </div>
    </div>
  );
}

function StreamCard({
  event,
  expanded,
  onToggle,
  copied,
  onCopy,
}: {
  event: StreamEvent;
  expanded: boolean;
  onToggle: () => void;
  copied: boolean;
  onCopy: (text: string) => void;
}) {
  if (event.type === "system") return null;

  // Assistant text message
  if (event.type === "assistant") {
    const text = event.data?.text || "";
    if (!text) return null;
    return (
      <div className="rounded-lg border border-border/50 bg-card/50 p-3 relative group">
        <div className="flex items-center gap-2 mb-2">
          <Bot size={12} className="text-blue-400" />
          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Claude</span>
          {event.data?.cost && (
            <span className="text-[10px] text-muted-foreground/50 ml-auto">{event.data.cost}</span>
          )}
        </div>
        <div className="text-sm text-foreground/90 whitespace-pre-wrap leading-relaxed">
          {text}
        </div>
        <button
          onClick={() => onCopy(text)}
          className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-accent"
        >
          {copied ? <Check size={12} className="text-green-500" /> : <Copy size={12} className="text-muted-foreground" />}
        </button>
      </div>
    );
  }

  // User message
  if (event.type === "user") {
    const text = event.data?.text || "";
    if (!text) return null;
    return (
      <div className="rounded-lg border border-border/30 bg-accent/30 p-3">
        <div className="flex items-center gap-2 mb-1.5">
          <User size={12} className="text-green-400" />
          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">You</span>
        </div>
        <div className="text-sm text-foreground/80 whitespace-pre-wrap">
          {text.length > 200 && !expanded ? text.slice(0, 200) + "..." : text}
        </div>
        {text.length > 200 && (
          <button onClick={onToggle} className="text-[10px] text-muted-foreground hover:text-foreground mt-1">
            {expanded ? "Show less" : "Show more"}
          </button>
        )}
      </div>
    );
  }

  // Tool use
  if (event.type === "tool_use") {
    const tool = event.data?.tool || "Unknown";
    const input = event.data?.input || {};
    const toolIcon = getToolIcon(tool);
    return (
      <div className="rounded-lg border border-border bg-card overflow-hidden group">
        <button
          onClick={onToggle}
          className="w-full flex items-center gap-2 px-3 py-2 hover:bg-accent/50 transition-colors text-left"
        >
          {toolIcon}
          <span className="text-xs font-medium text-foreground/80 flex-1">{tool}</span>
          <span className="text-[10px] text-muted-foreground truncate max-w-[200px]">
            {typeof input === "object"
              ? Object.entries(input).slice(0, 2).map(([k, v]) => `${k}=${String(v).slice(0, 30)}`).join(", ")
              : String(input).slice(0, 60)}
          </span>
          {expanded ? <ChevronDown size={14} className="text-muted-foreground" /> : <ChevronRight size={14} className="text-muted-foreground" />}
        </button>
        {expanded && (
          <div className="px-3 pb-3 pt-1 border-t border-border/50">
            <pre className="text-[11px] text-muted-foreground bg-muted rounded p-2 overflow-x-auto max-h-48 overflow-y-auto font-mono">
              {JSON.stringify(input, null, 2)}
            </pre>
          </div>
        )}
      </div>
    );
  }

  return null;
}

function getToolIcon(tool: string) {
  const className = "w-4 h-4 flex-shrink-0";
  switch (tool.toLowerCase()) {
    case "read": return <FileCode size={14} className="text-blue-400" />;
    case "write": case "edit": return <Wrench size={14} className="text-yellow-400" />;
    case "bash": return <Terminal size={14} className="text-green-400" />;
    case "websearch": case "webfetch": return <Globe size={14} className="text-purple-400" />;
    case "task": case "agent": return <Bot size={14} className="text-cyan-400" />;
    default: return <Wrench size={14} className="text-muted-foreground" />;
  }
}

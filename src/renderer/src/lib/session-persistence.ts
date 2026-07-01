import type { ChatSession, ChatMessage } from "../stores/chat-store";

var STORAGE_KEY = "ue-coworker-chat-sessions";

export function saveSessions(sessions: ChatSession[]): void {
  try {
    var data = JSON.stringify(sessions);
    localStorage.setItem(STORAGE_KEY, data);
  } catch(e) {
    console.error("Failed to save sessions:", e);
  }
}

export function loadSessions(): ChatSession[] {
  try {
    var raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch(e) {
    console.error("Failed to load sessions:", e);
    return [];
  }
}

export function exportSession(session: ChatSession): string {
  var lines: string[] = [];
  lines.push("# UE Coworker Chat Session: " + session.name);
  lines.push("# Provider: " + session.provider + " | Model: " + session.model);
  lines.push("# Date: " + new Date(session.createdAt).toISOString());
  lines.push("");
  for (var i = 0; i < session.messages.length; i++) {
    var msg = session.messages[i];
    if (msg.role === "user") {
      lines.push("## You");
      lines.push(msg.content);
    } else if (msg.role === "assistant") {
      lines.push("## Assistant");
      lines.push(msg.content);
    } else if (msg.role === "tool") {
      lines.push("## Tool: " + (msg.toolCall?.name || "unknown"));
      lines.push("```json");
      lines.push(JSON.stringify(msg.toolCall?.input || {}, null, 2));
      lines.push("```");
    }
    lines.push("");
  }
  return lines.join("\n");
}

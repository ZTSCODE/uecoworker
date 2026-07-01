export interface Shortcut {
  id: string;
  keys: string;
  action: string;
  category: string;
}

export const DEFAULT_SHORTCUTS: Shortcut[] = [
  { id: "new-chat", keys: "Ctrl+N", action: "New Chat", category: "Chat" },
  { id: "send-message", keys: "Enter", action: "Send Message", category: "Chat" },
  { id: "new-terminal", keys: "Ctrl+Shift+T", action: "New Terminal", category: "Terminal" },
  { id: "toggle-sidebar", keys: "Ctrl+B", action: "Toggle Sidebar", category: "View" },
  { id: "toggle-theme", keys: "Ctrl+Shift+L", action: "Toggle Light/Dark", category: "View" },
  { id: "switch-chat", keys: "Ctrl+1", action: "Switch to Chat", category: "Navigation" },
  { id: "switch-terminal", keys: "Ctrl+2", action: "Switch to Terminal", category: "Navigation" },
  { id: "switch-editor", keys: "Ctrl+3", action: "Switch to Editor", category: "Navigation" },
  { id: "switch-explorer", keys: "Ctrl+4", action: "Switch to Explorer", category: "Navigation" },
  { id: "switch-config", keys: "Ctrl+5", action: "Switch to Config", category: "Navigation" },
  { id: "open-project", keys: "Ctrl+O", action: "Open Project", category: "File" },
  { id: "close-tab", keys: "Ctrl+W", action: "Close Active Tab", category: "File" },
  { id: "find", keys: "Ctrl+F", action: "Find in File", category: "Editor" },
  { id: "save-file", keys: "Ctrl+S", action: "Save File", category: "Editor" },
];

export function getShortcutsByCategory(): Record<string, Shortcut[]> {
  var result: Record<string, Shortcut[]> = {};
  for (var i = 0; i < DEFAULT_SHORTCUTS.length; i++) {
    var s = DEFAULT_SHORTCUTS[i];
    if (!result[s.category]) result[s.category] = [];
    result[s.category].push(s);
  }
  return result;
}

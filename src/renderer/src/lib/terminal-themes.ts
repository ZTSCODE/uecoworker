export interface TerminalTheme {
  id: string;
  name: string;
  colors: Record<string, string>;
}

export const TERMINAL_THEMES: TerminalTheme[] = [
  {
    id: "dark", name: "UE Coworker Dark",
    colors: { background: "#0a0a0b", foreground: "#e4e4e7", cursor: "#e4e4e7",
      selectionBackground: "#3b3b4d", black: "#18181b", red: "#f87171",
      green: "#4ade80", yellow: "#fbbf24", blue: "#60a5fa",
      magenta: "#c084fc", cyan: "#22d3ee", white: "#e4e4e7",
      brightBlack: "#52525b", brightRed: "#fca5a5", brightGreen: "#86efac",
      brightYellow: "#fde68a", brightBlue: "#93c5fd", brightMagenta: "#d8b4fe",
      brightCyan: "#67e8f9", brightWhite: "#fafafa" }
  },
  {
    id: "light", name: "UE Coworker Light",
    colors: { background: "#ffffff", foreground: "#1f2328", cursor: "#1f2328",
      selectionBackground: "#cfe3ff", black: "#1f2328", red: "#cf222e",
      green: "#116329", yellow: "#9a6700", blue: "#0969da",
      magenta: "#8250df", cyan: "#1b7c83", white: "#6e7781",
      brightBlack: "#57606a", brightRed: "#a40e26", brightGreen: "#1a7f37",
      brightYellow: "#7d4e00", brightBlue: "#218bff", brightMagenta: "#a475f9",
      brightCyan: "#3192aa", brightWhite: "#1f2328" }
  },
  {
    id: "dracula", name: "Dracula",
    colors: { background: "#282a36", foreground: "#f8f8f2", cursor: "#f8f8f2",
      selectionBackground: "#44475a", black: "#21222c", red: "#ff5555",
      green: "#50fa7b", yellow: "#f1fa8c", blue: "#bd93f9",
      magenta: "#ff79c6", cyan: "#8be9fd", white: "#f8f8f2",
      brightBlack: "#6272a4", brightRed: "#ff6e6e", brightGreen: "#69ff94",
      brightYellow: "#ffffa5", brightBlue: "#d6acff", brightMagenta: "#ff92df",
      brightCyan: "#a4ffff", brightWhite: "#ffffff" }
  },
  {
    id: "nord", name: "Nord",
    colors: { background: "#2e3440", foreground: "#d8dee9", cursor: "#d8dee9",
      selectionBackground: "#434c5e", black: "#3b4252", red: "#bf616a",
      green: "#a3be8c", yellow: "#ebcb8b", blue: "#81a1c1",
      magenta: "#b48ead", cyan: "#88c0d0", white: "#e5e9f0",
      brightBlack: "#4c566a", brightRed: "#bf616a", brightGreen: "#a3be8c",
      brightYellow: "#ebcb8b", brightBlue: "#81a1c1", brightMagenta: "#b48ead",
      brightCyan: "#8fbcbb", brightWhite: "#eceff4" }
  },
  {
    id: "monokai", name: "Monokai",
    colors: { background: "#272822", foreground: "#f8f8f2", cursor: "#f8f8f2",
      selectionBackground: "#49483e", black: "#272822", red: "#f92672",
      green: "#a6e22e", yellow: "#f4bf75", blue: "#66d9ef",
      magenta: "#ae81ff", cyan: "#a1efe4", white: "#f8f8f2",
      brightBlack: "#75715e", brightRed: "#f92672", brightGreen: "#a6e22e",
      brightYellow: "#f4bf75", brightBlue: "#66d9ef", brightMagenta: "#ae81ff",
      brightCyan: "#a1efe4", brightWhite: "#f9f8f5" }
  },
  {
    id: "solarized-dark", name: "Solarized Dark",
    colors: { background: "#002b36", foreground: "#839496", cursor: "#839496",
      selectionBackground: "#073642", black: "#073642", red: "#dc322f",
      green: "#859900", yellow: "#b58900", blue: "#268bd2",
      magenta: "#d33682", cyan: "#2aa198", white: "#eee8d5",
      brightBlack: "#002b36", brightRed: "#cb4b16", brightGreen: "#586e75",
      brightYellow: "#657b83", brightBlue: "#839496", brightMagenta: "#6c71c4",
      brightCyan: "#93a1a1", brightWhite: "#fdf6e3" }
  },
  {
    id: "solarized-light", name: "Solarized Light",
    colors: { background: "#fdf6e3", foreground: "#657b83", cursor: "#657b83",
      selectionBackground: "#eee8d5", black: "#073642", red: "#dc322f",
      green: "#859900", yellow: "#b58900", blue: "#268bd2",
      magenta: "#d33682", cyan: "#2aa198", white: "#eee8d5",
      brightBlack: "#002b36", brightRed: "#cb4b16", brightGreen: "#586e75",
      brightYellow: "#657b83", brightBlue: "#839496", brightMagenta: "#6c71c4",
      brightCyan: "#93a1a1", brightWhite: "#fdf6e3" }
  },
  {
    id: "tokyo-night", name: "Tokyo Night",
    colors: { background: "#1a1b26", foreground: "#c0caf5", cursor: "#c0caf5",
      selectionBackground: "#33467c", black: "#15161e", red: "#f7768e",
      green: "#9ece6a", yellow: "#e0af68", blue: "#7aa2f7",
      magenta: "#bb9af7", cyan: "#7dcfff", white: "#a9b1d6",
      brightBlack: "#414868", brightRed: "#f7768e", brightGreen: "#9ece6a",
      brightYellow: "#e0af68", brightBlue: "#7aa2f7", brightMagenta: "#bb9af7",
      brightCyan: "#7dcfff", brightWhite: "#c0caf5" }
  },
  {
    id: "gruvbox", name: "Gruvbox Dark",
    colors: { background: "#282828", foreground: "#ebdbb2", cursor: "#ebdbb2",
      selectionBackground: "#3c3836", black: "#282828", red: "#cc241d",
      green: "#98971a", yellow: "#d79921", blue: "#458588",
      magenta: "#b16286", cyan: "#689d6a", white: "#a89984",
      brightBlack: "#928374", brightRed: "#fb4934", brightGreen: "#b8bb26",
      brightYellow: "#fabd2f", brightBlue: "#83a598", brightMagenta: "#d3869b",
      brightCyan: "#8ec07c", brightWhite: "#ebdbb2" }
  },
];

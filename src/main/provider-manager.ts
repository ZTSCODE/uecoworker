/**
 * Multi-provider support for UE Coworker.
 * Manages CLI agent providers: Claude Code, OpenAI Codex, Gemini CLI, etc.
 */

export interface ProviderConfig {
  id: string;
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  description: string;
  icon: string;
}

export const BUILTIN_PROVIDERS: ProviderConfig[] = [
  {
    id: "claude",
    name: "Claude Code",
    command: "claude",
    args: [],
    env: {},
    description: "Anthropic's agentic coding tool",
    icon: "sparkles",
  },
  {
    id: "codex",
    name: "OpenAI Codex",
    command: "codex",
    args: [],
    env: {},
    description: "OpenAI's CLI coding agent",
    icon: "terminal",
  },
  {
    id: "gemini",
    name: "Gemini CLI",
    command: "gemini",
    args: [],
    env: {},
    description: "Google's Gemini CLI agent",
    icon: "bot",
  },
  {
    id: "shell",
    name: "Shell",
    command: process.platform === "win32" ? "powershell.exe" : (process.env.SHELL || "/bin/bash"),
    args: [],
    env: {},
    description: "System shell (passthrough mode)",
    icon: "terminal",
  },
];

export class ProviderManager {
  private providers: ProviderConfig[] = [...BUILTIN_PROVIDERS];
  private customProviders: ProviderConfig[] = [];

  getProviders(): ProviderConfig[] {
    return [...this.providers, ...this.customProviders];
  }

  getProvider(id: string): ProviderConfig | undefined {
    return this.getProviders().find((p) => p.id === id);
  }

  addCustomProvider(config: ProviderConfig): void {
    const existing = this.customProviders.findIndex((p) => p.id === config.id);
    if (existing >= 0) {
      this.customProviders[existing] = config;
    } else {
      this.customProviders.push(config);
    }
  }

  removeCustomProvider(id: string): void {
    this.customProviders = this.customProviders.filter((p) => p.id !== id);
  }

  getShellCommand(providerId: string): { command: string; args: string[] } | null {
    const provider = this.getProvider(providerId);
    if (!provider) return null;
    return { command: provider.command, args: provider.args };
  }
}

// 斜杠命令注册表。对标 Cline / Cursor / Claude Code 的 "/" 命令：在聊天输入框
// 开头输入 "/" 弹出命令面板。命令分两类：
//   - action：纯客户端动作（新建会话、切权限模式、打开设置等），不发给模型。
//   - prompt：把一段提示词展开后作为用户消息发送（可带 {input} 占位符接收 "/cmd 之后的文字"）。
// 复用既有 store 能力（chat-store / app-store / provider-store），不另起炉灶。

export type SlashKind = "action" | "prompt";

export interface SlashCommand {
  name: string;            // 不含斜杠，如 "clear"
  aliases?: string[];      // 备用名
  description: string;     // 面板里的中文说明
  descriptionEn?: string;  // 面板里的英文说明（界面切英文时使用）
  kind: SlashKind;
  hint?: string;           // 参数提示，如 "<文件>"
  hintEn?: string;         // 英文参数提示，如 "<file>"
  // prompt 类：返回要发送给 agent 的最终文本。arg 是命令名之后的剩余输入。
  buildPrompt?: (arg: string) => string;
  // action 类：在 SlashContext 上执行客户端动作。可返回要回填到输入框的文本。
  run?: (ctx: SlashContext, arg: string) => void | string | Promise<void | string>;
}

// 执行动作所需的回调集合，由 ChatView 注入（拿到它已有的 store 句柄）。
export interface SlashContext {
  newSession: () => void;
  setPermissionMode: (mode: "default" | "acceptEdits" | "plan" | "bypassPermissions") => void;
  // 切换当前会话的纯聊天模式（/chat）。on=true 进入聊天模式，false 退出回到 agent。
  setChatMode: (on: boolean) => void;
  // 切换当前会话的文字游戏模式（/game，AI RPG）。与 chatMode 互斥。
  setGameMode: (on: boolean) => void;
  openSettings: (tab?: string) => void;
  notify: (msg: string) => void;
  // 压缩当前会话上下文（调用模型生成摘要并替换历史消息）。异步。
  compact: () => Promise<void>;
  // 打开「上下文占用」面板（/context）。
  showContext: () => void;
  // 在斜杠面板顶部展开「推理强度」二级面板（/effort）。返回 false 表示当前不可用
  // （如 Anthropic 端点），调用方据此回退到普通处理。
  openEffortMenu: () => boolean;
  // 切换当前会话的扩展思考模式（/think，仅 Anthropic 端点）。返回切换后的开关状态，
  // 或 null 表示当前端点不支持（非 Anthropic），调用方据此提示。
  toggleThinking: () => boolean | null;
}

export var SLASH_COMMANDS: SlashCommand[] = [
  {
    name: "init", kind: "prompt",
    description: "分析项目并生成 UE-COWORKER.md 项目指南",
    descriptionEn: "Analyze the project and generate a UE-COWORKER.md project guide",
    buildPrompt: function () {
      return [
        "请分析当前项目并生成一份简洁的项目指南，写入仓库根目录的 UE-COWORKER.md 文件。",
        "内容包含：项目用途、技术栈、目录结构要点、构建/运行/测试命令、关键约定。",
        "先用工具浏览代码（package.json、README、主要源码目录）再动笔，已存在则更新而非覆盖无关内容。",
      ].join("\n");
    },
  },
  {
    name: "explain", kind: "prompt", hint: "<文件或主题>", hintEn: "<file or topic>",
    description: "解释一段代码或某个模块的工作原理",
    descriptionEn: "Explain how a piece of code or a module works",
    buildPrompt: function (arg) {
      return arg
        ? "请解释 " + arg + " 的工作原理：用途、关键流程、依赖关系，必要时读取相关文件。"
        : "请解释当前项目的整体架构与关键模块如何协作，先浏览代码再说明。";
    },
  },
  {
    name: "fix", kind: "prompt", hint: "<问题描述>", hintEn: "<problem description>",
    description: "定位并修复一个 bug",
    descriptionEn: "Locate and fix a bug",
    buildPrompt: function (arg) {
      return arg
        ? "请定位并修复以下问题：" + arg + "。先复现/定位根因，再做最小改动，最后说明修复点。"
        : "请检查项目中的明显错误并修复，先定位根因再做最小改动。";
    },
  },
  {
    name: "test", kind: "prompt", hint: "<文件>", hintEn: "<file>",
    description: "为指定文件/模块编写单元测试",
    descriptionEn: "Write unit tests for a given file/module",
    buildPrompt: function (arg) {
      return (arg ? "请为 " + arg + " 编写单元测试。" : "请为关键模块补充单元测试。") +
        "遵循项目已有的测试框架与风格，先查看现有测试再编写。";
    },
  },
  {
    name: "review", kind: "prompt", hint: "<文件/范围>", hintEn: "<file/scope>",
    description: "代码审查：找出问题与改进点",
    descriptionEn: "Code review: find issues and improvements",
    buildPrompt: function (arg) {
      return (arg ? "请审查 " + arg + "。" : "请审查最近改动的代码。") +
        "关注正确性、边界条件、安全与性能问题，按优先级列出并给出具体修改建议。";
    },
  },
  {
    name: "commit", kind: "prompt",
    description: "查看改动并生成一条规范的提交信息",
    descriptionEn: "Review changes and generate a conventional commit message",
    buildPrompt: function () {
      return [
        "请用 run_command 执行 `git status` 和 `git diff` 查看当前改动，",
        "然后总结改动并生成一条符合 Conventional Commits 规范的提交信息（英文）。",
        "先展示给我确认，不要自动提交。",
      ].join("\n");
    },
  },
  // --- 客户端动作 ---
  {
    name: "compact", kind: "action",
    description: "压缩上下文：用摘要替换历史，降低后续 token 占用",
    descriptionEn: "Compact context: replace history with a summary to cut token usage",
    run: function (ctx) { return ctx.compact(); },
  },
  {
    name: "context", kind: "action",
    description: "查看上下文窗口占用：各类别 token 明细",
    descriptionEn: "View context window usage: token breakdown by category",
    run: function (ctx) { ctx.showContext(); },
  },
  {
    name: "clear", aliases: ["new"], kind: "action",
    description: "新建一个空白对话",
    descriptionEn: "Start a new blank conversation",
    run: function (ctx) { ctx.newSession(); },
  },
  {
    name: "chat", kind: "action",
    description: "纯聊天模式：不主动读取项目，直接对话（工具仍保留）",
    descriptionEn: "Chat-only mode: talk directly without proactively reading the project (tools still available)",
    // 三模式互斥（chat / game / plan 至多一个）：进入 chat 时清掉 game、切回询问权限。
    run: function (ctx) { ctx.setGameMode(false); ctx.setPermissionMode("default"); ctx.setChatMode(true); },
  },
  {
    name: "agent", aliases: ["code"], kind: "action",
    description: "退出纯聊天 / 文字游戏模式，回到会主动调查项目的 Agent 模式",
    descriptionEn: "Exit chat / text-game mode and return to Agent mode that proactively investigates the project",
    run: function (ctx) { ctx.setChatMode(false); ctx.setGameMode(false); },
  },
  {
    name: "game", aliases: ["rpg"], kind: "action",
    description: "文字游戏模式：开启一局 AI RPG 文字冒险（用 /agent 退出）",
    descriptionEn: "Text-game mode: start an AI RPG text adventure (use /agent to exit)",
    // 三模式互斥：进入 game 时清掉 chat、切回询问权限。
    run: function (ctx) { ctx.setChatMode(false); ctx.setPermissionMode("default"); ctx.setGameMode(true); },
  },
  {
    name: "effort", kind: "action",
    description: "推理强度：选中后展开二级面板选择档位（仅 OpenAI 端点）",
    descriptionEn: "Reasoning effort: select to expand a submenu to pick a level (OpenAI endpoints only)",
    // 不在此直接设值——回车后由 ChatView 在斜杠面板顶部展开二级面板供选择。
    run: function (ctx) {
      if (!ctx.openEffortMenu()) ctx.notify("当前端点（Anthropic）暂不支持推理强度设置");
    },
  },
  {
    name: "think", aliases: ["thinking"], kind: "action",
    description: "扩展思考：开关模型思考模式，思考过程在对话流里可折叠展示（仅 Anthropic 端点）",
    descriptionEn: "Extended thinking: toggle the model's thinking mode; reasoning shows as a collapsible bubble (Anthropic endpoints only)",
    // 切换后不发 notify（不往对话流塞提示消息）——当前开关状态由斜杠面板里本命令的
    // 描述实时显示（见 ChatView updateInput）。只在端点不支持时提示一次。
    run: function (ctx) {
      var st = ctx.toggleThinking();
      if (st === null) ctx.notify("当前端点暂不支持扩展思考（仅 Anthropic 原生协议）");
    },
  },
  {
    name: "plan", kind: "action",
    description: "切换到「计划」模式（只读，不改文件）",
    descriptionEn: "Switch to Plan mode (read-only, no file changes)",
    // 三模式互斥：进入 plan 时关闭 chat 与 game。
    run: function (ctx) { ctx.setChatMode(false); ctx.setGameMode(false); ctx.setPermissionMode("plan"); },
  },
  {
    name: "auto", aliases: ["acceptedits"], kind: "action",
    description: "切换到「自动批准编辑」模式",
    descriptionEn: "Switch to Auto-accept edits mode",
    run: function (ctx) { ctx.setPermissionMode("acceptEdits"); ctx.notify("已切换到自动批准编辑"); },
  },
  {
    name: "yolo", aliases: ["bypass"], kind: "action",
    description: "切换到「完全放行」模式（谨慎）",
    descriptionEn: "Switch to Bypass-all mode (use with caution)",
    run: function (ctx) { ctx.setPermissionMode("bypassPermissions"); ctx.notify("已切换到完全放行模式，请谨慎"); },
  },
  {
    name: "ask", aliases: ["default"], kind: "action",
    description: "切换回「询问」模式（每次改动前确认）",
    descriptionEn: "Switch back to Ask mode (confirm before each change)",
    run: function (ctx) { ctx.setPermissionMode("default"); ctx.notify("已切换到询问模式"); },
  },
];

// 解析输入是否为斜杠命令调用。仅当输入以 "/" 开头时生效。
// 返回 { name, arg }；name 是斜杠后第一个词（小写），arg 是其后全部文本。
export function parseSlash(input: string): { name: string; arg: string } | null {
  if (!input || input.charAt(0) !== "/") return null;
  var rest = input.slice(1);
  var sp = rest.search(/\s/);
  if (sp === -1) return { name: rest.toLowerCase(), arg: "" };
  return { name: rest.slice(0, sp).toLowerCase(), arg: rest.slice(sp + 1).trim() };
}

// 按名字/别名精确查找命令。
export function findSlash(name: string): SlashCommand | null {
  var n = (name || "").toLowerCase();
  for (var i = 0; i < SLASH_COMMANDS.length; i++) {
    var c = SLASH_COMMANDS[i];
    if (c.name === n) return c;
    if (c.aliases && c.aliases.indexOf(n) !== -1) return c;
  }
  return null;
}

// 面板用：按当前已输入的命令前缀过滤候选（输入 "/" 时返回全部）。
export function filterSlash(input: string): SlashCommand[] {
  if (!input || input.charAt(0) !== "/") return [];
  var parsed = parseSlash(input);
  if (!parsed) return [];
  // 已经有空格（在输入参数）→ 不再展示面板。
  if (/\s/.test(input.slice(1))) return [];
  var q = parsed.name;
  if (!q) return SLASH_COMMANDS.slice();
  return SLASH_COMMANDS.filter(function (c) {
    if (c.name.indexOf(q) === 0) return true;
    if (c.aliases && c.aliases.some(function (a) { return a.indexOf(q) === 0; })) return true;
    return false;
  });
}

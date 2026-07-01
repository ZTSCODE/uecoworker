import { readFile, writeFile, readdir, stat } from "fs/promises";
import { join, dirname, relative, resolve, extname } from "path";
import { exec, execFile, spawn, type ExecOptions } from "child_process";
import { existsSync, mkdirSync, createReadStream } from "fs";
import { createInterface } from "readline";
import { hooksManager, summarize, HOOK_EVENTS } from "./hooks-manager";
import { memoryManager } from "./memory-manager";
import { chatStoreManager } from "./chat-store-manager";
import { augmentPath } from "./node-runtime";

export interface ToolDefinition {
  type: string;
  function: {
    name: string;
    description: string;
    parameters: any;
  };
}

// 工具产出的图片(回灌给视觉模型)。base64 不含 data: 前缀。
export interface AgentImage {
  mime: string;
  base64: string;
}

// 发给模型前把图片长边缩到 maxEdge(默认 1568,Anthropic 官方推荐线,安全低于
// 多图 2000px 硬限制)。仅作用于「发往 API 的副本」——对话视图与本地落盘文件不缩。
// 用 Electron 内置 nativeImage,不引第三方依赖。
//
// 返回 null = 这张图不该发(调用方应 filter 掉):缩放失败或不需缩放时,若原始
// base64 仍超 SEND_MAX_B64_BYTES(约 5MB 文本),宁可丢弃也不把超大图塞进请求体
// ——堵住「nativeImage 解不了的异常图原样发」导致撑爆上下文/被 API 拒的路径。
// 正常缩放成功(长边>maxEdge)的输出经过重编码,体积已远低于阈值,直接返回。
var SEND_MAX_B64_BYTES = 5 * 1024 * 1024;
export function downscaleImageIfNeeded(img: AgentImage, maxEdge: number = 1568): AgentImage | null {
  try {
    const { nativeImage } = require("electron");
    const buf = Buffer.from(img.base64, "base64");
    const ni = nativeImage.createFromBuffer(buf);
    // 解码失败:无法缩放,只能按原图发——但仅在它本身不超阈值时放行,否则丢弃。
    if (ni.isEmpty()) return img.base64.length > SEND_MAX_B64_BYTES ? null : img;
    const size = ni.getSize();
    const longEdge = Math.max(size.width, size.height);
    // 无需缩放:同样按原图发,超阈值则丢弃(像素小但 base64 仍可能很大的边缘情形)。
    if (longEdge <= maxEdge) return img.base64.length > SEND_MAX_B64_BYTES ? null : img;
    // 按长边等比缩放(nativeImage 给一个维度,另一维按比例自适应)。
    const resized = size.width >= size.height
      ? ni.resize({ width: maxEdge })
      : ni.resize({ height: maxEdge });
    const outBuf = resized.toPNG();
    const out = { mime: "image/png", base64: outBuf.toString("base64") };
    // 缩放后仍超阈值(理论上极罕见):兜底丢弃,绝不发超大请求体。
    return out.base64.length > SEND_MAX_B64_BYTES ? null : out;
  } catch {
    // 整个缩放链异常:回退原图,同样受阈值约束。
    return img.base64.length > SEND_MAX_B64_BYTES ? null : img;
  }
}

export var TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "read_file",
      description:
        "Read a text or image file. For text, output is prefixed with 1-based line numbers (e.g. `12\\tcode`) so you can reference exact lines for edits; " +
        "for large files, read a window with offset/limit instead of the whole file (the result tells you the total line count and whether content was truncated). " +
        "For image files (png/jpg/jpeg/gif/webp/bmp), the image is loaded and shown to you directly — no need to pass offset/limit.",
      parameters: {
        type: "object",
        properties: {
          file_path: { type: "string", description: "Path to the file to read" },
          offset: { type: "number", description: "1-based line number to start reading from (optional)" },
          limit: { type: "number", description: "Maximum number of lines to read (optional; large reads are capped automatically)" },
        },
        required: ["file_path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description: "Create a new file or overwrite an existing file with the given content.",
      parameters: {
        type: "object",
        properties: {
          file_path: { type: "string", description: "Path to the file to write" },
          content: { type: "string", description: "Content to write to the file" },
        },
        required: ["file_path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "edit_file",
      description:
        "Edit an existing file by replacing old_string with new_string. old_string must match the file exactly (including indentation) and be UNIQUE — include enough surrounding context. " +
        "Whitespace-only differences are tolerated. Set replace_all to replace every occurrence.",
      parameters: {
        type: "object",
        properties: {
          file_path: { type: "string", description: "Path to the file to edit" },
          old_string: { type: "string", description: "The exact text to replace (must be unique unless replace_all)" },
          new_string: { type: "string", description: "The new text to insert" },
          replace_all: { type: "boolean", description: "Replace every occurrence instead of requiring a unique match (default false)" },
        },
        required: ["file_path", "old_string", "new_string"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "multi_edit",
      description:
        "Apply several find-and-replace edits to a SINGLE file in one atomic operation. " +
        "Edits are applied in order; if any old_string is not found, NOTHING is written (all-or-nothing). " +
        "Prefer this over multiple edit_file calls when changing several places in the same file. " +
        "Each old_string must be unique in the file unless replace_all is true.",
      parameters: {
        type: "object",
        properties: {
          file_path: { type: "string", description: "Path to the file to edit" },
          edits: {
            type: "array",
            description: "Ordered list of replacements to apply to the file.",
            items: {
              type: "object",
              properties: {
                old_string: { type: "string", description: "The exact text to find" },
                new_string: { type: "string", description: "The replacement text" },
                replace_all: { type: "boolean", description: "Replace every occurrence instead of requiring a unique match (default false)" },
              },
              required: ["old_string", "new_string"],
            },
          },
        },
        required: ["file_path", "edits"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "apply_diff",
      description:
        "Apply a unified diff (the output of `diff -u` / `git diff`) to an existing file. " +
        "Use this to make precise multi-hunk changes when you can express them as a patch. " +
        "The diff is matched against the current file by context; if a hunk does not match, nothing is written and an error is returned. " +
        "For simple single replacements prefer edit_file; for several replacements in one file prefer multi_edit.",
      parameters: {
        type: "object",
        properties: {
          file_path: { type: "string", description: "Path to the file to patch" },
          diff: { type: "string", description: "A unified diff body with @@ hunk headers and +/-/space lines. The ---/+++ file headers are optional." },
        },
        required: ["file_path", "diff"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_files",
      description: "List files and directories in the given directory.",
      parameters: {
        type: "object",
        properties: {
          dir_path: { type: "string", description: "Path to the directory to list" },
        },
        required: ["dir_path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_command",
      description: "Run a shell command and return the output. On Windows the command is run via PowerShell (PowerShell 7 / pwsh if installed, otherwise the built-in powershell.exe), so use PowerShell syntax; on macOS/Linux it runs via the default shell. Use with caution.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "The shell command to execute (PowerShell syntax on Windows)" },
          timeout: { type: "number", description: "Timeout in milliseconds (default 30000)" },
        },
        required: ["command"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "monitor",
      description:
        "Run a long-lived command and WATCH its output until a stop condition is met, then return the captured lines. " +
        "Use this — not run_command — when you must wait for something to happen in a stream: a dev server printing 'ready', a build finishing, a log line appearing, a watcher emitting an error. " +
        "It blocks until ONE of: a line matches `until_pattern` (regex), the process exits, or `timeout` is reached. " +
        "Returns the matched line (if any), the reason it stopped, and a tail of recent output. " +
        "Prefer a command that naturally ends (a build) or set a tight `until_pattern` + `timeout` — do not start a server you never stop.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "The shell command to run and watch." },
          until_pattern: { type: "string", description: "Regex (JS syntax). Stop as soon as an output line matches it. Omit to watch until the process exits or timeout." },
          timeout: { type: "number", description: "Max milliseconds to watch before stopping (default 60000, max 600000)." },
          tail_lines: { type: "number", description: "How many recent output lines to include in the result (default 60)." },
        },
        required: ["command"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "glob_files",
      description: "Recursively find files matching a glob-like pattern (e.g. *.ts, **/*.tsx, src/*.css). Returns matching relative paths. Use to locate files by name.",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "Glob pattern, e.g. *.ts or **/*.json" },
          dir_path: { type: "string", description: "Directory to search in (default: project root)" },
        },
        required: ["pattern"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "generate_image",
      description:
        "Generate images from text prompts using the configured image-generation API (OpenAI-compatible /v1/images/generations). " +
        "Pass an array of `prompts`; each prompt produces ONE image, and all prompts are generated CONCURRENTLY — so to make N images at once, pass N prompts (you decide how many, up to a safe cap of 8 per call). " +
        "Generation is SLOW (each image can take up to ~2 minutes). The generated images are downloaded to the local machine and shown inline in the chat. " +
        "Requires the user to have configured an image-generation endpoint + API key in Settings → 图片生成; if not configured, this returns an actionable hint instead of an image. " +
        "OPTIONAL — only set these when the user explicitly asks: `provider` (image provider name to use, when several are configured — see the system note listing available providers/models), `model` (a specific model offered by that provider), and `save_dir` (where to save the images; a path relative to the project root, or an absolute path). When omitted, the default provider/model and save location are used.",
      parameters: {
        type: "object",
        properties: {
          prompts: {
            type: "array",
            description: "One or more text prompts. Each generates a separate image; all are generated in parallel. Provide several to make several images at once (max 8).",
            items: { type: "string" },
          },
          prompt: { type: "string", description: "A single prompt (use this only if generating just one; otherwise use `prompts`)." },
          size: { type: "string", description: "Image size as WxH, e.g. 1024x1024 (square), 1792x1024 (landscape/wide), 1024x1792 (portrait/tall). YOU should choose the size that best fits each image's purpose and aspect ratio (a wide banner vs. a tall poster vs. a square icon). Omit only to fall back to the user's configured default." },
          provider: { type: "string", description: "OPTIONAL. Name of the image provider to use when the user asks for a specific one (matched case-insensitively against the configured image providers). Omit to use the default." },
          model: { type: "string", description: "OPTIONAL. A specific image model to use (must be one the chosen provider offers). Omit to use the provider's default model." },
          save_dir: { type: "string", description: "OPTIONAL. Where to save the generated images, when the user asks for a particular location. A path relative to the project root (e.g. 'assets/img') or an absolute path. Omit to use the default save location." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "capture_window",
      description:
        "Capture a screenshot of a desktop window. Call with NO arguments to list all visible windows (title + index); " +
        "call with `title` to take a screenshot of the window whose title contains the keyword (case-insensitive fuzzy match). " +
        "The screenshot is saved locally and shown inline in the chat. Returns the local file path. " +
        "Use this when the user asks you to look at, inspect, or screenshot any running application window.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Keyword to match against window titles (case-insensitive, substring match). Omit to list all visible windows." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "web_search",
      description: "Search the web and return a list of result titles, URLs and snippets. Use for current information not in the codebase.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "The search query" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "web_fetch",
      description: "Fetch a web page by URL and return its main text content (HTML stripped). Use to read an article or documentation page.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "The URL to fetch (http/https)" },
        },
        required: ["url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "configure_hooks",
      description:
        "Configure project lifecycle hooks (event-driven automation) in .claude/settings.json. " +
        "A hook runs a shell command at a lifecycle event; the command receives the event as JSON on stdin. " +
        "Use this to fully set up hooks from a user's request — e.g. 'run prettier after every edit', 'block edits to .env', 'log every command'. " +
        "Apply a batch of operations atomically. Always returns the resulting indexed configuration so you can verify and target later removals. " +
        "Pass NO operations (empty array) to just read the current configuration. " +
        "Events: PreToolUse (before a tool runs; the command can BLOCK it by exiting with code 2 — e.g. guard sensitive files), " +
        "PostToolUse (after a tool runs; for formatting/linting/logging — cannot block), " +
        "SessionStart and UserPromptSubmit (stdout is injected as context; UserPromptSubmit exit 2 rejects the turn), Stop (after the turn ends). " +
        "PreToolUse/PostToolUse take a `matcher` on the tool NAME in PascalCase (Read, Write, Edit, Bash, WebSearch, WebFetch, Mcp) — exact, an A|B list, a regex, or * for all. " +
        "The command gets CLAUDE_PROJECT_DIR in its environment. Hooks apply to every model/provider.",
      parameters: {
        type: "object",
        properties: {
          operations: {
            type: "array",
            description: "Batch of operations applied in order, then persisted. Empty to only read current config.",
            items: {
              type: "object",
              properties: {
                action: { type: "string", enum: ["add", "remove", "clear", "clear_all"], description: "add a hook; remove one by index; clear all hooks of an event; clear_all removes every hook." },
                event: { type: "string", enum: HOOK_EVENTS as unknown as string[], description: "The lifecycle event (required except for clear_all)." },
                matcher: { type: "string", description: "For add on PreToolUse/PostToolUse: tool-name matcher (exact / A|B / regex / *). Defaults to * if omitted." },
                command: { type: "string", description: "For add: the shell command to run. Receives event JSON on stdin." },
                timeout: { type: "number", description: "For add: command timeout in seconds (default 60)." },
                index: { type: "number", description: "For remove: 0-based index of the hook within the event (see the returned summary)." },
              },
              required: ["action"],
            },
          },
        },
        required: ["operations"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "ask_followup_question",
      description: "Ask the user one or more clarifying questions when the request is ambiguous or you need decisions before proceeding. Prefer the `questions` array to ask several related questions at once (the user answers them all in a single card). Use this instead of guessing.",
      parameters: {
        type: "object",
        properties: {
          questions: {
            type: "array",
            description: "A list of questions to ask at once. Preferred over the single `question` field. Each item has its own optional suggested answers.",
            items: {
              type: "object",
              properties: {
                question: { type: "string", description: "The question text" },
                options: {
                  type: "array",
                  items: { type: "string" },
                  description: "Optional 2-4 suggested answers the user can click",
                },
              },
              required: ["question"],
            },
          },
          question: { type: "string", description: "A single question (use this only if asking just one; otherwise use `questions`)" },
          options: {
            type: "array",
            items: { type: "string" },
            description: "Optional 2-4 suggested answers for the single `question`",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_files",
      description:
        "Search file contents for a regex pattern within a directory (powered by ripgrep). " +
        "Returns matching lines with file:line prefixes by default. Supports context lines, case-insensitive search, " +
        "multiline matching, files-only / count output modes, and a result cap.",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "Regex pattern to search for" },
          dir_path: { type: "string", description: "Directory to search in" },
          file_pattern: { type: "string", description: "Glob to filter files (e.g. *.ts). Repeat-style globs not supported; pass one glob." },
          output_mode: {
            type: "string",
            enum: ["content", "files_with_matches", "count"],
            description: "content = matching lines (default); files_with_matches = only file paths; count = match count per file.",
          },
          case_insensitive: { type: "boolean", description: "Case-insensitive match (default false)." },
          multiline: { type: "boolean", description: "Allow patterns to span lines (. matches newline). Default false." },
          context_before: { type: "number", description: "Lines of context to show before each match (content mode only)." },
          context_after: { type: "number", description: "Lines of context to show after each match (content mode only)." },
          context: { type: "number", description: "Lines of context before AND after each match (content mode only). Overrides context_before/after." },
          max_results: { type: "number", description: "Cap on lines/files returned (default 100)." },
        },
        required: ["pattern", "dir_path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_todos",
      description:
        "Maintain a visible to-do list for the current multi-step task; the UI shows it as a live roadmap at the top of the chat. " +
        "Call this when a task has several steps: declare all steps up-front, then call again to update statuses as you progress. " +
        "Each call REPLACES the entire list (send the full list every time). " +
        "Keep exactly one item 'in_progress' at a time, and mark an item 'completed' as soon as it's done. " +
        "Skip this for trivial single-step requests.",
      parameters: {
        type: "object",
        properties: {
          todos: {
            type: "array",
            description: "The complete current to-do list (replaces any previous list).",
            items: {
              type: "object",
              properties: {
                content: { type: "string", description: "Imperative description of the step, e.g. 'Read package.json'" },
                status: {
                  type: "string",
                  enum: ["pending", "in_progress", "completed"],
                  description: "Step status. Keep exactly one 'in_progress'.",
                },
                activeForm: { type: "string", description: "Present-tense label shown while in progress, e.g. 'Reading package.json' (optional)" },
              },
              required: ["content", "status"],
            },
          },
        },
        required: ["todos"],
      },
    },
  },
  {
    // task:把一个自包含的子任务委派给专门的子 agent。可派发的 subagent_type 名单
    // 不在此 schema 内枚举(否则启停 agent 会改变工具定义字节、击穿 Anthropic 工具
    // 缓存断点)——名单作为独立 system 块(agentsManager.systemPromptBlock)注入,
    // 本 schema 永远保持静态字节恒定。运行期由 agent-loop 校验 subagent_type 合法性。
    type: "function",
    function: {
      name: "task",
      description:
        "Delegate a self-contained subtask to a specialized sub-agent. The sub-agent runs with the SAME provider as you, works in its OWN isolated context, executes its own tools (each still passing the permission gate), and returns ONLY a final summary — you do not see its raw tool output. It cannot spawn further sub-agents (one level deep). " +
        "Delegating helps when the subtask would otherwise dump a lot of intermediate content into this conversation (e.g. reading many files / a whole module just to reach a conclusion): the sub-agent absorbs that in its own context and you keep only the result. " +
        "Do it yourself instead when the work is small, or when you will need the exact code/details afterward to continue — the summary alone would force you to re-read, so delegating is slower, not faster. " +
        "Set `subagent_type` to one of the available sub-agent names in the 'Available sub-agents' system note; give a complete, standalone `prompt` (the sub-agent does NOT see this conversation). " +
        "Sub-agents never ask the user questions. Note: several read-only tasks issued in one turn run in parallel; a batch containing any writing task runs one at a time.",
      parameters: {
        type: "object",
        properties: {
          subagent_type: {
            type: "string",
            description: "Name of the sub-agent to dispatch (must match one listed in the 'Available sub-agents' system note). If it doesn't match, a general-purpose agent is used.",
          },
          prompt: {
            type: "string",
            description: "A complete, self-contained instruction for the sub-agent. It cannot see this conversation, so include all context it needs and state exactly what to produce.",
          },
          description: {
            type: "string",
            description: "OPTIONAL. A short (3-6 word) label for this subtask, shown in the UI.",
          },
        },
        required: ["subagent_type", "prompt"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "enter_plan_mode",
      description:
        "Enter plan mode BEFORE acting on a task that is risky or complex enough to warrant a reviewed plan first. " +
        "Call this when the task involves significant new functionality, multiple files, several viable approaches, an architectural decision, or hard-to-reverse / destructive operations — anything where the user would want to approve an approach before you start writing. " +
        "Do NOT call it for small, well-scoped, or read-only work (typo fixes, single obvious edits, answering a question, pure investigation) — just do those. " +
        "After calling this you are in read-only mode: investigate with read-only tools, then call exit_plan_mode with the finished plan for approval. " +
        "Do NOT call it if already in plan mode.",
      parameters: {
        type: "object",
        properties: {
          reason: {
            type: "string",
            description: "One short sentence on why this task warrants a plan first (what makes it complex or risky).",
          },
        },
        required: ["reason"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "exit_plan_mode",
      description:
        "Call this ONLY when in plan mode and you have finished researching and writing your implementation plan. " +
        "It presents the plan to the user for approval; on approval the session switches out of plan mode so you can start implementing. " +
        "Do NOT use it to ask whether the plan is OK in prose — calling it IS the approval request. " +
        "Do NOT call it outside plan mode, and not before you have actually produced a concrete plan.",
      parameters: {
        type: "object",
        properties: {
          plan: {
            type: "string",
            description: "The full implementation plan in Markdown: goal, files involved, concrete steps, and how the result will be verified.",
          },
        },
        required: ["plan"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "remember",
      description:
        "Save a durable fact to long-term memory so it persists across sessions. Memory is cheap and high-value here — when a turn produces a fact that future sessions would need and that is NOT already written in the code or docs, save it. Do not wait to be asked.\n" +
        "SAVE when you observe any of these signals (these are categories, not an exhaustive checklist — generalize from them):\n" +
        "• A concrete game-design fact, tuning value, or rule the team has settled on — player move speed, jump height, damage numbers, cooldowns, economy/currency values, spawn rules, where/when a quest or event can trigger, a deliberate design choice and the intent behind it ('double-jump is disabled to force grapple use'). Type 'project'.\n" +
        "• A stable project constraint or goal not derivable from the code — target platform/FPS budget, art direction, the core hook that makes the game fun, a system that must not be touched. Type 'project'.\n" +
        "• The user states a working preference or correction, especially if repeated or emphatic — 'I told you not to change that line', 'always recompile after editing', 'auto-open the editor when I start', 'never edit generated files', a naming/style rule. Type 'feedback'.\n" +
        "• A durable fact about the user or their stack — role, expertise, tools, language they want replies in. Type 'user'.\n" +
        "• An external resource worth keeping — a doc URL, ticket, or reference the user pointed you to. Type 'reference'.\n" +
        "UPDATE instead of duplicating: if a saved value changes (player speed 600 → 750, a rule is revised), call remember again with the SAME name to overwrite it. Keeping memory current matters as much as creating it. When updating, fields you omit are preserved — passing only description+name keeps the existing body; pass body again only when you want to change it.\n" +
        "WRITE STYLE — the description is a compressed one-line FACT, not a topic title: prefer a usable statement with the concrete value/rule ('Player walk speed = 600 uu/s, sprint = 900'), NOT a category label ('player movement settings'). Put rationale, value tables, and edge cases in body. One fact per call.\n" +
        "DO NOT save: transient state (current file, this turn's task), anything already in the repo/git/CLAUDE.md, vague impressions, or a guess you are not confident is settled. When unsure whether a design value is final, it is fine to save it as the current value and update later — but never invent facts the user did not actually establish.",
      parameters: {
        type: "object",
        properties: {
          description: { type: "string", description: "One-line, specific summary — this is what shows in the always-loaded memory index. Prefer a concrete value or rule, e.g. 'Player walk speed = 600 uu/s; sprint = 900' or 'User wants auto-recompile after every edit'." },
          type: { type: "string", enum: ["user", "feedback", "project", "reference"], description: "user = facts about the user; feedback = how the user wants you to work (preferences/corrections); project = game-design facts, tuning values, rules, constraints; reference = external docs/links. user/feedback/project are loaded into every session; reference is recall-only." },
          name: { type: "string", description: "Optional short kebab-case slug for the memory file. REUSE an existing name to update/overwrite that fact when its value changes. Defaults to a slug of the description." },
          body: { type: "string", description: "Optional fuller text: the rationale, the 'why it matters', and 'how to apply it'. The one-line description goes in the index; this body is fetched on demand via recall_memory." },
          scope: { type: "string", enum: ["project", "global"], description: "project (default) = this project only; global = applies across all the user's projects (usually 'user' identity or cross-project preferences)." },
        },
        required: ["description", "type"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "recall_memory",
      description:
        "Search long-term memory (including reference notes not shown in the always-loaded index) by keyword. Returns matching entries with their file paths and a body snippet. Use read_file on a returned path to get the full text. Call this when the resident memory index hints at a relevant entry, or when you need stored context the index does not list.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Keywords to search for across memory names, summaries, and bodies." },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "checklist_read",
      description:
        "Read the project's PERSISTENT task checklist — a long-lived list of tasks the user and you share, kept across sessions (separate from update_todos, which is only this turn's throwaway roadmap). " +
        "Each item has a status: 'todo' (not started), 'needs_verification' (you finished it, awaiting the user's confirmation), or 'done' (the user verified it). " +
        "Call this WHEN YOU START working on a project (to see outstanding tasks) and WHEN YOU FINISH a task. The list reflects what the user actually wants done over time.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "checklist_submit",
      description:
        "Mark a task as done-by-you on the PERSISTENT project checklist after you actually complete it. " +
        "Pass the task description in natural language. The system fuzzily matches it against existing open items: if it matches one, that item moves to 'needs_verification'; if nothing matches (e.g. the user never listed it, or you did something extra), a NEW item is added directly as 'needs_verification'. " +
        "You CANNOT mark anything 'done' — only the user can verify and complete an item in the UI. Use this every time you finish a discrete piece of work the user would want tracked. One task per call. Do not pass an id; matching is by text.",
      parameters: {
        type: "object",
        properties: {
          content: { type: "string", description: "Plain-language description of the task you just finished, e.g. 'Add dark mode toggle to settings'. Phrase it the way the task would appear in a checklist." },
        },
        required: ["content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_sessions",
      description:
        "Search past chat sessions (across ALL projects) by keyword. Returns matching sessions with id, name, project, time, and snippet excerpts of the matched messages. Use this to recall what was discussed or decided in earlier conversations — yours or other sessions. Then call read_session with a returned session id to read that conversation in full.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Keywords to search for across the text of past session messages (case-insensitive literal match)." },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_session",
      description:
        "Read a past chat session by its id (from search_sessions). Returns the conversation transcript. By default the transcript is truncated to the most recent messages to limit token usage; pass full=true to read the entire session.",
      parameters: {
        type: "object",
        properties: {
          session_id: { type: "string", description: "The session id returned by search_sessions." },
          full: { type: "boolean", description: "If true, return the entire session instead of just the most recent messages. Default false." },
        },
        required: ["session_id"],
      },
    },
  },
];

// 工具执行上下文：仅部分工具用到（如 web_search 的可选搜索 API 配置）。
// backends 是用户启用的搜索后端列表（每个带自己的 key），按尝试顺序排列；
// web_search 会逐个尝试，第一个出结果即返回，全部失败再回落免 key 的 SearXNG/DDG。
export interface ToolContext {
  search?: { backends: Array<{ kind: string; apiKey: string }> };
  // 图片生成（generate_image 工具）：来自被标记为「图片生成」的 API 供应商
  // （Providers 面板里勾选），主进程按 providerId 解密注入 key。endpoint 决定走
  // /v1/images/generations 还是 /v1/chat/completions（聊天补全式出图）。
  //   - 默认供应商即 imageGen 本身（baseUrl/model/endpoint/headers/apiKey）。
  //   - providers：所有已配置的图片供应商（含各自 key），供模型按 `provider` 参数切换；
  //     name 用于匹配，models 用于校验 `model` 参数。
  //   - defaultSaveDir：缺省落地目录；projectRoot：解析 `save_dir` 相对路径用。
  imageGen?: {
    baseUrl: string; apiKey: string; model: string; endpoint: "images" | "chat" | "raw"; headers?: Record<string, string>; saveDir?: string;
    projectRoot?: string;
    providers?: Array<{ name: string; baseUrl: string; apiKey: string; model: string; models?: string[]; endpoint: "images" | "chat" | "raw"; headers?: Record<string, string> }>;
  };
  // MCP：附加的工具定义（已是 OpenAI function 形态）+ 调用路由。agent-loop 把
  // mcpTools 合并进发给模型的 tools 列表；executeTool 命中 MCP 前缀名时走 mcpCall。
  mcpTools?: any[];
  mcpHasTool?: (name: string) => boolean;
  mcpCall?: (name: string, args: any, onImages?: (imgs: AgentImage[]) => void) => Promise<string>;
  // 本轮的中止信号（用户点「停止」时触发）。长时间运行的工具（monitor 阻塞式
  // 监听）据此提前结束，杀掉子进程并返回已捕获内容，而不是空转到超时。
  signal?: AbortSignal;
  // 当前会话 id：供 search_sessions 把正在进行的对话排除在跨会话检索之外。
  currentSessionId?: string;
  // 图片回灌通道：带图工具(截图/MCP image 块)经此把图片交给 agent-loop,
  // 由后者按协议回灌给视觉模型。agent-loop 每次工具调用前把它指向「当前 callId
  // 的缓冲」,实现 per-call 隔离(避免多工具同轮串台)。
  collectImages?: (imgs: AgentImage[]) => void;
  // 子 agent(task 工具)上下文:由 ipc-handlers 注入。defs=可派发的 agent 定义
  // (含 mode/tools/model/prompt);resolveModel 把 agent 期望模型校验到父供应商
  // models[] 内(不在列表则回落父模型,绝不跨供应商);runSubAgent=实际跑一个子
  // agent 的闭包(复用 streamCompletion + 权限门 + checkpoint,见 agent-loop)。
  // task 不经 executeTool,而由 agent-loop 主循环特判分发(类似 ask_followup_question)。
  subagents?: {
    defs: Array<{ name: string; mode: "read-only" | "write"; tools?: string[]; model?: string; prompt: string; builtin?: boolean }>;
    resolveModel: (model?: string) => string;
    runSubAgent: (spec: { subagentType: string; prompt: string; description?: string; parentCallId: string }) => Promise<string>;
  };
}

export async function executeTool(
  name: string,
  args: any,
  workingDir: string,
  ctx?: ToolContext
): Promise<string> {
  switch (name) {
    case "read_file":
      return readFileTool(args, workingDir, ctx);
    case "write_file":
      return writeFileTool(args, workingDir);
    case "edit_file":
      return editFileTool(args, workingDir);
    case "multi_edit":
      return multiEditTool(args, workingDir);
    case "apply_diff":
      return applyDiffTool(args, workingDir);
    case "list_files":
      return listFilesTool(args, workingDir);
    case "run_command":
      return runCommandTool(args, workingDir);
    case "monitor":
      return monitorTool(args, workingDir, ctx);
    case "search_files":
      return searchFilesTool(args, workingDir);
    case "glob_files":
      return globFilesTool(args, workingDir);
    case "web_search":
      return webSearchTool(args, ctx);
    case "generate_image":
      return generateImageTool(args, ctx);
    case "capture_window":
      return captureWindowTool(args, ctx);
    case "web_fetch":
      return webFetchTool(args);
    case "configure_hooks":
      return configureHooksTool(args, workingDir);
    case "remember":
      return rememberTool(args, workingDir);
    case "recall_memory":
      return recallMemoryTool(args, workingDir);
    case "search_sessions":
      return searchSessionsTool(args, ctx);
    case "read_session":
      return readSessionTool(args);
    default:
      // 未知工具名：可能是 MCP 工具（前缀名）。命中则路由给 MCP 客户端。
      // 把当前 callId 的图片收集器作为 onImages 透传,使 MCP 截图回灌给视觉模型。
      if (ctx && ctx.mcpHasTool && ctx.mcpCall && ctx.mcpHasTool(name)) {
        return ctx.mcpCall(name, args, ctx.collectImages);
      }
      return "Unknown tool: " + name;
  }
}

// 单次返回的硬上限（行数），防止把超大文件整段塞进上下文。
// 未显式给 limit 且文件超过此值时自动分页，并在结尾提示用 offset 继续读。
var READ_MAX_LINES = 2000;

// 给每行加 1-based 行号前缀（`12\tcode`），与 Cline/Claude Code 一致，便于模型
// 引用精确行做 edit。startLine 是该批第一行的真实行号。
function withLineNumbers(lines: string[], startLine: number): string {
  var LF = String.fromCharCode(10);
  var out: string[] = [];
  for (var i = 0; i < lines.length; i++) {
    out.push((startLine + i) + String.fromCharCode(9) + lines[i]);
  }
  return out.join(LF);
}

// 可作为图片回灌给视觉模型的扩展名 → MIME。读到这些文件时,read_file 不按文本
// 解析,而是把字节经 collectImages 通道交给 agent-loop(再缩放/回灌),与截图同路。
var IMAGE_EXT_MIME: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
  gif: "image/gif", webp: "image/webp", bmp: "image/bmp",
};

async function readFileTool(args: any, cwd: string, ctx?: ToolContext): Promise<string> {
  var filePath = resolve(cwd, args.file_path);
  if (!existsSync(filePath)) return "File not found: " + args.file_path;

  // 图片文件:按扩展名识别,读字节后交给回灌通道,而不是当文本逐行加行号。
  var ext = (extname(filePath) || "").slice(1).toLowerCase();
  var imgMime = IMAGE_EXT_MIME[ext];
  if (imgMime) return readImageFileTool(filePath, args.file_path, imgMime, ctx);

  var LF = String.fromCharCode(10);

  var hasWindow = !!(args.offset || args.limit);
  var start = Math.max(0, (args.offset || 1) - 1); // 0-based 起点
  // 给定 limit 则按其取，否则取到末尾；再统一受 READ_MAX_LINES 钳制。
  var capped = args.limit ? Math.min(args.limit, READ_MAX_LINES) : READ_MAX_LINES;

  // 流式逐行读取，只保留窗口内的行（[start, start+capped)），其余仅计数。
  // 这样内存占用受窗口大小约束，不再 readFile 整文件 + split 全量行数组，
  // 避免 GB 级文件或超大单行把主进程撑爆。total 仍精确（读到 EOF）。
  var slice: string[] = [];
  var total = 0;
  var windowEnd = start + capped; // 收集到此（不含）即可停止保留，但仍继续计数
  await new Promise<void>(function (done, fail) {
    var rl = createInterface({ input: createReadStream(filePath, { encoding: "utf-8" }), crlfDelay: Infinity });
    rl.on("line", function (line: string) {
      if (total >= start && total < windowEnd) slice.push(line);
      total++;
    });
    rl.on("close", function () { done(); });
    rl.on("error", function (e: any) { fail(e); });
  });

  if (start >= total) {
    return "offset " + (start + 1) + " is past end of file (" + total + " lines).";
  }

  var end = Math.min(total, windowEnd);
  var bodyText = withLineNumbers(slice, start + 1);

  // 头部元信息 + 截断/分页提示，让模型知道总行数与如何继续读。
  var shownTo = end;
  var truncated = shownTo < total;
  var header: string;
  if (!hasWindow && !truncated) {
    header = "File: " + args.file_path + " (" + total + " lines)";
  } else {
    header = "File: " + args.file_path + " — lines " + (start + 1) + "-" + shownTo + " of " + total;
  }
  var footer = "";
  if (truncated) {
    footer = LF + LF + "… truncated at line " + shownTo + " of " + total +
      ". Read more with offset=" + (shownTo + 1) + ".";
  }
  return header + LF + bodyText + footer;
}

// 图片读取上限(原始字节)。超过则拒绝并提示缩放——第一道闸,挡住超大文件进内存。
// 第二道闸在发送前:downscaleImageIfNeeded 对缩放后(或无法缩放)仍超 base64 阈值的
// 图返回 null 丢弃。两道闸共同保证不会有超大 base64 进上下文。
var READ_IMAGE_MAX_BYTES = 10 * 1024 * 1024;

// 读图片文件:把字节经 collectImages 交给 agent-loop 回灌给视觉模型,并打上
// GENERATED_IMAGE_PATHS 标记复用 UI 缩略图展示。vision 关闭/无回灌通道时,
// 仍返回文字说明(避免模型误以为读到了像素)。
async function readImageFileTool(filePath: string, displayPath: string, mime: string, ctx?: ToolContext): Promise<string> {
  var LF = String.fromCharCode(10);
  var buf: Buffer;
  try {
    buf = await readFile(filePath);
  } catch (e: any) {
    return "Failed to read image " + displayPath + ": " + (e?.message || String(e));
  }
  if (buf.length > READ_IMAGE_MAX_BYTES) {
    return "Image " + displayPath + " is too large (" + Math.round(buf.length / 1024 / 1024) +
      " MB > " + (READ_IMAGE_MAX_BYTES / 1024 / 1024) + " MB limit). Resize or convert it before reading.";
  }
  var fed = false;
  if (ctx && ctx.collectImages) {
    try { ctx.collectImages([{ mime, base64: buf.toString("base64") }]); fed = true; } catch {}
  }
  var result: string[] = [];
  result.push("Image: " + displayPath + " (" + mime + ", " + buf.length + " bytes)");
  result.push(fed
    ? "The image is shown to you below."
    : "Image loaded but cannot be displayed (vision unavailable in this context).");
  // 复用 generate_image/capture_window 的 UI 缩略图展示机制。
  result.push("GENERATED_IMAGE_PATHS:" + JSON.stringify([filePath]));
  return result.join(LF);
}

async function writeFileTool(args: any, cwd: string): Promise<string> {
  var filePath = resolve(cwd, args.file_path);
  var dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  await writeFile(filePath, args.content, "utf-8");
  return "File written: " + args.file_path + " (" + args.content.length + " bytes)";
}

async function editFileTool(args: any, cwd: string): Promise<string> {
  var filePath = resolve(cwd, args.file_path);
  if (!existsSync(filePath)) return "File not found: " + args.file_path;
  var content = await readFile(filePath, "utf-8");
  var oldStr = String(args.old_string == null ? "" : args.old_string);
  var newStr = String(args.new_string == null ? "" : args.new_string);
  if (!oldStr) return "old_string is empty; nothing to replace in " + args.file_path;

  var res = applyStringEdit(content, oldStr, newStr, !!args.replace_all);
  if (res.error) return res.error + " (" + args.file_path + ")";
  await writeFile(filePath, res.content, "utf-8");
  var note = res.fuzzy ? " (matched ignoring whitespace)" : "";
  return "File edited: " + args.file_path + note;
}

// 分层字符串替换（对标 Aider/Cline 的容错匹配，修正纯 .replace() 的两类问题：
// 非唯一静默改首处、缩进漂移硬失配）：
//  1) 精确匹配：要求唯一（除非 replace_all）。
//  2) 失败则按行去除每行首尾空白后再匹配（容忍模型缩进漂移），命中后用文件里的
//     真实行替换，保留原缩进。
//  3) 仍失败 → 返回带「最接近的实际行」提示的可操作错误，不写盘。
function applyStringEdit(content: string, oldStr: string, newStr: string, replaceAll: boolean):
  { content: string; error?: string; fuzzy?: boolean } {
  // —— 1) 精确 ——
  var occ = countOccurrences(content, oldStr);
  if (occ === 1 || (occ > 1 && replaceAll)) {
    return { content: replaceAll ? replaceAllLiteral(content, oldStr, newStr) : content.replace(oldStr, newStr) };
  }
  if (occ > 1 && !replaceAll) {
    return { content, error: "old_string is not unique (" + occ + " matches); add more surrounding context to make it unique, or set replace_all=true. No changes written" };
  }

  // —— 2) 去空白容错（逐行 trim 后比较）——
  var LF = String.fromCharCode(10);
  var fileLines = content.split(LF);
  var needle = oldStr.split(LF);
  // 去掉 needle 末尾可能的空行（模型常多带一个换行）。
  while (needle.length > 1 && needle[needle.length - 1].trim() === "") needle.pop();
  var normNeedle = needle.map(function (l) { return l.trim(); });

  var matchStart = -1, matchCount = 0;
  for (var i = 0; i + normNeedle.length <= fileLines.length; i++) {
    var ok = true;
    for (var j = 0; j < normNeedle.length; j++) {
      if (fileLines[i + j].trim() !== normNeedle[j]) { ok = false; break; }
    }
    if (ok) {
      matchCount++;
      if (matchStart === -1) matchStart = i;
      // 非 replace_all 只需判定是否唯一：找到第二处即可停（已确定非唯一）。
      if (!replaceAll && matchCount > 1) break;
    }
  }
  // 去空白后存在多处候选且非 replace_all：与精确路径同样的唯一性契约，拒绝改写。
  if (matchCount > 1 && !replaceAll) {
    return { content, error: "old_string is not unique (" + matchCount + " matches ignoring whitespace); add more surrounding context to make it unique, or set replace_all=true. No changes written" };
  }
  if (matchStart !== -1 && (matchCount === 1 || replaceAll)) {
    // 用文件真实行做替换；newStr 套用被替换块首行的缩进，尽量保持风格。
    var applyAt = function (lines: string[], at: number): string[] {
      var indentM = /^[ \t]*/.exec(lines[at]);
      var indent = indentM ? indentM[0] : "";
      var newBlock = newStr.split(LF).map(function (l, idx) {
        // 首行保持 newStr 原样（通常模型已给缩进）；为空缩进时补上原缩进。
        if (idx === 0 && /^[ \t]/.test(l)) return l;
        return l.length ? (indent + l.replace(/^[ \t]+/, "")) : l;
      });
      return lines.slice(0, at).concat(newBlock, lines.slice(at + normNeedle.length));
    };
    if (replaceAll) {
      // 从后往前替换，下标不失效。
      var starts: number[] = [];
      for (var k = 0; k + normNeedle.length <= fileLines.length; k++) {
        var ok2 = true;
        for (var m = 0; m < normNeedle.length; m++) if (fileLines[k + m].trim() !== normNeedle[m]) { ok2 = false; break; }
        if (ok2) starts.push(k);
      }
      for (var s = starts.length - 1; s >= 0; s--) fileLines = applyAt(fileLines, starts[s]);
      return { content: fileLines.join(LF), fuzzy: true };
    }
    return { content: applyAt(fileLines, matchStart).join(LF), fuzzy: true };
  }

  // —— 3) 可操作错误：给出文件里最接近的若干行作为提示 ——
  var hint = closestLinesHint(fileLines, normNeedle[0] || oldStr.trim());
  return { content, error: "Could not find the text to replace. No changes written." + (hint ? " Closest lines in file:\n" + hint : " Re-read the file and copy the exact text.") };
}

// 找出文件里与目标首行最相似的几行（按是否包含/被包含的粗略相似度），用于报错提示。
function closestLinesHint(fileLines: string[], target: string): string {
  var t = (target || "").trim();
  if (!t) return "";
  var scored: { i: number; score: number }[] = [];
  for (var i = 0; i < fileLines.length; i++) {
    var ln = fileLines[i].trim();
    if (!ln) continue;
    var score = 0;
    if (ln === t) score = 100;
    else if (ln.indexOf(t) !== -1 || t.indexOf(ln) !== -1) score = 60;
    else {
      // 共同子串长度的粗略度量。
      var common = 0;
      for (var c = 0; c < Math.min(ln.length, t.length); c++) if (ln[c] === t[c]) common++; else break;
      score = common;
    }
    if (score > 3) scored.push({ i: i, score: score });
  }
  scored.sort(function (a, b) { return b.score - a.score; });
  return scored.slice(0, 3).map(function (x) { return "  " + (x.i + 1) + ": " + fileLines[x.i]; }).join(String.fromCharCode(10));
}

// 统计子串出现次数（用于 multi_edit 的唯一性校验，非正则、避免特殊字符问题）。
function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  var n = 0, idx = 0;
  while ((idx = haystack.indexOf(needle, idx)) !== -1) { n++; idx += needle.length; }
  return n;
}

function replaceAllLiteral(haystack: string, needle: string, repl: string): string {
  return haystack.split(needle).join(repl);
}

// multi_edit：对单个文件按顺序施加多处替换，全有或全无（任一未命中则不写盘）。
// 每个 old_string 默认要求在「当前状态」下唯一，除非 replace_all。复用 edit_file
// 的字面替换语义，先在内存里全部应用成功，再一次性落盘。
async function multiEditTool(args: any, cwd: string): Promise<string> {
  var filePath = resolve(cwd, args.file_path);
  if (!existsSync(filePath)) return "File not found: " + args.file_path;
  var edits = Array.isArray(args.edits) ? args.edits : [];
  if (edits.length === 0) return "No edits provided.";

  var content = await readFile(filePath, "utf-8");
  // 逐个施加，复用 edit_file 的分层匹配（精确→去空白容错→可操作错误）。
  // 任一未命中整体放弃（不写盘）。
  for (var i = 0; i < edits.length; i++) {
    var e = edits[i] || {};
    var oldStr = String(e.old_string == null ? "" : e.old_string);
    var newStr = String(e.new_string == null ? "" : e.new_string);
    if (!oldStr) return "Edit #" + (i + 1) + " has an empty old_string; aborted, no changes written.";
    var res = applyStringEdit(content, oldStr, newStr, !!e.replace_all);
    if (res.error) return "Edit #" + (i + 1) + ": " + res.error + " — aborted, no changes written to " + args.file_path + ".";
    content = res.content;
  }
  await writeFile(filePath, content, "utf-8");
  return "File edited: " + args.file_path + " (" + edits.length + " edits)";
}

// --- Unified-diff applier (apply_diff) ---
// 解析 `diff -u`/`git diff` 风格的补丁并按上下文匹配施加到文件上。
// 不依赖原始行号（LLM 给的行号常不准），而是用每个 hunk 的「上下文+删除行」
// 作为锚点在文件中定位，命中后替换为「上下文+新增行」。任一 hunk 失配则整体放弃。

interface DiffHunk { oldLines: string[]; newLines: string[]; }

// 从补丁正文里提取所有 hunk。oldLines = 上下文行(' ')+删除行('-')；
// newLines = 上下文行(' ')+新增行('+')。忽略 ---/+++ 头与 \ No newline 标记。
function parseUnifiedDiff(diff: string): DiffHunk[] | { error: string } {
  var LF = String.fromCharCode(10);
  var rawLines = diff.replace(/\r\n/g, LF).split(LF);
  var hunks: DiffHunk[] = [];
  var cur: DiffHunk | null = null;
  for (var i = 0; i < rawLines.length; i++) {
    var line = rawLines[i];
    if (line.indexOf("@@") === 0) {
      cur = { oldLines: [], newLines: [] };
      hunks.push(cur);
      continue;
    }
    if (line.indexOf("--- ") === 0 || line.indexOf("+++ ") === 0) continue; // 文件头
    if (line.indexOf("diff ") === 0 || line.indexOf("index ") === 0) continue; // git 头
    if (line.indexOf("\\") === 0) continue; // "\ No newline at end of file"
    if (!cur) continue; // hunk 头之前的内容忽略
    var tag = line.charAt(0);
    var rest = line.slice(1);
    if (tag === " ") { cur.oldLines.push(rest); cur.newLines.push(rest); }
    else if (tag === "-") { cur.oldLines.push(rest); }
    else if (tag === "+") { cur.newLines.push(rest); }
    else if (line === "") { /* 末尾空行，忽略 */ }
    else { /* 容错：无前缀视作上下文 */ cur.oldLines.push(line); cur.newLines.push(line); }
  }
  if (hunks.length === 0) return { error: "no @@ hunks found in diff" };
  return hunks;
}

// 在 fileLines 中从 fromIndex 起寻找与 block 完全相等的连续段，返回起点下标或 -1。
function findBlock(fileLines: string[], block: string[], fromIndex: number): number {
  if (block.length === 0) return fromIndex;
  for (var i = fromIndex; i + block.length <= fileLines.length; i++) {
    var ok = true;
    for (var j = 0; j < block.length; j++) {
      if (fileLines[i + j] !== block[j]) { ok = false; break; }
    }
    if (ok) return i;
  }
  return -1;
}

async function applyDiffTool(args: any, cwd: string): Promise<string> {
  var filePath = resolve(cwd, args.file_path);
  if (!existsSync(filePath)) return "File not found: " + args.file_path;
  var diff = String(args.diff || "");
  if (!diff.trim()) return "Empty diff.";

  var parsed = parseUnifiedDiff(diff);
  if (!Array.isArray(parsed)) return "Could not parse diff: " + parsed.error;
  var hunks = parsed;

  var LF = String.fromCharCode(10);
  var content = await readFile(filePath, "utf-8");
  var fileLines = content.split(LF);

  // 顺序施加每个 hunk；用游标保证 hunk 间相对顺序，避免重复段误匹配。
  var cursor = 0;
  for (var h = 0; h < hunks.length; h++) {
    var hunk = hunks[h];
    var at = findBlock(fileLines, hunk.oldLines, cursor);
    if (at === -1) {
      // 退一步：从头再找一次（容忍 hunk 顺序与文件不完全一致）。
      at = findBlock(fileLines, hunk.oldLines, 0);
    }
    if (at === -1) {
      return "Hunk #" + (h + 1) + " did not match the file context; no changes written to " + args.file_path +
        ". The file may have changed — re-read it and regenerate the diff.";
    }
    var before = fileLines.slice(0, at);
    var after = fileLines.slice(at + hunk.oldLines.length);
    fileLines = before.concat(hunk.newLines, after);
    cursor = at + hunk.newLines.length;
  }

  await writeFile(filePath, fileLines.join(LF), "utf-8");
  return "Patch applied: " + args.file_path + " (" + hunks.length + " hunk" + (hunks.length === 1 ? "" : "s") + ")";
}

async function listFilesTool(args: any, cwd: string): Promise<string> {
  var dirPath = resolve(cwd, args.dir_path);
  if (!existsSync(dirPath)) return "Directory not found: " + args.dir_path;
  var entries = await readdir(dirPath, { withFileTypes: true });
  var lines: string[] = [];
  for (var i = 0; i < entries.length; i++) {
    var e = entries[i];
    if (e.name.startsWith(".")) continue;
    lines.push((e.isDirectory() ? "[DIR]  " : "[FILE] ") + e.name);
  }
  return lines.join(String.fromCharCode(10));
}

// run_command 用哪个 shell：Windows 上优先 PowerShell 7（pwsh），装了就用，
// 没装回退到系统自带的 powershell.exe（Win10/11 必有）；非 Windows 走 exec 默认
// 的 /bin/sh。解析结果缓存，避免每条命令都探测一次。
var _resolvedShell: string | boolean | undefined;
function resolveShell(): string | boolean {
  if (_resolvedShell !== undefined) return _resolvedShell;
  if (process.platform !== "win32") { _resolvedShell = true; return _resolvedShell; }
  try {
    require("child_process").execFileSync("pwsh", ["-NoProfile", "-Command", "$null"], { stdio: "ignore", windowsHide: true });
    _resolvedShell = "pwsh.exe";
  } catch {
    _resolvedShell = "powershell.exe";
  }
  return _resolvedShell;
}

async function runCommandTool(args: any, cwd: string): Promise<string> {
  return new Promise(function(resolve) {
    var LF = String.fromCharCode(10);
    var timeout = args.timeout || 30000;
    // exec 的 shell 选项只接受字符串路径；非 win32 下 resolveShell() 返回 true（spawn 用），
    // 对 exec 无意义（它本就经 /bin/sh），故仅当是字符串（Windows 的 pwsh/powershell）时传入。
    var sh = resolveShell();
    // maxBuffer 提到 10MB（原 1MB 对构建/测试类大输出太小）。超出仍会触发
    // ERR_CHILD_PROCESS_STDIO_MAXBUFFER，但下方会把已捕获的 stdout 一并带出，
    // 不再把成功命令的部分输出当成纯失败丢弃。
    var opts: ExecOptions = { cwd: cwd, maxBuffer: 10 * 1024 * 1024 };
    if (typeof sh === "string") opts.shell = sh;
    // 注入内置 node 的 PATH：run_command 跑 node/npm/npx 时用打包的 node，无需自装。
    opts.env = augmentPath({ ...(process.env as Record<string, string>) });

    var done = false;
    var timedOut = false;
    var finish = function (text: string) { if (done) return; done = true; clearTimeout(timer); resolve(text); };

    var child = exec(args.command, opts, function(err: any, stdout, stderr) {
      // ExecOptions(无 encoding)时回调类型被推断为 string|Buffer，统一 String() 归一。
      var out = String(stdout || "");
      var serr = String(stderr || "");
      if (timedOut) {
        return finish("Timed out after " + timeout + "ms (process tree killed)." + LF +
          "stdout: " + out + LF + "stderr: " + serr);
      }
      // maxBuffer 溢出：命令可能本已成功，输出被截断；保留已捕获内容而非丢弃。
      if (err && err.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
        return finish("Output truncated at 10MB (maxBuffer exceeded)." + LF +
          "stdout (partial): " + out + (serr ? LF + "stderr (partial): " + serr : ""));
      }
      if (err) {
        finish("Exit code: " + err.code + LF + "stdout: " + out + LF + "stderr: " + serr);
      } else {
        finish(out || "(no output)");
      }
    });

    // 自管超时：到点后杀整棵进程树（Windows 上 exec 的 timeout 只杀父 shell，
    // 孙进程会残留——与 monitor 一致用 taskkill /t /f；非 Windows 用 SIGKILL）。
    var timer = setTimeout(function () {
      timedOut = true;
      try {
        if (process.platform === "win32" && child.pid) {
          execFile("taskkill", ["/pid", String(child.pid), "/t", "/f"], function () {});
        } else {
          child.kill("SIGKILL");
        }
      } catch {}
    }, timeout);
  });
}

// monitor：跑一个长命令并「监听」其输出流，直到①某行匹配 until_pattern ②进程退出
// ③超时，三者之一发生即停止并返回结果。与 run_command 的区别：run_command 等命令
// 跑完一次性拿全部输出；monitor 面向「持续产出、需要等某个事件」的场景（dev server
// 打印 ready、构建完成、日志出现报错）。用 spawn 流式读取（exec 会缓冲到结束才给）。
//
// 设计选择（与用户确认）：这是个普通工具——消费者是模型而非人，故不做任何 UI 渲染、
// 不开后台任务，就是「阻塞监听到条件满足再返回字符串」。用户点「停止」时经
// ctx.signal 提前结束：杀子进程、返回已捕获内容。
async function monitorTool(args: any, cwd: string, ctx?: ToolContext): Promise<string> {
  const command = String(args.command || "").trim();
  if (!command) return "Empty command.";
  const LF = String.fromCharCode(10);

  // 超时：默认 60s，封顶 10min（防止模型设个超大值把这一轮挂死）。
  let timeout = Number(args.timeout);
  if (!isFinite(timeout) || timeout <= 0) timeout = 60000;
  timeout = Math.min(timeout, 600000);
  const tailLines = Math.max(1, Math.min(Number(args.tail_lines) || 60, 500));

  // until_pattern：编译为正则；非法正则降级为字面子串匹配，不让一个坏 pattern 失败。
  let untilRe: RegExp | null = null;
  let literalNeedle = "";
  if (args.until_pattern) {
    try { untilRe = new RegExp(String(args.until_pattern)); }
    catch { literalNeedle = String(args.until_pattern); }
  }

  return new Promise<string>(function (resolve) {
    let settled = false;
    const lines: string[] = [];      // 全部输出行（用于 tail）
    let buf = "";                     // 跨 chunk 的残行缓冲
    let matchedLine: string | null = null;
    let stopReason = "";

    // shell:true 让用户写的命令字符串（含管道/重定向）按 shell 解释，跨平台一致。
    const child = spawn(command, { cwd, shell: true, windowsHide: true });

    const finish = function (reason: string) {
      if (settled) return;
      settled = true;
      stopReason = stopReason || reason;
      clearTimeout(timer);
      if (ctx && ctx.signal) ctx.signal.removeEventListener("abort", onAbort);
      try { child.kill(); } catch {}
      // Windows 上 shell 子进程可能残留，尽力再杀一次进程组。
      try { if (process.platform === "win32" && child.pid) execFile("taskkill", ["/pid", String(child.pid), "/t", "/f"], function () {}); } catch {}

      const tail = lines.slice(-tailLines).join(LF);
      const head =
        "[monitor] command: " + command + LF +
        "[monitor] stopped: " + stopReason + LF +
        (matchedLine != null ? "[monitor] matched line: " + matchedLine + LF : "") +
        "[monitor] " + lines.length + " line(s) captured, showing last " + Math.min(tailLines, lines.length) + ":" + LF;
      resolve(head + (tail || "(no output)"));
    };

    // 处理一段新输出：拼接缓冲、按行切分、逐行检查 until 条件。
    const onData = function (chunk: Buffer) {
      buf += chunk.toString();
      const parts = buf.split(LF);
      buf = parts.pop() || "";
      for (const raw of parts) {
        const line = raw.replace(/\r$/, "");
        lines.push(line);
        if (matchedLine == null) {
          const hit = untilRe ? untilRe.test(line) : (literalNeedle ? line.indexOf(literalNeedle) !== -1 : false);
          if (hit) { matchedLine = line; finish("matched until_pattern"); return; }
        }
      }
    };

    if (child.stdout) child.stdout.on("data", onData);
    if (child.stderr) child.stderr.on("data", onData);

    child.on("error", function (err: any) {
      if (buf) { lines.push(buf); buf = ""; }
      finish("spawn error: " + ((err && err.message) || String(err)));
    });
    child.on("close", function (code: number | null) {
      if (buf) { lines.push(buf); buf = ""; }
      finish("process exited (code " + (code == null ? "?" : code) + ")");
    });

    const timer = setTimeout(function () { finish("timeout (" + timeout + "ms)"); }, timeout);

    // 用户点「停止」：杀子进程、返回已捕获内容。
    const onAbort = function () { finish("aborted by user"); };
    if (ctx && ctx.signal) {
      if (ctx.signal.aborted) { onAbort(); return; }
      ctx.signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

// 递归遍历(glob_files / search_files 的 Node 回落)统一跳过的目录名，保证两条
// 路径行为对称——否则一个会去扫 build/.next 而另一个不会。
var WALK_SKIP_DIRS = ["node_modules", ".git", "dist", "out", ".cache", ".next", "build"];

async function globFilesTool(args: any, cwd: string): Promise<string> {
  var baseDir = resolve(cwd, args.dir_path || ".");
  if (!existsSync(baseDir)) return "Directory not found: " + (args.dir_path || ".");
  // Translate a glob pattern to a regex matched against the relative path.
  // `**/` must match ZERO-or-more leading segments (so `**/*.html` also finds
  // files at the root, not just nested ones); a bare `**` matches any chars.
  var pat = String(args.pattern || "*")
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*\//g, "__GLOBSTARSLASH__") // **/ → optional segments (incl. root)
    .replace(/\*\*/g, "__GLOBSTAR__")        // **  → any depth (sentinel, restored below)
    .replace(/\*/g, "[^/]*")                 // *   → within a segment
    .replace(/\?/g, "[^/]")                  // ?   → single char (not a separator)
    .replace(/__GLOBSTARSLASH__/g, "(?:.*/)?")
    .replace(/__GLOBSTAR__/g, ".*");
  var re = new RegExp("(^|/)" + pat + "$", "i");
  var matches: string[] = [];
  var SKIP = new Set(WALK_SKIP_DIRS);

  async function walk(dir: string): Promise<void> {
    if (matches.length >= 200) return;
    var entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      if (e.name.startsWith(".") && e.name !== ".env") continue;
      var full = join(dir, e.name);
      if (e.isDirectory()) {
        if (SKIP.has(e.name)) continue;
        await walk(full);
      } else {
        var rel = relative(baseDir, full).replace(/\\/g, "/");
        if (re.test(rel)) matches.push(rel);
      }
    }
  }
  await walk(baseDir);
  if (matches.length === 0) return "No files matching '" + args.pattern + "'";
  return matches.slice(0, 200).join(String.fromCharCode(10));
}

// --- Web tools (no API key, provider-agnostic) ---

interface HttpOpts { method?: string; body?: string; headers?: Record<string, string>; }

// HTTP request with redirect-following, browser UA, timeout. Supports GET/POST.
// Returns status, body, and (on failure) the underlying error string so callers
// can surface a real reason instead of an opaque "status 0".
function httpRequest(rawUrl: string, redirectsLeft: number, opts?: HttpOpts): Promise<{ status: number; body: string; contentType?: string; error?: string }> {
  return new Promise(function(res) {
    var urlObj: URL;
    try { urlObj = new URL(rawUrl); } catch (e: any) { return res({ status: 0, body: "", error: "bad URL" }); }
    var isHttps = urlObj.protocol === "https:";
    var transport = isHttps ? require("https") : require("http");
    var method = (opts && opts.method) || "GET";
    var baseHeaders: Record<string, string> = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9,zh-CN;q=0.8",
    };
    if (opts && opts.body) {
      baseHeaders["Content-Type"] = "application/x-www-form-urlencoded";
      baseHeaders["Content-Length"] = String(Buffer.byteLength(opts.body));
    }
    if (opts && opts.headers) for (var k in opts.headers) baseHeaders[k] = opts.headers[k];

    var req = transport.request({
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: method,
      timeout: 15000,
      headers: baseHeaders,
    }, function(r: any) {
      // Follow redirects. Resolve Location against the current URL so relative
      // ("/path"), protocol-relative ("//host/path") and absolute targets all
      // work (the old `indexOf("http")===0` test mis-joined "//host" onto origin).
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location && redirectsLeft > 0) {
        var next: string;
        try { next = new URL(r.headers.location, urlObj).toString(); }
        catch { next = r.headers.location; }
        r.destroy();
        // 301/302/303: per browser behavior a POST becomes a GET and the body is
        // dropped. 307/308: method and body are preserved. Carry the caller's
        // custom headers across either way (auth/accept must survive the hop).
        var keepMethod = r.statusCode === 307 || r.statusCode === 308;
        var nextOpts: HttpOpts = {
          method: keepMethod ? method : (method === "POST" ? "GET" : method),
          headers: opts && opts.headers,
        };
        if (keepMethod && opts && opts.body) nextOpts.body = opts.body;
        return res(httpRequest(next, redirectsLeft - 1, nextOpts));
      }
      var chunks = "";
      var ctHeader = String(r.headers["content-type"] || "");
      r.on("data", function(c: Buffer) { chunks += c.toString(); if (chunks.length > 2_000_000) r.destroy(); });
      r.on("end", function() { res({ status: r.statusCode || 0, body: chunks, contentType: ctHeader }); });
    });
    req.on("timeout", function() { req.destroy(); res({ status: 0, body: "", error: "timeout (15s)" }); });
    req.on("error", function(err: any) { res({ status: 0, body: "", error: (err && err.message) || "network error" }); });
    if (opts && opts.body) req.write(opts.body);
    req.end();
  });
}

// Back-compat GET wrapper.
function httpGet(rawUrl: string, redirectsLeft: number): Promise<{ status: number; body: string; contentType?: string; error?: string }> {
  return httpRequest(rawUrl, redirectsLeft);
}

// Strip HTML to readable text.
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(p|div|h[1-6]|li|tr|br|section|article)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// configure_hooks: 让 agent 直接读/写项目 .claude/settings.json 的 hooks 配置。
// operations 为空数组 = 只读当前配置。否则按序应用 add/remove/clear 后落盘，
// 返回带索引的配置摘要（供后续按 index 删除）。校验交给 hooksManager.applyOps。
async function configureHooksTool(args: any, cwd: string): Promise<string> {
  const ops = Array.isArray(args.operations) ? args.operations : [];
  if (ops.length === 0) {
    const cfg = await hooksManager.loadConfig(cwd);
    return "Current hooks configuration (.claude/settings.json):\n" + summarize(cfg);
  }
  const res = await hooksManager.applyOps(cwd, ops);
  if (!res.ok) return "Failed to configure hooks: " + (res.error || "unknown error");
  return "Hooks updated (.claude/settings.json). Current configuration:\n" + (res.summary || "No hooks configured.");
}

async function webFetchTool(args: any): Promise<string> {
  var url = String(args.url || "").trim();
  if (!/^https?:\/\//i.test(url)) return "Invalid URL (must start with http:// or https://)";
  var r = await httpGet(url, 5);
  if (r.status === 0) return "Failed to fetch " + url + ": " + (r.error || "network error");
  if (r.status >= 400) return "HTTP " + r.status + " fetching " + url;
  // 优先用响应头的 Content-Type 判定 JSON；缺失/不可信时回退到正文首字符启发式
  // （某些接口不发 content-type，或发成 text/plain 却返回 JSON）。
  var ct = (r.contentType || "").toLowerCase();
  var body = r.body;
  var trimmed = body.trimStart();
  var looksJson = trimmed.startsWith("{") || trimmed.startsWith("[");
  var isJson = ct.indexOf("application/json") !== -1 || (/[+.]json\b/.test(ct)) ||
    (ct.indexOf("text/html") === -1 && looksJson);
  var text = isJson ? body : htmlToText(body);
  if (text.length > 12000) text = text.slice(0, 12000) + "\n… (truncated)";
  return text || "(empty response)";
}

// Decode DuckDuckGo's /l/?uddg= redirect wrapper into the real target URL.
function ddgUnwrap(href: string): string {
  var um = /[?&]uddg=([^&]+)/.exec(href);
  if (um) { try { return decodeURIComponent(um[1]); } catch {} }
  if (href.indexOf("//") === 0) return "https:" + href;
  return href;
}

// Public SearXNG instances exposing JSON output. Tried in order; first that
// returns results wins. SearXNG is open-source metasearch and generally does
// not block programmatic JSON requests (unlike DuckDuckGo's anti-bot).
var SEARXNG_INSTANCES = [
  "https://searx.be",
  "https://search.inetol.net",
  "https://priv.au",
  "https://searx.tiekoetter.com",
  "https://search.rhscz.eu",
];

async function searxngSearch(q: string): Promise<{ title: string; url: string; content: string }[] | null> {
  for (var i = 0; i < SEARXNG_INSTANCES.length; i++) {
    var url = SEARXNG_INSTANCES[i] + "/search?q=" + encodeURIComponent(q) + "&format=json&language=en";
    var r = await httpRequest(url, 3, { headers: { "Accept": "application/json" } });
    if (r.status >= 200 && r.status < 300 && r.body) {
      try {
        var j = JSON.parse(r.body);
        if (j && Array.isArray(j.results) && j.results.length > 0) {
          return j.results.slice(0, 8).map(function(x: any) {
            return { title: String(x.title || ""), url: String(x.url || ""), content: String(x.content || "") };
          });
        }
      } catch (e) { /* not JSON / instance returned HTML — try next */ }
    }
  }
  return null;
}

// DuckDuckGo HTML scrape — last-resort fallback (often blocked/rate-limited).
async function ddgScrape(q: string): Promise<{ title: string; url: string; content: string }[] | null> {
  var body = "q=" + encodeURIComponent(q) + "&kl=";
  var r = await httpRequest("https://html.duckduckgo.com/html/", 5, {
    method: "POST", body: body,
    headers: { "Referer": "https://html.duckduckgo.com/", "Origin": "https://html.duckduckgo.com" },
  });
  if (r.status < 200 || r.status >= 400 || !r.body) return null;
  var linkRe = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  var snipRe = /<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
  var out: { title: string; url: string; content: string }[] = [];
  var snips: string[] = []; var sm; while ((sm = snipRe.exec(r.body)) !== null && snips.length < 8) snips.push(htmlToText(sm[1]));
  var m; var n = 0;
  while ((m = linkRe.exec(r.body)) !== null && out.length < 8) {
    out.push({ title: htmlToText(m[2]), url: ddgUnwrap(m[1]), content: snips[n] || "" });
    n++;
  }
  return out.length > 0 ? out : null;
}

// Optional search-API backend (Tavily / Brave / Serper). Each has a free tier
// and a known JSON shape. Used as a reliable path when the user supplies a key;
// otherwise we fall back to the keyless SearXNG/DDG below. Provider-agnostic —
// nothing is hardcoded as required; the key is purely optional.
// 上次成功的搜索后端（进程内记忆，下次优先尝试，实现自适应排序）。
var lastGoodBackend: string | null = null;
export function getLastGoodSearchBackend(): string | null { return lastGoodBackend; }

async function apiSearch(q: string, cfg: { kind: string; apiKey: string }): Promise<{ title: string; url: string; content: string }[] | null> {
  var kind = cfg.kind;
  var key = cfg.apiKey;
  if (!key) return null;
  try {
    if (kind === "tavily") {
      var r = await httpRequest("https://api.tavily.com/search", 3, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: key, query: q, max_results: 8 }),
      });
      if (r.status < 200 || r.status >= 300 || !r.body) return null;
      var j = JSON.parse(r.body);
      if (!Array.isArray(j.results)) return null;
      return j.results.slice(0, 8).map(function(x: any) {
        return { title: String(x.title || ""), url: String(x.url || ""), content: String(x.content || "") };
      });
    }
    if (kind === "brave") {
      var rb = await httpRequest("https://api.search.brave.com/res/v1/web/search?q=" + encodeURIComponent(q), 3, {
        headers: { "Accept": "application/json", "X-Subscription-Token": key },
      });
      if (rb.status < 200 || rb.status >= 300 || !rb.body) return null;
      var jb = JSON.parse(rb.body);
      var web = jb && jb.web && Array.isArray(jb.web.results) ? jb.web.results : [];
      if (web.length === 0) return null;
      return web.slice(0, 8).map(function(x: any) {
        return { title: String(x.title || ""), url: String(x.url || ""), content: String(x.description || "") };
      });
    }
    if (kind === "serper") {
      var rs = await httpRequest("https://google.serper.dev/search", 3, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-KEY": key },
        body: JSON.stringify({ q: q }),
      });
      if (rs.status < 200 || rs.status >= 300 || !rs.body) return null;
      var js = JSON.parse(rs.body);
      var org = Array.isArray(js.organic) ? js.organic : [];
      if (org.length === 0) return null;
      return org.slice(0, 8).map(function(x: any) {
        return { title: String(x.title || ""), url: String(x.link || ""), content: String(x.snippet || "") };
      });
    }
  } catch (e) { /* parse/network error — fall through to keyless backends */ }
  return null;
}

async function webSearchTool(args: any, ctx?: ToolContext): Promise<string> {
  var q = String(args.query || "").trim();
  if (!q) return "Empty query";

  var results: { title: string; url: string; content: string }[] | null = null;
  // Try each user-configured search API in turn (reliable); the backend that
  // last succeeded is moved to the front for adaptive ordering. First one that
  // returns results wins; if all fail (or none configured), fall back to keyless.
  if (ctx && ctx.search && Array.isArray(ctx.search.backends) && ctx.search.backends.length) {
    var backends = ctx.search.backends.slice();
    if (lastGoodBackend) {
      backends.sort(function (a, b) {
        return (a.kind === lastGoodBackend ? -1 : 0) - (b.kind === lastGoodBackend ? -1 : 0);
      });
    }
    for (var bi = 0; bi < backends.length; bi++) {
      var bk = backends[bi];
      if (!bk || !bk.kind || bk.kind === "none" || !bk.apiKey) continue;
      results = await apiSearch(q, bk);
      if (results && results.length) { lastGoodBackend = bk.kind; break; }
      results = null;
    }
  }
  if (!results) results = await searxngSearch(q);
  if (!results) results = await ddgScrape(q);

  if (!results || results.length === 0) {
    return "Search returned no results (all search backends unreachable or empty). " +
      "If this persists, configure a search API key in Settings, or the network may be blocking search endpoints.";
  }
  var out: string[] = [];
  for (var i = 0; i < results.length; i++) {
    out.push((i + 1) + ". " + results[i].title + "\n   " + results[i].url +
      (results[i].content ? "\n   " + results[i].content : ""));
  }
  return out.join(String.fromCharCode(10) + String.fromCharCode(10));
}

// --- Image generation (generate_image) ---
// 用配置的 OpenAI 兼容图片接口（POST <baseUrl>/v1/images/generations）按 prompt 出图。
// 多个 prompt 并发；每个生成单独超时（默认 120s，封顶 300s）；返回 url 或 b64_json
// 两种格式都解析，统一把图片字节落地到 userData/chat-images（与聊天图片同目录），
// 返回每个 prompt 的成功/失败 + 本地绝对路径。CSP 不允许远程 <img>，故必须落地后
// 由渲染层经 readChatImage 读成 data URL 显示。
const IMAGE_GEN_MAX_CONCURRENT = 8;

// 单个 prompt 的生成结果（供工具结果文本与 UI 事件共用）。
interface GenImageResult { prompt: string; path?: string; error?: string; }

// 发一个 JSON POST 并拿回解析后的 JSON（带超时 + 可被 signal 中断）。
function postJsonForImage(rawUrl: string, apiKey: string, body: any, timeoutMs: number, signal?: AbortSignal, extraHeaders?: Record<string, string>): Promise<{ status: number; json: any; error?: string }> {
  return new Promise(function (res) {
    let urlObj: URL;
    try { urlObj = new URL(rawUrl); } catch { return res({ status: 0, json: null, error: "bad URL" }); }
    const isHttps = urlObj.protocol === "https:";
    const transport = isHttps ? require("https") : require("http");
    const payload = JSON.stringify(body);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + (apiKey || ""),
      "Content-Length": String(Buffer.byteLength(payload)),
    };
    if (extraHeaders) for (const k in extraHeaders) headers[k] = extraHeaders[k];
    const req = transport.request({
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: "POST",
      timeout: timeoutMs,
      headers: headers,
    }, function (r: any) {
      let data = "";
      r.on("data", function (c: Buffer) { data += c.toString(); });
      r.on("end", function () {
        let json: any = null;
        try { json = JSON.parse(data); } catch { /* keep raw for error */ }
        res({ status: r.statusCode || 0, json: json, error: json ? undefined : data.slice(0, 300) });
      });
    });
    req.on("timeout", function () { req.destroy(); res({ status: 0, json: null, error: "timeout (" + timeoutMs + "ms)" }); });
    req.on("error", function (err: any) { res({ status: 0, json: null, error: (err && err.message) || "network error" }); });
    const onAbort = function () { try { req.destroy(); } catch {} res({ status: 0, json: null, error: "aborted" }); };
    if (signal) { if (signal.aborted) return onAbort(); signal.addEventListener("abort", onAbort, { once: true }); }
    req.write(payload);
    req.end();
  });
}

// 下载一个图片 url 成 Buffer（带超时 + 跟随重定向，复用 httpRequest 的语义但拿二进制）。
// 导出供 ipc-handlers 的 chats:readImage 复用（渲染层 CSP 挡不住主进程下载）。
export function downloadImageBytes(rawUrl: string, redirectsLeft: number, timeoutMs: number, signal?: AbortSignal): Promise<Buffer | null> {
  return new Promise(function (res) {
    let urlObj: URL;
    try { urlObj = new URL(rawUrl); } catch { return res(null); }
    const isHttps = urlObj.protocol === "https:";
    const transport = isHttps ? require("https") : require("http");
    const req = transport.request({
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: "GET",
      timeout: timeoutMs,
    }, function (r: any) {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location && redirectsLeft > 0) {
        const loc = r.headers.location;
        const next = loc.indexOf("http") === 0 ? loc : urlObj.origin + loc;
        r.destroy();
        return res(downloadImageBytes(next, redirectsLeft - 1, timeoutMs, signal));
      }
      if ((r.statusCode || 0) < 200 || (r.statusCode || 0) >= 300) { r.destroy(); return res(null); }
      const chunks: Buffer[] = [];
      let total = 0;
      r.on("data", function (c: Buffer) { chunks.push(c); total += c.length; if (total > 25_000_000) r.destroy(); });
      r.on("end", function () { res(Buffer.concat(chunks)); });
      r.on("error", function () { res(null); });
    });
    req.on("timeout", function () { req.destroy(); res(null); });
    req.on("error", function () { res(null); });
    const onAbort = function () { try { req.destroy(); } catch {} res(null); };
    if (signal) { if (signal.aborted) return onAbort(); signal.addEventListener("abort", onAbort, { once: true }); }
    req.end();
  });
}

// 把图片字节写入指定目录（默认 userData/chat-images）。返回绝对路径。
// 导出供 agent-loop 复用:把 MCP 截图/read 图等「只有 base64、无稳定本地路径」的工具
// 产图落盘换取路径,经 agent:generated-images 写进 store,实现图片跨轮持久化(防缓存击穿)。
export function saveImageBytes(buf: Buffer, ext: string, saveDir?: string): string {
  const { app } = require("electron");
  const { join } = require("path");
  const { writeFileSync, mkdirSync, existsSync: exists } = require("fs");
  const dir = (saveDir && String(saveDir).trim()) ? String(saveDir) : join(app.getPath("userData"), "chat-images");
  if (!exists(dir)) mkdirSync(dir, { recursive: true });
  const safeExt = (ext || "png").replace(/[^a-z0-9]/gi, "").slice(0, 5) || "png";
  const name = "img-" + Date.now() + "-" + Math.floor(Math.random() * 1e6) + "." + safeExt;
  const file = join(dir, name);
  writeFileSync(file, buf);
  return file;
}

// 从 data URL 或裸 base64 解出字节 + 扩展名。
function decodeB64Image(b64: string): { buf: Buffer; ext: string } | null {
  if (!b64) return null;
  let ext = "png";
  let data = b64;
  const m = /^data:image\/([a-zA-Z0-9.+-]+);base64,(.*)$/.exec(b64);
  if (m) { ext = m[1] === "jpeg" ? "jpg" : m[1]; data = m[2]; }
  try { return { buf: Buffer.from(data, "base64"), ext: ext }; } catch { return null; }
}

// 生图核心：被 generate_image 工具与「直接选中图片供应商发消息」的直发 IPC 共用。
// 接受多个 prompt 并发出图，返回每个 prompt 的成功路径/失败原因。endpoint 决定 URL：
//   images = <baseUrl>(+/v1)/images/generations（标准图片接口）
//   chat   = <baseUrl>(+/v1)/chat/completions（聊天补全式出图）
//   raw    = 直接 POST baseUrl 原样（不补 /v1、不加后缀），给会自动补全路径的中转站用
// 导出供 ipc-handlers 的 image:generate 复用。
export interface ImageGenSettings {
  baseUrl: string;
  apiKey: string;
  model: string;
  endpoint: "images" | "chat" | "raw";
  headers?: Record<string, string>;
}

export async function generateImages(
  cfg: ImageGenSettings,
  prompts: string[],
  size: string,
  signal?: AbortSignal,
  saveDir?: string
): Promise<GenImageResult[]> {
  // 端点 URL：raw=原样 baseUrl（不补 /v1、不加后缀）；其余补 /v1 + 对应后缀。
  const useChat = cfg.endpoint === "chat";
  const useRaw = cfg.endpoint === "raw";
  let url: string;
  if (useRaw) {
    url = (cfg.baseUrl || "").replace(/\/+$/, "");
  } else {
    let base = (cfg.baseUrl || "").replace(/\/+$/, "");
    if (base.indexOf("/v1") === -1) base += "/v1";
    url = base + (useChat ? "/chat/completions" : "/images/generations");
  }

  // 每张生成的超时：封顶 300s（用户要求至少等两分钟）。
  const perImageTimeout = 300000;
  const sz = (size && size.trim()) ? size.trim() : "";

  return Promise.all(prompts.map(async function (prompt): Promise<GenImageResult> {
    try {
      let item: any = null;
      let chatBytes: { buf: Buffer; ext: string } | null = null;
      let chatUrl: string | null = null;

      if (useChat) {
        // 聊天补全式出图：把 prompt 作为用户消息发到 /chat/completions，从返回里抽图。
        const body: any = { model: cfg.model, messages: [{ role: "user", content: prompt }] };
        const r = await postJsonForImage(url, cfg.apiKey, body, perImageTimeout, signal, cfg.headers);
        if (r.status < 200 || r.status >= 300 || !r.json) {
          return { prompt: prompt, error: "HTTP " + r.status + (r.error ? ": " + r.error : "") };
        }
        const ex = extractImageFromChat(r.json);
        if (!ex) return { prompt: prompt, error: "no image found in chat response" };
        chatBytes = ex.b64 ? decodeB64Image(ex.b64) : null;
        chatUrl = ex.url || null;
      } else {
        const body: any = { model: cfg.model, prompt: prompt, n: 1, response_format: "b64_json" };
        if (sz) body.size = sz; // 留空则不发，端点用自身默认
        const r = await postJsonForImage(url, cfg.apiKey, body, perImageTimeout, signal, cfg.headers);
        if (r.status < 200 || r.status >= 300 || !r.json) {
          return { prompt: prompt, error: "HTTP " + r.status + (r.error ? ": " + r.error : "") };
        }
        item = r.json && Array.isArray(r.json.data) && r.json.data[0] ? r.json.data[0] : null;
        if (!item) return { prompt: prompt, error: "no image in response" };
      }

      let saved: string | null = null;
      // b64（images 接口的 b64_json，或 chat 抽到的 base64）。
      const b64 = item ? item.b64_json : (chatBytes ? null : null);
      if (item && item.b64_json) {
        const dec = decodeB64Image(item.b64_json);
        if (dec) saved = saveImageBytes(dec.buf, dec.ext, saveDir);
      } else if (chatBytes) {
        saved = saveImageBytes(chatBytes.buf, chatBytes.ext, saveDir);
      } else {
        // url（images 接口的 data[].url，或 chat 抽到的图片链接）→ 下载。
        const dl = (item && item.url) || chatUrl;
        if (dl) {
          const buf = await downloadImageBytes(String(dl), 5, perImageTimeout, signal);
          if (buf) {
            const um = /\.([a-zA-Z0-9]{3,4})(?:[?#]|$)/.exec(String(dl));
            saved = saveImageBytes(buf, um ? um[1] : "png", saveDir);
          }
        }
      }
      void b64;
      if (!saved) return { prompt: prompt, error: "could not decode/download image bytes" };
      return { prompt: prompt, path: saved };
    } catch (e: any) {
      return { prompt: prompt, error: (e && e.message) || String(e) };
    }
  }));
}

// 从 /chat/completions 返回里抽取图片：兼容三种常见形态——
//  1) message.images[].image_url.url（部分中转的多模态返回）
//  2) 正文里的 data:image/...;base64 或 Markdown 图 ![](url) / 裸图片 URL
function extractImageFromChat(json: any): { b64?: string; url?: string } | null {
  try {
    const msg = json && json.choices && json.choices[0] && json.choices[0].message;
    if (!msg) return null;
    // 形态 1：message.images[]
    if (Array.isArray(msg.images) && msg.images[0]) {
      const u = msg.images[0].image_url ? msg.images[0].image_url.url : msg.images[0].url;
      if (typeof u === "string" && u) {
        if (u.indexOf("data:image/") === 0) return { b64: u };
        return { url: u };
      }
    }
    // 形态 2：content 文本（可能是数组多模态或字符串）。
    let text = "";
    if (typeof msg.content === "string") text = msg.content;
    else if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part && part.type === "image_url" && part.image_url && part.image_url.url) {
          const u = String(part.image_url.url);
          return u.indexOf("data:image/") === 0 ? { b64: u } : { url: u };
        }
        if (part && typeof part.text === "string") text += part.text;
      }
    }
    if (text) {
      const dataM = /(data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+)/.exec(text);
      if (dataM) return { b64: dataM[1] };
      const mdM = /!\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/.exec(text);
      if (mdM) return { url: mdM[1] };
      const urlM = /(https?:\/\/[^\s)]+\.(?:png|jpe?g|webp|gif)(?:\?[^\s)]*)?)/i.exec(text);
      if (urlM) return { url: urlM[1] };
    }
    return null;
  } catch { return null; }
}

async function generateImageTool(args: any, ctx?: ToolContext): Promise<string> {
  const cfg = ctx && ctx.imageGen;
  if (!cfg || !cfg.baseUrl || !cfg.model || !cfg.apiKey) {
    return "No image-generation provider is configured. Ask the user to open Settings → API Providers, pick (or add) a provider, and tick “用作图片生成”.";
  }

  // prompts 规整：接受 prompts[] 或单个 prompt；封顶 IMAGE_GEN_MAX_CONCURRENT。
  let prompts: string[] = [];
  if (Array.isArray(args.prompts)) prompts = args.prompts.filter(function (p: any) { return typeof p === "string" && p.trim(); }).map(String);
  else if (typeof args.prompt === "string" && args.prompt.trim()) prompts = [args.prompt];
  if (prompts.length === 0) return "No prompts provided. Pass `prompts` (an array of text descriptions) or a single `prompt`.";

  let capNote = "";
  if (prompts.length > IMAGE_GEN_MAX_CONCURRENT) {
    capNote = "\n(Note: " + prompts.length + " prompts requested; capped to the first " + IMAGE_GEN_MAX_CONCURRENT + " per call.)";
    prompts = prompts.slice(0, IMAGE_GEN_MAX_CONCURRENT);
  }

  // 用户指定供应商/模型（仅当显式给出时才覆盖默认）。provider 按名字模糊匹配
  // （大小写不敏感、包含即可），从 ctx.imageGen.providers 里挑；找不到则保留默认并提示。
  let useCfg: ImageGenSettings = { baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, model: cfg.model, endpoint: cfg.endpoint, headers: cfg.headers };
  const notes: string[] = [];
  const wantProvider = (typeof args.provider === "string" && args.provider.trim()) ? args.provider.trim() : "";
  if (wantProvider) {
    const pool = Array.isArray(cfg.providers) ? cfg.providers : [];
    const q = wantProvider.toLowerCase();
    const hit = pool.find(function (p) { return (p.name || "").toLowerCase() === q; })
      || pool.find(function (p) { return (p.name || "").toLowerCase().indexOf(q) !== -1; });
    if (hit) {
      useCfg = { baseUrl: hit.baseUrl, apiKey: hit.apiKey, model: hit.model, endpoint: hit.endpoint, headers: hit.headers };
    } else {
      const names = pool.map(function (p) { return p.name; }).filter(Boolean);
      notes.push("Requested provider '" + wantProvider + "' not found; used the default instead." + (names.length ? " Available: " + names.join(", ") + "." : ""));
    }
  }
  // 用户指定模型：直接用（信任用户/模型；端点不认时会自然报错回流）。
  const wantModel = (typeof args.model === "string" && args.model.trim()) ? args.model.trim() : "";
  if (wantModel) useCfg.model = wantModel;

  // 用户指定保存目录：相对路径按项目根解析，绝对路径原样；否则用默认 saveDir。
  let saveDir = cfg.saveDir;
  const wantDir = (typeof args.save_dir === "string" && args.save_dir.trim()) ? args.save_dir.trim() : "";
  if (wantDir) {
    const isAbs = /^([a-zA-Z]:[\\/]|[\\/])/.test(wantDir);
    saveDir = (isAbs || !cfg.projectRoot) ? wantDir : resolve(cfg.projectRoot, wantDir);
  }

  // 尺寸：AI 显式给的优先（按图片用途自己定）；否则留空让端点用自身默认。
  const size = (typeof args.size === "string" && args.size.trim()) ? args.size.trim() : "";
  const signal = ctx && ctx.signal;

  const results = await generateImages(useCfg, prompts, size, signal, saveDir);

  // GENERATED_IMAGE_PATHS:<json> 这一行供 agent-loop 解析出图片路径并发 UI 事件
  // （渲染层据此在工具气泡里内联显示图片）。其余文本是给模型读的可读摘要。
  const okPaths = results.filter(function (r) { return r.path; }).map(function (r) { return r.path as string; });
  const LF = String.fromCharCode(10);
  const lines: string[] = [];
  lines.push(okPaths.length + " of " + results.length + " image(s) generated." + (wantModel ? " (model: " + useCfg.model + ")" : ""));
  results.forEach(function (r, i) {
    if (r.path) lines.push((i + 1) + ". OK: " + r.prompt + LF + "   saved: " + r.path);
    else lines.push((i + 1) + ". FAILED: " + r.prompt + LF + "   error: " + (r.error || "unknown"));
  });
  notes.forEach(function (n) { lines.push(n); });
  if (capNote) lines.push(capNote.trim());
  if (okPaths.length > 0) lines.push("GENERATED_IMAGE_PATHS:" + JSON.stringify(okPaths));
  return lines.join(LF);
}

// ---- 长期记忆工具(委托 memory-manager;落在 .claude/memory/ 低风险目录) ----

async function rememberTool(args: any, cwd: string): Promise<string> {
  var description = String(args.description || "").trim();
  if (!description) return "remember: 'description' is required.";
  var type = args.type;
  if (["user", "feedback", "project", "reference"].indexOf(type) < 0) type = "reference";
  try {
    var entry = await memoryManager.save(cwd, {
      name: args.name ? String(args.name) : undefined,
      description: description,
      type: type,
      body: args.body ? String(args.body) : undefined,
      source: args.scope === "global" ? "global" : "project",
    });
    return "Saved memory '" + entry.name + "' (" + entry.type + ", " + entry.source + ") → " + entry.path;
  } catch (e: any) {
    return "remember failed: " + (e?.message || String(e));
  }
}

async function recallMemoryTool(args: any, cwd: string): Promise<string> {
  var query = String(args.query || "").trim();
  try {
    var hits = await memoryManager.search(cwd, query, 8);
    if (hits.length === 0) return "No memory entries match '" + query + "'.";
    var LF = String.fromCharCode(10);
    return hits.map(function (e) {
      var snippet = e.body.replace(/\s+/g, " ").slice(0, 280);
      return "- (" + e.type + ") " + e.name + " — " + e.path + LF + "  " + snippet;
    }).join(LF);
  } catch (e: any) {
    return "recall_memory failed: " + (e?.message || String(e));
  }
}

// 跨会话关键词检索：列出命中的历史会话 + 片段，附 session_id 供 read_session 取全文。
async function searchSessionsTool(args: any, ctx?: ToolContext): Promise<string> {
  var query = String(args.query || "").trim();
  if (!query) return "Empty query.";
  try {
    var results = await chatStoreManager.searchAcrossSessions(query, {
      excludeSessionId: ctx && ctx.currentSessionId,
      limit: 10,
      perSession: 5,
    });
    if (results.length === 0) return "No past sessions match '" + query + "'.";
    var LF = String.fromCharCode(10);
    return results.map(function (r) {
      var when = r.createdAt ? new Date(r.createdAt).toISOString().slice(0, 16).replace("T", " ") : "unknown";
      var header = "● " + r.sessionName + "  [id: " + r.sessionId + "]  (" + when + ", project: " + r.project + ")";
      var body = r.hits.map(function (h) { return "    [" + h.role + "] " + h.snippet; }).join(LF);
      return header + LF + body;
    }).join(LF + LF);
  } catch (e: any) {
    return "search_sessions failed: " + (e?.message || String(e));
  }
}

// 按 id 读历史会话全文。默认截断到最近 RECENT 条（控 token），full=true 取整段。
async function readSessionTool(args: any): Promise<string> {
  var sessionId = String(args.session_id || "").trim();
  if (!sessionId) return "Missing session_id.";
  var full = args.full === true;
  try {
    var found = await chatStoreManager.readSessionById(sessionId);
    if (!found) return "Session not found: " + sessionId;
    var rec = found.record;
    var msgs = rec.messages;
    var RECENT = 40;
    var truncated = false;
    if (!full && msgs.length > RECENT) { msgs = msgs.slice(msgs.length - RECENT); truncated = true; }
    var LF = String.fromCharCode(10);
    var lines: string[] = [];
    lines.push("Session: " + rec.name + " [" + rec.id + "]  (" + (rec.provider || "") + "/" + (rec.model || "") + ", project: " + found.project + ")");
    if (truncated) lines.push("(showing the most recent " + RECENT + " of " + rec.messages.length + " messages; pass full=true for all)");
    lines.push("");
    for (var i = 0; i < msgs.length; i++) {
      var m = msgs[i];
      var content = String(m.content || "");
      // 单条正文上限，防止极长消息把上下文撑爆；full 模式也保留上限保护。
      if (content.length > 4000) content = content.slice(0, 4000) + "…(truncated)";
      var prefix = "[" + m.role + "]";
      if (m.toolCall && m.toolCall.name) prefix += " (tool: " + m.toolCall.name + ")";
      lines.push(prefix + " " + content);
    }
    return lines.join(LF);
  } catch (e: any) {
    return "read_session failed: " + (e?.message || String(e));
  }
}

// 内容搜索：优先 ripgrep（尊重 .gitignore、带行号、安全传参），不可用则回落到
// 安全的 Node 递归搜索（execFile 传参数组，杜绝 shell 注入；之前 findstr/grep 拼接
// 命令既不过滤忽略项又有注入风险）。
async function searchFilesTool(args: any, cwd: string): Promise<string> {
  var dirPath = resolve(cwd, args.dir_path || ".");
  if (!existsSync(dirPath)) return "Directory not found: " + (args.dir_path || ".");
  var pattern = String(args.pattern || "");
  if (!pattern) return "Empty search pattern.";
  var filePattern = args.file_pattern ? String(args.file_pattern) : "";

  // —— grep 选项解析 ——
  var mode = args.output_mode === "files_with_matches" || args.output_mode === "count" ? args.output_mode : "content";
  var ci = !!args.case_insensitive;
  var multiline = !!args.multiline;
  var cap = typeof args.max_results === "number" && args.max_results > 0 ? Math.floor(args.max_results) : 100;
  // context：context 同时设前后；否则用 before/after 各自值（仅 content 模式有意义）。
  var ctxAll = typeof args.context === "number" ? Math.max(0, Math.floor(args.context)) : -1;
  var ctxBefore = ctxAll >= 0 ? ctxAll : (typeof args.context_before === "number" ? Math.max(0, Math.floor(args.context_before)) : 0);
  var ctxAfter = ctxAll >= 0 ? ctxAll : (typeof args.context_after === "number" ? Math.max(0, Math.floor(args.context_after)) : 0);
  var LF = String.fromCharCode(10);

  // —— 1) ripgrep —— 参数全部走数组，绝不拼 shell。
  var rgArgs = ["--no-heading", "--color", "never"];
  if (mode === "files_with_matches") { rgArgs.push("--files-with-matches"); }
  else if (mode === "count") { rgArgs.push("--count"); }
  else {
    rgArgs.push("--line-number");
    if (ctxBefore > 0) rgArgs.push("--before-context", String(ctxBefore));
    if (ctxAfter > 0) rgArgs.push("--after-context", String(ctxAfter));
  }
  if (ci) rgArgs.push("--ignore-case");
  if (multiline) rgArgs.push("--multiline", "--multiline-dotall");
  if (filePattern) rgArgs.push("--glob", filePattern);
  rgArgs.push("-e", pattern, dirPath);
  var rg = await new Promise<{ ok: boolean; out: string }>(function (res) {
    execFile("rg", rgArgs, { cwd: cwd, timeout: 15000, maxBuffer: 8 * 1024 * 1024, windowsHide: true }, function (err: any, stdout) {
      // rg 退出码 1 = 无匹配（非错误）；ENOENT = 未安装。
      if (err && err.code === "ENOENT") return res({ ok: false, out: "" });
      res({ ok: true, out: String(stdout || "") });
    });
  });
  if (rg.ok) {
    var lines = rg.out.split(LF).filter(Boolean);
    if (lines.length === 0) return "No matches found for '" + pattern + "'";
    // 相对化路径，控制条数。
    var shown = lines.slice(0, cap).map(function (l) { return l.replace(dirPath, "").replace(/^[\\/]/, ""); });
    return shown.join(LF) + (lines.length > cap ? LF + "… (" + lines.length + " total)" : "");
  }

  // —— 2) Node 回落 —— 安全的递归字面/正则搜索，跳过常见忽略目录。
  var reFlags = (ci ? "i" : "") + (multiline ? "s" : "");
  var re: RegExp;
  try { re = new RegExp(pattern, reFlags); } catch { re = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), reFlags); }
  var globRe: RegExp | null = null;
  if (filePattern) {
    var gp = filePattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
    globRe = new RegExp("(^|[\\\\/])" + gp + "$", "i");
  }
  var SKIP = new Set(WALK_SKIP_DIRS);
  var hits: string[] = [];          // content 模式：输出行
  var fileSet: string[] = [];       // files_with_matches 模式：命中文件
  var counts: { f: string; n: number }[] = []; // count 模式：每文件计数
  function rel(full: string): string { return relative(dirPath, full).replace(/\\/g, "/"); }
  async function walk(dir: string): Promise<void> {
    if (hits.length >= cap || fileSet.length >= cap || counts.length >= cap) return;
    var entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      if (e.name.startsWith(".") && e.name !== ".env") continue;
      var full = join(dir, e.name);
      if (e.isDirectory()) { if (!SKIP.has(e.name)) await walk(full); continue; }
      if (globRe && !globRe.test(e.name)) continue;
      var text: string;
      try { text = await readFile(full, "utf-8"); } catch { continue; }
      if (text.indexOf("\0") !== -1) continue; // 跳过二进制
      // multiline：整文件匹配；否则逐行。
      if (multiline) {
        var mre = new RegExp(re.source, re.flags.indexOf("g") === -1 ? re.flags + "g" : re.flags);
        var n = 0; var m: RegExpExecArray | null;
        while ((m = mre.exec(text))) {
          n++;
          if (m.index === mre.lastIndex) mre.lastIndex++; // 零宽匹配防死循环
          if (n >= cap) break;
        }
        if (n > 0) {
          if (mode === "files_with_matches") { fileSet.push(rel(full)); if (fileSet.length >= cap) return; }
          else if (mode === "count") { counts.push({ f: rel(full), n: n }); if (counts.length >= cap) return; }
          else { hits.push(rel(full) + ": " + n + " match(es)"); if (hits.length >= cap) return; }
        }
        continue;
      }
      var fileLines = text.split(LF);
      var fileMatchCount = 0;
      var matched = false;
      for (var ln = 0; ln < fileLines.length; ln++) {
        if (!re.test(fileLines[ln])) continue;
        matched = true;
        fileMatchCount++;
        if (mode === "content") {
          // 上下文行（仅 content 模式）。
          var from = Math.max(0, ln - ctxBefore);
          var to = Math.min(fileLines.length - 1, ln + ctxAfter);
          if (ctxBefore > 0 || ctxAfter > 0) {
            for (var c = from; c <= to; c++) {
              hits.push(rel(full) + (c === ln ? ":" : "-") + (c + 1) + ": " + fileLines[c].slice(0, 200));
            }
            hits.push("--");
          } else {
            hits.push(rel(full) + ":" + (ln + 1) + ": " + fileLines[ln].trim().slice(0, 200));
          }
          if (hits.length >= cap) break;
        }
      }
      if (mode === "files_with_matches" && matched) { fileSet.push(rel(full)); if (fileSet.length >= cap) return; }
      else if (mode === "count" && fileMatchCount > 0) { counts.push({ f: rel(full), n: fileMatchCount }); if (counts.length >= cap) return; }
      if (hits.length >= cap) return;
    }
  }
  await walk(dirPath);
  if (mode === "files_with_matches") {
    if (fileSet.length === 0) return "No matches found for '" + pattern + "'";
    return fileSet.join(LF);
  }
  if (mode === "count") {
    if (counts.length === 0) return "No matches found for '" + pattern + "'";
    return counts.map(function (c) { return c.f + ":" + c.n; }).join(LF);
  }
  if (hits.length === 0) return "No matches found for '" + pattern + "'";
  return hits.join(LF);
}

// --- 窗口截图工具（capture_window）---
// 使用 Electron 内置 desktopCapturer 枚举可见窗口并截图。不传 title 列出窗口，
// 传了 title 则模糊匹配标题截图，保存到系统临时目录，返回路径 + GENERATED_IMAGE_PATHS
// 标记（复用 generate_image 的 UI 内联图片展示机制）。
async function captureWindowTool(args: any, ctx?: ToolContext): Promise<string> {
  var { desktopCapturer } = require("electron");
  var { join } = require("path");
  var { tmpdir } = require("os");
  var { writeFileSync, mkdirSync, existsSync: exists } = require("fs");
  var LF = String.fromCharCode(10);

  // 枚举所有窗口（thumbnailSize 设大以获取高分辨率截图）。
  var sources: any[];
  try {
    sources = await desktopCapturer.getSources({
      types: ["window"],
      thumbnailSize: { width: 1920, height: 1080 },
      fetchWindowIcons: false,
    });
  } catch (e: any) {
    return "Failed to enumerate windows: " + (e?.message || String(e));
  }

  // 过滤掉无标题和自身（UE Coworker）窗口。
  var visible = sources.filter(function (s: any) {
    var name = String(s.name || "").trim();
    return name.length > 0;
  });

  if (visible.length === 0) {
    return "No visible windows found.";
  }

  var title = args.title ? String(args.title).trim() : "";

  // 不传 title → 列出所有窗口供模型选择。
  if (!title) {
    var lines: string[] = ["Found " + visible.length + " visible window(s):"];
    for (var i = 0; i < visible.length; i++) {
      lines.push((i + 1) + ". " + visible[i].name);
    }
    lines.push(LF + "Call capture_window with `title` set to a keyword from the list above to take a screenshot.");
    return lines.join(LF);
  }

  // 模糊匹配标题（不区分大小写、子串匹配）。
  var keyword = title.toLowerCase();
  var matched = visible.filter(function (s: any) {
    return String(s.name || "").toLowerCase().indexOf(keyword) !== -1;
  });

  if (matched.length === 0) {
    var hint = visible.map(function (s: any, i: number) {
      return (i + 1) + ". " + s.name;
    }).join(LF);
    return "No window matching '" + title + "'. Available windows:" + LF + hint;
  }

  // 取第一个匹配的窗口截图。
  var target = matched[0];
  var thumbnail = target.thumbnail;
  if (!thumbnail || thumbnail.isEmpty()) {
    return "Window '" + target.name + "' found but its thumbnail is empty (it may be minimized). Try restoring the window first.";
  }

  // 保存截图到系统临时目录。
  var dir = join(tmpdir(), "ue-coworker-screenshots");
  if (!exists(dir)) mkdirSync(dir, { recursive: true });
  var fileName = "capture-" + Date.now() + "-" + Math.floor(Math.random() * 1e6) + ".png";
  var filePath = join(dir, fileName);
  var pngBuf = thumbnail.toPNG();
  writeFileSync(filePath, pngBuf);

  // 把截图字节交给 agent-loop 的图片回灌通道(若存在)。落盘文件用于 UI 显示,
  // 这里的 base64 用于发给视觉模型;缩放在 agent-loop 侧统一做。
  if (ctx && ctx.collectImages) {
    try { ctx.collectImages([{ mime: "image/png", base64: pngBuf.toString("base64") }]); } catch {}
  }

  var size = thumbnail.getSize();
  var result: string[] = [];
  result.push("Screenshot captured: " + target.name);
  result.push("Size: " + size.width + "x" + size.height);
  result.push("Saved to: " + filePath);
  if (matched.length > 1) {
    result.push("(" + matched.length + " windows matched; captured the first one: '" + target.name + "')");
  }
  // GENERATED_IMAGE_PATHS 标记，复用 generate_image 的 UI 展示机制。
  result.push("GENERATED_IMAGE_PATHS:" + JSON.stringify([filePath]));
  return result.join(LF);
}

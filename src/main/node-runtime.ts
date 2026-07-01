// 内置 Node.js 运行时定位与命令解析。
//
// 软件随包打了一份 node 发行版（含 node/npm/npx）到 resources/node，用户无需自己
// 安装 Node.js 即可运行 npx/node 型 MCP 服务器。本模块负责：
//  1) 找到内置 node 目录（打包 vs dev）；
//  2) 把 MCP 配置里的 command（npx/node/npm）解析成内置版的绝对路径；
//  3) 给子进程 env.PATH 前置内置 node 目录，使服务器内部再 spawn node 也命中内置版。
//
// dev 时 resources/node 可能不存在（未下载），此时回退系统 PATH（保持开发便利）。

import { app } from "electron";
import { join } from "path";
import { existsSync } from "fs";

// 内置 node 目录：打包后在 process.resourcesPath/node；dev 在项目 resources/node。
function nodeDir(): string | null {
  const candidates = app.isPackaged
    ? [join(process.resourcesPath, "node")]
    : [join(__dirname, "../../resources/node")];
  for (const d of candidates) {
    if (existsSync(join(d, "node.exe")) || existsSync(join(d, "node"))) return d;
  }
  return null;
}

let _cached: string | null | undefined;
function getNodeDir(): string | null {
  if (_cached === undefined) _cached = nodeDir();
  return _cached;
}

// 内置 node 是否可用。
export function hasBundledNode(): boolean {
  return !!getNodeDir();
}

// 把一个命令名解析到内置 node 目录里的可执行文件（绝对路径）。
// 支持 node / npm / npx（Windows 用 .cmd 包装）。无法解析或无内置 node 时返回原值。
export function resolveCommand(command: string): string {
  const dir = getNodeDir();
  if (!dir || !command) return command;
  const isWin = process.platform === "win32";
  // 取基名（可能用户填了带路径的，不动它）。
  const base = command.trim();
  if (base === "node") {
    const p = join(dir, isWin ? "node.exe" : "bin/node");
    return existsSync(p) ? p : command;
  }
  if (base === "npm" || base === "npx") {
    // Windows 发行版根目录有 npm.cmd / npx.cmd；类 unix 在 bin/ 下。
    const p = isWin ? join(dir, base + ".cmd") : join(dir, "bin", base);
    return existsSync(p) ? p : command;
  }
  return command;
}

// 给一份 env 的 PATH 前置内置 node 目录（及其 bin 子目录），使被 spawn 的服务器进程
// 内部再调用 node/npm 时也命中内置版。返回新的 PATH 值（无内置 node 时原样返回）。
export function augmentPath(env: Record<string, string>): Record<string, string> {
  const dir = getNodeDir();
  if (!dir) return env;
  const isWin = process.platform === "win32";
  const sep = isWin ? ";" : ":";
  // Windows：node.exe/npm.cmd 在根目录；unix：在 bin/。
  const extra = isWin ? dir : join(dir, "bin");
  // PATH 的键在 Windows 上大小写不敏感，统一找现有键名。
  const key = Object.keys(env).find((k) => k.toLowerCase() === "path") || "PATH";
  const cur = env[key] || "";
  return { ...env, [key]: extra + sep + cur };
}

// 文件/文件夹图标解析：封装 vscode-material-icons（VS Code Material Icon Theme），
// 把文件名/文件夹名映射到对应的彩色 SVG 图标 URL。SVG 由 Vite 内联插件以
// /material-icons/<name>.svg 形式提供（见 electron.vite.config.ts）。
// 不自写映射表——映射全交给库。

import {
  getIconForFilePath,
  getIconForDirectoryPath,
  getIconUrlByName,
  isMaterialIconName,
} from "vscode-material-icons";

// dev：Vite 中间件以同源根路径 /material-icons 提供 SVG（走 http://localhost）。
// prod：打包后页面经 file:// 加载 index.html，根绝对路径会被解析到盘符根而 404，
// 必须用相对 index.html 的 ./material-icons（SVG 已复制进 out/renderer/material-icons）。
export const ICONS_URL = import.meta.env.DEV ? "/material-icons" : "./material-icons";

// 文件名 → 图标 URL（含 package.json / tsconfig.json / Dockerfile 等特殊文件）。
export function fileIconUrl(name: string): string {
  const icon = getIconForFilePath(name);
  return getIconUrlByName(icon, ICONS_URL);
}

// 文件夹名 → 图标 URL。展开时优先用 <base>-open 变体（material 约定每个文件夹
// 图标都有 -open 变体）；不存在则回退基础名。
export function folderIconUrl(name: string, open: boolean): string {
  const base = getIconForDirectoryPath(name);
  if (open) {
    const openName = (base + "-open") as any;
    if (isMaterialIconName(openName)) return getIconUrlByName(openName, ICONS_URL);
  }
  return getIconUrlByName(base, ICONS_URL);
}

// 通用占位图标（新建行内输入时用，尚无真实文件名）。
export function genericIconUrl(isDir: boolean): string {
  return getIconUrlByName(isDir ? ("folder" as any) : ("file" as any), ICONS_URL);
}

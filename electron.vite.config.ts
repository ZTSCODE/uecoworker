import { resolve, dirname, join, normalize } from "path";
import { existsSync, readFileSync, mkdirSync, readdirSync, copyFileSync } from "fs";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";

// 把 vscode-material-icons 的全套 SVG（约 910 个）以同源 /material-icons/<name>.svg
// 形式提供给渲染端：dev 用中间件直接从 node_modules 读，prod 把整目录复制进产物。
// 不引第三方 copy 插件、不把图标提交进仓库、不裁剪子集。
function materialIconsPlugin(): Plugin {
  const URL_PREFIX = "/material-icons/";
  // 定位 vscode-material-icons 的 generated/icons。优先 require.resolve 主入口向上
  // 找；失败则直接拼项目 node_modules 路径（config 编译后 require 上下文可能漂移）。
  let iconsDir = "";
  const tryDir = (start: string) => {
    let dir = start;
    for (let i = 0; i < 6; i++) {
      const cand = join(dir, "generated", "icons");
      if (existsSync(cand)) return cand;
      dir = dirname(dir);
    }
    return "";
  };
  try {
    iconsDir = tryDir(dirname(require.resolve("vscode-material-icons")));
  } catch { /* fall through */ }
  if (!iconsDir) {
    const direct = resolve(__dirname, "node_modules", "vscode-material-icons", "generated", "icons");
    if (existsSync(direct)) iconsDir = direct;
  }

  return {
    name: "ue-coworker-material-icons",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url || "").split("?")[0];
        if (url.indexOf(URL_PREFIX) === -1) return next();
        // 仅允许简单文件名，防目录穿越。
        const name = url.slice(url.indexOf(URL_PREFIX) + URL_PREFIX.length);
        if (!/^[a-zA-Z0-9._-]+\.svg$/.test(name) || !iconsDir) {
          res.statusCode = 404; res.end(); return;
        }
        const file = join(iconsDir, name);
        if (!existsSync(file)) { res.statusCode = 404; res.end(); return; }
        res.setHeader("Content-Type", "image/svg+xml");
        res.setHeader("Cache-Control", "max-age=86400");
        res.end(readFileSync(file));
      });
    },
    closeBundle() {
      // 仅在 renderer 构建产物存在时复制（main/preload 构建不触发）。
      if (!iconsDir || !existsSync(iconsDir)) return;
      const outDir = resolve(__dirname, "out", "renderer", "material-icons");
      const rendererIndex = resolve(__dirname, "out", "renderer", "index.html");
      if (!existsSync(rendererIndex)) return; // 不是 renderer 阶段
      try {
        mkdirSync(outDir, { recursive: true });
        for (const f of readdirSync(iconsDir)) {
          if (!f.endsWith(".svg")) continue;
          copyFileSync(join(iconsDir, f), join(outDir, normalize(f)));
        }
      } catch { /* 复制失败不阻断构建 */ }
    },
  };
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        // 多入口：主进程 index + relay 网关子进程(utilityProcess 单独 bundle)。
        // 网关跑在独立子进程里，与主进程经 parentPort 通信；discord.js/grammy 等
        // bot 库只在网关入口被打包，不进主进程包，避免拖累主进程 event loop。
        input: {
          index: resolve(__dirname, "src/main/index.ts"),
          "relay-gateway": resolve(__dirname, "src/main/relay/gateway.ts")
        },
        external: ["node-pty"],
        output: {
          entryFileNames: "[name].js"
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    resolve: {
      alias: {
        "@": resolve("src/renderer/src")
      }
    },
    plugins: [react(), materialIconsPlugin()]
  }
});

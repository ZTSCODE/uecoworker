import { watch, FSWatcher } from "fs";

type WatchCallback = (type: "add" | "change" | "delete", path: string) => void;

// 忽略目录：这些目录下的变动对用户无意义，却在 npm install / 构建 / git 操作时
// 产生海量事件（每个文件一个 debounce timer + 一次 IPC），会瞬时打爆主进程与渲染层。
// 与 fs:listProjectFiles / tools 的 WALK_SKIP 集合保持一致。
const WATCH_SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "out", ".cache", ".next", "build", "coverage", ".turbo",
]);

// recursive 监听下 filename 是「相对被监听根」的路径；若其任一路径段命中忽略集合，
// 则丢弃该事件。用正反斜杠都切一遍（Windows 上 fs.watch 给的是平台分隔符）。
function isIgnoredPath(filename: string): boolean {
  const segs = filename.split(/[\\/]/);
  for (const s of segs) if (s && WATCH_SKIP_DIRS.has(s)) return true;
  return false;
}

export class FileWatcher {
  private watchers: Map<string, FSWatcher> = new Map();
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();

  watch(dirPath: string, callback: WatchCallback): void {
    if (this.watchers.has(dirPath)) return;

    const watcher = watch(dirPath, { recursive: true }, (eventType, filename) => {
      if (!filename) return;
      // 忽略 node_modules/.git 等目录下的事件（见 WATCH_SKIP_DIRS 注释）。
      if (isIgnoredPath(filename)) return;

      const key = `${eventType}:${filename}`;
      if (this.debounceTimers.has(key)) {
        clearTimeout(this.debounceTimers.get(key));
      }

      this.debounceTimers.set(
        key,
        setTimeout(() => {
          this.debounceTimers.delete(key);
          callback(
            eventType === "rename" ? "delete" : (eventType as "add" | "change"),
            filename
          );
        }, 300)
      );
    });

    watcher.on("error", (err) => {
      console.error(`FileWatcher error on ${dirPath}:`, err);
    });

    this.watchers.set(dirPath, watcher);
  }

  unwatch(dirPath: string): void {
    const watcher = this.watchers.get(dirPath);
    if (watcher) {
      watcher.close();
      this.watchers.delete(dirPath);
    }
  }

  destroyAll(): void {
    for (const watcher of this.watchers.values()) {
      watcher.close();
    }
    this.watchers.clear();
  }
}

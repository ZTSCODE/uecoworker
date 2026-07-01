// 项目信任：集中管理「已信任项目」集合（持久化在 localStorage）。
// 欢迎页、标题栏切项目等所有入口共用，避免信任逻辑各处重复又漏判。
// 信任语义：打开项目后 Agent 可读写其文件、运行命令、执行该项目的 hooks，
// 故首次打开某项目需用户显式确认信任。

const STORAGE_KEY = "ue-coworker-trusted";

function read(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return new Set(JSON.parse(raw));
  } catch {}
  return new Set();
}

function write(set: Set<string>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...set]));
  } catch {}
}

/** 该路径是否已被信任。 */
export function isTrusted(path: string): boolean {
  return read().has(path);
}

/** 把路径加入信任集合（幂等）。 */
export function addTrusted(path: string): void {
  const set = read();
  if (!set.has(path)) {
    set.add(path);
    write(set);
  }
}

/** 当前全部已信任路径（只读快照）。 */
export function trustedSet(): Set<string> {
  return read();
}

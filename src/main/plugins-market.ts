// UE 插件市场:去中心化、零运维。任何人给自己的 Unreal 插件仓库打上约定 topic
// `ue-coworker-plugin`,即自助上架——本市场用 GitHub Search API 实时拉取这些仓库,
// 一键把插件下载并安装到「当前工程」的 Plugins/<插件名>/ 下。
//
// 设计要点:
//  1) 发现:GitHub Search Repositories API(匿名 10 次/分),q=topic:ue-coworker-plugin,
//     按 stars 排序。整体缓存 10 分钟,搜索/分页在本地做(同 skills-market 思路)。
//  2) 兜底:内置精选仓库,API 全挂/限流时仍可用,也保证刚发布时市场不空。
//  3) 下载:用 GitHub 官方 tarball(codeload tar.gz),Node 内置 zlib 解 gzip + 手写最小
//     tar 解析(按字节读 blob)。这样能正确处理 .uasset/.png 等二进制——绝不能像 skills
//     那样按 UTF-8 文本下载(会损坏二进制)。零新增依赖。
//  4) 安装定位:仓库里含 *.uplugin 的目录即插件目录。优先取最浅层那个 .uplugin 所在目录
//     作为要安装的「插件根」;其名(去扩展名)即安装目录名。原子安装(临时目录 + rename)。

import { join } from "path";
import { mkdir, writeFile, rm, rename, readdir, readFile } from "fs/promises";
import { existsSync } from "fs";
import { gunzipSync } from "zlib";

// 约定 topic:别人给插件仓库打这个 topic 即上架(GitHub topic 必须小写、连字符)。
const MARKET_TOPIC = "ue-coworker-plugin";

// 内置精选仓库(离线兜底 + 保证市场非空)。owner/repo 形式。
const FALLBACK_REPOS: string[] = [];

export interface PluginMarketItem {
  id: string;               // 全局唯一(repo 全名)
  name: string;             // 仓库名(展示用;真实安装目录名以 .uplugin 为准)
  description: string;
  author: string;           // 仓库 owner
  repo: string;             // owner/repo
  repoUrl: string;          // 仓库链接
  branch: string;           // 默认分支
  source: string;           // 来源标签
  stars?: number;
  updatedAt?: string;       // 最近更新时间(ISO)
  topics?: string[];
}

// 「我的插件」:当前工程 Plugins/<dir>/ 下已安装的插件(以含 .uplugin 文件的目录为准)。
export interface InstalledPlugin {
  name: string;             // 安装目录名(= .uplugin 去扩展名)
  dir: string;              // 绝对路径
  friendlyName?: string;    // .uplugin 里的 FriendlyName(若有)
  description?: string;     // .uplugin 里的 Description(若有)
  version?: string;         // .uplugin 里的 VersionName(若有)
}

const UA = { "User-Agent": "UE-Coworker", Accept: "application/vnd.github+json" };

function withTimeout<T>(p: Promise<T>, ms: number, msg: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(msg)), ms);
    p.then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
  });
}

// ---- 最小 tar 解析:输入已解 gzip 的 tar 字节流,产出 [相对路径, 内容字节] 列表 ----
// 仅取普通文件(typeflag '0'/'\0'),支持 GNU/ustar 长名(L 记录与 prefix 字段)。
interface TarEntry { path: string; data: Buffer; }
function parseTar(buf: Buffer): TarEntry[] {
  const out: TarEntry[] = [];
  let offset = 0;
  let longName: string | null = null;
  const readStr = (start: number, len: number): string => {
    let end = start;
    const limit = start + len;
    while (end < limit && buf[end] !== 0) end++;
    return buf.toString("utf-8", start, end);
  };
  while (offset + 512 <= buf.length) {
    // 全零块(>=1 个)表示归档结束。
    let allZero = true;
    for (let i = 0; i < 512; i++) { if (buf[offset + i] !== 0) { allZero = false; break; } }
    if (allZero) break;

    const name = readStr(offset, 100);
    const sizeStr = readStr(offset + 124, 12).trim();
    const size = parseInt(sizeStr, 8) || 0;
    const typeflag = String.fromCharCode(buf[offset + 156] || 0);
    const prefix = readStr(offset + 345, 155);
    offset += 512;

    const dataStart = offset;
    // 数据按 512 对齐。
    offset += Math.ceil(size / 512) * 512;

    if (typeflag === "L") {
      // GNU 长文件名:本条数据即下一条目的真实名字。
      longName = buf.toString("utf-8", dataStart, dataStart + size).replace(/\0+$/, "");
      continue;
    }
    if (typeflag === "K" || typeflag === "x" || typeflag === "g") {
      // 长链接名 / pax 扩展头:跳过(对插件文件无影响)。
      longName = null;
      continue;
    }
    if (typeflag === "0" || typeflag === "\0" || typeflag === "") {
      let full = longName || (prefix ? prefix + "/" + name : name);
      longName = null;
      out.push({ path: full, data: buf.subarray(dataStart, dataStart + size) });
    } else {
      // 目录('5')、符号链接等:忽略。
      longName = null;
    }
  }
  return out;
}

export class PluginsMarket {
  private cache: { at: number; items: PluginMarketItem[] } | null = null;
  private CACHE_MS = 10 * 60 * 1000;
  private byId = new Map<string, PluginMarketItem>();

  /** 搜索:匹配 name/description/author/topics;query 空时返回按 stars 排序的前 N。 */
  async search(query?: string, limit = 80): Promise<PluginMarketItem[]> {
    const all = await this.loadAll();
    const q = (query || "").trim().toLowerCase();
    let rows = all;
    if (q) {
      rows = all.filter((it) =>
        it.name.toLowerCase().indexOf(q) !== -1 ||
        it.description.toLowerCase().indexOf(q) !== -1 ||
        it.author.toLowerCase().indexOf(q) !== -1 ||
        (it.topics || []).some((tp) => tp.toLowerCase().indexOf(q) !== -1));
    }
    rows = rows.slice().sort((a, b) => (b.stars || 0) - (a.stars || 0));
    return rows.slice(0, limit);
  }

  private async loadAll(): Promise<PluginMarketItem[]> {
    if (this.cache && Date.now() - this.cache.at < this.CACHE_MS) return this.cache.items;

    const merged = new Map<string, PluginMarketItem>(); // key: repo(小写)
    const add = (it: PluginMarketItem) => { merged.set(it.repo.toLowerCase(), it); };

    let any = false;
    try { (await this.fromGitHubTopic()).forEach(add); any = true; } catch { /* ignore */ }
    // 主源失败,或主源成功但结果太少时,补上内置精选(去重后展示)。
    if (!any || merged.size === 0) {
      try { (await this.fromFallbackRepos()).forEach(add); } catch { /* ignore */ }
    }

    const items = Array.from(merged.values());
    this.cache = { at: Date.now(), items };
    this.byId = new Map(items.map((it) => [it.id, it]));
    return items;
  }

  // 主源:GitHub Search Repositories,按约定 topic 拉取。
  private async fromGitHubTopic(): Promise<PluginMarketItem[]> {
    const url = "https://api.github.com/search/repositories?q=" +
      encodeURIComponent("topic:" + MARKET_TOPIC) + "&sort=stars&order=desc&per_page=100";
    const res = await withTimeout(fetch(url, { headers: UA }), 20000, "github search timed out");
    if (!res.ok) throw new Error("github search " + res.status);
    const json: any = await res.json();
    const arr: any[] = Array.isArray(json?.items) ? json.items : [];
    const out: PluginMarketItem[] = [];
    for (const r of arr) {
      const repo = String(r?.full_name || "");
      if (!repo) continue;
      out.push({
        id: repo,
        name: String(r.name || repo.split("/")[1] || repo),
        description: String(r.description || ""),
        author: String(r.owner?.login || repo.split("/")[0] || ""),
        repo,
        repoUrl: String(r.html_url || "https://github.com/" + repo),
        branch: String(r.default_branch || "main"),
        source: "github",
        stars: typeof r.stargazers_count === "number" ? r.stargazers_count : undefined,
        updatedAt: typeof r.pushed_at === "string" ? r.pushed_at : undefined,
        topics: Array.isArray(r.topics) ? r.topics : undefined,
      });
    }
    return out;
  }

  // 兜底:内置精选仓库,逐个取仓库元信息。
  private async fromFallbackRepos(): Promise<PluginMarketItem[]> {
    const out: PluginMarketItem[] = [];
    for (const repo of FALLBACK_REPOS) {
      const [owner, name] = repo.split("/");
      if (!owner || !name) continue;
      try {
        const res = await withTimeout(fetch("https://api.github.com/repos/" + repo, { headers: UA }), 12000, "repo meta timed out");
        if (!res.ok) continue;
        const r: any = await res.json();
        out.push({
          id: repo,
          name: String(r.name || name),
          description: String(r.description || ""),
          author: owner,
          repo,
          repoUrl: String(r.html_url || "https://github.com/" + repo),
          branch: String(r.default_branch || "main"),
          source: "featured",
          stars: typeof r.stargazers_count === "number" ? r.stargazers_count : undefined,
          updatedAt: typeof r.pushed_at === "string" ? r.pushed_at : undefined,
          topics: Array.isArray(r.topics) ? r.topics : undefined,
        });
      } catch { /* ignore */ }
    }
    return out;
  }

  /**
   * 安装:把插件仓库下载(tarball)并解压,定位其中的 .uplugin 插件根目录,把该目录全部
   * 文件(含二进制)装到 <projectPath>/Plugins/<插件名>/ 下。原子安装。
   */
  async install(id: string, projectPath?: string): Promise<{ ok: boolean; dir?: string; name?: string; error?: string }> {
    if (!projectPath) return { ok: false, error: "请先打开一个 UE 工程目录" };
    let item = this.byId.get(id);
    if (!item) { await this.loadAll(); item = this.byId.get(id); }
    if (!item) return { ok: false, error: "未找到该插件,请刷新后重试" };

    // 1) 下载 tarball 到内存并解 gzip + 解 tar。
    let entries: TarEntry[];
    try {
      const url = "https://codeload.github.com/" + item.repo + "/tar.gz/refs/heads/" + item.branch;
      const res = await withTimeout(fetch(url, { headers: { "User-Agent": "UE-Coworker" } }), 60000, "tarball download timed out");
      if (!res.ok) return { ok: false, error: "下载失败(" + res.status + ")" + (res.status === 404 ? "——分支不存在?" : "") };
      const gz = Buffer.from(await res.arrayBuffer());
      const tar = gunzipSync(gz);
      entries = parseTar(tar);
    } catch (e: any) {
      return { ok: false, error: "下载/解压失败:" + (e?.message || e) };
    }
    if (entries.length === 0) return { ok: false, error: "仓库为空" };

    // tarball 内所有路径都带一层顶层目录(<repo>-<branch>/...),统一剥掉。
    const stripTop = (p: string): string => {
      const i = p.indexOf("/");
      return i === -1 ? p : p.slice(i + 1);
    };

    // 2) 定位 .uplugin 所在目录:取层级最浅的那个作为插件根。
    let pluginRoot: string | null = null;   // 相对(已剥顶层)的插件根目录,"" 表示仓库根即插件根
    let pluginBase = "";                     // .uplugin 文件名(去扩展名)= 安装目录名
    let bestDepth = Infinity;
    for (const e of entries) {
      const rel = stripTop(e.path);
      if (!rel.toLowerCase().endsWith(".uplugin")) continue;
      const slash = rel.lastIndexOf("/");
      const dir = slash === -1 ? "" : rel.slice(0, slash);
      const depth = dir === "" ? 0 : dir.split("/").length;
      if (depth < bestDepth) {
        bestDepth = depth;
        pluginRoot = dir;
        const fname = slash === -1 ? rel : rel.slice(slash + 1);
        pluginBase = fname.slice(0, -".uplugin".length);
      }
    }
    if (pluginRoot === null || !pluginBase) {
      return { ok: false, error: "该仓库未找到 .uplugin 文件,可能不是 UE 插件" };
    }

    // 3) 收集插件根目录下的全部文件(含二进制)。
    const prefix = pluginRoot === "" ? "" : pluginRoot + "/";
    const files: { rel: string; data: Buffer }[] = [];
    for (const e of entries) {
      const rel = stripTop(e.path);
      if (prefix === "" || rel.startsWith(prefix)) {
        const inner = prefix === "" ? rel : rel.slice(prefix.length);
        if (inner) files.push({ rel: inner, data: e.data });
      }
    }
    if (files.length === 0) return { ok: false, error: "插件目录为空" };

    // 4) 原子安装到 <projectPath>/Plugins/<pluginBase>/。
    const root = join(projectPath, "Plugins");
    const destDir = join(root, pluginBase);
    if (existsSync(destDir)) {
      if (existsSync(join(destDir, pluginBase + ".uplugin"))) {
        return { ok: false, error: "已安装同名插件:" + pluginBase };
      }
      // 残骸(无 .uplugin):清掉重装。
      try { await rm(destDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }

    const tmpDir = join(root, pluginBase + "." + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) + ".tmp");
    try {
      if (!existsSync(root)) await mkdir(root, { recursive: true });
      try { if (existsSync(tmpDir)) await rm(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
      for (const f of files) {
        const outPath = join(tmpDir, f.rel);
        const lastSlash = Math.max(outPath.lastIndexOf("/"), outPath.lastIndexOf("\\"));
        const dir = lastSlash > 0 ? outPath.slice(0, lastSlash) : tmpDir;
        if (dir && !existsSync(dir)) await mkdir(dir, { recursive: true });
        await writeFile(outPath, f.data);
      }
      // 收尾校验:.uplugin 必须落地。
      if (!existsSync(join(tmpDir, pluginBase + ".uplugin"))) throw new Error("下载不完整:缺少 .uplugin");
      if (existsSync(destDir)) {
        if (existsSync(join(destDir, pluginBase + ".uplugin"))) { await rm(tmpDir, { recursive: true, force: true }); return { ok: false, error: "已安装同名插件:" + pluginBase }; }
        await rm(destDir, { recursive: true, force: true });
      }
      await rename(tmpDir, destDir);
    } catch (e: any) {
      try { await rm(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
      return { ok: false, error: "安装失败:" + (e?.message || e) };
    }
    return { ok: true, dir: destDir, name: pluginBase };
  }

  /**
   * 我的插件:扫描 <projectPath>/Plugins/ 下每个含 *.uplugin 的一级子目录,
   * 解析 .uplugin(JSON) 取 FriendlyName/Description/VersionName。失败的目录跳过。
   */
  async listInstalled(projectPath?: string): Promise<InstalledPlugin[]> {
    if (!projectPath) return [];
    const root = join(projectPath, "Plugins");
    if (!existsSync(root)) return [];
    let dirs: string[] = [];
    try {
      const ents = await readdir(root, { withFileTypes: true });
      dirs = ents.filter((e) => e.isDirectory()).map((e) => e.name);
    } catch { return []; }

    const out: InstalledPlugin[] = [];
    for (const name of dirs) {
      const dir = join(root, name);
      // 该目录里的 .uplugin(优先同名,否则取第一个)。
      let upluginFile: string | null = null;
      try {
        const inner = await readdir(dir);
        const same = inner.find((f) => f.toLowerCase() === (name + ".uplugin").toLowerCase());
        upluginFile = same || inner.find((f) => f.toLowerCase().endsWith(".uplugin")) || null;
      } catch { /* ignore */ }
      if (!upluginFile) continue;  // 不是插件目录,跳过

      const item: InstalledPlugin = { name, dir };
      try {
        const raw = await readFile(join(dir, upluginFile), "utf-8");
        const meta: any = JSON.parse(raw);
        if (typeof meta?.FriendlyName === "string") item.friendlyName = meta.FriendlyName;
        if (typeof meta?.Description === "string") item.description = meta.Description;
        if (typeof meta?.VersionName === "string") item.version = meta.VersionName;
      } catch { /* .uplugin 解析失败:仍按目录名展示 */ }
      out.push(item);
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  }

  /** 卸载:删除 <projectPath>/Plugins/<name>/(必须确含 .uplugin,防误删)。 */
  async uninstall(name: string, projectPath?: string): Promise<{ ok: boolean; error?: string }> {
    if (!projectPath) return { ok: false, error: "未打开工程" };
    if (!name || name.indexOf("..") !== -1 || name.indexOf("/") !== -1 || name.indexOf("\\") !== -1) {
      return { ok: false, error: "非法插件名" };
    }
    const dir = join(projectPath, "Plugins", name);
    if (!existsSync(dir)) return { ok: false, error: "插件不存在" };
    // 安全栅:目录里必须有 .uplugin 才删,避免误删非插件目录。
    let hasUplugin = false;
    try { hasUplugin = (await readdir(dir)).some((f) => f.toLowerCase().endsWith(".uplugin")); } catch { /* ignore */ }
    if (!hasUplugin) return { ok: false, error: "该目录不含 .uplugin,拒绝删除" };
    try { await rm(dir, { recursive: true, force: true }); } catch (e: any) {
      return { ok: false, error: "删除失败:" + (e?.message || e) };
    }
    return { ok: true };
  }
}

export const pluginsMarket = new PluginsMarket();

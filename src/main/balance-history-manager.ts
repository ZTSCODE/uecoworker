// 余额历史存储：把每次余额查询的快照 append 到一个 JSONL，供 Analytics 画
// 「余额曲线」。余额是 provider 级、跨项目的，所以存全局（userData），不分项目。
//
// 设计要点：
// - append-only 热路径，单文件，一行一个快照 { providerId, remaining, unit, ts }。
// - 去抖：同一 provider 余额未变化且距上次 < MIN_GAP 时跳过，避免轮询把文件写爆。
//   余额一旦变化（含充值跳升）则立即记一条，保证曲线的台阶/跳变如实。
// - 读取时按 provider 分组、按时间正序返回，并对每个 provider 做点数上限抽样。

import { readFile, writeFile, appendFile, mkdir } from "fs/promises";
import { join } from "path";
import { app } from "electron";
import { existsSync } from "fs";

const LF = String.fromCharCode(10);
const MIN_GAP_MS = 5 * 60 * 1000; // 余额没变时，最短 5 分钟才再记一条。
const MAX_POINTS_PER_PROVIDER = 500; // 单 provider 返回的最大点数（抽样上限）。
// 合理余额区间：小于 -100 或大于 999 视为查询失败/脏数据，既不记录也不计入历史。
const BAL_MIN = -100;
const BAL_MAX = 999;

// 余额是否在合理区间内（区间外当作查询失败，不计入 analytics）。
export function isValidBalance(n: unknown): n is number {
  return typeof n === "number" && !isNaN(n) && n >= BAL_MIN && n <= BAL_MAX;
}

export interface BalanceSnapshot {
  providerId: string;
  remaining: number;
  unit: string;
  ts: number;
}

export class BalanceHistoryManager {
  private file: string;
  // 内存里记每个 provider 最近一条，用于去抖（避免每次都读盘）。
  private last: Record<string, BalanceSnapshot> = {};
  private loaded = false;

  constructor() {
    this.file = join(app.getPath("userData"), "balance-history.jsonl");
  }

  private async ensure(): Promise<void> {
    const dir = app.getPath("userData");
    if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  }

  // 首次访问时把已有快照的「每 provider 最后一条」载入内存，供去抖判断。
  // 顺带把文件里历史遗留的越界脏数据一次性物理剔除（重写文件）。
  private async warm(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    if (!existsSync(this.file)) return;
    try {
      const raw = await readFile(this.file, "utf-8");
      const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
      const kept: string[] = [];
      let dropped = 0;
      for (const l of lines) {
        try {
          const s = JSON.parse(l) as BalanceSnapshot;
          if (!s || !s.providerId) continue;
          // 越界余额 = 历史脏数据，剔除（不入内存、不回写）。
          if (!isValidBalance(s.remaining)) { dropped++; continue; }
          kept.push(l);
          this.last[s.providerId] = s;
        } catch {}
      }
      // 仅当确有脏数据被剔除时才重写文件，避免无谓 IO。
      if (dropped > 0) {
        await this.ensure();
        await writeFile(this.file, kept.length ? kept.join(LF) + LF : "", "utf-8");
      }
    } catch {}
  }

  // 记录一条快照（带去抖）。返回是否实际写入。
  async record(snap: BalanceSnapshot): Promise<boolean> {
    if (!snap || !snap.providerId || typeof snap.remaining !== "number") return false;
    // 越界余额视为查询失败，直接丢弃，不污染历史。
    if (!isValidBalance(snap.remaining)) return false;
    await this.warm();
    const prev = this.last[snap.providerId];
    // 余额相同且距上次过近 → 跳过（防轮询写爆）。余额变化则必记。
    if (prev && prev.remaining === snap.remaining && snap.ts - prev.ts < MIN_GAP_MS) return false;
    await this.ensure();
    await appendFile(this.file, JSON.stringify(snap) + LF, "utf-8");
    this.last[snap.providerId] = snap;
    return true;
  }

  // 读取余额历史，按 provider 分组、时间正序。每组超过上限则均匀抽样（保留首尾）。
  async history(): Promise<Record<string, BalanceSnapshot[]>> {
    if (!existsSync(this.file)) return {};
    let raw = "";
    try { raw = await readFile(this.file, "utf-8"); } catch { return {}; }
    const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
    const byProvider: Record<string, BalanceSnapshot[]> = {};
    for (const l of lines) {
      try {
        const s = JSON.parse(l) as BalanceSnapshot;
        if (!s || !s.providerId) continue;
        // 读取侧再兜一层：越界脏数据不计入历史曲线。
        if (!isValidBalance(s.remaining)) continue;
        (byProvider[s.providerId] = byProvider[s.providerId] || []).push(s);
      } catch {}
    }
    for (const id of Object.keys(byProvider)) {
      const arr = byProvider[id].sort((a, b) => a.ts - b.ts);
      byProvider[id] = sampleKeepEnds(arr, MAX_POINTS_PER_PROVIDER);
    }
    return byProvider;
  }
}

// 均匀抽样到最多 max 个点，始终保留第一个和最后一个。
function sampleKeepEnds(arr: BalanceSnapshot[], max: number): BalanceSnapshot[] {
  if (arr.length <= max) return arr;
  const out: BalanceSnapshot[] = [];
  const step = (arr.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(arr[Math.round(i * step)]);
  return out;
}

export const balanceHistoryManager = new BalanceHistoryManager();

import { useState, useEffect, useMemo } from "react";
import { useAppStore } from "../../stores/app-store";
import { useProviderStore } from "../../stores/provider-store";
import { Zap, Wallet, MessageSquare, ArrowDownToLine, ArrowUpFromLine, Database } from "lucide-react";
import { fmtTokens } from "../../lib/token-count";
import { ProviderIcon } from "../../lib/provider-icon";
import { useT, tr } from "../../lib/i18n";

// Analytics 面板：统计 UE Coworker 自己对话的真实 token 用量（来自每会话累计的
// usageTotals，真实优先/估算兜底），不读 Claude Code CLI 日志。缓存命中来自 API
// 响应里本就返回的 cache 字段（采集零成本）。余额来自 provider 实时查询——这里
// 用「余额」而非「成本」：我们不按单价估算，余额是真实查询值（充值后会跳变）。

interface SessionRow {
  id: string; name: string; model: string; provider: string; createdAt: number;
  promptTokens: number; completionTokens: number; cacheCreate: number; cacheRead: number;
  tokens: number; turns: number; messageCount: number; estimated: boolean;
}
interface ModelRow {
  model: string; provider: string; promptTokens: number; completionTokens: number;
  cacheCreate: number; cacheRead: number; tokens: number; sessions: number; turns: number;
}
interface Analytics {
  totalSessions: number; totalPromptTokens: number; totalCompletionTokens: number;
  totalCacheCreate: number; totalCacheRead: number; totalTokens: number; totalTurns: number;
  cacheHitRate: number; hasEstimated: boolean;
  byModel: ModelRow[]; sessions: SessionRow[];
}

var SLICE_COLORS = ["#3b82f6", "#f59e0b", "#a855f7", "#10b981", "#ef4444", "#06b6d4", "#ec4899", "#84cc16"];

// 时间范围筛选项。
// 导出供全局次级栏(SecondaryBar)复用。
export var RANGES: { value: "today" | "week" | "all"; label: string; labelEn: string }[] = [
  { value: "today", label: "今天", labelEn: "Today" },
  { value: "week", label: "近 7 天", labelEn: "Last 7 days" },
  { value: "all", label: "全部", labelEn: "All" },
];

export function AnalyticsDashboard() {
  var t = useT();
  var projectPath = useAppStore(function (s) { return s.projectPath; });
  var providers = useProviderStore(function (s) { return s.providers; });
  var balances = useProviderStore(function (s) { return s.balances; });
  var refreshAllBalances = useProviderStore(function (s) { return s.refreshAllBalances; });
  var [raw, setRaw] = useState<Analytics | null>(null);
  var [loading, setLoading] = useState(false);
  // 时间范围改由全局 store 持有，顶部次级栏负责切换。
  var range = useAppStore(function (s) { return s.analyticsRange; });
  var [balHistory, setBalHistory] = useState<Record<string, { providerId: string; remaining: number; unit: string; ts: number }[]>>({});

  useEffect(function () {
    if (!projectPath) return;
    setLoading(true);
    (window.api as any).chatsAnalytics?.(projectPath).then(function (a: Analytics) {
      setRaw(a); setLoading(false);
    }).catch(function () { setLoading(false); });
    refreshAllBalances();
    // 余额历史（用于余额曲线）。刷新余额后稍等再读，确保本次快照已落盘。
    var loadHist = function () { (window.api as any).balanceHistory?.().then(function (h: any) { setBalHistory(h || {}); }); };
    loadHist();
    var t = setTimeout(loadHist, 1500);
    return function () { clearTimeout(t); };
  }, [projectPath]);

  // 按时间范围过滤会话，并重新聚合（前端聚合，避免后端多接口）。
  var data = useMemo(function () { return raw ? aggregate(raw, range) : null; }, [raw, range]);

  if (!projectPath) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
        <p>{t("打开一个项目以查看用量分析", "Open a project to view usage analytics")}</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      {/* 顶部留白清开悬浮面板；内容上滚时从面板背后穿过透出，与对话窗口一致。 */}
      <div className="max-w-4xl mx-auto px-6 pb-6 pt-[104px] space-y-6">
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="text-base font-semibold text-foreground">{t("用量统计", "Usage stats")}</h2>
          <span className="text-[11px] text-muted-foreground">{t("本项目内 UE Coworker 对话的真实 token 用量", "Real token usage of UE Coworker chats in this project")}</span>
          {/* 时间范围切换已上移到顶部统一次级栏。 */}
        </div>

        {loading || !data ? (
          <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">{t("加载中…", "Loading…")}</div>
        ) : (
          <>
            {/* 概览卡片 */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <StatCard icon={Zap} label={t("真实消耗 Tokens", "Tokens used")} value={data.totalTokens > 0 ? data.totalTokens.toLocaleString() : "0"}
                sub={data.hasEstimated ? t("含估算", "incl. estimated") : t("真实 usage", "real usage")} />
              <StatCard icon={MessageSquare} label={t("对话 / 轮次", "Chats / turns")} value={data.totalSessions + " / " + data.totalTurns} sub={t("会话数 / 请求轮", "sessions / request turns")} />
              <StatCard icon={ArrowDownToLine} label={t("新增输入", "New input")} value={fmtTokens(data.totalPromptTokens)} sub={t("非缓存输入", "non-cached input")} />
              <StatCard icon={ArrowUpFromLine} label={t("输出", "Output")} value={fmtTokens(data.totalCompletionTokens)} sub={t("生成", "generated")} />
            </div>

            {/* 缓存命中（仅当有缓存数据时显示） */}
            {(data.totalCacheRead > 0 || data.totalCacheCreate > 0) && (
              <div className="rounded-xl border border-border bg-card p-4">
                <div className="flex items-center gap-1.5 mb-3">
                  <Database size={14} className="text-muted-foreground" />
                  <h3 className="text-xs font-medium text-foreground">{t("缓存命中", "Cache hits")}</h3>
                  <span className="ml-auto text-xs text-foreground tabular-nums">{t("命中率 ", "Hit rate ")}{(data.cacheHitRate * 100).toFixed(1)}%</span>
                </div>
                <div className="flex h-2.5 rounded-full overflow-hidden bg-muted mb-2">
                  <div className="bg-violet-500" style={{ width: pct(data.totalCacheRead, data.totalPromptTokens) + "%" }} title={t("缓存命中", "Cache hit")} />
                  <div className="bg-amber-500" style={{ width: pct(data.totalCacheCreate, data.totalPromptTokens) + "%" }} title={t("缓存创建", "Cache write")} />
                  <div className="bg-blue-500" style={{ width: pct(Math.max(0, data.totalPromptTokens - data.totalCacheRead - data.totalCacheCreate), data.totalPromptTokens) + "%" }} title={t("新增输入", "New input")} />
                </div>
                <div className="flex gap-4 text-[11px] text-muted-foreground">
                  <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm bg-violet-500" />{t("命中 ", "Hits ")}{data.totalCacheRead.toLocaleString()}</span>
                  <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm bg-amber-500" />{t("创建 ", "Writes ")}{data.totalCacheCreate.toLocaleString()}</span>
                  <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm bg-blue-500" />{t("新增输入 ", "New input ")}{Math.max(0, data.totalPromptTokens - data.totalCacheRead - data.totalCacheCreate).toLocaleString()}</span>
                </div>
              </div>
            )}

            {/* 余额（真实查询值，非按单价估算的成本） */}
            <BalanceSection providers={providers} balances={balances} />

            {/* 合并趋势图：左轴=余额（按 provider），右轴=token（输入/输出/缓存）。 */}
            <CombinedTrend sessions={data.sessions} history={balHistory} providers={providers} range={range} />

            {/* 按模型表 */}
            {data.byModel.length > 0 && (
              <div className="rounded-xl border border-border bg-card p-4">
                <h3 className="text-xs font-medium text-foreground mb-3">{t("模型统计", "By model")}</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border text-muted-foreground">
                        <th className="text-left py-2 font-medium">{t("模型", "Model")}</th>
                        <th className="text-right py-2 font-medium">{t("对话", "Chats")}</th>
                        <th className="text-right py-2 font-medium">{t("轮次", "Turns")}</th>
                        <th className="text-right py-2 font-medium">{t("输入", "Input")}</th>
                        <th className="text-right py-2 font-medium">{t("输出", "Output")}</th>
                        <th className="text-right py-2 font-medium">{t("缓存命中", "Cache hits")}</th>
                        <th className="text-right py-2 font-medium">Tokens</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.byModel.map(function (m, i) {
                        return (
                          <tr key={i} className="border-b border-border/40">
                            <td className="py-2 font-mono text-[11px] text-foreground/80 truncate max-w-[180px]">{m.model || t("未知", "Unknown")}</td>
                            <td className="py-2 text-right text-foreground/70 tabular-nums">{m.sessions}</td>
                            <td className="py-2 text-right text-foreground/70 tabular-nums">{m.turns}</td>
                            <td className="py-2 text-right text-foreground/70 tabular-nums">{m.promptTokens.toLocaleString()}</td>
                            <td className="py-2 text-right text-foreground/70 tabular-nums">{m.completionTokens.toLocaleString()}</td>
                            <td className="py-2 text-right text-violet-500 tabular-nums">{m.cacheRead > 0 ? m.cacheRead.toLocaleString() : "—"}</td>
                            <td className="py-2 text-right text-foreground tabular-nums">{m.tokens.toLocaleString()}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-border font-medium">
                        <td className="py-2 text-foreground">{t("总计", "Total")}</td>
                        <td className="py-2 text-right text-foreground tabular-nums">{data.totalSessions}</td>
                        <td className="py-2 text-right text-foreground tabular-nums">{data.totalTurns}</td>
                        <td className="py-2 text-right text-foreground tabular-nums">{data.totalPromptTokens.toLocaleString()}</td>
                        <td className="py-2 text-right text-foreground tabular-nums">{data.totalCompletionTokens.toLocaleString()}</td>
                        <td className="py-2 text-right text-violet-500 tabular-nums">{data.totalCacheRead > 0 ? data.totalCacheRead.toLocaleString() : "—"}</td>
                        <td className="py-2 text-right text-foreground tabular-nums">{data.totalTokens.toLocaleString()}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            )}

            {data.sessions.length === 0 && (
              <div className="rounded-xl border border-border bg-card p-6 text-center">
                <p className="text-xs text-muted-foreground">{t("该时间范围内还没有用量数据。开始与 AI 对话后，这里会统计每次的真实 token 消耗。", "No usage data in this time range yet. Once you start chatting with the AI, real token consumption will be tracked here.")}</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// 按时间范围过滤会话并重算总量（纯前端，避免后端多接口）。
function aggregate(raw: Analytics, range: "today" | "week" | "all"): Analytics {
  if (range === "all") return raw;
  var now = Date.now();
  var cutoff = range === "today"
    ? new Date(new Date().toDateString()).getTime() // 今日 0 点
    : now - 7 * 24 * 3600 * 1000;
  var sessions = raw.sessions.filter(function (s) { return s.createdAt >= cutoff; });
  var tp = 0, tc = 0, tcc = 0, tcr = 0, tt = 0, est = false;
  var modelMap: Record<string, ModelRow> = {};
  sessions.forEach(function (s) {
    tp += s.promptTokens; tc += s.completionTokens; tcc += s.cacheCreate; tcr += s.cacheRead; tt += s.turns;
    if (s.estimated) est = true;
    var k = s.provider + "/" + s.model;
    if (!modelMap[k]) modelMap[k] = { model: s.model || "", provider: s.provider, promptTokens: 0, completionTokens: 0, cacheCreate: 0, cacheRead: 0, tokens: 0, sessions: 0, turns: 0 };
    var mm = modelMap[k];
    mm.promptTokens += s.promptTokens; mm.completionTokens += s.completionTokens;
    mm.cacheCreate += s.cacheCreate; mm.cacheRead += s.cacheRead;
    mm.tokens += s.tokens; mm.sessions += 1; mm.turns += s.turns;
  });
  var denom = tp;
  return {
    totalSessions: sessions.length, totalPromptTokens: tp, totalCompletionTokens: tc,
    totalCacheCreate: tcc, totalCacheRead: tcr, totalTokens: tp + tc, totalTurns: tt,
    cacheHitRate: denom > 0 ? tcr / denom : 0, hasEstimated: est,
    byModel: Object.keys(modelMap).map(function (k) { return modelMap[k]; }).sort(function (a, b) { return b.tokens - a.tokens; }),
    sessions: sessions,
  };
}

function pct(part: number, total: number): number { return total > 0 ? (part / total) * 100 : 0; }

// 余额区：各 provider 的真实剩余余额与今日已用（来自 getProviderBalance 实时查询）。
function BalanceSection({ providers, balances }: { providers: any[]; balances: Record<string, any> }) {
  var t = useT();
  var withBalance = providers.filter(function (p) { return balances[p.id]; });
  if (withBalance.length === 0) return null;
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-1.5 mb-3">
        <Wallet size={14} className="text-muted-foreground" />
        <h3 className="text-xs font-medium text-foreground">{t("余额", "Balance")}</h3>
        <span className="text-[10px] text-muted-foreground/50 ml-1">{t("provider 实时查询的真实余额（非按单价估算）", "Real balance queried live from the provider (not estimated by unit price)")}</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {withBalance.map(function (p) {
          var b = balances[p.id];
          return (
            <div key={p.id} className="flex items-center gap-2.5 rounded-lg border border-border/60 px-3 py-2">
              <ProviderIcon name={p.name} size={20} />
              <div className="min-w-0 flex-1">
                <div className="text-xs text-foreground truncate">{p.name}</div>
                <div className="text-[10px] text-muted-foreground/60">
                  {t("余额 ", "Balance ")}{b.unit === "USD" ? "$" : ""}{Number(b.remaining).toLocaleString(undefined, { maximumFractionDigits: 2 })}{b.unit && b.unit !== "USD" ? " " + b.unit : ""}
                </div>
              </div>
              {typeof b.usedToday === "number" && b.usedToday > 0 && (
                <div className="text-right shrink-0">
                  <div className="text-xs text-foreground tabular-nums">-{b.unit === "USD" ? "$" : ""}{Number(b.usedToday).toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
                  <div className="text-[10px] text-muted-foreground/50">{t("今日已用", "Spent today")}</div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// 把时间范围切成等距的桶，返回桶的起点时间数组 + x 轴标签格式化器。
// today → 按小时（0-24 时刻）；week → 近 7 天按天；all → 自首条数据按天（上限 60 桶）。
function makeBuckets(range: "today" | "week" | "all", minTs: number): { starts: number[]; label: (ts: number) => string; title: string } {
  var now = Date.now();
  var DAY = 24 * 3600 * 1000, HOUR = 3600 * 1000;
  if (range === "today") {
    var day0 = new Date(new Date().toDateString()).getTime();
    var starts: number[] = [];
    for (var h = 0; h <= 23; h++) starts.push(day0 + h * HOUR);
    return { starts: starts, title: tr("今天（按小时）", "Today (hourly)"), label: function (ts) { var d = new Date(ts); return d.getHours() + ":00"; } };
  }
  var spanDays = range === "week" ? 7 : Math.min(60, Math.max(1, Math.ceil((now - (minTs || now)) / DAY) + 1));
  var start0 = new Date(new Date(now - (spanDays - 1) * DAY).toDateString()).getTime();
  var arr: number[] = [];
  for (var i = 0; i < spanDays; i++) arr.push(start0 + i * DAY);
  return {
    starts: arr,
    title: range === "week" ? tr("近 7 天（按天）", "Last 7 days (daily)") : tr("全部（按天）", "All (daily)"),
    label: function (ts) { var d = new Date(ts); return (d.getMonth() + 1) + "/" + d.getDate(); },
  };
}

// 把数据点按时间累加进桶。pick 返回该点要累加的值。
function bucketize<T>(items: T[], tsOf: (t: T) => number, valOf: (t: T) => number, starts: number[]): number[] {
  var out = new Array(starts.length).fill(0);
  var bucketSpan = starts.length > 1 ? starts[1] - starts[0] : 1;
  for (var k = 0; k < items.length; k++) {
    var ts = tsOf(items[k]);
    if (ts < starts[0]) continue;
    var idx = Math.floor((ts - starts[0]) / bucketSpan);
    if (idx < 0) idx = 0;
    if (idx >= out.length) idx = out.length - 1;
    out[idx] += valOf(items[k]);
  }
  return out;
}

// 双轴时间序列图：每条线指定 axis（"left"=余额 / "right"=token），两轴各自独立
// 归一化（量纲差很多，必须分轴）。带横轴时间刻度 + 左右轴数值刻度。
function DualAxisChart({ starts, label, series, leftFmt, rightFmt }: {
  starts: number[]; label: (ts: number) => string;
  series: { name: string; color: string; values: number[]; axis: "left" | "right"; dashed?: boolean }[];
  leftFmt: (v: number) => string; rightFmt: (v: number) => string;
}) {
  var W = 720, H = 170, padL = 4, padR = 4, padT = 10, padB = 22;
  var n = starts.length;
  var maxOf = function (axis: "left" | "right") {
    var m = 1;
    series.forEach(function (s) { if (s.axis === axis) s.values.forEach(function (v) { if (v > m) m = v; }); });
    return m;
  };
  var leftMax = maxOf("left"), rightMax = maxOf("right");
  var xAt = function (i: number) { return n <= 1 ? padL : padL + (i / (n - 1)) * (W - padL - padR); };
  var yAt = function (v: number, axis: "left" | "right") {
    var max = axis === "left" ? leftMax : rightMax;
    return padT + (1 - v / max) * (H - padT - padB);
  };
  var pathOf = function (s: { values: number[]; axis: "left" | "right" }) {
    return s.values.map(function (v, i) { return (i === 0 ? "M" : "L") + xAt(i).toFixed(1) + " " + yAt(v, s.axis).toFixed(1); }).join(" ");
  };
  var tickStep = Math.max(1, Math.ceil(n / 8));
  var xticks: number[] = [];
  for (var i = 0; i < n; i += tickStep) xticks.push(i);
  if (n > 1 && xticks[xticks.length - 1] !== n - 1) xticks.push(n - 1);
  var hasLeft = series.some(function (s) { return s.axis === "left"; });
  var hasRight = series.some(function (s) { return s.axis === "right"; });
  // 左右轴各取 3 档刻度（含 0 与 max）。
  var yticks = [0, 0.5, 1];

  return (
    <div className="flex">
      {/* 左轴刻度（余额） */}
      {hasLeft && (
        <div className="flex flex-col justify-between text-[9px] text-muted-foreground/40 pr-1.5 tabular-nums shrink-0" style={{ height: 170, paddingTop: 8, paddingBottom: 22 }}>
          {yticks.slice().reverse().map(function (f, i) { return <span key={i} className="text-right leading-none">{leftFmt(f * leftMax)}</span>; })}
        </div>
      )}
      <svg viewBox={"0 0 " + W + " " + H} className="flex-1 min-w-0" style={{ height: 170 }} preserveAspectRatio="none">
        <line x1={padL} y1={H - padB} x2={W - padR} y2={H - padB} stroke="currentColor" strokeOpacity="0.12" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        {series.map(function (s) {
          return <path key={s.name} d={pathOf(s)} fill="none" stroke={s.color} strokeWidth="1.5"
            strokeDasharray={s.dashed ? "5 3" : undefined}
            strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />;
        })}
        {xticks.map(function (ti) {
          return <text key={ti} x={xAt(ti)} y={H - padB + 14} fontSize="9" fill="currentColor" fillOpacity="0.4"
            textAnchor={ti === 0 ? "start" : ti === n - 1 ? "end" : "middle"}>{label(starts[ti])}</text>;
        })}
      </svg>
      {/* 右轴刻度（token） */}
      {hasRight && (
        <div className="flex flex-col justify-between text-[9px] text-muted-foreground/40 pl-1.5 tabular-nums shrink-0" style={{ height: 170, paddingTop: 8, paddingBottom: 22 }}>
          {yticks.slice().reverse().map(function (f, i) { return <span key={i} className="leading-none">{rightFmt(f * rightMax)}</span>; })}
        </div>
      )}
    </div>
  );
}

// 合并趋势：左轴=余额（按 provider 分线，阶梯保持/充值跳升），右轴=token（输入/
// 输出/缓存命中）。同一时间轴，横轴随 range 变化。
function CombinedTrend({ sessions, history, providers, range }: {
  sessions: SessionRow[];
  history: Record<string, { providerId: string; remaining: number; unit: string; ts: number }[]>;
  providers: any[]; range: "today" | "week" | "all";
}) {
  var t = useT();
  // 时间轴起点：取会话与余额历史里更早的那个，保证两类数据都落在范围内。
  var balIds = Object.keys(history).filter(function (id) { return history[id] && history[id].length > 0; });
  var balTs = balIds.flatMap(function (id) { return history[id].map(function (p) { return p.ts; }); });
  var minTs = Math.min(
    sessions.reduce(function (m, s) { return Math.min(m, s.createdAt); }, Date.now()),
    balTs.length ? Math.min.apply(null, balTs) : Date.now()
  );
  var bk = makeBuckets(range, minTs);
  var bucketSpan = bk.starts.length > 1 ? bk.starts[1] - bk.starts[0] : 1;

  // 右轴：token 三线（按桶累加）。
  var tokenSeries = [
    { name: t("输入", "Input"), color: "#3b82f6", values: bucketize(sessions, function (s) { return s.createdAt; }, function (s) { return s.promptTokens; }, bk.starts), axis: "right" as const },
    { name: t("输出", "Output"), color: "#10b981", values: bucketize(sessions, function (s) { return s.createdAt; }, function (s) { return s.completionTokens; }, bk.starts), axis: "right" as const },
    { name: t("缓存命中", "Cache hits"), color: "#a855f7", values: bucketize(sessions, function (s) { return s.createdAt; }, function (s) { return s.cacheRead; }, bk.starts), axis: "right" as const },
  ].filter(function (s) { return s.values.some(function (v) { return v > 0; }); });

  // 左轴：每个 provider 的余额（阶梯——桶内取最后观测，否则沿用桶前最后值）。
  var balSeries = balIds.map(function (id, i) {
    var pts = history[id].slice().sort(function (a, b) { return a.ts - b.ts; });
    var lastSeen: number | null = null;
    var values = bk.starts.map(function (start) {
      var end = start + bucketSpan;
      var inBucket = pts.filter(function (p) { return p.ts >= start && p.ts < end; });
      if (inBucket.length) lastSeen = inBucket[inBucket.length - 1].remaining;
      else { var before = pts.filter(function (p) { return p.ts < end; }); if (before.length) lastSeen = before[before.length - 1].remaining; }
      return lastSeen == null ? 0 : lastSeen;
    });
    var prov = providers.find(function (p) { return p.id === id; });
    // 余额线用虚线 + 较深色，与 token 实线区分。
    return { name: (prov ? prov.name : id) + t(" 余额", " balance"), color: SLICE_COLORS[(i + 4) % SLICE_COLORS.length], values: values, axis: "left" as const, dashed: true };
  }).filter(function (s) { return s.values.some(function (v) { return v > 0; }); });

  var series = balSeries.concat(tokenSeries as any);
  if (series.length === 0) return null;

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center mb-3 flex-wrap gap-y-1">
        <h3 className="text-xs font-medium text-foreground">{t("使用趋势", "Usage trend")}</h3>
        <span className="text-[10px] text-muted-foreground/50 ml-2">{bk.title}{t(" · 左轴余额 / 右轴 token", " · Left axis balance / right axis tokens")}</span>
        <div className="ml-auto flex items-center gap-3 flex-wrap">
          {series.map(function (s) {
            return <span key={s.name} className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <span className="w-3 h-0.5 rounded" style={{ background: s.color, opacity: s.dashed ? 0.9 : 1 }} />{s.name}</span>;
          })}
        </div>
      </div>
      <DualAxisChart starts={bk.starts} label={bk.label} series={series}
        leftFmt={function (v) { return v >= 1 ? "$" + Math.round(v) : "$" + v.toFixed(1); }}
        rightFmt={function (v) { return fmtTokens(Math.round(v)); }} />
    </div>
  );
}

function StatCard({ icon: Icon, label, value, sub }: { icon: any; label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2 mb-2">
        <Icon size={15} className="text-muted-foreground" />
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
      <div className="text-xl font-semibold text-foreground tabular-nums">{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground/60 mt-0.5">{sub}</div>}
    </div>
  );
}

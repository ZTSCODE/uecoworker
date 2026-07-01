/**
 * 系统桌面通知(Web Notification API,Electron 渲染进程原生支持 → Windows 通知中心)。
 *
 * 设计:仅当窗口失焦(document.hidden / 未聚焦)时弹出——用户正盯着界面就不打扰,
 * 这是 VS Code / Claude Code 的标准行为。点击通知会把窗口拉回前台。
 *
 * 权限:首次调用时申请;用户拒绝则静默降级(不弹,不报错)。可在外观设置里关闭。
 */

const PREF_KEY = "ue-coworker-notify-enabled";

/** 用户是否在设置里启用了系统通知(默认开)。 */
export function notifyEnabled(): boolean {
  return localStorage.getItem(PREF_KEY) !== "off";
}

export function setNotifyEnabled(on: boolean): void {
  localStorage.setItem(PREF_KEY, on ? "on" : "off");
  if (on) ensurePermission();
}

let permissionAsked = false;

/** 申请通知权限(幂等)。返回最终是否可用。 */
export async function ensurePermission(): Promise<boolean> {
  if (typeof Notification === "undefined") return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  if (permissionAsked) return (Notification.permission as string) === "granted";
  permissionAsked = true;
  try {
    const res = await Notification.requestPermission();
    return res === "granted";
  } catch {
    return false;
  }
}

/** 窗口当前是否在前台并聚焦——是则无需打扰。 */
function windowFocused(): boolean {
  return !document.hidden && document.hasFocus();
}

/**
 * 弹一条系统通知。仅在窗口失焦且用户启用时生效。
 * @param title 标题
 * @param body  正文
 * @param tag   去重标签:同 tag 的旧通知会被替换(避免堆叠)。
 * @param onClick 点击通知时的额外动作(在拉回窗口前执行,如切到对应会话)。
 */
export async function systemNotify(title: string, body: string, tag?: string, onClick?: () => void): Promise<void> {
  if (!notifyEnabled()) return;
  if (windowFocused()) return; // 用户正看着,别打扰
  const ok = await ensurePermission();
  if (!ok) return;
  try {
    const n = new Notification(title, { body, tag, silent: false });
    n.onclick = () => {
      // 先执行业务动作(如跳转到对应会话),再把应用窗口拉回前台。
      try { onClick && onClick(); } catch { /* 忽略动作异常,仍要聚焦窗口 */ }
      window.focus();
      try { (window.api as any)?.focusWindow?.(); } catch { /* 可选 IPC,缺失则忽略 */ }
      n.close();
    };
  } catch {
    /* 通知构造失败(权限竞态等)→ 静默 */
  }
}

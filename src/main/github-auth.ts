// GitHub 一键登录（OAuth Device Flow）。
//
// 为什么用 Device Flow：桌面应用无法安全保存 client_secret，Device Flow 正是为
// 「无 secret 的原生客户端」设计——用户在浏览器输一个短码完成授权，软件轮询拿
// access token。流程完全代表「用户自己的」GitHub 账号，token 加密存本地，绝不
// 经过任何第三方服务器。
//
// 轮询骨架参考 relay/weixin/login.ts 的扫码登录状态机。
//
// client_id 是公开值，硬编码进软件、所有用户共用——它只是告诉 GitHub「是哪个应用
// 在请求登录」，不携带任何开发者权限。

import { request as httpsRequest } from "https";
import type { SecretsManager } from "./secrets-manager";

// UE Coworker 的 GitHub OAuth App（Device Flow 已启用）。公开值，可硬编码。
const GITHUB_CLIENT_ID = "Ov23liCbCebPWK6oQnSg";
// 申请的权限范围：repo=读写仓库（push/PR），read:user=读基本资料显示登录名。
const GITHUB_SCOPES = "repo read:user";
// token 在 secrets 里的 id。
export const GITHUB_TOKEN_ID = "__github_oauth_token__";

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

// 发一个 application/x-www-form-urlencoded POST 到 github.com，要求 JSON 回应。
function postForm(host: string, path: string, form: Record<string, string>): Promise<any> {
  const body = Object.keys(form)
    .map((k) => encodeURIComponent(k) + "=" + encodeURIComponent(form[k]))
    .join("&");
  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      {
        host,
        path,
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
          "User-Agent": "UE Coworker",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try { resolve(JSON.parse(data || "{}")); }
          catch { reject(new Error("Bad response from GitHub: " + data.slice(0, 200))); }
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// GET https://api.github.com/user，带 token，取登录名。
function getUser(token: string): Promise<{ login?: string }> {
  return new Promise((resolve) => {
    const req = httpsRequest(
      {
        host: "api.github.com",
        path: "/user",
        method: "GET",
        headers: {
          Authorization: "Bearer " + token,
          Accept: "application/vnd.github+json",
          "User-Agent": "UE Coworker",
        },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try { resolve(JSON.parse(data || "{}")); }
          catch { resolve({}); }
        });
      }
    );
    req.on("error", () => resolve({}));
    req.end();
  });
}

export interface DeviceFlowHandle {
  // 给 UI 显示的：用户码 + 验证网址。
  userCode: string;
  verificationUri: string;
  // 完成（成功/失败/取消）后 resolve。
  done: Promise<{ ok: boolean; login?: string; error?: string }>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class GitHubAuth {
  constructor(private secrets: SecretsManager) {}

  // 是否已登录（本地存了 token）。
  async isAuthed(): Promise<boolean> {
    return this.secrets.hasSecret(GITHUB_TOKEN_ID);
  }

  // 取已存 token（git 鉴权用）。
  async getToken(): Promise<string> {
    return this.secrets.getSecret(GITHUB_TOKEN_ID);
  }

  // 退出登录：删本地 token（不影响 GitHub 端，用户可在 github.com 撤销授权）。
  async logout(): Promise<void> {
    await this.secrets.deleteSecret(GITHUB_TOKEN_ID);
  }

  // 当前登录用户名（已登录时）。
  async currentLogin(): Promise<string> {
    const token = await this.getToken();
    if (!token) return "";
    const u = await getUser(token);
    return u.login || "";
  }

  // 启动 Device Flow。立刻返回 userCode/verificationUri 供 UI 展示；done 在后台
  // 轮询完成后 resolve。abortRef.aborted 置 true 可取消。
  async startDeviceFlow(abortRef: { aborted: boolean }): Promise<DeviceFlowHandle> {
    const dc: DeviceCodeResponse = await postForm("github.com", "/login/device/code", {
      client_id: GITHUB_CLIENT_ID,
      scope: GITHUB_SCOPES,
    });
    if (!dc.device_code || !dc.user_code) {
      throw new Error("GitHub 未返回设备码（设备流可能未在 OAuth App 启用）");
    }

    const done = (async (): Promise<{ ok: boolean; login?: string; error?: string }> => {
      let interval = (dc.interval || 5) * 1000;
      const deadline = Date.now() + (dc.expires_in || 900) * 1000;
      while (Date.now() < deadline) {
        if (abortRef.aborted) return { ok: false, error: "已取消" };
        await sleep(interval);
        if (abortRef.aborted) return { ok: false, error: "已取消" };
        const resp = await postForm("github.com", "/login/oauth/access_token", {
          client_id: GITHUB_CLIENT_ID,
          device_code: dc.device_code,
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        });
        if (resp.access_token) {
          await this.secrets.setSecret(GITHUB_TOKEN_ID, resp.access_token);
          const u = await getUser(resp.access_token);
          return { ok: true, login: u.login };
        }
        // 标准 device flow 错误码：继续等 / 放慢 / 终止。
        switch (resp.error) {
          case "authorization_pending":
            break; // 用户还没授权，继续轮询
          case "slow_down":
            interval += 5000;
            break;
          case "access_denied":
            return { ok: false, error: "用户拒绝了授权" };
          case "expired_token":
            return { ok: false, error: "设备码已过期，请重试" };
          default:
            if (resp.error) return { ok: false, error: resp.error_description || resp.error };
        }
      }
      return { ok: false, error: "授权超时" };
    })();

    return { userCode: dc.user_code, verificationUri: dc.verification_uri, done };
  }
}

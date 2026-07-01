/**
 * RelayAdapter —— 单个平台（Discord / Telegram）的网关适配器契约。
 *
 * 网关子进程为每个上线的平台持有一个 adapter。adapter 负责：
 * - 用 token 上线/下线 bot，上报连接状态（经 host.emit(RelayStatus)）。
 * - 把平台的用户命令翻译成 RelayCommand 上报（经 host.emit）。
 * - 收到主进程的 RelayPrompt 时向用户提问，把答复翻译成 RelayAnswer 上报。
 * - 收到 RelayEmit 时把结果/进度/错误发回对应频道。
 *
 * adapter 不碰任何业务（provider/tool/git）——那些全在主进程 RelayCore。
 */
import type { FromGateway, RelayPrompt, RelayEmit } from "./protocol";

/** adapter 回主进程的统一出口。 */
export interface AdapterHost {
  emit(msg: FromGateway): void;
}

export interface RelayAdapter {
  /** 用 token + 平台配置上线。失败时经 host.emit 上报 status:error。 */
  connect(token: string, config: Record<string, any>): Promise<void>;
  /** 下线，清理连接与挂起的 prompt。 */
  disconnect(): Promise<void>;
  /** 主进程要求向用户提问（按钮 / 自由文本 / 计划审批）。答复经 host.emit(RelayAnswer)。 */
  prompt(req: RelayPrompt): void;
  /** 撤回一张未答的提问（已被其它通道/超时/abort 解决）。 */
  cancelPrompt(promptId: string): void;
  /** 主进程要求把结果/进度/错误/typing 发回某频道。 */
  emit(msg: RelayEmit): void;
}

/**
 * `companionQq` 服务：把 dsh-meme 的 `send_meme` 接到本插件已有的 QQ 连接上。
 *
 * 背景（阿莉拉二开 T-A2）：dsh-meme 的 send_meme 按顺序找三条出海口——
 * `companionQq` 服务、webServer 路由、dsh-im。这台机器只有 NapCat/OneBot，
 * 原先靠独立插件 `dsh-companion-onebot` 自己再开一条 WS 顶上。那条 WS 与本插件
 * 的连接是重复的：同一个 NapCat、同一个 token、同一批聊天，却绕过了本插件的
 * 主动写闸、审计、trace 和离线队列。所以把能力搬进来，复用同一条连接。
 *
 * 契约（dsh-meme 写死的）：
 * - `sendImage(path, caption?)` **同步抛错、同步返回**（dsh-meme 是
 *   `try { sendImage(p); return {ok:true} } catch {...}`，不 await）。所以
 *   能同步判断的失败（没连上 / 不知道发给谁 / 读不到文件 / 超限）照旧抛；
 *   真正的网络发送只能 fire-and-forget，失败写日志。
 * - `isOnline()` 反映连接可用性。
 *
 * 为什么发之前不查媒体栅栏：表情包图库在 profile 目录下，不在 mediaDir 里，
 * 走 `qq_send_image` 那套栅栏会被拒。这里按「工具主动写」的口径直接构造
 * base64 段，仍然经过 outbound 的主动写限流与审计（sendSegments）。
 * @module dsh-onebot/companion
 */
import type { ChatId } from './chat.js';
import type { OutboundSegment } from './outbound.js';
/** What `sendImage` returns on the synchronous happy path. */
export interface CompanionQqSendResult {
    ok: true;
    /** `private:<qq>` / `group:<群号>` —— 便于日志定位发错窗口。 */
    target: ChatId;
}
/** The `companionQq` service surface dsh-meme consumes. */
export interface CompanionQq {
    /** Whether the QQ transport is currently usable. */
    isOnline(): boolean;
    /** Send a local image file as a native QQ image (synchronous contract). */
    sendImage(path: string, caption?: string): CompanionQqSendResult;
    /** Most-recently-active QQ chat, or null (dsh-meme 不读；留给诊断)。 */
    readonly lastChatTarget: string | null;
}
/** Everything the service needs from the plugin (kept as ports for tests). */
export interface CompanionQqDeps {
    /** Transport usability. */
    connected(): boolean;
    /** Session id → its chat (undefined when the session has no QQ chat). */
    chatForSession(sessionId: string): ChatId | undefined;
    /** Most-recently-active chat, fallback when no session is known. */
    mostRecentChat(): ChatId | undefined;
    /** The session id currently running a tool (undefined outside a turn). */
    currentSessionId(): string | undefined;
    /** Send raw segments through the outbound pipeline (write gate + audit). */
    sendSegments(chatId: ChatId, segments: OutboundSegment[]): Promise<string | undefined>;
    /** Per-image size ceiling (base64 grows by 1/3). */
    maxImageBytes: number;
    /** Plugin log port. */
    log(level: 'info' | 'warn' | 'error' | 'debug', message: string): void;
}
/**
 * Build the `companionQq` service.
 * @param deps - plugin ports (see {@link CompanionQqDeps}).
 * @returns the service object to `ctx.provide('companionQq', …)`.
 */
export declare function createCompanionQq(deps: CompanionQqDeps): CompanionQq;

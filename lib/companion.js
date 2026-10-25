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
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describeError } from './errors.js';
/**
 * Build the `companionQq` service.
 * @param deps - plugin ports (see {@link CompanionQqDeps}).
 * @returns the service object to `ctx.provide('companionQq', …)`.
 */
export function createCompanionQq(deps) {
    /** Resolve the target chat: current tool session first, then the busiest chat. */
    function targetChat() {
        const sessionId = deps.currentSessionId();
        if (sessionId !== undefined) {
            const chatId = deps.chatForSession(sessionId);
            if (chatId !== undefined)
                return chatId;
        }
        return deps.mostRecentChat();
    }
    return {
        isOnline() {
            return deps.connected();
        },
        sendImage(path, caption) {
            if (!deps.connected())
                throw new Error('QQ 通道未连接（NapCat 没连上）');
            const target = targetChat();
            if (target === undefined)
                throw new Error('还不知道发给谁：这个 QQ 会话还没来过消息');
            const abs = resolve(String(path));
            let size;
            try {
                size = statSync(abs).size;
            }
            catch {
                throw new Error('读不到图片文件: ' + abs);
            }
            if (size > deps.maxImageBytes) {
                throw new Error('图片 ' + size + ' 字节，超过通道上限 ' + deps.maxImageBytes);
            }
            const file = 'base64://' + readFileSync(abs).toString('base64');
            const segments = [];
            const text = typeof caption === 'string' ? caption.trim() : '';
            if (text !== '')
                segments.push({ type: 'text', data: { text } });
            segments.push({ type: 'image', data: { file } });
            // 同步契约：发送本身只能异步，失败落在日志里（模型侧看到的是「已发送」，
            // 与独立插件的口径一致——那条通道同样没有回执）。
            void deps.sendSegments(target, segments).then(id => deps.log('info', 'companionQq 表情包已发送: ' + target + ' (id ' + (id ?? '?') + ')'), (error) => deps.log('warn', 'companionQq 表情包发送失败: ' + target + ' — ' + describeError(error)));
            return { ok: true, target };
        },
        get lastChatTarget() {
            return deps.mostRecentChat() ?? null;
        },
    };
}

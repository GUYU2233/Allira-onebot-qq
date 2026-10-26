/**
 * Model-facing tools for the OneBot channel: media sends, merged forwards,
 * the whitelisted NapCat API proxy, and group history. Tools infer the target
 * chat from the calling agent's session; an explicit chat_id overrides.
 * @module dsh-onebot/tools
 */
import type { Context } from '@deepseek-ai/cordis';
import type { ChatBridge } from './bridge.js';
import type { OneBotConnection } from './connection.js';
/**
 * Render group history as readable lines. Returning only a count hid every
 * message from the model, which made the tool useless for its stated purpose
 * (summarising group context). Time is rendered in the host's local zone so
 * the model sees the same clock as the rest of its context.
 * @param value - the tool's raw return value (rows from get_group_msg_history).
 * @returns one human-readable block, one line per message.
 */
export declare function renderGroupHistory(value: unknown): string;
/**
 * Register all qq_* tools on the context. Registration is effect-based: the
 * returned disposer unregisters them.
 * @param ctx - plugin context.
 * @param bridge - the chat bridge.
 * @param connection - the OneBot connection.
 * @param limits - media size caps.
 * @returns the disposer.
 */
export declare function registerTools(ctx: Context, bridge: ChatBridge, connection: OneBotConnection, limits: {
    maxImageBytes: number;
    maxVoiceBytes: number;
    maxFileBytes: number;
}): () => void;

/**
 * QQ-side text selection: the `[[qq]]` … `[[/qq]]` block and the
 * `[[qq_silent]]` marker.
 *
 * 背景（阿莉拉二开，T-A1）：模型一条回复同时服务两个界面——Web 要看全文，
 * QQ 只看一小段。约定：把「要发到 QQ 的那段」包进 `[[qq]]`…`[[/qq]]`，
 * 出站时只发段内内容；**没写标记就照旧发全文**。
 *
 * 为什么是「标要发的」而不是「标不要发的」：漏标不会出事——忘了写标记，
 * QQ 收到的就是全文（等于现状）；反过来一旦漏标，可能把不该发的发出去。
 *
 * 语义表（`extractQqBlock` 的唯一真源）：
 * - 没有 `[[qq]]`            → `{ hasBlock: false, body: 原文 }`，全文照发。
 * - 有配对的块               → `{ hasBlock: true, body: 各块内容按序拼接 }`。
 * - 块存在但内容为空         → `{ hasBlock: true, body: '' }` = 静默
 *   （等价 `[[qq_silent]]`：本轮一个字都不发）。
 * - 有 `[[qq]]` 但没闭合     → 不认块，只把裸标记当噪声剥掉、全文照发
 *   （保守：宁可多发，也不把本该留在 Web 的正文误发到 QQ）。
 *
 * 未被识别的裸标记一律从出站文本里剥掉，QQ 永远不会看到 `[[qq]]` 这种字样。
 *
 * 另有一类同类噪声：`[表情: …]`（见 {@link stripMemeMarkers}）。它是 Web 前端的
 * 表情包渲染指令，QQ 这头图由 send_meme 单独发一条图片消息，标记本身留在正文里
 * 就是一行方括号文字。它与 `[[qq]]` 同属「发给谁看」的问题，所以放在同一处。
 * @module dsh-onebot/qqsplit
 */
/** One `[[qq]]`…`[[/qq]]` block (non-greedy, multi-line). */
export declare const QQ_BLOCK_RE: RegExp;
/**
 * The `[表情: 描述]` (optionally `[表情: 描述](url)`) marker emitted by the
 * meme plugin's tool result and echoed by the model into its reply text.
 *
 * 与 `dsh-meme` 前端渲染器的正则同形（`client.js` 的 `MEME_TEXT_RE`，只多认了全角
 * 冒号）：Web 那边它被渲染成图，QQ 这边必须当噪声剥掉——图已经由 send_meme 单独
 * 发出去了。刻意与前端保持同一形状：前端会渲染成图的，我们就剥；前端不认的，
 * 我们也不动（否则可能出现「Web 上是文字、QQ 上被吃掉」的错位）。唯一的例外是
 * 「冒号后只有空白」这种退化写法（`[表情: ]`）：描述必须含至少一个非空白字符，
 * 免得把普通方括号文字误伤掉。
 */
export declare const MEME_MARKER_RE: RegExp;
/**
 * Drop every `[表情: …]` marker from an outbound text.
 *
 * 标记整条剥完后若只剩空白，调用方应视作「正文为空」走既有的不发送分支。
 * @param text - text about to leave for QQ.
 * @returns the text with meme markers removed.
 */
export declare function stripMemeMarkers(text: string): string;
/**
 * The `[[qq_silent]]` marker: the model emits it as the WHOLE reply to decline
 * a group message. Matched only when the trimmed text is exactly the marker,
 * so a reply that merely mentions the word still goes out. Checked on every
 * outbound text (final replies and interims both route through sendToChat).
 */
export declare const SILENT_MARKER_RE: RegExp;
/** Result of {@link extractQqBlock}. */
export interface QqBlockResult {
    /** Whether at least one well-formed `[[qq]]` block was found. */
    hasBlock: boolean;
    /** The text to send to QQ: the blocks' contents when `hasBlock`, else the
     * original text with stray markers stripped. */
    body: string;
}
/**
 * Pick the QQ-side text out of a model reply.
 * @param text - the model-produced text (before Markdown stripping).
 * @returns whether a block was present, and the QQ-side body.
 */
export declare function extractQqBlock(text: string): QqBlockResult;

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
 * @module dsh-onebot/qqsplit
 */

/** One `[[qq]]`…`[[/qq]]` block (non-greedy, multi-line). */
export const QQ_BLOCK_RE = /\[\[qq\]\]([\s\S]*?)\[\[\/qq\]\]/g

/** Any leftover `[[qq]]` / `[[/qq]]` marker (unpaired ones included). */
const QQ_MARKER_RE = /\[\[\/?qq\]\]/g

/**
 * The `[[qq_silent]]` marker: the model emits it as the WHOLE reply to decline
 * a group message. Matched only when the trimmed text is exactly the marker,
 * so a reply that merely mentions the word still goes out. Checked on every
 * outbound text (final replies and interims both route through sendToChat).
 */
export const SILENT_MARKER_RE = /^\s*\[\[qq_silent\]\]\s*$/

/** Result of {@link extractQqBlock}. */
export interface QqBlockResult {
  /** Whether at least one well-formed `[[qq]]` block was found. */
  hasBlock: boolean
  /** The text to send to QQ: the blocks' contents when `hasBlock`, else the
   * original text with stray markers stripped. */
  body: string
}

/**
 * Pick the QQ-side text out of a model reply.
 * @param text - the model-produced text (before Markdown stripping).
 * @returns whether a block was present, and the QQ-side body.
 */
export function extractQqBlock(text: string): QqBlockResult {
  const parts: string[] = []
  let found = 0
  QQ_BLOCK_RE.lastIndex = 0
  let hit: RegExpExecArray | null
  while ((hit = QQ_BLOCK_RE.exec(text)) !== null) {
    found++
    const inner = hit[1].trim()
    if (inner !== '') parts.push(inner)
  }
  if (found === 0) {
    // No well-formed block: pass the text through, minus any stray marker.
    return { hasBlock: false, body: text.replace(QQ_MARKER_RE, '') }
  }
  // A block was found. An empty block yields an empty body on purpose —
  // that is the "don't say anything on QQ" spelling (see the module doc).
  return { hasBlock: true, body: parts.join('\n\n').trim() }
}

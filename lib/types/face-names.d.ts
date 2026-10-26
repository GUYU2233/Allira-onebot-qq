/**
 * QQ 系统表情 id → 中文名。
 *
 * 生成来源：NapCatQQ `packages/napcat-core/external/face_config.json` 的
 * `sysface[].QSid / QDes`（该文件随 NapCat 一起发布，跟当前 QQ 版本对齐）。
 * 重新生成：`node scripts/gen-face-names.mjs <face_config.json 路径>`
 *
 * 为什么不用 emoji 表：以前这里是手写的「id → emoji」，跟 QQ 真实编号对不上
 * —— 例：319 是 /比心，旧表写成 🦌；0 是 /惊讶，旧表写成 😀。模型于是把
 * 「比心」读成「鹿」。名字是 NapCat 给的原文，不会再猜错。
 */
export declare const FACE_NAMES: Record<string, string>;
/**
 * 一个 face 段的展示文本。
 *
 * `rawText` 是 NapCat 在 face 段里附带的 `raw.faceText`（形如 `/比心`），
 * 有它就用它——那是 QQ 自己给的名字，比我们的表更可信；没有才回退到
 * FACE_NAMES。非数字 id（emoji 型 face）原样返回，未知 id 给中性占位。
 */
export declare function faceToText(id: string, rawText?: string): string;

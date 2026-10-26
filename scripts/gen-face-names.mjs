#!/usr/bin/env node
// 重新生成 src/face-names.ts 的 FACE_NAMES 表。
//
//   node scripts/gen-face-names.mjs <face_config.json> [输出路径]
//
// face_config.json 来自 NapCatQQ 仓库
// packages/napcat-core/external/face_config.json —— 它随 NapCat 一起发布，
// 跟当前 QQ 版本的表情编号对齐；换 QQ 版本后重跑一次即可。
import { readFileSync, writeFileSync } from 'node:fs'

const src = process.argv[2]
if (!src) {
  console.error('用法: node scripts/gen-face-names.mjs <face_config.json> [输出路径]')
  process.exit(1)
}
const out = process.argv[3] ?? new URL('../src/face-names.ts', import.meta.url)

const cfg = JSON.parse(readFileSync(src, 'utf8'))
const rows = []
for (const f of cfg.sysface ?? []) {
  const id = f?.QSid
  const des = f?.QDes
  if (id === undefined || id === null || typeof des !== 'string' || des === '') continue
  rows.push([String(id), des.replace(/^\//, '')])
}
rows.sort((a, b) => {
  const num = s => (/^[0-9]+$/.test(s) ? Number(s) : Number.MAX_SAFE_INTEGER)
  return num(a[0]) - num(b[0]) || a[0].localeCompare(b[0])
})

const header = [
  '/**',
  ' * QQ 系统表情 id → 中文名。',
  ' *',
  ' * 生成来源：NapCatQQ `packages/napcat-core/external/face_config.json` 的',
  ' * `sysface[].QSid / QDes`（该文件随 NapCat 一起发布，跟当前 QQ 版本对齐）。',
  ' * 重新生成：`node scripts/gen-face-names.mjs <face_config.json 路径>`',
  ' *',
  ' * 为什么不用 emoji 表：以前这里是手写的「id → emoji」，跟 QQ 真实编号对不上',
  ' * —— 例：319 是 /比心，旧表写成 🦌；0 是 /惊讶，旧表写成 😀。模型于是把',
  ' * 「比心」读成「鹿」。名字是 NapCat 给的原文，不会再猜错。',
  ' */',
  'export const FACE_NAMES: Record<string, string> = {',
]

const lines = [header.join('\n')]
let buf = []
for (const [id, name] of rows) {
  buf.push("  '" + id + "': '" + name.replace(/'/g, "\'") + "',")
  if (buf.length === 6) {
    lines.push(buf.join(' '))
    buf = []
  }
}
if (buf.length > 0) lines.push(buf.join(' '))
lines.push('}')
lines.push('')
lines.push('/**')
lines.push(' * 一个 face 段的展示文本。')
lines.push(' *')
lines.push(' * `rawText` 是 NapCat 在 face 段里附带的 `raw.faceText`（形如 `/比心`），')
lines.push(' * 有它就用它——那是 QQ 自己给的名字，比我们的表更可信；没有才回退到')
lines.push(' * FACE_NAMES。非数字 id（emoji 型 face）原样返回，未知 id 给中性占位。')
lines.push(' */')
lines.push('export function faceToText(id: string, rawText?: string): string {')
lines.push("  if (typeof rawText === 'string' && rawText !== '') {")
lines.push("    const name = rawText.startsWith('/') ? rawText.slice(1) : rawText")
lines.push("    if (name !== '') return '[QQ表情:' + name + ']'")
lines.push('  }')
lines.push("  if (id === '') return '[QQ表情]'")
lines.push('  if (!/^[0-9]+$/.test(id)) return id')
lines.push('  const name = FACE_NAMES[id]')
lines.push("  return name !== undefined ? '[QQ表情:' + name + ']' : '[QQ表情:未知' + id + ']'")
lines.push('}')

writeFileSync(out, lines.join('\n') + '\n', 'utf8')
console.log('生成 ' + rows.length + ' 条 → ' + String(out))

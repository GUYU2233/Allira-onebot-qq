#!/usr/bin/env node
/**
 * 让 dsh-meme 的 send_meme 在「companionQq 迟到」时也能切到 QQ 通道。
 *
 * 为什么需要这个脚本
 * ------------------
 * dsh-meme 0.1.60 的 apply 里，如果那一刻还拿不到 companionQq（本插件比它晚
 * apply，或服务还没可见），它就按 Web 模式注册 send_meme（没有 action/path
 * 参数），之后收到 `companionQq/available` 时**直接再注册一遍**——同名工具
 * 注册会抛错，结果 QQ 通道永远上不去，表情包只能留在 Web。
 *
 * 补丁做三件事（都在 dsh-meme 的 index.js / memes.js 里）：
 *   1. memes.js: registerSendMemeTool 交出 ctx.tools.register(...) 的 disposer；
 *   2. index.js: 记住首次注册的 disposer；
 *   3. index.js: 迟到的 register() 先 dispose 旧工具，再按 QQ 通道重注册。
 *
 * 幂等：已经有补丁标记就跳过。dsh-meme 升级后（文件被覆盖）下次运行会自动
 * 重打；锚点对不上（上游改了结构）就报错退出，绝不写坏文件。
 *
 * 用法：node ensure-dsh-meme-qq.mjs [profileDir]
 *   默认 profileDir = %USERPROFILE%\.dsh\profiles\desktop
 */
import { existsSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const MARK = 'memeToolDisposer'
const profileDir = process.argv[2] || join(homedir(), '.dsh', 'profiles', 'desktop')
const pkgDir = join(profileDir, 'node_modules', 'dsh-meme')
const indexFile = join(pkgDir, 'index.js')
const memesFile = join(pkgDir, 'memes.js')
const markerFile = join(pkgDir, '.allira-late-qq.json')

function fail(message) {
  console.error('[ensure-dsh-meme-qq] ' + message)
  process.exit(1)
}

if (!existsSync(indexFile) || !existsSync(memesFile)) {
  fail('找不到 dsh-meme：' + pkgDir + '（profile 路径不对，或还没装）')
}

const version = (() => {
  try {
    return String(JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')).version || '')
  } catch {
    return ''
  }
})()

const read = (file) => readFileSync(file, 'utf8')
const indexSrc = read(indexFile)
const memesSrc = read(memesFile)

if (indexSrc.includes(MARK) && memesSrc.includes('return ctx.tools.register(defineTool(')) {
  console.log(`[ensure-dsh-meme-qq] 已是最新（dsh-meme ${version}），无需处理`)
  process.exit(0)
}

/** 统一成 LF 干活，最后按原文件的换行风格写回。 */
const toLf = (s) => s.replace(/\r\n/g, '\n')
const newlineOf = (s) => (s.includes('\r\n') ? '\r\n' : '\n')

function replaceOnce(src, from, to, label) {
  const at = src.indexOf(from)
  if (at < 0) fail(`锚点对不上（${label}）——dsh-meme ${version} 可能改了结构，已放弃，文件未改动`)
  if (src.indexOf(from, at + 1) >= 0) fail(`锚点重复（${label}）——已放弃，文件未改动`)
  return src.slice(0, at) + to + src.slice(at + from.length)
}

let index = toLf(indexSrc)
let memes = toLf(memesSrc)

// ---- memes.js：交出 disposer ----
memes = replaceOnce(
  memes,
  "  ctx.tools.register(defineTool({\n    name: 'send_meme',",
  "  return ctx.tools.register(defineTool({\n    name: 'send_meme',",
  'memes.js registerSendMemeTool',
)

// ---- index.js：记住 disposer ----
index = replaceOnce(
  index,
  '  const qq = ctx.get(\'companionQq\')\n',
  '  /** 已注册的 send_meme 工具的 disposer：迟到的 QQ 通道要换了它重注册。 */\n'
  + '  let memeToolDisposer = null\n'
  + '  const qq = ctx.get(\'companionQq\')\n',
  'index.js disposer 声明',
)

// ---- index.js：首次注册时记下来 ----
index = replaceOnce(
  index,
  '      registerSendMemeTool(ctx, sampler, sendImage, urlPrefix, imToolOptions())\n',
  '      memeToolDisposer = registerSendMemeTool(ctx, sampler, sendImage, urlPrefix, imToolOptions()) ?? null\n',
  'index.js 首次注册',
)

// ---- index.js：迟到的 register() 先拆旧再重注册 ----
index = replaceOnce(
  index,
  '  const register = () => {\n'
  + '    if (sendImage || urlPrefix) return\n'
  + '    const qqNow = ctx.get(\'companionQq\')\n'
  + '    if (qqNow !== undefined && typeof qqNow.sendImage === \'function\') {\n'
  + '      registerSendMemeTool(ctx, sampler, (path, caption) => qqNow.sendImage(path, caption), urlPrefix, imToolOptions())\n'
  + '    }\n'
  + '  }\n',
  '  const register = () => {\n'
  + '    if (sendImage) return\n'
  + '    const qqNow = ctx.get(\'companionQq\')\n'
  + '    if (qqNow === undefined || typeof qqNow.sendImage !== \'function\') return\n'
  + '    // 本插件比 companion 先 apply 时，工具已经按 Web/IM 模式注册过了；等\n'
  + '    // companionQq/available 到了就换掉它重注册（工具的 path/action 参数只有\n'
  + '    // QQ 通道才有）。注册器返回 disposer，先撤旧的再注册新的。\n'
  + '    try {\n'
  + '      if (typeof memeToolDisposer === \'function\') memeToolDisposer()\n'
  + '    } catch { /* 旧工具已经没了就算了 */ }\n'
  + '    memeToolDisposer = registerSendMemeTool(\n'
  + '      ctx, sampler, (path, caption) => qqNow.sendImage(path, caption), urlPrefix, imToolOptions(),\n'
  + '    ) ?? null\n'
  + '    console.log(\'[dsh-expression] companionQq 迟到，send_meme 已切到 QQ 通道\')\n'
  + '  }\n',
  'index.js 迟到重注册',
)

// ---- 落盘（先备份当前版本，备份名带版本号）----
const stamp = version || 'unknown'
for (const [file, backup] of [[indexFile, `.bak-${stamp}`], [memesFile, `.bak-${stamp}`]]) {
  const target = file + backup
  if (!existsSync(target)) copyFileSync(file, target)
}
writeFileSync(indexFile, index.replace(/\n/g, newlineOf(indexSrc)), 'utf8')
writeFileSync(memesFile, memes.replace(/\n/g, newlineOf(memesSrc)), 'utf8')
writeFileSync(markerFile, JSON.stringify({ version, patchedAt: new Date().toISOString() }, null, 2) + '\n', 'utf8')
console.log(`[ensure-dsh-meme-qq] 已给 dsh-meme ${stamp} 打上「迟到 QQ 通道」补丁`)

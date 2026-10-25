/**
 * 本插件发出的自定义 cordis 事件（宿主 core 的 Events 接口里没有，靠模块
 * 增补登记，否则 `ctx.emit('companionQq/available')` 过不了类型检查）。
 *
 * 顶部的 import 不能删：有它这个文件才算模块，`declare module` 才是「增补
 * 已有模块」而不是「再声明一个同名模块」。
 */
import type {} from '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * `companionQq` 服务已挂载。dsh-meme 在自己的 apply 里先 `ctx.get`，拿不到
     * 就监听本事件补注册（见 dsh-meme/index.js 的 `ctx.on('companionQq/available', register)`）。
     */
    'companionQq/available'(): void
  }
}

/**
 * Vitest 配置 —— 只做一件事：把外部拿不到的宿主 peer 包 `@deepseek-ai/dsh-sandbox`
 * 指到 tests/stubs/dsh-sandbox.ts。
 *
 * 背景见 tests/stubs/dsh-sandbox.ts 的文件头：宿主把沙箱相关包打进了 app.asar，
 * 插件仓库的 node_modules 里没有，`@deepseek-ai/dsh-tools` 的顶层 import 会让
 * vitest 在收集阶段就崩掉。桩只供模块图加载，测试不碰沙箱语义。
 */
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const sandboxStub = fileURLToPath(new URL('./tests/stubs/dsh-sandbox.ts', import.meta.url))

export default defineConfig({
  resolve: {
    alias: [
      // 精确匹配包名（含可能的子路径导入），别误伤 @deepseek-ai/dsh-sandbox-xxx。
      { find: /^@deepseek-ai\/dsh-sandbox$/, replacement: sandboxStub },
    ],
  },
  test: {
    // 既有用例有 60s 的超时预算，保持默认池即可。
    testTimeout: 60_000,
    server: {
      deps: {
        // node_modules 里的依赖默认被外部化（直接交给 Node 解析），alias 就不会
        // 生效。把 dsh-tools 拉进 vite 的模块图，才能让上面的 alias 命中它的
        // 顶层 import。
        inline: [/@deepseek-ai[\\/]dsh-tools/],
      },
    },
  },
})

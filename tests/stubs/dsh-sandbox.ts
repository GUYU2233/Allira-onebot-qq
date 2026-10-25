/**
 * 测试用 `@deepseek-ai/dsh-sandbox` 桩。
 *
 * 为什么需要：`@deepseek-ai/dsh-tools` 在模块顶层 `import { ESCALATION_TARGETS,
 * approveEscalation, validateEscalationArgs } from '@deepseek-ai/dsh-sandbox'`，
 * 但本仓库的 node_modules 里只有宿主 link 进来的部分 @deepseek-ai 包，沙箱那几个
 * （dsh-sandbox / dsh-sandbox-policy / dsh-working-directory / dsh-ptc-runtime）
 * 在宿主 app.asar 内、外部仓库拿不到。于是 vitest 连收集阶段都过不去。
 *
 * 出站/分流测试完全不触碰沙箱升级路径，所以这里给出签名正确的最小小桩，
 * 只为了让模块图能加载。**不要**把这个桩当成沙箱语义的参考实现。
 * 接到真包之后可以删掉本文件与 vitest.config.ts 里的 alias。
 * @module dsh-onebot/tests/stubs/dsh-sandbox
 */

export const ESCALATION_TARGETS = ['workspace-write', 'danger-full-access'] as const

export function approveEscalation(): never {
  throw new Error('dsh-sandbox stub：测试环境不支持权限升级')
}

export function validateEscalationArgs(): never {
  throw new Error('dsh-sandbox stub：测试环境不支持权限升级')
}

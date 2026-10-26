/**
 * qq_progress (阿莉拉二开 T-A3): 执行途中的进度播报。
 *
 * 这个工具的全部意义是「不等回合结束就说一句」，所以测试盯三件事：
 * ①真的从当前会话解析出目标 chat 并立刻发出去（不排队、不进 interim 链路）；
 * ②与最终回复同口径（Markdown 剥壳、[[qq]]/表情标记等出站规则照走）；
 * ③发不出去时**如实报告而不是抛错** —— 一次进度失败不该打断整条长任务。
 */
import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'

import { ChatBridge } from '../src/bridge.js'
import { registerTools } from '../src/tools.js'

interface Tool {
  name: string
  execute: (args: unknown, exec: unknown) => Promise<unknown>
  output?: { render?: (args: unknown, value: unknown) => Array<{ type: string; text: string }> }
}

/** Real ChatBridge + registered tools; the connection is a recording stub. */
async function makeHarness(opts: { connected?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'progress-'))
  const mediaDir = join(root, 'media')
  const workspace = join(root, 'workspace')
  await Promise.all([mkdir(mediaDir), mkdir(workspace)])

  const calls: Array<{ action: string; params: Record<string, unknown> }> = []
  const bridge = new ChatBridge({
    ctx: new Context(),
    connection: {
      connected: opts.connected ?? true,
      call: async (action: string, params: Record<string, unknown>) => {
        calls.push({ action, params })
        return { message_id: 77 }
      },
    } as never,
    media: {} as never,
    transcriber: {} as never,
    agents: {} as never,
    sessions: {} as never,
    agentPresets: undefined as never,
    sessionPersistence: undefined,
    workspaceRegistry: undefined as never,
    agentDefaultModel: undefined,
    defaultModel: undefined,
    config: {
      botQQ: '10002', ignoreSelf: false, requireMention: true,
      interimMessages: true, sendErrorNotice: true, restrictedMemberPrefix: false,
      sensitivePatterns: [], mediaDir, maxImageBytes: 8 * 1024 * 1024,
      maxVoiceBytes: 15 * 1024 * 1024, maxFileBytes: 20 * 1024 * 1024,
      textImageThreshold: 0, cardFooter: 'dsh', fontFiles: [], fontFamilies: [],
      agentPreset: 'standard', workspacePath: workspace, maxInboundFileBytes: 0,
    },
    policy: {
      dmPolicy: 'open', groupPolicy: 'open', allowFrom: [], groupAllowFrom: [],
      adminUsers: ['10001'], allowAllUsers: false, requireMention: true,
    },
    log: () => undefined,
  })

  /** Seed one live chat bound to a session id (the resolveChat lookup). */
  const seed = (sessionId: string, chatId = 'private:10001'): string => {
    ;(bridge as unknown as { chats: Map<string, Record<string, unknown>> }).chats.set(chatId, {
      queue: Promise.resolve(),
      activeTurnRole: 'admin',
      sessionId,
    })
    ;(bridge as unknown as { bySession: Map<string, string> }).bySession.set(sessionId, chatId)
    return chatId
  }

  const ctx = new Context()
  const tools: Tool[] = []
  ctx.provide('tools' as never, {
    register: (tool: Tool) => {
      tools.push(tool)
      return () => undefined
    },
  } as never)
  registerTools(ctx, bridge, {} as never, {
    maxImageBytes: 1_000_000,
    maxVoiceBytes: 1_000_000,
    maxFileBytes: 1_000_000,
  })

  const tool = (name: string): Tool => {
    const found = tools.find(t => t.name === name)
    if (found === undefined) throw new Error('tool not registered: ' + name)
    return found
  }
  const exec = (sessionId: string) => ({ agent: { session: { id: sessionId } } })
  const sentText = (): string => {
    const send = calls.find(c => c.action === 'send_msg')
    if (send === undefined) throw new Error('no send_msg recorded')
    const seg = (send.params.message as Array<{ type: string; data: { text?: string } }>)[0]
    return seg?.data?.text ?? ''
  }

  return { bridge, tool, exec, seed, calls, sentText }
}

describe('qq_progress（执行途中发消息）', () => {
  it('立刻把进度发给当前会话，并回报 message_id', async () => {
    const h = await makeHarness()
    const sessionId = 'sess-progress'
    h.seed(sessionId)
    const result = await h.tool('qq_progress').execute({ text: '正在构建，等一下' }, h.exec(sessionId)) as {
      sent: boolean; messageId: string | null
    }
    expect(result.sent).toBe(true)
    expect(result.messageId).toBe('77')
    expect(h.sentText()).toBe('正在构建，等一下')
  })

  it('剥掉 Markdown（QQ 不渲染），与最终回复同口径', async () => {
    const h = await makeHarness()
    const sessionId = 'sess-md'
    h.seed(sessionId)
    await h.tool('qq_progress').execute({ text: '**第一步** 完成，还剩 `2` 步' }, h.exec(sessionId))
    expect(h.sentText()).toBe('第一步 完成，还剩 2 步')
  })

  it('text 缺失由参数校验拦下，空串由工具自己拦下', async () => {
    const h = await makeHarness()
    const sessionId = 'sess-empty'
    h.seed(sessionId)
    // 缺字段是框架的参数校验（比 execute 更早），空串走工具里的显式检查。
    await expect(h.tool('qq_progress').execute({}, h.exec(sessionId)))
      .rejects.toThrow(/missing required property "text"/)
    await expect(h.tool('qq_progress').execute({ text: '   ' }, h.exec(sessionId))).rejects.toThrow(/text 必填/)
    expect(h.calls).toHaveLength(0)
  })

  it('会话解析不出来时抛错并提示传 chat_id', async () => {
    const h = await makeHarness()
    await expect(h.tool('qq_progress').execute({ text: '喂' }, h.exec('sess-unknown')))
      .rejects.toThrow(/无法确定目标会话/)
  })

  it('显式 chat_id 可越过会话查找', async () => {
    const h = await makeHarness()
    const result = await h.tool('qq_progress').execute({ text: '指定会话', chat_id: 'group:20001' }, h.exec('sess-none')) as {
      sent: boolean
    }
    expect(result.sent).toBe(true)
    expect(h.calls[0]?.params).toMatchObject({ group_id: 20001 })
  })

  it('被出站层丢掉（剥完只剩表情标记）时如实说没发出去，不抛错', async () => {
    const h = await makeHarness()
    const sessionId = 'sess-meme'
    h.seed(sessionId)
    const result = await h.tool('qq_progress').execute({ text: '[表情: 笑]' }, h.exec(sessionId)) as {
      sent: boolean; reason: string
    }
    expect(result.sent).toBe(false)
    expect(result.reason).not.toBe('')
    expect(h.calls).toHaveLength(0)
  })

  it('连接断开时也不抛错：报告失败让模型继续跑', async () => {
    const h = await makeHarness({ connected: false })
    const sessionId = 'sess-offline'
    h.seed(sessionId)
    const result = await h.tool('qq_progress').execute({ text: '断线时的进度' }, h.exec(sessionId)) as {
      sent: boolean; reason: string
    }
    expect(result.sent).toBe(false)
    expect(result.reason).not.toBe('')
  })

  it('render 把「没发出去」翻成模型看得懂的话，而不是假的「已发送」', async () => {
    const h = await makeHarness()
    const render = h.tool('qq_progress').output?.render
    expect(render).toBeTypeOf('function')
    expect(render?.({}, { sent: true, messageId: '77', reason: '' })[0]?.text).toContain('已发送')
    const failed = render?.({}, { sent: false, messageId: null, reason: 'QQ 通道未连接' })[0]?.text ?? ''
    expect(failed).toContain('未发送')
    expect(failed).toContain('QQ 通道未连接')
  })
})

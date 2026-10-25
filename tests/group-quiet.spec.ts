// 群消息「等平静」缓冲（groupQuietMs / groupQuietMaxMs）：
// 群聊消息先进 per-chat 队列，安静满 groupQuietMs 后按到达顺序逐条 processInbound；
// 从第一条起等满 groupQuietMaxMs 无论如何强制 flush；私聊与 groupQuietMs=0 完全走原路。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'

import { ChatBridge } from '../src/bridge.js'
import { MediaStore } from '../src/media.js'
import { Transcriber } from '../src/stt.js'
import type { NormalizedInbound } from '../src/inbound.js'

// 同 outbound.spec.ts：测试中途失败也不许把假定时器漏给后面的用例。
afterEach(() => {
  vi.useRealTimers()
})

/** 断言用的最小 bridge：不连 WebSocket，把 processInbound 换成记录器
 *  （本文件只验证「缓冲/重放」这一层，处理细节由各自的 spec 负责）。 */
function makeQuietBridge(opts: { groupQuietMs?: number; groupQuietMaxMs?: number } = {}) {
  const ctx = new Context()
  const mediaDir = mkdtempSync(join(tmpdir(), 'onebot-quiet-'))
  const logs: Array<{ level: string; message: string }> = []
  const connection = {
    call: vi.fn(async () => ({ status: 'ok', retcode: 0, data: { message_id: 9 } })),
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
  }
  const bridge = new ChatBridge({
    ctx,
    connection: connection as never,
    media: new MediaStore(join(mediaDir, 'media'), 6),
    transcriber: new Transcriber({ enabled: false, engine: 'auto', command: '', args: [], model: 'small', timeoutMs: 10_000 }),
    agents: { create: vi.fn(), resume: vi.fn(), disposed: [] } as never,
    sessions: { flush: vi.fn(async () => undefined) } as never,
    agentPresets: undefined as never,
    workspaceRegistry: undefined as never,
    defaultModel: undefined,
    config: {
      botQQ: '10002', ignoreSelf: false, requireMention: false,
      interimMessages: false, sendErrorNotice: false, restrictedMemberPrefix: false,
      sensitivePatterns: [], mediaDir, maxImageBytes: 8 * 1024 * 1024,
      maxVoiceBytes: 15 * 1024 * 1024, maxFileBytes: 20 * 1024 * 1024,
      textImageThreshold: 0, cardFooter: 'dsh', fontFiles: [], fontFamilies: [],
      agentPreset: 'standard', workspacePath: mediaDir,
      ...(opts.groupQuietMs !== undefined ? { groupQuietMs: opts.groupQuietMs } : {}),
      ...(opts.groupQuietMaxMs !== undefined ? { groupQuietMaxMs: opts.groupQuietMaxMs } : {}),
    } as never,
    policy: {
      dmPolicy: 'open', groupPolicy: 'open', allowFrom: [], groupAllowFrom: [],
      adminUsers: ['10001'], allowAllUsers: false, requireMention: false,
    },
    log: (level: string, message: string) => { logs.push({ level, message }) },
  } as never)
  const handled: string[] = []
  const processInbound = vi.fn(async (inbound: NormalizedInbound) => {
    handled.push(inbound.chatId + '|' + inbound.text)
  })
  // processInbound 是私有方法：本 spec 只替换实例上的实现，不碰公开接口。
  ;(bridge as unknown as { processInbound: unknown }).processInbound = processInbound
  return { bridge, processInbound, handled, logs, mediaDir }
}

let messageId = 100
function groupEvent(groupId: number, userId: number, text: string) {
  messageId += 1
  return {
    post_type: 'message', message_type: 'group', self_id: 10002,
    group_id: groupId, user_id: userId, message_id: messageId,
    message: [{ type: 'text', data: { text } }], raw_message: text,
    sender: { user_id: userId, nickname: '群友' },
  } as never
}

function privateEvent(userId: number, text: string) {
  messageId += 1
  return {
    post_type: 'message', message_type: 'private', self_id: 10002,
    user_id: userId, message_id: messageId,
    message: [{ type: 'text', data: { text } }], raw_message: text,
    sender: { user_id: userId, nickname: '小明' },
  } as never
}

describe('群消息等平静（groupQuietMs）', () => {
  it('groupQuietMs = 0（默认关闭）：群消息立刻处理，不进缓冲', async () => {
    vi.useFakeTimers()
    const h = makeQuietBridge({ groupQuietMs: 0 })
    expect(vi.getTimerCount()).toBe(0)
    await h.bridge.handleInbound(groupEvent(9001, 10003, '甲'))
    expect(h.processInbound).toHaveBeenCalledTimes(1)
    expect(h.handled).toEqual(['group:9001|甲'])
    expect(vi.getTimerCount()).toBe(0)
    await h.bridge.stop()
  })

  it('groupQuietMs > 0：群消息不立刻处理，安静满窗口才按到达顺序处理', async () => {
    vi.useFakeTimers()
    const h = makeQuietBridge({ groupQuietMs: 1000 })
    await h.bridge.handleInbound(groupEvent(9001, 10003, '甲'))
    expect(h.processInbound).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(1)
    // 未满窗口：仍然一条都不处理。
    await vi.advanceTimersByTimeAsync(999)
    expect(h.processInbound).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(h.handled).toEqual(['group:9001|甲'])
    expect(vi.getTimerCount()).toBe(0)
    await h.bridge.stop()
  })

  it('缓冲期间又来一条：定时器重置，全部按到达顺序处理且只处理一次', async () => {
    vi.useFakeTimers()
    const h = makeQuietBridge({ groupQuietMs: 1000 })
    await h.bridge.handleInbound(groupEvent(9001, 10003, '甲'))
    await vi.advanceTimersByTimeAsync(600)
    await h.bridge.handleInbound(groupEvent(9001, 10003, '乙'))
    await vi.advanceTimersByTimeAsync(600) // 距第一条 1200ms，但距第二条只有 600ms
    expect(h.processInbound).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(400) // 距第二条满 1000ms
    expect(h.handled).toEqual(['group:9001|甲', 'group:9001|乙'])
    // 不会重复重放。
    await vi.advanceTimersByTimeAsync(5000)
    expect(h.processInbound).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)
    await h.bridge.stop()
  })

  it('连续不断的新消息：到 groupQuietMaxMs 强制 flush（并写 debug 日志）', async () => {
    vi.useFakeTimers()
    const h = makeQuietBridge({ groupQuietMs: 1000, groupQuietMaxMs: 3000 })
    // 每 400ms 来一条：静默窗口（1000ms）永远凑不满，只能靠强制上限兜底。
    for (let i = 0; i < 7; i += 1) {
      await h.bridge.handleInbound(groupEvent(9001, 10003, '刷' + i))
      await vi.advanceTimersByTimeAsync(400)
    }
    // 此刻距第一条 2800ms；再过 200ms 到 3000ms 上限，第 8 条触发强制 flush。
    await vi.advanceTimersByTimeAsync(200)
    await h.bridge.handleInbound(groupEvent(9001, 10003, '刷7'))
    await vi.advanceTimersByTimeAsync(0) // 让强制 flush 的异步重放跑完
    expect(h.handled).toHaveLength(8)
    expect(h.handled[0]).toBe('group:9001|刷0')
    expect(h.handled[7]).toBe('group:9001|刷7')
    expect(h.logs.some(l => l.level === 'debug' && l.message.includes('强制上限'))).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
    await h.bridge.stop()
  })

  it('私聊消息不受影响：groupQuietMs > 0 时也立刻处理', async () => {
    vi.useFakeTimers()
    const h = makeQuietBridge({ groupQuietMs: 5000 })
    await h.bridge.handleInbound(privateEvent(10001, '私聊一句'))
    expect(h.processInbound).toHaveBeenCalledTimes(1)
    expect(h.handled).toEqual(['private:10001|私聊一句'])
    expect(vi.getTimerCount()).toBe(0)
    // 群消息仍然进缓冲（两种聊天互不干扰）。
    await h.bridge.handleInbound(groupEvent(9001, 10003, '群聊一句'))
    expect(h.handled).toHaveLength(1)
    expect(vi.getTimerCount()).toBe(1)
    await h.bridge.stop()
  })

  it('flush 时一条失败不吞掉后面的消息（顺序保持）', async () => {
    vi.useFakeTimers()
    const h = makeQuietBridge({ groupQuietMs: 500 })
    h.processInbound.mockImplementationOnce(async () => {
      throw new Error('boom')
    })
    await h.bridge.handleInbound(groupEvent(9001, 10003, '甲'))
    await h.bridge.handleInbound(groupEvent(9001, 10003, '乙'))
    await vi.advanceTimersByTimeAsync(500)
    expect(h.processInbound).toHaveBeenCalledTimes(2)
    expect(h.handled).toEqual(['group:9001|乙'])
    expect(h.logs.some(l => l.level === 'error' && l.message.includes('boom'))).toBe(true)
    await h.bridge.stop()
  })

  it('停止时清掉定时器、丢弃队列：之后不再 processInbound', async () => {
    vi.useFakeTimers()
    const h = makeQuietBridge({ groupQuietMs: 1000 })
    await h.bridge.handleInbound(groupEvent(9001, 10003, '甲'))
    expect(vi.getTimerCount()).toBe(1)
    await h.bridge.stop()
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(h.processInbound).not.toHaveBeenCalled()
    expect(h.logs.some(l => l.level === 'debug' && l.message.includes('停止时丢弃'))).toBe(true)
    // stop 之后的入站消息直接丢弃（既有 stopping 语义）。
    await h.bridge.handleInbound(groupEvent(9001, 10003, '乙'))
    expect(h.processInbound).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
})

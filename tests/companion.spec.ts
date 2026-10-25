/**
 * `companionQq` 服务测试（阿莉拉二开 T-A2）。
 *
 * 这个服务是 dsh-meme `send_meme` 的 QQ 原生图片出口，契约由 dsh-meme 写死：
 * `sendImage(path)` **同步抛错、同步返回**（它不 await），所以这里把每条同步
 * 失败路径逐条钉死，再确认段构造（base64 image 段 + 可选 caption）和目标聊天
 * 解析顺序（当前工具会话 → 最活跃聊天）。
 * @module dsh-onebot/tests/companion
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createCompanionQq, type CompanionQqDeps } from '../src/companion.js'
import type { OutboundSegment } from '../src/outbound.js'

import { makeHarness } from './helpers/bridge-harness.js'

const dirs: string[] = []

function tempImage(content = 'cat'): string {
  const dir = mkdtempSync(join(tmpdir(), 'onebot-companion-'))
  dirs.push(dir)
  const path = join(dir, 'meme.png')
  writeFileSync(path, content)
  return path
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

interface Recorder {
  sent: Array<{ chatId: string; segments: OutboundSegment[] }>
  logs: Array<{ level: string; message: string }>
}

function makeDeps(over: Partial<CompanionQqDeps> = {}): { deps: CompanionQqDeps; rec: Recorder } {
  const rec: Recorder = { sent: [], logs: [] }
  const deps: CompanionQqDeps = {
    connected: () => true,
    chatForSession: () => undefined,
    mostRecentChat: () => 'private:10001',
    currentSessionId: () => undefined,
    sendSegments: async (chatId, segments) => {
      rec.sent.push({ chatId, segments })
      return '7'
    },
    maxImageBytes: 8 * 1024 * 1024,
    log: (level, message) => { rec.logs.push({ level, message }) },
    ...over,
  }
  return { deps, rec }
}

describe('createCompanionQq：isOnline / lastChatTarget', () => {
  it('isOnline 跟着连接状态走', () => {
    const online = createCompanionQq(makeDeps({ connected: () => true }).deps)
    const offline = createCompanionQq(makeDeps({ connected: () => false }).deps)
    expect(online.isOnline()).toBe(true)
    expect(offline.isOnline()).toBe(false)
  })

  it('lastChatTarget 暴露最活跃聊天，没有就是 null', () => {
    expect(createCompanionQq(makeDeps().deps).lastChatTarget).toBe('private:10001')
    expect(createCompanionQq(makeDeps({ mostRecentChat: () => undefined }).deps).lastChatTarget).toBeNull()
  })
})

describe('createCompanionQq.sendImage：同步失败路径（dsh-meme 会 catch 并报给用户）', () => {
  it('通道没连上就抛', () => {
    const svc = createCompanionQq(makeDeps({ connected: () => false }).deps)
    expect(() => svc.sendImage(tempImage())).toThrow('QQ 通道未连接（NapCat 没连上）')
  })

  it('不知道发给谁就抛，绝不瞎猜一个聊天', () => {
    const svc = createCompanionQq(makeDeps({ mostRecentChat: () => undefined }).deps)
    expect(() => svc.sendImage(tempImage())).toThrow('还不知道发给谁：这个 QQ 会话还没来过消息')
  })

  it('读不到文件就抛（带绝对路径，方便定位）', () => {
    const svc = createCompanionQq(makeDeps().deps)
    const missing = join(tmpdir(), 'onebot-companion-does-not-exist.png')
    expect(() => svc.sendImage(missing)).toThrow('读不到图片文件: ' + missing)
  })

  it('超过通道上限就抛（按 base64 之前的原始字节算）', () => {
    const svc = createCompanionQq(makeDeps({ maxImageBytes: 2 }).deps)
    expect(() => svc.sendImage(tempImage('cat'))).toThrow('图片 3 字节，超过通道上限 2')
  })

  it('失败时一个段都不发出去', () => {
    const { deps, rec } = makeDeps({ connected: () => false })
    const svc = createCompanionQq(deps)
    expect(() => svc.sendImage(tempImage())).toThrow()
    expect(rec.sent).toHaveLength(0)
  })
})

describe('createCompanionQq.sendImage：目标聊天解析', () => {
  it('当前工具会话有对应聊天时优先用它（而不是最活跃那条）', () => {
    const { deps, rec } = makeDeps({
      currentSessionId: () => 'onebot-group-555',
      chatForSession: sessionId => (sessionId === 'onebot-group-555' ? 'group:555' : undefined),
      mostRecentChat: () => 'private:10001',
    })
    const result = createCompanionQq(deps).sendImage(tempImage())
    expect(result).toEqual({ ok: true, target: 'group:555' })
    expect(rec.sent.map(s => s.chatId)).toEqual(['group:555'])
  })

  it('会话映射不到（或不在回合里）就退回最活跃聊天', () => {
    const { deps, rec } = makeDeps({ currentSessionId: () => 'onebot-group-999', mostRecentChat: () => 'private:10001' })
    const result = createCompanionQq(deps).sendImage(tempImage())
    expect(result.target).toBe('private:10001')
    expect(rec.sent[0]!.chatId).toBe('private:10001')
  })

  it('currentSessionId 抛错也不影响发图（宿主没有该 API 时的兜底）', () => {
    const { deps } = makeDeps({ currentSessionId: () => { throw new Error('no initiator') }, mostRecentChat: () => 'private:10001' })
    const svc = createCompanionQq({
      ...deps,
      // 复刻 index.ts 那层 try/catch：服务本身不碰 agents，由接线处吞掉异常。
      currentSessionId: () => { try { return deps.currentSessionId() } catch { return undefined } },
    })
    expect(svc.sendImage(tempImage()).target).toBe('private:10001')
  })
})

describe('createCompanionQq.sendImage：段构造', () => {
  it('没有 caption 时只发一个 base64 image 段', () => {
    const { deps, rec } = makeDeps()
    createCompanionQq(deps).sendImage(tempImage('cat'))
    expect(rec.sent[0]!.segments).toEqual([{ type: 'image', data: { file: 'base64://Y2F0' } }])
  })

  it('有 caption 时先文字后图片', () => {
    const { deps, rec } = makeDeps()
    createCompanionQq(deps).sendImage(tempImage('cat'), '  看这个  ')
    expect(rec.sent[0]!.segments).toEqual([
      { type: 'text', data: { text: '看这个' } },
      { type: 'image', data: { file: 'base64://Y2F0' } },
    ])
  })

  it('空白 caption 视同没有', () => {
    const { deps, rec } = makeDeps()
    createCompanionQq(deps).sendImage(tempImage('cat'), '   ')
    expect(rec.sent[0]!.segments).toHaveLength(1)
    expect(rec.sent[0]!.segments[0]!.type).toBe('image')
  })
})

describe('createCompanionQq.sendImage：异步发送与日志（fire-and-forget）', () => {
  it('发送失败只写 warn，不向调用方抛（同步契约已返回 ok）', async () => {
    const { deps, rec } = makeDeps({
      sendSegments: async () => { throw new Error('napcat exploded') },
    })
    const result = createCompanionQq(deps).sendImage(tempImage())
    expect(result.ok).toBe(true)
    await vi.waitFor(() => expect(rec.logs.some(l => l.level === 'warn')).toBe(true))
    expect(rec.logs.find(l => l.level === 'warn')!.message).toContain('companionQq 表情包发送失败')
    expect(rec.logs.find(l => l.level === 'warn')!.message).toContain('napcat exploded')
  })

  it('发送成功写一条 info（含目标聊天与消息 id）', async () => {
    const { deps, rec } = makeDeps()
    createCompanionQq(deps).sendImage(tempImage())
    await vi.waitFor(() => expect(rec.logs.some(l => l.level === 'info')).toBe(true))
    const info = rec.logs.find(l => l.level === 'info')!.message
    expect(info).toContain('private:10001')
    expect(info).toContain('id 7')
  })
})

describe('ChatBridge.mostRecentChat（companionQq 的兜底目标）', () => {
  it('没有任何聊天时是 undefined', async () => {
    const h = await makeHarness()
    try {
      expect(h.bridge.mostRecentChat()).toBeUndefined()
    } finally {
      await h.bridge.stop()
      h.client.close()
      await h.connection.stop()
    }
  })

  it('返回最后活跃的那个聊天', async () => {
    const h = await makeHarness()
    try {
      h.sendText('先来一条')
      await vi.waitFor(() => expect(h.bridge.mostRecentChat()).toBe('private:10001'))
      // 第二条来自群：@ 机器人（requireMention 默认开），聊天换成 group:<群号>。
      h.client.send(JSON.stringify({
        post_type: 'message', message_type: 'group', group_id: 555, user_id: 10001, self_id: 10002,
        message: [{ type: 'at', data: { qq: '10002' } }, { type: 'text', data: { text: ' 在吗' } }],
        raw_message: '[CQ:at,qq=10002] 在吗',
        sender: { user_id: 10001, nickname: '小明' },
      }))
      await vi.waitFor(() => expect(h.bridge.mostRecentChat()).toBe('group:555'))
    } finally {
      await h.bridge.stop()
      h.client.close()
      await h.connection.stop()
    }
  })
})

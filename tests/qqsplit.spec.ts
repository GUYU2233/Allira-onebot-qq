/**
 * `[[qq]]` / `[[qq_silent]]` 分流测试（阿莉拉二开 T-A1）。
 *
 * 两层：
 * 1. 纯函数层 —— `extractQqBlock` 的语义表逐条钉死（无块 / 单块 / 多块 /
 *    空块 / 未闭合 / 裸标记）。
 * 2. 出站集成层 —— 走真实的 OutboundPipeline.sendToChat，确认 QQ 只发段内、
 *    空块与静默标记一个字都不发、无标记时全文照发。
 * @module dsh-onebot/tests/qqsplit
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { extractQqBlock, stripMemeMarkers, SILENT_MARKER_RE } from '../src/qqsplit.js'

import { makeHarness, sentTexts } from './helpers/bridge-harness.js'

afterEach(() => {
  vi.useRealTimers()
})

describe('extractQqBlock（纯函数）', () => {
  it('没有块时原样返回，标记不参与裁剪', () => {
    const r = extractQqBlock('普通回复，没有任何标记。')
    expect(r.hasBlock).toBe(false)
    expect(r.body).toBe('普通回复，没有任何标记。')
  })

  it('单个块：只留段内内容', () => {
    const r = extractQqBlock('Web 看得到的完整分析。\n[[qq]]\nQQ 只看到这句。\n[[/qq]]')
    expect(r.hasBlock).toBe(true)
    expect(r.body).toBe('QQ 只看到这句。')
  })

  it('多个块按出现顺序拼接，段外内容全丢', () => {
    const r = extractQqBlock('前言\n[[qq]]第一段[[/qq]]\n中间的 Web 内容\n[[qq]]第二段[[/qq]]\n后记')
    expect(r.hasBlock).toBe(true)
    expect(r.body).toBe('第一段\n\n第二段')
  })

  it('跨行块保留换行（非贪婪、多行匹配）', () => {
    const r = extractQqBlock('[[qq]]\n第一行\n第二行\n[[/qq]]')
    expect(r.body).toBe('第一行\n第二行')
  })

  it('空块 = 静默：hasBlock 为真但 body 为空', () => {
    const r = extractQqBlock('这段只在 Web 显示。\n[[qq]][[/qq]]')
    expect(r.hasBlock).toBe(true)
    expect(r.body).toBe('')
  })

  it('只有空白内容的块同样算静默', () => {
    const r = extractQqBlock('Web 内容\n[[qq]]   \n\n  [[/qq]]')
    expect(r.hasBlock).toBe(true)
    expect(r.body).toBe('')
  })

  it('开块未闭合：开标记之后的全部算段内（漏写结束标记不再退化成全文）', () => {
    const r = extractQqBlock('正文\n[[qq]]\n没闭合的半截')
    expect(r.hasBlock).toBe(true)
    expect(r.body).toBe('没闭合的半截')
  })

  it('开块未闭合、段内又有配对块：配对块优先', () => {
    const r = extractQqBlock('Web\n[[qq]]\n正式段\n[[/qq]]\n尾巴')
    expect(r.hasBlock).toBe(true)
    expect(r.body).toBe('正式段')
  })

  it('完全没有开标记：全文照发，只剥裸标记', () => {
    const r = extractQqBlock('正文\n[[/qq]]')
    expect(r.hasBlock).toBe(false)
    expect(r.body).toBe('正文\n')
  })


  it('块外的裸闭标记也被剥掉', () => {
    const r = extractQqBlock('[[qq]]段内[[/qq]] 尾巴 [[/qq]]')
    expect(r.hasBlock).toBe(true)
    expect(r.body).toBe('段内')
  })

  it('没有块时也不把 [[qq]] 字样漏给 QQ', () => {
    const r = extractQqBlock('这里提到 [[qq]] 但没写全')
    expect(r.hasBlock).toBe(false)
    expect(r.body).not.toContain('[[qq]]')
  })
})

describe('SILENT_MARKER_RE', () => {
  it('整条恰好是标记时命中（含首尾空白）', () => {
    expect(SILENT_MARKER_RE.test('[[qq_silent]]')).toBe(true)
    expect(SILENT_MARKER_RE.test('  \n[[qq_silent]]\n  ')).toBe(true)
  })

  it('标记只是正文的一部分时不命中', () => {
    expect(SILENT_MARKER_RE.test('我要用 [[qq_silent]] 表示不接话')).toBe(false)
    expect(SILENT_MARKER_RE.test('[[qq_silent]] 后面还有字')).toBe(false)
  })
})

describe('stripMemeMarkers（纯函数）', () => {
  it('剥掉整条 [表情: …]，保留其余正文', () => {
    expect(stripMemeMarkers('任务完成，比耶大成功\n[表情: 任务完成，比耶大成功]'))
      .toBe('任务完成，比耶大成功\n')
  })

  it('行内出现时只挖掉标记本身', () => {
    expect(stripMemeMarkers('先看这个 [表情: 猫猫] 再说'))
      .toBe('先看这个  再说')
  })

  it('带 (url) 后缀的形态一并剥掉', () => {
    expect(stripMemeMarkers('[表情: 开心](https://example.com/a.png)')).toBe('')
  })

  it('全角冒号也认', () => {
    expect(stripMemeMarkers('[表情：开心]')).toBe('')
  })

  it('一条正文里多个标记全部剥掉', () => {
    expect(stripMemeMarkers('[表情: a]正文[表情: b]')).toBe('正文')
  })

  it('描述为空时不误伤普通方括号文字', () => {
    expect(stripMemeMarkers('[表情: ]')).toBe('[表情: ]')
    expect(stripMemeMarkers('数组下标 arr[表情] 不算标记')).toBe('数组下标 arr[表情] 不算标记')
  })

  it('不含表情标记的正文原样返回', () => {
    expect(stripMemeMarkers('普通回复')).toBe('普通回复')
  })
})

describe('出站集成：QQ 只发 [[qq]] 段', () => {
  it('带块时 QQ 收到段内内容，段外内容不发', async () => {
    const h = await makeHarness({ textImageThreshold: 0 })
    h.sendText('hi')
    await vi.waitFor(() => expect(h.captured.followups).toHaveLength(1))
    await h.bridge.sendToChat('private:10001', 'Web 专用的完整分析。\n[[qq]]QQ 短话。[[/qq]]')
    await vi.waitFor(() => {
      const texts = sentTexts(h.outbound)
      expect(texts.some(t => t.includes('QQ 短话。'))).toBe(true)
    })
    const texts = sentTexts(h.outbound)
    expect(texts.some(t => t.includes('Web 专用的完整分析'))).toBe(false)
    expect(texts.some(t => t.includes('[[qq]]'))).toBe(false)
    h.client.close()
    await h.bridge.stop()
    await h.connection.stop()
  }, 30_000)

  it('空块时不发任何消息', async () => {
    const h = await makeHarness({ textImageThreshold: 0 })
    h.sendText('hi')
    await vi.waitFor(() => expect(h.captured.followups).toHaveLength(1))
    const before = sentTexts(h.outbound).length
    await expect(h.bridge.sendToChat('private:10001', '只在 Web 显示的分析\n[[qq]][[/qq]]')).resolves.toEqual([])
    expect(sentTexts(h.outbound).length).toBe(before)
    h.client.close()
    await h.bridge.stop()
    await h.connection.stop()
  }, 30_000)

  it('[[qq_silent]] 整条时一个字都不发', async () => {
    const h = await makeHarness({ textImageThreshold: 0 })
    h.sendText('hi')
    await vi.waitFor(() => expect(h.captured.followups).toHaveLength(1))
    const before = sentTexts(h.outbound).length
    await expect(h.bridge.sendToChat('private:10001', '[[qq_silent]]')).resolves.toEqual([])
    expect(sentTexts(h.outbound).length).toBe(before)
    h.client.close()
    await h.bridge.stop()
    await h.connection.stop()
  }, 30_000)

  it('无标记时全文照发（现状不变）', async () => {
    const h = await makeHarness({ textImageThreshold: 0 })
    h.sendText('hi')
    await vi.waitFor(() => expect(h.captured.followups).toHaveLength(1))
    await h.bridge.sendToChat('private:10001', '没有标记的普通回复')
    await vi.waitFor(() => expect(sentTexts(h.outbound).some(t => t.includes('没有标记的普通回复'))).toBe(true))
    h.client.close()
    await h.bridge.stop()
    await h.connection.stop()
  }, 30_000)

  it('正文里的 [表情: …] 标记不漏给 QQ，其余文字照发', async () => {
    const h = await makeHarness({ textImageThreshold: 0 })
    h.sendText('hi')
    await vi.waitFor(() => expect(h.captured.followups).toHaveLength(1))
    await h.bridge.sendToChat('private:10001', '任务完成，比耶大成功\n[表情: 任务完成，比耶大成功]')
    await vi.waitFor(() => expect(sentTexts(h.outbound).some(t => t.includes('任务完成，比耶大成功'))).toBe(true))
    const texts = sentTexts(h.outbound)
    expect(texts.some(t => t.includes('[表情:'))).toBe(false)
    h.client.close()
    await h.bridge.stop()
    await h.connection.stop()
  }, 30_000)

  it('整条只剩表情标记时一个字都不发', async () => {
    const h = await makeHarness({ textImageThreshold: 0 })
    h.sendText('hi')
    await vi.waitFor(() => expect(h.captured.followups).toHaveLength(1))
    const before = sentTexts(h.outbound).length
    await expect(h.bridge.sendToChat('private:10001', '[表情: 比耶]')).resolves.toEqual([])
    expect(sentTexts(h.outbound).length).toBe(before)
    h.client.close()
    await h.bridge.stop()
    await h.connection.stop()
  }, 30_000)
})

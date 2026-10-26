/**
 * qq_group_history 的输出投影：拉到的消息必须真的给到模型。
 *
 * 回归背景：render 曾经只返回「N 条历史消息」，45 条入站群消息全被丢掉，
 * 工具说明写的「供总结群内上下文、查看用户之前的发言」等于没实现——
 * 模型在群里开口时其实什么都没看到。
 */

import { describe, expect, it } from 'vitest'

import { renderGroupHistory } from '../src/tools.js'

const row = (over: Record<string, unknown> = {}) => ({
  message_id: '1',
  time: '1792976106',
  user_id: '2191108958',
  nickname: '26电信梁翔宇',
  text: '世界之外的力量。',
  ...over,
})

describe('renderGroupHistory', () => {
  it('空数组给出明确的空态，而不是「0 条历史消息」', () => {
    expect(renderGroupHistory([])).toContain('没有拉到')
    expect(renderGroupHistory(null)).toContain('没有拉到')
    expect(renderGroupHistory(undefined)).toContain('没有拉到')
  })

  it('每条消息都出现在输出里（含昵称、QQ、正文）', () => {
    const out = renderGroupHistory([
      row({ nickname: '甲', user_id: '111', text: '第一句' }),
      row({ nickname: '乙', user_id: '222', text: '第二句' }),
    ])
    expect(out).toContain('第一句')
    expect(out).toContain('第二句')
    expect(out).toContain('甲(111)')
    expect(out).toContain('乙(222)')
  })

  it('条数写在开头，且顺序是旧→新', () => {
    const out = renderGroupHistory([row({ text: '早' }), row({ text: '晚' })])
    expect(out.startsWith('2 条历史消息')).toBe(true)
    expect(out.indexOf('早')).toBeLessThan(out.indexOf('晚'))
  })

  it('单条过长会被截断，避免 50 条撑爆上下文', () => {
    const long = 'x'.repeat(1000)
    const out = renderGroupHistory([row({ text: long })])
    expect(out).toContain('…')
    expect(out.length).toBeLessThan(500)
  })

  it('没有文字的条目（纯图片）显示占位而不是空白', () => {
    const out = renderGroupHistory([row({ text: '' })])
    expect(out).toContain('（无文字）')
  })

  it('正文里的换行被压成空格，保证一条一行', () => {
    const out = renderGroupHistory([row({ text: '第一行\n第二行' })])
    const body = out.split('\n').slice(1)
    expect(body).toHaveLength(1)
    expect(body[0]).toContain('第一行 第二行')
  })

  it('time 缺失或非法时不崩，显示 ?', () => {
    expect(renderGroupHistory([row({ time: null })])).toContain('?')
    expect(renderGroupHistory([row({ time: 'abc' })])).toContain('?')
  })
})

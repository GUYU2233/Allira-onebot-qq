import { describe, expect, it, vi } from 'vitest'

import { makeCmdHarness, makeEvent, sentTexts } from './helpers/bridge-harness.js'

/** Inbox delivery must not reset output belonging to the still-running turn. */
describe('busy inbound preserves active output', () => {
  for (const scenario of [
    { name: 'explicit queued followup', policy: 'queue', text: '下一件事', followups: 2, steers: 0 },
    { name: 'default nearest-step steer', policy: undefined, text: '顺便聊一句', followups: 1, steers: 1 },
    { name: 'explicit /steer', policy: 'queue', text: '/steer 先别停下手里的活', followups: 1, steers: 1 },
    { name: 'non-turn /status command', policy: 'steer', text: '/status', followups: 1, steers: 0 },
  ] as const) {
    it(scenario.name + ' retains pending final and interim trail', async () => {
      const h = await makeCmdHarness({ ...(scenario.policy ? { newMessagePolicy: scenario.policy } : {}), interimRecall: false })
      try {
        h.sendText('开始工作')
        await vi.waitFor(() => expect(h.captured.followups).toHaveLength(1))
        const chat = h.chats().get('private:10001') as unknown as {
          agent: { status: string }
          loopPending: string | null
          loopBuffer: Array<{ id: string; text: string }>
          activeTurnRole: string
        }
        chat.agent.status = 'running'
        const session = { id: h.sessionIds[0] }
        h.ctx.emit('session/event', session as never, makeEvent('turn/start', { turn: 1 }))
        const emit = (id: string, text: string, tool = false) => {
          h.ctx.emit('session/event', session as never, makeEvent('assistant/message', {
            turn: 1, step: 1, message: { role: 'assistant', id, content: [
              { type: 'text', text },
              ...(tool ? [{ type: 'tool-call', id: 'busy-tool', name: 'bash', arguments: '{}' }] : []),
            ] },
          }))
        }
        // Hold the live send in flight while QQ input arrives. The same
        // placeholder must survive and receive its message id on completion.
        const realCall = h.connection.call.bind(h.connection)
        let releaseSend!: () => void
        const sendGate = new Promise<void>(resolve => { releaseSend = resolve })
        let held = false
        h.connection.call = (async (action: string, params: Record<string, unknown>) => {
          if (action === 'send_msg' && !held) {
            held = true
            await sendGate
          }
          return realCall(action, params)
        }) as typeof h.connection.call
        emit('busy-interim', '工作还在继续', true)
        expect(chat.loopBuffer[0]?.id).toBe('')
        emit('busy-final', '工作结果不能丢')
        const trail = chat.loopBuffer
        const role = chat.activeTurnRole
        // Command handlers await their notices on this same send chain.
        if (scenario.text.startsWith('/')) releaseSend()

        await h.bridge.handleInbound({
          post_type: 'message', message_type: 'private', user_id: 10001, self_id: 10002,
          message: [{ type: 'text', data: { text: scenario.text } }],
          raw_message: scenario.text, message_id: 1234,
          sender: { user_id: 10001, nickname: '小明' },
        })
        expect(h.captured.followups).toHaveLength(scenario.followups)
        expect(h.captured.steers).toHaveLength(scenario.steers)
        expect(chat.loopBuffer).toBe(trail)
        expect(chat.loopBuffer).toHaveLength(1)
        expect(chat.loopPending).toBe('工作结果不能丢')
        expect(chat.activeTurnRole).toBe(role)
        expect(chat.agent.status).toBe('running')
        releaseSend()
        await vi.waitFor(() => expect(chat.loopBuffer[0]?.id).toBe('7'))

        // Re-delivery neither re-steers nor re-queues or clears output.
        await h.bridge.handleInbound({
          post_type: 'message', message_type: 'private', user_id: 10001,
          message: [{ type: 'text', data: { text: scenario.text } }], message_id: 1234,
        })
        expect(h.captured.followups).toHaveLength(scenario.followups)
        expect(h.captured.steers).toHaveLength(scenario.steers)
        expect(chat.loopPending).toBe('工作结果不能丢')

        h.ctx.emit('session/event', session as never, makeEvent('turn/end', {
          turn: 1, reason: { kind: 'completed' },
        }))
        await vi.waitFor(() => expect(sentTexts(h.outbound).filter(t => t.includes('工作结果不能丢'))).toHaveLength(1))
        expect(chat.loopPending).toBeNull()
        expect(chat.loopBuffer).toEqual([])
      } finally {
        h.client.close()
        await h.bridge.stop()
        await h.connection.stop()
      }
    })
  }
})

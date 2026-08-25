import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@cocode/tui-connection'
import { createAssembler } from '../../src/runtime/assembler.ts'
import { createBuiltinRegistry } from '../../src/runtime/nodes/builtins.ts'

function ev(type: string, seq: number, data: unknown): SessionEvent {
  return { type, seq, time: seq * 1000, data }
}

function assembler() {
  return createAssembler(createBuiltinRegistry())
}

describe('Assembler', () => {
  it('projects user/message into a user node', () => {
    const a = assembler()
    a.ingest(
      ev('user/message', 1, {
        id: 'm1',
        role: 'user',
        content: [{ type: 'text', text: 'hello' }],
        source: { kind: 'user' },
      }),
    )
    const nodes = a.snapshot()
    expect(nodes).toHaveLength(1)
    expect(nodes[0]).toMatchObject({
      kind: 'user',
      id: 'm1',
      text: 'hello',
    })
  })

  it('projects plugin-authored user/message into a context node', () => {
    const a = assembler()
    a.ingest(
      ev('user/message', 2, {
        id: 'context-1',
        content: [{ type: 'text', text: 'Current runtime context.' }],
        source: {
          kind: 'plugin',
          plugin: '@deepseek-ai/dsh-system-prompt',
          form: 'snapshot',
          sections: [
            { name: 'sandbox:policy', text: 'danger-full-access' },
            { name: 'approval:policy', text: 'never' },
          ],
        },
      }),
    )
    expect(a.snapshot()).toEqual([
      expect.objectContaining({
        kind: 'context',
        id: 'context-1',
        text: 'Current runtime context.',
        provenance: {
          role: 'inject',
          label: '@deepseek-ai/dsh-system-prompt',
        },
        form: 'snapshot',
        sections: [
          { name: 'sandbox:policy', text: 'danger-full-access' },
          { name: 'approval:policy', text: 'never' },
        ],
      }),
    ])
  })

  it('republishes a changed node as a new object and keeps settled ones stable', () => {
    const a = assembler()
    a.ingest(
      ev('user/message', 1, {
        id: 'm1',
        role: 'user',
        content: [{ type: 'text', text: 'hello' }],
        source: { kind: 'user' },
      }),
    )
    a.ingest(
      ev('assistant/chunk', 2, {
        turn: 1,
        step: 0,
        chunk: { type: 'text-delta', index: 0, text: 'Hel' },
      }),
    )
    const first = a.snapshot()
    a.ingest(
      ev('assistant/chunk', 3, {
        turn: 1,
        step: 0,
        chunk: { type: 'text-delta', index: 0, text: 'lo' },
      }),
    )
    const second = a.snapshot()

    expect(second[0]).toBe(first[0])
    expect(second[1]).not.toBe(first[1])
    expect(first[1]).toMatchObject({ text: 'Hel' })
    expect(second[1]).toMatchObject({ text: 'Hello' })
  })

  it('merges assistant chunks then seals on message', () => {
    const a = assembler()
    a.ingest(
      ev('assistant/chunk', 1, {
        turn: 1,
        step: 0,
        chunk: { type: 'text-delta', index: 0, text: 'Hel' },
      }),
    )
    a.ingest(
      ev('assistant/chunk', 2, {
        turn: 1,
        step: 0,
        chunk: { type: 'reasoning-delta', index: 1, text: 'think' },
      }),
    )
    a.ingest(
      ev('assistant/chunk', 3, {
        turn: 1,
        step: 0,
        chunk: { type: 'text-delta', index: 0, text: 'lo' },
      }),
    )
    expect(a.snapshot()[0]).toMatchObject({
      kind: 'assistant',
      id: '1:0',
      text: 'Hello',
      reasoning: 'think',
      streaming: true,
    })
    a.ingest(
      ev('assistant/message', 4, {
        turn: 1,
        step: 0,
        message: {
          id: 'a1',
          role: 'assistant',
          content: [
            { type: 'reasoning', text: 'think' },
            { type: 'text', text: 'Hello' },
          ],
          source: { kind: 'model', provider: 'p', model: 'm' },
        },
        usage: { inputTokens: 10, outputTokens: 2 },
      }),
    )
    expect(a.snapshot()[0]).toMatchObject({
      kind: 'assistant',
      text: 'Hello',
      reasoning: 'think',
      streaming: false,
      usage: { input: 10, output: 2 },
    })
  })

  it('preserves the interrupted flag from a finalized assistant message', () => {
    const a = assembler()
    a.ingest(
      ev('assistant/message', 1, {
        turn: 1,
        step: 0,
        interrupted: true,
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'partial answer' }],
        },
      }),
    )

    expect(a.snapshot()[0]).toMatchObject({
      kind: 'assistant',
      text: 'partial answer',
      streaming: false,
      interrupted: true,
    })
  })

  it('settles a visible assistant prefix as interrupted at an interrupted turn boundary', () => {
    const a = assembler()
    a.ingest(
      ev('assistant/chunk', 1, {
        turn: 1,
        step: 0,
        chunk: { type: 'text-delta', index: 0, text: 'partial answer' },
      }),
    )
    a.ingest(ev('turn/end', 2, { turn: 1, reason: { kind: 'interrupted' } }))

    expect(a.snapshot()[0]).toMatchObject({
      kind: 'assistant',
      text: 'partial answer',
      streaming: false,
      interrupted: true,
    })
  })

  it('does not mark a visible assistant prefix interrupted for a normal turn end', () => {
    const a = assembler()
    a.ingest(
      ev('assistant/chunk', 1, {
        turn: 1,
        step: 0,
        chunk: { type: 'text-delta', index: 0, text: 'complete enough' },
      }),
    )
    a.ingest(ev('turn/end', 2, { turn: 1, reason: { kind: 'completed' } }))

    expect(a.snapshot()[0]).toMatchObject({ streaming: true })
    expect(a.snapshot()[0]).not.toHaveProperty('interrupted')
  })

  it('folds command run and done events into one lifecycle node', () => {
    const a = assembler()
    a.ingest(
      ev('command/run', 1, {
        commandId: 'cmd-1',
        name: 'goal',
        args: ' ship',
        source: { kind: 'user' },
      }),
    )
    expect(a.snapshot()[0]).toMatchObject({
      kind: 'command',
      commandId: 'cmd-1',
      name: 'goal',
      args: ' ship',
      outcome: null,
    })

    a.ingest(
      ev('command/done', 2, {
        commandId: 'cmd-1',
        kind: 'success',
        text: 'Goal updated',
        sourceEventSeq: 9,
      }),
    )
    expect(a.snapshot()[0]).toMatchObject({
      kind: 'command',
      seq: 1,
      outcome: { kind: 'success', text: 'Goal updated', sourceEventSeq: 9 },
    })
  })

  it('keeps a command done event visible when its run is outside the history window', () => {
    const a = assembler()
    a.ingest(ev('command/done', 4, { commandId: 'cmd-2', kind: 'error', text: 'failed' }))
    expect(a.snapshot()[0]).toMatchObject({
      kind: 'command',
      commandId: 'cmd-2',
      seq: 4,
      name: null,
      args: null,
      outcome: { kind: 'error', text: 'failed' },
    })
  })

  it('pairs tool/call and tool/result by callId', () => {
    const a = assembler()
    a.ingest(
      ev('tool/call', 1, {
        turn: 1,
        step: 0,
        callId: 'c1',
        name: 'bash',
        arguments: '{"command":"ls"}',
      }),
    )
    expect(a.snapshot()[0]).toMatchObject({
      kind: 'tool',
      id: 'c1',
      name: 'bash',
      status: 'running',
    })
    a.ingest(
      ev('tool/result', 2, {
        turn: 1,
        step: 0,
        message: {
          id: 'r1',
          role: 'user',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'c1',
              content: [{ type: 'text', text: 'ok' }],
            },
          ],
          source: { kind: 'tool', callId: 'c1' },
        },
      }),
    )
    expect(a.snapshot()[0]).toMatchObject({
      kind: 'tool',
      id: 'c1',
      status: 'success',
      result: 'ok',
    })
  })

  it('marks in-flight tools cancelled when the turn ends', () => {
    const a = assembler()
    a.ingest(
      ev('tool/call', 1, {
        turn: 1,
        step: 0,
        callId: 'write-1',
        name: 'write',
        arguments: '{}',
      }),
    )
    a.ingest(ev('turn/end', 2, { turn: 1, reason: { kind: 'cancelled' } }))
    expect(a.snapshot()[0]).toMatchObject({
      kind: 'tool',
      id: 'write-1',
      status: 'cancelled',
      streaming: false,
    })
  })

  it('settles in-flight tools immediately when the user interrupts', () => {
    const a = assembler()
    a.ingest(
      ev('tool/call', 1, {
        turn: 1,
        step: 0,
        callId: 'write-2',
        name: 'write',
        arguments: '{}',
      }),
    )
    a.settleOpen()
    expect(a.snapshot()[0]).toMatchObject({ status: 'cancelled', streaming: false })
  })

  it('does not reopen a completed tool when the turn later ends', () => {
    const a = assembler()
    a.ingest(
      ev('tool/call', 1, {
        turn: 1,
        step: 0,
        callId: 'c1',
        name: 'bash',
        arguments: '{}',
      }),
    )
    a.ingest(
      ev('tool/result', 2, {
        turn: 1,
        step: 0,
        message: {
          id: 'r1',
          role: 'user',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'c1',
              content: [{ type: 'text', text: 'ok' }],
            },
          ],
          source: { kind: 'tool', callId: 'c1' },
        },
      }),
    )
    a.ingest(ev('turn/end', 3, { turn: 1 }))
    expect(a.snapshot()[0]).toMatchObject({ status: 'success', result: 'ok' })
  })

  it('projects exit_plan_mode arguments while the tool call is streaming', () => {
    const a = assembler()
    a.ingest(
      ev('assistant/chunk', 1, {
        turn: 1,
        step: 0,
        chunk: {
          type: 'tool-call-delta',
          index: 0,
          id: 'plan-1',
          name: 'exit_plan_mode',
          argumentsDelta: '{"plan":"# Plan\\n',
        },
      }),
    )
    expect(a.snapshot()[0]).toMatchObject({
      kind: 'tool',
      id: 'plan-1',
      name: 'exit_plan_mode',
      args: '{"plan":"# Plan\\n',
      status: 'running',
      streaming: true,
    })
    a.ingest(
      ev('assistant/chunk', 2, {
        turn: 1,
        step: 0,
        chunk: {
          type: 'tool-call-delta',
          index: 0,
          id: 'plan-1',
          argumentsDelta: '\\n- inspect files"}',
        },
      }),
    )
    a.ingest(
      ev('tool/call', 3, {
        turn: 1,
        step: 0,
        callId: 'plan-1',
        name: 'exit_plan_mode',
        arguments: '{"plan":"# Plan\\n\\n- inspect files"}',
      }),
    )
    expect(a.snapshot()[0]).toMatchObject({
      kind: 'tool',
      args: '{"plan":"# Plan\\n\\n- inspect files"}',
      streaming: false,
    })
  })

  it('keeps an empty tool-call delta as a live tool context', () => {
    const a = assembler()
    a.ingest(
      ev('assistant/chunk', 1, {
        turn: 1,
        step: 0,
        chunk: {
          type: 'tool-call-delta',
          index: 0,
          id: 'plan-2',
          name: 'exit_plan_mode',
          argumentsDelta: '',
        },
      }),
    )
    expect(a.snapshot()[0]).toMatchObject({
      kind: 'tool',
      id: 'plan-2',
      name: 'exit_plan_mode',
      args: '',
      streaming: true,
    })
  })

  it('preserves a tool name when it arrives after the first delta', () => {
    const a = assembler()
    a.ingest(
      ev('assistant/chunk', 1, {
        turn: 1,
        step: 0,
        chunk: {
          type: 'tool-call-delta',
          index: 0,
          id: 'plan-3',
          argumentsDelta: '{"plan":"# Plan',
        },
      }),
    )
    expect(a.snapshot()[0]).toMatchObject({ kind: 'tool', name: '', streaming: true })
    a.ingest(
      ev('assistant/chunk', 2, {
        turn: 1,
        step: 0,
        chunk: {
          type: 'tool-call-delta',
          index: 0,
          id: 'plan-3',
          name: 'exit_plan_mode',
          argumentsDelta: '"}',
        },
      }),
    )
    expect(a.snapshot()[0]).toMatchObject({ kind: 'tool', name: 'exit_plan_mode', streaming: true })
  })

  it('marks tool error from error field', () => {
    const a = assembler()
    a.ingest(
      ev('tool/call', 1, {
        turn: 1,
        step: 0,
        callId: 'c2',
        name: 'bash',
        arguments: '{}',
      }),
    )
    a.ingest(
      ev('tool/result', 2, {
        turn: 1,
        step: 0,
        message: {
          id: 'r2',
          role: 'user',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'c2',
              isError: true,
              content: [{ type: 'text', text: 'boom' }],
            },
          ],
          source: { kind: 'tool', callId: 'c2' },
        },
        error: { name: 'BashError', code: 'EXIT' },
      }),
    )
    expect(a.snapshot()[0]).toMatchObject({
      kind: 'tool',
      status: 'error',
      error: { name: 'BashError', code: 'EXIT' },
    })
  })

  it('ignores replayed or out-of-order seq', () => {
    const a = assembler()
    a.ingest(
      ev('user/message', 2, {
        id: 'm2',
        role: 'user',
        content: [{ type: 'text', text: 'second' }],
        source: { kind: 'user' },
      }),
    )
    a.ingest(
      ev('user/message', 1, {
        id: 'm1',
        role: 'user',
        content: [{ type: 'text', text: 'first' }],
        source: { kind: 'user' },
      }),
    )
    expect(a.snapshot()).toHaveLength(1)
    expect(a.snapshot()[0]).toMatchObject({ id: 'm2' })
  })

  it('routes unknown types to fallback notice', () => {
    const a = assembler()
    a.ingest(ev('turn/start', 1, { turn: 1 }))
    expect(a.snapshot()[0]).toMatchObject({
      kind: 'notice',
      tone: 'info',
      verboseOnly: true,
      message: 'turn/start',
    })
  })

  it('replaceWindow rebuilds from a full list', () => {
    const a = assembler()
    a.ingest(
      ev('user/message', 1, {
        id: 'old',
        role: 'user',
        content: [{ type: 'text', text: 'old' }],
        source: { kind: 'user' },
      }),
    )
    a.replaceWindow([
      ev('user/message', 10, {
        id: 'new',
        role: 'user',
        content: [{ type: 'text', text: 'new' }],
        source: { kind: 'user' },
      }),
    ])
    expect(a.snapshot()).toHaveLength(1)
    expect(a.snapshot()[0]).toMatchObject({ id: 'new', text: 'new' })
  })

  it('reset clears projected nodes', () => {
    const a = assembler()
    a.ingest(
      ev('user/message', 1, {
        id: 'm1',
        role: 'user',
        content: [{ type: 'text', text: 'x' }],
        source: { kind: 'user' },
      }),
    )
    a.reset()
    expect(a.snapshot()).toEqual([])
  })

  it('evicts completed nodes within the configured budgets', () => {
    const a = createAssembler(createBuiltinRegistry(), { maxNodes: 2, maxStateBytes: 1024 })
    for (let index = 0; index < 4; index += 1) {
      a.ingest(
        ev('user/message', index + 1, {
          id: `m${index}`,
          role: 'user',
          content: [{ type: 'text', text: `message ${index}` }],
          source: { kind: 'user' },
        }),
      )
    }
    expect(a.snapshot()).toHaveLength(2)
    expect(a.snapshot()[0]).toMatchObject({ id: 'm2' })
    expect(a.stats()).toMatchObject({ retainedNodes: 2, evictedNodes: 2 })
  })

  it('keeps an active streaming node until it is sealed', () => {
    const a = createAssembler(createBuiltinRegistry(), { maxNodes: 1 })
    a.ingest(
      ev('assistant/chunk', 1, {
        turn: 1,
        step: 0,
        chunk: { type: 'text-delta', text: 'streaming' },
      }),
    )
    a.ingest(
      ev('user/message', 2, {
        id: 'm2',
        role: 'user',
        content: [{ type: 'text', text: 'new' }],
        source: { kind: 'user' },
      }),
    )
    expect(a.snapshot()).toHaveLength(1)
    expect(a.snapshot()[0]).toMatchObject({ kind: 'assistant', id: '1:0' })
    expect(a.stats().evictedNodes).toBe(1)
    a.ingest(
      ev('assistant/message', 3, {
        turn: 1,
        step: 0,
        message: { content: [{ type: 'text', text: 'streaming' }] },
      }),
    )
    a.ingest(
      ev('user/message', 4, {
        id: 'm4',
        role: 'user',
        content: [{ type: 'text', text: 'latest' }],
        source: { kind: 'user' },
      }),
    )
    expect(a.snapshot()).toHaveLength(1)
    expect(a.snapshot()[0]).toMatchObject({ id: 'm4' })
    expect(a.stats().evictedNodes).toBe(2)
  })
})

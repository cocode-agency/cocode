import { Writable } from 'node:stream'
import React from 'react'
import { Box, render } from 'ink'
import stringWidth from 'string-width'
import { afterEach, describe, expect, it } from 'vitest'
import type { AssistantNode } from '../../src/runtime/nodes/types.ts'
import { AssistantRow } from '../../src/present/components/AssistantRow.tsx'
import { messageContentColumns } from '../../src/present/layout.ts'
import { setTheme } from '../../src/present/theme.ts'

describe('AssistantRow rendering', () => {
  afterEach(() => setTheme('dark'))

  it('keeps the assistant body two cells from the message track', () => {
    expect(messageContentColumns(40)).toBe(38)
    expect(messageContentColumns(undefined)).toBeUndefined()
  })

  it('renders inline Markdown in paragraphs, lists, and quotes', async () => {
    const stdout = new CaptureStream(100, 20)
    const node: AssistantNode = {
      kind: 'assistant',
      id: 'assistant-markdown',
      seq: 1,
      time: 1,
      turn: 1,
      step: 1,
      text: [
        '**加粗**、*斜体*、~~删除~~、`代码` 和 [链接](https://example.com)。',
        '',
        '- **列表加粗** 与 `列表代码`',
        '',
        '> *引用斜体* 与 **引用加粗**',
      ].join('\n'),
      reasoning: '',
      streaming: false,
    }
    const app = render(
      React.createElement(
        Box,
        { width: 100 },
        React.createElement(AssistantRow, {
          node,
          verbose: false,
          locale: 'zh',
          maxColumns: 80,
        }),
      ),
      {
        stdout: stdout as unknown as NodeJS.WriteStream,
        debug: true,
        patchConsole: false,
        exitOnCtrlC: false,
      },
    )

    await new Promise<void>((resolve) => setImmediate(resolve))
    app.unmount()
    await new Promise<void>((resolve) => setImmediate(resolve))
    app.cleanup()

    const plain = stdout.output.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
    expect(plain).toContain('加粗、斜体、删除、代码 和 链接')
    expect(plain).toContain('• 列表加粗 与 列表代码')
    expect(plain).toContain('│ │ 引用斜体 与 引用加粗')
    expect(plain).not.toContain('**')
    expect(plain).not.toContain('~~')
    expect(plain).not.toContain('`')
  })

  it('wraps expanded reasoning to the provided message width', async () => {
    const stdout = new CaptureStream(80, 20)
    const node: AssistantNode = {
      kind: 'assistant',
      id: 'assistant-1',
      seq: 1,
      time: 1,
      turn: 1,
      step: 1,
      text: 'Done.',
      reasoning:
        'The user just said hello. Previous context: we were chatting, I made a task list. The last in-progress item is a long item. Just a friendly greeting. I can respond warmly, maybe mark the last todo complete since I did show the list. Let me update the todo list to mark everything complete, then greet.',
      streaming: false,
    }
    const app = render(
      React.createElement(
        Box,
        { width: 80 },
        React.createElement(AssistantRow, {
          node,
          verbose: true,
          locale: 'en',
          maxColumns: 40,
        }),
      ),
      {
        stdout: stdout as unknown as NodeJS.WriteStream,
        debug: true,
        patchConsole: false,
        exitOnCtrlC: false,
      },
    )

    await new Promise<void>((resolve) => setImmediate(resolve))
    app.unmount()
    await new Promise<void>((resolve) => setImmediate(resolve))
    app.cleanup()

    const lines = stdout.output
      .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
      .split('\n')
      .filter((line) => line.includes('The user') || line.includes('Done.') || line.includes('list.'))

    expect(lines.length).toBeGreaterThan(0)
    // The rail runs down every wrapped line, not just the first.
    expect(lines.every((line) => /^[│▌] /.test(line))).toBe(true)
    expect(lines.some((line) => /^│ Done\./.test(line))).toBe(true)
    expect(Math.max(...lines.map((line) => stringWidth(line)))).toBeLessThanOrEqual(40)
  })

  it('highlights a partial thinking range without hiding the reply', async () => {
    setTheme('dark', true)
    const stdout = new CaptureStream(80, 20)
    const node: AssistantNode = {
      kind: 'assistant',
      id: 'assistant-1',
      seq: 1,
      time: 1,
      turn: 1,
      step: 1,
      text: 'answer',
      reasoning: 'thoughts',
      streaming: false,
    }
    const app = render(
      React.createElement(
        Box,
        { width: 80 },
        React.createElement(AssistantRow, {
          node,
          verbose: true,
          locale: 'en',
          maxColumns: 40,
          textSelection: { start: 0, end: 8 },
        }),
      ),
      {
        stdout: stdout as unknown as NodeJS.WriteStream,
        debug: true,
        patchConsole: false,
        exitOnCtrlC: false,
      },
    )

    await new Promise<void>((resolve) => setImmediate(resolve))
    app.unmount()
    await new Promise<void>((resolve) => setImmediate(resolve))
    app.cleanup()

    const plain = stdout.output.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
    expect(plain).toContain('thoughts')
    expect(plain).toContain('answer')
  })

  it('separates thinking from the reply with a blank rail row', async () => {
    const stdout = new CaptureStream(80, 20)
    const node: AssistantNode = {
      kind: 'assistant',
      id: 'assistant-1',
      seq: 1,
      time: 1,
      turn: 1,
      step: 1,
      text: 'answer',
      reasoning: 'thoughts',
      streaming: false,
    }
    const app = render(
      React.createElement(
        Box,
        { width: 80 },
        React.createElement(AssistantRow, {
          node,
          verbose: true,
          locale: 'en',
          maxColumns: 40,
        }),
      ),
      {
        stdout: stdout as unknown as NodeJS.WriteStream,
        debug: true,
        patchConsole: false,
        exitOnCtrlC: false,
      },
    )

    await new Promise<void>((resolve) => setImmediate(resolve))
    app.unmount()
    await new Promise<void>((resolve) => setImmediate(resolve))
    app.cleanup()

    const lines = stdout.output
      .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
      .replaceAll('\r', '')
      .split('\n')
    const thoughts = lines.findIndex((line) => line.includes('thoughts'))
    const answer = lines.findIndex((line) => line.includes('answer'))

    expect(thoughts).toBeGreaterThanOrEqual(0)
    expect(answer).toBe(thoughts + 2)
    expect(lines[thoughts + 1]?.replace(/[│▌ ]/g, '')).toBe('')
  })

  it('renders an interrupted marker after the visible assistant prefix', async () => {
    const stdout = new CaptureStream(80, 20)
    const node: AssistantNode = {
      kind: 'assistant',
      id: 'assistant-interrupted',
      seq: 1,
      time: 1,
      turn: 1,
      step: 1,
      text: 'partial answer',
      reasoning: '',
      streaming: false,
      interrupted: true,
    }
    const app = render(
      React.createElement(
        Box,
        { width: 80 },
        React.createElement(AssistantRow, {
          node,
          verbose: false,
          locale: 'en',
          maxColumns: 40,
        }),
      ),
      {
        stdout: stdout as unknown as NodeJS.WriteStream,
        debug: true,
        patchConsole: false,
        exitOnCtrlC: false,
      },
    )

    await new Promise<void>((resolve) => setImmediate(resolve))
    app.unmount()
    await new Promise<void>((resolve) => setImmediate(resolve))
    app.cleanup()

    const plain = stdout.output.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
    expect(plain).toContain('partial answer')
    expect(plain).toContain('interrupted')
  })
})

class CaptureStream extends Writable {
  readonly isTTY = true

  output = ''

  constructor(
    readonly columns: number,
    readonly rows: number,
  ) {
    super()
  }

  getColorDepth(): number {
    return 24
  }

  override _write(
    chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.output += chunk.toString()
    callback()
  }
}

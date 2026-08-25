import { Writable } from 'node:stream'
import React from 'react'
import { Box, render } from 'ink'
import { describe, expect, it } from 'vitest'
import type { CommandNode } from '../../src/runtime/nodes/types.ts'
import { CommandRow } from '../../src/present/components/CommandRow.tsx'

describe('CommandRow rendering', () => {
  it('shows running and settled command states with expandable details', async () => {
    const stdout = new CaptureStream()
    const node: CommandNode = {
      kind: 'command',
      id: 'cmd-1',
      seq: 1,
      time: 1,
      commandId: 'cmd-1',
      name: 'inspect',
      args: ' image',
      outcome: { kind: 'error', text: 'inspection failed' },
    }
    const app = render(
      React.createElement(
        Box,
        { width: 80 },
        React.createElement(CommandRow, {
          node,
          locale: 'en',
          expanded: true,
          maxColumns: 60,
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
    expect(plain).toContain('/inspect')
    expect(plain).toContain('inspection failed')
    expect(plain).toContain(' image')
  })
})

class CaptureStream extends Writable {
  readonly isTTY = true
  output = ''

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

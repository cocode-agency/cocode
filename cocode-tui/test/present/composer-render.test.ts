import { Writable } from 'node:stream'
import React from 'react'
import { Box, render } from 'ink'
import stringWidth from 'string-width'
import { describe, expect, it } from 'vitest'
import type { TuiSnapshot } from '../../src/runtime/app.ts'
import { Composer } from '../../src/present/components/Composer.tsx'

const ANSI_PATTERN = /\u001b\[[0-?]*[ -/]*[@-~]/g

describe('borderless composer rendering', () => {
  it.each([40, 60, 80, 120])('keeps Unicode and metadata inside %i columns', async (columns) => {
    const output = await renderComposer(columns, {
      text: '中文 👩🏽‍💻 cafe\u0301\nsecond line ' + 'x'.repeat(columns),
      cursor: 8,
      selection: { start: 1, end: 12 },
      attachments: ['/workspace/很长的附件路径/contract.md'],
      images: [{ name: '宽字符-image-🧑‍💻.png', mediaType: 'image/png', bytes: 2048 }],
    })
    const lines = visibleLines(output)
    expect(lines.some((line) => line.startsWith('> '))).toBe(true)
    expect(lines.some((line) => line.startsWith('│ '))).toBe(true)
    expect(lines.some((line) => line.startsWith('Build'))).toBe(true)
    expect(lines.every((line) => stringWidth(line) <= columns)).toBe(true)
    expect(output).not.toMatch(/[┌┐└┘─]/u)
  })

  it('renders an empty draft as one input row plus metadata with no blank chrome', async () => {
    const lines = visibleLines(await renderComposer(80))
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain('Build')
    expect(lines[1]).toContain('> Type a message')
  })

  it('does not repeat the footer submit hint in the composer metadata', async () => {
    const output = await renderComposer(80, {}, { planModeAvailable: false, locale: 'zh' })
    expect(output).not.toContain('回车发送')
  })

  it('keeps disabled, running, plan, and masked states readable without color', async () => {
    expect(await renderComposer(80, { disabled: true })).toContain('locked')
    expect(await renderComposer(80, {}, { agent: 'running' })).toContain('enter queue draft')
    expect(await renderComposer(80, {}, { planMode: true })).toContain('Plan')
    const masked = await renderComposer(80, {
      text: '********',
      cursor: 8,
      mask: true,
      placeholder: 'Paste API key, press enter to confirm',
    })
    expect(masked).toContain('secret')
    expect(masked).toContain('Paste API key, press enter to confirm')
    expect(masked).not.toContain('test-provider')
  })
})

async function renderComposer(
  columns: number,
  overrides: Partial<TuiSnapshot['composer']> = {},
  state: {
    agent?: TuiSnapshot['agent']
    planMode?: boolean
    planModeAvailable?: boolean
    locale?: 'en' | 'zh'
  } = {},
): Promise<string> {
  const stdout = new CaptureStream(columns, 20)
  const composer: TuiSnapshot['composer'] = {
    text: '',
    cursor: 0,
    placeholder: 'Type a message  / for commands',
    disabled: false,
    attachments: [],
    images: [],
    ...overrides,
  }
  const app = render(
    React.createElement(
      Box,
      { width: columns },
      React.createElement(Composer, {
        composer,
        agent: state.agent ?? 'idle',
        planMode: state.planMode ?? false,
        planModeAvailable: state.planModeAvailable ?? true,
        provider: 'test-provider',
        model: 'test-model',
        locale: state.locale ?? 'en',
        maxRows: 6,
        maxColumns: columns,
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
  const rendered = stdout.output
  app.unmount()
  await new Promise<void>((resolve) => setImmediate(resolve))
  app.cleanup()
  return rendered.replace(ANSI_PATTERN, '').replaceAll('\r', '')
}

function visibleLines(output: string): string[] {
  return output.split('\n').map((line) => line.trimEnd()).filter((line) => line !== '')
}

class CaptureStream extends Writable {
  readonly isTTY = true
  readonly columns: number
  readonly rows: number
  output = ''

  constructor(columns: number, rows: number) {
    super()
    this.columns = columns
    this.rows = rows
  }

  _write(chunk: Buffer | string, _encoding: BufferEncoding, callback: () => void): void {
    this.output += chunk.toString()
    callback()
  }
}

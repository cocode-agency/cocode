import { readFile, writeFile } from 'node:fs/promises'
import { DEFAULT_BINDINGS } from '../../src/runtime/keymap.ts'
import { resolveKeymap } from '../../src/runtime/keymap-config.ts'
import { describe, expect, it, vi } from 'vitest'
import {
  assertViewportWidth,
  CONTRACT_MARKERS,
  createFixtureSnapshot,
  fixtureNodes,
  normalizeGolden,
  regionLine,
  renderChatContract,
  stripAnsi,
  visibleWidth,
  type ChatRenderCase,
} from './chat-render-harness.ts'

const CUSTOM_KEYMAP = resolveKeymap({
  COCODE_TUI_KEYMAP: JSON.stringify({
    'help.toggle': 'alt+h',
    'messages.select': 'shift+up',
    'transcript.toggleVerbose': 'alt+o',
  }),
})

const TASKS = [
  { content: `${CONTRACT_MARKERS.task} capture geometry`, status: 'completed' as const },
  { content: 'verify wide characters', status: 'in_progress' as const },
  { content: 'record PTY evidence', status: 'pending' as const },
]

const CASES: ChatRenderCase[] = [
  renderCase('39x20 empty idle', 39, 20, {
    locale: 'en',
    agent: 'idle',
  }),
  renderCase('40x20 starting zh custom keymap', 40, 20, {
    locale: 'zh',
    theme: 'light',
    keymap: CUSTOM_KEYMAP,
    agent: 'starting',
    header: { cwd: `/workspace/${CONTRACT_MARKERS.header}/非常长的项目路径/组合字符-e\u0301` },
    status: { line: `${CONTRACT_MARKERS.status} 正在启动` },
  }),
  renderCase('60x20 disabled masked composer with files and images', 60, 20, {
    agent: 'dead',
    composer: {
      text: `${CONTRACT_MARKERS.composer} secret\nsecond line`,
      cursor: 10,
      disabled: true,
      mask: true,
      attachments: ['/workspace/很长的附件路径/contract.md'],
      images: [{ name: '宽字符-image-🧑‍💻.png', mediaType: 'image/png', bytes: 2048 }],
    },
  }),
  renderCase('80x24 compact idle', 80, 24, {
    agent: 'idle',
  }),
  renderCase('119x29 long selected verbose transcript', 119, 29, {
    agent: 'running',
    verbose: true,
    nodes: fixtureNodes({ long: true, streaming: true }),
    notice: {
      tone: 'info',
      message: 'Notice with 中文, emoji 🐋, combining e\u0301, and a deliberately long responsive sentence.',
    },
    status: {
      line: `${CONTRACT_MARKERS.status} streaming`,
      todos: TASKS,
      queueCount: 2,
      telemetry: {
        tps: 42.5,
        contextPercent: 61,
        activity: { phase: 'tool', line: 'reading fixture', toolCount: 1, turnElapsedMs: 12_345 },
      },
    },
  }),
  renderCase('120x30 wide running', 120, 30, {
    agent: 'running',
    nodes: fixtureNodes({ streaming: true }),
    composer: { text: `${CONTRACT_MARKERS.composer} queue this next`, cursor: 27 },
    status: {
      line: `${CONTRACT_MARKERS.status} running`,
      todos: TASKS,
      queueCount: 1,
      tokens: { input: 1234, output: 567 },
      telemetry: { contextPercent: 33, tps: 18.75, reasoningEffort: 'high' },
    },
  }),
  renderCase('80x30 queue dock above composer', 80, 30, {
    agent: 'running',
    queuedPrompts: [
      { id: 'local-1', text: 'local follow-up', attachments: [], images: [] },
    ],
    remoteQueue: [
      { id: 'host-1', placement: 'queued', content: [{ type: 'text', text: 'Host follow-up' }] },
    ],
  }),
  renderCase('160x35 zh help overlay', 160, 35, {
    locale: 'zh',
    theme: 'light',
    keymap: CUSTOM_KEYMAP,
    agent: 'idle',
    nodes: fixtureNodes(),
    helpOpen: true,
    helpText: `${CONTRACT_MARKERS.overlay} 帮助\nAlt+H 关闭\nAlt+O 展开详情`,
  }),
  renderCase('80x24 blocking question overlay', 80, 24, {
    agent: 'idle',
    nodes: fixtureNodes(),
    question: {
      key: 'fixture-question',
      sessionId: 'fixture-00000000',
      position: 1,
      total: 1,
      answered: 0,
      question: {
        id: 'fixture-choice',
        header: CONTRACT_MARKERS.overlay,
        question: 'Choose a safe action',
        detail: 'This is a deterministic blocking question.',
        options: [
          { label: 'Continue', description: 'Confirm the contract path.' },
          { label: 'Cancel', description: 'Return without changing state.' },
        ],
      },
    },
  }),
  renderCase('120x30 blocking approval overlay', 120, 30, {
    agent: 'running',
    nodes: fixtureNodes({ streaming: true }),
    composer: { text: `${CONTRACT_MARKERS.composer} pending approval`, cursor: 27 },
    status: { line: `${CONTRACT_MARKERS.status} waiting`, todos: TASKS },
    approval: {
      open: true,
      request: {
        sessionId: 'fixture-00000000',
        callId: 'fixture-call',
        toolName: `${CONTRACT_MARKERS.overlay} write_file`,
        target: '/workspace/render-contract.txt',
        risk: 'writes a deterministic fixture',
        source: 'render-contract',
      },
    },
  }),
  renderCase('60x20 slash overlay', 60, 20, {
    agent: 'idle',
    composer: { text: '/', cursor: 1 },
    commands: [
      { name: 'help', summary: `${CONTRACT_MARKERS.overlay} show help` },
      { name: 'status', summary: 'show status' },
    ],
  }),
]

describe.sequential('Chat multi-viewport render contract', () => {
  it('measures ANSI, Chinese, emoji, and combining characters in terminal cells', () => {
    expect(stripAnsi('\u001b[31m你好\u001b[0m')).toBe('你好')
    expect(visibleWidth('你好')).toBe(4)
    expect(visibleWidth('🧑‍💻')).toBe(2)
    expect(visibleWidth('e\u0301')).toBe(1)
    expect(visibleWidth('\u001b[32m中🧑‍💻e\u0301\u001b[0m')).toBe(5)
  })

  it.each(CASES)('$name stays inside $viewport.columns×$viewport.rows', async (testCase) => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] })
    vi.setSystemTime(new Date('2026-08-16T00:00:00.000Z'))
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const warnings = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const chat = await renderChatContract(testCase)
    try {
      assertViewportWidth(chat.frame, testCase)
      expect(chat.stderr, testCase.name).toBe('')
      expect(errors.mock.calls, testCase.name).toEqual([])
      expect(warnings.mock.calls, testCase.name).toEqual([])
      if (testCase.viewport.columns < 120) {
        expect(regionLine(chat.frame, 'inspector'), testCase.name).toBeUndefined()
      } else {
        expect(regionLine(chat.frame, 'inspector'), testCase.name).toBeDefined()
      }
      if (testCase.viewport.columns >= 60) {
        expect(regionLine(chat.frame, 'composer'), testCase.name).toBeDefined()
        expect(regionLine(chat.frame, 'footer'), testCase.name).toBeDefined()
      }
    } finally {
      await chat.close()
      expect(vi.getTimerCount(), `${testCase.name} leaked timers`).toBe(0)
      errors.mockRestore()
      warnings.mockRestore()
      vi.useRealTimers()
    }
  })

  it('renders local and Host queue previews directly above the composer', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] })
    const testCase = CASES.find((item) => item.name === '80x30 queue dock above composer')
    expect(testCase).toBeDefined()
    const chat = await renderChatContract(testCase!)
    try {
      expect(chat.frame).toContain('Prompt queue')
      expect(chat.frame).toContain('local follow-up')
      expect(chat.frame).toContain('Host follow-up')
      expect(chat.frame).toContain('manage with /queue')
    } finally {
      await chat.close()
      expect(vi.getTimerCount()).toBe(0)
      vi.useRealTimers()
    }
  })

  it('keeps page regions ordered and preserves blocking approval actions', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] })
    vi.setSystemTime(new Date('2026-08-16T00:00:00.000Z'))
    const testCase = CASES.find((item) => item.name === '120x30 blocking approval overlay')
    expect(testCase).toBeDefined()
    const chat = await renderChatContract(testCase!)
    try {
      const ordered = ['header', 'transcript', 'task', 'status', 'overlay', 'composer', 'footer'] as const
      const rows = ordered.map((region) => regionLine(chat.frame, region))
      expect(rows.every((row) => row !== undefined)).toBe(true)
      expect(rows).toEqual([...rows].sort((left, right) => (left ?? 0) - (right ?? 0)))
      expect(chat.frame).toContain('Allow once')
      expect(chat.frame).toContain('Deny')

      await vi.advanceTimersByTimeAsync(700)
      await chat.write('\u001b')
      await vi.advanceTimersByTimeAsync(100)
      expect(chat.dispatches).toContainEqual({ type: 'approval.cancel' })
    } finally {
      await chat.close()
      expect(vi.getTimerCount()).toBe(0)
      vi.useRealTimers()
    }
  })

  it('rerenders compact and wide layouts without stale Inspector or duplicate footer rows', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] })
    vi.setSystemTime(new Date('2026-08-16T00:00:00.000Z'))
    const initial = renderCase('resize contract', 160, 35, {
      agent: 'running',
      nodes: fixtureNodes({ streaming: true }),
      composer: { text: CONTRACT_MARKERS.composer, cursor: CONTRACT_MARKERS.composer.length },
    })
    const chat = await renderChatContract(initial)
    try {
      expect(regionLine(chat.frame, 'inspector')).toBeDefined()
      const compact = await chat.resize({ columns: 119, rows: 29 })
      assertViewportWidth(compact, { name: 'resize compact', viewport: { columns: 119, rows: 29 } })
      expect(regionLine(compact, 'inspector')).toBeUndefined()
      expect(countFooterRows(compact)).toBe(1)
      const wide = await chat.resize({ columns: 120, rows: 30 })
      assertViewportWidth(wide, { name: 'resize wide', viewport: { columns: 120, rows: 30 } })
      expect(regionLine(wide, 'inspector')).toBeDefined()
      expect(countFooterRows(wide)).toBe(1)
    } finally {
      await chat.close()
      expect(vi.getTimerCount()).toBe(0)
      vi.useRealTimers()
    }
  })

  it('enters message selection and expands the selected message details', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] })
    vi.setSystemTime(new Date('2026-08-16T00:00:00.000Z'))
    const testCase = renderCase('message selection contract', 119, 29, {
      agent: 'idle',
      nodes: fixtureNodes(),
      verbose: false,
    })
    const chat = await renderChatContract(testCase)
    try {
      const statusBefore = regionLine(chat.frame, 'status')
      const composerBefore = regionLine(chat.frame, 'composer')
      await chat.write('\u001b[1;2A')
      expect(chat.frame).toContain('↑↓ move')
      expect(chat.frame).not.toContain('Message actions')
      expect(regionLine(chat.frame, 'status')).toBe(statusBefore)
      expect(regionLine(chat.frame, 'composer')).toBe(composerBefore)
      await chat.write('m')
      await chat.write('\r')
      expect(chat.frame).toContain('args {"path":"/workspace/very/long/路径/README.md"}')
      expect(chat.frame).toContain('fixture result')
      expect(regionLine(chat.frame, 'footer')).toBeDefined()
    } finally {
      await chat.close()
      expect(vi.getTimerCount()).toBe(0)
      vi.useRealTimers()
    }
  })

  it('keeps a read-only transcript open on Esc and scrollable with PageUp', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] })
    vi.setSystemTime(new Date('2026-08-16T00:00:00.000Z'))
    const nodes = Array.from({ length: 24 }, (_, index) => ({
      kind: 'user' as const,
      id: `readonly-${String(index)}`,
      seq: index + 1,
      time: index + 1,
      text: `readonly-message-${String(index)}`,
    }))
    const chat = await renderChatContract(
      renderCase('read-only transcript', 80, 24, {
        mouseSupported: true,
        header: { source: 'shared-dsh', readOnly: true, canMutate: false },
        composer: { disabled: true },
        nodes,
      }),
    )
    try {
      expect(chat.frame).toContain('readonly-message-23')
      expect(chat.frame).not.toContain('readonly-message-0')

      await chat.write('\u001b[1;2A')
      expect(chat.frame).toContain('↑↓ move')
      await chat.write('\u001b')
      await vi.advanceTimersByTimeAsync(500)
      await chat.write('')
      expect(chat.frame).not.toContain('↑↓ move')
      expect(chat.dispatches).not.toContainEqual({ type: 'quit' })

      await chat.write('\u001b')
      await vi.advanceTimersByTimeAsync(500)
      expect(chat.dispatches).toContainEqual({ type: 'session.back' })
      expect(chat.dispatches).not.toContainEqual({ type: 'interruptOrQuit' })

      for (let index = 0; index < 8; index += 1) await chat.write('\u001b[5~')
      expect(chat.frame).toContain('readonly-message-0')

      for (let index = 0; index < 8; index += 1) await chat.write('\u001b[6~')
      expect(chat.frame).toContain('readonly-message-23')
      for (let index = 0; index < 8; index += 1) {
        await chat.write('\u001b[<64;10;10M')
      }
      expect(chat.frame).toContain('readonly-message-0')
    } finally {
      await chat.close()
      expect(vi.getTimerCount()).toBe(0)
      vi.useRealTimers()
    }
  })

  it.each([
    ['80x24 compact idle', '80x24-compact-idle.txt'],
    ['120x30 wide running', '120x30-wide-running.txt'],
    ['120x30 blocking approval overlay', '120x30-blocking-approval.txt'],
  ] as const)('matches the reviewed %s golden', async (caseName, fileName) => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] })
    vi.setSystemTime(new Date('2026-08-16T00:00:00.000Z'))
    const testCase = CASES.find((item) => item.name === caseName)
    expect(testCase).toBeDefined()
    const chat = await renderChatContract(testCase!)
    try {
      // Goldens are reviewed by eye; COCODE_UPDATE_GOLDEN=1 regenerates them so
      // an intentional visual change is a readable diff instead of hand editing.
      const path = new URL(`./goldens/${fileName}`, import.meta.url)
      const actual = normalizeGolden(chat.frame)
      if (process.env.COCODE_UPDATE_GOLDEN === '1') {
        await writeFile(path, actual)
      } else {
        // Git may check out repository goldens with CRLF on Windows.
        expect(actual).toBe(normalizeGolden(await readFile(path, 'utf8')))
      }
    } finally {
      await chat.close()
      expect(vi.getTimerCount()).toBe(0)
      vi.useRealTimers()
    }
  })
})

function renderCase(
  name: string,
  columns: number,
  rows: number,
  overrides: Parameters<typeof createFixtureSnapshot>[0] & {
    theme?: 'dark' | 'light'
    keymap?: typeof DEFAULT_BINDINGS
  },
): ChatRenderCase {
  const {
    theme = 'dark',
    keymap = DEFAULT_BINDINGS,
    mouseSupported,
    ...snapshotOverrides
  } = overrides
  const locale = snapshotOverrides.locale ?? 'en'
  return {
    name,
    viewport: { columns, rows },
    locale,
    theme,
    keymap,
    mouseSupported,
    snapshot: createFixtureSnapshot({ ...snapshotOverrides, locale }),
  }
}

function countFooterRows(frame: string): number {
  return frame
    .split('\n')
    .filter((line) => line.includes('interrupt'))
    .length
}

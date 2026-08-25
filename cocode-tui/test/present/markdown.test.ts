import { describe, expect, it } from 'vitest'
import {
  inlineMarkdownText,
  parseMarkdownBlocks,
  renderTable,
  splitStreamingMarkdown,
} from '../../src/present/components/Markdown.tsx'
import stringWidth from 'string-width'

describe('markdown presentation', () => {
  it('projects nested inline Markdown to visible terminal text', () => {
    expect(
      inlineMarkdownText('**bold** *em* ~~del~~ `code` [link](https://example.com)'),
    ).toBe('bold em del code link')
  })

  it('projects common markdown blocks without losing plain text', () => {
    expect(parseMarkdownBlocks('# Title\n\n**answer**\n\n- one\n- two')).toEqual([
      { kind: 'heading', depth: 1, text: 'Title' },
      { kind: 'paragraph', text: '**answer**' },
      { kind: 'list', ordered: false, items: ['one', 'two'] },
    ])
  })

  it('keeps the growing final block unstable while freezing complete blocks', () => {
    const first = splitStreamingMarkdown('First paragraph.\n\nSecond', '')
    expect(first.stablePrefix).toBe('First paragraph.\n\n')
    expect(first.unstableSuffix).toBe('Second')
    const next = splitStreamingMarkdown('First paragraph.\n\nSecond line.', first.stablePrefix)
    expect(next.stablePrefix).toBe(first.stablePrefix)
    expect(next.unstableSuffix).toBe('Second line.')
  })

  it('wraps wide table cells without exceeding the terminal width', () => {
    const table = renderTable(
      ['文件', '改动'],
      [['`.github/workflows/cocode-tui-platform.yml`', 'Lint 步骤 `pnpm exec oxlint src packages`']],
      48,
    )

    expect(Math.max(...table.split('\n').map(stringWidth))).toBeLessThanOrEqual(48)
    expect(table).toContain('文件')
    expect(table).toContain('改动')
    expect(table).toContain('platform')
    expect(table).not.toContain('`')
  })

  it('accounts for double-width characters when sizing cells', () => {
    const table = renderTable(['字段'], [['中文内容']], 16)

    expect(Math.max(...table.split('\n').map(stringWidth))).toBeLessThanOrEqual(16)
    expect(table).toContain('中文内容')
  })

  it('does not stretch short tables to the full terminal width', () => {
    const table = renderTable(['状态'], [['完成']], 120)

    expect(Math.max(...table.split('\n').map(stringWidth))).toBeLessThan(40)
  })
})

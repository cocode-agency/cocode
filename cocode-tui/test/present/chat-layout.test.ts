import { describe, expect, it } from 'vitest'
import { calculateChatLayout } from '../../src/present/chat-layout.ts'
import { queueDockRows } from '../../src/present/components/QueueDock.tsx'

describe('chat layout rows', () => {
  it('uses the composer actual rendered rows instead of fixed chrome', () => {
    const layout = calculateChatLayout({ viewportRows: 30, composerRows: 4 })
    expect(layout).toMatchObject({
      baseRows: 10,
      composerRows: 4,
      reservedRows: 10,
      messageRows: 20,
      minimumRows: 10,
      tooSmall: false,
    })
    expect(layout.rows.composer).toBe(4)
  })

  it('includes composer summaries, status, notices, and editor feedback', () => {
    const layout = calculateChatLayout({
      viewportRows: 30,
      composerRows: 3,
      noticeRows: 3,
      hasStatusDetails: true,
      editorFeedbackRows: 2,
    })
    expect(layout).toMatchObject({
      baseRows: 15,
      composerRows: 3,
      reservedRows: 15,
      messageRows: 15,
      minimumRows: 15,
      tooSmall: false,
    })
    expect(layout.rows.composer).toBe(3)
  })

  it('reserves the queue dock above the composer', () => {
    const queue = [{ id: 'local-1', text: 'next', attachments: [], images: [] }]
    const layout = calculateChatLayout({
      viewportRows: 30,
      composerRows: 2,
      queueDockRows: queueDockRows(queue, []),
    })
    expect(layout.rows.queueDock).toBe(4)
    expect(layout.baseRows).toBe(12)
    expect(layout.messageRows).toBe(18)
  })

  it('does not make a small terminal fail because of a long notice', () => {
    const layout = calculateChatLayout({ viewportRows: 29, composerRows: 2, noticeRows: 6 })
    expect(layout.tooSmall).toBe(false)
    expect(layout.minimumRows).toBe(14)
  })

  it('reserves the main-area checklist without pushing the composer away', () => {
    const layout = calculateChatLayout({
      viewportRows: 30,
      composerRows: 2,
      checklistStripRows: 6,
    })
    expect(layout).toMatchObject({
      baseRows: 14,
      composerRows: 2,
      reservedRows: 14,
      messageRows: 16,
      minimumRows: 14,
      tooSmall: false,
    })
  })

  it.each([
    ['help', { helpLines: 5 }, 17],
    ['slash', { slashItems: 3 }, 15],
    ['file', { fileItems: 4 }, 16],
    ['loading file', { fileItems: 4, fileLoading: true }, 17],
    ['empty history', { historyMatches: 0 }, 14],
    ['history results', { historyMatches: 3 }, 16],
    ['empty resume', { resumeItems: 0 }, 14],
    ['resume results', { resumeItems: 4 }, 17],
    ['windowed resume', { resumeItems: 12 }, 22],
    ['checklist', { checklistItems: 3 }, 15],
    ['windowed checklist', { checklistItems: 12, checklistSelected: 6 }, 22],
    ['rewind results', { rewindItems: 4 }, 18],
    ['windowed rewind', { rewindItems: 12, rewindSelected: 6 }, 22],
    ['plugin picker', { pluginItems: 4, pluginSelected: 1 }, 18],
    ['windowed plugin picker', { pluginItems: 12, pluginSelected: 6 }, 24],
    ['plugin picker with status', { pluginItems: 4, pluginStatus: true }, 19],
    ['model switch', { modelSwitchRows: 6 }, 14],
  ] as const)('covers the %s overlay height', (_name, overlay, reservedRows) => {
    const layout = calculateChatLayout({ viewportRows: 80, composerRows: 2, ...overlay })
    expect(layout.reservedRows).toBe(reservedRows)
    expect(layout.messageRows).toBe(80 - reservedRows)
    expect(layout.minimumRows).toBeLessThanOrEqual(80)
    expect(layout.tooSmall).toBe(false)
  })

  it('marks a viewport smaller than the actual composer projection', () => {
    const layout = calculateChatLayout({ viewportRows: 4, composerRows: 7 })
    expect(layout).toMatchObject({
      baseRows: 13,
      composerRows: 7,
      reservedRows: 13,
      messageRows: 0,
      minimumRows: 13,
      tooSmall: true,
    })
  })

  it('caps overlays so the composer and one message row stay visible', () => {
    const layout = calculateChatLayout({ viewportRows: 24, composerRows: 2, helpLines: 20 })
    expect(layout).toMatchObject({
      baseRows: 8,
      composerRows: 2,
      overlayRows: 15,
      reservedRows: 23,
      messageRows: 1,
      minimumRows: 14,
      tooSmall: false,
    })
  })

  it('enters the size fallback before an overlay can be clipped', () => {
    const layout = calculateChatLayout({ viewportRows: 13, composerRows: 2, slashItems: 8 })
    expect(layout).toMatchObject({
      baseRows: 8,
      composerRows: 2,
      overlayRows: 0,
      reservedRows: 8,
      messageRows: 5,
      minimumRows: 14,
      tooSmall: true,
    })
  })

  it('keeps the existing overlay fallback and indicator budgets', () => {
    expect(calculateChatLayout({ viewportRows: 13, composerRows: 2, slashItems: 8 }).tooSmall).toBe(true)
    expect(calculateChatLayout({ viewportRows: 16, composerRows: 2, resumeItems: 4 }).tooSmall).toBe(true)
    expect(calculateChatLayout({ viewportRows: 80, composerRows: 2, resumeItems: 12 }).overlayRows).toBe(14)
    expect(calculateChatLayout({ viewportRows: 80, composerRows: 2, resumeItems: 12, resumeSelected: 6 }).overlayRows).toBe(15)
    expect(calculateChatLayout({ viewportRows: 80, composerRows: 2, rewindItems: 2, rewindConfirming: true }).overlayRows).toBe(9)
  })

  it.each([
    [1, 1, 'tiny'],
    [59, 30, 'tiny'],
    [60, 30, 'compact'],
    [119, 30, 'compact'],
    [120, 30, 'wide'],
    [240, 120, 'wide'],
  ] as const)('projects %s columns as %s', (columns, rows, mode) => {
    const layout = calculateChatLayout({
      viewport: { columns, rows },
      composerRows: 2,
    })
    expect(layout.mode).toBe(mode)
    expect(layout.mainColumns).toBeGreaterThanOrEqual(1)
    expect(layout.rows.transcript).toBeGreaterThanOrEqual(0)
    expect(layout.rows.composer).toBeGreaterThanOrEqual(0)
    expect(layout.tooSmall).toBe(mode === 'tiny')
  })

  it('keeps every non-tiny layout exactly inside the viewport budget', () => {
    for (const columns of [60, 80, 119, 120, 160, 320]) {
      for (const rows of [1, 8, 16, 30, 100]) {
        const layout = calculateChatLayout({
          viewport: { columns, rows },
          composerRows: rows % 9,
          noticeRows: rows % 5,
          checklistStripRows: rows % 4,
          editorFeedbackRows: rows % 3,
          activeOverlays: [{ kind: 'help', rows: rows + 4 }],
        })
        for (const value of [
          layout.mainColumns,
          layout.rows.header,
          layout.rows.transcript,
          layout.rows.checklist,
          layout.rows.status,
          layout.rows.editorFeedback,
          layout.rows.overlay,
          layout.rows.composer,
          layout.rows.footer,
        ]) {
          expect(Number.isInteger(value)).toBe(true)
          expect(value).toBeGreaterThanOrEqual(0)
        }
        if (!layout.tooSmall) {
          expect(
            layout.rows.header +
              layout.rows.transcript +
              layout.rows.checklist +
              layout.rows.status +
              layout.rows.editorFeedback +
              layout.rows.overlay +
              layout.rows.composer +
              layout.rows.footer,
          ).toBe(rows)
        }
        const painted = layout.inspector === undefined
          ? layout.mainColumns
          : layout.mainColumns + layout.inspector.width + 1
        expect(layout.paintColumns).toBe(Math.max(1, columns - 1))
        expect(painted).toBe(layout.paintColumns)
        if (columns > 1) expect(painted).toBeLessThan(columns)
      }
    }
  })

  it.each([
    ['help', 9],
    ['slash', 8],
    ['file', 8],
    ['history', 8],
    ['resume', 8],
    ['checklist', 8],
    ['rewind', 9],
    ['skills', 8],
    ['plugins', 8],
    ['question', 8],
    ['approval', 8],
    ['review', 8],
    ['action-menu', 8],
    ['model', 8],
    ['effort', 8],
  ] as const)('budgets the %s overlay independently', (kind, rows) => {
    const layout = calculateChatLayout({
      viewport: { columns: 120, rows: 80 },
      composerRows: 2,
      activeOverlays: [{ kind, rows }],
    })
    expect(layout.activeOverlay?.kind).toBe(kind)
    expect(layout.rows.overlay).toBe(rows)
    expect(layout.rows.transcript).toBeGreaterThanOrEqual(1)
  })

  it('selects one overlay by interaction priority when input is inconsistent', () => {
    const layout = calculateChatLayout({
      viewport: { columns: 120, rows: 80 },
      composerRows: 2,
      activeOverlays: [
        { kind: 'help', rows: 20 },
        { kind: 'question', rows: 8 },
        { kind: 'model', rows: 14 },
      ],
    })
    expect(layout.activeOverlay?.kind).toBe('question')
    expect(layout.rows.overlay).toBe(8)
  })
})

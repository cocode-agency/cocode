import { describe, expect, it, vi } from 'vitest'
import { markUnavailableHistoryAttachments } from '../../src/runtime/history-attachments.ts'
import { blocksToText } from '../../src/runtime/text.ts'

describe('history attachment fallback', () => {
  it('marks only unreadable image blocks and keeps metadata visible', async () => {
    const readAttachment = vi.fn(async (_sessionId: string, attachmentId: string) => {
      if (attachmentId === 'broken') throw new Error('attachment missing')
      return { attachment: { attachmentId, mediaType: 'image/png', bytes: 1, width: 2, height: 3 }, data: Buffer.of(0) }
    })
    const events = [{
      type: 'user/message',
      seq: 1,
      time: 1,
      data: {
        content: [
          { type: 'text', text: 'before ' },
          { type: 'image', attachment: { attachmentId: 'broken', name: 'diagram.png', width: 2, height: 3 } },
          { type: 'image', attachment: { attachmentId: 'ok', name: 'ok.png', width: 1, height: 1 } },
        ],
      },
    }]
    const marked = await markUnavailableHistoryAttachments({ readAttachment }, 's1', events)
    const content = (marked[0]?.data as { content: unknown[] }).content
    expect(blocksToText(content)).toContain('[image diagram.png 2x3 unavailable]')
    expect(blocksToText(content)).toContain('[image ok.png 1x1]')
    expect(readAttachment).toHaveBeenCalledTimes(2)
  })
})

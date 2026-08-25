import { describe, expect, it } from 'vitest'
import { blocksToText } from '../../src/runtime/text.ts'

describe('blocksToText', () => {
  it('keeps readable image metadata in terminal message text', () => {
    expect(blocksToText([
      { type: 'text', text: 'Review ' },
      { type: 'image', attachment: { name: 'diagram.png', width: 640, height: 480 } },
    ])).toBe('Review [image diagram.png 640x480]')
  })

  it('uses a stable fallback when image metadata is unavailable', () => {
    expect(blocksToText([{ type: 'image' }])).toBe('[image]')
  })
})

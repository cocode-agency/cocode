/**
 * Pull visible / reasoning text out of content-block arrays.
 */

export function blocksToText(blocks: unknown): string {
  if (!Array.isArray(blocks)) return ''
  return blocks.map(blockToText).filter((value) => value !== '').join('')
}

function blockToText(block: unknown): string {
  if (!isRecord(block)) return ''
  if (block.type === 'text' && typeof block.text === 'string') return block.text
  if (block.type !== 'image') return ''
  const attachment = isRecord(block.attachment) ? block.attachment : block
  const name = typeof attachment.name === 'string' && attachment.name.trim() !== ''
    ? attachment.name.trim()
    : undefined
  const width = typeof attachment.width === 'number' && attachment.width > 0 ? attachment.width : undefined
  const height = typeof attachment.height === 'number' && attachment.height > 0 ? attachment.height : undefined
  const dimensions = width !== undefined && height !== undefined ? ` ${width}x${height}` : ''
  return `[image${name === undefined ? '' : ` ${name}`}${dimensions}]`
}

export function reasoningToText(blocks: unknown): string {
  if (!Array.isArray(blocks)) return ''
  return blocks
    .filter((block): block is { type: string; text: string } => {
      return isRecord(block) && block.type === 'reasoning' && typeof block.text === 'string'
    })
    .map((block) => block.text)
    .join('')
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

export function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

export type WhaleLogoSize = 'large' | 'medium' | 'small' | 'inline'

export type CharacterAnimation = {
  interval: number
  accentRows: number
  frames: readonly string[]
}

type WhaleSpec = {
  width: number
  bodyMask: readonly string[]
  spoutMasks: readonly (readonly string[])[]
  eye: { row: number; column: number }
  brand: { row: number; column: number; lines: readonly string[] }
}

const BINARY_PATTERN = '0001110100111010'

const SPOUT_STAGES = [
  ['', '', '', '', ''],
  ['', '', '', '', '#####'],
  ['', '', '', '   #####   ', '  #######  '],
  ['', '', '   #######   ', '  #########  ', '   #####   '],
  ['', '   ###   ###   ', '  ###########  ', '###############', '   #######   '],
  ['  ####  ####  ', '#################', ' ############### ', '   #######   ', '   #######   '],
  [
    '###   ###   ###',
    '#####################',
    '#################',
    '  #########  ',
    '   #######   ',
  ],
  [
    '  ##  ##  ##  ',
    '  ###############  ',
    '   ###########   ',
    '    #######    ',
    '    #######    ',
  ],
  ['', '', '    #######    ', '     #####     ', ''],
] as const

const SPOUT_SEQUENCE = [0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 8, 7, 6, 5, 3, 1]

/** Pixel-built wordmark shared with the GUI sidebar's CocodeLogo. */
const COCODE_WORDMARK_LINES = [
  ' ▄█████ ▄████▄ ▄█████ ▄████▄ █████▄ ▄█████',
  ' ██     ██  ██ ██     ██  ██ ██  ██ ██▄▄',
  ' ██     ██  ██ ██     ██  ██ ██  ██ ██▀▀',
  ' ▀█████ ▀████▀ ▀█████ ▀████▀ █████▀ ▀█████',
] as const
const COCODE_WORDMARK_WIDTH = COCODE_WORDMARK_LINES.reduce(
  (width, line) => Math.max(width, line.length),
  0,
)
const COCODE_WORDMARK = COCODE_WORDMARK_LINES.map((line) => line.padEnd(COCODE_WORDMARK_WIDTH))
const HORIZONTAL_WORDMARK = [...COCODE_WORDMARK, ' '.repeat(COCODE_WORDMARK_WIDTH)]

const HORIZONTAL_WHALE_WIDTH = 34
const HORIZONTAL_WORDMARK_COLUMN = HORIZONTAL_WHALE_WIDTH + 2
const HORIZONTAL_SPOUT_STAGES = [
  ['', '', ''],
  ['', '  ###  ', ' ### ### '],
  [' ### ### ', '#########', '  #####  '],
  ['### ### ###', '###########', ' ####### '],
  [' ### ### ', '#########', '  #####  '],
  ['', ' ### ### ', ''],
] as const
const HORIZONTAL_SPOUT_SEQUENCE = [0, 0, 1, 2, 3, 4, 5, 4, 3, 2, 1]
const HORIZONTAL_BODY_MASK = [
  '       ###################        ',
  '   #########################  ### ',
  '##################################',
  '  ##########################  ### ',
  '       ###################        ',
] as const
export const HORIZONTAL_WHALE_COLUMNS =
  HORIZONTAL_WORDMARK_COLUMN + COCODE_WORDMARK_WIDTH
export const HORIZONTAL_WHALE_MIN_COLUMNS = HORIZONTAL_WHALE_COLUMNS + 2

const LARGE_SPEC: WhaleSpec = {
  width: 68,
  spoutMasks: createSpoutMasks(68),
  bodyMask: [
    '               #####################################                ',
    '        ###################################################    #####',
    '   ########################################################## #######',
    '####################################################################',
    ' #################################################################  ',
    '    ######################################################### #######',
    '         ###############################################       #####',
    '                ###################################                 ',
    '                              ########                              ',
  ],
  eye: { row: 3, column: 7 },
  brand: { row: 1, column: 17, lines: COCODE_WORDMARK },
}

export const LARGE_WHALE_ANIMATION = createWhaleAnimation(LARGE_SPEC)
export const MEDIUM_WHALE_ANIMATION = createHorizontalWhaleAnimation()
export const SMALL_WHALE_ANIMATION = MEDIUM_WHALE_ANIMATION

export const INLINE_WHALE_ANIMATION: CharacterAnimation = {
  interval: 160,
  accentRows: 1,
  frames: ['001🐋011', '010🐋101', '101🐋010', '011🐋100'],
}

export function animationForWhaleSize(size: WhaleLogoSize): CharacterAnimation {
  switch (size) {
    case 'large':
      return LARGE_WHALE_ANIMATION
    case 'medium':
      return MEDIUM_WHALE_ANIMATION
    case 'small':
      return SMALL_WHALE_ANIMATION
    case 'inline':
      return INLINE_WHALE_ANIMATION
  }
}

function createWhaleAnimation(spec: WhaleSpec): CharacterAnimation {
  return {
    interval: 140,
    accentRows: spec.spoutMasks[0]?.length ?? 0,
    frames: Array.from({ length: SPOUT_SEQUENCE.length }, (_, phase) => {
      const spoutMask = spec.spoutMasks[SPOUT_SEQUENCE[phase] ?? 0] ?? []
      return [...renderBinaryMask(spoutMask, phase + 5), ...renderWhaleBody(spec, phase)]
        .map((line) => normalizeLine(line, spec.width))
        .join('\n')
    }),
  }
}

function createHorizontalWhaleAnimation(): CharacterAnimation {
  const spoutMasks = HORIZONTAL_SPOUT_STAGES.map((stage) =>
    stage.map((line) =>
      normalizeLine(centerLine(line, HORIZONTAL_WHALE_WIDTH), HORIZONTAL_WHALE_WIDTH),
    ),
  )
  const accentRows = spoutMasks[0]?.length ?? 0
  const blankWordmark = ' '.repeat(COCODE_WORDMARK_WIDTH)
  return {
    interval: 180,
    accentRows,
    frames: HORIZONTAL_SPOUT_SEQUENCE.map((stage, phase) => {
      const spout = renderBinaryMask(spoutMasks[stage] ?? [], phase + 5)
      const body = renderBinaryMask(HORIZONTAL_BODY_MASK, phase)
      body[2] = replaceAt(body[2] ?? '', 4, '●')
      return [...spout, ...body]
        .map((line, row) => {
          const wordmark = row < accentRows ? blankWordmark : (HORIZONTAL_WORDMARK[row - accentRows] ?? '')
          return `${normalizeLine(line, HORIZONTAL_WHALE_WIDTH)}  ${wordmark}`
        })
        .join('\n')
    }),
  }
}

function createSpoutMasks(width: number): readonly (readonly string[])[] {
  return SPOUT_STAGES.map((stage) => stage.map((line) => centerLine(line, width)))
}

function renderWhaleBody(spec: WhaleSpec, phase: number): string[] {
  const body = renderBinaryMask(spec.bodyMask, phase)
  body[spec.eye.row] = replaceAt(body[spec.eye.row] ?? '', spec.eye.column, '●')
  for (const [index, line] of spec.brand.lines.entries()) {
    const row = spec.brand.row + index
    body[row] = replaceAt(body[row] ?? '', spec.brand.column, line)
  }
  return body
}

function renderBinaryMask(mask: readonly string[], phase: number): string[] {
  return mask.map((line, row) =>
    Array.from(line)
      .map((character, column) => {
        if (character !== '#') return character
        return BINARY_PATTERN[(row * 5 + column + phase) % BINARY_PATTERN.length] ?? '0'
      })
      .join(''),
  )
}

function replaceAt(line: string, index: number, value: string): string {
  return `${line.slice(0, index)}${value}${line.slice(index + value.length)}`
}

function normalizeLine(line: string, width: number): string {
  return line.slice(0, width).padEnd(width)
}

function centerLine(line: string, width: number): string {
  const left = Math.max(0, Math.floor((width - line.length) / 2))
  return `${' '.repeat(left)}${line}`
}

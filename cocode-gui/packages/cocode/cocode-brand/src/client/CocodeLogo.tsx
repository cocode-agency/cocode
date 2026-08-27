const CELL_WIDTH = 10
const ROW_HEIGHT = 16
const MARK_COLUMNS = 7
const WORDMARK_COLUMNS = 42
const WORDMARK_LINES = [
	" ▄█████ ▄████▄ ▄█████ ▄████▄ █████▄ ▄█████",
	" ██     ██  ██ ██     ██  ██ ██  ██ ██▄▄",
	" ██     ██  ██ ██     ██  ██ ██  ██ ██▀▀",
	" ▀█████ ▀████▀ ▀█████ ▀████▀ █████▀ ▀█████",
] as const

export interface CocodeLogoProps {
	variant?: "wordmark" | "mark" | "name" | undefined
	size?: number | undefined
	className?: string | undefined
}

/** Pixel-built cocode.agency logo. Color rides currentColor. */
export function CocodeLogo({ variant = "wordmark", size = 20, className }: CocodeLogoProps) {
	const columnCount = variant === "mark"
		? MARK_COLUMNS
		: variant === "name"
			? WORDMARK_COLUMNS - MARK_COLUMNS
			: WORDMARK_COLUMNS
	const lines = variant === "mark"
		? WORDMARK_LINES.map((line) => line.slice(0, MARK_COLUMNS))
		: variant === "name"
			? WORDMARK_LINES.map((line) => line.slice(MARK_COLUMNS))
			: WORDMARK_LINES
	const blocks = lines.flatMap((line, rowIndex) => [...line].flatMap((glyph, columnIndex) => {
		const x = columnIndex * CELL_WIDTH
		const y = rowIndex * ROW_HEIGHT
		if (glyph === "█") return [<rect key={`${rowIndex}-${columnIndex}`} x={x} y={y} width={CELL_WIDTH} height={ROW_HEIGHT} />]
		if (glyph === "▄") return [<rect key={`${rowIndex}-${columnIndex}`} x={x} y={y + ROW_HEIGHT / 2} width={CELL_WIDTH} height={ROW_HEIGHT / 2} />]
		if (glyph === "▀") return [<rect key={`${rowIndex}-${columnIndex}`} x={x} y={y} width={CELL_WIDTH} height={ROW_HEIGHT / 2} />]
		return []
	}))

	return (
		<svg
			width={(size * columnCount * CELL_WIDTH) / (WORDMARK_LINES.length * ROW_HEIGHT)}
			height={size}
			className={className}
			viewBox={`0 0 ${columnCount * CELL_WIDTH} ${WORDMARK_LINES.length * ROW_HEIGHT}`}
			preserveAspectRatio="xMinYMid meet"
			shapeRendering="crispEdges"
			aria-hidden="true"
		>
			<g fill="currentColor">{blocks}</g>
		</svg>
	)
}
